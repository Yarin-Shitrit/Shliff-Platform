import * as THREE from 'three';
import { displaySize, imageFacts } from '@/lib/site/image-facts';
import type { UnderlayPlacement } from '@/lib/site/underlay';
import { CM, disposeObject, worldOf } from './meshes';

/**
 * The picture under the map, in the scene (spec §19): one flat, unlit plane a
 * millimetre above the ground, and the upkeep of the texture on it. That is
 * fetching, decoding, replacing, freeing, and rebuilding after a lost WebGL
 * context.
 *
 * Draw order. three draws every opaque object before any transparent one,
 * whatever their `renderOrder`. The plot, the grid, the fence and the drawn
 * shade patches are all opaque and write no depth. A see-through plane made
 * `transparent` would be drawn after them and cover the grid and the fence.
 * So this one stays in the opaque pass (`transparent: false`) and blends by
 * itself (`CustomBlending`, source alpha over what is there). three keeps
 * its opacity in the shader, because the `OPAQUE` define is only set for
 * `NormalBlending`. Among the opaque layers it sorts by `renderOrder` −3.5:
 * - above the ground outside (−5) and the plot (−4);
 * - below the shade patches (−3), the grid (−2, −1.5) and the fence (−1).
 * It writes no depth, so everything that stands is drawn over it.
 *
 * It is never picked. It is not one of `SceneSync`'s objects, and it carries
 * `userData.pick = false` besides. The calibration and alignment tools test
 * ground points against the picture themselves (`engine.ts`).
 *
 * Never mirrored. The corners are laid out by hand: the picture's top-left
 * (uv 0,0) at the north-west and its top-right at the north-east. The texture
 * is uploaded unflipped (`flipY = false`; WebGL ignores the flag for an
 * `ImageBitmap` anyway), so the picture's first row is its top edge.
 */

export const UNDERLAY_RENDER_ORDER = -3.5;
/** A millimetre above the ground: over the plot's surface, under everything that stands. */
export const UNDERLAY_LIFT_CM = 0.1;

export type UnderlayStatus =
  | { state: 'none' }
  | { state: 'loading' }
  /** `aspect`: the decoded picture's height ÷ width, as shown after any EXIF turn. */
  | { state: 'ready'; aspect: number }
  | { state: 'failed' }
  | { state: 'missing' };

/** What the picture layer and the calibration tool tell the editor (`SceneViewProps.onUnderlay`). */
export type UnderlayEvent =
  | { type: 'status'; status: UnderlayStatus }
  /** A point marked on the picture, as fractions of it. */
  | { type: 'point'; uv: [number, number] }
  | { type: 'offImage' }
  | { type: 'tooClose' };

/** A decoded picture, as the scene draws it: already turned by its EXIF tag and shrunk to fit. */
export interface DecodedUnderlay {
  source: ImageBitmap;
  width: number;
  height: number;
  close(): void;
}

/** Fetches and decodes. 'missing' when the route answers 404; rejects on any other failure. */
export type UnderlayLoader = (url: string, maxSide: number) => Promise<DecodedUnderlay | 'missing'>;

/**
 * The browser's loader (spec §19). It asks the admin-only route, reads the
 * picture's size from its header, and decodes it once:
 * - `imageOrientation: 'from-image'`, so a phone photo stands the way it was
 *   taken;
 * - `premultiplyAlpha: 'none'`, because the plane's blending multiplies by
 *   alpha itself;
 * - a width that keeps the long side within `maxSide`, worked out before
 *   decoding, so a 48-megapixel photo is never held whole (Review Focus #1).
 *
 * Only a width is passed. The HTML spec turns by the EXIF tag before it
 * resizes, so the width asked for is the width as shown. A browser that
 * resized first would still keep the proportions and only miss the size, and
 * three shrinks any texture still over the GPU's limit by itself.
 */
export async function loadUnderlayImage(url: string, maxSide: number): Promise<DecodedUnderlay | 'missing'> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (response.status === 404) return 'missing';
  if (!response.ok) throw new Error(`the picture route answered ${response.status}`);
  const blob = await response.blob();
  const shown = displaySize(imageFacts(new Uint8Array(await blob.arrayBuffer())));
  if (shown === null) throw new Error('the picture states no size');
  const scale = Math.min(1, maxSide / Math.max(shown.width, shown.height));
  const options: ImageBitmapOptions = { imageOrientation: 'from-image', premultiplyAlpha: 'none' };
  if (scale < 1) {
    options.resizeWidth = Math.max(1, Math.round(shown.width * scale));
    options.resizeQuality = 'high';
  }
  const bitmap = await createImageBitmap(blob, options);
  return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => { bitmap.close(); } };
}

/** A plane one metre wide and `aspect` metres deep, centred on its origin, facing up. */
function planeGeometry(aspect: number): THREE.BufferGeometry {
  const half = aspect / 2;
  const geometry = new THREE.BufferGeometry();
  // North-west, north-east, south-east, south-west: the picture's top-left, top-right, bottom-right, bottom-left.
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, 0, -half, 0.5, 0, -half, 0.5, 0, half, -0.5, 0, half,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  // Wound to face up (+Y): the map is only ever seen from above.
  geometry.setIndex([0, 3, 2, 0, 2, 1]);
  return geometry;
}

export function buildUnderlayPlane(image: DecodedUnderlay): THREE.Mesh {
  const texture = new THREE.Texture(image.source);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: false,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(planeGeometry(image.height / image.width), material);
  mesh.name = 'underlayPlane';
  mesh.renderOrder = UNDERLAY_RENDER_ORDER;
  mesh.userData.pick = false;
  return mesh;
}

/** Where the plane lies and how this viewer sees it. A move, a turn or a fade never rebuilds it. */
export function placeUnderlayPlane(
  mesh: THREE.Mesh, placement: UnderlayPlacement, view: { shown: boolean; opacity: number },
): void {
  mesh.position.copy(worldOf(placement.centreXCm, placement.centreYCm, UNDERLAY_LIFT_CM));
  // Clockwise seen from above on the map is a negative turn about three's up axis (`meshes.ts`: map y is three's z).
  mesh.rotation.set(0, -((placement.rotationTenths / 10) * Math.PI) / 180, 0);
  const metres = placement.widthCm * CM;
  mesh.scale.set(metres, 1, metres);
  (mesh.material as THREE.MeshBasicMaterial).opacity = view.opacity;
  mesh.visible = view.shown;
  mesh.updateMatrixWorld(true);
}

function freePlane(mesh: THREE.Mesh): void {
  (mesh.material as THREE.MeshBasicMaterial).map?.dispose();
  disposeObject(mesh);
}

function sameStatus(a: UnderlayStatus, b: UnderlayStatus): boolean {
  return a.state === b.state && (a.state !== 'ready' || b.state !== 'ready' || a.aspect === b.aspect);
}

export interface UnderlayLayerOptions {
  load: UnderlayLoader;
  /** The longest side a decoded picture may keep: 4096, or the GPU's own limit if smaller. */
  maxSide: () => number;
  onStatus: (status: UnderlayStatus) => void;
  /** A picture arrived: the scene has something new to draw. */
  onLoaded: () => void;
}

export interface UnderlaySyncInput {
  /** The admin route's URL for the picture, or null when the map has none. */
  url: string | null;
  placement: UnderlayPlacement | null;
  shown: boolean;
  opacity: number;
}

/**
 * The picture's upkeep, keyed by its URL (which carries the file's hash). A
 * new URL frees the old picture and loads the new one. A load that lands
 * after a newer one was asked for is released unseen, so a quick replace or
 * an undo across one never shows the wrong picture (Review Focus #5). The
 * decoded picture is kept while it is shown, so a lost WebGL context can
 * upload it again (`rebuild`).
 */
export class UnderlayLayer {
  readonly root = new THREE.Group();
  private url: string | null = null;
  private image: DecodedUnderlay | null = null;
  private mesh: THREE.Mesh | null = null;
  private status: UnderlayStatus = { state: 'none' };
  /** Bumped by every load and every drop: a load answering to an older number is stale. */
  private generation = 0;
  private last: UnderlaySyncInput | null = null;
  private disposed = false;

  constructor(private readonly options: UnderlayLayerOptions) {
    this.root.name = 'underlay';
  }

  /** The decoded picture's height ÷ width, or null while there is none to draw. */
  get aspect(): number | null {
    return this.image === null ? null : this.image.height / this.image.width;
  }

  sync(input: UnderlaySyncInput): void {
    if (this.disposed) return;
    this.last = input;
    if (input.url !== this.url) {
      this.drop();
      this.url = input.url;
      if (input.url === null) this.report({ state: 'none' });
      else this.load(input.url);
    }
    if (this.mesh !== null && input.placement !== null) placeUnderlayPlane(this.mesh, input.placement, input);
  }

  /** "ניסיון נוסף": load the same picture again after it failed or went missing. */
  retry(): void {
    if (this.disposed || this.url === null || this.image !== null) return;
    this.load(this.url);
  }

  /** The WebGL context came back: the kept picture goes up again, as a new texture on a new plane. */
  rebuild(): void {
    if (this.disposed || this.image === null) return;
    this.clearMesh();
    this.makeMesh();
  }

  dispose(): void {
    this.drop();
    this.disposed = true;
  }

  private load(url: string): void {
    this.generation += 1;
    const generation = this.generation;
    this.report({ state: 'loading' });
    this.options.load(url, this.options.maxSide()).then((result) => {
      if (this.disposed || generation !== this.generation) {
        if (result !== 'missing') result.close();
        return;
      }
      if (result === 'missing') {
        this.report({ state: 'missing' });
        return;
      }
      this.image = result;
      this.makeMesh();
      this.report({ state: 'ready', aspect: result.height / result.width });
      this.options.onLoaded();
    }, () => {
      if (this.disposed || generation !== this.generation) return;
      this.report({ state: 'failed' });
    });
  }

  private makeMesh(): void {
    if (this.image === null) return;
    this.mesh = buildUnderlayPlane(this.image);
    this.root.add(this.mesh);
    const last = this.last;
    if (last !== null && last.placement !== null) placeUnderlayPlane(this.mesh, last.placement, last);
  }

  private clearMesh(): void {
    if (this.mesh === null) return;
    this.root.remove(this.mesh);
    freePlane(this.mesh);
    this.mesh = null;
  }

  private drop(): void {
    this.generation += 1;
    this.clearMesh();
    this.image?.close();
    this.image = null;
  }

  private report(status: UnderlayStatus): void {
    if (this.disposed || sameStatus(status, this.status)) return;
    this.status = status;
    this.options.onStatus(status);
  }
}
