/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DirectionalLight } from 'three';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import type { EditorStore } from '../use-editor-store';

/* jsdom has no WebGL. Each test decides what the renderer does: throw, as a
   browser without WebGL does, or stand in for a GPU and count its frames.
   The directional light is the real one, remembered, so a test can read
   where the engine aimed it. */
const { renderer, lights } = vi.hoisted(() => ({
  renderer: { fails: false, created: 0, frames: 0 },
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
    setSize() {}
    render() { renderer.frames += 1; }
    dispose() {}
    forceContextLoss() {}
  }
  class RememberedLight extends actual.DirectionalLight {
    constructor(...args: ConstructorParameters<typeof actual.DirectionalLight>) {
      super(...args);
      lights.push(this);
    }
  }
  return { ...actual, WebGLRenderer, DirectionalLight: RememberedLight };
});

import { LOCKED_NOTICE } from './engine';
import { NO_WEBGL, SceneView, type EditorUi } from './scene-view';

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
  const onView = vi.fn();
  const onNotice = vi.fn();
  const scene = (next: EditorStore, nextUi: EditorUi) => (
    <SceneView store={next} ui={nextUi} insets={{ ...NO_INSETS }}
      sunDate={null} onView={onView} onNotice={onNotice} />
  );
  const view = render(scene(store, ui));
  const rerenderWith = (next: EditorStore, nextUi: EditorUi = ui) => { view.rerender(scene(next, nextUi)); };
  return { ...view, onView, onNotice, store, rerenderWith };
}

function canvasOf(container: HTMLElement): HTMLCanvasElement {
  return container.querySelector('canvas') as HTMLCanvasElement;
}

function drag(canvas: HTMLCanvasElement, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(canvas, { clientX: from[0], clientY: from[1], button: 0, pointerId: 1 });
  fireEvent.pointerMove(canvas, { clientX: to[0], clientY: to[1], button: 0, pointerId: 1 });
  fireEvent.pointerUp(canvas, { clientX: to[0], clientY: to[1], button: 0, pointerId: 1 });
}

/** Long enough for any frame the engine asked for to have run. */
function frames() {
  return new Promise((resolve) => { setTimeout(resolve, 80); });
}

const realRect = Element.prototype.getBoundingClientRect;
const realGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  Object.assign(renderer, { fails: false, created: 0, frames: 0 });
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
    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 690, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 5, clientY: 690, button: 0, pointerId: 1 });
    expect(store.select).toHaveBeenCalledWith([]);
  });

  it('selects the item under a click', async () => {
    // No labels: the click must reach the tent itself, not its label.
    const { container, onView, store } = renderScene(fakeStore(), QUIET_PLAN);
    await waitFor(() => { expect(onView).toHaveBeenCalled(); });
    const canvas = canvasOf(container);
    fireEvent.pointerDown(canvas, { clientX: 500, clientY: 350, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 500, clientY: 350, button: 0, pointerId: 1 });
    expect(store.select).toHaveBeenCalledWith(['tent']);
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
