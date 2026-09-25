import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import { isShown, SceneSync, type SyncInput } from './scene-sync';

function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 100, yCm: 200, widthCm: 300, depthCm: 300,
    heightCm: null, insetCm: null, ropeAngleDeg: null, sort: 0, taskId: null, notes: null, locked: false, ...over,
  };
}

function doc(items: EditorItem[]): EditorDoc {
  return { plot: { id: 'p1', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, items, lines: [], defaults: {} };
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

describe('isShown (the visibility rule)', () => {
  it('hides an item whose group is hidden, leaves the rest', () => {
    expect(isShown(TENT, new Set(['sleep']), false)).toBe(false);
    expect(isShown(TENT, new Set(['living']), false)).toBe(true);
  });

  it('hides a net when nets are hidden, leaves a solid alone', () => {
    expect(isShown(NET, new Set(), true)).toBe(false);
    expect(isShown(TENT, new Set(), true)).toBe(true);
  });
});

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
    withDefault.doc.defaults = { tent: { widthCm: 300, depthCm: 300, heightCm: 260, insetCm: null, ropeAngleDeg: null } };
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

  it('rebuilds a net when the camp sets its rope angle, and draws its ropes then', () => {
    const count = (object: THREE.Object3D | undefined, part: string) => {
      let found = 0;
      object?.traverse((child) => { if (child.userData.part === part) found += 1; });
      return found;
    };
    const sync = new SceneSync();
    sync.sync(input([NET]));
    const before = sync.objectOf('net');
    expect(count(before, 'stake')).toBe(0);
    const roped = input([NET]);
    roped.doc.defaults = { shade: { widthCm: 800, depthCm: 800, heightCm: 300, insetCm: 50, ropeAngleDeg: 45 } };
    sync.sync(roped);
    const after = sync.objectOf('net');
    expect(after).not.toBe(before);
    expect(count(after, 'rope')).toBe(1);
    expect(count(after, 'stake')).toBe(8);
  });
});
