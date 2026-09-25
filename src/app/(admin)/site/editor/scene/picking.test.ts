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
  const doc: EditorDoc = { plot: { id: 'p', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items: ITEMS, lines: [], defaults: {} };
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

  it('picks a tall item at the closest zoom in plan, where a camera stood at the plain eye height would clip it', () => {
    const sync = scene();
    // distance 250 is DISTANCE_MIN: at the plain eye height (250 cm above the
    // target) a 270 cm caravan reaches past the camera itself.
    const state: CameraState = { targetX: 1950, targetY: 1725, distance: 250, yaw: 0, pitch: 90 };
    expect(pickAt(sync, 'plan', state, [1950, 1725, 135])).toBe('caravan');
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
