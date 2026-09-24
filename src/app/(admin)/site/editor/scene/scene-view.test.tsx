/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DirectionalLight } from 'three';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
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
    setPixelRatio() {}
    setSize() {
      if (renderer.failsAfter) throw new Error('Something broke after the context was made.');
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

import { LOCKED_NOTICE } from '../notices';
import { NO_WEBGL, SCENE_FAILED, SceneView, type EditorUi } from './scene-view';

const UI: EditorUi = {
  tool: 'select', mode: '3d', labels: true, sun: false, netsHidden: false,
  snap: true, hiddenGroups: [], hour: 14, theme: 'light',
};

function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 1150, yCm: 1050, widthCm: 300, depthCm: 300,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

const DOC: EditorDoc = {
  plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 },
  items: [item({ id: 'tent' })],
  defaults: {},
};

function docOf(items: EditorItem[], plot: EditorDoc['plot'] = DOC.plot): EditorDoc {
  return { plot, items, defaults: {} };
}

function fakeStore(over: Partial<EditorStore> = {}): EditorStore {
  return {
    doc: DOC, selection: [], canUndo: false, canRedo: false,
    flags: { outside: new Set(), overlapping: new Set(), partly: new Set(), pairs: [] },
    save: { status: 'saved', version: 0, pending: 0, error: null, errorKind: null }, conflict: null, notice: null,
    run: vi.fn(), undo: vi.fn(() => null), redo: vi.fn(() => null), select: vi.fn(),
    resolveConflict: vi.fn(async () => {}), retrySave: vi.fn(), dismissNotice: vi.fn(),
    ...over,
  };
}

const NO_INSETS = { left: 0, right: 0, top: 0, bottom: 0 };

function renderScene(store = fakeStore(), ui: EditorUi = UI) {
  const onView = vi.fn<(info: ViewInfo) => void>();
  const onNotice = vi.fn();
  const onModeSettled = vi.fn();
  const handle = createRef<SceneHandle>();
  const scene = (next: EditorStore, nextUi: EditorUi) => (
    <SceneView ref={handle} store={next} ui={nextUi} insets={{ ...NO_INSETS }}
      sunDate={null} onView={onView} onNotice={onNotice} onModeSettled={onModeSettled} />
  );
  const view = render(scene(store, ui));
  const rerenderWith = (next: EditorStore, nextUi: EditorUi = ui) => { view.rerender(scene(next, nextUi)); };
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

    it('drops the preview, saving nothing, when the pointer is captured away', async () => {
      await abandonedDrag((canvas) => { fireEvent.lostPointerCapture(canvas, { pointerId: 1, isPrimary: true }); });
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
        flags: { outside: new Set(['w4']), overlapping: new Set(), partly: new Set(), pairs: [] },
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
