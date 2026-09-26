/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DirectionalLight } from 'three';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import { mapDirection } from '@/lib/site/editor/sun';
import type { EditorStore } from '../use-editor-store';
import type { SceneHandle, ViewInfo } from './scene-view';

/* jsdom has no WebGL. Each test decides what the renderer does: throw, as a
   browser without WebGL does, or stand in for a GPU — counting its frames,
   naming the camera it last drew with, and counting what it was given back.
   `failsAfter` breaks the first resize, after the renderer exists. The
   directional light is the real one, remembered, so a test can read where
   the engine aimed it. */
const { renderer, lights } = vi.hoisted(() => ({
  renderer: {
    fails: false, failsAfter: false, created: 0, frames: 0, camera: '', disposed: 0, contextLost: 0,
    /* What the canvas is drawn at: the pixel ratio last set, and the CSS size last set with it. */
    pixelRatio: 0, size: [0, 0] as [number, number], sized: 0,
  },
  lights: [] as unknown[],
}));
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class WebGLRenderer {
    shadowMap = { enabled: false };
    constructor() {
      renderer.created += 1;
      if (renderer.fails) throw new Error('Error creating WebGL context.');
    }
    setPixelRatio(ratio: number) { renderer.pixelRatio = ratio; }
    setSize(width: number, height: number) {
      if (renderer.failsAfter) throw new Error('Something broke after the context was made.');
      renderer.size = [width, height];
      renderer.sized += 1;
    }
    render(_scene: unknown, camera: { type: string }) {
      renderer.frames += 1;
      renderer.camera = camera.type;
    }
    dispose() { renderer.disposed += 1; }
    forceContextLoss() { renderer.contextLost += 1; }
  }
  class RememberedLight extends actual.DirectionalLight {
    constructor(...args: ConstructorParameters<typeof actual.DirectionalLight>) {
      super(...args);
      lights.push(this);
    }
  }
  return { ...actual, WebGLRenderer, DirectionalLight: RememberedLight };
});

/* The label layout is the real one, counted: a test can tell whether a
   change made the engine lay the labels out again. */
const layouts = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/lib/site/editor/label-layout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/site/editor/label-layout')>();
  return {
    ...actual,
    layoutLabels: (...args: Parameters<typeof actual.layoutLabels>) => {
      layouts.count += 1;
      return actual.layoutLabels(...args);
    },
  };
});

import { LOCKED_NOTICE } from '../notices';
import { SceneSync } from './scene-sync';
import { NO_WEBGL, SCENE_FAILED, SceneView, type EditorUi } from './scene-view';

const UI: EditorUi = {
  tool: 'select', mode: '3d', labels: true, sun: false, netsHidden: false,
  snap: true, hiddenGroups: [], hour: 14, theme: 'light', underlay: { shown: true, opacity: 0.5 },
};

function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 1150, yCm: 1050, widthCm: 300, depthCm: 300,
    heightCm: null, insetCm: null, ropeAngleDeg: null, sort: 0, taskId: null, notes: null, facing: 0, locked: false, ...over,
  };
}

const DOC: EditorDoc = {
  plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 },
  items: [item({ id: 'tent' })],
  lines: [],
  defaults: {},
};

function docOf(items: EditorItem[], plot: EditorDoc['plot'] = DOC.plot): EditorDoc {
  return { plot, items, lines: [], defaults: {} };
}

function fakeStore(over: Partial<EditorStore> = {}): EditorStore {
  return {
    doc: DOC, selection: [], canUndo: false, canRedo: false,
    flags: { outside: new Set(), overlapping: new Set(), partly: new Set(), pairs: [], onRopes: new Set(), ropePairs: [] },
    save: { status: 'saved', version: 0, pending: 0, error: null, errorKind: null }, conflict: null, notice: null,
    run: vi.fn(), undo: vi.fn(() => null), redo: vi.fn(() => null), select: vi.fn(),
    resolveConflict: vi.fn(async () => {}), retrySave: vi.fn(), dismissNotice: vi.fn(), pendingOps: vi.fn(() => []), allowUnload: vi.fn(),
    ...over,
  };
}

const NO_INSETS = { left: 0, right: 0, top: 0, bottom: 0 };

function renderScene(store = fakeStore(), ui: EditorUi = UI, sunDate: string | null = null) {
  const onView = vi.fn<(info: ViewInfo) => void>();
  const onNotice = vi.fn();
  const onModeSettled = vi.fn();
  const handle = createRef<SceneHandle>();
  const scene = (next: EditorStore, nextUi: EditorUi, nextSunDate: string | null) => (
    <SceneView ref={handle} store={next} ui={nextUi} insets={{ ...NO_INSETS }}
      sunDate={nextSunDate} onView={onView} onNotice={onNotice} onModeSettled={onModeSettled} />
  );
  const view = render(scene(store, ui, sunDate));
  const rerenderWith = (next: EditorStore, nextUi: EditorUi = ui, nextSunDate: string | null = sunDate) => {
    view.rerender(scene(next, nextUi, nextSunDate));
  };
  return { ...view, onView, onNotice, onModeSettled, handle, store, rerenderWith };
}

function canvasOf(container: HTMLElement): HTMLCanvasElement {
  return container.querySelector('canvas') as HTMLCanvasElement;
}

/** A mouse, a pen or the first finger: the pointer the map follows. */
const PRIMARY = { button: 0, pointerId: 1, isPrimary: true };

function press(canvas: HTMLCanvasElement, [x, y]: [number, number], over: Record<string, unknown> = {}) {
  fireEvent.pointerDown(canvas, { clientX: x, clientY: y, ...PRIMARY, ...over });
}
function slide(canvas: HTMLCanvasElement, [x, y]: [number, number], over: Record<string, unknown> = {}) {
  fireEvent.pointerMove(canvas, { clientX: x, clientY: y, ...PRIMARY, ...over });
}
function lift(canvas: HTMLCanvasElement, [x, y]: [number, number], over: Record<string, unknown> = {}) {
  fireEvent.pointerUp(canvas, { clientX: x, clientY: y, ...PRIMARY, ...over });
}

function drag(canvas: HTMLCanvasElement, from: [number, number], to: [number, number], over: Record<string, unknown> = {}) {
  press(canvas, from, over);
  slide(canvas, to, over);
  lift(canvas, to, over);
}

function wait(ms: number) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** Long enough for any frame the engine asked for to have run. */
function frames() {
  return wait(80);
}

const realRect = Element.prototype.getBoundingClientRect;
const realGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  Object.assign(renderer, {
    fails: false, failsAfter: false, created: 0, frames: 0, camera: '', disposed: 0, contextLost: 0,
    pixelRatio: 0, size: [0, 0], sized: 0,
  });
  lights.length = 0;
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
    expect(screen.queryByText(SCENE_FAILED)).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.textContent).not.toMatch(/[A-Za-z]/);
  });

  it('says the map did not load — not that WebGL is missing — when something fails after the renderer exists, and gives the context back', () => {
    renderer.failsAfter = true;
    const { container } = renderScene();
    expect(renderer.created).toBe(1);
    expect(screen.getByText('המפה לא נטענה. רענון הדף ינסה שוב.')).toBeTruthy();
    expect(SCENE_FAILED).toBe('המפה לא נטענה. רענון הדף ינסה שוב.');
    expect(screen.queryByText(NO_WEBGL)).toBeNull();
    expect(renderer.disposed).toBe(1);
    expect(renderer.contextLost).toBe(1);
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
    expect(renderer.camera).toBe('PerspectiveCamera');
    expect(onView.mock.calls.at(-1)?.[0]).toMatchObject({ moving: false, zoomPct: 100, selectionBox: null });
    expect(screen.getByText('אוהל 1')).toBeTruthy();
  });

  it('draws nothing new for a render that changed nothing, and draws again when something did', async () => {
    const { onView, rerenderWith, store } = renderScene();
    await waitFor(() => { expect(onView).toHaveBeenCalled(); });
    await frames();
    const drawn = renderer.frames;

    // The same store and equal (but new) ui and insets objects: nothing to draw.
    rerenderWith(store, { ...UI });
    await frames();
    expect(renderer.frames).toBe(drawn);

    rerenderWith(fakeStore({ selection: ['tent'] }), { ...UI });
    await frames();
    expect(renderer.frames).toBeGreaterThan(drawn);
  });

  /* A window dragged to a sharper screen keeps its CSS size, so no resize
     reports it; only the resolution query does. Without following it the
     canvas is drawn at the old density and stretched — blurred. */
  it('draws at the screen’s pixel density, and follows it to another screen, never past 2×', async () => {
    const ownRatio = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    const ownMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    const watched: Array<{ query: string; listener: (() => void) | null }> = [];
    const setRatio = (value: number) => {
      Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true, writable: true });
    };
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => {
        const entry = { query, listener: null as (() => void) | null };
        watched.push(entry);
        return {
          matches: true, media: query, onchange: null,
          addEventListener: (_type: string, listener: () => void) => { entry.listener = listener; },
          // Only the function that was added comes off: removing any other leaves it listening.
          removeEventListener: (_type: string, listener: () => void) => {
            if (listener === entry.listener) entry.listener = null;
          },
          addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
        };
      },
    });
    const screenChanges = () => { watched.at(-1)?.listener?.(); };
    try {
      setRatio(1);
      const { onView, unmount } = renderScene();
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      expect(renderer.pixelRatio).toBe(1);
      expect(renderer.size).toEqual([1000, 700]);

      setRatio(2);
      screenChanges();
      await frames();
      expect(renderer.pixelRatio).toBe(2);
      expect(renderer.size).toEqual([1000, 700]);
      // Watching again, for a change away from the new density.
      expect(watched.at(-1)?.query).toBe('(resolution: 2dppx)');
      expect(watched.filter((entry) => entry.listener !== null)).toHaveLength(1);

      const sized = renderer.sized;
      setRatio(3);
      screenChanges();
      await frames();
      expect(renderer.pixelRatio).toBe(2);
      expect(renderer.sized).toBe(sized);

      unmount();
      expect(watched.filter((entry) => entry.listener !== null)).toHaveLength(0);
    } finally {
      if (ownRatio === undefined) Reflect.deleteProperty(window, 'devicePixelRatio');
      else Object.defineProperty(window, 'devicePixelRatio', ownRatio);
      if (ownMedia === undefined) Reflect.deleteProperty(window, 'matchMedia');
      else Object.defineProperty(window, 'matchMedia', ownMedia);
    }
  });

  /* Ruling X1, "fully fit": a window made larger or smaller refits the plot
     while the view is still the automatic fit — the first one, or the last F.
     A view the lead has framed (orbit, pan, zoom, a jump) is theirs, and a
     resize keeps it. jsdom has no ResizeObserver: this one hands the test
     the engine's callback, and the stage's box is the one given here. */
  describe('when the stage is resized', () => {
    const own = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
    const callbacks: Array<() => void> = [];

    beforeEach(() => {
      callbacks.length = 0;
      Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        writable: true,
        value: class {
          constructor(callback: () => void) { callbacks.push(callback); }
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      });
    });

    afterEach(() => {
      if (own === undefined) Reflect.deleteProperty(globalThis, 'ResizeObserver');
      else Object.defineProperty(globalThis, 'ResizeObserver', own);
    });

    function resizeStage(width: number, height: number) {
      Element.prototype.getBoundingClientRect = () => ({
        width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON: () => ({}),
      });
      for (const callback of callbacks) callback();
    }

    /** Past the settle time, so the last report is the settled view. */
    const settled = () => wait(450);

    it('fits the plot to the new stage while the view is still the automatic fit', async () => {
      const { onView } = renderScene();
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      await settled();
      expect(onView.mock.lastCall?.[0].zoomPct).toBe(100);

      // Narrower than it is tall: the plot's width now decides the fit.
      resizeStage(500, 700);
      await settled();
      expect(renderer.size).toEqual([500, 700]);
      expect(onView.mock.lastCall?.[0]).toMatchObject({ zoomPct: 100, moving: false });
    });

    it('keeps a view the lead has framed, until F makes it the automatic fit again', async () => {
      const { onView, handle } = renderScene();
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      await settled();

      handle.current?.jumpTo(700, 600);
      handle.current?.zoomBy(0.8);
      await settled();
      expect(onView.mock.lastCall?.[0].zoomPct).toBe(125);
      const framed = handle.current?.centreGround();
      expect(framed?.[0]).toBeCloseTo(700, 0);
      expect(framed?.[1]).toBeCloseTo(600, 0);

      resizeStage(500, 700);
      await settled();
      // Where the lead put it, as close as they put it: not refitted.
      const kept = handle.current?.centreGround();
      expect(kept?.[0]).toBeCloseTo(700, 0);
      expect(kept?.[1]).toBeCloseTo(600, 0);
      expect(onView.mock.lastCall?.[0].zoomPct).not.toBe(100);

      handle.current?.fitAll();
      await wait(420); // the fly-to
      await settled();
      expect(onView.mock.lastCall?.[0]).toMatchObject({ zoomPct: 100, moving: false });
      resizeStage(1000, 700);
      await settled();
      expect(onView.mock.lastCall?.[0]).toMatchObject({ zoomPct: 100, moving: false });
    });
  });

  it('aims the light over the plot, and follows the plot when it is resized', async () => {
    const { onView, rerenderWith } = renderScene();
    await waitFor(() => { expect(onView).toHaveBeenCalled(); });
    const light = lights.at(-1) as DirectionalLight;
    // Half the plot's diagonal, in metres, and ten more.
    expect(light.shadow.camera.right).toBeCloseTo(Math.hypot(26, 24) / 2 + 10, 5);
    expect(light.target.position.x).toBeCloseTo(13, 5);

    rerenderWith(fakeStore({ doc: docOf(DOC.items, { ...DOC.plot, widthCm: 5200, depthCm: 4800 }) }));
    expect(light.shadow.camera.right).toBeCloseTo(Math.hypot(52, 48) / 2 + 10, 5);
    expect(light.target.position.x).toBeCloseTo(26, 5);
    expect(light.target.position.z).toBeCloseTo(24, 5);
  });

  /* Ruling P15 (review minor): one check of the day's shape, `readSunDate`.
     The engine kept a pattern of its own, which took 31 February for a day
     and lit a sun for a date the calendar does not have — a guessed day. */
  it('lights the sun only for a day the calendar has', async () => {
    const noon = { ...UI, sun: true, hour: 12 };
    const real = renderScene(fakeStore(), noon, '2026-06-04');
    await waitFor(() => { expect(real.onView).toHaveBeenCalled(); });
    expect((lights.at(-1) as DirectionalLight).castShadow).toBe(true);
    real.unmount();

    const impossible = renderScene(fakeStore(), noon, '2026-02-31');
    await waitFor(() => { expect(impossible.onView).toHaveBeenCalled(); });
    expect((lights.at(-1) as DirectionalLight).castShadow).toBe(false);
    expect(impossible.onNotice).not.toHaveBeenCalled();
  });

  /*
   * Shade by hour plays (SIM2): the hour changes up to ten times a second.
   * A new hour or a new day moves only the light — the meshes and the labels
   * stay as they are. Only the sun coming on or going off (switched, or set
   * below the horizon by the hour) changes what the scene draws: real shadows
   * instead of the drawn patches.
   */
  describe('the sun', () => {
    const SUN: EditorUi = { ...UI, sun: true };
    let syncs: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { syncs = vi.spyOn(SceneSync.prototype, 'sync'); });
    afterEach(() => { syncs.mockRestore(); });

    it('re-aims for a new hour or a new day without rebuilding the scene or laying the labels out again', async () => {
      const store = fakeStore();
      const { onView, rerenderWith } = renderScene(store, { ...SUN, hour: 10 }, '2026-06-04');
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      await frames();
      const light = lights.at(-1) as DirectionalLight;
      expect(light.castShadow).toBe(true);
      const aimed = light.position.clone();
      const [laid, synced, drawn] = [layouts.count, syncs.mock.calls.length, renderer.frames];

      rerenderWith(store, { ...SUN, hour: 15 });
      await frames();
      expect(light.position.distanceTo(aimed)).toBeGreaterThan(1);
      expect(renderer.frames).toBeGreaterThan(drawn);
      expect(layouts.count).toBe(laid);
      expect(syncs.mock.calls.length).toBe(synced);

      const afternoon = light.position.clone();
      rerenderWith(store, { ...SUN, hour: 15 }, '2026-11-02');
      await frames();
      expect(light.position.distanceTo(afternoon)).toBeGreaterThan(1);
      expect(layouts.count).toBe(laid);
      expect(syncs.mock.calls.length).toBe(synced);
    });

    it('rebuilds the scene and lays the labels out again when the sun is switched on or off', async () => {
      const store = fakeStore();
      const { onView, rerenderWith } = renderScene(store, { ...UI, hour: 10 }, '2026-06-04');
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      await frames();
      const light = lights.at(-1) as DirectionalLight;
      expect(light.castShadow).toBe(false);
      let [laid, synced] = [layouts.count, syncs.mock.calls.length];

      rerenderWith(store, { ...SUN, hour: 10 });
      await frames();
      expect(light.castShadow).toBe(true);
      expect(syncs.mock.lastCall?.[0]).toMatchObject({ sun: true });
      expect(syncs.mock.calls.length).toBeGreaterThan(synced);
      expect(layouts.count).toBeGreaterThan(laid);
      [laid, synced] = [layouts.count, syncs.mock.calls.length];

      rerenderWith(store, { ...UI, hour: 10 });
      await frames();
      expect(light.castShadow).toBe(false);
      expect(syncs.mock.lastCall?.[0]).toMatchObject({ sun: false });
      expect(syncs.mock.calls.length).toBeGreaterThan(synced);
      expect(layouts.count).toBeGreaterThan(laid);
    });

    it('brings the drawn patches back when the hour sets the sun, without laying the labels out again', async () => {
      const store = fakeStore();
      const { onView, rerenderWith } = renderScene(store, { ...SUN, hour: 12 }, '2026-11-02');
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      await frames();
      const [laid, synced] = [layouts.count, syncs.mock.calls.length];
      // 2 November's sunset is 16:50:56 (the almanac): at 17:30 the sun is down.
      rerenderWith(store, { ...SUN, hour: 17.5 });
      await frames();
      expect((lights.at(-1) as DirectionalLight).castShadow).toBe(false);
      expect(syncs.mock.calls.length).toBeGreaterThan(synced);
      expect(syncs.mock.lastCall?.[0]).toMatchObject({ sun: false });
      expect(layouts.count).toBe(laid);
    });
  });

  it('lays the labels out again once the web font has loaded, and does nothing if that is after it is gone', async () => {
    let loaded: () => void = () => {};
    const ready = new Promise<void>((resolve) => { loaded = resolve; });
    Object.defineProperty(document, 'fonts', { value: { ready }, configurable: true });
    try {
      const { onView } = renderScene();
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      await frames();
      const drawn = renderer.frames;
      loaded();
      await frames();
      expect(renderer.frames).toBeGreaterThan(drawn);

      let late: () => void = () => {};
      const lateReady = new Promise<void>((resolve) => { late = resolve; });
      Object.defineProperty(document, 'fonts', { value: { ready: lateReady }, configurable: true });
      const { unmount } = renderScene();
      await frames();
      unmount();
      const before = renderer.frames;
      late();
      await frames();
      expect(renderer.frames).toBe(before);
    } finally {
      delete (document as { fonts?: unknown }).fonts;
    }
  });

  it('lets go of everything when it goes: the renderer, the context, the listeners and the frame it asked for', async () => {
    const removed = vi.spyOn(window, 'removeEventListener');
    const cancelled = vi.spyOn(globalThis, 'cancelAnimationFrame');
    try {
      const { container, onView, rerenderWith, unmount } = renderScene(fakeStore(), { ...UI, mode: 'plan', labels: false });
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      await frames();
      const canvas = canvasOf(container);
      const selected = fakeStore({ selection: ['tent'] });
      rerenderWith(selected); // asks for a frame…
      const drawn = renderer.frames;
      unmount(); // …that never comes

      expect(cancelled).toHaveBeenCalled();
      expect(renderer.disposed).toBe(1);
      expect(renderer.contextLost).toBe(1);
      expect(canvas.isConnected).toBe(false);
      expect(removed).toHaveBeenCalledWith('blur', expect.any(Function));

      drag(canvas, [500, 350], [500, 350]);
      expect(selected.select).not.toHaveBeenCalled();
      await frames();
      expect(renderer.frames).toBe(drawn);
    } finally {
      removed.mockRestore();
      cancelled.mockRestore();
    }
  });

  describe('switching between plan and 3D', () => {
    it('lands in the orthographic camera once the tilt to plan has finished', async () => {
      const { onView, onModeSettled, rerenderWith, store } = renderScene();
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      rerenderWith(store, { ...UI, mode: 'plan' });
      await wait(800);
      expect(onModeSettled.mock.calls).toEqual([['plan']]);
      expect(renderer.camera).toBe('OrthographicCamera');
    });

    it('lands in 3D, orbiting, when a switch to plan is turned back halfway', async () => {
      const { container, onView, onModeSettled, rerenderWith, store } = renderScene();
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      rerenderWith(store, { ...UI, mode: 'plan' });
      await wait(150);
      rerenderWith(store, { ...UI, mode: '3d' });
      await wait(900);
      expect(onModeSettled.mock.calls).toEqual([['3d']]);
      expect(renderer.camera).toBe('PerspectiveCamera');

      // A right-drag orbits in 3D (in plan it would pan): 100 px is 35° of yaw.
      const yaw = onView.mock.calls.at(-1)?.[0].yaw ?? NaN;
      drag(canvasOf(container), [500, 600], [600, 600], { button: 2 });
      await wait(400);
      const turned = onView.mock.calls.at(-1)?.[0].yaw ?? NaN;
      expect((turned - yaw + 360) % 360).toBeCloseTo(35, 3);
    });

    it('fits the plot as plan when asked to halfway through the switch to plan', async () => {
      const { handle, onView, onModeSettled, rerenderWith, store } = renderScene();
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      rerenderWith(store, { ...UI, mode: 'plan' });
      await wait(150);
      handle.current?.fitAll();
      await wait(900);
      expect(onModeSettled.mock.calls).toEqual([['plan']]);
      expect(renderer.camera).toBe('OrthographicCamera');
      // North up, as the switch left it, and the whole plot: the plan fit, not a 3D one.
      expect(onView.mock.calls.at(-1)?.[0]).toMatchObject({ moving: false, yaw: 0, zoomPct: 100 });
    });
  });

  describe('north up', () => {
    /** Turns north up on a plot whose map-up faces `northDeg`, and waits for the turn to settle. */
    async function turnedNorthUp(northDeg: number) {
      const doc = docOf(DOC.items, { ...DOC.plot, northDeg });
      const { handle, onView } = renderScene(fakeStore({ doc }));
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      handle.current?.northUp();
      await wait(800); // a 380 ms turn, then the view settles
      return { handle, info: onView.mock.calls.at(-1)?.[0] };
    }

    /**
     * Which way the top of the screen is, as a unit map direction: from the
     * ground under the middle to the ground above it. The oracle is
     * `sun.ts`'s `mapDirection(0, northDeg)` — where true north lies on a
     * map whose up faces `northDeg` — which the engine does not use.
     */
    function screenUp(handle: { current: SceneHandle | null }): [number, number] {
      const middle = handle.current?.groundAtClient(500, 350) ?? [NaN, NaN];
      const above = handle.current?.groundAtClient(500, 250) ?? [NaN, NaN];
      const length = Math.hypot(above[0] - middle[0], above[1] - middle[1]);
      return [(above[0] - middle[0]) / length, (above[1] - middle[1]) / length];
    }

    it('turns the map’s own up to the top when that is north, as it always did', async () => {
      const { handle, info } = await turnedNorthUp(0);
      expect(info).toMatchObject({ moving: false, yaw: 0 });
      const [x, y] = screenUp(handle);
      expect(x).toBeCloseTo(mapDirection(0, 0)[0], 6);
      expect(y).toBeCloseTo(mapDirection(0, 0)[1], 6);
    });

    it('turns true north to the top when the map’s up faces east', async () => {
      const { handle, info } = await turnedNorthUp(90);
      expect(info?.moving).toBe(false);
      expect(info?.yaw).toBeCloseTo(90, 6);
      // North is then the map's west, (−1, 0).
      const [x, y] = screenUp(handle);
      expect(x).toBeCloseTo(mapDirection(0, 90)[0], 6);
      expect(y).toBeCloseTo(mapDirection(0, 90)[1], 6);
    });

    it('turns true north to the top on the camp’s 2025 plot, six degrees off', async () => {
      const { handle, info } = await turnedNorthUp(6);
      expect(info?.yaw).toBeCloseTo(6, 6);
      const [x, y] = screenUp(handle);
      expect(x).toBeCloseTo(mapDirection(0, 6)[0], 6);
      expect(y).toBeCloseTo(mapDirection(0, 6)[1], 6);
    });
  });

  /* Plan view frames the plot's middle exactly at the screen's middle, so the
     tent at the plot's middle is under (500, 350) and the corner is bare ground.
     The plot is 2600 × 2400 cm in a 1000 × 700 box: 0.2917 px a centimetre,
     so the tent's north-west corner is at (456.25, 306.25). */
  const PLAN: EditorUi = { ...UI, mode: 'plan' };
  const QUIET_PLAN: EditorUi = { ...PLAN, labels: false };

  it('clears the selection on a click on empty ground', async () => {
    const { container, onView, store } = renderScene(fakeStore({ selection: ['tent'] }), PLAN);
    await waitFor(() => { expect(onView).toHaveBeenCalled(); });
    const canvas = canvasOf(container);
    press(canvas, [5, 690]);
    lift(canvas, [5, 690]);
    expect(store.select).toHaveBeenCalledWith([]);
  });

  it('selects the item under a click', async () => {
    // No labels: the click must reach the tent itself, not its label.
    const { container, onView, store } = renderScene(fakeStore(), QUIET_PLAN);
    await waitFor(() => { expect(onView).toHaveBeenCalled(); });
    const canvas = canvasOf(container);
    press(canvas, [500, 350]);
    lift(canvas, [500, 350]);
    expect(store.select).toHaveBeenCalledWith(['tent']);
  });

  it('never reports a click as the view moving, even with a small tremor', async () => {
    const { container, onView, rerenderWith } = renderScene(fakeStore(), QUIET_PLAN);
    await waitFor(() => { expect(onView).toHaveBeenCalled(); });
    await wait(150); // past the ten-a-second limit, so a "moving" report could not be held back by it
    const canvas = canvasOf(container);
    const before = onView.mock.calls.length;
    press(canvas, [500, 350]);
    rerenderWith(fakeStore({ selection: ['tent'] })); // the store answers the click
    await frames(); // the button is still down
    slide(canvas, [502, 351]);
    lift(canvas, [502, 351]);
    await wait(300);
    const after = onView.mock.calls.slice(before).map(([info]) => info);
    expect(after.some((info) => info.selectionBox !== null)).toBe(true);
    expect(after.filter((info) => info.moving)).toEqual([]);
  });

  describe('moving an item', () => {
    /* On the tent, clear of its label (470–530 × 339–361). Dragged 100 px
       east and 30 px south: 342.86 × 102.86 cm. */
    const ON_TENT: [number, number] = [500, 320];
    const THERE: [number, number] = [600, 350];
    const RESTING = 'translate(470px, 339px)';

    it('moves a preview only, then saves one step on the drop, snapped to the grid', async () => {
      const { container, onView, store } = renderScene(fakeStore(), PLAN);
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      const canvas = canvasOf(container);
      expect(screen.getByText('אוהל 1').style.transform).toBe(RESTING);

      press(canvas, ON_TENT);
      slide(canvas, THERE);
      await frames();
      expect(screen.getByText('אוהל 1').style.transform).not.toBe(RESTING);
      expect(store.run).not.toHaveBeenCalled();

      lift(canvas, THERE);
      expect(store.run).toHaveBeenCalledTimes(1);
      expect(store.run).toHaveBeenCalledWith('הזזה', [{ type: 'update', id: 'tent', patch: { xCm: 1500, yCm: 1150 } }]);
    });

    it('moves by whole centimetres, unsnapped, with Alt', async () => {
      const { container, onView, store } = renderScene(fakeStore(), PLAN);
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      drag(canvasOf(container), ON_TENT, THERE, { altKey: true });
      expect(store.run).toHaveBeenCalledTimes(1);
      expect(store.run).toHaveBeenCalledWith('הזזה', [{ type: 'update', id: 'tent', patch: { xCm: 1493, yCm: 1153 } }]);
    });

    /** A drag under way, its preview drawn; `abandon` ends it some way other than a release. */
    async function abandonedDrag(abandon: (canvas: HTMLCanvasElement) => void) {
      const { container, onView, store } = renderScene(fakeStore(), PLAN);
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      const canvas = canvasOf(container);
      press(canvas, ON_TENT);
      slide(canvas, THERE);
      await frames();
      expect(screen.getByText('אוהל 1').style.transform).not.toBe(RESTING);

      abandon(canvas);
      await frames();
      expect(screen.getByText('אוהל 1').style.transform).toBe(RESTING);
      lift(canvas, THERE);
      await frames();
      expect(screen.getByText('אוהל 1').style.transform).toBe(RESTING);
      expect(store.run).not.toHaveBeenCalled();
    }

    it('drops the preview, saving nothing, when a second finger lands', async () => {
      await abandonedDrag((canvas) => {
        fireEvent.pointerDown(canvas, { clientX: 5, clientY: 690, button: 0, pointerId: 2, isPrimary: false });
        fireEvent.pointerUp(canvas, { clientX: 5, clientY: 690, button: 0, pointerId: 2, isPrimary: false });
      });
    });

    it('drops the preview, saving nothing, when the window loses focus', async () => {
      await abandonedDrag(() => { fireEvent.blur(window); });
    });

    /* Review minor: the blur abandoned the drag but kept the canvas holding
       the pointer, so that pointer's events went on landing on the map. */
    it('lets go of the pointer it captured when the window loses focus', async () => {
      const { container, onView } = renderScene(fakeStore(), PLAN);
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      const canvas = canvasOf(container);
      const captured = vi.fn();
      const released = vi.fn();
      Object.assign(canvas, { setPointerCapture: captured, releasePointerCapture: released });
      press(canvas, ON_TENT, { pointerId: 7 });
      slide(canvas, THERE, { pointerId: 7 });
      expect(captured).toHaveBeenCalledWith(7);
      fireEvent.blur(window);
      expect(released).toHaveBeenCalledWith(7);
      // Nothing held, nothing to let go of: a blur with no drag releases nothing.
      released.mockClear();
      fireEvent.blur(window);
      expect(released).not.toHaveBeenCalled();
    });

    it('drops the preview, saving nothing, when the pointer is captured away', async () => {
      await abandonedDrag((canvas) => { fireEvent.lostPointerCapture(canvas, { pointerId: 1, isPrimary: true }); });
    });

    it('saves the drop even where letting go of the capture reports it lost at once', async () => {
      const { container, onView, store } = renderScene(fakeStore(), PLAN);
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      const canvas = canvasOf(container);
      // A browser that fires lostpointercapture inside releasePointerCapture, before it returns.
      const released = vi.fn((pointerId: number) => {
        fireEvent.lostPointerCapture(canvas, { pointerId, isPrimary: true });
      });
      Object.assign(canvas, { setPointerCapture: vi.fn(), releasePointerCapture: released });

      drag(canvas, ON_TENT, THERE);
      expect(released).toHaveBeenCalledWith(1);
      expect(store.run).toHaveBeenCalledTimes(1);
      expect(store.run).toHaveBeenCalledWith('הזזה', [{ type: 'update', id: 'tent', patch: { xCm: 1500, yCm: 1150 } }]);
    });

    /* The gesture belongs to the pointer that started it (its pointerId), not
       to whichever pointer type is primary: a mouse, a pen and a touch are
       each primary for their own type at once. */
    const PEN = { button: 0, pointerId: 3, isPrimary: true, pointerType: 'pen' };
    const TOUCH = { button: 0, pointerId: 7, isPrimary: true, pointerType: 'touch' };
    /** The tent's label while its preview is at THERE. */
    const MOVED = 'translate(572px, 368px)';

    it('is not steered by a pen passing over the map while the mouse drags', async () => {
      const { container, onView, store } = renderScene(fakeStore(), PLAN);
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      const canvas = canvasOf(container);
      press(canvas, ON_TENT, { pointerType: 'mouse' });
      slide(canvas, THERE, { pointerType: 'mouse' });
      await frames();
      expect(screen.getByText('אוהל 1').style.transform).toBe(MOVED);

      fireEvent.pointerMove(canvas, { clientX: 200, clientY: 600, ...PEN });
      await frames();
      expect(screen.getByText('אוהל 1').style.transform).toBe(MOVED);

      lift(canvas, THERE, { pointerType: 'mouse' });
      expect(store.run).toHaveBeenCalledTimes(1);
      expect(store.run).toHaveBeenCalledWith('הזזה', [{ type: 'update', id: 'tent', patch: { xCm: 1500, yCm: 1150 } }]);
    });

    it('keeps the mouse’s drag when another pointer is cancelled or loses its capture', async () => {
      const { container, onView, store } = renderScene(fakeStore(), PLAN);
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      const canvas = canvasOf(container);
      press(canvas, ON_TENT, { pointerType: 'mouse' });
      slide(canvas, THERE, { pointerType: 'mouse' });
      fireEvent.pointerCancel(canvas, PEN);
      fireEvent.lostPointerCapture(canvas, TOUCH);
      await frames();
      expect(screen.getByText('אוהל 1').style.transform).toBe(MOVED);
      lift(canvas, THERE, { pointerType: 'mouse' });
      expect(store.run).toHaveBeenCalledTimes(1);
    });

    it('ends a mouse drag unsaved when a touch lands, and lets neither pointer start anything after', async () => {
      const { container, onView, store } = renderScene(fakeStore(), PLAN);
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      const canvas = canvasOf(container);
      press(canvas, ON_TENT, { pointerType: 'mouse' });
      slide(canvas, THERE, { pointerType: 'mouse' });
      await frames();
      expect(screen.getByText('אוהל 1').style.transform).toBe(MOVED);

      // A touch on bare ground: were it to start a gesture, it would be a pan that a click clears the selection with.
      fireEvent.pointerDown(canvas, { clientX: 5, clientY: 690, ...TOUCH });
      slide(canvas, [650, 350], { pointerType: 'mouse' }); // the mouse goes on moving…
      lift(canvas, [650, 350], { pointerType: 'mouse' }); // …and lets go
      fireEvent.pointerUp(canvas, { clientX: 5, clientY: 690, ...TOUCH });
      await frames();

      // No preview left, and the view did not pan: the label is back where it rests.
      expect(screen.getByText('אוהל 1').style.transform).toBe(RESTING);
      expect(store.run).not.toHaveBeenCalled();
      expect(store.select).not.toHaveBeenCalledWith([]);
    });
  });

  describe('the handles of the one selected item', () => {
    /* Just inside the tent's north-west corner: within reach of that handle,
       and on the tent itself. Dragged 30 px up and left. */
    const CORNER: [number, number] = [461, 311];
    const OUT: [number, number] = [431, 281];

    it('resize it, snapped to the grid, in one step on the drop', async () => {
      const { container, onView, onNotice, store } = renderScene(fakeStore({ selection: ['tent'] }), QUIET_PLAN);
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      drag(canvasOf(container), CORNER, OUT);
      expect(store.run).toHaveBeenCalledTimes(1);
      expect(store.run).toHaveBeenCalledWith('שינוי גודל', [
        { type: 'update', id: 'tent', patch: { xCm: 1050, yCm: 950, widthCm: 400, depthCm: 400 } },
      ]);
      expect(onNotice).not.toHaveBeenCalled();
    });

    it('are not there for a locked item: the drag says it is locked and changes nothing', async () => {
      const locked = fakeStore({ doc: docOf([item({ id: 'tent', locked: true })]), selection: ['tent'] });
      const { container, onView, onNotice, store } = renderScene(locked, QUIET_PLAN);
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      drag(canvasOf(container), CORNER, OUT);
      expect(onNotice).toHaveBeenCalledWith(LOCKED_NOTICE);
      expect(store.run).not.toHaveBeenCalled();
    });

    it('stop answering the moment the item is locked, before the next frame redraws them', async () => {
      const { container, onView, onNotice, rerenderWith } = renderScene(fakeStore({ selection: ['tent'] }), QUIET_PLAN);
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      const locked = fakeStore({ doc: docOf([item({ id: 'tent', locked: true })]), selection: ['tent'] });
      rerenderWith(locked);
      drag(canvasOf(container), CORNER, OUT);
      expect(onNotice).toHaveBeenCalledWith(LOCKED_NOTICE);
      expect(locked.run).not.toHaveBeenCalled();
    });
  });

  describe('labels', () => {
    const labels = (container: HTMLElement) => [...container.querySelectorAll('[data-key]')].map((node) => node.textContent);

    it('give the one selected item its size', async () => {
      const { onView } = renderScene(fakeStore({ selection: ['tent'] }));
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      expect(screen.getByText('אוהל 1 · 3 × 3 מ׳')).toBeTruthy();
    });

    /* Four toilets in a row, each 29 px wide on screen: their labels cannot
       all sit near their own boxes, so they share one. */
    const ROW = [1000, 1100, 1200, 1300].map((xCm, index) => item({
      id: `w${index + 1}`, kind: 'toilet', label: `תא שירותים ${index + 1}`, xCm, yCm: 1150, widthCm: 100, depthCm: 100,
    }));

    it('merge a crowded row of one kind into one label', async () => {
      const { container, onView } = renderScene(fakeStore({ doc: docOf(ROW) }), PLAN);
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      expect(labels(container)).toEqual(['4 תאי שירותים']);
    });

    it('never merge the selected item or one with a problem into a group', async () => {
      const store = fakeStore({
        doc: docOf(ROW),
        selection: ['w1'],
        flags: { outside: new Set(['w4']), overlapping: new Set(), partly: new Set(), pairs: [], onRopes: new Set(), ropePairs: [] },
      });
      const { container, onView } = renderScene(store, PLAN);
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      expect(screen.getByText('תא שירותים 1 · 1 × 1 מ׳')).toBeTruthy();
      expect(screen.getByText('תא שירותים 4')).toBeTruthy();
      expect(labels(container)).not.toContain('4 תאי שירותים');
      expect(labels(container)).not.toContain('3 תאי שירותים');
    });

    it('single out the item under the pointer — again after the pointer has left and come back', async () => {
      // On the second toilet, just below the group's label (339–361).
      const OVER_W2: [number, number] = [456, 363];
      const { container, onView } = renderScene(fakeStore({ doc: docOf(ROW) }), PLAN);
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      const canvas = canvasOf(container);

      slide(canvas, OVER_W2);
      await frames();
      expect(labels(container)).toContain('תא שירותים 2');
      expect(canvas.style.cursor).toBe('grab');

      fireEvent.pointerLeave(canvas, PRIMARY);
      await frames();
      expect(labels(container)).toEqual(['4 תאי שירותים']);
      expect(canvas.style.cursor).toBe('default');

      slide(canvas, OVER_W2);
      await frames();
      expect(labels(container)).toContain('תא שירותים 2');
    });

    /* A 5 cm peg is under 1.5 px on screen. */
    const PEG = item({ id: 'peg', kind: 'other', label: 'יתד', xCm: 2000, yCm: 2000, widthCm: 5, depthCm: 5 });

    it('leave out an item too small to see', async () => {
      const { onView } = renderScene(fakeStore({ doc: docOf([item({ id: 'tent' }), PEG]) }), PLAN);
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      expect(screen.getByText('אוהל 1')).toBeTruthy();
      expect(screen.queryByText(/יתד/)).toBeNull();
    });

    it('still label a tiny item once it is selected', async () => {
      const { onView } = renderScene(fakeStore({ doc: docOf([item({ id: 'tent' }), PEG]), selection: ['peg'] }), PLAN);
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      expect(screen.getByText('יתד · 0.05 × 0.05 מ׳')).toBeTruthy();
    });

    it('hang a net’s label from the middle of its north edge, not over what is under it', async () => {
      // Its north edge is 400 cm north of the plot's middle: 350 − 116.67 = 233.33 px down.
      const net = item({ id: 'net', kind: 'shade', label: 'רשת צל 1', xCm: 900, yCm: 800, widthCm: 800, depthCm: 800, insetCm: 50 });
      const { onView } = renderScene(fakeStore({ doc: docOf([net]) }), PLAN);
      await waitFor(() => { expect(onView).toHaveBeenCalled(); });
      const transform = screen.getByText('רשת צל 1').style.transform;
      const [, x, y] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(transform) ?? [];
      // Centred under the edge's middle, just inside the net (4 px), not at its middle (339).
      expect(Number(y)).toBe(237);
      expect(Number(x) + 37).toBeCloseTo(500, -1);
    });
  });
});

/* "ייצוא תמונה" (spec §10). A blob, not a data URL: Chromium refuses to
   download a data URL much over 2 MB, and a full-screen PNG is several. */
describe('the picture of the view', () => {
  const realToBlob = HTMLCanvasElement.prototype.toBlob;

  afterEach(() => {
    HTMLCanvasElement.prototype.toBlob = realToBlob;
  });

  it('draws a fresh frame and hands back a PNG of it', async () => {
    const png = new Blob(['png'], { type: 'image/png' });
    const asked: Array<string | undefined> = [];
    HTMLCanvasElement.prototype.toBlob = function toBlob(callback: BlobCallback, type?: string) {
      asked.push(type);
      callback(png);
    };
    const { handle, onView } = renderScene();
    await waitFor(() => { expect(onView).toHaveBeenCalled(); });
    const before = renderer.frames;
    await expect(handle.current?.exportPng()).resolves.toBe(png);
    expect(renderer.frames).toBe(before + 1);
    expect(asked).toEqual(['image/png']);
  });

  it('hands back nothing when the browser cannot make the file', async () => {
    const { handle, onView } = renderScene();
    await waitFor(() => { expect(onView).toHaveBeenCalled(); });
    HTMLCanvasElement.prototype.toBlob = function toBlob(callback: BlobCallback) { callback(null); };
    await expect(handle.current?.exportPng()).resolves.toBeNull();
    HTMLCanvasElement.prototype.toBlob = function toBlob() { throw new Error('SecurityError'); };
    await expect(handle.current?.exportPng()).resolves.toBeNull();
  });

  it('hands back nothing when there is no map to picture', async () => {
    renderer.fails = true;
    const { handle } = renderScene();
    await expect(handle.current?.exportPng()).resolves.toBeNull();
  });
});

describe('a shade net’s ropes in the scene', () => {
  const PLAN_VIEW: EditorUi = { ...UI, mode: 'plan' };
  /* A 4 × 4 m net 1 m high, 21–25 m east and 11–15 m south, with the camp's
     ropes at 45°: its stakes stand 1 m out, so its footprint runs 20–26 m
     east (flush with the east fence) and 10–16 m south. The plan view frames
     the plot, so the tent stays where "moving an item" found it. */
  const NET = item({
    id: 'net', kind: 'shade', label: 'רשת צל 1', xCm: 2100, yCm: 1100, widthCm: 400, depthCm: 400, heightCm: 100, insetCm: 50,
  });
  const ROPED: EditorDoc = {
    ...docOf([item({ id: 'tent' }), NET]),
    defaults: { shade: { widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 } },
  };

  it('warns a new tent dragged over the band between the cloth and the stakes', async () => {
    const { onView, handle } = renderScene(fakeStore({ doc: ROPED }), PLAN_VIEW);
    await waitFor(() => { expect(onView).toHaveBeenCalled(); });
    // 17.5–20.5 m east: clear of the cloth (from 21 m), inside the band (from 20 m).
    handle.current?.setGhost({ kind: 'tent', xCm: 1750, yCm: 1150 });
    await frames();
    expect(screen.getByText('בשטח החבלים של רשת צל')).toBeTruthy();
    handle.current?.setGhost({ kind: 'tent', xCm: 1500, yCm: 1150 });
    await frames();
    expect(screen.queryByText('בשטח החבלים של רשת צל')).toBeNull();
  });

  it('measures the gap to the net’s stakes while a tent is dragged beside it', async () => {
    const { container, onView } = renderScene(fakeStore({ doc: ROPED }), PLAN_VIEW);
    await waitFor(() => { expect(onView).toHaveBeenCalled(); });
    const canvas = canvasOf(container);
    // The drag of "moving an item": the tent to 15–18 m east, 2 m short of the stake line at 20 m.
    // Without the ropes, nothing stands east of it nearer than the fence, 8 m away, and no gap is shown.
    press(canvas, [500, 320]);
    slide(canvas, [600, 350]);
    await frames();
    expect(screen.getByText('2 מ׳')).toBeTruthy();
    lift(canvas, [600, 350]);
  });
});
