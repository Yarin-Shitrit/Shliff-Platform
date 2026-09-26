import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { EditorItem } from '@/lib/site/editor/model';
import { buildGround, buildItemObject, CM, directionOf, disposeObject, geometryKey, restyleItemObject, worldOf, type ItemLook } from './meshes';
import { SCENE_PALETTE } from './palette';

function item(over: Partial<EditorItem> = {}): EditorItem {
  return {
    id: 'a', kind: 'tent', label: 'אוהל 1', xCm: 100, yCm: 200, widthCm: 300, depthCm: 200,
    heightCm: null, insetCm: null, ropeAngleDeg: null, sort: 0, taskId: null, notes: null, facing: 0, locked: false, ...over,
  };
}

const NORMAL: ItemLook = { theme: 'light', state: 'normal', issue: 'none' };

function parts(object: THREE.Object3D, part: string): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  object.traverse((child) => { if (child.userData.part === part) found.push(child as THREE.Mesh); });
  return found;
}

describe('the map in three’s units', () => {
  it('puts east on +X, up on +Y and south on +Z, in metres', () => {
    expect(CM).toBe(0.01);
    expect(worldOf(250, 400, 120).toArray()).toEqual([2.5, 1.2, 4]);
  });

  it('swaps the same two axes for a direction, unscaled', () => {
    expect(directionOf([1, 2, 3]).toArray()).toEqual([1, 3, 2]);
  });
});

describe('the item builders', () => {
  it('stands every shape on its north-west corner, named by its id', () => {
    for (const kind of ['tent', 'caravan', 'sofa', 'water', 'fire', 'shade'] as const) {
      const object = buildItemObject(item({ kind, insetCm: kind === 'shade' ? 50 : null }), 200, NORMAL);
      expect(object.name).toBe('a');
      expect(object.userData).toMatchObject({ id: 'a', isNet: kind === 'shade' });
      expect(object.position.toArray()).toEqual([1, 0, 2]);
      const bounds = new THREE.Box3().setFromObject(object);
      expect(bounds.min.x).toBeGreaterThanOrEqual(1 - 0.1);
      expect(bounds.max.x).toBeLessThanOrEqual(4 + 0.3);
      expect(bounds.max.y).toBeCloseTo(kind === 'fire' ? 2.01 : 2, 1);
    }
  });

  it('builds a sofa from a seat and a back, the back on the long side', () => {
    const sofa = buildItemObject(item({ kind: 'sofa', widthCm: 200, depthCm: 90 }), 80, NORMAL);
    const bodies = parts(sofa, 'body');
    expect(bodies).toHaveLength(2);
    const back = new THREE.Box3().setFromObject(bodies[1]);
    expect(back.max.y).toBeCloseTo(0.8);
    expect(back.max.x - back.min.x).toBeCloseTo(2);
  });

  it('walks a sofa’s back round the four edges as the facing turns, clockwise from north', () => {
    const backOf = (facing: number) => {
      const bodies = parts(buildItemObject(item({ kind: 'sofa', widthCm: 200, depthCm: 90, facing }), 80, NORMAL), 'body');
      expect(bodies).toHaveLength(2);
      return bodies[1].position;
    };
    // The seat is 2 m by 0.9 m, so its middle is (1, 0.45); the back's middle sits in from the edge it stands on.
    expect(backOf(0).x).toBeCloseTo(1);
    expect(backOf(0).z).toBeLessThan(0.45);
    expect(backOf(1).z).toBeCloseTo(0.45);
    expect(backOf(1).x).toBeGreaterThan(1);
    expect(backOf(2).x).toBeCloseTo(1);
    expect(backOf(2).z).toBeGreaterThan(0.45);
    expect(backOf(3).z).toBeCloseTo(0.45);
    expect(backOf(3).x).toBeLessThan(1);
  });

  it('keys a sofa’s geometry on its facing, a square tent’s too, and nothing else without a front', () => {
    expect(geometryKey(item({ kind: 'sofa', facing: 1 }), 80)).not.toBe(geometryKey(item({ kind: 'sofa' }), 80));
    expect(geometryKey(item({ kind: 'armchair', facing: 1 }), 80)).not.toBe(geometryKey(item({ kind: 'armchair' }), 80));
    // A 300 × 200 tent runs its ridge along the longer side whatever the facing; a square has none, so the facing decides.
    expect(geometryKey(item({ facing: 1 }), 200)).toBe(geometryKey(item(), 200));
    expect(geometryKey(item({ widthCm: 300, depthCm: 300, facing: 1 }), 200))
      .not.toBe(geometryKey(item({ widthCm: 300, depthCm: 300 }), 200));
    expect(geometryKey(item({ kind: 'caravan', facing: 3 }), 270)).toBe(geometryKey(item({ kind: 'caravan' }), 270));
  });

  it('turns a square tent’s ridge with its facing: east–west at 0 and 2, north–south at 1 and 3', () => {
    const ridgeOf = (facing: number) => {
      const [body] = parts(buildItemObject(item({ widthCm: 300, depthCm: 300, facing }), 200, NORMAL), 'body');
      const position = body.geometry.getAttribute('position');
      const xs = new Set<number>();
      const zs = new Set<number>();
      for (let i = 0; i < position.count; i += 1) {
        if (Math.abs(position.getY(i) - 2) < 1e-6) {
          xs.add(position.getX(i));
          zs.add(position.getZ(i));
        }
      }
      return { xs, zs };
    };
    // Along x: every ridge point shares one z (the middle) and spans both ends in x.
    expect(ridgeOf(0).zs).toEqual(new Set([1.5]));
    expect(ridgeOf(0).xs).toEqual(new Set([0, 3]));
    expect(ridgeOf(2).zs).toEqual(new Set([1.5]));
    // Along z: the other way round.
    expect(ridgeOf(1).xs).toEqual(new Set([1.5]));
    expect(ridgeOf(1).zs).toEqual(new Set([0, 3]));
    expect(ridgeOf(3).xs).toEqual(new Set([1.5]));
  });

  it('turns every face of a tent outwards, with the ridge along the longer side', () => {
    const tent = buildItemObject(item({ widthCm: 400, depthCm: 300 }), 200, NORMAL);
    const [body] = parts(tent, 'body');
    const geometry = body.geometry;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const centre = new THREE.Vector3(2, 1, 1.5);
    for (let i = 0; i < position.count; i += 3) {
      const mid = new THREE.Vector3();
      for (let k = 0; k < 3; k += 1) mid.add(new THREE.Vector3().fromBufferAttribute(position, i + k));
      mid.divideScalar(3);
      const n = new THREE.Vector3().fromBufferAttribute(normal, i);
      expect(n.dot(mid.sub(centre))).toBeGreaterThan(0);
    }
    const ridge: number[] = [];
    for (let i = 0; i < position.count; i += 1) if (Math.abs(position.getY(i) - 2) < 1e-6) ridge.push(position.getZ(i));
    expect(new Set(ridge)).toEqual(new Set([1.5]));
  });

  it('draws a net as four poles and a see-through cloth at its height, the unshaded strip dashed', () => {
    const net = buildItemObject(item({ kind: 'shade', widthCm: 800, depthCm: 600, insetCm: 50 }), 300, NORMAL);
    expect(parts(net, 'pole')).toHaveLength(4);
    const [cloth] = parts(net, 'cloth');
    expect((cloth.material as THREE.Material).transparent).toBe(true);
    expect(cloth.position.y).toBeCloseTo(3);
    const [inset] = parts(net, 'inset');
    const strip = new THREE.Box3().setFromObject(inset);
    expect(strip.max.x - strip.min.x).toBeCloseTo(7);
    expect(strip.max.z - strip.min.z).toBeCloseTo(5);
    const [caster] = parts(net, 'caster');
    expect(caster.castShadow).toBe(true);
    expect(caster.userData.pick).toBe(false);
    expect(cloth.castShadow).toBe(false);
    // A one-sided plane lit from above casts no shadow in three r186: both
    // faces of the caster must be eligible so the real sun shadow (Task 20)
    // actually falls on the ground.
    expect((caster.material as THREE.Material).shadowSide).toBe(THREE.DoubleSide);
  });

  it('keys the geometry on shape, size, height and inset — never on position or name', () => {
    const base = geometryKey(item(), 200);
    expect(geometryKey(item({ xCm: 900, label: 'אוהל 9', locked: true }), 200)).toBe(base);
    expect(geometryKey(item({ widthCm: 310 }), 200)).not.toBe(base);
    expect(geometryKey(item(), 210)).not.toBe(base);
    expect(geometryKey(item({ kind: 'caravan' }), 200)).not.toBe(base);
    expect(geometryKey(item({ kind: 'shade', insetCm: 50 }), 200))
      .not.toBe(geometryKey(item({ kind: 'shade', insetCm: 60 }), 200));
  });

  it('recolours for selection, problems and theme without new geometry', () => {
    const tent = buildItemObject(item(), 200, NORMAL);
    const [body] = parts(tent, 'body');
    const geometry = body.geometry;
    const before = (body.material as THREE.MeshLambertMaterial).color.getHex();

    restyleItemObject(tent, { theme: 'light', state: 'selected', issue: 'none' });
    expect((body.material as THREE.MeshLambertMaterial).color.getHex()).not.toBe(before);
    const [edge] = parts(tent, 'edge');
    expect((edge.material as THREE.LineBasicMaterial).color.getHex())
      .toBe(new THREE.Color(SCENE_PALETTE.light.selected).getHex());

    restyleItemObject(tent, { theme: 'dark', state: 'normal', issue: 'outside' });
    expect((edge.material as THREE.LineBasicMaterial).color.getHex())
      .toBe(new THREE.Color(SCENE_PALETTE.dark.bad).getHex());
    expect(body.geometry).toBe(geometry);
  });

  it('hides the drawn shade and contact patches when the sun casts real shadows', () => {
    const net = buildItemObject(item({ kind: 'shade', insetCm: 50 }), 300, NORMAL);
    const tent = buildItemObject(item(), 200, NORMAL);
    expect(parts(net, 'patch')[0].visible).toBe(true);
    restyleItemObject(net, { ...NORMAL, sun: true });
    restyleItemObject(tent, { ...NORMAL, sun: true });
    expect(parts(net, 'patch')[0].visible).toBe(false);
    expect(parts(tent, 'contact')[0].visible).toBe(false);
  });
});

describe('the ground', () => {
  it('lays the plot, the grid and the fence at the plot’s size', () => {
    const ground = buildGround({ id: 'p', widthCm: 2600, depthCm: 2400, gridCm: 50, northDeg: 0 }, 'light');
    const plot = ground.getObjectByName('plot') as THREE.Mesh;
    const bounds = new THREE.Box3().setFromObject(plot);
    expect(bounds.min.x).toBeCloseTo(0);
    expect(bounds.min.z).toBeCloseTo(0);
    expect(bounds.max.y).toBeCloseTo(0);
    expect(bounds.max.x).toBeCloseTo(26);
    expect(bounds.max.z).toBeCloseTo(24);
    const minor = ground.getObjectByName('gridMinor') as THREE.LineSegments;
    // 53 lines across and 49 down, two points each.
    expect(minor.geometry.getAttribute('position').count).toBe((53 + 49) * 2);
    expect(ground.getObjectByName('gridMajor')).toBeDefined();
    expect(ground.getObjectByName('fence')).toBeDefined();
  });
});

describe('disposal', () => {
  it('frees every geometry and material once', () => {
    const net = buildItemObject(item({ kind: 'shade', insetCm: 50 }), 300, NORMAL);
    let disposed = 0;
    const seen = new Set<unknown>();
    net.traverse((child) => {
      const mesh = child as THREE.Mesh;
      for (const owned of [mesh.geometry, mesh.material]) {
        if (owned && !seen.has(owned)) {
          seen.add(owned);
          (owned as THREE.EventDispatcher<{ dispose: object }>).addEventListener('dispose', () => { disposed += 1; });
        }
      }
    });
    disposeObject(net);
    expect(disposed).toBe(seen.size);
    expect(disposed).toBeGreaterThan(6);
  });
});

describe('a net’s ropes', () => {
  // Spec §12's example: 8 × 8 m, 3 m high, ropes at 45°: stakes 3 m out.
  const roped = () => buildItemObject(item({ kind: 'shade', widthCm: 800, depthCm: 800, insetCm: 50 }), 300, NORMAL, 300);

  it('run two ropes from each corner to stakes one offset out, at right angles to its sides', () => {
    const net = roped();
    const [ropes] = parts(net, 'rope');
    expect(ropes.geometry.getAttribute('position').count).toBe(16);
    const stakes = parts(net, 'stake');
    expect(stakes.map((stake) => `${stake.position.x},${stake.position.z}`).sort()).toEqual([
      '-3,0', '-3,8', '0,-3', '0,11', '11,0', '11,8', '8,-3', '8,11',
    ]);
  });

  it('dash the footprint on the ground: 14 × 14 m', () => {
    const [edge] = parts(roped(), 'ropeEdge');
    const bounds = new THREE.Box3().setFromObject(edge);
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(14);
    expect(bounds.max.z - bounds.min.z).toBeCloseTo(14);
    expect(bounds.max.y).toBeLessThan(0.01);
  });

  it('are click-through and cast no shadow: ropes take ground, they do not shade it', () => {
    const net = roped();
    for (const part of ['rope', 'stake', 'ropeEdge']) {
      for (const mesh of parts(net, part)) {
        expect(mesh.userData.pick).toBe(false);
        expect(mesh.castShadow).toBe(false);
      }
    }
  });

  it('draw the footprint in the "bad" colour when the ropes cross the fence', () => {
    const net = roped();
    const [edge] = parts(net, 'ropeEdge');
    const colour = () => (edge.material as THREE.LineBasicMaterial).color.getHex();
    expect(colour()).toBe(new THREE.Color(SCENE_PALETTE.light.clothEdge).getHex());
    restyleItemObject(net, { ...NORMAL, issue: 'outside' });
    expect(colour()).toBe(new THREE.Color(SCENE_PALETTE.light.bad).getHex());
  });

  it('are not there without an angle, and a rope change is a new geometry', () => {
    const bare = buildItemObject(item({ kind: 'shade', widthCm: 800, depthCm: 800, insetCm: 50 }), 300, NORMAL);
    expect(parts(bare, 'rope')).toHaveLength(0);
    expect(parts(bare, 'stake')).toHaveLength(0);
    const net = item({ kind: 'shade', insetCm: 50 });
    expect(geometryKey(net, 300, 300)).not.toBe(geometryKey(net, 300, 0));
    expect(geometryKey(net, 300)).toBe(geometryKey(net, 300, 0));
  });
});
