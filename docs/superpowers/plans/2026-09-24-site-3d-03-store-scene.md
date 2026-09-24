# מפת הקאמפ in 3D — Plan 03: store and scene

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The editor's store and its background save, the `three` adapter (meshes, scene sync, camera rig, picking, gestures), and `SceneView` with its labels — mounted at `/site?editor=3d` and checked in a browser.

**Architecture:** `save-queue.ts` (no React) sends coalesced ops one batch at a time against the version the last batch returned; `use-editor-store.ts` applies every edit at once and hands it to the queue. Under `editor/scene/`, pure-ish adapter modules turn the store's doc into `three` objects by id (`scene-sync.ts`), apply the pure camera maths to a real camera (`camera-rig.ts`), pick by raycasting (`picking.ts`) and turn pointer events into intents (`gestures.ts`). `engine.ts` holds everything imperative — renderer, frames, previews, overlay marks, label layout — and `scene-view.tsx` is the thin React shell around it. A temporary `scene-preview.tsx` mounts it behind `?editor=3d` until Task 26.

**Tech Stack:** Next.js 16.3.4, React 19.2.8, TypeScript, `three@0.186.1`, vitest 5 + Testing Library + jsdom, CSS Modules on `src/app/tokens.css`.

**Spec:** `docs/superpowers/specs/2026-09-24-site-map-3d-editor-design.md` (§4, §6.3–6.4, §7, §8, §9, §11, §17). **Overview, order, Review Focus and the binding interface contract:** `2026-09-24-site-3d-00-overview.md`. **Consumes** plan 01 (`EditorDoc`, `SiteOp`, `SaveResult`, `saveSiteChangesAction`, `loadSiteDocAction`, `loadDoc`, `itemHeight`, `effectiveSize`, `SITE_KINDS[kind].shape/plural`) and plan 02 (`applyOps`, `invertOps`, `coalesceOps`, history, `snapMove`, `snapResize`, `moveOps`, `setRectOps`, the camera maths, `layoutLabels`, the sun) by exactly the contract's names.

## Global Constraints

- Integer centimetres in every stored length; x east, y south, z up; the map **never mirrors for RTL**. In `three`, a map point (x, y, z) cm is `(x, z, y) · 0.01` m (`worldOf`): east +X, up +Y, south +Z.
- **`three` is imported only under `src/app/(admin)/site/editor/scene/`** — here `meshes.ts`, `scene-sync.ts`, `camera-rig.ts`, `picking.ts`, `engine.ts` and the scene tests; `scene-view.tsx` reaches it through `engine.ts`. Nothing outside `scene/` imports it: `scene-preview.tsx` loads `SceneView` only through `next/dynamic` and imports its types with `import type`. The guard test from Task 1 (`editor/three-guard.test.ts`) enforces this; Tasks 17–20 run it.
- Use only long-stable `three` APIs (Scene, Group, Mesh, BoxGeometry, CylinderGeometry, PlaneGeometry, BufferGeometry + Float32BufferAttribute, EdgesGeometry, LineSegments, LineBasicMaterial, LineDashedMaterial, MeshLambertMaterial, MeshBasicMaterial, HemisphereLight, DirectionalLight, PerspectiveCamera, OrthographicCamera, Raycaster, Matrix4, Vector2/3, Color, WebGLRenderer). Leave `renderer.shadowMap.type` at its default: r186 removed `PCFSoftShadowMap` and warns on it.
- **Hebrew only on screen, gender-neutral.** No English string reaches a rendered element; the server's refusals arrive already in Hebrew (`siteFailureMessage`).
- Colours: DOM layers take theirs from `tokens.css` custom properties (`scene/scene.module.css`); the WebGL colours are scoped data in `scene/palette.ts`.
- **This repo lints with `eslint-plugin-react-hooks` 7's compiler rules as errors** — among them `react-hooks/set-state-in-effect` (no synchronous `setState` in an effect body) and `react-hooks/refs` (no reading or writing `ref.current` during render). The code below keeps refs to effects, callbacks and ref callbacks; keep it that way.
- Work in `/Users/yarin/GitProjects/Shliff_Platform-lanes/site-3d` on `feat/site-map-3d`. Stage by path; never `git add -A`. Use `/usr/bin/git log`.
- Test command (unique output file every time; quote paths with parentheses):
  `npx vitest run <paths> --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
  A non-zero exit with zero failures means workers died, not green. Run only your task's paths.
- Typecheck `npx tsc --noEmit`; lint `rtk proxy npx eslint <paths>` (the RTK hook mangles bare `npx eslint`).
- Read files with the Read tool, not `cat`.

## Additions this plan makes to the contract

All additive and inside plan 03's files; the contract's names and signatures are implemented exactly.

- `save-queue.ts`: `NETWORK_FAILURE` (the contract's Hebrew sentence). `snapshot.version` after a conflict is the server's version; `retry()` does nothing in `'conflict'` — only `reset` or `rebase` leave it.
- `use-editor-store.ts`: `conflict` is derived from `save.status === 'conflict'`. `resolveConflict('theirs')` is also the reload a refused batch offers. The `beforeunload` guard is on while `save.pending > 0` (spec §6.3 "while anything is unsent" — pending, saving, refused or in conflict).
- `scene/palette.ts`: the palette type `ScenePalette` adds `ember` and `contact`; `SCENE_ALPHA` (cloth and contact opacity) and `SCENE_LIGHT` (light colours).
- `scene/meshes.ts`: `ItemLook.sun?` hides the drawn shade and contact patches when real shadows are on; `userData` also carries `kind` and `group`; parts are tagged `userData.part`, and parts a click passes through carry `userData.pick === false`.
- `scene/scene-sync.ts`: `SyncInput.sun?`. Hidden groups and hidden nets are removed and freed, not made invisible, so picking never sees them.
- `scene/gestures.ts`: `Gestures.active` (a drag is under way). Double-click and the wheel are handled by the engine, not the machine; the library's drag reaches the scene through `SceneHandle.groundAtClient` and `setGhost` (plan 04). A label click selects; a drag that starts on a label pans. Only the hit item's lock is known to the machine; other locked items in a moving selection are skipped by `moveOps`.
- `scene/scene-view.tsx`: `NO_WEBGL`. The imperative work lives in two new files, `scene/engine.ts` (`SceneEngine`, `LOCKED_NOTICE`, `CONTEXT_LOST_NOTICE`) and `scene/overlay.ts` (`OverlayLayer`). `setGhost`'s `xCm`, `yCm` are the new item's north-west corner, like `addOps`'s `at`.
- No-WebGL: `SceneView` shows the Hebrew notice alone; the item table under it (spec §7) is `site-editor.tsx`'s, in plan 04.

---

### Task 15: `save-queue.ts`

**Files:**
- Create: `src/app/(admin)/site/editor/save-queue.ts`
- Create: `src/app/(admin)/site/editor/save-queue.test.ts`

**Interfaces:**
- Consumes: `coalesceOps`, `SiteOp`, `SaveResult` (`@/lib/site/editor/ops`, Tasks 5 and 9).
- Produces: `SaveFn`, `SaveStatus`, `QueueSnapshot`, `SaveQueueOptions`, `SaveQueue` exactly as the contract lists them, and `NETWORK_FAILURE`.

- [ ] **Step 1: Write the failing test**

Create `src/app/(admin)/site/editor/save-queue.test.ts`. Review Focus #1 is the test named "queues behind an in-flight save": the second batch must not go out while the first is in flight — however it is asked to — and must go out against the version the first returned. The clock is injected (`timers`), so the test turns it by hand and never races a real timer.

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run "src/app/(admin)/site/editor/save-queue.test.ts" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — `./save-queue` cannot be resolved (`Failed to resolve import` or `Cannot find module`); no tests run.

- [ ] **Step 3: Implement**

Create `src/app/(admin)/site/editor/save-queue.ts`:

```ts
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
```

- [ ] **Step 4: Run the test**

Run the Step 2 command. Expected: 11 passed, exit 0.

Then prove the Review Focus test can fail (a test that cannot fail proves nothing): in `flush()`, temporarily delete the four-line `if (this.flight !== null) { await this.flight; continue; }` block at the top of the loop and re-run. Expected: 1 failed, 10 passed — "queues behind an in-flight save" (`send` called a second time while the first batch is still out). Restore the block and re-run: 11 passed.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npx eslint "src/app/(admin)/site/editor/save-queue.ts" "src/app/(admin)/site/editor/save-queue.test.ts"` — expected no problems.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(admin)/site/editor/save-queue.ts" "src/app/(admin)/site/editor/save-queue.test.ts"
git commit -m "feat(site): the editor's save queue — one batch at a time, each against the version the last one returned

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: `use-editor-store.ts`

**Files:**
- Create: `src/app/(admin)/site/editor/use-editor-store.ts`
- Create: `src/app/(admin)/site/editor/use-editor-store.test.ts`

**Interfaces:**
- Consumes: `SaveQueue`, `QueueSnapshot`, `SaveFn` (Task 15); `applyOps`, `invertOps`, `SiteOp` (Task 9); `EMPTY_HISTORY`, `record`, `undo`, `redo`, `History` (Task 11); `findItem`, `EditorDoc` (Task 5); `derive`, `toPlaced` (`derive.ts`); `overlapPairs` (`geometry.ts`); `ActionResult` (`@/lib/action-result`).
- Produces: `EditorFlags`, `EditorStoreInit`, `EditorStore`, `useEditorStore` exactly as the contract lists them.

Behaviour the test pins down:
- `run` applies the ops that apply (one at a time; an op on a missing item is skipped, never thrown), records `{ label, ops, inverse }` with `invertOps` computed against the doc before the edit, and enqueues the applied ops. Nothing applied: nothing recorded, nothing sent.
- `undo` / `redo` apply the entry's ops the same way, enqueue them like any edit, and return the label. Ops naming an item that is gone (the other lead removed it and this lead reloaded) are skipped and a Hebrew notice says so (Review Focus #3, at the store's level).
- Conflict: `conflict` is `{ version }` while the queue says `'conflict'`. `resolveConflict` calls `init.load()`. `'theirs'`: doc := server doc, `queue.reset(version)`. `'mine'`: keep the pending ops whose item exists in the server doc (an add is kept unless its id exists there), doc := `applyOps(serverDoc, kept).doc`, `queue.rebase(version, kept)`, and the notice names the dropped items by the labels this lead knew. A failed load leaves the conflict and shows the Hebrew error.
- `beforeunload` is prevented while `save.pending > 0`; `visibilitychange` to hidden and `pagehide` flush at once.

- [ ] **Step 1: Write the failing test**

Create `src/app/(admin)/site/editor/use-editor-store.test.ts` (jsdom, like `page.test.tsx`; only `setTimeout`/`clearTimeout` are faked, so React's own scheduling is untouched):

```ts
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import type { SaveResult, SiteOp } from '@/lib/site/editor/ops';
import { useEditorStore, type EditorStoreInit } from './use-editor-store';

const A = '0b9f6a8e-1c2d-4e3f-8a9b-0c1d2e3f4a5b';
const B = '1c0a7b9f-2d3e-4f50-9b0c-1d2e3f4a5b6c';
const C = '2d1b8c0a-3e4f-4061-8c1d-2e3f4a5b6c7d';

function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 100, yCm: 100, widthCm: 300, depthCm: 300,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

function doc(items: EditorItem[]): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, defaults: {} };
}

const moveTo = (id: string, xCm: number): SiteOp => ({ type: 'update', id, patch: { xCm } });

/** Advances the fake clock past the queue's half second, inside act. */
async function waitForSave() {
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
}

function setup(over: Partial<EditorStoreInit> = {}) {
  const save = vi.fn<EditorStoreInit['save']>(async (base) => ({ ok: true, version: base + 1 }));
  const load = vi.fn<EditorStoreInit['load']>();
  const init: EditorStoreInit = {
    doc: doc([item({ id: A, label: 'אוהל 1' }), item({ id: B, label: 'אוהל 2', xCm: 600 })]),
    version: 0, save, load, ...over,
  };
  const hook = renderHook(() => useEditorStore(init));
  return { ...hook, save: (over.save ?? save) as typeof save, load: (over.load ?? load) as typeof load };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the editor store', () => {
  it('shows an edit at once and saves it in the background', async () => {
    const { result, save } = setup();

    act(() => { result.current.run('הזזה', [moveTo(A, 400)], [A]); });

    expect(result.current.doc.items[0].xCm).toBe(400);
    expect(result.current.selection).toEqual([A]);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.save.status).toBe('pending');
    expect(save).not.toHaveBeenCalled();

    await waitForSave();
    expect(save).toHaveBeenCalledWith(0, [moveTo(A, 400)]);
    expect(result.current.save).toEqual({ status: 'saved', version: 1, pending: 0, error: null });
  });

  it('undoes and redoes, naming the step, and saves each like any edit', async () => {
    const { result, save } = setup();
    act(() => { result.current.run('הזזה', [moveTo(A, 400)]); });

    let label: string | null = null;
    act(() => { label = result.current.undo(); });
    expect(label).toBe('הזזה');
    expect(result.current.doc.items[0].xCm).toBe(100);
    expect(result.current.canRedo).toBe(true);

    act(() => { label = result.current.redo(); });
    expect(label).toBe('הזזה');
    expect(result.current.doc.items[0].xCm).toBe(400);

    await waitForSave();
    // Three edits inside the half second go out as one coalesced batch.
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(0, [moveTo(A, 400)]);
    act(() => { expect(result.current.redo()).toBeNull(); });
  });

  it('flags what is outside the fence, what overlaps and what is half under a net', () => {
    const { result } = setup({
      doc: doc([
        item({ id: A, xCm: 2500 }),
        item({ id: B, xCm: 1000, yCm: 1000 }),
        item({ id: C, xCm: 1100, yCm: 1100, kind: 'sofa', widthCm: 200, depthCm: 90 }),
        item({ id: 'net', kind: 'shade', label: 'רשת צל 1', xCm: 0, yCm: 1100, widthCm: 1150, depthCm: 800, insetCm: 50 }),
      ]),
    });
    const { flags } = result.current;
    expect([...flags.outside]).toEqual([A]);
    expect([...flags.overlapping].sort()).toEqual([B, C].sort());
    expect(flags.pairs).toEqual([[B, C]]);
    expect(flags.partly.has(C)).toBe(true);
  });

  it('selects only what exists, and forgets an item once it is removed', () => {
    const { result } = setup();
    act(() => { result.current.select([A, 'nobody', A]); });
    expect(result.current.selection).toEqual([A]);
    act(() => { result.current.run('הסרה', [{ type: 'remove', id: A }]); });
    expect(result.current.selection).toEqual([]);
  });

  it('records nothing and sends nothing for an edit that changes nothing', async () => {
    const { result, save } = setup();
    act(() => { result.current.run('הזזה', [moveTo('nobody', 5)]); });
    expect(result.current.canUndo).toBe(false);
    await waitForSave();
    expect(save).not.toHaveBeenCalled();
  });

  it('says in Hebrew why the server refused, and retries on request', async () => {
    const save = vi.fn<EditorStoreInit['save']>()
      .mockResolvedValueOnce({ ok: false, reason: 'refused', error: 'הפריט נעול. אפשר לשחרר את הנעילה ואז לשנות אותו' })
      .mockResolvedValueOnce({ ok: true, version: 1 });
    const { result } = setup({ save });
    act(() => { result.current.run('הזזה', [moveTo(A, 400)]); });
    await waitForSave();

    expect(result.current.save).toMatchObject({ status: 'error', error: 'הפריט נעול. אפשר לשחרר את הנעילה ואז לשנות אותו' });
    await act(async () => { result.current.retrySave(); await vi.advanceTimersByTimeAsync(0); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.save.status).toBe('saved');
  });

  describe('when another lead saved first', () => {
    const conflicting = () => vi.fn<EditorStoreInit['save']>(async (base): Promise<SaveResult> => (
      base === 0 ? { ok: false, reason: 'conflict', version: 5 } : { ok: true, version: base + 1 }
    ));

    it('shows the conflict and sends nothing more', async () => {
      const save = conflicting();
      const { result } = setup({ save });
      act(() => { result.current.run('הזזה', [moveTo(A, 400)]); });
      await waitForSave();
      expect(result.current.conflict).toEqual({ version: 5 });

      act(() => { result.current.run('הזזה', [moveTo(B, 900)]); });
      await waitForSave();
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('takes their map and drops the unsent changes', async () => {
      const save = conflicting();
      const theirs = doc([item({ id: A, label: 'אוהל 1', xCm: 1500 })]);
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: true, value: { doc: theirs, version: 5 } }));
      const { result } = setup({ save, load });
      act(() => { result.current.run('הזזה', [moveTo(A, 400)], [B]); });
      await waitForSave();

      await act(async () => { await result.current.resolveConflict('theirs'); });

      expect(load).toHaveBeenCalledTimes(1);
      expect(result.current.doc).toEqual(theirs);
      expect(result.current.conflict).toBeNull();
      expect(result.current.selection).toEqual([]);
      expect(result.current.save).toEqual({ status: 'saved', version: 5, pending: 0, error: null });

      act(() => { result.current.run('הזזה', [moveTo(A, 1600)]); });
      await waitForSave();
      expect(save).toHaveBeenLastCalledWith(5, [moveTo(A, 1600)]);
    });

    it('keeps my changes on top of theirs, and names the items they removed', async () => {
      const save = conflicting();
      // The other lead removed אוהל 2 and added a caravan.
      const theirs = doc([
        item({ id: A, label: 'אוהל 1', yCm: 700 }),
        item({ id: C, kind: 'caravan', label: 'קראוון 1', xCm: 1500, widthCm: 700, depthCm: 250 }),
      ]);
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: true, value: { doc: theirs, version: 5 } }));
      const fresh = item({ id: '3e2c9d1b-4f50-4172-9d2e-3f4a5b6c7d8e', label: 'אוהל 3', xCm: 2000 });
      const { result } = setup({ save, load });
      act(() => {
        result.current.run('הזזה', [moveTo(A, 400), moveTo(B, 900)]);
        result.current.run('הוספה', [{ type: 'add', item: fresh }]);
      });
      await waitForSave();
      expect(result.current.conflict).toEqual({ version: 5 });

      await act(async () => { await result.current.resolveConflict('mine'); });

      expect(save).toHaveBeenLastCalledWith(5, [moveTo(A, 400), { type: 'add', item: fresh }]);
      expect(result.current.doc.items.map((entry) => [entry.id, entry.xCm, entry.yCm])).toEqual([
        [A, 400, 700], [C, 1500, 100], [fresh.id, 2000, 100],
      ]);
      expect(result.current.notice).toBe('לא נשמרו שינויים בפריטים שכבר לא במפה: אוהל 2.');
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(result.current.save).toEqual({ status: 'saved', version: 6, pending: 0, error: null });

      act(() => { result.current.dismissNotice(); });
      expect(result.current.notice).toBeNull();
    });

    it('undoes an edit to an item the other lead removed without breaking, and says so', async () => {
      const save = conflicting();
      const theirs = doc([item({ id: A, label: 'אוהל 1' })]);
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: true, value: { doc: theirs, version: 5 } }));
      const { result } = setup({ save, load });
      act(() => { result.current.run('הזזה', [moveTo(B, 900)]); });
      await waitForSave();
      await act(async () => { await result.current.resolveConflict('theirs'); });

      act(() => { expect(result.current.undo()).toBe('הזזה'); });
      expect(result.current.doc).toEqual(theirs);
      expect(result.current.notice).toBe('חלק מהפעולה לא בוצע, כי פריטים שהיא נוגעת בהם כבר לא במפה.');
    });

    it('reports a failed reload in Hebrew and stays in the conflict', async () => {
      const save = conflicting();
      const load = vi.fn<EditorStoreInit['load']>(async () => ({ ok: false, error: 'אין הרשאה' }));
      const { result } = setup({ save, load });
      act(() => { result.current.run('הזזה', [moveTo(A, 400)]); });
      await waitForSave();
      await act(async () => { await result.current.resolveConflict('mine'); });
      expect(result.current.notice).toBe('אין הרשאה');
      expect(result.current.conflict).toEqual({ version: 5 });
    });
  });

  it('warns before the tab closes while a change is unsent', async () => {
    const { result } = setup();
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);
    act(() => { result.current.run('הזזה', [moveTo(A, 400)]); });
    expect(leave()).toBe(true);
    await waitForSave();
    expect(leave()).toBe(false);
  });

  it('sends at once when the tab is hidden or the page goes away', async () => {
    const { result, save } = setup();
    act(() => { result.current.run('הזזה', [moveTo(A, 400)]); });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(save).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

    act(() => { result.current.run('הזזה', [moveTo(B, 900)]); });
    await act(async () => { window.dispatchEvent(new Event('pagehide')); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(1, [moveTo(B, 900)]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run "src/app/(admin)/site/editor/use-editor-store.test.ts" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — `./use-editor-store` cannot be resolved; no tests run.

- [ ] **Step 3: Implement**

Create `src/app/(admin)/site/editor/use-editor-store.ts`. Two things are deliberate and should survive review: the first `init` is frozen with `useState(init)` (the page loads once, spec §6.1), and the queue is created in an effect whose cleanup flushes and disposes it — so React's development double-mount builds a second queue rather than reusing a disposed one.

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActionResult } from '@/lib/action-result';
import { derive, toPlaced } from '@/lib/site/derive';
import { overlapPairs } from '@/lib/site/geometry';
import { EMPTY_HISTORY, record, redo as redoStep, undo as undoStep, type History } from '@/lib/site/editor/history';
import { findItem, type EditorDoc } from '@/lib/site/editor/model';
import { applyOps, invertOps, type SiteOp } from '@/lib/site/editor/ops';
import { SaveQueue, type QueueSnapshot, type SaveFn } from './save-queue';

/**
 * The editor's single source of truth once the page has loaded (spec §6.1).
 * Every edit is applied here first — the screen changes the moment the lead
 * lets go — and then handed to the save queue, which gets it to the server
 * in the background. There is no `router.refresh()` anywhere in this path:
 * reloading rows mid-edit is what made the old board jump.
 */

export interface EditorFlags {
  outside: Set<string>;
  overlapping: Set<string>;
  /** Touching a net but not inside what it shades — the sofa in the sag strip. */
  partly: Set<string>;
  pairs: Array<[string, string]>;
}

export interface EditorStoreInit {
  doc: EditorDoc;
  version: number;
  selection?: string[];
  save: SaveFn;
  load: () => Promise<ActionResult<{ doc: EditorDoc; version: number }>>;
}

export interface EditorStore {
  doc: EditorDoc;
  selection: string[];
  flags: EditorFlags;
  canUndo: boolean;
  canRedo: boolean;
  save: QueueSnapshot;
  conflict: { version: number } | null;
  notice: string | null;
  run(label: string, ops: SiteOp[], selection?: string[]): void;
  undo(): string | null;
  redo(): string | null;
  select(ids: string[]): void;
  resolveConflict(choice: 'theirs' | 'mine'): Promise<void>;
  retrySave(): void;
  dismissNotice(): void;
}

interface StoreState {
  doc: EditorDoc;
  selection: string[];
  history: History;
  notice: string | null;
}

/** When the map could not be read back after a conflict and the server said nothing usable. */
const LOAD_FAILED = 'לא הצלחנו לטעון את המפה העדכנית. אפשר לנסות שוב.';
/** When an undo or redo names items the map no longer has (Review Focus #3). */
const PARTLY_APPLIED = 'חלק מהפעולה לא בוצע, כי פריטים שהיא נוגעת בהם כבר לא במפה.';

/** Only ids the map still has, each once, in the order given. */
function existing(doc: EditorDoc, ids: readonly string[]): string[] {
  const present = new Set(doc.items.map((item) => item.id));
  return [...new Set(ids)].filter((id) => present.has(id));
}

/**
 * Applies what can be applied, one op at a time, and returns which ops
 * landed. An op naming an item that is gone is skipped, never thrown.
 */
function applyEach(doc: EditorDoc, ops: readonly SiteOp[]): { doc: EditorDoc; applied: SiteOp[]; skipped: number } {
  let next = doc;
  const applied: SiteOp[] = [];
  let skipped = 0;
  for (const op of ops) {
    const result = applyOps(next, [op]);
    if (result.skipped.length > 0) {
      skipped += 1;
      continue;
    }
    next = result.doc;
    applied.push(op);
  }
  return { doc: next, applied, skipped };
}

/** The item an op is about, for naming what a conflict dropped. */
function targetOf(op: SiteOp): string | null {
  if (op.type === 'add') return op.item.id;
  if (op.type === 'update' || op.type === 'remove') return op.id;
  return null;
}

function computeFlags(doc: EditorDoc): EditorFlags {
  const derived = derive(doc.plot, doc.items);
  const flags: EditorFlags = { outside: new Set(), overlapping: new Set(), partly: new Set(), pairs: [] };
  for (const item of derived.items) {
    if (item.outside) flags.outside.add(item.id);
    if (item.overlapping) flags.overlapping.add(item.id);
    if (item.shade === 'partly') flags.partly.add(item.id);
  }
  flags.pairs = overlapPairs(doc.items.map(toPlaced));
  return flags;
}

export function useEditorStore(init: EditorStoreInit): EditorStore {
  /* The first `init` is the store's; a later one is ignored, the way a
     `useState` initial value is. The page loads once (spec §6.1). */
  const [initial] = useState(init);
  const [state, setState] = useState<StoreState>(() => ({
    doc: initial.doc,
    selection: existing(initial.doc, initial.selection ?? []),
    history: EMPTY_HISTORY,
    notice: null,
  }));
  const [save, setSave] = useState<QueueSnapshot>(
    () => ({ status: 'saved', version: initial.version, pending: 0, error: null }),
  );

  /* The latest state, for commands that run twice before React re-renders
     (a drag's commit followed at once by a keyboard nudge). Written only in
     event handlers and effects, never during render. */
  const latest = useRef(state);
  const queueRef = useRef<SaveQueue | null>(null);
  const versionRef = useRef(initial.version);

  const commit = useCallback((next: StoreState) => {
    latest.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    const queue = new SaveQueue({
      send: initial.save,
      version: versionRef.current,
      onChange: (snapshot) => {
        versionRef.current = snapshot.version;
        setSave(snapshot);
      },
    });
    queueRef.current = queue;

    /* The spec's two moments to stop waiting: the tab is going to the
       background, or the page is going away. */
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void queue.flush();
    };
    const onPageHide = () => { void queue.flush(); };
    /* Warn before the tab closes while anything is unsent — pending, in
       flight, refused or waiting on a conflict. */
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (queue.snapshot.pending > 0) event.preventDefault();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      // Whatever is waiting goes out now; its answer has nobody to tell.
      void queue.flush();
      queue.dispose();
      if (queueRef.current === queue) queueRef.current = null;
    };
  }, [initial]);

  const run = useCallback((label: string, ops: SiteOp[], selection?: string[]) => {
    const current = latest.current;
    const { doc, applied } = applyEach(current.doc, ops);
    const nextSelection = existing(doc, selection ?? current.selection);
    if (applied.length === 0) {
      if (selection !== undefined) commit({ ...current, selection: nextSelection });
      return;
    }
    const inverse = invertOps(current.doc, applied);
    commit({
      ...current,
      doc,
      selection: nextSelection,
      history: record(current.history, { label, ops: applied, inverse }),
    });
    queueRef.current?.enqueue(applied);
  }, [commit]);

  const step = useCallback((direction: 'undo' | 'redo'): string | null => {
    const current = latest.current;
    const taken = direction === 'undo' ? undoStep(current.history) : redoStep(current.history);
    if (taken === null) return null;
    const { doc, applied, skipped } = applyEach(current.doc, taken.ops);
    commit({
      ...current,
      doc,
      selection: existing(doc, current.selection),
      history: taken.history,
      notice: skipped > 0 ? PARTLY_APPLIED : current.notice,
    });
    queueRef.current?.enqueue(applied);
    return taken.label;
  }, [commit]);

  const undo = useCallback(() => step('undo'), [step]);
  const redo = useCallback(() => step('redo'), [step]);

  const select = useCallback((ids: string[]) => {
    const current = latest.current;
    commit({ ...current, selection: existing(current.doc, ids) });
  }, [commit]);

  /**
   * The conflict banner's two answers (spec §6.4). Both start from the map
   * as the server has it now. 'theirs' takes it as it is; 'mine' replays what
   * is unsent on top of it, minus anything about an item that is gone — and
   * says which items those were, by the names the lead knew them by.
   *
   * 'theirs' is also the reload a refused batch offers.
   */
  const resolveConflict = useCallback(async (choice: 'theirs' | 'mine') => {
    const loaded = await initial.load();
    const current = latest.current;
    if (!loaded.ok || loaded.value === undefined) {
      commit({ ...current, notice: loaded.ok ? LOAD_FAILED : loaded.error });
      return;
    }
    const { doc: serverDoc, version } = loaded.value;
    const queue = queueRef.current;

    if (choice === 'theirs') {
      queue?.reset(version);
      commit({ ...current, doc: serverDoc, selection: existing(serverDoc, current.selection), notice: null });
      return;
    }

    const alive = new Set(serverDoc.items.map((item) => item.id));
    const kept: SiteOp[] = [];
    const dropped: string[] = [];
    for (const op of queue?.pendingOps() ?? []) {
      const id = targetOf(op);
      if (op.type === 'add') {
        if (alive.has(op.item.id)) dropped.push(op.item.label);
        else {
          kept.push(op);
          alive.add(op.item.id);
        }
      } else if (id !== null && !alive.has(id)) {
        dropped.push(findItem(current.doc, id)?.label ?? id);
      } else {
        kept.push(op);
      }
    }
    const doc = applyOps(serverDoc, kept).doc;
    queue?.rebase(version, kept);
    const names = [...new Set(dropped)];
    commit({
      ...current,
      doc,
      selection: existing(doc, current.selection),
      notice: names.length === 0 ? null : `לא נשמרו שינויים בפריטים שכבר לא במפה: ${names.join(', ')}.`,
    });
  }, [commit, initial]);

  const retrySave = useCallback(() => { void queueRef.current?.retry(); }, []);

  const dismissNotice = useCallback(() => {
    commit({ ...latest.current, notice: null });
  }, [commit]);

  const flags = useMemo(() => computeFlags(state.doc), [state.doc]);

  return {
    doc: state.doc,
    selection: state.selection,
    flags,
    canUndo: state.history.past.length > 0,
    canRedo: state.history.future.length > 0,
    save,
    conflict: save.status === 'conflict' ? { version: save.version } : null,
    notice: state.notice,
    run,
    undo,
    redo,
    select,
    resolveConflict,
    retrySave,
    dismissNotice,
  };
}
```

- [ ] **Step 4: Run the test**

Run the Step 2 command. Expected: 13 passed, exit 0.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npx eslint "src/app/(admin)/site/editor/use-editor-store.ts" "src/app/(admin)/site/editor/use-editor-store.test.ts"` — expected no problems. (A `react-hooks/set-state-in-effect` or `react-hooks/refs` error here means a ref was touched during render or a `setState` moved into an effect body; fix the code, never the rule.)

- [ ] **Step 6: Commit**

```bash
git add "src/app/(admin)/site/editor/use-editor-store.ts" "src/app/(admin)/site/editor/use-editor-store.test.ts"
git commit -m "feat(site): the editor store — every edit applied at once, saved behind it, conflicts as a choice

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: `palette.ts`, `meshes.ts`, `scene-sync.ts`

**Files:**
- Create: `src/app/(admin)/site/editor/scene/palette.ts`
- Create: `src/app/(admin)/site/editor/scene/meshes.ts`, `src/app/(admin)/site/editor/scene/meshes.test.ts`
- Create: `src/app/(admin)/site/editor/scene/scene-sync.ts`, `src/app/(admin)/site/editor/scene/scene-sync.test.ts`

**Interfaces:**
- Consumes: `EditorItem`, `EditorPlot`, `EditorDoc` (Task 5); `itemHeight` (Task 3); `SITE_KINDS[kind].{shape,group}`, `SiteKindGroup` (Task 3).
- Produces: `SceneTheme`, `SCENE_PALETTE` (+ `ScenePalette`, `SCENE_ALPHA`, `SCENE_LIGHT`); `CM`, `worldOf`, `ItemLook`, `geometryKey`, `buildItemObject`, `restyleItemObject`, `buildGround`, `disposeObject`; `SyncInput`, `SceneSync` — as the contract lists them, with the additions above.

The shapes, from the mock (`6c-render.js`): a box; a sofa as a seat at half height plus a back along the longer side (north edge, or west when turned); a tent as walls to half height and a gable roof whose ridge runs along the longer side; a cylinder (scaled to an ellipse when width ≠ depth); a fire as a low cylinder with an ember top; a net as four poles, a see-through cloth at the net's height, its outline, and the unshaded strip dashed on it. Every solid has edges (they are what makes plan view readable) and a soft contact patch under it while the sun is off. A net's shade is an invisible caster the size of its shaded rectangle — so the real sun shadow (Task 20) falls where §11 counts it — plus a drawn patch on the ground while the sun is off.

- [ ] **Step 1: Write the failing tests**

These run in Node with the real `three`: its scene graph, geometry and bounding boxes need no GPU.

Create `src/app/(admin)/site/editor/scene/meshes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { EditorItem } from '@/lib/site/editor/model';
import { buildGround, buildItemObject, CM, disposeObject, geometryKey, restyleItemObject, worldOf, type ItemLook } from './meshes';
import { SCENE_PALETTE } from './palette';

function item(over: Partial<EditorItem> = {}): EditorItem {
  return {
    id: 'a', kind: 'tent', label: 'אוהל 1', xCm: 100, yCm: 200, widthCm: 300, depthCm: 200,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

const NORMAL: ItemLook = { theme: 'light', state: 'normal', issue: 'none' };

function parts(object: THREE.Object3D, part: string): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  object.traverse((child) => { if (child.userData.part === part) found.push(child as THREE.Mesh); });
  return found;
}

describe('the map in three’s units', () => {
  it('puts east on +X, up on +Y and south on +Z, in metres', () => {
    expect(CM).toBe(0.01);
    expect(worldOf(250, 400, 120).toArray()).toEqual([2.5, 1.2, 4]);
  });
});

describe('the item builders', () => {
  it('stands every shape on its north-west corner, named by its id', () => {
    for (const kind of ['tent', 'caravan', 'sofa', 'water', 'fire', 'shade'] as const) {
      const object = buildItemObject(item({ kind, insetCm: kind === 'shade' ? 50 : null }), 200, NORMAL);
      expect(object.name).toBe('a');
      expect(object.userData).toMatchObject({ id: 'a', isNet: kind === 'shade' });
      expect(object.position.toArray()).toEqual([1, 0, 2]);
      const bounds = new THREE.Box3().setFromObject(object);
      expect(bounds.min.x).toBeGreaterThanOrEqual(1 - 0.1);
      expect(bounds.max.x).toBeLessThanOrEqual(4 + 0.3);
      expect(bounds.max.y).toBeCloseTo(kind === 'fire' ? 2.01 : 2, 1);
    }
  });

  it('builds a sofa from a seat and a back, the back on the long side', () => {
    const sofa = buildItemObject(item({ kind: 'sofa', widthCm: 200, depthCm: 90 }), 80, NORMAL);
    const bodies = parts(sofa, 'body');
    expect(bodies).toHaveLength(2);
    const back = new THREE.Box3().setFromObject(bodies[1]);
    expect(back.max.y).toBeCloseTo(0.8);
    expect(back.max.x - back.min.x).toBeCloseTo(2);
  });

  it('turns every face of a tent outwards, with the ridge along the longer side', () => {
    const tent = buildItemObject(item({ widthCm: 400, depthCm: 300 }), 200, NORMAL);
    const [body] = parts(tent, 'body');
    const geometry = body.geometry;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const centre = new THREE.Vector3(2, 1, 1.5);
    for (let i = 0; i < position.count; i += 3) {
      const mid = new THREE.Vector3();
      for (let k = 0; k < 3; k += 1) mid.add(new THREE.Vector3().fromBufferAttribute(position, i + k));
      mid.divideScalar(3);
      const n = new THREE.Vector3().fromBufferAttribute(normal, i);
      expect(n.dot(mid.sub(centre))).toBeGreaterThan(0);
    }
    const ridge: number[] = [];
    for (let i = 0; i < position.count; i += 1) if (Math.abs(position.getY(i) - 2) < 1e-6) ridge.push(position.getZ(i));
    expect(new Set(ridge)).toEqual(new Set([1.5]));
  });

  it('draws a net as four poles and a see-through cloth at its height, the unshaded strip dashed', () => {
    const net = buildItemObject(item({ kind: 'shade', widthCm: 800, depthCm: 600, insetCm: 50 }), 300, NORMAL);
    expect(parts(net, 'pole')).toHaveLength(4);
    const [cloth] = parts(net, 'cloth');
    expect((cloth.material as THREE.Material).transparent).toBe(true);
    expect(cloth.position.y).toBeCloseTo(3);
    const [inset] = parts(net, 'inset');
    const strip = new THREE.Box3().setFromObject(inset);
    expect(strip.max.x - strip.min.x).toBeCloseTo(7);
    expect(strip.max.z - strip.min.z).toBeCloseTo(5);
    const [caster] = parts(net, 'caster');
    expect(caster.castShadow).toBe(true);
    expect(caster.userData.pick).toBe(false);
    expect(cloth.castShadow).toBe(false);
  });

  it('keys the geometry on shape, size, height and inset — never on position or name', () => {
    const base = geometryKey(item(), 200);
    expect(geometryKey(item({ xCm: 900, label: 'אוהל 9', locked: true }), 200)).toBe(base);
    expect(geometryKey(item({ widthCm: 310 }), 200)).not.toBe(base);
    expect(geometryKey(item(), 210)).not.toBe(base);
    expect(geometryKey(item({ kind: 'caravan' }), 200)).not.toBe(base);
    expect(geometryKey(item({ kind: 'shade', insetCm: 50 }), 200))
      .not.toBe(geometryKey(item({ kind: 'shade', insetCm: 60 }), 200));
  });

  it('recolours for selection, problems and theme without new geometry', () => {
    const tent = buildItemObject(item(), 200, NORMAL);
    const [body] = parts(tent, 'body');
    const geometry = body.geometry;
    const before = (body.material as THREE.MeshLambertMaterial).color.getHex();

    restyleItemObject(tent, { theme: 'light', state: 'selected', issue: 'none' });
    expect((body.material as THREE.MeshLambertMaterial).color.getHex()).not.toBe(before);
    const [edge] = parts(tent, 'edge');
    expect((edge.material as THREE.LineBasicMaterial).color.getHex())
      .toBe(new THREE.Color(SCENE_PALETTE.light.selected).getHex());

    restyleItemObject(tent, { theme: 'dark', state: 'normal', issue: 'outside' });
    expect((edge.material as THREE.LineBasicMaterial).color.getHex())
      .toBe(new THREE.Color(SCENE_PALETTE.dark.bad).getHex());
    expect(body.geometry).toBe(geometry);
  });

  it('hides the drawn shade and contact patches when the sun casts real shadows', () => {
    const net = buildItemObject(item({ kind: 'shade', insetCm: 50 }), 300, NORMAL);
    const tent = buildItemObject(item(), 200, NORMAL);
    expect(parts(net, 'patch')[0].visible).toBe(true);
    restyleItemObject(net, { ...NORMAL, sun: true });
    restyleItemObject(tent, { ...NORMAL, sun: true });
    expect(parts(net, 'patch')[0].visible).toBe(false);
    expect(parts(tent, 'contact')[0].visible).toBe(false);
  });
});

describe('the ground', () => {
  it('lays the plot, the grid and the fence at the plot’s size', () => {
    const ground = buildGround({ id: 'p', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, 'light');
    const plot = ground.getObjectByName('plot') as THREE.Mesh;
    const bounds = new THREE.Box3().setFromObject(plot);
    expect(bounds.min.x).toBeCloseTo(0);
    expect(bounds.min.z).toBeCloseTo(0);
    expect(bounds.max.y).toBeCloseTo(0);
    expect(bounds.max.x).toBeCloseTo(26);
    expect(bounds.max.z).toBeCloseTo(24);
    const minor = ground.getObjectByName('gridMinor') as THREE.LineSegments;
    // 53 lines across and 49 down, two points each.
    expect(minor.geometry.getAttribute('position').count).toBe((53 + 49) * 2);
    expect(ground.getObjectByName('gridMajor')).toBeDefined();
    expect(ground.getObjectByName('fence')).toBeDefined();
  });
});

describe('disposal', () => {
  it('frees every geometry and material once', () => {
    const net = buildItemObject(item({ kind: 'shade', insetCm: 50 }), 300, NORMAL);
    let disposed = 0;
    const seen = new Set<unknown>();
    net.traverse((child) => {
      const mesh = child as THREE.Mesh;
      for (const owned of [mesh.geometry, mesh.material]) {
        if (owned && !seen.has(owned)) {
          seen.add(owned);
          (owned as THREE.EventDispatcher<{ dispose: object }>).addEventListener('dispose', () => { disposed += 1; });
        }
      }
    });
    disposeObject(net);
    expect(disposed).toBe(seen.size);
    expect(disposed).toBeGreaterThan(6);
  });
});
```

Create `src/app/(admin)/site/editor/scene/scene-sync.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import { SceneSync, type SyncInput } from './scene-sync';

function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 100, yCm: 200, widthCm: 300, depthCm: 300,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

function doc(items: EditorItem[]): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, defaults: {} };
}

function input(items: EditorItem[], over: Partial<SyncInput> = {}): SyncInput {
  return {
    doc: doc(items), preview: new Map(), selection: new Set(), hover: null,
    flags: { outside: new Set(), overlapping: new Set() },
    hiddenGroups: new Set(), netsHidden: false, theme: 'light', ...over,
  };
}

const TENT = item({ id: 'tent' });
const NET = item({ id: 'net', kind: 'shade', label: 'רשת צל 1', xCm: 0, yCm: 0, widthCm: 800, depthCm: 800, insetCm: 50 });
const SOFA = item({ id: 'sofa', kind: 'sofa', label: 'ספה 1', xCm: 1000, yCm: 1000, widthCm: 200, depthCm: 90 });

function bodyColour(object: THREE.Object3D): number {
  let hex = -1;
  object.traverse((child) => {
    if (hex === -1 && child.userData.part === 'body') hex = ((child as THREE.Mesh).material as THREE.MeshLambertMaterial).color.getHex();
  });
  return hex;
}

function geometryOf(object: THREE.Object3D): THREE.BufferGeometry {
  let found: THREE.BufferGeometry | null = null;
  object.traverse((child) => {
    if (found === null && child.userData.part === 'body') found = (child as THREE.Mesh).geometry;
  });
  if (found === null) throw new Error('no body');
  return found;
}

describe('keeping the scene in step with the store', () => {
  it('builds one object per item, where the item is', () => {
    const sync = new SceneSync();
    sync.sync(input([TENT, NET, SOFA]));
    expect(sync.root.children.map((child) => child.name).sort()).toEqual(['net', 'sofa', 'tent']);
    expect(sync.objectOf('tent')?.position.toArray()).toEqual([1, 0, 2]);
  });

  it('moves an item without rebuilding it', () => {
    const sync = new SceneSync();
    sync.sync(input([TENT]));
    const before = sync.objectOf('tent');
    sync.sync(input([{ ...TENT, xCm: 900, yCm: 50 }]));
    expect(sync.objectOf('tent')).toBe(before);
    expect(before?.position.toArray()).toEqual([9, 0, 0.5]);
  });

  it('rebuilds an item whose size changed, and frees the old geometry', () => {
    const sync = new SceneSync();
    sync.sync(input([TENT]));
    const before = sync.objectOf('tent') as THREE.Group;
    let freed = false;
    geometryOf(before).addEventListener('dispose', () => { freed = true; });

    sync.sync(input([{ ...TENT, widthCm: 400 }]));

    expect(sync.objectOf('tent')).not.toBe(before);
    expect(freed).toBe(true);
    expect(sync.root.children).toHaveLength(1);
  });

  it('rebuilds when the height changes, including through the kind’s default', () => {
    const sync = new SceneSync();
    sync.sync(input([TENT]));
    const before = sync.objectOf('tent');
    const withDefault = input([TENT]);
    withDefault.doc.defaults = { tent: { widthCm: 300, depthCm: 300, heightCm: 260, insetCm: null } };
    sync.sync(withDefault);
    expect(sync.objectOf('tent')).not.toBe(before);
  });

  it('takes out and frees an item that left the map', () => {
    const sync = new SceneSync();
    sync.sync(input([TENT, SOFA]));
    const sofa = sync.objectOf('sofa') as THREE.Group;
    let freed = false;
    geometryOf(sofa).addEventListener('dispose', () => { freed = true; });

    sync.sync(input([TENT]));

    expect(sync.objectOf('sofa')).toBeUndefined();
    expect(sync.root.children.map((child) => child.name)).toEqual(['tent']);
    expect(freed).toBe(true);
  });

  it('leaves out a hidden group and hidden nets, and brings them back', () => {
    const sync = new SceneSync();
    sync.sync(input([TENT, NET, SOFA], { hiddenGroups: new Set(['living']), netsHidden: true }));
    expect(sync.root.children.map((child) => child.name)).toEqual(['tent']);
    sync.sync(input([TENT, NET, SOFA]));
    expect(sync.root.children.map((child) => child.name).sort()).toEqual(['net', 'sofa', 'tent']);
  });

  it('draws a drag where the drag is, not where the store has it', () => {
    const sync = new SceneSync();
    sync.sync(input([TENT]));
    const object = sync.objectOf('tent');
    sync.sync(input([TENT], { preview: new Map([['tent', { xCm: 500, yCm: 600, widthCm: 300, depthCm: 300 }]]) }));
    expect(sync.objectOf('tent')).toBe(object);
    expect(object?.position.toArray()).toEqual([5, 0, 6]);

    // A handle drag previews a new size, which is new geometry.
    sync.sync(input([TENT], { preview: new Map([['tent', { xCm: 100, yCm: 200, widthCm: 450, depthCm: 300 }]]) }));
    const resized = sync.objectOf('tent') as THREE.Group;
    expect(resized).not.toBe(object);
    expect(new THREE.Box3().setFromObject(resized.children[0]).max.x).toBeCloseTo(5.5);
  });

  it('restyles for selection, hover and problems without rebuilding', () => {
    const sync = new SceneSync();
    sync.sync(input([TENT]));
    const object = sync.objectOf('tent') as THREE.Group;
    const geometry = geometryOf(object);
    const normal = bodyColour(object);

    sync.sync(input([TENT], { selection: new Set(['tent']) }));
    const selected = bodyColour(object);
    sync.sync(input([TENT], { hover: 'tent' }));
    const hovered = bodyColour(object);
    sync.sync(input([TENT], { flags: { outside: new Set(['tent']), overlapping: new Set() } }));
    const outside = bodyColour(object);

    expect(new Set([normal, selected, hovered, outside]).size).toBe(4);
    expect(sync.objectOf('tent')).toBe(object);
    expect(geometryOf(object)).toBe(geometry);
  });

  it('lists solids and nets apart, for picking', () => {
    const sync = new SceneSync();
    sync.sync(input([TENT, NET, SOFA]));
    expect(sync.solidObjects().map((object) => object.name).sort()).toEqual(['sofa', 'tent']);
    expect(sync.netObjects().map((object) => object.name)).toEqual(['net']);
  });

  it('frees everything on dispose', () => {
    const sync = new SceneSync();
    sync.sync(input([TENT, NET]));
    sync.dispose();
    expect(sync.root.children).toHaveLength(0);
    expect(sync.objectOf('tent')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run "src/app/(admin)/site/editor/scene/meshes.test.ts" "src/app/(admin)/site/editor/scene/scene-sync.test.ts" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — `./meshes` and `./scene-sync` cannot be resolved; no tests run.

- [ ] **Step 3: Create `palette.ts`**

```ts
import type { SiteKindGroup } from '@/lib/site/kinds';

/**
 * The scene's own colours, light and dark — scoped data like the series
 * palette in `charts.module.css`'s `.viz`, and for the same reason: WebGL
 * cannot read a CSS custom property, and these colours paint only the 3D map.
 * Everything drawn in the DOM over the scene (labels, handles, guides) takes
 * its colours from `tokens.css` instead (`scene.module.css`).
 *
 * Transcribed from the mock (`6a-data.js`, `THEME` and `GROUP_COL`). Where the
 * mock blends a translucent line over the plot, the value here is that blend,
 * precomputed, so the ground can be drawn opaque and never flicker.
 */
export type SceneTheme = 'light' | 'dark';

export interface ScenePalette {
  outside: string;
  plot: string;
  gridMinor: string;
  gridMajor: string;
  fence: string;
  edge: string;
  selected: string;
  hover: string;
  bad: string;
  warn: string;
  cloth: string;
  clothEdge: string;
  shadeGround: string;
  guide: string;
  /** A fire's top. */
  ember: string;
  /** The soft patch under a solid while shade by hour is off. */
  contact: string;
  groups: Record<SiteKindGroup, string>;
}

export const SCENE_PALETTE: Record<SceneTheme, ScenePalette> = {
  light: {
    outside: '#E6DDCF',
    plot: '#F4EDE2',
    gridMinor: '#E7DED2',
    gridMajor: '#D4CABD',
    fence: '#8C7B6B',
    edge: '#7D6D5E',
    selected: '#C8570F',
    hover: '#FFFFFF',
    bad: '#B42318',
    warn: '#B7770B',
    cloth: '#604A36',
    clothEdge: '#988877',
    shadeGround: '#E4DBCF',
    guide: '#2458C6',
    ember: '#E8743B',
    contact: '#46321E',
    groups: { sleep: '#E6D0A6', living: '#EDBF98', sanitation: '#B4CDEE', utility: '#B7D9C3', other: '#D5C4EA' },
  },
  dark: {
    outside: '#141211',
    plot: '#1D1A17',
    gridMinor: '#282521',
    gridMajor: '#38342F',
    fence: '#A39B93',
    edge: '#C9BBA8',
    selected: '#F08A4B',
    hover: '#FFFFFF',
    bad: '#F2877C',
    warn: '#F0C05A',
    cloth: '#EBD7BE',
    clothEdge: '#7A6F62',
    shadeGround: '#171412',
    guide: '#7FA8F5',
    ember: '#C8612B',
    contact: '#000000',
    groups: { sleep: '#7C6948', living: '#83593D', sanitation: '#44607F', utility: '#42685A', other: '#5D4D78' },
  },
};

/** The two colours the scene draws see-through, and how much. */
export const SCENE_ALPHA: Record<SceneTheme, { cloth: number; contact: number }> = {
  light: { cloth: 0.18, contact: 0.14 },
  dark: { cloth: 0.11, contact: 0.35 },
};

/**
 * The lights' colours, the same in both themes: a white sky, warm light
 * bounced off the playa, and a slightly warm sun (spec §7, "Lighting").
 */
export const SCENE_LIGHT = { sky: '#FFFFFF', ground: '#A89C8A', sun: '#FFF4E0' } as const;
```

- [ ] **Step 4: Create `meshes.ts`**

```ts
import * as THREE from 'three';
import type { EditorItem, EditorPlot } from '@/lib/site/editor/model';
import { SITE_KINDS, type SiteKindGroup } from '@/lib/site/kinds';
import { SCENE_ALPHA, SCENE_PALETTE, type SceneTheme } from './palette';

/**
 * One builder per shape (spec §7), in three's units. The map is centimetres
 * with x east, y south and z up; three is metres with y up. So a map point
 * (x, y, z) is three's (x, z, y) · 0.01: east stays +X, up is +Y, south is
 * +Z. That swap of two axes is also what turns the map's left-handed axes
 * into three's right-handed ones, so nothing is mirrored.
 *
 * Every item is a `THREE.Group` whose origin is its north-west corner on the
 * ground. Moving an item moves the group; only a change of shape, size or
 * height rebuilds it (`geometryKey`). Parts carry `userData.part` so a
 * restyle finds them without rebuilding, and `userData.pick === false` on the
 * parts a click must go through (ground patches, the shadow caster).
 */

export const CM = 0.01;

export function worldOf(xCm: number, yCm: number, zCm: number): THREE.Vector3 {
  return new THREE.Vector3(xCm * CM, zCm * CM, yCm * CM);
}

export interface ItemLook {
  theme: SceneTheme;
  state: 'normal' | 'hover' | 'selected';
  issue: 'none' | 'outside' | 'overlapping';
  /** Shade by hour is on: real shadows replace the drawn patches. */
  sun?: boolean;
}

type Part = 'body' | 'edge' | 'ember' | 'pole' | 'cloth' | 'clothEdge' | 'inset' | 'caster' | 'patch' | 'contact';
type Point = [number, number, number];

/** What decides the geometry. Position is not in it: a move never rebuilds. */
export function geometryKey(item: EditorItem, heightCm: number): string {
  const inset = SITE_KINDS[item.kind].shape === 'net' ? item.insetCm ?? 0 : 0;
  return `${item.kind}:${item.widthCm}x${item.depthCm}x${heightCm}:${inset}`;
}

function tag<T extends THREE.Object3D>(object: T, part: Part, pick = true): T {
  object.userData.part = part;
  if (!pick) object.userData.pick = false;
  return object;
}

function edgesOf(geometry: THREE.BufferGeometry): THREE.LineSegments {
  return tag(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20), new THREE.LineBasicMaterial()), 'edge', false);
}

function solid(geometry: THREE.BufferGeometry, at: THREE.Vector3): THREE.Mesh {
  const mesh = tag(new THREE.Mesh(geometry, new THREE.MeshLambertMaterial()), 'body');
  mesh.position.copy(at);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.add(edgesOf(geometry));
  return mesh;
}

function box(w: number, h: number, d: number, x0: number, z0: number): THREE.Mesh {
  return solid(new THREE.BoxGeometry(w, h, d), new THREE.Vector3(x0 + w / 2, h / 2, z0 + d / 2));
}

/**
 * A convex solid from its faces. Each face is turned to face away from the
 * solid's middle, so the winding three draws by never depends on the order
 * the points were written in.
 */
function convexGeometry(faces: Point[][]): THREE.BufferGeometry {
  const all = faces.flat();
  const centre = all.reduce<Point>((s, p) => [s[0] + p[0] / all.length, s[1] + p[1] / all.length, s[2] + p[2] / all.length], [0, 0, 0]);
  const positions: number[] = [];
  for (const face of faces) {
    const [a, b, c] = face;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const mid = face.reduce<Point>((s, p) => [s[0] + p[0] / face.length, s[1] + p[1] / face.length, s[2] + p[2] / face.length], [0, 0, 0]);
    const outward = n[0] * (mid[0] - centre[0]) + n[1] * (mid[1] - centre[1]) + n[2] * (mid[2] - centre[2]) >= 0;
    const ordered = outward ? face : [...face].reverse();
    for (let i = 1; i + 1 < ordered.length; i += 1) positions.push(...ordered[0], ...ordered[i], ...ordered[i + 1]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Walls to half the height, then a gable roof whose ridge runs along the longer side. */
function tentGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const eave = h * 0.5;
  if (w >= d) {
    const m = d / 2;
    return convexGeometry([
      [[0, 0, d], [w, 0, d], [w, eave, d], [0, eave, d]],
      [[0, 0, 0], [w, 0, 0], [w, eave, 0], [0, eave, 0]],
      [[0, 0, 0], [0, 0, d], [0, eave, d], [0, h, m], [0, eave, 0]],
      [[w, 0, 0], [w, 0, d], [w, eave, d], [w, h, m], [w, eave, 0]],
      [[0, eave, 0], [w, eave, 0], [w, h, m], [0, h, m]],
      [[0, eave, d], [w, eave, d], [w, h, m], [0, h, m]],
    ]);
  }
  const m = w / 2;
  return convexGeometry([
    [[w, 0, 0], [w, 0, d], [w, eave, d], [w, eave, 0]],
    [[0, 0, 0], [0, 0, d], [0, eave, d], [0, eave, 0]],
    [[0, 0, 0], [w, 0, 0], [w, eave, 0], [m, h, 0], [0, eave, 0]],
    [[0, 0, d], [w, 0, d], [w, eave, d], [m, h, d], [0, eave, d]],
    [[0, eave, 0], [0, eave, d], [m, h, d], [m, h, 0]],
    [[w, eave, 0], [w, eave, d], [m, h, d], [m, h, 0]],
  ]);
}

function cylinder(w: number, h: number, d: number): THREE.Mesh {
  const mesh = solid(new THREE.CylinderGeometry(w / 2, w / 2, h, 24), new THREE.Vector3(w / 2, h / 2, d / 2));
  mesh.scale.set(1, 1, d / w);
  return mesh;
}

/** A flat rectangle lying on (or floating above) the ground, facing up. */
function flat(w: number, d: number, x: number, y: number, z: number, material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(w, d);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  return mesh;
}

function outline(x0: number, z0: number, x1: number, z1: number, y: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0,
  ], 3));
  return geometry;
}

/** Four poles and a see-through cloth at the net's height; the unshaded strip dashed on it. */
function net(group: THREE.Group, w: number, h: number, d: number, insetM: number): void {
  const pole = new THREE.CylinderGeometry(0.04, 0.04, h, 6);
  const poleMaterial = new THREE.MeshLambertMaterial();
  for (const [x, z] of [[0.04, 0.04], [w - 0.04, 0.04], [w - 0.04, d - 0.04], [0.04, d - 0.04]]) {
    const mesh = tag(new THREE.Mesh(pole, poleMaterial), 'pole');
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    group.add(mesh);
  }

  const cloth = tag(flat(w, d, w / 2, h, d / 2, new THREE.MeshLambertMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  })), 'cloth');
  group.add(cloth);
  group.add(tag(new THREE.LineSegments(outline(0, 0, w, d, h), new THREE.LineBasicMaterial()), 'clothEdge', false));

  const sw = w - insetM * 2;
  const sd = d - insetM * 2;
  if (sw <= 0 || sd <= 0) return;
  if (insetM > 0) {
    const inset = tag(new THREE.LineSegments(
      outline(insetM, insetM, w - insetM, d - insetM, h + 0.005),
      new THREE.LineDashedMaterial({ dashSize: 0.15, gapSize: 0.12 }),
    ), 'inset', false);
    inset.computeLineDistances();
    group.add(inset);
  }
  /* What actually shades: invisible, but it casts the sun's shadow. The
     cloth itself does not, so the sag strip stays sunny, as §11 counts it. */
  const caster = tag(flat(sw, sd, w / 2, h, d / 2, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })), 'caster', false);
  caster.castShadow = true;
  group.add(caster);
  /* Where the shade falls when the sun is not being modelled. */
  const patch = tag(flat(sw, sd, w / 2, 0.003, d / 2, new THREE.MeshBasicMaterial({ depthWrite: false })), 'patch', false);
  patch.renderOrder = -3;
  group.add(patch);
}

export function buildItemObject(item: EditorItem, heightCm: number, look: ItemLook): THREE.Group {
  const preset = SITE_KINDS[item.kind];
  const w = item.widthCm * CM;
  const d = item.depthCm * CM;
  const h = Math.max(1, heightCm) * CM;
  const group = new THREE.Group();
  group.name = item.id;
  group.userData = {
    id: item.id, isNet: preset.shape === 'net', key: geometryKey(item, heightCm),
    kind: item.kind, group: preset.group,
  };

  switch (preset.shape) {
    case 'sofa': {
      group.add(box(w, h * 0.5, d, 0, 0));
      // The back stands on the north edge, or the west one when the sofa is turned.
      group.add(w >= d ? box(w, h, Math.max(0.15, d * 0.26), 0, 0) : box(Math.max(0.15, w * 0.26), h, d, 0, 0));
      break;
    }
    case 'tent':
      group.add(solid(tentGeometry(w, h, d), new THREE.Vector3(0, 0, 0)));
      break;
    case 'cylinder':
      group.add(cylinder(w, h, d));
      break;
    case 'fire': {
      group.add(cylinder(w, h, d));
      const top = tag(new THREE.Mesh(new THREE.CylinderGeometry(w * 0.38, w * 0.38, 0.01, 24), new THREE.MeshBasicMaterial()), 'ember');
      top.position.set(w / 2, h + 0.005, d / 2);
      top.scale.set(1, 1, d / w);
      group.add(top);
      break;
    }
    case 'net':
      net(group, w, h, d, (item.insetCm ?? 0) * CM);
      break;
    default:
      group.add(box(w, h, d, 0, 0));
  }

  if (preset.shape !== 'net') {
    const contact = tag(flat(w + 0.2, d + 0.2, w / 2 + 0.08, 0.002, d / 2 + 0.1, new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false,
    })), 'contact', false);
    group.add(contact);
  }

  group.position.copy(worldOf(item.xCm, item.yCm, 0));
  restyleItemObject(group, look);
  return group;
}

function bodyColour(group: SiteKindGroup, look: ItemLook): THREE.Color {
  const palette = SCENE_PALETTE[look.theme];
  const colour = new THREE.Color(palette.groups[group]);
  if (look.issue === 'outside') colour.lerp(new THREE.Color(palette.bad), 0.34);
  else if (look.issue === 'overlapping') colour.lerp(new THREE.Color(palette.warn), 0.34);
  if (look.state === 'selected') colour.lerp(new THREE.Color(palette.selected), 0.25);
  else if (look.state === 'hover') colour.lerp(new THREE.Color(palette.hover), look.theme === 'dark' ? 0.08 : 0.2);
  return colour;
}

function lineColour(look: ItemLook): string {
  const palette = SCENE_PALETTE[look.theme];
  if (look.state === 'selected') return palette.selected;
  if (look.issue === 'outside') return palette.bad;
  if (look.issue === 'overlapping') return palette.warn;
  return palette.edge;
}

/** Colours only: selection, hover, problems, theme and the sun never rebuild geometry. */
export function restyleItemObject(object: THREE.Group, look: ItemLook): void {
  const palette = SCENE_PALETTE[look.theme];
  const alpha = SCENE_ALPHA[look.theme];
  const group = object.userData.group as SiteKindGroup;
  object.traverse((child) => {
    const part = child.userData.part as Part | undefined;
    if (part === undefined) return;
    const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial | THREE.MeshLambertMaterial | THREE.LineBasicMaterial;
    switch (part) {
      case 'body': material.color.copy(bodyColour(group, look)); break;
      case 'edge': material.color.set(lineColour(look)); break;
      case 'ember': material.color.set(palette.ember); break;
      case 'pole': material.color.set(palette.fence); break;
      case 'cloth':
        material.color.set(look.state === 'selected' ? palette.selected : palette.cloth);
        material.opacity = look.state === 'selected' ? alpha.cloth + 0.06 : alpha.cloth;
        break;
      case 'clothEdge':
        material.color.set(look.state === 'hover' ? palette.edge : look.state === 'normal' && look.issue === 'none' ? palette.clothEdge : lineColour(look));
        break;
      case 'inset': material.color.set(palette.clothEdge); break;
      case 'patch':
        material.color.set(palette.shadeGround);
        child.visible = look.sun !== true;
        break;
      case 'contact':
        material.color.set(palette.contact);
        material.opacity = alpha.contact;
        child.visible = look.sun !== true;
        break;
      case 'caster': break;
    }
  });
}

/** The plot, the ground around it, the grid (minor and every five metres) and the dashed fence. */
export function buildGround(plot: EditorPlot, theme: SceneTheme): THREE.Group {
  const palette = SCENE_PALETTE[theme];
  const w = plot.widthCm * CM;
  const d = plot.depthCm * CM;
  const ground = new THREE.Group();
  ground.name = 'ground';

  const layer = <T extends THREE.Object3D>(object: T, name: string, order: number): T => {
    object.name = name;
    object.renderOrder = order;
    object.userData.pick = false;
    ground.add(object);
    return object;
  };
  /* The ground never hides anything — everything stands on it — so it writes
     no depth and is drawn first, in this order, and nothing on it flickers. */
  const surface = (colour: string) => new THREE.MeshLambertMaterial({ color: colour, depthWrite: false });

  const margin = 200;
  layer(flat(w + margin, d + margin, w / 2, 0, d / 2, surface(palette.outside)), 'outside', -5).receiveShadow = true;
  layer(flat(w, d, w / 2, 0, d / 2, surface(palette.plot)), 'plot', -4).receiveShadow = true;

  const lines = (stepCm: number): THREE.BufferGeometry => {
    const points: number[] = [];
    for (let x = 0; x <= plot.widthCm; x += stepCm) points.push(x * CM, 0, 0, x * CM, 0, d);
    for (let y = 0; y <= plot.depthCm; y += stepCm) points.push(0, 0, y * CM, w, 0, y * CM);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return geometry;
  };
  const lineMaterial = (colour: string) => new THREE.LineBasicMaterial({ color: colour, depthWrite: false });
  const minorCount = plot.gridCm > 0 ? (plot.widthCm + plot.depthCm) / plot.gridCm : Infinity;
  if (minorCount <= 2000) layer(new THREE.LineSegments(lines(plot.gridCm), lineMaterial(palette.gridMinor)), 'gridMinor', -2);
  layer(new THREE.LineSegments(lines(500), lineMaterial(palette.gridMajor)), 'gridMajor', -1.5);

  const fence = layer(new THREE.LineSegments(outline(0, 0, w, d, 0), new THREE.LineDashedMaterial({
    color: palette.fence, dashSize: 0.35, gapSize: 0.25, depthWrite: false,
  })), 'fence', -1);
  fence.computeLineDistances();
  return ground;
}

/** Frees every geometry and material under `object`, each once. */
export function disposeObject(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    const drawable = child as THREE.Mesh;
    if (drawable.geometry instanceof THREE.BufferGeometry) geometries.add(drawable.geometry);
    const material = drawable.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((entry) => materials.add(entry));
    else if (material instanceof THREE.Material) materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}
```

- [ ] **Step 5: Create `scene-sync.ts`**

```ts
import * as THREE from 'three';
import { itemHeight } from '@/lib/site/defaults';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import { SITE_KINDS, type SiteKindGroup } from '@/lib/site/kinds';
import { buildItemObject, disposeObject, geometryKey, restyleItemObject, worldOf, type ItemLook } from './meshes';
import type { SceneTheme } from './palette';

export interface SyncInput {
  doc: EditorDoc;
  /** Where a drag or a handle has an item right now; the store is not touched until the drop. */
  preview: ReadonlyMap<string, { xCm: number; yCm: number; widthCm: number; depthCm: number }>;
  selection: ReadonlySet<string>;
  hover: string | null;
  flags: { outside: ReadonlySet<string>; overlapping: ReadonlySet<string> };
  hiddenGroups: ReadonlySet<SiteKindGroup>;
  netsHidden: boolean;
  theme: SceneTheme;
  /** Shade by hour is on (spec §11). */
  sun?: boolean;
}

function lookKey(look: ItemLook): string {
  return `${look.theme}|${look.state}|${look.issue}|${look.sun === true ? 'sun' : ''}`;
}

/**
 * Keeps the scene in step with the store by id (spec §7): an item new to the
 * doc is built, a moved one is moved, a resized or re-kinded one is rebuilt,
 * a restyled one is recoloured, and one that left — or whose group is hidden
 * — is taken out and freed. It never rebuilds the whole scene.
 */
export class SceneSync {
  readonly root = new THREE.Group();
  private readonly objects = new Map<string, THREE.Group>();
  private readonly looks = new Map<string, string>();

  constructor() {
    this.root.name = 'items';
  }

  sync(input: SyncInput): void {
    const shown = new Set<string>();
    for (const item of input.doc.items) {
      if (!this.visible(item, input)) continue;
      shown.add(item.id);
      const rect = input.preview.get(item.id);
      const drawn: EditorItem = rect === undefined ? item : { ...item, ...rect };
      const height = itemHeight(item, input.doc.defaults);
      const key = geometryKey(drawn, height);
      const look: ItemLook = {
        theme: input.theme,
        state: input.selection.has(item.id) ? 'selected' : input.hover === item.id ? 'hover' : 'normal',
        issue: input.flags.outside.has(item.id) ? 'outside' : input.flags.overlapping.has(item.id) ? 'overlapping' : 'none',
        sun: input.sun === true,
      };

      let object = this.objects.get(item.id);
      if (object !== undefined && object.userData.key !== key) {
        this.drop(item.id);
        object = undefined;
      }
      if (object === undefined) {
        object = buildItemObject(drawn, height, look);
        this.root.add(object);
        this.objects.set(item.id, object);
        this.looks.set(item.id, lookKey(look));
      } else if (this.looks.get(item.id) !== lookKey(look)) {
        restyleItemObject(object, look);
        this.looks.set(item.id, lookKey(look));
      }
      object.position.copy(worldOf(drawn.xCm, drawn.yCm, 0));
    }
    for (const id of [...this.objects.keys()]) {
      if (!shown.has(id)) this.drop(id);
    }
    // Picking reads world matrices; nothing else updates them before a render.
    this.root.updateMatrixWorld(true);
  }

  objectOf(id: string): THREE.Group | undefined {
    return this.objects.get(id);
  }

  solidObjects(): THREE.Object3D[] {
    return [...this.objects.values()].filter((object) => object.userData.isNet !== true);
  }

  netObjects(): THREE.Object3D[] {
    return [...this.objects.values()].filter((object) => object.userData.isNet === true);
  }

  dispose(): void {
    for (const id of [...this.objects.keys()]) this.drop(id);
  }

  private visible(item: EditorItem, input: SyncInput): boolean {
    if (input.hiddenGroups.has(SITE_KINDS[item.kind].group)) return false;
    return !(input.netsHidden && SITE_KINDS[item.kind].shape === 'net');
  }

  private drop(id: string): void {
    const object = this.objects.get(id);
    if (object === undefined) return;
    this.root.remove(object);
    disposeObject(object);
    this.objects.delete(id);
    this.looks.delete(id);
  }
}
```

- [ ] **Step 6: Run the tests, and the three guard**

Run: `npx vitest run "src/app/(admin)/site/editor/scene/meshes.test.ts" "src/app/(admin)/site/editor/scene/scene-sync.test.ts" "src/app/(admin)/site/editor/three-guard.test.ts" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: 22 passed (10 + 10 + the guard's 2), exit 0.

- [ ] **Step 7: Typecheck and lint**

Run: `npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npx eslint "src/app/(admin)/site/editor/scene"` — expected no problems.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(admin)/site/editor/scene/palette.ts" "src/app/(admin)/site/editor/scene/meshes.ts" "src/app/(admin)/site/editor/scene/meshes.test.ts" "src/app/(admin)/site/editor/scene/scene-sync.ts" "src/app/(admin)/site/editor/scene/scene-sync.test.ts"
git commit -m "feat(site): the camp map's 3D shapes, and a scene kept in step with the store by id

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: `camera-rig.ts`, `picking.ts`

**Files:**
- Create: `src/app/(admin)/site/editor/scene/camera-rig.ts`, `src/app/(admin)/site/editor/scene/camera-rig.test.ts`
- Create: `src/app/(admin)/site/editor/scene/picking.ts`, `src/app/(admin)/site/editor/scene/picking.test.ts`

**Interfaces:**
- Consumes: `cameraFrame`, `project`, `FOV_DEG`, `CameraState`, `Vec3`, `ViewMode`, `Viewport` (Task 12); `CM`, `worldOf`, `SceneSync` (Task 17).
- Produces: `CameraRig` and `pickItemId` exactly as the contract lists them.

The rig takes the camera's position and orientation from `cameraFrame` — eye, right, up, forward, converted to three's axes — so the two cannot describe different cameras. The cross-check proves it: for five camera states in both modes, `project()` and three's own `Vector3.project(camera)` land within half a pixel of each other on eight sample points, and the test refuses to pass on fewer than 60 comparisons.

- [ ] **Step 1: Write the failing tests**

Create `src/app/(admin)/site/editor/scene/camera-rig.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FOV_DEG, project, type CameraState, type Vec3, type ViewMode } from '@/lib/site/editor/camera';
import { CameraRig } from './camera-rig';
import { CM, worldOf } from './meshes';

const VIEWPORT = { width: 1200, height: 800 };

const STATES: CameraState[] = [
  { targetX: 1300, targetY: 1200, distance: 3000, yaw: 0, pitch: 90 },
  { targetX: 1300, targetY: 1200, distance: 3000, yaw: -26, pitch: 50 },
  { targetX: 500, targetY: 2000, distance: 900, yaw: 135, pitch: 18 },
  { targetX: 2000, targetY: 300, distance: 12_000, yaw: 270, pitch: 89 },
  { targetX: -400, targetY: 2600, distance: 250, yaw: 45, pitch: 60 },
];

const POINTS: Vec3[] = [
  [1300, 1200, 0], [0, 0, 0], [2600, 2400, 0], [2600, 0, 0],
  [1000, 900, 250], [1800, 700, 120], [450, 1950, 30], [2050, 350, 300],
];

/** Where three puts a map point on screen, in CSS pixels from the top-left. */
function threePixel(camera: THREE.Camera, point: Vec3): { x: number; y: number } {
  const ndc = worldOf(point[0], point[1], point[2]).project(camera);
  return { x: ((ndc.x + 1) / 2) * VIEWPORT.width, y: ((1 - ndc.y) / 2) * VIEWPORT.height };
}

describe('the camera rig', () => {
  it('draws exactly what the pure camera maths projects, in both views', () => {
    const rig = new CameraRig();
    let compared = 0;
    for (const mode of ['plan', '3d'] as ViewMode[]) {
      for (const state of STATES) {
        const camera = rig.apply(state, VIEWPORT, mode);
        for (const point of POINTS) {
          const expected = project(state, VIEWPORT, mode, point);
          if (expected === null) continue; // behind a perspective camera
          const actual = threePixel(camera, point);
          expect(Math.abs(actual.x - expected.x), `${mode} ${JSON.stringify(state)} ${point} x`).toBeLessThan(0.5);
          expect(Math.abs(actual.y - expected.y), `${mode} ${JSON.stringify(state)} ${point} y`).toBeLessThan(0.5);
          compared += 1;
        }
      }
    }
    // A cross-check that compared nothing would pass; this one cannot.
    expect(compared).toBeGreaterThanOrEqual(60);
  });

  it('uses the orthographic camera in plan and the perspective one in 3D', () => {
    const rig = new CameraRig();
    expect(rig.apply(STATES[1], VIEWPORT, 'plan')).toBe(rig.orthographic);
    expect(rig.apply(STATES[1], VIEWPORT, '3d')).toBe(rig.perspective);
    expect(rig.perspective.fov).toBe(FOV_DEG);
    expect(rig.perspective.aspect).toBeCloseTo(1.5);
  });

  it('frames plan to what 3D sees at the target, so the switch does not jump', () => {
    const rig = new CameraRig();
    rig.apply(STATES[0], VIEWPORT, 'plan');
    const expected = 2 * STATES[0].distance * CM * Math.tan((FOV_DEG / 2) * (Math.PI / 180));
    expect(rig.orthographic.top - rig.orthographic.bottom).toBeCloseTo(expected, 6);
    expect(rig.orthographic.right - rig.orthographic.left).toBeCloseTo(expected * 1.5, 6);
  });

  it('puts the target in the middle of the screen in both views', () => {
    const rig = new CameraRig();
    for (const mode of ['plan', '3d'] as ViewMode[]) {
      const camera = rig.apply(STATES[1], VIEWPORT, mode);
      const centre = threePixel(camera, [STATES[1].targetX, STATES[1].targetY, 0]);
      expect(centre.x).toBeCloseTo(600, 3);
      expect(centre.y).toBeCloseTo(400, 3);
    }
  });
});
```

Create `src/app/(admin)/site/editor/scene/picking.test.ts` — rays are cast at where `project()` puts a known point: the middle of a caravan, the middle of a tent standing under a net's cloth (the tent must win), a point on the cloth with nothing solid under it, and bare ground:

```ts
import { describe, it, expect } from 'vitest';
import { project, type CameraState, type Vec3, type ViewMode } from '@/lib/site/editor/camera';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import { CameraRig } from './camera-rig';
import { pickItemId } from './picking';
import { SceneSync, type SyncInput } from './scene-sync';

const VIEWPORT = { width: 1000, height: 700 };

function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 0, yCm: 0, widthCm: 300, depthCm: 300,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

/* A net over the north-west corner with a tent under it, a caravan alone to the south-east. */
const ITEMS = [
  item({ id: 'net', kind: 'shade', label: 'רשת צל 1', xCm: 0, yCm: 0, widthCm: 1200, depthCm: 1000, insetCm: 50 }),
  item({ id: 'tent', xCm: 400, yCm: 300 }),
  item({ id: 'caravan', kind: 'caravan', label: 'קראוון 1', xCm: 1600, yCm: 1600, widthCm: 700, depthCm: 250 }),
];

function scene(over: Partial<SyncInput> = {}): SceneSync {
  const doc: EditorDoc = { plot: { id: 'p', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items: ITEMS, defaults: {} };
  const sync = new SceneSync();
  sync.sync({
    doc, preview: new Map(), selection: new Set(), hover: null,
    flags: { outside: new Set(), overlapping: new Set() },
    hiddenGroups: new Set(), netsHidden: false, theme: 'light', ...over,
  });
  return sync;
}

const VIEWS: Array<{ mode: ViewMode; state: CameraState }> = [
  { mode: 'plan', state: { targetX: 1300, targetY: 1200, distance: 4000, yaw: 0, pitch: 90 } },
  { mode: 'plan', state: { targetX: 1300, targetY: 1200, distance: 4000, yaw: 90, pitch: 90 } },
  { mode: '3d', state: { targetX: 1300, targetY: 1200, distance: 4000, yaw: -26, pitch: 50 } },
  { mode: '3d', state: { targetX: 1300, targetY: 1200, distance: 3500, yaw: 200, pitch: 65 } },
];

/** Cast at where the pure maths says a map point is on screen. */
function pickAt(sync: SceneSync, mode: ViewMode, state: CameraState, point: Vec3): string | null {
  const rig = new CameraRig();
  const camera = rig.apply(state, VIEWPORT, mode);
  const at = project(state, VIEWPORT, mode, point);
  if (at === null) throw new Error('point is behind the camera');
  return pickItemId(camera, sync, at.x, at.y, VIEWPORT);
}

describe('picking', () => {
  it('finds the item under its own middle, in plan and in 3D', () => {
    const sync = scene();
    for (const { mode, state } of VIEWS) {
      expect(pickAt(sync, mode, state, [1950, 1725, 135]), `${mode} ${state.yaw}`).toBe('caravan');
    }
  });

  it('prefers a solid item to the net over it', () => {
    const sync = scene();
    for (const { mode, state } of VIEWS) {
      expect(pickAt(sync, mode, state, [550, 450, 100]), `${mode} ${state.yaw}`).toBe('tent');
    }
  });

  it('picks the net where nothing solid is under the cloth', () => {
    const sync = scene();
    for (const { mode, state } of VIEWS) {
      expect(pickAt(sync, mode, state, [1000, 850, 300]), `${mode} ${state.yaw}`).toBe('net');
    }
  });

  it('finds nothing on empty ground', () => {
    const sync = scene();
    for (const { mode, state } of VIEWS) {
      expect(pickAt(sync, mode, state, [2300, 400, 0]), `${mode} ${state.yaw}`).toBeNull();
    }
  });

  it('never picks what is hidden', () => {
    const sync = scene({ netsHidden: true });
    expect(pickAt(sync, 'plan', VIEWS[0].state, [1000, 850, 300])).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run "src/app/(admin)/site/editor/scene/camera-rig.test.ts" "src/app/(admin)/site/editor/scene/picking.test.ts" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — `./camera-rig` and `./picking` cannot be resolved; no tests run.

- [ ] **Step 3: Create `camera-rig.ts`**

```ts
import * as THREE from 'three';
import {
  cameraFrame, FOV_DEG, type CameraState, type Vec3, type ViewMode, type Viewport,
} from '@/lib/site/editor/camera';
import { CM, worldOf } from './meshes';

/** A map direction (x east, y south, z up) as a three direction (x, z, y). No scaling: it has no length unit. */
function direction(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v[0], v[2], v[1]).normalize();
}

/**
 * Applies the camera state the pure maths holds (`camera.ts`) to a real
 * three camera — perspective in 3D, orthographic straight down in plan — so
 * what `project()` computes and what WebGL draws are the same picture. The
 * position and the orientation both come from `cameraFrame`; nothing about
 * the view is decided twice.
 *
 * Plan's frustum is framed to match: half its height is
 * `distance · tan(FOV / 2)`, which is exactly what the perspective camera
 * sees at the target, so switching modes at pitch 90 does not jump.
 */
export class CameraRig {
  readonly perspective = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 1000);
  readonly orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  private readonly basis = new THREE.Matrix4();

  apply(state: CameraState, viewport: Viewport, mode: ViewMode): THREE.Camera {
    const frame = cameraFrame(state, viewport, mode);
    const aspect = viewport.width / Math.max(1, viewport.height);
    const distanceM = state.distance * CM;
    const camera = mode === 'plan' ? this.orthographic : this.perspective;

    camera.position.copy(worldOf(frame.eye[0], frame.eye[1], frame.eye[2]));
    // A camera looks down its own −Z with +Y up and +X right.
    this.basis.makeBasis(direction(frame.right), direction(frame.up), direction(frame.forward).negate());
    camera.quaternion.setFromRotationMatrix(this.basis);

    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = FOV_DEG;
      camera.aspect = aspect;
      // Near scales with distance so the depth buffer stays sharp from 2.5 m to 400 m.
      camera.near = Math.max(0.05, distanceM * 0.02);
      camera.far = distanceM * 3 + 300;
    } else {
      const half = frame.orthoHalfHeight * CM;
      camera.top = half;
      camera.bottom = -half;
      camera.left = -half * aspect;
      camera.right = half * aspect;
      camera.near = 0.1;
      camera.far = distanceM + 300;
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return camera;
  }
}
```

- [ ] **Step 4: Create `picking.ts`**

```ts
import * as THREE from 'three';
import type { Viewport } from '@/lib/site/editor/camera';
import type { SceneSync } from './scene-sync';

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

/** The item a hit belongs to: the nearest ancestor that carries an id. */
function idOf(object: THREE.Object3D | null): string | null {
  for (let node = object; node !== null; node = node.parent) {
    if (typeof node.userData.id === 'string') return node.userData.id;
  }
  return null;
}

/** The first hit on a surface a click may land on — never an edge line, a ground patch or the shade caster. */
function firstItem(hits: readonly THREE.Intersection[]): string | null {
  for (const hit of hits) {
    if (!(hit.object instanceof THREE.Mesh) || hit.object.userData.pick === false) continue;
    const id = idOf(hit.object);
    if (id !== null) return id;
  }
  return null;
}

/**
 * The item under a screen point (spec §7). Solid items first: a shade net is
 * picked only where no tent, sofa or caravan is under the pointer, so a net
 * covering half the lounge never steals the click meant for what is under it.
 * `sx`, `sy` are CSS pixels from the canvas's top-left corner.
 */
export function pickItemId(
  camera: THREE.Camera, sync: SceneSync, sx: number, sy: number, viewport: Viewport,
): string | null {
  pointer.set((sx / viewport.width) * 2 - 1, -(sy / viewport.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return firstItem(raycaster.intersectObjects(sync.solidObjects(), true))
    ?? firstItem(raycaster.intersectObjects(sync.netObjects(), true));
}
```

- [ ] **Step 5: Run the tests, and prove the cross-check can fail**

Run the Step 2 command. Expected: 9 passed (4 + 5), exit 0.

Then, in `camera-rig.ts`, temporarily change `camera.fov = FOV_DEG;` to `camera.fov = FOV_DEG + 1;` and run `camera-rig.test.ts` alone. Expected: "draws exactly what the pure camera maths projects" fails with an x or y off by more than 0.5 px. Restore the line and re-run: 4 passed.

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npx eslint "src/app/(admin)/site/editor/scene"` — expected no problems.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(admin)/site/editor/scene/camera-rig.ts" "src/app/(admin)/site/editor/scene/camera-rig.test.ts" "src/app/(admin)/site/editor/scene/picking.ts" "src/app/(admin)/site/editor/scene/picking.test.ts"
git commit -m "feat(site): the camera rig draws what the camera maths projects, and picking finds solids before nets

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: `gestures.ts`

**Files:**
- Create: `src/app/(admin)/site/editor/scene/gestures.ts`, `src/app/(admin)/site/editor/scene/gestures.test.ts`

**Interfaces:**
- Consumes: `ScreenBox`, `ViewMode` (Task 12); `Handle` (`geometry.ts`).
- Produces: `PointerInput`, `GestureWorld`, `GestureIntent`, `Gestures` exactly as the contract lists them, plus `Gestures.active`.

Every pointer-driven row of spec §8's mouse table has a test against a fake world drawn on graph paper (ten centimetres of ground per pixel): click and label click select; Shift/⌘ toggles; dragging an item selects it, previews and commits the move; Alt asks for no snapping; a handle resizes; dragging bare ground pans with the grabbed point kept under the pointer; Shift-drag draws a selection box that keeps the old selection; right-drag and Ctrl-drag orbit in 3D and pan in plan; a grouped label zooms to its members; an unselected net selects on click and pans on drag; a locked item says why, once; the measure tool draws its line; hover reports the cursor only when it changes. Wheel and double-click are not drags and Task 20's engine handles them; the library's drag starts outside the canvas and reaches the scene through `SceneHandle` (plan 04).

- [ ] **Step 1: Write the failing test**

Create `src/app/(admin)/site/editor/scene/gestures.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ViewMode } from '@/lib/site/editor/camera';
import type { Handle } from '@/lib/site/geometry';
import { Gestures, type GestureWorld, type PointerInput } from './gestures';

/**
 * A world drawn on graph paper: ten centimetres of ground per pixel, and a
 * few things at known screen boxes. The machine never sees `three`.
 */
interface Thing { id: string; isNet: boolean; locked: boolean; box: [number, number, number, number] }

const THINGS: Thing[] = [
  { id: 'tent', isNet: false, locked: false, box: [100, 100, 200, 200] },
  { id: 'sofa', isNet: false, locked: false, box: [300, 100, 360, 140] },
  { id: 'net', isNet: true, locked: false, box: [500, 100, 700, 300] },
  { id: 'kitchen', isNet: false, locked: true, box: [100, 400, 250, 500] },
];

const LABELS = [
  { ids: ['wc1', 'wc2', 'wc3', 'wc4'], group: true, box: [800, 50, 900, 70] as const },
  { ids: ['sofa'], group: false, box: [300, 80, 360, 96] as const },
];

function fakeWorld(over: { selection?: string[]; tool?: 'select' | 'measure'; mode?: ViewMode } = {}) {
  const state = { selection: over.selection ?? [], tool: over.tool ?? 'select', mode: over.mode ?? '3d' as ViewMode };
  const inside = (box: readonly number[], x: number, y: number) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
  const world: GestureWorld = {
    tool: () => state.tool,
    mode: () => state.mode,
    handleAt: (x, y): Handle | null => (state.selection.length === 1 && state.selection[0] === 'tent' && Math.hypot(x - 150, y - 100) <= 7 ? 'n' : null),
    labelAt: (x, y) => LABELS.find((label) => inside(label.box, x, y)) ?? null,
    itemAt: (x, y) => {
      const thing = THINGS.find((entry) => inside(entry.box, x, y));
      return thing === undefined ? null : { id: thing.id, isNet: thing.isNet, locked: thing.locked };
    },
    groundAt: (x, y) => [x * 10, y * 10],
    selection: () => state.selection,
  };
  return { world, state };
}

function pointer(x: number, y: number, over: Partial<PointerInput> = {}): PointerInput {
  return { x, y, button: 0, shift: false, meta: false, ctrl: false, alt: false, ...over };
}

/** Everything the machine said over a whole press, drag and release, hover reports left out. */
function drag(gestures: Gestures, from: [number, number], to: [number, number], over: Partial<PointerInput> = {}) {
  const said = [
    ...gestures.down(pointer(from[0], from[1], over)),
    ...gestures.move(pointer((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, over)),
    ...gestures.move(pointer(to[0], to[1], over)),
    ...gestures.up(pointer(to[0], to[1], over)),
  ];
  return said.filter((intent) => intent.type !== 'hover');
}

describe('clicking', () => {
  it('selects the item under the pointer', () => {
    const gestures = new Gestures(fakeWorld().world);
    expect(drag(gestures, [150, 150], [150, 150])).toEqual([{ type: 'select', ids: ['tent'] }]);
  });

  it('selects an item by its label', () => {
    const gestures = new Gestures(fakeWorld().world);
    expect(drag(gestures, [330, 88], [330, 88])).toEqual([{ type: 'select', ids: ['sofa'] }]);
  });

  it('adds to or removes from the selection with Shift or ⌘', () => {
    const gestures = new Gestures(fakeWorld({ selection: ['sofa'] }).world);
    expect(drag(gestures, [150, 150], [150, 150], { shift: true })).toEqual([{ type: 'toggleSelect', id: 'tent' }]);
    expect(drag(gestures, [330, 120], [330, 120], { meta: true })).toEqual([{ type: 'toggleSelect', id: 'sofa' }]);
  });

  it('clears the selection on a click on empty ground, even with a small tremor', () => {
    const gestures = new Gestures(fakeWorld({ selection: ['tent'] }).world);
    expect(drag(gestures, [1000, 600], [1002, 601])).toEqual([{ type: 'clearSelection' }]);
  });

  it('zooms to a grouped label’s members instead of selecting', () => {
    const gestures = new Gestures(fakeWorld().world);
    expect(drag(gestures, [850, 60], [850, 60])).toEqual([{ type: 'zoomToIds', ids: ['wc1', 'wc2', 'wc3', 'wc4'] }]);
  });
});

describe('dragging an item', () => {
  it('selects it, previews the move on the ground and commits on release', () => {
    const gestures = new Gestures(fakeWorld().world);
    expect(drag(gestures, [150, 150], [170, 140])).toEqual([
      { type: 'select', ids: ['tent'] },
      { type: 'movePreview', ids: ['tent'], dxCm: 100, dyCm: -50, free: false },
      { type: 'movePreview', ids: ['tent'], dxCm: 200, dyCm: -100, free: false },
      { type: 'moveCommit', ids: ['tent'], dxCm: 200, dyCm: -100, free: false },
    ]);
  });

  it('moves the whole selection when the item is already in it', () => {
    const gestures = new Gestures(fakeWorld({ selection: ['tent', 'sofa'] }).world);
    const said = drag(gestures, [150, 150], [150, 190]);
    expect(said.at(-1)).toEqual({ type: 'moveCommit', ids: ['tent', 'sofa'], dxCm: 0, dyCm: 400, free: false });
  });

  it('asks for no snapping while Alt is held', () => {
    const gestures = new Gestures(fakeWorld({ selection: ['tent'] }).world);
    expect(drag(gestures, [150, 150], [160, 150], { alt: true }).at(-1))
      .toEqual({ type: 'moveCommit', ids: ['tent'], dxCm: 100, dyCm: 0, free: true });
  });

  it('does not move a locked item, and says why once', () => {
    const gestures = new Gestures(fakeWorld().world);
    gestures.down(pointer(150, 450));
    const said = [
      ...gestures.move(pointer(170, 450)), ...gestures.move(pointer(190, 450)), ...gestures.up(pointer(190, 450)),
    ].filter((intent) => intent.type !== 'hover');
    expect(said).toEqual([{ type: 'lockedNotice' }]);
  });

  it('commits nothing when the drag is cancelled', () => {
    const gestures = new Gestures(fakeWorld({ selection: ['tent'] }).world);
    gestures.down(pointer(150, 150));
    gestures.move(pointer(190, 150));
    expect(gestures.cancel()).toEqual([]);
    expect(gestures.up(pointer(190, 150))).toEqual([]);
  });
});

describe('a shade net', () => {
  it('that is not selected selects on click but pans on drag', () => {
    const gestures = new Gestures(fakeWorld().world);
    expect(drag(gestures, [600, 200], [600, 200])).toEqual([{ type: 'select', ids: ['net'] }]);
    expect(drag(gestures, [600, 200], [640, 200])).toEqual([
      { type: 'panBy', dxCm: -200, dyCm: 0 },
      { type: 'panBy', dxCm: -400, dyCm: 0 },
    ]);
  });

  it('that is selected moves like anything else', () => {
    const gestures = new Gestures(fakeWorld({ selection: ['net'] }).world);
    expect(drag(gestures, [600, 200], [640, 200]).at(-1))
      .toEqual({ type: 'moveCommit', ids: ['net'], dxCm: 400, dyCm: 0, free: false });
  });
});

describe('resizing', () => {
  it('drags the handle of the one selected item, previewing and then committing', () => {
    const gestures = new Gestures(fakeWorld({ selection: ['tent'] }).world);
    expect(drag(gestures, [150, 100], [150, 80])).toEqual([
      { type: 'resizePreview', id: 'tent', handle: 'n', dxCm: 0, dyCm: -100, free: false },
      { type: 'resizePreview', id: 'tent', handle: 'n', dxCm: 0, dyCm: -200, free: false },
      { type: 'resizeCommit', id: 'tent', handle: 'n', dxCm: 0, dyCm: -200, free: false },
    ]);
  });
});

describe('moving the view', () => {
  it('pans on a drag over empty ground, keeping the grabbed point under the pointer', () => {
    const gestures = new Gestures(fakeWorld().world);
    expect(drag(gestures, [1000, 600], [1100, 650])).toEqual([
      { type: 'panBy', dxCm: -500, dyCm: -250 },
      { type: 'panBy', dxCm: -1000, dyCm: -500 },
    ]);
  });

  it('draws a selection box on Shift + drag over empty ground, keeping what was selected', () => {
    const gestures = new Gestures(fakeWorld({ selection: ['sofa'] }).world);
    expect(drag(gestures, [1000, 600], [900, 700], { shift: true })).toEqual([
      { type: 'marquee', box: { l: 950, t: 600, r: 1000, b: 650 }, base: ['sofa'] },
      { type: 'marquee', box: { l: 900, t: 600, r: 1000, b: 700 }, base: ['sofa'] },
      { type: 'marqueeEnd' },
    ]);
  });

  it('orbits on a right-drag or a Ctrl + drag in 3D, anywhere', () => {
    const gestures = new Gestures(fakeWorld().world);
    expect(drag(gestures, [150, 150], [170, 160], { button: 2 })).toEqual([
      { type: 'orbitBy', dYaw: 10 * 0.35, dPitch: 5 * 0.3 },
      { type: 'orbitBy', dYaw: 10 * 0.35, dPitch: 5 * 0.3 },
    ]);
    expect(drag(gestures, [1000, 600], [980, 600], { ctrl: true })[0]).toEqual({ type: 'orbitBy', dYaw: -10 * 0.35, dPitch: 0 });
  });

  it('pans on a right-drag in plan, where there is nothing to orbit', () => {
    const gestures = new Gestures(fakeWorld({ mode: 'plan' }).world);
    expect(drag(gestures, [1000, 600], [1100, 600], { button: 2 }).at(-1)).toEqual({ type: 'panBy', dxCm: -1000, dyCm: 0 });
  });
});

describe('measuring', () => {
  it('draws a line on the ground from the press to the pointer', () => {
    const gestures = new Gestures(fakeWorld({ tool: 'measure' }).world);
    expect(drag(gestures, [150, 150], [250, 150])).toEqual([
      { type: 'measure', from: [1500, 1500], to: [1500, 1500] },
      { type: 'measure', from: [1500, 1500], to: [2000, 1500] },
      { type: 'measure', from: [1500, 1500], to: [2500, 1500] },
    ]);
  });
});

describe('hovering', () => {
  it('says what is under the pointer through the cursor, only when it changes', () => {
    const gestures = new Gestures(fakeWorld({ selection: ['tent'] }).world);
    expect(gestures.move(pointer(150, 150))).toEqual([{ type: 'hover', id: 'tent', cursor: 'grab' }]);
    expect(gestures.move(pointer(151, 150))).toEqual([]);
    expect(gestures.move(pointer(150, 100))).toEqual([{ type: 'hover', id: null, cursor: 'ns-resize' }]);
    expect(gestures.move(pointer(150, 450))).toEqual([{ type: 'hover', id: 'kitchen', cursor: 'not-allowed' }]);
    expect(gestures.move(pointer(600, 200))).toEqual([{ type: 'hover', id: 'net', cursor: 'pointer' }]);
    expect(gestures.move(pointer(850, 60))).toEqual([{ type: 'hover', id: null, cursor: 'zoom-in' }]);
    expect(gestures.move(pointer(1000, 600))).toEqual([{ type: 'hover', id: null, cursor: 'default' }]);
  });

  it('shows a crosshair while measuring', () => {
    const gestures = new Gestures(fakeWorld({ tool: 'measure' }).world);
    expect(gestures.move(pointer(150, 150))).toEqual([{ type: 'hover', id: null, cursor: 'crosshair' }]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run "src/app/(admin)/site/editor/scene/gestures.test.ts" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — `./gestures` cannot be resolved; no tests run.

- [ ] **Step 3: Implement**

Create `src/app/(admin)/site/editor/scene/gestures.ts` (no `three`, no DOM, no store):

```ts
import type { ScreenBox, ViewMode } from '@/lib/site/editor/camera';
import type { Handle } from '@/lib/site/geometry';

/**
 * The pointer half of spec §8's mouse table, as a state machine with no
 * `three`, no DOM and no store: pointer events in, intents out. `SceneView`
 * answers the world's questions (what is under this pixel, where is the
 * ground) and carries the intents out — snapping, previews, commits.
 *
 * Coordinates are CSS pixels from the canvas's top-left; ground points are
 * map centimetres. Wheel, double-click and the library's drag are not pointer
 * drags on the canvas and are handled by `SceneView` itself.
 */

export interface PointerInput { x: number; y: number; button: number; shift: boolean; meta: boolean; ctrl: boolean; alt: boolean }

export interface GestureWorld {
  tool(): 'select' | 'measure';
  mode(): ViewMode;
  handleAt(x: number, y: number): Handle | null;
  labelAt(x: number, y: number): { ids: string[]; group: boolean } | null;
  itemAt(x: number, y: number): { id: string; isNet: boolean; locked: boolean } | null;
  groundAt(x: number, y: number): [number, number] | null;
  selection(): readonly string[];
}

export type GestureIntent =
  | { type: 'select'; ids: string[] } | { type: 'toggleSelect'; id: string } | { type: 'clearSelection' }
  | { type: 'panBy'; dxCm: number; dyCm: number } | { type: 'orbitBy'; dYaw: number; dPitch: number }
  | { type: 'movePreview'; ids: string[]; dxCm: number; dyCm: number; free: boolean }
  | { type: 'moveCommit'; ids: string[]; dxCm: number; dyCm: number; free: boolean }
  | { type: 'resizePreview'; id: string; handle: Handle; dxCm: number; dyCm: number; free: boolean }
  | { type: 'resizeCommit'; id: string; handle: Handle; dxCm: number; dyCm: number; free: boolean }
  | { type: 'marquee'; box: ScreenBox; base: string[] } | { type: 'marqueeEnd' }
  | { type: 'measure'; from: [number, number]; to: [number, number] }
  | { type: 'zoomToIds'; ids: string[] } | { type: 'lockedNotice' }
  | { type: 'hover'; id: string | null; cursor: string };

/** How far a press may wander and still be a click. */
const CLICK_SLOP_PX = 4;
/** A locked item has to be really dragged before the notice appears. */
const LOCKED_SLOP_PX = 6;
/** Degrees of turn per pixel dragged, as in the mock. */
const YAW_PER_PX = 0.35;
const PITCH_PER_PX = 0.3;

const HANDLE_CURSORS: Record<Handle, string> = {
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
};

type Point = { x: number; y: number };
type ClickAction = { type: 'clear' } | { type: 'select'; id: string } | { type: 'none' };

type Drag =
  | { type: 'pan'; start: Point; grab: [number, number] | null; moved: boolean; click: ClickAction }
  | { type: 'orbit'; last: Point }
  | { type: 'move'; ids: string[]; start: Point; grab: [number, number]; moved: boolean; last: [number, number] }
  | { type: 'resize'; id: string; handle: Handle; start: Point; grab: [number, number]; moved: boolean; last: [number, number] }
  | { type: 'marquee'; start: Point; base: string[]; moved: boolean }
  | { type: 'measure'; from: [number, number] }
  | { type: 'locked'; start: Point; warned: boolean };

function far(a: Point, b: Point, slop: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) >= slop;
}

export class Gestures {
  private drag: Drag | null = null;
  private lastHover: { id: string | null; cursor: string } = { id: null, cursor: 'default' };

  constructor(private readonly world: GestureWorld) {}

  /** Whether a drag is under way — the view reports itself as moving meanwhile. */
  get active(): boolean {
    return this.drag !== null;
  }

  down(p: PointerInput): GestureIntent[] {
    const world = this.world;
    const at = { x: p.x, y: p.y };
    this.drag = null;

    if (p.button === 2 || (p.button === 0 && p.ctrl)) {
      this.drag = world.mode() === '3d'
        ? { type: 'orbit', last: at }
        : { type: 'pan', start: at, grab: world.groundAt(p.x, p.y), moved: false, click: { type: 'none' } };
      return [];
    }
    if (p.button === 1) {
      this.drag = { type: 'pan', start: at, grab: world.groundAt(p.x, p.y), moved: false, click: { type: 'none' } };
      return [];
    }
    if (p.button !== 0) return [];

    if (world.tool() === 'measure') {
      const from = world.groundAt(p.x, p.y);
      if (from === null) return [];
      this.drag = { type: 'measure', from };
      return [{ type: 'measure', from, to: from }];
    }

    const handle = world.handleAt(p.x, p.y);
    const selected = world.selection();
    if (handle !== null && selected.length === 1) {
      const grab = world.groundAt(p.x, p.y);
      if (grab === null) return [];
      this.drag = { type: 'resize', id: selected[0], handle, start: at, grab, moved: false, last: [0, 0] };
      return [];
    }

    const label = world.labelAt(p.x, p.y);
    if (label !== null && label.group) return [{ type: 'zoomToIds', ids: [...label.ids] }];
    if (label !== null) {
      const id = label.ids[0];
      if (p.shift || p.meta) return [{ type: 'toggleSelect', id }];
      // A label selects on click; dragged, it moves the view like the ground under it.
      this.drag = { type: 'pan', start: at, grab: world.groundAt(p.x, p.y), moved: false, click: { type: 'select', id } };
      return [];
    }

    const item = world.itemAt(p.x, p.y);
    if (item !== null) {
      const already = selected.includes(item.id);
      if (p.shift || p.meta) return [{ type: 'toggleSelect', id: item.id }];
      // A net nobody chose is ground to pan across; a click still selects it (spec §8).
      if (item.isNet && !already) {
        this.drag = { type: 'pan', start: at, grab: world.groundAt(p.x, p.y), moved: false, click: { type: 'select', id: item.id } };
        return [];
      }
      const intents: GestureIntent[] = already ? [] : [{ type: 'select', ids: [item.id] }];
      if (item.locked) {
        this.drag = { type: 'locked', start: at, warned: false };
        return intents;
      }
      const grab = world.groundAt(p.x, p.y);
      if (grab !== null) {
        this.drag = { type: 'move', ids: already ? [...selected] : [item.id], start: at, grab, moved: false, last: [0, 0] };
      }
      return intents;
    }

    if (p.shift) {
      this.drag = { type: 'marquee', start: at, base: [...selected], moved: false };
      return [];
    }
    this.drag = { type: 'pan', start: at, grab: world.groundAt(p.x, p.y), moved: false, click: { type: 'clear' } };
    return [];
  }

  move(p: PointerInput): GestureIntent[] {
    const drag = this.drag;
    const at = { x: p.x, y: p.y };
    if (drag === null) return this.hover(p);

    switch (drag.type) {
      case 'orbit': {
        const intent: GestureIntent = { type: 'orbitBy', dYaw: (p.x - drag.last.x) * YAW_PER_PX, dPitch: (p.y - drag.last.y) * PITCH_PER_PX };
        drag.last = at;
        return [intent];
      }
      case 'pan': {
        if (!drag.moved && !far(drag.start, at, CLICK_SLOP_PX)) return [];
        drag.moved = true;
        const ground = this.world.groundAt(p.x, p.y);
        if (drag.grab === null || ground === null) return [];
        // Keep the grabbed ground point under the pointer.
        return [{ type: 'panBy', dxCm: drag.grab[0] - ground[0], dyCm: drag.grab[1] - ground[1] }];
      }
      case 'move': {
        if (!drag.moved && !far(drag.start, at, CLICK_SLOP_PX)) return [];
        drag.moved = true;
        const ground = this.world.groundAt(p.x, p.y);
        if (ground !== null) drag.last = [ground[0] - drag.grab[0], ground[1] - drag.grab[1]];
        return [{ type: 'movePreview', ids: drag.ids, dxCm: drag.last[0], dyCm: drag.last[1], free: p.alt }];
      }
      case 'resize': {
        if (!drag.moved && !far(drag.start, at, 1)) return [];
        drag.moved = true;
        const ground = this.world.groundAt(p.x, p.y);
        if (ground !== null) drag.last = [ground[0] - drag.grab[0], ground[1] - drag.grab[1]];
        return [{ type: 'resizePreview', id: drag.id, handle: drag.handle, dxCm: drag.last[0], dyCm: drag.last[1], free: p.alt }];
      }
      case 'marquee': {
        if (!drag.moved && !far(drag.start, at, CLICK_SLOP_PX)) return [];
        drag.moved = true;
        const box: ScreenBox = {
          l: Math.min(drag.start.x, p.x), t: Math.min(drag.start.y, p.y),
          r: Math.max(drag.start.x, p.x), b: Math.max(drag.start.y, p.y),
        };
        return [{ type: 'marquee', box, base: drag.base }];
      }
      case 'measure': {
        const to = this.world.groundAt(p.x, p.y);
        return to === null ? [] : [{ type: 'measure', from: drag.from, to }];
      }
      case 'locked': {
        if (drag.warned || !far(drag.start, at, LOCKED_SLOP_PX)) return [];
        drag.warned = true;
        return [{ type: 'lockedNotice' }];
      }
    }
  }

  up(p: PointerInput): GestureIntent[] {
    const drag = this.drag;
    this.drag = null;
    if (drag === null) return [];
    const settle = this.hover(p);

    switch (drag.type) {
      case 'pan': {
        if (drag.moved) return settle;
        if (drag.click.type === 'clear') return [{ type: 'clearSelection' }, ...settle];
        if (drag.click.type === 'select') return [{ type: 'select', ids: [drag.click.id] }, ...settle];
        return settle;
      }
      case 'move': {
        if (!drag.moved) return settle;
        const ground = this.world.groundAt(p.x, p.y);
        const [dxCm, dyCm] = ground === null ? drag.last : [ground[0] - drag.grab[0], ground[1] - drag.grab[1]];
        return [{ type: 'moveCommit', ids: drag.ids, dxCm, dyCm, free: p.alt }, ...settle];
      }
      case 'resize': {
        if (!drag.moved) return settle;
        const ground = this.world.groundAt(p.x, p.y);
        const [dxCm, dyCm] = ground === null ? drag.last : [ground[0] - drag.grab[0], ground[1] - drag.grab[1]];
        return [{ type: 'resizeCommit', id: drag.id, handle: drag.handle, dxCm, dyCm, free: p.alt }, ...settle];
      }
      case 'marquee':
        return drag.moved ? [{ type: 'marqueeEnd' }, ...settle] : settle;
      default:
        return settle;
    }
  }

  /** The pointer left, the window lost focus, or the browser took the pointer: nothing commits. */
  cancel(): GestureIntent[] {
    const drag = this.drag;
    this.drag = null;
    return drag !== null && drag.type === 'marquee' && drag.moved ? [{ type: 'marqueeEnd' }] : [];
  }

  /** What is under the pointer and how the cursor says so — reported only when it changes. */
  private hover(p: PointerInput): GestureIntent[] {
    const world = this.world;
    let next: { id: string | null; cursor: string };
    if (world.tool() === 'measure') {
      next = { id: null, cursor: 'crosshair' };
    } else {
      const handle = world.selection().length === 1 ? world.handleAt(p.x, p.y) : null;
      const label = handle === null ? world.labelAt(p.x, p.y) : null;
      const item = handle === null && label === null ? world.itemAt(p.x, p.y) : null;
      if (handle !== null) next = { id: null, cursor: HANDLE_CURSORS[handle] };
      else if (label !== null && label.group) next = { id: null, cursor: 'zoom-in' };
      else if (label !== null) next = { id: label.ids[0], cursor: 'pointer' };
      else if (item === null) next = { id: null, cursor: 'default' };
      else if (item.locked) next = { id: item.id, cursor: 'not-allowed' };
      else if (item.isNet && !world.selection().includes(item.id)) next = { id: item.id, cursor: 'pointer' };
      else next = { id: item.id, cursor: 'grab' };
    }
    if (next.id === this.lastHover.id && next.cursor === this.lastHover.cursor) return [];
    this.lastHover = next;
    return [{ type: 'hover', ...next }];
  }
}
```

- [ ] **Step 4: Run the test**

Run the Step 2 command. Expected: 20 passed, exit 0.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npx eslint "src/app/(admin)/site/editor/scene/gestures.ts" "src/app/(admin)/site/editor/scene/gestures.test.ts"` — expected no problems.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(admin)/site/editor/scene/gestures.ts" "src/app/(admin)/site/editor/scene/gestures.test.ts"
git commit -m "feat(site): the map's pointer gestures as a state machine — pointer events in, intents out

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 20: `SceneView`, `LabelsLayer`, the bare editor at `/site?editor=3d`, first browser check

**Files:**
- Create: `src/app/(admin)/site/editor/scene/scene.module.css`
- Create: `src/app/(admin)/site/editor/scene/overlay.ts`
- Create: `src/app/(admin)/site/editor/scene/labels-layer.tsx`, `src/app/(admin)/site/editor/scene/labels-layer.test.tsx`
- Create: `src/app/(admin)/site/editor/scene/engine.ts`
- Create: `src/app/(admin)/site/editor/scene/scene-view.tsx`, `src/app/(admin)/site/editor/scene/scene-view.test.tsx`
- Create: `src/app/(admin)/site/editor/scene-preview.tsx` (**temporary** — Task 26 deletes it)
- Create: `src/lib/site/views.test.ts`
- Modify: `src/lib/site/views.ts` (`SiteQuery.editor3d`)
- Modify: `src/app/(admin)/site/page.tsx` (replaced whole, below), `src/app/(admin)/site/page.test.tsx`

**Interfaces:**
- Consumes: everything above; `fitRect`, `groundAt`, `interpolate`, `orbit`, `panBy`, `project`, `pxPerCm`, `zoomAt` (Task 12); `layoutLabels`, `LabelInput`, `PlacedLabel` (Task 13); `moveOps`, `setRectOps` (Task 10); `snapMove`, `snapResize`, `GuideLine` (Task 11); `CAMP_SITE`, `jerusalemInstant`, `sunPosition`, `sunDirection` (Task 14); `contains`, `formatMetres`, `formatSize`, `gapsAround`, `overlap`, `unionRect` (`geometry.ts`); `effectiveSize`, `itemHeight` (Task 3); `loadDoc` (Task 6); `saveSiteChangesAction`, `loadSiteDocAction` (Task 7).
- Produces: `EditorUi`, `ViewInfo`, `Insets`, `SceneHandle`, `SceneViewProps`, `SceneView`, `LabelsLayerHandle`, `LabelsLayer` exactly as the contract lists them; `NO_WEBGL`; `SceneEngine`; `OverlayLayer`; `ScenePreview({ initial })`; `SiteQuery.editor3d`.

What `SceneView` owns, and where in `engine.ts` it lives:
- **Renderer:** `WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })` (the PNG export reads the drawing buffer), pixel ratio ≤ 2, shadow map on; created first, so a browser without WebGL throws before anything is attached and `SceneView` shows `NO_WEBGL` instead (no English, nothing else).
- **Size:** a `ResizeObserver` on the stage; the first non-empty size frames the plot (`fitRect`, yaw −26°/pitch 50° in 3D, north up in plan).
- **Frames:** only when something changed — the camera, the store's doc/selection/flags, the UI, a preview, the hover — plus while an animation runs. A frame syncs the scene, renders, recomputes handles, re-lays labels only if the camera, items, selection, hover, viewport or labels toggle changed, then redraws the overlay.
- **Input:** pointer events through `Gestures`; wheel and pinch (`ctrlKey` wheel) zoom toward the pointer; double-click selects and flies to an item; the context menu is suppressed for right-drag orbit.
- **Snapping and previews:** a drag moves only a preview map — the store is untouched until the drop, which is one `store.run('הזזה', moveOps(…))` (or `'שינוי גודל'`, `setRectOps`). Snapping is `snapMove`/`snapResize` with `ui.snap` and Alt (free), the guide threshold 9 screen px in centimetres. Guides and the gaps to neighbours and the fence (single item) are drawn while moving; the new size is shown while resizing.
- **Overlay** (`overlay.ts`, plain DOM, token colours): handles for one unlocked, visible selected item (none while the camera flies), guides, gap and measure lines with their readouts, the selection box, the ghost's verdict ("מחוץ לגדר" / "חפיפה עם פריט אחר" / kind and size), and the dots under a grouped label.
- **Labels:** `layoutLabels` with the caller's duties from plan 02 — items under 3 px dropped unless selected or hovered; the single selected item's text gains its size; a net anchored on the middle of its north edge; selected, hovered, flagged items and nets never grouped; handles as obstacles; the safe area (viewport minus insets) as bounds; last frame's slots as `previous`. `LabelsLayer` moves one DOM node per label with a transform.
- **Modes:** to plan, the perspective camera tilts to 90° (yaw to the nearest quarter turn) and then the orthographic one takes over; to 3D, the swap comes first and then the tilt down (to 50°, yaw −26°). `onModeSettled` when it lands.
- **Sun:** with `ui.sun` and a `sunDate` in `YYYY-MM-DD`, the directional light is the sun at `ui.hour` (`sunPosition(jerusalemInstant(…), CAMP_SITE…)`, `sunDirection(…, plot.northDeg)`) and casts shadows over the plot; a sun below the horizon puts the light out. Otherwise a fixed light from the north-west, no shadows.
- **ViewInfo:** at most ten a second while moving (camera, animation or a drag), `selectionBox: null` meanwhile, then once more when the view has been still for 160 ms.
- **Context loss:** `webglcontextlost` stops the frames and tells `onNotice` in Hebrew; `webglcontextrestored` rebuilds the scene from the store.

- [ ] **Step 1: Confirm the `next/dynamic` form against this Next.js**

Read `/Users/yarin/GitProjects/Shliff_Platform/node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`, sections "Skipping SSR" and "Importing Server Components". Expected: `ssr: false` is allowed only inside a Client Component; a Server Component that uses it errors. That is why `page.tsx` (a Server Component) renders `ScenePreview` (a Client Component) and only `ScenePreview` calls `dynamic(() => import('./scene/scene-view').then((m) => m.SceneView), { ssr: false })`. If the doc says otherwise, stop and tell the camp lead before writing Step 10.

- [ ] **Step 2: Write the failing tests**

Create `src/app/(admin)/site/editor/scene/labels-layer.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { createRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import type { PlacedLabel } from '@/lib/site/editor/label-layout';
import { LabelsLayer, type LabelsLayerHandle } from './labels-layer';

const TENT: PlacedLabel = {
  key: 'a', ids: ['a'], text: 'אוהל 1', rect: { l: 10, t: 20, r: 90, b: 42 },
  anchor: [50, 31], leader: false, group: false, slot: 'in',
};
const TOILETS: PlacedLabel = {
  key: 'group:toilet', ids: ['w1', 'w2', 'w3', 'w4'], text: '4 תאי שירותים', rect: { l: 200, t: 100, r: 310, b: 122 },
  anchor: [255, 150], leader: true, group: true, slot: 'n',
};

function setup() {
  const ref = createRef<LabelsLayerHandle>();
  const view = render(<LabelsLayer ref={ref} />);
  const update = (placed: PlacedLabel[], selection: string[] = []) => {
    act(() => { ref.current?.update(placed, new Set(selection)); });
  };
  return { ...view, update };
}

describe('the labels layer', () => {
  it('puts each label in the rectangle the layout gave it', () => {
    const { update } = setup();
    update([TENT, TOILETS], ['a']);

    const tent = screen.getByText('אוהל 1');
    expect(tent.style.transform).toBe('translate(10px, 20px)');
    expect(tent.style.width).toBe('80px');
    expect(tent.style.height).toBe('22px');
    expect(tent.dataset.selected).toBe('true');

    const group = screen.getByText('4 תאי שירותים');
    expect(group.dataset.group).toBe('true');
    expect(group.dataset.selected).toBe('false');
  });

  it('draws a leader from the item to the nearest edge of a label that sits outside it', () => {
    const { container, update } = setup();
    update([TENT, TOILETS]);
    const lines = container.querySelectorAll('line');
    expect(lines).toHaveLength(1);
    expect([...['x1', 'y1', 'x2', 'y2']].map((name) => lines[0].getAttribute(name))).toEqual(['255', '150', '255', '122']);
  });

  it('moves a label that stays and removes one that went, without recreating the first', () => {
    const { container, update } = setup();
    update([TENT, TOILETS]);
    const tent = screen.getByText('אוהל 1');

    update([{ ...TENT, rect: { l: 30, t: 40, r: 110, b: 62 } }]);

    expect(screen.getByText('אוהל 1')).toBe(tent);
    expect(tent.style.transform).toBe('translate(30px, 40px)');
    expect(screen.queryByText('4 תאי שירותים')).toBeNull();
    expect(container.querySelectorAll('line')).toHaveLength(0);
  });

  it('changes the text in place when the selection adds a size', () => {
    const { update } = setup();
    update([TENT]);
    const tent = screen.getByText('אוהל 1');
    update([{ ...TENT, text: 'אוהל 1 · 3 × 3 מ׳' }], ['a']);
    expect(screen.getByText('אוהל 1 · 3 × 3 מ׳')).toBe(tent);
  });

  it('empties when there is nothing to label', () => {
    const { container, update } = setup();
    update([TENT, TOILETS]);
    update([]);
    expect(container.textContent).toBe('');
  });
});
```

Create `src/app/(admin)/site/editor/scene/scene-view.test.tsx`. `three`'s `WebGLRenderer` is replaced: in the first test it throws, as it does in a browser without WebGL — and the test checks the constructor really ran, so it cannot pass by never reaching the renderer; in the others it stands in for a GPU and counts frames, which exercises the engine end to end in jsdom (framing, labels, picking, the click path):

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { EditorDoc } from '@/lib/site/editor/model';
import type { EditorStore } from '../use-editor-store';

/* jsdom has no WebGL. Each test decides what the renderer does: throw, as a
   browser without WebGL does, or stand in for a GPU and count its frames. */
const { renderer } = vi.hoisted(() => ({
  renderer: { fails: false, created: 0, frames: 0 },
}));
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class WebGLRenderer {
    shadowMap = { enabled: false };
    constructor() {
      renderer.created += 1;
      if (renderer.fails) throw new Error('Error creating WebGL context.');
    }
    setPixelRatio() {}
    setSize() {}
    render() { renderer.frames += 1; }
    dispose() {}
    forceContextLoss() {}
  }
  return { ...actual, WebGLRenderer };
});

import { NO_WEBGL, SceneView, type EditorUi } from './scene-view';

const UI: EditorUi = {
  tool: 'select', mode: '3d', labels: true, sun: false, netsHidden: false,
  snap: true, hiddenGroups: [], hour: 14, theme: 'light',
};

const DOC: EditorDoc = {
  plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 },
  items: [{
    id: 'tent', kind: 'tent', label: 'אוהל 1', xCm: 1150, yCm: 1050, widthCm: 300, depthCm: 300,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false,
  }],
  defaults: {},
};

function fakeStore(over: Partial<EditorStore> = {}): EditorStore {
  return {
    doc: DOC, selection: [], canUndo: false, canRedo: false,
    flags: { outside: new Set(), overlapping: new Set(), partly: new Set(), pairs: [] },
    save: { status: 'saved', version: 0, pending: 0, error: null }, conflict: null, notice: null,
    run: vi.fn(), undo: vi.fn(() => null), redo: vi.fn(() => null), select: vi.fn(),
    resolveConflict: vi.fn(async () => {}), retrySave: vi.fn(), dismissNotice: vi.fn(),
    ...over,
  };
}

function renderScene(store = fakeStore(), ui: EditorUi = UI) {
  const onView = vi.fn();
  const view = render(
    <SceneView store={store} ui={ui} insets={{ left: 0, right: 0, top: 0, bottom: 0 }}
      sunDate={null} onView={onView} onNotice={vi.fn()} />,
  );
  return { ...view, onView, store };
}

const realRect = Element.prototype.getBoundingClientRect;
const realGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  Object.assign(renderer, { fails: false, created: 0, frames: 0 });
  /* No 2D canvas either: labels are measured by an estimate, quietly. */
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof realGetContext;
  /* jsdom lays nothing out: give the scene a 1000 × 700 box. */
  Element.prototype.getBoundingClientRect = () => ({
    width: 1000, height: 700, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 700, toJSON: () => ({}),
  });
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect;
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

describe('the 3D map without WebGL', () => {
  it('says in Hebrew that it needs 3D graphics, and draws nothing', () => {
    renderer.fails = true;
    const { container } = renderScene();
    expect(renderer.created).toBeGreaterThan(0);
    expect(screen.getByText('המפה צריכה דפדפן עם גרפיקה תלת־ממדית פעילה.')).toBeTruthy();
    expect(NO_WEBGL).toBe('המפה צריכה דפדפן עם גרפיקה תלת־ממדית פעילה.');
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.textContent).not.toMatch(/[A-Za-z]/);
  });
});

describe('the 3D map with WebGL', () => {
  it('draws a frame, labels the item and reports a settled view', async () => {
    const { container, onView } = renderScene();
    expect(container.querySelector('canvas')).not.toBeNull();
    await waitFor(() => { expect(onView).toHaveBeenCalled(); });
    expect(renderer.frames).toBeGreaterThan(0);
    expect(onView.mock.calls.at(-1)?.[0]).toMatchObject({ moving: false, zoomPct: 100, selectionBox: null });
    expect(screen.getByText('אוהל 1')).toBeTruthy();
  });

  /* Plan view frames the plot's middle exactly at the screen's middle, so the
     tent at the plot's middle is under (500, 350) and the corner is bare ground. */
  const PLAN: EditorUi = { ...UI, mode: 'plan' };

  it('clears the selection on a click on empty ground', async () => {
    const { container, onView, store } = renderScene(fakeStore({ selection: ['tent'] }), PLAN);
    await waitFor(() => { expect(onView).toHaveBeenCalled(); });
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 690, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 5, clientY: 690, button: 0, pointerId: 1 });
    expect(store.select).toHaveBeenCalledWith([]);
  });

  it('selects the item under a click', async () => {
    const { container, onView, store } = renderScene(fakeStore(), PLAN);
    await waitFor(() => { expect(onView).toHaveBeenCalled(); });
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    fireEvent.pointerDown(canvas, { clientX: 500, clientY: 350, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 500, clientY: 350, button: 0, pointerId: 1 });
    expect(store.select).toHaveBeenCalledWith(['tent']);
  });
});
```

Create `src/lib/site/views.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseSiteQuery } from './views';

describe('the camp map’s address', () => {
  it('asks for the 3D map only with ?editor=3d', () => {
    expect(parseSiteQuery({ season: 's26', editor: '3d' }).editor3d).toBe(true);
    expect(parseSiteQuery({ editor: ['3d', '2d'] }).editor3d).toBe(true);
    expect(parseSiteQuery({ season: 's26' }).editor3d).toBe(false);
    expect(parseSiteQuery({ editor: '2d' }).editor3d).toBe(false);
    expect(parseSiteQuery({ editor: '' }).editor3d).toBe(false);
  });
});
```

In `src/app/(admin)/site/page.test.tsx`, make four changes.

Replace the first `vi.hoisted` block:

```tsx
const { requireAdmin, resolveSeason, siteView, seasonsWithPlans, itemById, listTasks } = vi.hoisted(() => ({
  requireAdmin: vi.fn(), resolveSeason: vi.fn(), siteView: vi.fn(),
  seasonsWithPlans: vi.fn(), itemById: vi.fn(), listTasks: vi.fn(),
}));
```

with:

```tsx
const { requireAdmin, resolveSeason, siteView, seasonsWithPlans, itemById, listTasks, loadDoc } = vi.hoisted(() => ({
  requireAdmin: vi.fn(), resolveSeason: vi.fn(), siteView: vi.fn(),
  seasonsWithPlans: vi.fn(), itemById: vi.fn(), listTasks: vi.fn(), loadDoc: vi.fn(),
}));
```

In the `vi.mock('@/lib/site/plan', …)` factory, replace `  siteView, seasonsWithPlans, itemById,` with `  siteView, seasonsWithPlans, itemById, loadDoc,`.

After the `vi.mock('./site-board', …)` block, add:

```tsx
/* The 3D map has its own tests (editor/scene/*.test.tsx); here only what the page hands it. */
vi.mock('./editor/scene-preview', () => ({
  ScenePreview: ({ initial }: { initial: { doc: { items: unknown[] }; version: number } }) => (
    <div data-testid="scene-preview">{`preview:${initial.doc.items.length}:v${initial.version}`}</div>
  ),
}));
```

In `beforeEach`, after `listTasks.mockResolvedValue([]);`, add `  loadDoc.mockResolvedValue(null);`.

Inside `describe('the camp map screen', …)`, before `it('is not found for a signed-in non-admin', …)`, add:

```tsx
  describe('behind ?editor=3d', () => {
    const LOADED = {
      version: 4,
      doc: {
        plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 },
        items: [{ id: 'a' }, { id: 'b' }],
        defaults: {},
      },
    };

    it('mounts the 3D map with the document the editor saves against, instead of the board', async () => {
      siteView.mockResolvedValue(view([item({ id: 'a' }), item({ id: 'b', label: 'אוהל 2' })]));
      loadDoc.mockResolvedValue(LOADED);
      await renderPage({ editor: '3d' });

      expect(loadDoc).toHaveBeenCalledWith({}, 'p1');
      expect(screen.getByTestId('scene-preview').textContent).toBe('preview:2:v4');
      expect(screen.queryByTestId('board')).toBeNull();
      expect(screen.queryByRole('table', { name: 'הפריטים במפה' })).toBeNull();
      expect(screen.getByRole('link', { name: /גודל המגרש/ }).getAttribute('href')).toBe('/site?season=s26&act=plot');
    });

    it('still opens the plot drawer over it', async () => {
      siteView.mockResolvedValue(view([item({ id: 'a' })]));
      loadDoc.mockResolvedValue(LOADED);
      await renderPage({ editor: '3d', act: 'plot' });
      expect(screen.getByTestId('scene-preview')).toBeTruthy();
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('keeps the board for any other value of ?editor', async () => {
      siteView.mockResolvedValue(view([item({ id: 'a' })]));
      await renderPage({ editor: '2d' });
      expect(screen.getByTestId('board')).toBeTruthy();
      expect(loadDoc).not.toHaveBeenCalled();
    });

    it('falls back to the board when the plan vanished between the two reads', async () => {
      siteView.mockResolvedValue(view([item({ id: 'a' })]));
      loadDoc.mockResolvedValue(null);
      await renderPage({ editor: '3d' });
      expect(screen.queryByTestId('scene-preview')).toBeNull();
      expect(screen.getByTestId('board')).toBeTruthy();
    });
  });
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run "src/app/(admin)/site/editor/scene/labels-layer.test.tsx" "src/app/(admin)/site/editor/scene/scene-view.test.tsx" src/lib/site/views.test.ts "src/app/(admin)/site/page.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: FAIL — `./labels-layer` and `./scene-view` cannot be resolved; `views.test.ts` fails (`expected undefined to be true`); in `page.test.tsx` the two tests that expect `scene-preview` fail (or the whole file, if vitest will not mock a path that does not exist yet — either is the expected red). The 11 existing page tests are unchanged.

- [ ] **Step 4: Create `scene.module.css`**

Create `src/app/(admin)/site/editor/scene/scene.module.css`:

```css
/* The 3D map's DOM layers: the canvas, the marks drawn over it, the labels.
   Colours come from tokens.css only; the scene's own WebGL colours are data
   in palette.ts, because WebGL cannot read a custom property.

   Screen positions here are physical (left/top, x/y): they are pixels on a
   picture of the ground, and the map never mirrors for RTL. */

.scene {
  position: relative;
  inline-size: 100%;
  block-size: 100%;
  min-block-size: 360px;
  overflow: hidden;
  background: var(--canvas);
}

.stage {
  position: absolute;
  inset: 0;
}

/* `touch-action: none` on the canvas only: a finger on the map moves the
   map, a finger on the panels still scrolls them. */
.canvas {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  outline: none;
}

.overlay,
.pills,
.labels,
.leaders {
  position: absolute;
  inset: 0;
  inline-size: 100%;
  block-size: 100%;
  pointer-events: none;
  overflow: hidden;
}

.handle { fill: var(--panel); stroke: var(--focus); stroke-width: 1.6; }
.guide { fill: none; stroke: var(--info); stroke-width: 1.2; stroke-dasharray: 6 4; }
.gap { fill: none; stroke: var(--info); stroke-width: 1.3; }
.measure { fill: none; stroke: var(--info); stroke-width: 2; }
.marquee {
  fill: color-mix(in srgb, var(--focus) 8%, transparent);
  stroke: var(--focus);
  stroke-width: 1;
  stroke-dasharray: 4 3;
}
.dot { fill: var(--info); }
.member { fill: var(--ink-3); }

.pill {
  position: absolute;
  left: 0;
  top: 0;
  padding-block: 1px;
  padding-inline: var(--space-2);
  border-radius: var(--radius-pill);
  font-size: var(--text-label);
  font-weight: 600;
  line-height: 16px;
  white-space: nowrap;
  color: var(--panel);
}
.pillGuide { background: var(--info); }
.pillFocus { background: var(--focus); }
.pillBad { background: var(--bad); }

/* One label. Its box is the one label-layout.ts placed; the engine measures
   text at this size and weight (`engine.ts`, LABEL_FONT_PX, LABEL_PAD_PX). */
.label {
  position: absolute;
  left: 0;
  top: 0;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-inline: var(--space-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--panel) 94%, transparent);
  color: var(--ink);
  font-size: var(--text-meta);
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}
.label[data-selected='true'] { border-color: var(--focus); background: var(--brand-soft); }
.label[data-group='true'] { border-style: dashed; }

.leader { stroke: var(--ink-4); stroke-width: 1; }
.leaderSelected { stroke: var(--focus); }

/* No WebGL: said in words, where the map would be. */
.fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: var(--space-6);
  color: var(--ink-2);
  font-size: var(--text-body);
  text-align: center;
}

/* The temporary /site?editor=3d page (Task 20; Task 26 retires it). */
.preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-block-size: 0;
}
.previewScene {
  position: relative;
  block-size: calc(100dvh - 180px);
  min-block-size: 480px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  overflow: hidden;
}
.previewStatus {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  color: var(--ink-2);
  font-size: var(--text-meta);
}
```

- [ ] **Step 5: Create `overlay.ts`**

Create `src/app/(admin)/site/editor/scene/overlay.ts`:

```ts
import type { ScreenBox } from '@/lib/site/editor/camera';

/**
 * The flat marks drawn over the scene in screen space: resize handles, snap
 * guides, gap and measure lines with their readouts, the selection box, the
 * dots under a grouped label. Plain DOM, redrawn by the engine after each
 * frame — never through React, which would re-render the editor sixty times
 * a second during a drag. Colours are classes from `scene.module.css`, so
 * they come from `tokens.css` and follow the theme.
 */

export interface OverlayClasses {
  overlay: string;
  handle: string;
  guide: string;
  gap: string;
  measure: string;
  marquee: string;
  dot: string;
  member: string;
  pills: string;
  pill: string;
  pillGuide: string;
  pillFocus: string;
  pillBad: string;
}

export interface OverlayModel {
  handles: Array<{ x: number; y: number }>;
  lines: Array<{ from: [number, number]; to: [number, number]; kind: 'guide' | 'gap' | 'measure' }>;
  dots: Array<{ x: number; y: number; kind: 'measure' | 'member' }>;
  pills: Array<{ x: number; y: number; text: string; tone: 'guide' | 'focus' | 'bad' }>;
  marquee: ScreenBox | null;
}

export const EMPTY_OVERLAY: OverlayModel = { handles: [], lines: [], dots: [], pills: [], marquee: null };

const SVG = 'http://www.w3.org/2000/svg';

function svg(name: string, attributes: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

export class OverlayLayer {
  private readonly svg: SVGSVGElement;
  private readonly pills: HTMLDivElement;

  constructor(parent: HTMLElement, private readonly classes: OverlayClasses) {
    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.setAttribute('class', classes.overlay);
    this.svg.setAttribute('aria-hidden', 'true');
    this.pills = document.createElement('div');
    this.pills.className = classes.pills;
    this.pills.setAttribute('aria-hidden', 'true');
    parent.append(this.svg, this.pills);
  }

  draw(model: OverlayModel): void {
    const c = this.classes;
    const marks: SVGElement[] = [];
    if (model.marquee !== null) {
      const box = model.marquee;
      marks.push(svg('rect', { class: c.marquee, x: box.l, y: box.t, width: box.r - box.l, height: box.b - box.t }));
    }
    for (const line of model.lines) {
      marks.push(svg('line', {
        class: c[line.kind], x1: line.from[0], y1: line.from[1], x2: line.to[0], y2: line.to[1],
      }));
    }
    for (const dot of model.dots) {
      marks.push(svg('circle', { class: dot.kind === 'measure' ? c.dot : c.member, cx: dot.x, cy: dot.y, r: dot.kind === 'measure' ? 3.5 : 2.6 }));
    }
    for (const handle of model.handles) {
      marks.push(svg('rect', { class: c.handle, x: handle.x - 4.5, y: handle.y - 4.5, width: 9, height: 9, rx: 1.5 }));
    }
    this.svg.replaceChildren(...marks);

    const pills = model.pills.map((pill) => {
      const node = document.createElement('div');
      node.className = `${c.pill} ${pill.tone === 'bad' ? c.pillBad : pill.tone === 'focus' ? c.pillFocus : c.pillGuide}`;
      node.textContent = pill.text;
      node.style.transform = `translate(${Math.round(pill.x)}px, ${Math.round(pill.y)}px) translate(-50%, -50%)`;
      return node;
    });
    this.pills.replaceChildren(...pills);
  }

  dispose(): void {
    this.svg.remove();
    this.pills.remove();
  }
}
```

- [ ] **Step 6: Create `labels-layer.tsx`**

Create `src/app/(admin)/site/editor/scene/labels-layer.tsx`:

```tsx
'use client';

import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { PlacedLabel } from '@/lib/site/editor/label-layout';
import styles from './scene.module.css';

export interface LabelsLayerHandle {
  update(placed: readonly PlacedLabel[], selection: ReadonlySet<string>): void;
}

/** The point of a rectangle nearest to `p` — where a leader line meets its label. */
function nearest(p: [number, number], rect: PlacedLabel['rect']): [number, number] {
  return [Math.min(Math.max(p[0], rect.l), rect.r), Math.min(Math.max(p[1], rect.t), rect.b)];
}

/**
 * The item labels over the scene (spec §9). It decides nothing: the engine
 * lays the labels out (`label-layout.ts`) and hands this layer the placed
 * rectangles, and the layer moves one DOM node per label into place with a
 * transform — no React render per frame. A node is kept per label key, so a
 * label that stays on screen is moved, not recreated.
 *
 * Hidden from assistive technology: the objects list is the map's
 * screen-reader route (spec §10), and the same names here would be noise.
 */
export const LabelsLayer = forwardRef<LabelsLayerHandle>(function LabelsLayer(_props, ref) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const leadersRef = useRef<SVGSVGElement | null>(null);
  const nodesRef = useRef(new Map<string, HTMLDivElement>());

  useImperativeHandle(ref, () => ({
    update(placed, selection) {
      const root = rootRef.current;
      const leaders = leadersRef.current;
      if (root === null || leaders === null) return;
      const nodes = nodesRef.current;
      const kept = new Set<string>();
      const lines: SVGLineElement[] = [];

      for (const label of placed) {
        kept.add(label.key);
        let node = nodes.get(label.key);
        if (node === undefined) {
          node = document.createElement('div');
          node.className = styles.label;
          node.dataset.key = label.key;
          root.appendChild(node);
          nodes.set(label.key, node);
        }
        if (node.textContent !== label.text) node.textContent = label.text;
        const selected = label.ids.some((id) => selection.has(id));
        node.dataset.selected = String(selected);
        node.dataset.group = String(label.group);
        node.style.width = `${Math.round(label.rect.r - label.rect.l)}px`;
        node.style.height = `${Math.round(label.rect.b - label.rect.t)}px`;
        node.style.transform = `translate(${Math.round(label.rect.l)}px, ${Math.round(label.rect.t)}px)`;

        if (label.leader) {
          const [x2, y2] = nearest(label.anchor, label.rect);
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('class', selected ? `${styles.leader} ${styles.leaderSelected}` : styles.leader);
          line.setAttribute('x1', String(label.anchor[0]));
          line.setAttribute('y1', String(label.anchor[1]));
          line.setAttribute('x2', String(x2));
          line.setAttribute('y2', String(y2));
          lines.push(line);
        }
      }

      for (const [key, node] of nodes) {
        if (kept.has(key)) continue;
        node.remove();
        nodes.delete(key);
      }
      leaders.replaceChildren(...lines);
    },
  }), []);

  return (
    <div className={styles.labels} ref={rootRef} aria-hidden="true">
      <svg className={styles.leaders} ref={leadersRef} />
    </div>
  );
});
```

- [ ] **Step 7: Create `engine.ts`**

Create `src/app/(admin)/site/editor/scene/engine.ts`:

```ts
import * as THREE from 'three';
import type { SiteItemKind } from '@/db/schema/site';
import { effectiveSize, itemHeight } from '@/lib/site/defaults';
import {
  fitRect, groundAt, interpolate, orbit, panBy, project, pxPerCm, zoomAt,
  type CameraState, type ScreenBox, type Vec3, type ViewMode, type Viewport,
} from '@/lib/site/editor/camera';
import { moveOps, setRectOps } from '@/lib/site/editor/commands';
import { layoutLabels, type LabelInput, type PlacedLabel } from '@/lib/site/editor/label-layout';
import { findItem, rectOf, type EditorItem } from '@/lib/site/editor/model';
import { snapMove, snapResize, type GuideLine } from '@/lib/site/editor/snapping';
import { CAMP_SITE, jerusalemInstant, sunDirection, sunPosition } from '@/lib/site/editor/sun';
import {
  contains, formatMetres, formatSize, gapsAround, overlap, unionRect, type Gap, type Handle, type Rect,
} from '@/lib/site/geometry';
import { SITE_KINDS } from '@/lib/site/kinds';
import { CameraRig } from './camera-rig';
import { Gestures, type GestureIntent, type GestureWorld, type PointerInput } from './gestures';
import type { LabelsLayerHandle } from './labels-layer';
import { buildGround, CM, disposeObject, worldOf } from './meshes';
import { OverlayLayer, type OverlayClasses, type OverlayModel } from './overlay';
import { SCENE_LIGHT, SCENE_PALETTE } from './palette';
import { pickItemId } from './picking';
import { SceneSync } from './scene-sync';
import type { SceneViewProps, ViewInfo } from './scene-view';

/**
 * Everything `SceneView` does that is not React: the renderer, the scene,
 * the camera and its animations, pointer input, snapping previews, the
 * overlay marks and the labels. React renders the DOM once; from then on
 * the engine reads the latest props through `props()` and draws a frame
 * only when something changed.
 */

export interface EngineOptions {
  /** The latest props; read at the moment they are needed, never cached. */
  props: () => SceneViewProps;
  labels: () => LabelsLayerHandle | null;
  classes: OverlayClasses & { canvas: string };
}

type RectCm = { xCm: number; yCm: number; widthCm: number; depthCm: number };

/** Hebrew, for the toast the editor shows (`onNotice`). */
export const LOCKED_NOTICE = 'הפריט נעול. אפשר לשחרר אותו בכפתור הנעילה.';
export const CONTEXT_LOST_NOTICE = 'התצוגה התלת־ממדית נעצרה לרגע. היא תחזור מעצמה.';

/** Measured at the label's CSS size and weight (`scene.module.css` `.label`). */
const LABEL_FONT_PX = 12.5;
const LABEL_PAD_PX = 18;
const LABEL_HEIGHT = 22;
/** How long the view must be still before it counts as settled. */
const SETTLE_MS = 160;
/** ViewInfo at most ten times a second while moving. */
const VIEW_EVERY_MS = 100;
/** Snap guides pull within this many screen pixels, whatever the zoom. */
const SNAP_PX = 9;
const HANDLE_HIT_PX = 7;
/** Toward the light when the sun is not modelled: from the north-west, high. */
const DEFAULT_LIGHT: Vec3 = [-0.42, -0.58, 0.7];

const HANDLE_AT: Record<Handle, [number, number]> = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5],
};

function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function baseLabel(label: string): string {
  return label.replace(/\s*\d+$/, '').trim();
}

function toRect(r: RectCm): Rect {
  return { x: r.xCm, y: r.yCm, width: r.widthCm, depth: r.depthCm };
}

export class SceneEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly rig = new CameraRig();
  private sync = new SceneSync();
  private ground: THREE.Group | null = null;
  private groundKey = '';
  private readonly hemisphere = new THREE.HemisphereLight(SCENE_LIGHT.sky, SCENE_LIGHT.ground, 2.2);
  private readonly light = new THREE.DirectionalLight(SCENE_LIGHT.sun, 1.4);
  private sunOn = false;
  private readonly gestures: Gestures;
  private readonly overlay: OverlayLayer;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly text: CanvasRenderingContext2D | null;

  private viewport: Viewport = { width: 0, height: 0 };
  private cam: CameraState | null = null;
  /** What the editor asked for, and what is drawn — 3D while the switch to plan animates. */
  private mode: ViewMode;
  private drawMode: ViewMode;
  private animation: { from: CameraState; to: CameraState; start: number; duration: number; then?: () => void } | null = null;
  private frameId = 0;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMotion = -Infinity;
  private lastView = -Infinity;
  private lastCameraKey = '';
  private viewDirty = true;
  private sceneDirty = true;
  private labelsDirty = true;
  private alive = true;
  private lost = false;

  private hover: string | null = null;
  private preview = new Map<string, RectCm>();
  private resizing: string | null = null;
  private guides: GuideLine[] = [];
  private gaps: Gap[] = [];
  private marquee: ScreenBox | null = null;
  private measuring: { from: [number, number]; to: [number, number] } | null = null;
  private ghost: { kind: SiteItemKind; xCm: number; yCm: number } | null = null;
  private ghostObject: THREE.Group | null = null;
  private handles: Array<{ handle: Handle; x: number; y: number }> = [];
  private placed: PlacedLabel[] = [];
  private slots = new Map<string, string>();
  private anchors = new Map<string, [number, number]>();
  private seen: { doc: unknown; selection: unknown; flags: unknown; ui: string; insets: string } = {
    doc: null, selection: null, flags: null, ui: '', insets: '',
  };

  constructor(private readonly stage: HTMLElement, private readonly options: EngineOptions) {
    const canvas = document.createElement('canvas');
    canvas.className = options.classes.canvas;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'מפת הקאמפ');
    // First, so a browser without WebGL throws before anything is attached.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.canvas = canvas;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    stage.appendChild(canvas);
    this.overlay = new OverlayLayer(stage, options.classes);

    this.light.shadow.mapSize.set(2048, 2048);
    this.scene.add(this.hemisphere, this.light, this.light.target, this.sync.root);

    const props = options.props();
    this.mode = props.ui.mode;
    this.drawMode = props.ui.mode;
    this.text = document.createElement('canvas').getContext('2d');
    if (this.text !== null) {
      this.text.font = `500 ${LABEL_FONT_PX}px ${getComputedStyle(stage).fontFamily || 'system-ui, sans-serif'}`;
    }

    const world: GestureWorld = {
      tool: () => this.options.props().ui.tool,
      mode: () => this.drawMode,
      handleAt: (x, y) => this.handleAt(x, y),
      labelAt: (x, y) => this.labelAt(x, y),
      itemAt: (x, y) => this.itemAt(x, y),
      groundAt: (x, y) => (this.cam === null ? null : groundAt(this.cam, this.viewport, this.drawMode, x, y)),
      selection: () => this.options.props().store.selection,
    };
    this.gestures = new Gestures(world);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('dblclick', this.onDoubleClick);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    this.resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { this.resize(); });
    this.resizeObserver?.observe(stage);
    this.update();
    this.resize();
  }

  /* ── from React ─────────────────────────────────────────────────────── */

  /** Called after every render of `SceneView`; redraws only for what changed. */
  update(): void {
    const { store, ui, insets, sunDate } = this.options.props();
    const uiKey = [
      ui.tool, ui.labels, ui.sun, ui.netsHidden, ui.snap, ui.hiddenGroups.join(','), ui.hour, ui.theme, sunDate,
      store.doc.plot.northDeg,
    ].join('|');
    const insetsKey = `${insets.left},${insets.top},${insets.right},${insets.bottom}`;
    if (store.doc !== this.seen.doc || store.flags !== this.seen.flags || store.selection !== this.seen.selection) {
      this.sceneDirty = true;
      this.labelsDirty = true;
      this.viewDirty = true;
    }
    if (uiKey !== this.seen.ui) {
      this.sceneDirty = true;
      this.labelsDirty = true;
      this.applyLight();
    }
    if (insetsKey !== this.seen.insets) {
      this.labelsDirty = true;
      this.viewDirty = true;
    }
    this.seen = { doc: store.doc, selection: store.selection, flags: store.flags, ui: uiKey, insets: insetsKey };
    this.canvas.style.cursor = ui.tool === 'measure' ? 'crosshair' : this.canvas.style.cursor;
    if (ui.tool !== 'measure' && this.measuring !== null && !this.gestures.active) this.measuring = null;
    if (ui.mode !== this.mode) this.switchMode(ui.mode);
    this.requestFrame();
  }

  dispose(): void {
    this.alive = false;
    cancelAnimationFrame(this.frameId);
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.resizeObserver?.disconnect();
    const canvas = this.canvas;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerCancel);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('dblclick', this.onDoubleClick);
    canvas.removeEventListener('contextmenu', this.onContextMenu);
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.sync.dispose();
    if (this.ground !== null) disposeObject(this.ground);
    this.setGhost(null);
    this.renderer.dispose();
    // This canvas is never reused, so its context is given back at once.
    this.renderer.forceContextLoss();
    this.overlay.dispose();
    canvas.remove();
  }

  /* ── SceneHandle ────────────────────────────────────────────────────── */

  fitAll(): void {
    if (this.cam === null) return;
    const pitch = this.drawMode === 'plan' ? 90 : this.cam.pitch;
    this.animate(fitRect(null, this.cam.yaw, pitch, this.viewport, this.drawMode, this.safe(), this.plot()), 420);
  }

  fitIds(ids: readonly string[]): void {
    if (this.cam === null) return;
    const { doc } = this.options.props().store;
    const rect = unionRect(doc.items.filter((entry) => ids.includes(entry.id)).map(rectOf));
    if (rect === null) return;
    const pad = 250;
    const padded = { x: rect.x - pad, y: rect.y - pad, width: rect.width + pad * 2, depth: rect.depth + pad * 2 };
    const pitch = this.drawMode === 'plan' ? 90 : this.cam.pitch;
    const to = fitRect(padded, this.cam.yaw, pitch, this.viewport, this.drawMode, this.safe(), this.plot());
    this.animate({ ...to, distance: Math.max(to.distance, 900) }, 520);
  }

  zoomBy(factor: number): void {
    if (this.cam === null) return;
    const safe = this.safe();
    this.animate(zoomAt(this.cam, this.viewport, this.drawMode, (safe.l + safe.r) / 2, (safe.t + safe.b) / 2, factor), 200);
  }

  /** A quarter turn in plan, an eighth in 3D. */
  rotateView(dir: 1 | -1): void {
    if (this.cam === null) return;
    const step = this.drawMode === 'plan' ? 90 : 45;
    this.animate({ ...this.cam, yaw: Math.round(this.cam.yaw / step) * step + dir * step }, 380);
  }

  northUp(): void {
    if (this.cam !== null) this.animate({ ...this.cam, yaw: 0 }, 380);
  }

  centreGround(): [number, number] | null {
    if (this.cam === null) return null;
    const safe = this.safe();
    return groundAt(this.cam, this.viewport, this.drawMode, (safe.l + safe.r) / 2, (safe.t + safe.b) / 2);
  }

  groundAtClient(clientX: number, clientY: number): [number, number] | null {
    if (this.cam === null) return null;
    const { x, y } = this.local({ clientX, clientY });
    if (x < 0 || y < 0 || x > this.viewport.width || y > this.viewport.height) return null;
    return groundAt(this.cam, this.viewport, this.drawMode, x, y);
  }

  /** The library's drag preview: `xCm`, `yCm` are the new item's north-west corner. */
  setGhost(ghost: { kind: SiteItemKind; xCm: number; yCm: number } | null): void {
    this.ghost = ghost;
    if (this.ghostObject !== null) {
      this.scene.remove(this.ghostObject);
      disposeObject(this.ghostObject);
      this.ghostObject = null;
    }
    if (ghost !== null && this.alive) {
      const { store, ui } = this.options.props();
      const size = effectiveSize(ghost.kind, store.doc.defaults);
      const ok = this.ghostVerdict() === 'ok';
      const palette = SCENE_PALETTE[ui.theme];
      const geometry = new THREE.BoxGeometry(size.widthCm * CM, size.heightCm * CM, size.depthCm * CM);
      const body = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: ok ? palette.selected : palette.bad, transparent: true, opacity: 0.22, depthWrite: false,
      }));
      body.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: ok ? palette.selected : palette.bad })));
      body.position.set(size.widthCm * CM / 2, size.heightCm * CM / 2, size.depthCm * CM / 2);
      const group = new THREE.Group();
      group.add(body);
      group.position.copy(worldOf(ghost.xCm, ghost.yCm, 0));
      this.ghostObject = group;
      this.scene.add(group);
    }
    this.requestFrame();
  }

  jumpTo(xCm: number, yCm: number): void {
    const centre = this.centreGround();
    if (this.cam === null || centre === null) return;
    this.stopAnimation();
    this.setCamera(panBy(this.cam, xCm - centre[0], yCm - centre[1]));
  }

  exportPng(): string | null {
    if (this.cam === null || this.lost) return null;
    try {
      this.renderer.render(this.scene, this.rig.apply(this.cam, this.viewport, this.drawMode));
      return this.canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  /* ── frames ─────────────────────────────────────────────────────────── */

  private requestFrame(): void {
    if (this.frameId !== 0 || !this.alive) return;
    this.frameId = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    this.frameId = 0;
    if (!this.alive || this.lost || this.cam === null) return;
    const props = this.options.props();
    const animating = this.stepAnimation(now);
    const camera = this.rig.apply(this.cam, this.viewport, this.drawMode);

    const cameraKey = `${this.drawMode}|${this.viewport.width}x${this.viewport.height}|${Object.values(this.cam).join(',')}`;
    if (cameraKey !== this.lastCameraKey) {
      // The first placement of the camera is not motion; everything after it is.
      if (this.lastCameraKey !== '') this.markMotion(now);
      this.lastCameraKey = cameraKey;
      this.labelsDirty = true;
    }
    if (this.sceneDirty) {
      this.syncScene();
      this.sceneDirty = false;
    }
    const minor = this.ground?.getObjectByName('gridMinor');
    if (minor !== undefined) minor.visible = pxPerCm(this.cam, this.viewport) * props.store.doc.plot.gridCm >= 6;

    this.renderer.render(this.scene, camera);
    this.handles = this.computeHandles();
    if (this.labelsDirty) {
      this.layoutLabels();
      this.labelsDirty = false;
    }
    this.overlay.draw(this.overlayModel());

    const moving = this.isMoving(now);
    if (moving) {
      this.viewDirty = true;
      if (now - this.lastView >= VIEW_EVERY_MS) this.emitView(now, true);
    } else if (this.viewDirty) {
      this.emitView(now, false);
    }
    if (animating) this.requestFrame();
  };

  private isMoving(now: number): boolean {
    return this.animation !== null || this.gestures.active || now - this.lastMotion < SETTLE_MS;
  }

  /** Motion happened; once it has stopped for `SETTLE_MS`, report the settled view once. */
  private markMotion(now: number): void {
    this.lastMotion = now;
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.viewDirty = true;
      this.requestFrame();
    }, SETTLE_MS + 20);
  }

  private emitView(now: number, moving: boolean): void {
    this.lastView = now;
    this.viewDirty = moving;
    this.options.props().onView(this.viewInfo(moving));
  }

  private viewInfo(moving: boolean): ViewInfo {
    const cam = this.cam as CameraState;
    const safe = this.safe();
    const fit = fitRect(null, cam.yaw, this.drawMode === 'plan' ? 90 : cam.pitch, this.viewport, this.drawMode, safe, this.plot());
    const corners: Array<[number, number]> = [];
    for (const [x, y] of [[safe.l, safe.t], [safe.r, safe.t], [safe.r, safe.b], [safe.l, safe.b]]) {
      const ground = groundAt(cam, this.viewport, this.drawMode, x, y);
      if (ground !== null) corners.push(ground);
    }
    return {
      yaw: ((cam.yaw % 360) + 360) % 360,
      zoomPct: Math.round((fit.distance / cam.distance) * 100),
      pxPerM: pxPerCm(cam, this.viewport) * 100,
      groundCorners: corners,
      selectionBox: moving ? null : this.selectionBox(),
      moving,
    };
  }

  /* ── camera ─────────────────────────────────────────────────────────── */

  private resize(): void {
    const rect = this.stage.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width === 0 || height === 0) return;
    if (width === this.viewport.width && height === this.viewport.height) return;
    this.viewport = { width, height };
    this.renderer.setSize(width, height, false);
    if (this.cam === null) {
      const plan = this.drawMode === 'plan';
      this.cam = fitRect(null, plan ? 0 : -26, plan ? 90 : 50, this.viewport, this.drawMode, this.safe(), this.plot());
    }
    this.labelsDirty = true;
    this.viewDirty = true;
    this.requestFrame();
  }

  private safe(): ScreenBox {
    const { insets } = this.options.props();
    const box = { l: insets.left, t: insets.top, r: this.viewport.width - insets.right, b: this.viewport.height - insets.bottom };
    return box.r - box.l < 80 || box.b - box.t < 80 ? { l: 0, t: 0, r: this.viewport.width, b: this.viewport.height } : box;
  }

  private plot(): { widthCm: number; depthCm: number } {
    const { plot } = this.options.props().store.doc;
    return { widthCm: plot.widthCm, depthCm: plot.depthCm };
  }

  private setCamera(next: CameraState): void {
    this.cam = next;
    this.requestFrame();
  }

  private animate(to: CameraState, duration: number, then?: () => void): void {
    if (this.cam === null) return;
    this.stopAnimation();
    this.animation = { from: this.cam, to, start: performance.now(), duration, then };
    this.requestFrame();
  }

  /** A hand on the map ends an animation; a mode switch still lands where it was going. */
  private stopAnimation(): void {
    const running = this.animation;
    if (running === null) return;
    this.animation = null;
    if (running.then !== undefined) {
      this.cam = running.to;
      running.then();
    }
  }

  private stepAnimation(now: number): boolean {
    const running = this.animation;
    if (running === null) return false;
    const t = Math.min(1, Math.max(0, (now - running.start) / running.duration));
    this.cam = interpolate(running.from, running.to, ease(t));
    if (t < 1) return true;
    this.animation = null;
    this.cam = running.to;
    running.then?.();
    return false;
  }

  /**
   * Plan is 3D seen from straight above (spec §7): going to plan tilts the
   * perspective camera to 90° and only then swaps in the orthographic one, so
   * the picture never jumps; going to 3D swaps first and then tilts down.
   */
  private switchMode(next: ViewMode): void {
    this.mode = next;
    if (this.cam === null) {
      this.drawMode = next;
      return;
    }
    const settle = () => this.options.props().onModeSettled?.(next);
    this.drawMode = '3d';
    if (next === 'plan') {
      const to = { ...this.cam, pitch: 90, yaw: Math.round(this.cam.yaw / 90) * 90 };
      this.animate(to, 520, () => {
        this.drawMode = 'plan';
        settle();
      });
    } else {
      this.animate({ ...this.cam, pitch: 50, yaw: this.cam.yaw - 26 }, 520, settle);
    }
  }

  /* ── the scene ──────────────────────────────────────────────────────── */

  private visible(item: EditorItem): boolean {
    const { ui } = this.options.props();
    if (ui.hiddenGroups.includes(SITE_KINDS[item.kind].group)) return false;
    return !(ui.netsHidden && SITE_KINDS[item.kind].shape === 'net');
  }

  /** Where an item is drawn now: its drag preview if it has one, else the store's. */
  private drawn(item: EditorItem): RectCm {
    return this.preview.get(item.id) ?? { xCm: item.xCm, yCm: item.yCm, widthCm: item.widthCm, depthCm: item.depthCm };
  }

  private syncScene(): void {
    const { store, ui } = this.options.props();
    const plot = store.doc.plot;
    const key = `${plot.widthCm}x${plot.depthCm}:${plot.gridCm}:${ui.theme}`;
    if (key !== this.groundKey) {
      if (this.ground !== null) {
        this.scene.remove(this.ground);
        disposeObject(this.ground);
      }
      this.ground = buildGround(plot, ui.theme);
      this.scene.add(this.ground);
      this.groundKey = key;
      this.scene.background = new THREE.Color(SCENE_PALETTE[ui.theme].outside);
    }
    this.sync.sync({
      doc: store.doc,
      preview: this.preview,
      selection: new Set(store.selection),
      hover: this.hover,
      flags: store.flags,
      hiddenGroups: new Set(ui.hiddenGroups),
      netsHidden: ui.netsHidden,
      theme: ui.theme,
      sun: this.sunOn,
    });
  }

  /** The directional light: the sun at the chosen hour when shade by hour is on (spec §11), else a fixed key light. */
  private applyLight(): void {
    const { store, ui, sunDate } = this.options.props();
    const plot = store.doc.plot;
    let toward: Vec3 = DEFAULT_LIGHT;
    let sunDown = false;
    this.sunOn = false;
    // `sunDate` is the season's `startsOn`; anything else is no date, never a guessed one.
    if (ui.sun && sunDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(sunDate)) {
      const sun = sunPosition(jerusalemInstant(sunDate, ui.hour), CAMP_SITE.latitude, CAMP_SITE.longitude);
      if (sun.elevationDeg > 0) {
        toward = sunDirection(sun, plot.northDeg);
        this.sunOn = true;
      } else {
        sunDown = true;
      }
    }
    const centre = worldOf(plot.widthCm / 2, plot.depthCm / 2, 0);
    const radius = (Math.hypot(plot.widthCm, plot.depthCm) * CM) / 2 + 10;
    const direction = new THREE.Vector3(toward[0], toward[2], toward[1]).normalize();
    this.light.position.copy(centre).addScaledVector(direction, radius * 3);
    this.light.target.position.copy(centre);
    this.light.target.updateMatrixWorld();
    this.light.castShadow = this.sunOn;
    const shadow = this.light.shadow.camera;
    shadow.left = -radius;
    shadow.right = radius;
    shadow.top = radius;
    shadow.bottom = -radius;
    shadow.near = 0.5;
    shadow.far = radius * 6;
    shadow.updateProjectionMatrix();
    this.light.intensity = sunDown ? 0 : this.sunOn ? 2.4 : 1.4;
    this.hemisphere.intensity = this.sunOn ? 1.3 : sunDown ? 0.9 : 2.2;
    this.sceneDirty = true;
  }

  /* ── what is where on screen ────────────────────────────────────────── */

  private local(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private screen(x: number, y: number, z: number): [number, number] | null {
    if (this.cam === null) return null;
    const at = project(this.cam, this.viewport, this.drawMode, [x, y, z]);
    return at === null ? null : [at.x, at.y];
  }

  /** The screen box of a footprint raised to a height; null when any corner is behind the camera. */
  private screenBox(rect: RectCm, heightCm: number): ScreenBox | null {
    let box: ScreenBox | null = null;
    for (const z of [0, heightCm]) {
      for (const [x, y] of [[rect.xCm, rect.yCm], [rect.xCm + rect.widthCm, rect.yCm],
        [rect.xCm, rect.yCm + rect.depthCm], [rect.xCm + rect.widthCm, rect.yCm + rect.depthCm]]) {
        const at = this.screen(x, y, z);
        if (at === null) return null;
        box = box === null
          ? { l: at[0], t: at[1], r: at[0], b: at[1] }
          : { l: Math.min(box.l, at[0]), t: Math.min(box.t, at[1]), r: Math.max(box.r, at[0]), b: Math.max(box.b, at[1]) };
      }
    }
    return box;
  }

  private selectionBox(): ScreenBox | null {
    const { store } = this.options.props();
    let box: ScreenBox | null = null;
    for (const id of store.selection) {
      const item = findItem(store.doc, id);
      if (item === undefined || !this.visible(item)) continue;
      const one = this.screenBox(this.drawn(item), itemHeight(item, store.doc.defaults));
      if (one === null) continue;
      box = box === null ? one : { l: Math.min(box.l, one.l), t: Math.min(box.t, one.t), r: Math.max(box.r, one.r), b: Math.max(box.b, one.b) };
    }
    return box;
  }

  private itemAt(x: number, y: number): { id: string; isNet: boolean; locked: boolean } | null {
    if (this.cam === null) return null;
    const { store } = this.options.props();
    const camera = this.rig.apply(this.cam, this.viewport, this.drawMode);
    const id = pickItemId(camera, this.sync, x, y, this.viewport);
    const item = id === null ? undefined : findItem(store.doc, id);
    if (item === undefined) return null;
    return { id: item.id, isNet: SITE_KINDS[item.kind].shape === 'net', locked: item.locked };
  }

  private labelAt(x: number, y: number): { ids: string[]; group: boolean } | null {
    for (let i = this.placed.length - 1; i >= 0; i -= 1) {
      const { rect, ids, group } = this.placed[i];
      if (x >= rect.l && x <= rect.r && y >= rect.t && y <= rect.b) return { ids, group };
    }
    return null;
  }

  private handleAt(x: number, y: number): Handle | null {
    for (const entry of this.handles) {
      if (Math.abs(entry.x - x) <= HANDLE_HIT_PX && Math.abs(entry.y - y) <= HANDLE_HIT_PX) return entry.handle;
    }
    return null;
  }

  /** Eight handles on the ground around the one selected, unlocked, visible item — none while the camera flies. */
  private computeHandles(): Array<{ handle: Handle; x: number; y: number }> {
    const { store } = this.options.props();
    if (store.selection.length !== 1 || this.animation !== null) return [];
    const item = findItem(store.doc, store.selection[0]);
    if (item === undefined || item.locked || !this.visible(item)) return [];
    const rect = this.drawn(item);
    const out: Array<{ handle: Handle; x: number; y: number }> = [];
    for (const [handle, [fx, fy]] of Object.entries(HANDLE_AT) as Array<[Handle, [number, number]]>) {
      const at = this.screen(rect.xCm + fx * rect.widthCm, rect.yCm + fy * rect.depthCm, 0);
      if (at !== null) out.push({ handle, x: at[0], y: at[1] });
    }
    return out;
  }

  /* ── labels ─────────────────────────────────────────────────────────── */

  private labelWidth(text: string): number {
    const measured = this.text?.measureText(text).width ?? text.length * 7;
    return Math.ceil(measured) + LABEL_PAD_PX;
  }

  private layoutLabels(): void {
    const layer = this.options.labels();
    const { store, ui } = this.options.props();
    this.anchors.clear();
    if (!ui.labels || this.cam === null) {
      this.placed = [];
      layer?.update([], new Set());
      return;
    }
    const selection = new Set(store.selection);
    const { flags } = store;
    const inputs: LabelInput[] = [];
    for (const item of store.doc.items) {
      if (!this.visible(item)) continue;
      const rect = this.drawn(item);
      const height = itemHeight(item, store.doc.defaults);
      const isNet = SITE_KINDS[item.kind].shape === 'net';
      const box = this.screenBox(rect, height);
      if (box === null) continue;
      const selected = selection.has(item.id);
      const hovered = this.hover === item.id;
      // Under three pixels on screen, only the selected or hovered item keeps a label (spec §9.6).
      if (Math.max(box.r - box.l, box.b - box.t) < 3 && !selected && !hovered) continue;
      // A net's label hangs from the middle of its north edge, never over the lounge under it.
      const anchor = isNet
        ? this.screen(rect.xCm + rect.widthCm / 2, rect.yCm, height)
        : this.screen(rect.xCm + rect.widthCm / 2, rect.yCm + rect.depthCm / 2, height);
      if (anchor === null) continue;
      const issue = flags.outside.has(item.id) || flags.overlapping.has(item.id) || flags.partly.has(item.id);
      const text = selected && selection.size === 1 ? `${item.label} · ${formatSize(rect.widthCm, rect.depthCm)}` : item.label;
      // Selected, hovered and flagged items, and nets, are always labelled on their own (spec §9.4).
      const groupable = !isNet && !selected && !hovered && !issue;
      const area = (rect.widthCm * rect.depthCm) / 100;
      inputs.push({
        id: item.id, text, width: this.labelWidth(text), height: LABEL_HEIGHT, anchor, box,
        priority: (selected ? 4e9 : 0) + (hovered ? 2e9 : 0) + (issue ? 1e9 : 0) + (isNet ? 0 : 1e8) + area,
        groupKey: groupable ? `${item.kind}|${baseLabel(item.label)}` : null,
        groupNoun: groupable ? SITE_KINDS[item.kind].plural : null,
        isNet,
      });
      this.anchors.set(item.id, anchor);
    }
    this.placed = layoutLabels(inputs, {
      bounds: this.safe(),
      obstacles: this.handles.map((h) => ({ l: h.x - HANDLE_HIT_PX, t: h.y - HANDLE_HIT_PX, r: h.x + HANDLE_HIT_PX, b: h.y + HANDLE_HIT_PX })),
      previous: this.slots,
      measure: (text) => this.labelWidth(text),
      labelHeight: LABEL_HEIGHT,
    });
    this.slots = new Map(this.placed.map((label) => [label.key, label.slot]));
    layer?.update(this.placed, selection);
  }

  /* ── overlay ────────────────────────────────────────────────────────── */

  private overlayModel(): OverlayModel {
    const model: OverlayModel = { handles: this.handles, lines: [], dots: [], pills: [], marquee: this.marquee };
    const line = (from: [number, number], to: [number, number], kind: 'guide' | 'gap' | 'measure') => {
      const a = this.screen(from[0], from[1], 1);
      const b = this.screen(to[0], to[1], 1);
      if (a !== null && b !== null) model.lines.push({ from: a, to: b, kind });
      return a !== null && b !== null ? [a, b] as const : null;
    };
    for (const guide of this.guides) line(guide.from, guide.to, 'guide');
    for (const gap of this.gaps) {
      const drawn = line(gap.from, gap.to, 'gap');
      if (drawn !== null) {
        model.pills.push({ x: (drawn[0][0] + drawn[1][0]) / 2, y: (drawn[0][1] + drawn[1][1]) / 2, text: formatMetres(gap.lengthCm), tone: 'guide' });
      }
    }
    if (this.measuring !== null) {
      const drawn = line(this.measuring.from, this.measuring.to, 'measure');
      if (drawn !== null) {
        const length = Math.hypot(this.measuring.to[0] - this.measuring.from[0], this.measuring.to[1] - this.measuring.from[1]);
        model.dots.push({ x: drawn[0][0], y: drawn[0][1], kind: 'measure' }, { x: drawn[1][0], y: drawn[1][1], kind: 'measure' });
        model.pills.push({ x: (drawn[0][0] + drawn[1][0]) / 2, y: (drawn[0][1] + drawn[1][1]) / 2 - 14, text: formatMetres(length), tone: 'guide' });
      }
    }
    for (const label of this.placed) {
      if (!label.group) continue;
      for (const id of label.ids) {
        const at = this.anchors.get(id);
        if (at !== undefined) model.dots.push({ x: at[0], y: at[1], kind: 'member' });
      }
    }
    const { store } = this.options.props();
    if (this.resizing !== null) {
      const rect = this.preview.get(this.resizing);
      const item = findItem(store.doc, this.resizing);
      if (rect !== undefined && item !== undefined) {
        const at = this.screen(rect.xCm + rect.widthCm / 2, rect.yCm + rect.depthCm / 2, itemHeight(item, store.doc.defaults));
        if (at !== null) model.pills.push({ x: at[0], y: at[1] - 18, text: formatSize(rect.widthCm, rect.depthCm), tone: 'focus' });
      }
    }
    if (this.ghost !== null) {
      const size = effectiveSize(this.ghost.kind, store.doc.defaults);
      const at = this.screen(this.ghost.xCm + size.widthCm / 2, this.ghost.yCm + size.depthCm / 2, size.heightCm);
      const verdict = this.ghostVerdict();
      const text = verdict === 'outside' ? 'מחוץ לגדר'
        : verdict === 'overlapping' ? 'חפיפה עם פריט אחר'
          : `${SITE_KINDS[this.ghost.kind].label} · ${formatSize(size.widthCm, size.depthCm)}`;
      if (at !== null) model.pills.push({ x: at[0], y: at[1] - 16, text, tone: verdict === 'ok' ? 'focus' : 'bad' });
    }
    return model;
  }

  /** Whether a new item dropped where the ghost is would be inside the fence and on free ground. */
  private ghostVerdict(): 'ok' | 'outside' | 'overlapping' {
    const ghost = this.ghost;
    if (ghost === null) return 'ok';
    const { doc } = this.options.props().store;
    const size = effectiveSize(ghost.kind, doc.defaults);
    const rect: Rect = { x: ghost.xCm, y: ghost.yCm, width: size.widthCm, depth: size.depthCm };
    if (!contains(doc.plot, rect)) return 'outside';
    if (ghost.kind === 'shade') return 'ok';
    const blocked = doc.items.some((entry) => SITE_KINDS[entry.kind].shape !== 'net' && overlap(rectOf(entry), rect));
    return blocked ? 'overlapping' : 'ok';
  }

  /* ── intents ────────────────────────────────────────────────────────── */

  private apply(intents: readonly GestureIntent[]): void {
    if (intents.length === 0) return;
    const props = this.options.props();
    const { store } = props;
    for (const intent of intents) {
      switch (intent.type) {
        case 'select':
          store.select(intent.ids);
          break;
        case 'toggleSelect':
          store.select(store.selection.includes(intent.id)
            ? store.selection.filter((id) => id !== intent.id)
            : [...store.selection, intent.id]);
          break;
        case 'clearSelection':
          store.select([]);
          this.measuring = null;
          break;
        case 'panBy':
          if (this.cam !== null) this.setCamera(panBy(this.cam, intent.dxCm, intent.dyCm));
          break;
        case 'orbitBy':
          if (this.cam !== null && this.drawMode === '3d') this.setCamera(orbit(this.cam, intent.dYaw, intent.dPitch));
          break;
        case 'movePreview':
          this.previewMove(intent.ids, intent.dxCm, intent.dyCm, intent.free);
          break;
        case 'moveCommit': {
          const snapped = this.snapMoveOf(intent.ids, intent.dxCm, intent.dyCm, intent.free);
          this.clearPreview();
          if (snapped !== null) store.run('הזזה', moveOps(store.doc, intent.ids, snapped.dxCm, snapped.dyCm));
          break;
        }
        case 'resizePreview': {
          const rect = this.snapResizeOf(intent.id, intent.handle, intent.dxCm, intent.dyCm, intent.free);
          if (rect !== null) {
            this.preview = new Map([[intent.id, rect]]);
            this.resizing = intent.id;
            this.sceneDirty = true;
            this.labelsDirty = true;
          }
          break;
        }
        case 'resizeCommit': {
          const rect = this.snapResizeOf(intent.id, intent.handle, intent.dxCm, intent.dyCm, intent.free);
          this.clearPreview();
          if (rect !== null) store.run('שינוי גודל', setRectOps(store.doc, intent.id, rect));
          break;
        }
        case 'marquee': {
          this.marquee = intent.box;
          const inside = this.itemsInside(intent.box).filter((id) => !intent.base.includes(id));
          store.select([...intent.base, ...inside]);
          break;
        }
        case 'marqueeEnd':
          this.marquee = null;
          break;
        case 'measure':
          this.measuring = { from: intent.from, to: intent.to };
          break;
        case 'zoomToIds':
          this.fitIds(intent.ids);
          break;
        case 'lockedNotice':
          props.onNotice(LOCKED_NOTICE);
          break;
        case 'hover':
          this.canvas.style.cursor = intent.cursor;
          if (intent.id !== this.hover) {
            this.hover = intent.id;
            this.sceneDirty = true;
            this.labelsDirty = true;
          }
          break;
      }
    }
    this.requestFrame();
  }

  private snapMoveOf(ids: readonly string[], dxCm: number, dyCm: number, free: boolean) {
    const { store, ui } = this.options.props();
    const moving = store.doc.items.filter((entry) => ids.includes(entry.id) && !entry.locked);
    const union = unionRect(moving.map(rectOf));
    if (union === null || this.cam === null) return null;
    const others = store.doc.items
      .filter((entry) => !ids.includes(entry.id) && this.visible(entry) && SITE_KINDS[entry.kind].shape !== 'net')
      .map(rectOf);
    const snapped = snapMove({
      moving: union, others, plot: this.plot(), dxCm, dyCm,
      gridCm: store.doc.plot.gridCm,
      thresholdCm: SNAP_PX / pxPerCm(this.cam, this.viewport),
      free: free || !ui.snap,
    });
    return { ...snapped, moving, others };
  }

  private previewMove(ids: readonly string[], dxCm: number, dyCm: number, free: boolean): void {
    const snapped = this.snapMoveOf(ids, dxCm, dyCm, free);
    if (snapped === null) return;
    this.preview = new Map(snapped.moving.map((entry) => [entry.id, {
      xCm: entry.xCm + snapped.dxCm, yCm: entry.yCm + snapped.dyCm, widthCm: entry.widthCm, depthCm: entry.depthCm,
    }]));
    this.guides = snapped.guides;
    const only = snapped.moving.length === 1 ? this.preview.get(snapped.moving[0].id) : undefined;
    this.gaps = only === undefined ? [] : gapsAround(toRect(only), snapped.others, this.plot());
    this.sceneDirty = true;
    this.labelsDirty = true;
  }

  private snapResizeOf(id: string, handle: Handle, dxCm: number, dyCm: number, free: boolean): RectCm | null {
    const { store, ui } = this.options.props();
    const item = findItem(store.doc, id);
    if (item === undefined || item.locked) return null;
    const rect = snapResize(rectOf(item), handle, dxCm, dyCm, store.doc.plot.gridCm, free || !ui.snap);
    return { xCm: rect.x, yCm: rect.y, widthCm: rect.width, depthCm: rect.depth };
  }

  private clearPreview(): void {
    this.preview = new Map();
    this.resizing = null;
    this.guides = [];
    this.gaps = [];
    this.sceneDirty = true;
    this.labelsDirty = true;
  }

  /** Items whose middle is inside the box; a net only when all of it is (as the mock). */
  private itemsInside(box: ScreenBox): string[] {
    const { store } = this.options.props();
    const inside = (at: [number, number] | null) => at !== null && at[0] >= box.l && at[0] <= box.r && at[1] >= box.t && at[1] <= box.b;
    return store.doc.items.filter((item) => {
      if (!this.visible(item)) return false;
      if (SITE_KINDS[item.kind].shape === 'net') {
        return [[item.xCm, item.yCm], [item.xCm + item.widthCm, item.yCm], [item.xCm, item.yCm + item.depthCm],
          [item.xCm + item.widthCm, item.yCm + item.depthCm]].every(([x, y]) => inside(this.screen(x, y, 0)));
      }
      return inside(this.screen(item.xCm + item.widthCm / 2, item.yCm + item.depthCm / 2, 0));
    }).map((item) => item.id);
  }

  /* ── DOM events ─────────────────────────────────────────────────────── */

  private pointer(event: PointerEvent): PointerInput {
    const { x, y } = this.local(event);
    return { x, y, button: event.button, shift: event.shiftKey, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey };
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.cam === null) return;
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer cannot be captured; the drag still works inside the canvas.
    }
    this.stopAnimation();
    this.apply(this.gestures.down(this.pointer(event)));
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.cam === null) return;
    if (this.gestures.active) this.markMotion(performance.now());
    this.apply(this.gestures.move(this.pointer(event)));
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Already released.
    }
    const dragging = this.gestures.active;
    this.apply(this.gestures.up(this.pointer(event)));
    if (dragging) this.markMotion(performance.now());
  };

  private readonly onPointerCancel = (): void => {
    this.apply(this.gestures.cancel());
    this.clearPreview();
    this.requestFrame();
  };

  private readonly onPointerLeave = (): void => {
    if (this.gestures.active || this.hover === null) return;
    this.hover = null;
    this.sceneDirty = true;
    this.labelsDirty = true;
    this.requestFrame();
  };

  /** Wheel and trackpad pinch (a wheel with Ctrl) zoom toward the pointer. */
  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (this.cam === null) return;
    this.stopAnimation();
    const { x, y } = this.local(event);
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    const factor = Math.exp(delta * (event.ctrlKey ? 0.01 : 0.0016));
    this.setCamera(zoomAt(this.cam, this.viewport, this.drawMode, x, y, factor));
  };

  /** Double-click flies to the item (spec §8). */
  private readonly onDoubleClick = (event: MouseEvent): void => {
    const { x, y } = this.local(event);
    const hit = this.itemAt(x, y);
    if (hit === null) return;
    this.options.props().store.select([hit.id]);
    this.fitIds([hit.id]);
  };

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.lost = true;
    cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.options.props().onNotice(CONTEXT_LOST_NOTICE);
  };

  /** three restores its own state; the scene is rebuilt from the store (spec §17). */
  private readonly onContextRestored = (): void => {
    this.lost = false;
    this.scene.remove(this.sync.root);
    this.sync.dispose();
    this.sync = new SceneSync();
    this.scene.add(this.sync.root);
    if (this.ground !== null) {
      this.scene.remove(this.ground);
      disposeObject(this.ground);
      this.ground = null;
      this.groundKey = '';
    }
    this.sceneDirty = true;
    this.labelsDirty = true;
    this.viewDirty = true;
    this.requestFrame();
  };
}
```

- [ ] **Step 8: Create `scene-view.tsx`**

The engine is created in a ref callback on the stage node, not in an effect: React 19 runs the callback's returned cleanup when the node detaches, and a failure there may set state without tripping `react-hooks/set-state-in-effect`. Each engine makes its own canvas, so the development double-mount's second engine never inherits the first one's lost context.

Create `src/app/(admin)/site/editor/scene/scene-view.tsx`:

```tsx
'use client';

import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { SiteItemKind } from '@/db/schema/site';
import type { ScreenBox, ViewMode } from '@/lib/site/editor/camera';
import type { SiteKindGroup } from '@/lib/site/kinds';
import type { EditorStore } from '../use-editor-store';
import { SceneEngine } from './engine';
import { LabelsLayer, type LabelsLayerHandle } from './labels-layer';
import type { SceneTheme } from './palette';
import styles from './scene.module.css';

export interface EditorUi {
  tool: 'select' | 'measure';
  mode: ViewMode;
  labels: boolean;
  sun: boolean;
  netsHidden: boolean;
  snap: boolean;
  hiddenGroups: SiteKindGroup[];
  hour: number;
  theme: SceneTheme;
}

export interface ViewInfo {
  yaw: number;
  zoomPct: number;
  pxPerM: number;
  groundCorners: Array<[number, number]>;
  /** Null while the view or a drag is moving (the selection bar hides meanwhile). */
  selectionBox: ScreenBox | null;
  moving: boolean;
}

/** How much of the scene the floating panels cover; fit and labels keep out from under them. */
export interface Insets { left: number; right: number; top: number; bottom: number }

export interface SceneHandle {
  fitAll(): void;
  fitIds(ids: readonly string[]): void;
  zoomBy(factor: number): void;
  rotateView(dir: 1 | -1): void;
  northUp(): void;
  centreGround(): [number, number] | null;
  groundAtClient(clientX: number, clientY: number): [number, number] | null;
  setGhost(ghost: { kind: SiteItemKind; xCm: number; yCm: number } | null): void;
  jumpTo(xCm: number, yCm: number): void;
  exportPng(): string | null;
}

export interface SceneViewProps {
  store: EditorStore;
  ui: EditorUi;
  insets: Insets;
  /** The season's gate date, 'YYYY-MM-DD'; the sun is modelled only when there is one. */
  sunDate: string | null;
  onView: (info: ViewInfo) => void;
  onNotice: (message: string) => void;
  onModeSettled?: (mode: ViewMode) => void;
}

/** What a browser without WebGL shows where the map would be (spec §7). */
export const NO_WEBGL = 'המפה צריכה דפדפן עם גרפיקה תלת־ממדית פעילה.';

const ENGINE_CLASSES = {
  canvas: styles.canvas,
  overlay: styles.overlay,
  handle: styles.handle,
  guide: styles.guide,
  gap: styles.gap,
  measure: styles.measure,
  marquee: styles.marquee,
  dot: styles.dot,
  member: styles.member,
  pills: styles.pills,
  pill: styles.pill,
  pillGuide: styles.pillGuide,
  pillFocus: styles.pillFocus,
  pillBad: styles.pillBad,
};

/**
 * The 3D map (spec §4, §7). The only component that reaches `three`, through
 * `engine.ts`; loaded with `next/dynamic` and `ssr: false`, so no other page
 * carries the library and the server never tries to draw.
 *
 * React renders three nodes and then stays out of the way: the engine is
 * created on the stage node, reads the latest props on every render through
 * a ref, and draws frames itself. A browser that cannot give WebGL makes the
 * engine throw; the component then says so, in Hebrew, instead of the map.
 */
export const SceneView = forwardRef<SceneHandle, SceneViewProps>(function SceneView(props, ref) {
  const propsRef = useRef(props);
  const engineRef = useRef<SceneEngine | null>(null);
  const labelsRef = useRef<LabelsLayerHandle | null>(null);
  const [failed, setFailed] = useState(false);

  useLayoutEffect(() => {
    propsRef.current = props;
    engineRef.current?.update();
  });

  /* The engine lives exactly as long as the stage node: created when React
     attaches it, disposed by the cleanup React 19 runs when it detaches. */
  const attachStage = useCallback((stage: HTMLDivElement | null) => {
    if (stage === null) return undefined;
    let engine: SceneEngine;
    try {
      engine = new SceneEngine(stage, {
        props: () => propsRef.current,
        labels: () => labelsRef.current,
        classes: ENGINE_CLASSES,
      });
    } catch {
      setFailed(true);
      return undefined;
    }
    engineRef.current = engine;
    return () => {
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    fitAll: () => engineRef.current?.fitAll(),
    fitIds: (ids) => engineRef.current?.fitIds(ids),
    zoomBy: (factor) => engineRef.current?.zoomBy(factor),
    rotateView: (dir) => engineRef.current?.rotateView(dir),
    northUp: () => engineRef.current?.northUp(),
    centreGround: () => engineRef.current?.centreGround() ?? null,
    groundAtClient: (clientX, clientY) => engineRef.current?.groundAtClient(clientX, clientY) ?? null,
    setGhost: (ghost) => engineRef.current?.setGhost(ghost),
    jumpTo: (xCm, yCm) => engineRef.current?.jumpTo(xCm, yCm),
    exportPng: () => engineRef.current?.exportPng() ?? null,
  }), []);

  if (failed) {
    return (
      <div className={styles.scene}>
        <p className={styles.fallback} role="status">{NO_WEBGL}</p>
      </div>
    );
  }
  return (
    <div className={styles.scene}>
      <div className={styles.stage} ref={attachStage} />
      <LabelsLayer ref={labelsRef} />
    </div>
  );
});
```

- [ ] **Step 9: Create the temporary `scene-preview.tsx`**

Create `src/app/(admin)/site/editor/scene-preview.tsx`:

```tsx
'use client';

import dynamic from 'next/dynamic';
import { useState, useSyncExternalStore } from 'react';
import type { EditorDoc } from '@/lib/site/editor/model';
import { loadSiteDocAction, saveSiteChangesAction } from '../actions';
import type { EditorUi, ViewInfo } from './scene/scene-view';
import type { SceneTheme } from './scene/palette';
import type { QueueSnapshot } from './save-queue';
import { useEditorStore } from './use-editor-store';
import styles from './scene/scene.module.css';

/**
 * TEMPORARY — the bare 3D map at `/site?editor=3d` (plan 03, Task 20), so the
 * scene can be checked in a browser before any panel is built on it. Task 26
 * deletes this file when `site-editor.tsx` becomes the page.
 *
 * It shows the scene and one line of save status, and nothing else.
 */

// `ssr: false` is allowed only in a Client Component (next/dist/docs, lazy-loading).
const SceneView = dynamic(() => import('./scene/scene-view').then((m) => m.SceneView), { ssr: false });

const UI_BASE: Omit<EditorUi, 'theme'> = {
  tool: 'select', mode: '3d', labels: true, sun: false, netsHidden: false,
  snap: true, hiddenGroups: [], hour: 14,
};
const NO_INSETS = { left: 0, right: 0, top: 0, bottom: 0 };

/** The theme on screen: the reader's choice on <html>, else the OS's (as `theme-toggle.tsx` reads it). */
function subscribeTheme(onChange: () => void): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  query.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    query.removeEventListener('change', onChange);
  };
}

function shownTheme(): SceneTheme {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === 'dark' || chosen === 'light') return chosen;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** The spec's three sentences (§6.3), and the conflict banner's (§6.4). */
function statusText(save: QueueSnapshot): string {
  switch (save.status) {
    case 'saved': return 'כל השינויים נשמרו';
    case 'pending':
    case 'saving': return 'שומר…';
    case 'conflict': return 'המפה שונתה ממקום אחר מאז שנפתחה. השינויים האחרונים שלך עוד לא נשמרו.';
    case 'error': return `לא נשמר — ${save.error ?? ''}`;
  }
}

export function ScenePreview({ initial }: { initial: { doc: EditorDoc; version: number } }) {
  const planId = initial.doc.plot.id;
  const store = useEditorStore({
    doc: initial.doc,
    version: initial.version,
    save: (baseVersion, ops) => saveSiteChangesAction(planId, baseVersion, ops),
    load: () => loadSiteDocAction(planId),
  });
  const theme = useSyncExternalStore(subscribeTheme, shownTheme, () => 'light' as const);
  const [view, setView] = useState<ViewInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const shown = notice ?? store.notice;

  return (
    <div className={styles.preview}>
      <p className={styles.previewStatus} role="status">
        <span>{statusText(store.save)}</span>
        {store.save.status === 'error' ? (
          <button type="button" onClick={() => store.retrySave()}>ניסיון חוזר</button>
        ) : null}
        {store.conflict !== null ? (
          <>
            <button type="button" onClick={() => { void store.resolveConflict('theirs'); }}>טעינת הגרסה העדכנית</button>
            <button type="button" onClick={() => { void store.resolveConflict('mine'); }}>שמירת השינויים שלי מעליה</button>
          </>
        ) : null}
        {view === null ? null : <bdi>{`זום ${view.zoomPct}% · ${Math.round(view.yaw)}°`}</bdi>}
        {shown === null ? null : (
          <>
            <span>{shown}</span>
            <button type="button" onClick={() => { setNotice(null); store.dismissNotice(); }}>סגירה</button>
          </>
        )}
      </p>
      <div className={styles.previewScene}>
        <SceneView
          store={store}
          ui={{ ...UI_BASE, theme }}
          insets={NO_INSETS}
          sunDate={null}
          onView={setView}
          onNotice={setNotice}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 10: Read `?editor=3d`**

In `src/lib/site/views.ts`, in `interface SiteQuery`, after `  removing: boolean;` add:

```ts
  /**
   * `?editor=3d`: the bare 3D map instead of the board — temporary, so the
   * scene can be checked in a browser before the panels exist (plan 03,
   * Task 20). Task 26 makes the editor the page and removes the flag.
   */
  editor3d: boolean;
```

and in `parseSiteQuery`'s returned object, after `    removing: peek !== null && act === REMOVE_ACT,` add:

```ts
    editor3d: one(params.editor) === '3d',
```

(`carried()` is unchanged: only the season survives a link (R5), so closing a drawer returns to the board. The preview is for checking the scene, not for working in.)

- [ ] **Step 11: Mount it in `page.tsx`**

Replace the whole of `src/app/(admin)/site/page.tsx` with the file below. Against today's file the differences are: `loadDoc` joins the plan import and `ScenePreview` is imported; the plot button and the three drawers are built once (`plotLink`, `drawers`) so both branches render them; and, after `buildTasks`, the `?editor=3d` branch renders the top bar, the heading and `<ScenePreview initial={await loadDoc(…)} />` in place of the heading block, banner, tiles, board and table. Everything else is unchanged.

```tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { resolveSeason } from '@/lib/seasons/current';
import { listTasks } from '@/lib/work/tasks';
import { itemById, loadDoc, seasonsWithPlans, siteView } from '@/lib/site/plan';
import { formatArea, formatSize } from '@/lib/site/geometry';
import {
  copyHref, itemHref, parseSiteQuery, plotHref, removeItemHref, siteHref, type RawParams,
} from '@/lib/site/views';
import { TopBar, SeasonChip } from '@/components/shell/top-bar';
import { StatTile } from '@/components/ui/stat-tile';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { ButtonLink } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { SiteBoard } from './site-board';
import { SiteTable } from './site-table';
import { ItemDrawer } from './item-drawer';
import { PlotDrawer } from './plot-drawer';
import { CopyDrawer } from './copy-drawer';
import { RemoveItem } from './remove-item';
import { ScenePreview } from './editor/scene-preview';
import styles from './site.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'מפת הקאמפ' };

/**
 * מפת הקאמפ — where everything goes this year.
 *
 * One map per season, because the plot changes every burn. The board is the
 * editor; the table under it is the same map for a phone, a screen reader
 * and a printout; the tiles say what the drawing cannot say at a glance —
 * how much ground, how much of it shaded, what the fence cuts through.
 *
 * Every number on this screen was typed by somebody (R11): no workbook holds
 * a map, and the chips say so.
 */
export default async function SitePage(
  { searchParams }: { searchParams: Promise<RawParams> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) notFound();

  const params = await searchParams;
  const query = parseSiteQuery(params);
  const { current } = await resolveSeason(db, query.season || undefined);

  const crumbs = [{ label: 'מפת הקאמפ' }];

  if (current === null) {
    return (
      <main className={styles.page}>
        <TopBar crumbs={crumbs} />
        <h1>מפת הקאמפ</h1>
        <EmptyState
          kind="nothing-yet"
          noun="שנים"
          action={{ label: 'ייבוא מהגיליון', href: '/imports' }}
        />
      </main>
    );
  }

  /* The URL the sidebar wrote may carry no `season`; every link this page
     builds carries the one it resolved, so a switch of year survives a
     drawer (R5). */
  const here: RawParams = { season: current.id };
  const closeHref = siteHref(here);
  const view = await siteView(db, current.id);
  const others = (await seasonsWithPlans(db)).filter((plan) => plan.seasonId !== current.id);

  if (view === null) {
    return (
      <main className={styles.page}>
        <TopBar crumbs={crumbs} chip={<SeasonChip seasonName={current.name} />} />
        <h1>מפת הקאמפ</h1>
        <EmptyState
          kind="nothing-this-season"
          noun="מפות"
          seasonName={current.name}
          action={{ label: 'יצירת מפה', href: plotHref(here) }}
        />
        {others.length === 0 ? null : (
          <div className={styles.invitations}>
            <ButtonLink size="sm" href={copyHref(here)}>
              <Icon name="copy" size={14} />
              {`העתקה מ${others[0].seasonName}`}
            </ButtonLink>
          </div>
        )}
        {query.plot ? (
          <PlotDrawer seasonId={current.id} seasonName={current.name} plan={null} items={[]} closeHref={closeHref} />
        ) : null}
        {query.copy && others.length > 0 ? (
          <CopyDrawer seasonId={current.id} seasonName={current.name} sources={others} closeHref={closeHref} />
        ) : null}
      </main>
    );
  }

  const { plan, items, counts } = view;

  /* Fetched rather than found among `items`: the id comes from a URL, and a
     row that is not on this plan is not this page's to open. */
  const peekedRow = query.peek === null ? null : await itemById(db, query.peek);
  const peeked = peekedRow !== null && peekedRow.planId === plan.id
    ? items.find((item) => item.id === peekedRow.id) ?? null
    : null;
  const buildTasks = peeked === null ? [] : (await listTasks(db, current.id, { kind: 'build' }))
    .map((task) => ({ id: task.taskId, title: task.title }));

  const plotLink = (
    <ButtonLink size="sm" href={plotHref(here)}>
      <Icon name="grid" size={14} />
      גודל המגרש
    </ButtonLink>
  );

  const drawers = (
    <>
      {peeked !== null && !query.removing ? (
        <ItemDrawer
          item={peeked}
          buildTasks={buildTasks}
          closeHref={closeHref}
          removeHref={removeItemHref(here, peeked.id)}
        />
      ) : null}
      {peeked !== null && query.removing ? (
        <RemoveItem item={{ id: peeked.id, label: peeked.label }} cancelHref={closeHref} />
      ) : null}
      {query.plot ? (
        <PlotDrawer
          seasonId={current.id}
          seasonName={current.name}
          plan={{ id: plan.id, widthCm: plan.widthCm, depthCm: plan.depthCm, gridCm: plan.gridCm, notes: plan.notes }}
          items={items}
          closeHref={closeHref}
        />
      ) : null}
    </>
  );

  /* TEMPORARY (plan 03, Task 20): the bare 3D map behind `?editor=3d`, so the
     scene is checked in a browser before any panel is built on it. Task 26
     makes the editor the page and deletes this branch. `loadDoc` answers
     null only if the plan vanished since `siteView` read it; the board below
     is then the honest fallback. */
  if (query.editor3d) {
    const loaded = await loadDoc(db, plan.id);
    if (loaded !== null) {
      return (
        <main className={styles.page}>
          <TopBar crumbs={crumbs} chip={<SeasonChip seasonName={current.name} />} actions={plotLink} />
          <h1>מפת הקאמפ</h1>
          <ScenePreview initial={loaded} />
          {drawers}
        </main>
      );
    }
  }

  const firstOutside = items.find((item) => item.outside) ?? null;
  const shadeAttention = counts.shade.partly + counts.shade.unshaded;

  return (
    <main className={styles.page}>
      <TopBar crumbs={crumbs} chip={<SeasonChip seasonName={current.name} />} actions={plotLink} />

      <div className={styles.head}>
        <div>
          <h1>מפת הקאמפ</h1>
          <p className={styles.sub}>
            <bdi>{`מגרש של ${formatSize(plan.widthCm, plan.depthCm)} ל${current.name}`}</bdi>
            {' · '}
            <bdi>{`${counts.items} פריטים במפה`}</bdi>
          </p>
        </div>
      </div>

      {counts.outside > 0 ? (
        <Banner
          tone="danger"
          headline={<bdi>{`${counts.outside} פריטים נמצאים מחוץ למגרש.`}</bdi>}
          detail="המגרש שונה והפריטים לא זזו — יש להזיז אותם או להגדיל את המגרש."
          action={firstOutside === null ? undefined : { label: 'לפריט הראשון', href: itemHref(here, firstOutside.id) }}
          label="פריטים מחוץ למגרש"
        />
      ) : null}

      <div className={styles.tiles}>
        <StatTile
          label="שטח המגרש"
          value={formatArea(counts.plotAreaM2)}
          derivation={<bdi>{`${formatSize(plan.widthCm, plan.depthCm)} · נרשם ידנית`}</bdi>}
          href={plotHref(here)}
        />
        <StatTile
          label="שטח בצל"
          value={formatArea(counts.shade.shadedAreaM2)}
          tone={shadeAttention > 0 ? 'warn' : 'default'}
          derivation={counts.shade.nets === 0
            ? 'אין רשתות צל במפה'
            : <bdi>{`${counts.shade.nets} רשתות צל · ${shadeAttention} פריטים חלקית או ללא צל`}</bdi>}
        />
        <StatTile
          label="מחוץ למגרש"
          value={counts.outside}
          tone={counts.outside > 0 ? 'bad' : 'default'}
          derivation={counts.outside === 0 ? 'הכול בתוך הגדר' : 'הפריטים לא זזו לבד'}
          href={firstOutside === null ? undefined : itemHref(here, firstOutside.id)}
        />
        <StatTile
          label="חפיפות"
          value={counts.overlapPairs}
          tone={counts.overlapPairs > 0 ? 'warn' : 'default'}
          derivation={counts.overlapPairs === 0
            ? 'שום דבר לא יושב על משהו אחר'
            : <bdi>{`${counts.overlapping} פריטים מעורבים`}</bdi>}
        />
      </div>

      <SiteBoard
        plan={{ id: plan.id, widthCm: plan.widthCm, depthCm: plan.depthCm, gridCm: plan.gridCm }}
        items={items.map((item) => ({
          id: item.id, kind: item.kind, label: item.label, sort: item.sort,
          xCm: item.xCm, yCm: item.yCm, widthCm: item.widthCm, depthCm: item.depthCm,
          insetCm: item.insetCm,
        }))}
        season={current.id}
        initialSelected={peeked?.id ?? null}
      />

      <SiteTable
        items={items}
        params={here}
        season={current.id}
        rowActions={(row) => (
          /* Two glyphs, named for assistive technology (E4): the pencil opens
             the same drawer the board's toolbar does, the bin opens the
             confirmation — never the delete itself. */
          <>
            <ButtonLink tone="ghost" size="sm" iconLabel="עריכה" href={itemHref(here, row.id)}>
              <Icon name="pencil" size={15} />
            </ButtonLink>
            <ButtonLink tone="ghost" size="sm" iconLabel="מחיקה" href={removeItemHref(here, row.id)}>
              <Icon name="trash" size={15} />
            </ButtonLink>
          </>
        )}
        empty={(
          /* An invitation: the palette above is how a thing gets on the map. */
          <EmptyState kind="nothing-this-season" noun="פריטים במפה" seasonName={current.name} />
        )}
      />

      {drawers}
    </main>
  );
}
```

- [ ] **Step 12: Run the tests, and the three guard**

Run: `npx vitest run "src/app/(admin)/site/editor/scene/labels-layer.test.tsx" "src/app/(admin)/site/editor/scene/scene-view.test.tsx" src/lib/site/views.test.ts "src/app/(admin)/site/page.test.tsx" "src/app/(admin)/site/editor/three-guard.test.ts" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: 27 passed — labels layer 5, scene view 4, views 1, page 15 (the 11 existing and 4 new), the guard 2 — exit 0.

Then run the whole of this plan's scope once, to catch a later task breaking an earlier one:

Run: `npx vitest run "src/app/(admin)/site/editor" src/lib/site/views.test.ts "src/app/(admin)/site/page.test.tsx" --maxWorkers=4 --hookTimeout 60000 --testTimeout 60000 --reporter=default --reporter=json --outputFile ".vitest/json/run-$$.json"`
Expected: every file passes — 98 tests from this plan (11 + 13 + 20 + 9 + 20 + 5 + 4 + 1 + 15) plus the guard's 2 — exit 0.

- [ ] **Step 13: Typecheck and lint**

Run: `npx tsc --noEmit` — expected exit 0.
Run: `rtk proxy npx eslint "src/app/(admin)/site" src/lib/site/views.ts src/lib/site/views.test.ts` — expected no problems.

- [ ] **Step 14: Commit**

```bash
git add "src/app/(admin)/site/editor/scene/scene.module.css" "src/app/(admin)/site/editor/scene/overlay.ts" "src/app/(admin)/site/editor/scene/labels-layer.tsx" "src/app/(admin)/site/editor/scene/labels-layer.test.tsx" "src/app/(admin)/site/editor/scene/engine.ts" "src/app/(admin)/site/editor/scene/scene-view.tsx" "src/app/(admin)/site/editor/scene/scene-view.test.tsx" "src/app/(admin)/site/editor/scene-preview.tsx" src/lib/site/views.ts src/lib/site/views.test.ts "src/app/(admin)/site/page.tsx" "src/app/(admin)/site/page.test.tsx"
git commit -m "feat(site): the 3D map — SceneView, labels that never overlap, the bare editor at /site?editor=3d

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 15: Check it in a browser (Playwright MCP)**

Spec §17's first risk is that `three` or `next/dynamic` behaves differently in Next 16.3; this step is where that is found out, before any panel is built on the scene. The Playwright MCP tools are deferred: load them first with ToolSearch, `select:mcp__plugin_playwright_playwright__browser_navigate,mcp__plugin_playwright_playwright__browser_snapshot,mcp__plugin_playwright_playwright__browser_take_screenshot,mcp__plugin_playwright_playwright__browser_click,mcp__plugin_playwright_playwright__browser_type,mcp__plugin_playwright_playwright__browser_run_code_unsafe,mcp__plugin_playwright_playwright__browser_console_messages`.

1. **The database.** Run `docker ps -a --filter name=shliff`. Expected: `shliff-pg` with status `Up`, publishing port **5433**. If it is stopped or missing, **STOP and ask the camp lead.** It is stopped on purpose to relieve memory pressure; do not start it. A stopped database makes the page throw connection errors that read exactly like a code defect.

2. **Migration 0012 in the local database** (read-only):
   `docker exec shliff-pg psql -U shliff -d shliff -tAc "select count(*) from information_schema.columns where table_name in ('site_plans','site_items') and column_name in ('version','north_deg','height_cm','locked')"`
   Expected: `4`. Anything else: **STOP and ask the camp lead** how `0012` should reach the local database — applying it writes to the shared development database, and `loadDoc` cannot read a plan without those columns.

3. **A season that has a map** (read-only):
   `docker exec shliff-pg psql -U shliff -d shliff -tAc "select s.id, s.name, count(i.id) from site_plans p join seasons s on s.id = p.season_id left join site_items i on i.plan_id = p.id group by s.id, s.name order by s.name"`
   Pick a season with items; call its id `<season>`. If no season has a map with items, **STOP and ask the camp lead** which map to check against (creating one writes data).

4. **Environment.** The worktree needs a `.env.local`. If `/Users/yarin/GitProjects/Shliff_Platform-lanes/site-3d/.env.local` does not exist, copy the main checkout's: `cp /Users/yarin/GitProjects/Shliff_Platform/.env.local /Users/yarin/GitProjects/Shliff_Platform-lanes/site-3d/.env.local`. It is gitignored (`git check-ignore -v .env.local` names `.gitignore`); never stage it.

5. **The dev server.** Find a free port: `lsof -nP -iTCP:3000 -sTCP:LISTEN` — if anything answers (the main checkout's server, most likely), use 3001 (then 3002…). Start `npm run dev -- --port <port>` in the worktree with the Bash tool's `run_in_background`, then poll `curl -s -o /dev/null -w '%{http_code}' http://localhost:<port>/signin` until it prints `200`.

6. **Signing in.** `/site` calls `requireAdmin()` (`src/lib/auth/guard.ts`): a NextAuth session whose user has `role === 'admin'`, issued by the Credentials provider in `src/lib/auth/config.ts` — an email and password checked against the `users` table (argon2). There is no development bypass, so this step needs the camp lead's session: `browser_navigate` to `http://localhost:<port>/signin`, then **STOP and ask the camp lead** either to sign in in that Playwright browser window themselves, or to give credentials for a local admin, which you type with `browser_type` and submit with `browser_click`. Do not run `scripts/create-admin.ts` without their go-ahead — it writes to the shared development database.

7. **The map.** `browser_navigate` to `http://localhost:<port>/site?season=<season>&editor=3d`, wait two seconds, then `browser_snapshot`. Expected: the heading "מפת הקאמפ", a status line reading "כל השינויים נשמרו" with a readout like "זום 100% · 334°", and an image named "מפת הקאמפ" (the canvas). No board, no tiles, no table.

8. **It renders.** `browser_take_screenshot`. Expected, by eye: the plot in the palette's sand colour on a darker ground, the grid (fine lines and five-metre lines), the dashed fence, every item standing in its group's colour — tents with gable roofs, sofas with backs, cylinders, nets as poles with a see-through cloth and the dashed unshaded strip — each with edges, and a label per item or group with no two labels overlapping.

9. **Orbit, pan, zoom.** With `browser_run_code_unsafe`, pass each function below as `code`, then take a screenshot and a snapshot after each:
   - Orbit (right-drag):
     `async (page) => { const b = await page.locator('canvas').boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2; await page.mouse.move(x, y); await page.mouse.down({ button: 'right' }); await page.mouse.move(x + 160, y + 40, { steps: 12 }); await page.mouse.up({ button: 'right' }); }`
     Expected: the view has turned and tilted; the readout's degrees changed from 334; no context menu appeared.
   - Pan (drag from a bare corner of the ground):
     `async (page) => { const b = await page.locator('canvas').boundingBox(); const x = b.x + 30, y = b.y + b.height - 30; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 200, y - 80, { steps: 12 }); await page.mouse.up(); }`
     Expected: the whole map moved with the pointer; the zoom percentage is unchanged.
   - Zoom (wheel toward the middle):
     `async (page) => { const b = await page.locator('canvas').boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); for (let i = 0; i < 5; i += 1) await page.mouse.wheel(0, -120); }`
     Expected: the map is larger and the zoom percentage is above 100.

   Saving is not exercised here: moving an item writes to the shared development database. Task 27 checks every gesture in §8, saving included, with the camp lead's go-ahead.

10. **No console errors.** `browser_console_messages` with `level: "error"`. Expected: none. A `THREE.WebGLRenderer` warning at level `warning` is worth noting in the report but is not a failure.

11. **Stop the dev server** (the background task's stop, or `kill` on the pid `lsof -nP -iTCP:<port> -sTCP:LISTEN` names).

If anything fails, fix it test-first in the file that owns it, re-run Step 12 and Step 13, commit with a message naming what the browser showed, and repeat this step.

- [ ] **Step 16: Commit what `next dev` rewrote, if anything**

Run: `git status --short`. If `AGENTS.md` shows as modified, it is the Next.js block `next dev` regenerates (`CLAUDE.md`, "Traps"); deleting it only recreates it. Commit it on its own:

```bash
git add AGENTS.md
git commit -m "chore: AGENTS.md's Next.js block as next dev writes it

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Nothing else may be left uncommitted by this plan: `.env.local` is ignored, and `.vitest/json/` holds only run reports.

---

## When Task 20 is done

`/site?editor=3d` shows the camp's real map in 3D, orbitable, pannable and zoomable, with non-overlapping labels, saving in the background through `saveSiteChangesAction`. The board is still the page without the flag. Plan 04 builds `site-editor.tsx` and its panels on `useEditorStore` and `SceneView` exactly as the contract names them, and Task 26 replaces `scene-preview.tsx` and the `?editor=3d` branch with the editor itself.
