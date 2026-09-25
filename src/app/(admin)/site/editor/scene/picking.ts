import * as THREE from 'three';
import type { Viewport } from '@/lib/site/editor/camera';
import type { SceneSync } from './scene-sync';

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

/** The item a hit belongs to: the nearest ancestor that carries an id. */
function idOf(object: THREE.Object3D | null): string | null {
  for (let node = object; node !== null; node = node.parent) {
    if (typeof node.userData.id === 'string') return node.userData.id;
  }
  return null;
}

/** The first hit on a surface a click may land on — never an edge line, a ground patch or the shade caster. */
function firstItem(hits: readonly THREE.Intersection[]): string | null {
  for (const hit of hits) {
    if (!(hit.object instanceof THREE.Mesh) || hit.object.userData.pick === false) continue;
    const id = idOf(hit.object);
    if (id !== null) return id;
  }
  return null;
}

/**
 * The item — or the pipe or cable — under a screen point (spec §7). Solid
 * items first: a shade net is picked only where no tent, sofa or caravan is
 * under the pointer, so a net covering half the lounge never steals the click
 * meant for what is under it. A line lies on the ground, so it comes after
 * the solids standing on it and before the net over it. `sx`, `sy` are CSS
 * pixels from the canvas's top-left corner.
 */
export function pickItemId(
  camera: THREE.Camera, sync: SceneSync, sx: number, sy: number, viewport: Viewport,
): string | null {
  pointer.set((sx / viewport.width) * 2 - 1, -(sy / viewport.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return firstItem(raycaster.intersectObjects(sync.solidObjects(), true))
    ?? firstItem(raycaster.intersectObjects(sync.lineObjects(), true))
    ?? firstItem(raycaster.intersectObjects(sync.netObjects(), true));
}
