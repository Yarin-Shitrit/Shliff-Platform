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
