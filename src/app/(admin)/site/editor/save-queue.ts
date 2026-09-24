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
 * front of the line, ahead of anything that arrived while it was out — except
 * a batch whose send itself failed (fix round 1, item 2): the server may or
 * may not have applied it, so it is kept apart from later edits rather than
 * merged with them, and resent unchanged, first, on retry.
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
  /** Ops not yet confirmed saved, the one in flight included; always `pendingOps().length`. */
  pending: number;
  /** Hebrew, for the top bar; null unless the status is 'error'. */
  error: string | null;
  /**
   * 'network' when the send itself failed (no answer came); 'refused' when
   * the server answered with a reason; null otherwise (including 'conflict',
   * which is its own status, not an error).
   */
  errorKind: 'network' | 'refused' | null;
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
  /**
   * The exact ops of a batch whose send rejected, unresolved and untouched —
   * kept apart from `queued` (never coalesced with ops enqueued since) until
   * `retry` resends it, or `reset`/`rebase` discards it.
   */
  private networkFailedBatch: SiteOp[] | null = null;
  private inFlight: SiteOp[] | null = null;
  /** Whether the batch currently in flight came from `networkFailedBatch` (kept apart from `queued` in `pendingOps`). */
  private inFlightIsStranded = false;
  private flight: Promise<void> | null = null;
  private timer: unknown = null;
  private halted: 'error' | 'conflict' | null = null;
  private error: string | null = null;
  private errorKind: 'network' | 'refused' | null = null;
  /** Bumped by `reset` and `rebase`, so a reply to a batch they replaced is ignored. */
  private epoch = 0;
  private disposed = false;
  /** Captured at `dispose`: whether a send was out, so `flush` may finish draining what waited behind it. */
  private drainAfterDispose = false;

  constructor(options: SaveQueueOptions) {
    this.send = options.send;
    this.version = options.version;
    this.delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
    this.onChange = options.onChange;
    this.setTimer = options.timers?.set ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.timers?.clear ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  get snapshot(): QueueSnapshot {
    const pending = this.pendingOps().length;
    let status: SaveStatus = 'saved';
    if (this.halted !== null) status = this.halted;
    else if (this.inFlight !== null) status = 'saving';
    else if (this.queued.length > 0) status = 'pending';
    return {
      status,
      version: this.version,
      pending,
      error: this.halted === 'error' ? this.error : null,
      errorKind: this.halted === 'error' ? this.errorKind : null,
    };
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
   * sending. Resolves when the queue is empty or halted. Safe to call while a
   * send is in flight: it waits for that one first.
   *
   * A call already under way when `dispose` happens keeps draining what
   * waited behind the flight (fix round 1, item 1) — `dispose` only stops the
   * clock and the `onChange` reports, and a fresh call made after `dispose`
   * (nothing was in flight yet) starts nothing new.
   */
  async flush(): Promise<void> {
    this.cancelTimer();
    while (true) {
      if (this.inFlight !== null) {
        // A send is under way — including one just started this same tick,
        // before the promise that started it has been assigned to `flight`
        // (re-entrancy, item 3: an onChange firing mid-send that calls
        // `flush` must not race the assignment below). Wait for it.
        await (this.flight ?? Promise.resolve());
        continue;
      }
      if (this.halted !== null) return;
      if (this.networkFailedBatch === null && this.queued.length === 0) return;
      if (this.disposed && !this.drainAfterDispose) return;
      this.flight = this.sendQueued();
      await this.flight;
    }
  }

  /** After 'error' only. A conflict is not retried: it needs `reset` or `rebase`. */
  async retry(): Promise<void> {
    if (this.disposed || this.halted !== 'error') return;
    this.halted = null;
    this.error = null;
    this.errorKind = null;
    this.emit();
    await this.flush();
  }

  /** 'theirs': drop everything unsent and carry on from the server's version. */
  reset(version: number): void {
    this.epoch += 1;
    this.cancelTimer();
    this.queued = [];
    this.networkFailedBatch = null;
    this.inFlight = null;
    this.inFlightIsStranded = false;
    this.flight = null;
    this.version = version;
    this.halted = null;
    this.error = null;
    this.errorKind = null;
    this.emit();
  }

  /** 'mine': what is still worth sending, against the server's version, now. */
  rebase(version: number, keep: readonly SiteOp[]): void {
    this.epoch += 1;
    this.cancelTimer();
    this.queued = coalesceOps(keep);
    this.networkFailedBatch = null;
    this.inFlight = null;
    this.inFlightIsStranded = false;
    this.flight = null;
    this.version = version;
    this.halted = null;
    this.error = null;
    this.errorKind = null;
    this.emit();
    void this.flush();
  }

  /**
   * Ops not yet confirmed saved, in order. A network-failed batch (kept
   * apart, see `networkFailedBatch`) is never coalesced with `queued` — that
   * would let an add-then-remove of the same id silently cancel out a batch
   * whose fate the server hasn't actually told us.
   */
  pendingOps(): SiteOp[] {
    const stranded = this.networkFailedBatch ?? (this.inFlightIsStranded ? this.inFlight : null);
    if (stranded !== null) return [...stranded, ...coalesceOps(this.queued)];
    return coalesceOps([...(this.inFlight ?? []), ...this.queued]);
  }

  /**
   * Stops the clock and the reports; blocks new enqueues. A `flush` already
   * under way keeps sending what waited behind the flight (see `flush`); a
   * reply to a batch that was in flight is still applied internally (the
   * version it returns still matters to what `flush` sends next) but is
   * never reported — `emit` is a no-op once disposed.
   */
  dispose(): void {
    this.drainAfterDispose = this.inFlight !== null;
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
    const stranded = this.networkFailedBatch;
    const batch = stranded ?? this.queued;
    if (stranded !== null) this.networkFailedBatch = null;
    else this.queued = [];
    // The in-flight marker is set — and reflected in `pendingOps`/`snapshot`
    // — before `emit` fires 'saving' (item 3), so a re-entrant `enqueue` +
    // `flush` from inside `onChange` sees a send already under way and waits
    // rather than starting a second one.
    this.inFlight = batch;
    this.inFlightIsStranded = stranded !== null;
    this.emit();

    let result: SaveResult | null = null;
    try {
      result = await this.send(this.version, batch);
    } catch {
      result = null;
    }
    if (epoch !== this.epoch) return;

    this.inFlight = null;
    this.inFlightIsStranded = false;
    this.flight = null;
    if (result !== null && result.ok) {
      this.version = result.version;
      this.halted = null;
      this.error = null;
      this.errorKind = null;
    } else {
      this.cancelTimer();
      if (result === null) {
        // The send itself failed: the server may or may not have applied
        // this batch. Keep it apart from ops enqueued since — never coalesced
        // with them — so it goes back out unchanged, against the version it
        // was already sent with; if the server did apply it, that resend
        // comes back a conflict, a visible decision rather than a guess.
        this.networkFailedBatch = batch;
        this.halted = 'error';
        this.errorKind = 'network';
        this.error = NETWORK_FAILURE;
      } else if (result.reason === 'conflict') {
        // The server named the batch: nothing was applied. Safe to fold back
        // in, ahead of anything that arrived meanwhile.
        this.queued = coalesceOps([...batch, ...this.queued]);
        this.halted = 'conflict';
        this.errorKind = null;
        this.version = result.version;
      } else {
        this.queued = coalesceOps([...batch, ...this.queued]);
        this.halted = 'error';
        this.errorKind = 'refused';
        this.error = result.error;
      }
    }
    this.emit();
  }

  private emit(): void {
    if (this.disposed) return;
    try {
      this.onChange(this.snapshot);
    } catch {
      // A misbehaving subscriber must not corrupt the queue's own state
      // machine (item 3) — the queue still sends later work.
    }
  }
}
