import * as THREE from 'three';
import { fitPrint, type PrintSpot } from '@/lib/site/editor/prints';
import { CM, worldOf, type ItemLook } from './meshes';
import { SCENE_PALETTE } from './palette';
import type { PrintRasteriser } from './print-texture';

/**
 * The item's name printed on its faces (plan 2026-09-26-site-label-modes,
 * Task 4): one thin decal per spot from `printSpots`, laid a centimetre off
 * the face with a polygon offset so it never fights the surface under it.
 * The ink is the material's colour over the rasteriser's white alpha mask
 * (D2), so `restyleItemObject` recolours it for a theme flip without a new
 * texture. A decal is click-through, casts no shadow and receives the
 * scene's, so it reads as paint on the surface rather than a sign over it.
 *
 * Each decal sits in a holder group: the holder turns the whole spot to face
 * west when its reader stands there, and inside it the plane tips back from
 * vertical onto the face — flat for a top, upright for a wall, the pitch for
 * a roof. Two rotations in two frames, so neither has to know the other.
 */

/** Off the face by this much, along its normal. */
const LIFT_M = 0.01;

/**
 * Lays one decal per spot on the item's group. The texture is the
 * rasteriser's, shared between every item with the same name, and never
 * disposed here. Nothing is added when the rasteriser has nothing to give.
 */
export function applyPrints(
  object: THREE.Group, label: string, spots: readonly PrintSpot[], rasteriser: PrintRasteriser, look: ItemLook,
): void {
  const print = rasteriser.print(label);
  if (print === null) return;
  const ink = SCENE_PALETTE[look.theme].ink;
  for (const spot of spots) {
    const size = fitPrint(spot, print.aspect);
    if (size.widthCm <= 0 || size.heightCm <= 0) continue;

    const holder = new THREE.Group();
    holder.userData.printHolder = true;
    holder.position.copy(worldOf(spot.xCm, spot.yCm, spot.zCm));
    // A reader west of the face: the whole spot turned a quarter to face −X, text top to the east.
    holder.rotation.y = spot.readFrom === 'west' ? -Math.PI / 2 : 0;

    const tilt = (spot.tiltDeg * Math.PI) / 180;
    const material = new THREE.MeshLambertMaterial({
      map: print.texture, color: ink, transparent: true, alphaTest: 0.05,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(size.widthCm * CM, size.heightCm * CM), material);
    // From vertical facing +Z (south) with its text top up, tipped back onto the face.
    decal.rotation.x = -(Math.PI / 2 - tilt);
    // Lifted along the face's normal, which in the holder's frame is (0, cos φ, sin φ).
    decal.position.set(0, LIFT_M * Math.cos(tilt), LIFT_M * Math.sin(tilt));
    decal.userData.part = 'print';
    decal.userData.pick = false;
    decal.castShadow = false;
    decal.receiveShadow = true;
    decal.renderOrder = 1;
    holder.add(decal);
    object.add(holder);
  }
}

/** Removes every print and frees its geometry and material — not its texture, which is the rasteriser's. */
export function clearPrints(object: THREE.Group): void {
  for (const child of [...object.children]) {
    if (child.userData.printHolder !== true) continue;
    object.remove(child);
    child.traverse((node) => {
      const drawable = node as THREE.Mesh;
      if (drawable.geometry instanceof THREE.BufferGeometry) drawable.geometry.dispose();
      if (drawable.material instanceof THREE.Material) drawable.material.dispose();
    });
  }
}
