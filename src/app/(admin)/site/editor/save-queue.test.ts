import { describe, it, expect, vi } from 'vitest';
import type { EditorItem } from '@/lib/site/editor/model';
import type { SaveResult, SiteOp } from '@/lib/site/editor/ops';
import { NETWORK_FAILURE, SaveQueue, type QueueSnapshot, type SaveFn } from './save-queue';

/** A clock the test turns by hand: one pending callback at a time, like a debounce. */
function manualTimers() {
  let next: { fn: () => void; ms: number } | null = null;
  return {
    timers: {
      set: (fn: () => void, ms: number) => { next = { fn, ms }; return next; },
      clear: (handle: unknown) => { if (handle === next) next = null; },
    },
    waitingMs: () => next?.ms ?? null,
    fire: () => { const due = next; next = null; due?.fn(); },
  };
}

/** A save the test answers when it chooses. */
function deferred() {
  let resolve!: (value: SaveResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<SaveResult>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

/** Lets every promise that can settle, settle. */
const settle = () => new Promise<void>((done) => { setTimeout(done, 0); });

const move = (id: string, xCm: number): SiteOp => ({ type: 'update', id, patch: { xCm } });

function tent(id: string): EditorItem {
  return {
    id, kind: 'tent', label: 'אוהל 1', xCm: 0, yCm: 0, widthCm: 300, depthCm: 300,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false,
  };
}

function setup(version = 0) {
  const clock = manualTimers();
  const replies: Array<ReturnType<typeof deferred>> = [];
  const send = vi.fn<SaveFn>(() => {
    const reply = deferred();
    replies.push(reply);
    return reply.promise;
  });
  const seen: QueueSnapshot[] = [];
  const queue = new SaveQueue({ send, version, timers: clock.timers, onChange: (s) => { seen.push(s); } });
  return { queue, send, replies, clock, seen };
}

describe('the save queue', () => {
  it('waits half a second after the last change, then sends the changes as one batch', async () => {
    const { queue, send, replies, clock } = setup();
    queue.enqueue([move('a', 100)]);
    queue.enqueue([move('a', 150), move('b', 20)]);

    expect(clock.waitingMs()).toBe(500);
    expect(send).not.toHaveBeenCalled();
    expect(queue.snapshot).toEqual({ status: 'pending', version: 0, pending: 2, error: null });

    clock.fire();
    expect(send).toHaveBeenCalledWith(0, [move('a', 150), move('b', 20)]);
    expect(queue.snapshot.status).toBe('saving');

    replies[0].resolve({ ok: true, version: 1 });
    await settle();
    expect(queue.snapshot).toEqual({ status: 'saved', version: 1, pending: 0, error: null });
  });

  it('sends nothing for an item added and removed before the save', () => {
    const { queue, send, clock } = setup();
    queue.enqueue([{ type: 'add', item: tent('n1') }]);
    queue.enqueue([{ type: 'remove', id: 'n1' }]);
    expect(queue.snapshot).toMatchObject({ status: 'saved', pending: 0 });
    clock.fire();
    expect(send).not.toHaveBeenCalled();
  });

  it('queues behind an in-flight save', async () => {
    const { queue, send, replies, clock } = setup(4);
    queue.enqueue([move('a', 100)]);
    clock.fire();
    expect(send).toHaveBeenCalledTimes(1);

    // Made while the first batch is out: it must wait, however it is asked to go.
    queue.enqueue([move('b', 300)]);
    expect(queue.snapshot).toMatchObject({ status: 'saving', pending: 2 });
    clock.fire();
    const flushing = queue.flush();
    await settle();
    expect(send).toHaveBeenCalledTimes(1);

    replies[0].resolve({ ok: true, version: 5 });
    await settle();
    expect(send).toHaveBeenCalledTimes(2);
    // Against the version the first save returned, never the stale 4, and in order.
    expect(send.mock.calls[1]).toEqual([5, [move('b', 300)]]);

    replies[1].resolve({ ok: true, version: 6 });
    await flushing;
    expect(queue.snapshot).toEqual({ status: 'saved', version: 6, pending: 0, error: null });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('stops on a conflict, keeps the unsent changes and reports the server’s version', async () => {
    const { queue, send, replies, clock } = setup(3);
    queue.enqueue([move('a', 100)]);
    clock.fire();
    queue.enqueue([move('b', 20)]);
    replies[0].resolve({ ok: false, reason: 'conflict', version: 9 });
    await settle();

    expect(queue.snapshot).toEqual({ status: 'conflict', version: 9, pending: 2, error: null });
    expect(queue.pendingOps()).toEqual([move('a', 100), move('b', 20)]);

    // Nothing more goes out until the lead decides.
    queue.enqueue([move('c', 5)]);
    expect(clock.waitingMs()).toBeNull();
    await queue.retry();
    await queue.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('stops on a refusal and shows the server’s Hebrew reason, then retries on request', async () => {
    const { queue, send, replies, clock } = setup(2);
    queue.enqueue([move('a', 100)]);
    clock.fire();
    replies[0].resolve({ ok: false, reason: 'refused', error: 'הפריט נעול. אפשר לשחרר את הנעילה ואז לשנות אותו' });
    await settle();

    expect(queue.snapshot).toEqual({
      status: 'error', version: 2, pending: 1, error: 'הפריט נעול. אפשר לשחרר את הנעילה ואז לשנות אותו',
    });

    const retrying = queue.retry();
    expect(send).toHaveBeenLastCalledWith(2, [move('a', 100)]);
    replies[1].resolve({ ok: true, version: 3 });
    await retrying;
    expect(queue.snapshot).toEqual({ status: 'saved', version: 3, pending: 0, error: null });
  });

  it('says in Hebrew that the save failed when no answer came, and loses nothing', async () => {
    const { queue, send, replies, clock } = setup();
    queue.enqueue([move('a', 100)]);
    clock.fire();
    queue.enqueue([move('b', 7)]);
    replies[0].reject(new TypeError('Failed to fetch'));
    await settle();

    expect(queue.snapshot).toEqual({ status: 'error', version: 0, pending: 2, error: NETWORK_FAILURE });
    expect(NETWORK_FAILURE).toBe('השמירה נכשלה, אולי אין חיבור. אפשר לנסות שוב.');
    // The failed batch stays ahead of what arrived while it was out.
    expect(queue.pendingOps()).toEqual([move('a', 100), move('b', 7)]);

    void queue.retry();
    expect(send).toHaveBeenLastCalledWith(0, [move('a', 100), move('b', 7)]);
  });

  it('drops the unsent changes and adopts the server’s version on reset', async () => {
    const { queue, send, replies, clock } = setup();
    queue.enqueue([move('a', 100)]);
    clock.fire();
    replies[0].resolve({ ok: false, reason: 'conflict', version: 8 });
    await settle();

    queue.reset(8);
    expect(queue.snapshot).toEqual({ status: 'saved', version: 8, pending: 0, error: null });
    queue.enqueue([move('z', 1)]);
    clock.fire();
    expect(send).toHaveBeenLastCalledWith(8, [move('z', 1)]);
  });

  it('resends what is kept against the new version at once on rebase', async () => {
    const { queue, send, replies, clock } = setup();
    queue.enqueue([move('a', 100), move('gone', 5)]);
    clock.fire();
    replies[0].resolve({ ok: false, reason: 'conflict', version: 8 });
    await settle();

    queue.rebase(8, [move('a', 100)]);
    expect(send).toHaveBeenLastCalledWith(8, [move('a', 100)]);
    expect(queue.snapshot.status).toBe('saving');
    replies[1].resolve({ ok: true, version: 9 });
    await settle();
    expect(queue.snapshot).toEqual({ status: 'saved', version: 9, pending: 0, error: null });
  });

  it('ignores a reply to a batch that a reset replaced', async () => {
    const { queue, replies, clock } = setup();
    queue.enqueue([move('a', 100)]);
    clock.fire();
    queue.reset(20);
    replies[0].resolve({ ok: true, version: 1 });
    await settle();
    expect(queue.snapshot).toEqual({ status: 'saved', version: 20, pending: 0, error: null });
  });

  it('reports every change of state', async () => {
    const { queue, replies, clock, seen } = setup();
    queue.enqueue([move('a', 100)]);
    clock.fire();
    replies[0].resolve({ ok: true, version: 1 });
    await settle();
    expect(seen.map((s) => s.status)).toEqual(['pending', 'saving', 'saved']);
  });

  it('cancels the clock and goes quiet when disposed', async () => {
    const { queue, send, clock, seen } = setup();
    queue.enqueue([move('a', 100)]);
    const reports = seen.length;
    queue.dispose();
    expect(clock.waitingMs()).toBeNull();
    queue.enqueue([move('a', 200)]);
    await queue.flush();
    expect(send).not.toHaveBeenCalled();
    expect(seen).toHaveLength(reports);
  });
});
