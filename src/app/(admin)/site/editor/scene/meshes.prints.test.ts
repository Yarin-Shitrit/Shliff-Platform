import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import type { EditorItem } from '@/lib/site/editor/model';
import { printSpots } from '@/lib/site/editor/prints';
import { buildItemObject, disposeObject, restyleItemObject, type ItemLook } from './meshes';
import { SCENE_PALETTE } from './palette';
import type { PrintRasteriser } from './print-texture';
import { applyPrints } from './prints';

const TENT: EditorItem = {
  id: 'a', kind: 'tent', label: 'אוהל 1', xCm: 100, yCm: 200, widthCm: 300, depthCm: 300,
  heightCm: null, insetCm: null, ropeAngleDeg: null, sort: 0, taskId: null, notes: null, facing: 0, locked: false,
};
const LIGHT: ItemLook = { theme: 'light', state: 'normal', issue: 'none' };

function printedTent() {
  const texture = new THREE.DataTexture(new Uint8Array(16), 4, 1);
  const rasteriser: PrintRasteriser = { print: () => ({ texture, aspect: 4 }), reset() {}, dispose() {}, size: 1 };
  const object = buildItemObject(TENT, 200, LIGHT);
  applyPrints(object, TENT.label, printSpots('tent', 300, 300, 200, 0, null), rasteriser, LIGHT);
  let print: THREE.Mesh | null = null;
  object.traverse((child) => { if (child.userData.part === 'print') print = child as THREE.Mesh; });
  if (print === null) throw new Error('no print');
  return { object, texture, print: print as THREE.Mesh, material: (print as THREE.Mesh).material as THREE.MeshLambertMaterial };
}

describe('a print under the item’s restyle', () => {
  it('recolours the ink on a restyle and keeps the texture', () => {
    const { object, texture, material } = printedTent();
    expect(material.color.getHexString()).toBe(SCENE_PALETTE.light.ink.slice(1).toLowerCase());

    restyleItemObject(object, { theme: 'dark', state: 'selected', issue: 'overlapping', sun: true });

    expect(material.color.getHexString()).toBe(SCENE_PALETTE.dark.ink.slice(1).toLowerCase());
    expect(material.map).toBe(texture);
  });

  it('keeps the ink constant under hover, selection and problems — the body carries those', () => {
    const { object, material } = printedTent();
    const ink = material.color.getHex();
    for (const look of [
      { theme: 'light', state: 'hover', issue: 'none' },
      { theme: 'light', state: 'selected', issue: 'outside' },
      { theme: 'light', state: 'normal', issue: 'overlapping' },
    ] as const) {
      restyleItemObject(object, look);
      expect(material.color.getHex()).toBe(ink);
    }
  });

  it('is freed with the item, and the shared texture is not', () => {
    const { object, texture, material } = printedTent();
    const materialFreed = vi.spyOn(material, 'dispose');
    const textureFreed = vi.spyOn(texture, 'dispose');
    disposeObject(object);
    expect(materialFreed).toHaveBeenCalledTimes(1);
    expect(textureFreed).not.toHaveBeenCalled();
  });
});
