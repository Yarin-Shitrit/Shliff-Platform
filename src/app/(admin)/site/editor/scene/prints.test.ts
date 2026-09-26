import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { fitPrint, printSpots } from '@/lib/site/editor/prints';
import { CM, type ItemLook } from './meshes';
import { SCENE_PALETTE } from './palette';
import type { PrintRasteriser } from './print-texture';
import { applyPrints, clearPrints } from './prints';

const LIGHT: ItemLook = { theme: 'light', state: 'normal', issue: 'none' };

/** A rasteriser that draws nothing: one 4 × 1 texture for every text, aspect 4, and a count of the asks. */
function fakeRasteriser(aspect = 4): PrintRasteriser & { texture: THREE.Texture; asked: number } {
  const texture = new THREE.DataTexture(new Uint8Array(16), 4, 1);
  const rasteriser = {
    texture, asked: 0, size: 1,
    print() { rasteriser.asked += 1; return { texture, aspect }; },
    reset() {}, dispose() {},
  };
  return rasteriser;
}

const NOTHING: PrintRasteriser = { print: () => null, reset() {}, dispose() {}, size: 0 };

function decals(object: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  object.traverse((child) => { if (child.userData.part === 'print') found.push(child as THREE.Mesh); });
  return found;
}

const normalOf = (mesh: THREE.Object3D): THREE.Vector3 => new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()));
const upOf = (mesh: THREE.Object3D): THREE.Vector3 => new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()));
const near = (vector: THREE.Vector3, [x, y, z]: [number, number, number]): void => {
  expect(vector.x).toBeCloseTo(x, 6);
  expect(vector.y).toBeCloseTo(y, 6);
  expect(vector.z).toBeCloseTo(z, 6);
};

function printed(shape: Parameters<typeof printSpots>[0], w: number, d: number, h: number, facing = 0, rasteriser: PrintRasteriser = fakeRasteriser()) {
  const object = new THREE.Group();
  const spots = printSpots(shape, w, d, h, facing, null);
  applyPrints(object, 'קראוון 1', spots, rasteriser, LIGHT);
  object.updateMatrixWorld(true);
  return { object, spots, decals: decals(object) };
}

describe('a name printed on the face', () => {
  it('lays a caravan’s top print flat on the roof, a centimetre up, its text top to the north', () => {
    const { decals: [top] } = printed('box', 700, 250, 270);
    near(normalOf(top), [0, 1, 0]);
    near(upOf(top), [0, 0, -1]);
    near(top.getWorldPosition(new THREE.Vector3()), [3.5, 2.71, 1.25]);
  });

  it('turns a deep caravan’s top print to read from the west, and puts its wall print on the west wall', () => {
    const { decals: [top, wall] } = printed('box', 250, 700, 270);
    near(normalOf(top), [0, 1, 0]);
    near(upOf(top), [1, 0, 0]);
    near(normalOf(wall), [-1, 0, 0]);
    near(wall.getWorldPosition(new THREE.Vector3()), [-0.01, 1.35, 3.5]);
    near(upOf(wall), [0, 1, 0]);
  });

  it('stands the south wall print upright, facing south, a centimetre off the wall', () => {
    const { decals: [, wall] } = printed('box', 700, 250, 270);
    near(normalOf(wall), [0, 0, 1]);
    near(upOf(wall), [0, 1, 0]);
    near(wall.getWorldPosition(new THREE.Vector3()), [3.5, 1.35, 2.51]);
  });

  it('tips a tent’s roof print with the south slope', () => {
    const { decals: [roof] } = printed('tent', 300, 300, 200);
    const pitch = Math.atan2(1, 1.5);
    near(normalOf(roof), [0, Math.cos(pitch), Math.sin(pitch)]);
    // Up the slope: north and up.
    near(upOf(roof), [0, Math.sin(pitch), -Math.cos(pitch)]);
  });

  it('tips a turned tent’s roof print with the west slope, reading from the west', () => {
    const { decals: [roof] } = printed('tent', 200, 300, 200);
    near(normalOf(roof), [-Math.SQRT1_2, Math.SQRT1_2, 0]);
    near(upOf(roof), [Math.SQRT1_2, Math.SQRT1_2, 0]);
  });

  it('sizes every decal by fitPrint, in metres, and makes it click-through paint that casts no shadow', () => {
    const { decals: found, spots } = printed('box', 700, 250, 270);
    expect(found).toHaveLength(2);
    found.forEach((decal, i) => {
      const fitted = fitPrint(spots[i], 4);
      const geometry = decal.geometry as THREE.PlaneGeometry;
      expect(geometry.parameters.width).toBeCloseTo(fitted.widthCm * CM, 9);
      expect(geometry.parameters.height).toBeCloseTo(fitted.heightCm * CM, 9);
      expect(decal.castShadow).toBe(false);
      expect(decal.receiveShadow).toBe(true);
      expect(decal.userData.pick).toBe(false);
      expect(decal.userData.part).toBe('print');
      expect(decal.renderOrder).toBe(1);
      const material = decal.material as THREE.MeshLambertMaterial;
      expect(material.transparent).toBe(true);
      expect(material.polygonOffset).toBe(true);
      expect(material.color.getHexString()).toBe(SCENE_PALETTE.light.ink.slice(1).toLowerCase());
    });
  });

  it('shares the rasteriser’s texture and asks it once per item', () => {
    const rasteriser = fakeRasteriser();
    const { decals: found } = printed('box', 700, 250, 270, 0, rasteriser);
    expect(rasteriser.asked).toBe(1);
    for (const decal of found) expect((decal.material as THREE.MeshLambertMaterial).map).toBe(rasteriser.texture);
  });

  it('places nothing, and throws nothing, when the rasteriser has nothing', () => {
    const { object, decals: found } = printed('box', 700, 250, 270, 0, NOTHING);
    expect(found).toEqual([]);
    expect(object.children).toEqual([]);
    expect(() => { clearPrints(object); }).not.toThrow();
  });

  it('is cleared with its geometry and material freed, and the shared texture kept', () => {
    const rasteriser = fakeRasteriser();
    const { object, decals: found } = printed('box', 700, 250, 270, 0, rasteriser);
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial());
    body.userData.part = 'body';
    object.add(body);
    const geometryFreed = vi.spyOn(found[0].geometry, 'dispose');
    const materialFreed = vi.spyOn(found[0].material as THREE.Material, 'dispose');
    const textureFreed = vi.spyOn(rasteriser.texture, 'dispose');

    clearPrints(object);

    expect(decals(object)).toEqual([]);
    expect(object.children).toEqual([body]);
    expect(geometryFreed).toHaveBeenCalledTimes(1);
    expect(materialFreed).toHaveBeenCalledTimes(1);
    expect(textureFreed).not.toHaveBeenCalled();
  });
});
