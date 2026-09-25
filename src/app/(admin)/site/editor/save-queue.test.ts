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
    expect(queue.snapshot).toEqual({ status: 'pending', version: 0, pending: 2, error: null, errorKind: null });

    clock.fire();
    expect(send).toHaveBeenCalledWith(0, [move('a', 150), move('b', 20)]);
    expect(queue.snapshot.status).toBe('saving');

    replies[0].resolve({ ok: true, version: 1 });
    await settle();
    expect(queue.snapshot).toEqual({ status: 'saved', version: 1, pending: 0, error: null, errorKind: null });
  });

  it('hands on the items the server skipped because they are no longer on the map (review C2)', async () => {
    const clock = manualTimers();
    const onSkipped = vi.fn();
    const send = vi.fn<SaveFn>(async () => ({ ok: true, version: 1, skipped: ['gone'] }));
    const queue = new SaveQueue({ send, version: 0, timers: clock.timers, onChange: () => {}, onSkipped });
    queue.enqueue([move('gone', 100), move('b', 20)]);
    clock.fire();
    await settle();
    expect(onSkipped).toHaveBeenCalledWith(['gone']);
    expect(queue.snapshot).toEqual({ status: 'saved', version: 1, pending: 0, error: null, errorKind: null });

    // A save with nothing skipped says nothing.
    onSkipped.mockClear();
    send.mockResolvedValueOnce({ ok: true, version: 2 });
    queue.enqueue([move('b', 30)]);
    clock.fire();
    await settle();
    expect(onSkipped).not.toHaveBeenCalled();
  });

  /* Review minor: a request that never answered kept the queue "saving"
     forever. Past the limit it is a dropped connection — kept apart and
     resent unchanged on retry, so if it did land, the resend is a conflict. */
  it('treats a save that never answers as a dropped connection, and resends that batch unchanged', async () => {
    const clock = manualTimers();
    const sendClock = manualTimers();
    const replies: Array<ReturnType<typeof deferred>> = [];
    const send = vi.fn<SaveFn>(() => { const reply = deferred(); replies.push(reply); return reply.promise; });
    const queue = new SaveQueue({
      send, version: 0, timers: clock.timers, sendTimeoutMs: 20_000, sendTimers: sendClock.timers, onChange: () => {},
    });
    queue.enqueue([move('a', 100)]);
    clock.fire();
    expect(queue.snapshot.status).toBe('saving');
    expect(sendClock.waitingMs()).toBe(20_000);

    sendClock.fire();
    await settle();
    expect(queue.snapshot).toEqual({ status: 'error', version: 0, pending: 1, error: NETWORK_FAILURE, errorKind: 'network' });
    // The answer that finally comes changes nothing: that request was given up on.
    replies[0].resolve({ ok: true, version: 1 });
    await settle();
    expect(queue.snapshot.status).toBe('error');

    const retried = queue.retry();
    expect(send).toHaveBeenLastCalledWith(0, [move('a', 100)]);
    replies[1].resolve({ ok: true, version: 1 });
    await retried;
    expect(queue.snapshot).toMatchObject({ status: 'saved', version: 1, pending: 0 });
    // An answered save leaves no timer behind.
    expect(sendClock.waitingMs()).toBeNull();
  });

  /* #25 fix round, Important 2: an earlier page's batch waits, apart and
     unsent — even as later edits arrive — until a rebase has checked it. */
  it('holds a carried batch, apart and unsent, until a rebase or a release', async () => {
    const { queue, send, clock } = setup(3);
    queue.carry([{ type: 'add', item: tent('n1') }, { type: 'remove', id: 'n1' }]);
    expect(queue.snapshot).toMatchObject({ status: 'pending', pending: 2 });
    queue.enqueue([move('a', 100)]);
    expect(clock.waitingMs()).toBeNull();
    await queue.flush();
    expect(send).not.toHaveBeenCalled();
    // Never coalesced with each other or with later edits: the add and its removal both stay.
    expect(queue.pendingOps()).toEqual([{ type: 'add', item: tent('n1') }, { type: 'remove', id: 'n1' }, move('a', 100)]);

    queue.release();
    expect(clock.waitingMs()).toBe(500);
    clock.fire();
    expect(send).toHaveBeenLastCalledWith(3, [{ type: 'add', item: tent('n1') }, { type: 'remove', id: 'n1' }]);
  });

  it('lets a rebase end the hold and send what it kept', () => {
    const { queue, send } = setup(3);
    queue.carry([move('a', 100)]);
    queue.rebase(4, [move('a', 100)]);
    expect(send).toHaveBeenLastCalledWith(4, [move('a', 100)]);
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
    expect(queue.snapshot).toEqual({ status: 'saved', version: 6, pending: 0, error: null, errorKind: null });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('stops on a conflict, keeps the unsent changes and reports the server’s version', async () => {
    const { queue, send, replies, clock } = setup(3);
    queue.enqueue([move('a', 100)]);
    clock.fire();
    queue.enqueue([move('b', 20)]);
    replies[0].resolve({ ok: false, reason: 'conflict', version: 9 });
    await settle();

    expect(queue.snapshot).toEqual({ status: 'conflict', version: 9, pending: 2, error: null, errorKind: null });
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
      status: 'error', version: 2, pending: 1,
      error: 'הפריט נעול. אפשר לשחרר את הנעילה ואז לשנות אותו', errorKind: 'refused',
    });

    const retrying = queue.retry();
    expect(send).toHaveBeenLastCalledWith(2, [move('a', 100)]);
    replies[1].resolve({ ok: true, version: 3 });
    await retrying;
    expect(queue.snapshot).toEqual({ status: 'saved', version: 3, pending: 0, error: null, errorKind: null });
  });

  it('says in Hebrew that the save failed when no answer came, and loses nothing', async () => {
    const { queue, send, replies, clock } = setup();
    queue.enqueue([move('a', 100)]);
    clock.fire();
    queue.enqueue([move('b', 7)]);
    replies[0].reject(new TypeError('Failed to fetch'));
    await settle();

    expect(queue.snapshot).toEqual({
      status: 'error', version: 0, pending: 2, error: NETWORK_FAILURE, errorKind: 'network',
    });
    expect(NETWORK_FAILURE).toBe('השמירה נכשלה, אולי אין חיבור. אפשר לנסות שוב.');
    // The failed batch stays apart from what arrived while it was out — never merged.
    expect(queue.pendingOps()).toEqual([move('a', 100), move('b', 7)]);

    void queue.retry();
    // Resent unchanged, alone, against the version it was originally sent with —
    // never combined with 'b', which goes out only once 'a' has an answer.
    expect(send).toHaveBeenLastCalledWith(0, [move('a', 100)]);
  });

  it('keeps a network-failed batch apart from later edits, and sends it first on retry', async () => {
    const { queue, send, replies, clock } = setup(7);
    queue.enqueue([{ type: 'add', item: tent('n1') }]);
    clock.fire();
    expect(send).toHaveBeenLastCalledWith(7, [{ type: 'add', item: tent('n1') }]);
    replies[0].reject(new TypeError('Failed to fetch'));
    await settle();

    // Enqueued only after the network failure is already known.
    queue.enqueue([{ type: 'remove', id: 'n1' }]);
    expect(queue.snapshot).toMatchObject({ status: 'error', pending: 2, errorKind: 'network' });
    // Not coalesced: an add-then-remove of the same id would otherwise cancel to nothing.
    expect(queue.pendingOps()).toEqual([{ type: 'add', item: tent('n1') }, { type: 'remove', id: 'n1' }]);

    void queue.retry();
    // The stranded batch first, unchanged, against its original base version (7) —
    // if the server had actually applied it, this comes back a conflict.
    expect(send).toHaveBeenLastCalledWith(7, [{ type: 'add', item: tent('n1') }]);

    replies[1].resolve({ ok: true, version: 8 });
    await settle();
    // Then, and only then, the later edit — against the version retry returned.
    expect(send).toHaveBeenLastCalledWith(8, [{ type: 'remove', id: 'n1' }]);
    expect(queue.snapshot).toMatchObject({ status: 'saving', version: 8 });

    replies[2].resolve({ ok: true, version: 9 });
    await settle();
    expect(queue.snapshot).toEqual({ status: 'saved', version: 9, pending: 0, error: null, errorKind: null });
  });

  it('drops the unsent changes and adopts the server’s version on reset', async () => {
    const { queue, send, replies, clock } = setup();
    queue.enqueue([move('a', 100)]);
    clock.fire();
    replies[0].resolve({ ok: false, reason: 'conflict', version: 8 });
    await settle();

    queue.reset(8);
    expect(queue.snapshot).toEqual({ status: 'saved', version: 8, pending: 0, error: null, errorKind: null });
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
    expect(queue.snapshot).toEqual({ status: 'saved', version: 9, pending: 0, error: null, errorKind: null });
  });

  it('ignores a reply to a batch that a reset replaced', async () => {
    const { queue, replies, clock } = setup();
    queue.enqueue([move('a', 100)]);
    clock.fire();
    queue.reset(20);
    replies[0].resolve({ ok: true, version: 1 });
    await settle();
    expect(queue.snapshot).toEqual({ status: 'saved', version: 20, pending: 0, error: null, errorKind: null });
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

  it('dispose() while a send is out: the late reply changes nothing and reports nothing', async () => {
    const { queue, send, replies, clock, seen } = setup();
    queue.enqueue([move('a', 100)]);
    clock.fire();
    expect(send).toHaveBeenCalledTimes(1);

    const reports = seen.length;
    queue.dispose();
    replies[0].resolve({ ok: true, version: 1 });
    await settle();

    // Nothing was waiting behind this send, so the late reply starts nothing new.
    expect(send).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(reports);
  });

  it('a flush begun before dispose still sends what waited behind the flight', async () => {
    const { queue, send, replies, seen } = setup(4);
    queue.enqueue([move('a', 100)]);
    const flushing1 = queue.flush();
    await settle();
    expect(send).toHaveBeenCalledTimes(1);

    // Made while the first batch is out.
    queue.enqueue([move('b', 300)]);
    const flushing2 = queue.flush();
    queue.dispose();
    const reports = seen.length;

    replies[0].resolve({ ok: true, version: 5 });
    await settle();
    // 'b' still goes out, against the version the first send returned.
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(5, [move('b', 300)]);
    expect(seen).toHaveLength(reports);

    replies[1].resolve({ ok: true, version: 6 });
    await Promise.all([flushing1, flushing2]);
    // No onChange at any point after dispose, even once everything has drained.
    expect(seen).toHaveLength(reports);
  });

  it('does not double-count an item moved in flight and again in the queue behind it', async () => {
    const { queue, clock } = setup();
    queue.enqueue([move('a', 100)]);
    clock.fire();
    queue.enqueue([move('a', 200)]);

    expect(queue.snapshot.pending).toBe(queue.pendingOps().length);
    expect(queue.pendingOps()).toEqual([move('a', 200)]);
    expect(queue.snapshot.pending).toBe(1);
  });

  it('does not start a second request when an onChange handler enqueues and flushes mid-send', async () => {
    const clock = manualTimers();
    const replies: Array<ReturnType<typeof deferred>> = [];
    const send = vi.fn<SaveFn>(() => {
      const reply = deferred();
      replies.push(reply);
      return reply.promise;
    });
    let reentered = false;
    const queue: SaveQueue = new SaveQueue({
      send, version: 0, timers: clock.timers,
      onChange: (snapshot) => {
        if (snapshot.status === 'saving' && !reentered) {
          reentered = true;
          queue.enqueue([move('b', 9)]);
          void queue.flush();
        }
      },
    });

    queue.enqueue([move('a', 1)]);
    clock.fire();
    await settle();
    // Still only the one request, even though onChange tried to start another mid-send.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(0, [move('a', 1)]);

    replies[0].resolve({ ok: true, version: 1 });
    await settle();
    // The re-entrant enqueue is not lost: it goes out once the first send answers.
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(1, [move('b', 9)]);

    replies[1].resolve({ ok: true, version: 2 });
    await settle();
    expect(queue.snapshot).toEqual({ status: 'saved', version: 2, pending: 0, error: null, errorKind: null });
  });

  it('keeps sending later work after an onChange handler that throws once', async () => {
    const clock = manualTimers();
    const replies: Array<ReturnType<typeof deferred>> = [];
    const send = vi.fn<SaveFn>(() => {
      const reply = deferred();
      replies.push(reply);
      return reply.promise;
    });
    let calls = 0;
    const queue = new SaveQueue({
      send, version: 0, timers: clock.timers,
      onChange: () => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
      },
    });

    queue.enqueue([move('a', 1)]);
    clock.fire();
    replies[0].resolve({ ok: true, version: 1 });
    await settle();
    expect(queue.snapshot).toMatchObject({ status: 'saved', version: 1 });

    queue.enqueue([move('b', 2)]);
    clock.fire();
    expect(send).toHaveBeenLastCalledWith(1, [move('b', 2)]);
  });

  // --- Fix round 2 -----------------------------------------------------

  it('keeps the stranded batch apart even when its resend comes back a conflict', async () => {
    const { queue, send, replies, clock } = setup(7);
    queue.enqueue([{ type: 'add', item: tent('n1') }]);
    clock.fire();
    replies[0].reject(new TypeError('Failed to fetch'));
    await settle();
    queue.enqueue([{ type: 'remove', id: 'n1' }]);

    void queue.retry();
    expect(send).toHaveBeenLastCalledWith(7, [{ type: 'add', item: tent('n1') }]);
    replies[1].resolve({ ok: false, reason: 'conflict', version: 8 });
    await settle();

    // Never merged: an add-then-remove of the same id would otherwise cancel to nothing.
    expect(queue.snapshot).toEqual({ status: 'conflict', version: 8, pending: 2, error: null, errorKind: null });
    expect(queue.pendingOps()).toEqual([
      { type: 'add', item: tent('n1') },
      { type: 'remove', id: 'n1' },
    ]);
  });

  it('keeps the stranded batch apart when its resend is refused, and resends it alone again', async () => {
    const { queue, send, replies, clock } = setup(7);
    queue.enqueue([{ type: 'add', item: tent('n1') }]);
    clock.fire();
    replies[0].reject(new TypeError('Failed to fetch'));
    await settle();
    queue.enqueue([{ type: 'remove', id: 'n1' }]);

    void queue.retry();
    replies[1].resolve({ ok: false, reason: 'refused', error: 'הפג תוקף החיבור' });
    await settle();

    expect(queue.snapshot).toEqual({
      status: 'error', version: 7, pending: 2, error: 'הפג תוקף החיבור', errorKind: 'refused',
    });
    expect(queue.pendingOps()).toEqual([
      { type: 'add', item: tent('n1') },
      { type: 'remove', id: 'n1' },
    ]);

    // A further retry sends the stranded batch alone, first, again.
    void queue.retry();
    expect(send).toHaveBeenLastCalledWith(7, [{ type: 'add', item: tent('n1') }]);
  });

  it('a dispose landing in the gap between a reply and the next send still drains what waited', async () => {
    const { queue, send, replies, seen } = setup(4);
    queue.enqueue([move('a', 100)]);
    const flushing = queue.flush();
    await settle();
    expect(send).toHaveBeenCalledTimes(1);

    queue.enqueue([move('b', 300)]);
    // Registered after sendQueued's own await on the same promise, so it runs
    // after sendQueued has cleared `inFlight` but before flush's loop picks
    // up 'b' — exactly the gap where `inFlight` alone misreads "idle".
    void replies[0].promise.then(() => { queue.dispose(); });
    const reports = seen.length;

    replies[0].resolve({ ok: true, version: 5 });
    await settle();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(5, [move('b', 300)]);
    // One legitimate report — 'a' resolving, registered on the promise before
    // dispose() was — then silence: dispose() lands before 'b' is picked up,
    // so 'b' going out is never reported.
    expect(seen).toHaveLength(reports + 1);

    const afterFirstReply = seen.length;
    replies[1].resolve({ ok: true, version: 6 });
    await flushing;
    expect(seen).toHaveLength(afterFirstReply);
  });

  it('a second dispose() does not undo what the first one decided', async () => {
    const { queue, send, replies, seen } = setup(4);
    queue.enqueue([move('a', 100)]);
    const flushing = queue.flush();
    await settle();

    queue.enqueue([move('b', 300)]);
    queue.dispose();
    // A second dispose, landing in the same gap as the test above — must be a no-op.
    void replies[0].promise.then(() => { queue.dispose(); });
    const reports = seen.length;

    replies[0].resolve({ ok: true, version: 5 });
    await settle();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(5, [move('b', 300)]);
    expect(seen).toHaveLength(reports);

    replies[1].resolve({ ok: true, version: 6 });
    await flushing;
  });

  it('reset() and rebase() do nothing after dispose', async () => {
    const { queue, send, replies, clock } = setup(4);
    queue.enqueue([move('a', 100)]);
    clock.fire();
    expect(send).toHaveBeenCalledTimes(1);

    queue.dispose();
    queue.reset(50);
    queue.rebase(20, [move('k', 1)]);
    await settle();

    // Neither started a new request nor changed the version.
    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.snapshot.version).toBe(4);

    replies[0].resolve({ ok: true, version: 5 });
    await settle();
  });

  it('does not report "saved" while a kept-apart batch is still pending, on retry', async () => {
    const { queue, replies, clock, seen } = setup(2);
    queue.enqueue([{ type: 'add', item: tent('n1') }]);
    clock.fire();
    replies[0].reject(new TypeError('Failed to fetch'));
    await settle();

    const reports = seen.length;
    void queue.retry();
    // The very first report after retry() clears the halt, before the resend
    // has actually gone out, must not claim 'saved' while a batch still is.
    expect(seen[reports]).toEqual({ status: 'pending', version: 2, pending: 1, error: null, errorKind: null });

    replies[1].resolve({ ok: true, version: 3 });
    await settle();
  });
});
