/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import type { Mesh, MeshBasicMaterial, Object3D } from 'three';
import type { EditorDoc, EditorItem, EditorUnderlay } from '@/lib/site/editor/model';
import type { SiteOp } from '@/lib/site/editor/ops';
import type { EditorStore } from '../use-editor-store';
import type { UnderlayEvent } from './underlay-mesh';

const { drawn } = vi.hoisted(() => ({ drawn: { scene: null as Object3D | null } }));
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class WebGLRenderer {
    shadowMap = { enabled: false };
    setPixelRatio() {}
    setSize() {}
    render(scene: Object3D) { drawn.scene = scene; }
    dispose() {}
    forceContextLoss() {}
  }
  return { ...actual, WebGLRenderer };
});

/* The label layout is the real one, counted, as in `scene-view.test.tsx`: a
   test can tell whether a change made the engine lay the labels out again. */
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

import { SceneSync } from './scene-sync';
import { SceneView, type EditorUi } from './scene-view';

const PLAN = '0b7c6a52-8f7e-4c1e-9a55-3d2f1e0c9b8a';
const SHA = 'a'.repeat(64);
const IMAGE: EditorUnderlay = {
  storageKey: `site-underlays/${PLAN}/${SHA}.png`, contentType: 'image/png', sizeBytes: 1000, filename: 'שרטוט.png',
  centreXCm: 1300, centreYCm: 1200, widthCm: 2600, rotationTenths: 0, calibration: null,
};
const TENT: EditorItem = {
  id: 'tent', kind: 'tent', label: 'אוהל 1', xCm: 1150, yCm: 1050, widthCm: 300, depthCm: 300,
  heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false, ropeAngleDeg: null,
};
const DOC: EditorDoc = {
  plot: { id: PLAN, widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items: [TENT], lines: [], defaults: {}, underlay: IMAGE,
};
const UI: EditorUi = {
  tool: 'select', mode: 'plan', labels: false, sun: false, netsHidden: false, snap: true,
  hiddenGroups: [], hour: 14, theme: 'light', underlay: { shown: true, opacity: 0.5 },
};

type Store = EditorStore & { run: Mock<EditorStore['run']>; select: Mock<EditorStore['select']> };
function fakeStore(): Store {
  return {
    doc: DOC, selection: [], canUndo: false, canRedo: false,
    flags: { outside: new Set(), overlapping: new Set(), partly: new Set(), pairs: [], onRopes: new Set(), ropePairs: [] },
    save: { status: 'saved', version: 0, pending: 0, error: null, errorKind: null }, conflict: null, notice: null,
    run: vi.fn<EditorStore['run']>(), undo: vi.fn(() => null), redo: vi.fn(() => null), select: vi.fn<EditorStore['select']>(),
    resolveConflict: vi.fn(async () => {}), retrySave: vi.fn(), dismissNotice: vi.fn(), pendingOps: vi.fn(() => []), allowUnload: vi.fn(),
  };
}

/** A PNG header, 400 × 300: all the loader reads of what the route sends. */
const PNG_400x300 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
  0, 0, 0x01, 0x90, 0, 0, 0x01, 0x2c, 8, 6, 0, 0, 0,
]);
const bitmap = { width: 400, height: 300, close: vi.fn() };
const route = vi.fn(async () => new Response(PNG_400x300, { status: 200 }));
const decode = vi.fn(async () => bitmap);

const realRect = Element.prototype.getBoundingClientRect;
const realGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  drawn.scene = null;
  bitmap.close.mockClear();
  route.mockClear();
  decode.mockClear();
  vi.stubGlobal('fetch', route);
  vi.stubGlobal('createImageBitmap', decode);
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof realGetContext;
  Element.prototype.getBoundingClientRect = () => ({
    width: 1000, height: 700, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 700, toJSON: () => ({}),
  });
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect;
  HTMLCanvasElement.prototype.getContext = realGetContext;
  vi.unstubAllGlobals();
});

function renderScene(ui: EditorUi = UI, store: Store = fakeStore()) {
  const onUnderlay = vi.fn<(event: UnderlayEvent) => void>();
  const scene = (nextUi: EditorUi, marks?: ReadonlyArray<[number, number]>) => (
    <SceneView store={store} ui={nextUi} insets={{ left: 0, right: 0, top: 0, bottom: 0 }} sunDate={null}
      onView={() => {}} onNotice={() => {}} underlayMarks={marks} onUnderlay={onUnderlay} />
  );
  const view = render(scene(ui));
  const canvas = view.container.querySelector('canvas') as HTMLCanvasElement;
  return { ...view, store, onUnderlay, canvas, rerenderWith: (nextUi: EditorUi, marks?: ReadonlyArray<[number, number]>) => { view.rerender(scene(nextUi, marks)); } };
}

const PRIMARY = { button: 0, pointerId: 1, isPrimary: true };
function click(canvas: HTMLCanvasElement, [x, y]: [number, number]) {
  fireEvent.pointerDown(canvas, { clientX: x, clientY: y, ...PRIMARY });
  fireEvent.pointerUp(canvas, { clientX: x, clientY: y, ...PRIMARY });
}
function drag(canvas: HTMLCanvasElement, [x0, y0]: [number, number], [x1, y1]: [number, number]) {
  fireEvent.pointerDown(canvas, { clientX: x0, clientY: y0, ...PRIMARY });
  fireEvent.pointerMove(canvas, { clientX: (x0 + x1) / 2, clientY: (y0 + y1) / 2, ...PRIMARY });
  fireEvent.pointerMove(canvas, { clientX: x1, clientY: y1, ...PRIMARY });
  fireEvent.pointerUp(canvas, { clientX: x1, clientY: y1, ...PRIMARY });
}
const frames = () => new Promise((done) => { setTimeout(done, 80); });
const plane = () => drawn.scene?.getObjectByName('underlayPlane') as Mesh | undefined;
async function ready(onUnderlay: ReturnType<typeof vi.fn>) {
  await waitFor(() => {
    expect(onUnderlay).toHaveBeenCalledWith({ type: 'status', status: { state: 'ready', aspect: 0.75 } });
  });
  await frames();
}

describe('the picture under the map, in the engine', () => {
  it('fetches the picture from the admin route, never from storage, and reports it loading, then ready with its aspect', async () => {
    const { onUnderlay } = renderScene();
    await ready(onUnderlay);
    expect(onUnderlay).toHaveBeenCalledWith({ type: 'status', status: { state: 'loading' } });
    expect(route).toHaveBeenCalledWith(`/site/underlay/${PLAN}/${SHA}.png`, { credentials: 'same-origin' });
    expect(decode).toHaveBeenCalledWith(expect.anything(), { imageOrientation: 'from-image', premultiplyAlpha: 'none' });
  });

  it('fades and hides the picture without rebuilding the scene or laying the labels out again (review U1)', async () => {
    const syncs = vi.spyOn(SceneSync.prototype, 'sync');
    try {
      const LABELLED: EditorUi = { ...UI, labels: true };
      const { onUnderlay, rerenderWith } = renderScene(LABELLED);
      await ready(onUnderlay);
      const [laid, synced] = [layouts.count, syncs.mock.calls.length];
      expect(laid).toBeGreaterThan(0);

      rerenderWith({ ...LABELLED, underlay: { shown: true, opacity: 0.3 } });
      await frames();
      expect((plane()!.material as MeshBasicMaterial).opacity).toBeCloseTo(0.3, 9);
      rerenderWith({ ...LABELLED, underlay: { shown: false, opacity: 0.3 } });
      await frames();
      expect(plane()!.visible).toBe(false);
      expect(layouts.count).toBe(laid);
      expect(syncs.mock.calls.length).toBe(synced);

      // A change that is not the picture's view still does both, so the counts can move.
      rerenderWith({ ...LABELLED, underlay: { shown: false, opacity: 0.3 }, netsHidden: true });
      await frames();
      expect(layouts.count).toBeGreaterThan(laid);
    } finally {
      syncs.mockRestore();
    }
  });

  it('lies where it was placed, a millimetre up — and is hidden, so left out of the picture export, when this viewer hides it', async () => {
    const { onUnderlay, rerenderWith } = renderScene();
    await ready(onUnderlay);
    expect(plane()!.position.x).toBeCloseTo(13, 6);
    expect(plane()!.position.y).toBeCloseTo(0.001, 9);
    expect(plane()!.position.z).toBeCloseTo(12, 6);
    expect(plane()!.visible).toBe(true);
    rerenderWith({ ...UI, underlay: { shown: false, opacity: 0.3 } });
    await frames();
    expect(plane()!.visible).toBe(false);
    expect((plane()!.material as MeshBasicMaterial).opacity).toBeCloseTo(0.3, 9);
  });

  it('says a calibration click came before the picture could be shown, and marks nothing (review U1)', async () => {
    decode.mockImplementationOnce(() => new Promise(() => {}));
    const { onUnderlay, canvas, store } = renderScene({ ...UI, tool: 'calibrate' });
    await waitFor(() => { expect(onUnderlay).toHaveBeenCalledWith({ type: 'status', status: { state: 'loading' } }); });
    await frames();
    click(canvas, [500, 350]);
    expect(onUnderlay).toHaveBeenLastCalledWith({ type: 'notReady' });
    expect(onUnderlay.mock.calls.some(([event]) => event.type === 'point')).toBe(false);
    expect(store.run).not.toHaveBeenCalled();
  });

  it('marks a calibration point where the picture is clicked, and refuses a click beside it or too near the first', async () => {
    const calibrating: EditorUi = { ...UI, tool: 'calibrate' };
    const { onUnderlay, canvas, store, rerenderWith } = renderScene(calibrating);
    await ready(onUnderlay);

    click(canvas, [500, 350]);
    const marked = onUnderlay.mock.lastCall?.[0] as Extract<UnderlayEvent, { type: 'point' }>;
    expect(marked.type).toBe('point');
    expect(marked.uv[0]).toBeCloseTo(0.5, 2);
    expect(marked.uv[1]).toBeCloseTo(0.5, 2);

    click(canvas, [5, 5]);
    expect(onUnderlay).toHaveBeenLastCalledWith({ type: 'offImage' });

    rerenderWith(calibrating, [[0.5, 0.5]]);
    await frames();
    click(canvas, [505, 350]);
    expect(onUnderlay).toHaveBeenLastCalledWith({ type: 'tooClose' });
    click(canvas, [560, 350]);
    expect((onUnderlay.mock.lastCall?.[0] as UnderlayEvent).type).toBe('point');

    // Marking is not editing, and the tent under the picture is not selected through it.
    expect(store.run).not.toHaveBeenCalled();
    expect(store.select).not.toHaveBeenCalled();
  });

  it('moves the picture by a drag in the alignment tool, as one saved step, and pans when the drag starts beside it', async () => {
    const { onUnderlay, canvas, store } = renderScene({ ...UI, tool: 'align' });
    await ready(onUnderlay);
    drag(canvas, [500, 350], [600, 350]);
    expect(store.run).toHaveBeenCalledTimes(1);
    const [label, ops] = store.run.mock.calls[0] as [string, SiteOp[]];
    expect(label).toBe('הזזת תמונת הרקע');
    const moved = (ops[0] as Extract<SiteOp, { type: 'setUnderlay' }>).underlay!;
    expect(moved.centreXCm).toBeGreaterThan(1300);
    expect(moved.centreYCm).toBe(1200);
    expect({ ...moved, centreXCm: 1300 }).toEqual(IMAGE);

    drag(canvas, [5, 5], [100, 100]);
    expect(store.run).toHaveBeenCalledTimes(1);
    expect(store.select).not.toHaveBeenCalled();
  });

  it('lets clicks through in the selection tool: a click on the picture selects the tent standing on it', async () => {
    const { onUnderlay, canvas, store } = renderScene();
    await ready(onUnderlay);
    click(canvas, [500, 350]);
    expect(store.select).toHaveBeenCalledWith(['tent']);
  });

  it('draws the calibration marks it is given as two dots and a line', async () => {
    const { onUnderlay, rerenderWith, container } = renderScene();
    await ready(onUnderlay);
    rerenderWith(UI, [[0.1, 0.5], [0.9, 0.5]]);
    await frames();
    expect(container.querySelectorAll('svg circle')).toHaveLength(2);
    expect(container.querySelectorAll('svg line')).toHaveLength(1);
  });

  it('builds the plane again when the WebGL context comes back, where it lay', async () => {
    const { onUnderlay, canvas } = renderScene();
    await ready(onUnderlay);
    const before = plane()!;
    fireEvent(canvas, new Event('webglcontextrestored'));
    await frames();
    const after = plane()!;
    expect(after).not.toBe(before);
    expect(after.position.x).toBeCloseTo(13, 6);
  });

  it('lets the decoded picture go when the map closes', async () => {
    const { onUnderlay, unmount } = renderScene();
    await ready(onUnderlay);
    unmount();
    expect(bitmap.close).toHaveBeenCalled();
  });
});
