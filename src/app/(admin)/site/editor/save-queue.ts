import { coalesceOps, type SaveResult, type SiteOp } from '@/lib/site/editor/ops';

/**
 * The editor's background save (spec §6.3). Edits are applied to the store
 * the moment they are made; this queue gets them to the server afterwards,
 * one request at a time, each against the version the last one returned.
 *
 * The rule the whole class exists for (Review Focus #1): an edit made while a
 * save is in flight waits for it, and then goes out against the version that
 * save came back with — never the stale one it started from, never ahead of
 * the batch before it, never dropped. A batch that fails goes back to the
 * front of the line, ahead of anything that arrived while it was out.
 *
 * No React here: the store (`use-editor-store.ts`) owns one of these and
 * mirrors its snapshot into state.
 */

export type SaveFn = (baseVersion: number, ops: SiteOp[]) => Promise<SaveResult>;
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error' | 'conflict';

export interface QueueSnapshot {
  status: SaveStatus;
  /**
   * The latest version the server has told us about. After a conflict this
   * is the server's version, not the one the refused batch was based on — the
   * queue sends nothing more until `reset` or `rebase` decides what to do.
   */
  version: number;
  /** Ops not yet confirmed saved, the one in flight included. */
  pending: number;
  /** Hebrew, for the top bar; null unless the status is 'error'. */
  error: string | null;
}

export interface SaveQueueOptions {
  send: SaveFn;
  version: number;
  /** Quiet time after the last change before a send. Default 500 ms. */
  delayMs?: number;
  onChange: (snapshot: QueueSnapshot) => void;
  /** Injectable for tests; defaults to `setTimeout` / `clearTimeout`. */
  timers?: { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
}

/** What the top bar says when the request itself failed — no answer at all. */
export const NETWORK_FAILURE = 'השמירה נכשלה, אולי אין חיבור. אפשר לנסות שוב.';

const DEFAULT_DELAY_MS = 500;

export class SaveQueue {
  private readonly send: SaveFn;
  private readonly delayMs: number;
  private readonly onChange: (snapshot: QueueSnapshot) => void;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  private version: number;
  private queued: SiteOp[] = [];
  private inFlight: SiteOp[] | null = null;
  private flight: Promise<void> | null = null;
  private timer: unknown = null;
  private halted: 'error' | 'conflict' | null = null;
  private error: string | null = null;
  /** Bumped by `reset` and `rebase`, so a reply to a batch they replaced is ignored. */
  private epoch = 0;
  private disposed = false;

  constructor(options: SaveQueueOptions) {
    this.send = options.send;
    this.version = options.version;
    this.delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
    this.onChange = options.onChange;
    this.setTimer = options.timers?.set ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.timers?.clear ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  get snapshot(): QueueSnapshot {
    const pending = (this.inFlight?.length ?? 0) + this.queued.length;
    let status: SaveStatus = 'saved';
    if (this.halted !== null) status = this.halted;
    else if (this.inFlight !== null) status = 'saving';
    else if (this.queued.length > 0) status = 'pending';
    return { status, version: this.version, pending, error: this.halted === 'error' ? this.error : null };
  }

  /** Coalesces into what is waiting and restarts the quiet-time clock. */
  enqueue(ops: readonly SiteOp[]): void {
    if (this.disposed || ops.length === 0) return;
    this.queued = coalesceOps([...this.queued, ...ops]);
    if (this.halted === null) this.schedule();
    this.emit();
  }

  /**
   * Sends everything waiting, now — including whatever arrives while it is
   * sending. Resolves when the queue is empty, halted or disposed. Safe to
   * call while a send is in flight: it waits for that one first.
   */
  async flush(): Promise<void> {
    this.cancelTimer();
    while (!this.disposed) {
      if (this.flight !== null) {
        await this.flight;
        continue;
      }
      if (this.halted !== null || this.queued.length === 0) return;
      this.flight = this.sendQueued();
      await this.flight;
    }
  }

  /** After 'error' only. A conflict is not retried: it needs `reset` or `rebase`. */
  async retry(): Promise<void> {
    if (this.disposed || this.halted !== 'error') return;
    this.halted = null;
    this.error = null;
    this.emit();
    await this.flush();
  }

  /** 'theirs': drop everything unsent and carry on from the server's version. */
  reset(version: number): void {
    this.epoch += 1;
    this.cancelTimer();
    this.queued = [];
    this.inFlight = null;
    this.flight = null;
    this.version = version;
    this.halted = null;
    this.error = null;
    this.emit();
  }

  /** 'mine': what is still worth sending, against the server's version, now. */
  rebase(version: number, keep: readonly SiteOp[]): void {
    this.epoch += 1;
    this.cancelTimer();
    this.queued = coalesceOps(keep);
    this.inFlight = null;
    this.flight = null;
    this.version = version;
    this.halted = null;
    this.error = null;
    this.emit();
    void this.flush();
  }

  pendingOps(): SiteOp[] {
    return coalesceOps([...(this.inFlight ?? []), ...this.queued]);
  }

  /** Stops the clock and the reports. A reply that lands afterwards changes nothing. */
  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
  }

  private schedule(): void {
    this.cancelTimer();
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, this.delayMs);
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    this.clearTimer(this.timer);
    this.timer = null;
  }

  private async sendQueued(): Promise<void> {
    const epoch = this.epoch;
    const batch = this.queued;
    this.queued = [];
    this.inFlight = batch;
    this.emit();

    let result: SaveResult | null = null;
    try {
      result = await this.send(this.version, batch);
    } catch {
      result = null;
    }
    if (epoch !== this.epoch || this.disposed) return;

    this.inFlight = null;
    this.flight = null;
    if (result !== null && result.ok) {
      this.version = result.version;
    } else {
      // Back to the front of the line, ahead of anything that arrived meanwhile,
      // and no clock left running: nothing goes out until retry, reset or rebase.
      this.queued = coalesceOps([...batch, ...this.queued]);
      this.cancelTimer();
      if (result === null) {
        this.halted = 'error';
        this.error = NETWORK_FAILURE;
      } else if (result.reason === 'conflict') {
        this.halted = 'conflict';
        this.version = result.version;
      } else {
        this.halted = 'error';
        this.error = result.error;
      }
    }
    this.emit();
  }

  private emit(): void {
    if (!this.disposed) this.onChange(this.snapshot);
  }
}
