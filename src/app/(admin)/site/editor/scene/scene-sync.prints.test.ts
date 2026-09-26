import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { EditorDoc, EditorItem } from '@/lib/site/editor/model';
import { SCENE_PALETTE } from './palette';
import type { PrintRasteriser } from './print-texture';
import { SceneSync, type SyncInput } from './scene-sync';

function item(over: Partial<EditorItem> & { id: string }): EditorItem {
  return {
    kind: 'tent', label: 'אוהל 1', xCm: 100, yCm: 200, widthCm: 300, depthCm: 300,
    heightCm: null, insetCm: null, ropeAngleDeg: null, sort: 0, taskId: null, notes: null, facing: 0, locked: false, ...over,
  };
}

function doc(items: EditorItem[]): EditorDoc {
  return { plot: { id: 'p1', widthCm: 6000, depthCm: 6000, gridCm: 50, northDeg: 0 }, items, lines: [], defaults: {} };
}

/** Draws nothing: one 4 × 1 texture per distinct text, held like the real cache, and a count of every ask. */
function fakeRasteriser(): PrintRasteriser & { asked: number } {
  const held = new Map<string, { texture: THREE.Texture; aspect: number }>();
  const rasteriser = {
    asked: 0,
    print(text: string) {
      rasteriser.asked += 1;
      let print = held.get(text);
      if (print === undefined) {
        print = { texture: new THREE.DataTexture(new Uint8Array(16), 4, 1), aspect: 4 };
        held.set(text, print);
      }
      return print;
    },
    reset() { held.clear(); },
    dispose() { held.clear(); },
    get size() { return held.size; },
  };
  return rasteriser;
}

function input(items: EditorItem[], over: Partial<SyncInput> = {}): SyncInput {
  return {
    doc: doc(items), preview: new Map(), selection: new Set(), hover: null,
    flags: { outside: new Set(), overlapping: new Set() },
    hiddenGroups: new Set(), netsHidden: false, theme: 'light', ...over,
  };
}

function prints(object: THREE.Object3D | undefined): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  object?.traverse((child) => { if (child.userData.part === 'print') found.push(child as THREE.Mesh); });
  return found;
}

const TENT = item({ id: 'tent' });
const CARAVAN = item({ id: 'caravan', kind: 'caravan', label: 'קראוון של דנה', xCm: 1000, yCm: 1000, widthCm: 700, depthCm: 250 });
const SOFA = item({ id: 'sofa', kind: 'sofa', label: 'ספה 1', xCm: 2000, yCm: 2000, widthCm: 200, depthCm: 90 });

describe('printed names, kept in step with the store', () => {
  it('prints every shown item in the printed mode, and none in floating or none', () => {
    const rasteriser = fakeRasteriser();
    const sync = new SceneSync();
    sync.sync(input([TENT, CARAVAN, SOFA], { labelMode: 'printed', prints: rasteriser }));
    expect(prints(sync.objectOf('tent'))).toHaveLength(1);
    expect(prints(sync.objectOf('caravan'))).toHaveLength(2);
    expect(prints(sync.objectOf('sofa'))).toHaveLength(1);

    for (const labelMode of ['floating', 'none'] as const) {
      sync.sync(input([TENT, CARAVAN, SOFA], { labelMode, prints: rasteriser }));
      expect(prints(sync.root)).toHaveLength(0);
    }
  });

  it('draws nothing without a rasteriser, whatever the mode, and nothing when the mode is absent', () => {
    const sync = new SceneSync();
    sync.sync(input([TENT], { labelMode: 'printed', prints: null }));
    expect(prints(sync.root)).toHaveLength(0);
    sync.sync(input([TENT], { labelMode: 'printed' }));
    expect(prints(sync.root)).toHaveLength(0);
    sync.sync(input([TENT], { prints: fakeRasteriser() }));
    expect(prints(sync.root)).toHaveLength(0);
  });

  it('builds prints only when asked, and drops them — not the textures — when not', () => {
    const rasteriser = fakeRasteriser();
    const boxes = Array.from({ length: 200 }, (_, i) => item({
      id: `box${i}`, kind: 'other', label: `פריט ${i}`, xCm: (i % 20) * 150, yCm: Math.floor(i / 20) * 150, widthCm: 100, depthCm: 100,
    }));
    const sync = new SceneSync();
    sync.sync(input(boxes, { labelMode: 'floating', prints: rasteriser }));
    expect(rasteriser.asked).toBe(0);

    const started = performance.now();
    sync.sync(input(boxes, { labelMode: 'printed', prints: rasteriser }));
    const took = performance.now() - started;
    expect(rasteriser.asked).toBe(200);
    expect(prints(sync.root)).toHaveLength(200);
    // Measured, not assumed (Review Focus #6): 200 prints in one sync, in node. The bound is loose for a loaded box.
    expect(took).toBeLessThan(200);

    sync.sync(input(boxes, { labelMode: 'floating', prints: rasteriser }));
    expect(prints(sync.root)).toHaveLength(0);
    expect(rasteriser.size).toBe(200);
  });

  it('leaves an unchanged item’s prints alone from one sync to the next', () => {
    const rasteriser = fakeRasteriser();
    const sync = new SceneSync();
    sync.sync(input([TENT], { labelMode: 'printed', prints: rasteriser }));
    const [before] = prints(sync.objectOf('tent'));
    sync.sync(input([TENT], { labelMode: 'printed', prints: rasteriser }));
    sync.sync(input([TENT], { labelMode: 'printed', prints: rasteriser, hover: 'tent' }));
    expect(prints(sync.objectOf('tent'))).toEqual([before]);
    expect(rasteriser.asked).toBe(1);
  });

  it('re-prints a renamed item on the same object, without rebuilding it', () => {
    const rasteriser = fakeRasteriser();
    const sync = new SceneSync();
    sync.sync(input([TENT], { labelMode: 'printed', prints: rasteriser }));
    const object = sync.objectOf('tent');
    const [before] = prints(object);
    const mapBefore = (before.material as THREE.MeshLambertMaterial).map;

    sync.sync(input([{ ...TENT, label: 'אוהל של רון' }], { labelMode: 'printed', prints: rasteriser }));

    expect(sync.objectOf('tent')).toBe(object);
    const [after] = prints(object);
    expect(after).not.toBe(before);
    expect((after.material as THREE.MeshLambertMaterial).map).not.toBe(mapBefore);
  });

  it('re-rasterises every print once when the font epoch changes', () => {
    const rasteriser = fakeRasteriser();
    const sync = new SceneSync();
    const items = [TENT, CARAVAN, SOFA];
    sync.sync(input(items, { labelMode: 'printed', prints: rasteriser, fontEpoch: 0 }));
    expect(rasteriser.asked).toBe(3);
    rasteriser.reset();

    sync.sync(input(items, { labelMode: 'printed', prints: rasteriser, fontEpoch: 1 }));
    expect(rasteriser.asked).toBe(6);
    sync.sync(input(items, { labelMode: 'printed', prints: rasteriser, fontEpoch: 1 }));
    expect(rasteriser.asked).toBe(6);
  });

  it('re-applies the print after a resize rebuilds the item', () => {
    const rasteriser = fakeRasteriser();
    const sync = new SceneSync();
    sync.sync(input([TENT], { labelMode: 'printed', prints: rasteriser }));
    const before = sync.objectOf('tent');
    sync.sync(input([{ ...TENT, widthCm: 450 }], { labelMode: 'printed', prints: rasteriser }));
    const after = sync.objectOf('tent');
    expect(after).not.toBe(before);
    expect(prints(after)).toHaveLength(1);
    // The same name: the cache answered, not a new drawing.
    expect(rasteriser.size).toBe(1);
  });

  it('takes a hidden group’s prints away with its items, and prints them again when they come back', () => {
    const rasteriser = fakeRasteriser();
    const sync = new SceneSync();
    sync.sync(input([TENT, SOFA], { labelMode: 'printed', prints: rasteriser }));
    sync.sync(input([TENT, SOFA], { labelMode: 'printed', prints: rasteriser, hiddenGroups: new Set(['sleep']) }));
    expect(sync.objectOf('tent')).toBeUndefined();
    expect(prints(sync.root)).toHaveLength(1);
    sync.sync(input([TENT, SOFA], { labelMode: 'printed', prints: rasteriser }));
    expect(prints(sync.objectOf('tent'))).toHaveLength(1);
  });

  it('recolours the ink with the theme, on the same print', () => {
    const rasteriser = fakeRasteriser();
    const sync = new SceneSync();
    sync.sync(input([TENT], { labelMode: 'printed', prints: rasteriser }));
    const [print] = prints(sync.objectOf('tent'));
    sync.sync(input([TENT], { labelMode: 'printed', prints: rasteriser, theme: 'dark' }));
    expect(prints(sync.objectOf('tent'))).toEqual([print]);
    expect((print.material as THREE.MeshLambertMaterial).color.getHexString()).toBe(SCENE_PALETTE.dark.ink.slice(1).toLowerCase());
  });
});
