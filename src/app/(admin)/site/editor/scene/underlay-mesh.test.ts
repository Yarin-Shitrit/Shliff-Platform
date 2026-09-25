import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import type { EditorItem } from '@/lib/site/editor/model';
import { imageToMap, type UnderlayPlacement } from '@/lib/site/underlay';
import { buildGround, buildItemObject } from './meshes';
import {
  UNDERLAY_LIFT_CM, UNDERLAY_RENDER_ORDER, UnderlayLayer, buildUnderlayPlane, loadUnderlayImage, placeUnderlayPlane,
  type DecodedUnderlay, type UnderlayLoader, type UnderlayStatus,
} from './underlay-mesh';

type Picture = DecodedUnderlay & { close: ReturnType<typeof vi.fn<() => void>> };

/** A decoded picture, as `createImageBitmap` would give it: three only reads its size here. */
function picture(width: number, height: number): Picture {
  return { source: { width, height } as unknown as ImageBitmap, width, height, close: vi.fn<() => void>() };
}

const P: UnderlayPlacement = { centreXCm: 1300, centreYCm: 1200, widthCm: 2600, rotationTenths: 0 };
const VIEW = { shown: true, opacity: 0.5 };

/** Where the plane's vertex with this uv lands on the map, in centimetres (three x is east, three z is south). */
function cornerOnMap(mesh: THREE.Mesh, u: number, v: number): [number, number] {
  mesh.updateMatrixWorld(true);
  const uv = mesh.geometry.getAttribute('uv');
  const position = mesh.geometry.getAttribute('position');
  for (let i = 0; i < uv.count; i += 1) {
    if (uv.getX(i) === u && uv.getY(i) === v) {
      const world = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      return [world.x / 0.01, world.z / 0.01];
    }
  }
  throw new Error(`no vertex at uv ${u},${v}`);
}

const planeOf = (layer: UnderlayLayer) => layer.root.getObjectByName('underlayPlane') as THREE.Mesh | undefined;
const settle = () => new Promise<void>((done) => { setTimeout(done, 0); });

function setup(load: UnderlayLoader) {
  const statuses: UnderlayStatus[] = [];
  const onLoaded = vi.fn();
  const maxSide = vi.fn(() => 4096);
  const layer = new UnderlayLayer({ load, maxSide, onStatus: (status) => { statuses.push(status); }, onLoaded });
  return { layer, statuses, onLoaded, maxSide };
}

/** A load the test answers when it chooses. */
function deferred() {
  let resolve!: (value: DecodedUnderlay | 'missing') => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<DecodedUnderlay | 'missing'>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the picture’s plane', () => {
  it('sits in three’s opaque pass between the plot and the shade patches, blends by itself, writes no depth and takes no click', () => {
    const mesh = buildUnderlayPlane(picture(400, 300));
    const material = mesh.material as THREE.MeshBasicMaterial;
    expect(mesh.name).toBe('underlayPlane');
    expect(mesh.renderOrder).toBe(UNDERLAY_RENDER_ORDER);
    expect(UNDERLAY_RENDER_ORDER).toBe(-3.5);
    expect(material.transparent).toBe(false);
    expect(material.blending).toBe(THREE.CustomBlending);
    expect([material.blendSrc, material.blendDst, material.blendEquation])
      .toEqual([THREE.SrcAlphaFactor, THREE.OneMinusSrcAlphaFactor, THREE.AddEquation]);
    expect(material.depthWrite).toBe(false);
    expect(mesh.userData.pick).toBe(false);

    // What it must sit between is in the same (opaque) pass, so render order alone decides.
    const ground = buildGround({ id: 'p', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, 'light');
    const layer = (name: string) => ground.getObjectByName(name) as THREE.Mesh;
    expect(layer('plot').renderOrder).toBeLessThan(UNDERLAY_RENDER_ORDER);
    for (const name of ['gridMinor', 'gridMajor', 'fence']) {
      expect(layer(name).renderOrder).toBeGreaterThan(UNDERLAY_RENDER_ORDER);
      expect((layer(name).material as THREE.Material).transparent).toBe(false);
    }
    const net: EditorItem = {
      id: 'n', kind: 'shade', label: 'רשת צל 1', xCm: 0, yCm: 0, widthCm: 800, depthCm: 800,
      heightCm: null, insetCm: 50, sort: 0, taskId: null, notes: null, locked: false, ropeAngleDeg: null,
    };
    let patch: THREE.Mesh | undefined;
    buildItemObject(net, 300, { theme: 'light', state: 'normal', issue: 'none' }).traverse((child) => {
      if (child.userData.part === 'patch') patch = child as THREE.Mesh;
    });
    expect(patch!.renderOrder).toBeGreaterThan(UNDERLAY_RENDER_ORDER);
    expect((patch!.material as THREE.Material).transparent).toBe(false);
  });

  it('draws the picture’s top-left at the north-west and its top-right at the north-east — never mirrored — where the maths puts them', () => {
    const mesh = buildUnderlayPlane(picture(400, 300));
    for (const placement of [P, { ...P, rotationTenths: 300 }, { centreXCm: -250, centreYCm: 4000, widthCm: 777, rotationTenths: 2700 }]) {
      placeUnderlayPlane(mesh, placement, VIEW);
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const [x, y] = cornerOnMap(mesh, u, v);
        const [ex, ey] = imageToMap(placement, 0.75, [u, v]);
        expect(x).toBeCloseTo(ex, 3);
        expect(y).toBeCloseTo(ey, 3);
      }
    }
    placeUnderlayPlane(mesh, P, VIEW);
    const [westX, northY] = cornerOnMap(mesh, 0, 0);
    expect(westX).toBeCloseTo(0, 3);
    expect(northY).toBeCloseTo(225, 3);
    expect(mesh.position.y).toBeCloseTo(UNDERLAY_LIFT_CM * 0.01, 9);
    const texture = (mesh.material as THREE.MeshBasicMaterial).map!;
    expect(texture.flipY).toBe(false);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it('is shown or hidden, and as see-through as this viewer chose', () => {
    const mesh = buildUnderlayPlane(picture(400, 300));
    placeUnderlayPlane(mesh, P, { shown: false, opacity: 0.3 });
    expect(mesh.visible).toBe(false);
    expect((mesh.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.3, 9);
    placeUnderlayPlane(mesh, P, VIEW);
    expect(mesh.visible).toBe(true);
  });
});

describe('the picture layer', () => {
  it('loads the picture when the map gets one, and takes the aspect from the decoded picture (Review Focus #1)', async () => {
    // A phone photo stored 4032 × 3024 and turned by its tag: decoded upright, 3024 × 4032.
    const upright = picture(3024, 4032);
    const load = vi.fn<UnderlayLoader>(async () => upright);
    const { layer, statuses, onLoaded, maxSide } = setup(load);
    layer.sync({ url: '/site/underlay/p/a.jpg', placement: P, ...VIEW });
    expect(statuses).toEqual([{ state: 'loading' }]);
    expect(load).toHaveBeenCalledWith('/site/underlay/p/a.jpg', 4096);
    expect(maxSide).toHaveBeenCalled();
    await settle();
    expect(statuses).toEqual([{ state: 'loading' }, { state: 'ready', aspect: 4032 / 3024 }]);
    expect(layer.aspect).toBeCloseTo(4 / 3, 9);
    expect(onLoaded).toHaveBeenCalledTimes(1);
    const [x, y] = cornerOnMap(planeOf(layer)!, 1, 1);
    const [ex, ey] = imageToMap(P, 4032 / 3024, [1, 1]);
    expect(x).toBeCloseTo(ex, 3);
    expect(y).toBeCloseTo(ey, 3);
  });

  it('says a file is missing, or failed to show, and tries again when asked', async () => {
    const answers: Array<() => Promise<DecodedUnderlay | 'missing'>> = [
      async () => 'missing',
      async () => { throw new Error('the picture route answered 500'); },
      async () => picture(400, 300),
    ];
    const { layer, statuses } = setup(vi.fn<UnderlayLoader>(() => answers.shift()!()));
    layer.sync({ url: '/a.png', placement: P, ...VIEW });
    await settle();
    expect(statuses.at(-1)).toEqual({ state: 'missing' });
    expect(planeOf(layer)).toBeUndefined();
    layer.retry();
    await settle();
    expect(statuses.at(-1)).toEqual({ state: 'failed' });
    layer.retry();
    await settle();
    expect(statuses.at(-1)).toEqual({ state: 'ready', aspect: 0.75 });
    expect(planeOf(layer)).toBeDefined();
  });

  it('keeps the newer picture when an older load lands late, and lets the late one go (Review Focus #5)', async () => {
    const first = deferred();
    const second = deferred();
    const loads = [first.promise, second.promise];
    const { layer, statuses } = setup(vi.fn<UnderlayLoader>(() => loads.shift()!));
    const older = picture(400, 300);
    const newer = picture(300, 400);
    layer.sync({ url: '/old.png', placement: P, ...VIEW });
    layer.sync({ url: '/new.png', placement: P, ...VIEW });
    second.resolve(newer);
    await settle();
    first.resolve(older);
    await settle();
    expect(older.close).toHaveBeenCalledTimes(1);
    expect(newer.close).not.toHaveBeenCalled();
    const map = (planeOf(layer)!.material as THREE.MeshBasicMaterial).map!;
    expect(map.image).toBe(newer.source);
    expect(statuses.filter((status) => status.state === 'ready')).toEqual([{ state: 'ready', aspect: 400 / 300 }]);
  });

  it('takes the picture off when the map has none, frees it, and says so', async () => {
    const shown = picture(400, 300);
    const { layer, statuses } = setup(vi.fn<UnderlayLoader>(async () => shown));
    layer.sync({ url: '/a.png', placement: P, ...VIEW });
    await settle();
    const texture = (planeOf(layer)!.material as THREE.MeshBasicMaterial).map!;
    const freed = vi.spyOn(texture, 'dispose');
    layer.sync({ url: null, placement: null, ...VIEW });
    expect(statuses.at(-1)).toEqual({ state: 'none' });
    expect(planeOf(layer)).toBeUndefined();
    expect(shown.close).toHaveBeenCalledTimes(1);
    expect(freed).toHaveBeenCalled();
    expect(layer.aspect).toBeNull();
  });

  it('moves, turns, hides and fades the plane without rebuilding it', async () => {
    const { layer } = setup(vi.fn<UnderlayLoader>(async () => picture(400, 300)));
    layer.sync({ url: '/a.png', placement: P, ...VIEW });
    await settle();
    const plane = planeOf(layer)!;
    layer.sync({ url: '/a.png', placement: { ...P, centreXCm: 1500, rotationTenths: 900 }, shown: false, opacity: 0.2 });
    expect(planeOf(layer)).toBe(plane);
    expect(plane.position.x).toBeCloseTo(15, 9);
    expect(plane.visible).toBe(false);
    expect((plane.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.2, 9);
  });

  it('rebuilds the plane where it lay after the WebGL context comes back', async () => {
    const { layer } = setup(vi.fn<UnderlayLoader>(async () => picture(400, 300)));
    layer.sync({ url: '/a.png', placement: { ...P, centreXCm: 900 }, ...VIEW });
    await settle();
    const before = planeOf(layer)!;
    layer.rebuild();
    const after = planeOf(layer)!;
    expect(after).not.toBe(before);
    expect(after.position.x).toBeCloseTo(9, 9);
    expect((after.material as THREE.MeshBasicMaterial).map).not.toBe((before.material as THREE.MeshBasicMaterial).map);
  });

  it('reports nothing once disposed, and lets every picture go — even one still on its way', async () => {
    const late = deferred();
    const { layer, statuses } = setup(vi.fn<UnderlayLoader>(() => late.promise));
    layer.sync({ url: '/a.png', placement: P, ...VIEW });
    layer.dispose();
    const arriving = picture(400, 300);
    late.resolve(arriving);
    await settle();
    expect(arriving.close).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual([{ state: 'loading' }]);
    expect(planeOf(layer)).toBeUndefined();
  });
});

describe('the browser’s loader', () => {
  function bytes(...parts: Array<number[] | string>): Uint8Array {
    const out: number[] = [];
    for (const part of parts) {
      if (typeof part === 'string') for (let i = 0; i < part.length; i += 1) out.push(part.charCodeAt(i));
      else out.push(...part);
    }
    return Uint8Array.from(out);
  }
  const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
  const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const png = (width: number, height: number) =>
    bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(width), be32(height), [8, 6, 0, 0, 0]);
  /** A JPEG stored landscape, with EXIF orientation 6: held upright when it was taken. */
  const sidewaysPhoto = (width: number, height: number) => {
    const tiff = bytes('MM', be16(42), be32(8), be16(1), be16(0x0112), be16(3), be32(1), be16(6), [0, 0], be32(0));
    const exif = bytes('Exif', [0, 0], [...tiff]);
    return bytes([0xff, 0xd8], [0xff, 0xe1], be16(exif.length + 2), [...exif],
      [0xff, 0xc0], be16(17), [8], be16(height), be16(width), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1], [0xff, 0xda]);
  };
  // A copy over a plain ArrayBuffer: TS 5.9 takes no view that could sit on a SharedArrayBuffer as a body.
  const serve = (body: Uint8Array | null, status = 200) =>
    vi.fn(async () => new Response(body === null ? null : new Uint8Array(body), { status }));
  const decoder = () => vi.fn(async (_blob: Blob, options?: ImageBitmapOptions) => ({
    width: options?.resizeWidth ?? 1, height: 1, close: vi.fn(),
  }));

  it('asks the admin route, says missing on 404, and fails on anything else', async () => {
    const fetch = serve(null, 404);
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('createImageBitmap', decoder());
    expect(await loadUnderlayImage('/site/underlay/p/a.png', 4096)).toBe('missing');
    expect(fetch).toHaveBeenCalledWith('/site/underlay/p/a.png', { credentials: 'same-origin' });
    vi.stubGlobal('fetch', serve(null, 401));
    await expect(loadUnderlayImage('/site/underlay/p/a.png', 4096)).rejects.toThrow();
  });

  it('shrinks a sideways-stored phone photo by the width it is shown at, and has the browser turn it (Review Focus #1)', async () => {
    // Stored 8000 × 6000, shown 6000 × 8000: the long side, 8000, comes down to 4096, so the shown width to 3072.
    const decode = decoder();
    vi.stubGlobal('fetch', serve(sidewaysPhoto(8000, 6000)));
    vi.stubGlobal('createImageBitmap', decode);
    const decoded = await loadUnderlayImage('/a.jpg', 4096);
    expect(decode).toHaveBeenCalledWith(expect.anything(), {
      imageOrientation: 'from-image', premultiplyAlpha: 'none', resizeWidth: 3072, resizeQuality: 'high',
    });
    expect(decoded).toMatchObject({ width: 3072 });
  });

  it('decodes a picture already small enough as it is, and honours a smaller GPU limit', async () => {
    const decode = decoder();
    vi.stubGlobal('fetch', serve(png(1600, 1200)));
    vi.stubGlobal('createImageBitmap', decode);
    await loadUnderlayImage('/a.png', 4096);
    expect(decode).toHaveBeenLastCalledWith(expect.anything(), { imageOrientation: 'from-image', premultiplyAlpha: 'none' });
    vi.stubGlobal('fetch', serve(png(1600, 1200)));
    await loadUnderlayImage('/a.png', 800);
    expect(decode).toHaveBeenLastCalledWith(expect.anything(), {
      imageOrientation: 'from-image', premultiplyAlpha: 'none', resizeWidth: 800, resizeQuality: 'high',
    });
  });

  it('fails on a body that states no size, without decoding it', async () => {
    const decode = decoder();
    vi.stubGlobal('fetch', serve(bytes('hello')));
    vi.stubGlobal('createImageBitmap', decode);
    await expect(loadUnderlayImage('/a.png', 4096)).rejects.toThrow();
    expect(decode).not.toHaveBeenCalled();
  });
});
