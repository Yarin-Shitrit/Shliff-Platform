import { describe, it, expect } from 'vitest';
import type * as THREE from 'three';
import { project, type CameraState, type Vec3, type ViewMode } from '@/lib/site/editor/camera';
import type { EditorDoc, EditorItem, EditorLine } from '@/lib/site/editor/model';
import { CameraRig } from './camera-rig';
import { pickItemId } from './picking';
import { SceneSync, type SyncInput } from './scene-sync';

/**
 * The pipes and cables in the scene (`site_lines`): drawn between where
 * their ends are drawn, taken out with a hidden end, rebuilt when an end
 * moves, recoloured — not rebuilt — for hover and selection, and picked
 * under the pointer like an item.
 */

const VIEWPORT = { width: 1000, height: 700 };

function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: over.id, xCm: 0, yCm: 0, widthCm: 100, depthCm: 100,
    heightCm: null, insetCm: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

/* A tank at the origin, a shower five metres east, a tent alone to the south; one straight pipe. */
const TANK = item({ id: 'tank', kind: 'water' });
const SHOWER = item({ id: 'shower', kind: 'shower', xCm: 500 });
const TENT = item({ id: 'tent', xCm: 1000, yCm: 1500, widthCm: 300, depthCm: 300 });
const PIPE: EditorLine = { id: 'pipe', kind: 'water', label: 'צינור מים 1', fromId: 'tank', toId: 'shower', points: [], sort: 0, notes: null };

function doc(over: Partial<EditorDoc> = {}): EditorDoc {
  return { plot: { id: 'p', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items: [TANK, SHOWER, TENT], lines: [PIPE], defaults: {}, ...over };
}

function input(over: Partial<SyncInput> = {}): SyncInput {
  return {
    doc: doc(), preview: new Map(), selection: new Set(), hover: null,
    flags: { outside: new Set(), overlapping: new Set() },
    hiddenGroups: new Set(), netsHidden: false, theme: 'light', ...over,
  };
}

function colourOf(object: THREE.Object3D): number {
  let hex = -1;
  object.traverse((child) => {
    if (hex === -1 && child.userData.part === 'lineBody') hex = ((child as THREE.Mesh).material as THREE.MeshLambertMaterial).color.getHex();
  });
  return hex;
}

describe('the lines in the scene', () => {
  it('draws one object per line whose ends are both shown: joints at both walls and one leg between', () => {
    const sync = new SceneSync();
    sync.sync(input());
    const pipe = sync.lineObjectOf('pipe');
    expect(pipe).toBeDefined();
    expect(sync.lineObjects()).toHaveLength(1);
    // Two joints (the walls) and one leg for a straight run.
    expect(pipe?.children.filter((child) => child.userData.part === 'lineJoint')).toHaveLength(2);
    expect(pipe?.children.filter((child) => child.userData.part === 'lineBody')).toHaveLength(1);
    // The leg runs from the tank's east wall (100, 50) to the shower's west wall (500, 50): four metres long, centred at x = 3.
    const leg = pipe?.children.find((child) => child.userData.part === 'lineBody') as THREE.Mesh;
    expect(leg.position.x).toBeCloseTo(3);
    expect(leg.position.z).toBeCloseTo(0.5);
    expect((leg.geometry as THREE.BoxGeometry).parameters.width).toBeCloseTo(4);
    // Lines are never items: picking lists them apart.
    expect(sync.solidObjects().map((object) => object.name).sort()).toEqual(['shower', 'tank', 'tent']);
  });

  it('follows a dragged end without the store changing, and rebuilds only then', () => {
    const sync = new SceneSync();
    sync.sync(input());
    const before = sync.lineObjectOf('pipe');
    sync.sync(input({ preview: new Map([['shower', { xCm: 900, yCm: 0, widthCm: 100, depthCm: 100 }]]) }));
    const after = sync.lineObjectOf('pipe');
    expect(after).not.toBe(before);
    const leg = after?.children.find((child) => child.userData.part === 'lineBody') as THREE.Mesh;
    expect((leg.geometry as THREE.BoxGeometry).parameters.width).toBeCloseTo(8);
    // A sync that moves nothing keeps the object.
    sync.sync(input({ preview: new Map([['shower', { xCm: 900, yCm: 0, widthCm: 100, depthCm: 100 }]]) }));
    expect(sync.lineObjectOf('pipe')).toBe(after);
  });

  it('bends through its points', () => {
    const sync = new SceneSync();
    sync.sync(input({ doc: doc({ lines: [{ ...PIPE, points: [[50, 300], [550, 300]] }] }) }));
    const pipe = sync.lineObjectOf('pipe');
    expect(pipe?.children.filter((child) => child.userData.part === 'lineJoint')).toHaveLength(4);
    expect(pipe?.children.filter((child) => child.userData.part === 'lineBody')).toHaveLength(3);
  });

  it('goes when an end is hidden, or gone, and comes back with it', () => {
    const sync = new SceneSync();
    sync.sync(input({ hiddenGroups: new Set(['sanitation']) }));
    expect(sync.lineObjects()).toEqual([]);
    sync.sync(input());
    expect(sync.lineObjects()).toHaveLength(1);
    sync.sync(input({ doc: doc({ items: [TANK, TENT] }) }));
    expect(sync.lineObjects()).toEqual([]);
  });

  it('recolours for hover and selection without rebuilding', () => {
    const sync = new SceneSync();
    sync.sync(input());
    const object = sync.lineObjectOf('pipe') as THREE.Group;
    const normal = colourOf(object);
    sync.sync(input({ hover: 'pipe' }));
    const hovered = colourOf(object);
    sync.sync(input({ selection: new Set(['pipe']) }));
    const selected = colourOf(object);
    expect(new Set([normal, hovered, selected]).size).toBe(3);
    expect(sync.lineObjectOf('pipe')).toBe(object);
  });

  it('frees its lines on dispose', () => {
    const sync = new SceneSync();
    sync.sync(input());
    sync.dispose();
    expect(sync.lineObjects()).toEqual([]);
    expect(sync.root.children).toHaveLength(0);
  });
});

const VIEWS: Array<{ mode: ViewMode; state: CameraState }> = [
  { mode: 'plan', state: { targetX: 1300, targetY: 1200, distance: 3000, yaw: 0, pitch: 90 } },
  { mode: '3d', state: { targetX: 1300, targetY: 1200, distance: 3000, yaw: -26, pitch: 50 } },
];

function pickAt(sync: SceneSync, mode: ViewMode, state: CameraState, point: Vec3): string | null {
  const camera = new CameraRig().apply(state, VIEWPORT, mode);
  const at = project(state, VIEWPORT, mode, point);
  if (at === null) throw new Error('point is behind the camera');
  return pickItemId(camera, sync, at.x, at.y, VIEWPORT);
}

describe('picking a line', () => {
  it('finds the pipe under the middle of its run, in plan and in 3D', () => {
    const sync = new SceneSync();
    sync.sync(input());
    for (const { mode, state } of VIEWS) {
      expect(pickAt(sync, mode, state, [300, 50, 3]), `${mode}`).toBe('pipe');
    }
  });

  it('still prefers the item standing on it', () => {
    const sync = new SceneSync();
    sync.sync(input());
    for (const { mode, state } of VIEWS) {
      expect(pickAt(sync, mode, state, [50, 50, 60]), `${mode}`).toBe('tank');
    }
  });
});
