import * as THREE from 'three';
import type { SiteLineKind, SiteLinePoint } from '@/db/schema/site';
import type { EditorItem, EditorPlot } from '@/lib/site/editor/model';
import { SITE_KINDS, type SiteKindGroup } from '@/lib/site/kinds';
import { SCENE_ALPHA, SCENE_PALETTE, type SceneTheme } from './palette';

/**
 * One builder per shape (spec §7), in three's units. The map is centimetres
 * with x east, y south and z up; three is metres with y up. So a map point
 * (x, y, z) is three's (x, z, y) · 0.01: east stays +X, up is +Y, south is
 * +Z. That swap of two axes is also what turns the map's left-handed axes
 * into three's right-handed ones, so nothing is mirrored.
 *
 * Every item is a `THREE.Group` whose origin is its north-west corner on the
 * ground. Moving an item moves the group; only a change of shape, size or
 * height rebuilds it (`geometryKey`). Parts carry `userData.part` so a
 * restyle finds them without rebuilding, and `userData.pick === false` on the
 * parts a click must go through (ground patches, the shadow caster).
 */

export const CM = 0.01;

export function worldOf(xCm: number, yCm: number, zCm: number): THREE.Vector3 {
  return new THREE.Vector3(xCm * CM, zCm * CM, yCm * CM);
}

/**
 * The same axis swap as `worldOf`, for a direction rather than a position:
 * map x east, y south, z up → three (x, z, y), unscaled. Later tasks (the
 * camera rig, lighting) import this instead of re-writing the swap.
 */
export function directionOf([x, y, z]: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(x, z, y);
}

export interface ItemLook {
  theme: SceneTheme;
  state: 'normal' | 'hover' | 'selected';
  issue: 'none' | 'outside' | 'overlapping';
  /** Shade by hour is on: real shadows replace the drawn patches. */
  sun?: boolean;
}

type Part = 'body' | 'edge' | 'ember' | 'pole' | 'cloth' | 'clothEdge' | 'inset' | 'caster' | 'patch' | 'contact'
  | 'lineBody' | 'lineJoint' | 'rope' | 'stake' | 'ropeEdge';
type Point = [number, number, number];

/**
 * What decides the geometry. Position is not in it: a move never rebuilds.
 * A net's ropes are (spec §14): a new angle, or a new height under an angle,
 * rebuilds the net.
 */
export function geometryKey(item: EditorItem, heightCm: number, ropeCm = 0): string {
  const inset = SITE_KINDS[item.kind].shape === 'net' ? item.insetCm ?? 0 : 0;
  return `${item.kind}:${item.widthCm}x${item.depthCm}x${heightCm}:${inset}:${ropeCm}`;
}

function tag<T extends THREE.Object3D>(object: T, part: Part, pick = true): T {
  object.userData.part = part;
  if (!pick) object.userData.pick = false;
  return object;
}

function edgesOf(geometry: THREE.BufferGeometry): THREE.LineSegments {
  return tag(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20), new THREE.LineBasicMaterial()), 'edge', false);
}

function solid(geometry: THREE.BufferGeometry, at: THREE.Vector3): THREE.Mesh {
  const mesh = tag(new THREE.Mesh(geometry, new THREE.MeshLambertMaterial()), 'body');
  mesh.position.copy(at);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.add(edgesOf(geometry));
  return mesh;
}

function box(w: number, h: number, d: number, x0: number, z0: number): THREE.Mesh {
  return solid(new THREE.BoxGeometry(w, h, d), new THREE.Vector3(x0 + w / 2, h / 2, z0 + d / 2));
}

/**
 * A convex solid from its faces. Each face is turned to face away from the
 * solid's middle, so the winding three draws by never depends on the order
 * the points were written in.
 */
function convexGeometry(faces: Point[][]): THREE.BufferGeometry {
  const all = faces.flat();
  const centre = all.reduce<Point>((s, p) => [s[0] + p[0] / all.length, s[1] + p[1] / all.length, s[2] + p[2] / all.length], [0, 0, 0]);
  const positions: number[] = [];
  for (const face of faces) {
    const [a, b, c] = face;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const mid = face.reduce<Point>((s, p) => [s[0] + p[0] / face.length, s[1] + p[1] / face.length, s[2] + p[2] / face.length], [0, 0, 0]);
    const outward = n[0] * (mid[0] - centre[0]) + n[1] * (mid[1] - centre[1]) + n[2] * (mid[2] - centre[2]) >= 0;
    const ordered = outward ? face : [...face].reverse();
    for (let i = 1; i + 1 < ordered.length; i += 1) positions.push(...ordered[0], ...ordered[i], ...ordered[i + 1]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Walls to half the height, then a gable roof whose ridge runs along the longer side. */
function tentGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const eave = h * 0.5;
  if (w >= d) {
    const m = d / 2;
    return convexGeometry([
      [[0, 0, d], [w, 0, d], [w, eave, d], [0, eave, d]],
      [[0, 0, 0], [w, 0, 0], [w, eave, 0], [0, eave, 0]],
      [[0, 0, 0], [0, 0, d], [0, eave, d], [0, h, m], [0, eave, 0]],
      [[w, 0, 0], [w, 0, d], [w, eave, d], [w, h, m], [w, eave, 0]],
      [[0, eave, 0], [w, eave, 0], [w, h, m], [0, h, m]],
      [[0, eave, d], [w, eave, d], [w, h, m], [0, h, m]],
    ]);
  }
  const m = w / 2;
  return convexGeometry([
    [[w, 0, 0], [w, 0, d], [w, eave, d], [w, eave, 0]],
    [[0, 0, 0], [0, 0, d], [0, eave, d], [0, eave, 0]],
    [[0, 0, 0], [w, 0, 0], [w, eave, 0], [m, h, 0], [0, eave, 0]],
    [[0, 0, d], [w, 0, d], [w, eave, d], [m, h, d], [0, eave, d]],
    [[0, eave, 0], [0, eave, d], [m, h, d], [m, h, 0]],
    [[w, eave, 0], [w, eave, d], [m, h, d], [m, h, 0]],
  ]);
}

function cylinder(w: number, h: number, d: number): THREE.Mesh {
  const mesh = solid(new THREE.CylinderGeometry(w / 2, w / 2, h, 24), new THREE.Vector3(w / 2, h / 2, d / 2));
  mesh.scale.set(1, 1, d / w);
  return mesh;
}

/** A flat rectangle lying on (or floating above) the ground, facing up. */
function flat(w: number, d: number, x: number, y: number, z: number, material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(w, d);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  return mesh;
}

function outline(x0: number, z0: number, x1: number, z1: number, y: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0,
  ], 3));
  return geometry;
}

/** Four poles and a see-through cloth at the net's height; the unshaded strip dashed on it. */
function net(group: THREE.Group, w: number, h: number, d: number, insetM: number): void {
  const pole = new THREE.CylinderGeometry(0.04, 0.04, h, 6);
  const poleMaterial = new THREE.MeshLambertMaterial();
  for (const [x, z] of [[0.04, 0.04], [w - 0.04, 0.04], [w - 0.04, d - 0.04], [0.04, d - 0.04]]) {
    const mesh = tag(new THREE.Mesh(pole, poleMaterial), 'pole');
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    group.add(mesh);
  }

  const cloth = tag(flat(w, d, w / 2, h, d / 2, new THREE.MeshLambertMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  })), 'cloth');
  group.add(cloth);
  group.add(tag(new THREE.LineSegments(outline(0, 0, w, d, h), new THREE.LineBasicMaterial()), 'clothEdge', false));

  const sw = w - insetM * 2;
  const sd = d - insetM * 2;
  if (sw <= 0 || sd <= 0) return;
  if (insetM > 0) {
    const inset = tag(new THREE.LineSegments(
      outline(insetM, insetM, w - insetM, d - insetM, h + 0.005),
      new THREE.LineDashedMaterial({ dashSize: 0.15, gapSize: 0.12 }),
    ), 'inset', false);
    inset.computeLineDistances();
    group.add(inset);
  }
  /* What actually shades: invisible, but it casts the sun's shadow. The
     cloth itself does not, so the sag strip stays sunny, as §11 counts it.
     A one-sided plane lit from above casts no shadow in three r186 (its
     depth pass back-face-culls the material's single side), so both faces
     are made eligible for the shadow map. */
  const caster = tag(flat(sw, sd, w / 2, h, d / 2, new THREE.MeshBasicMaterial({
    colorWrite: false, depthWrite: false, shadowSide: THREE.DoubleSide,
  })), 'caster', false);
  caster.castShadow = true;
  group.add(caster);
  /* Where the shade falls when the sun is not being modelled. */
  const patch = tag(flat(sw, sd, w / 2, 0.003, d / 2, new THREE.MeshBasicMaterial({ depthWrite: false })), 'patch', false);
  patch.renderOrder = -3;
  group.add(patch);
}

/**
 * A net's ropes (spec §15): from the top of each corner pole, two ropes to
 * stakes `r` metres out, each at right angles to one of the corner's sides —
 * the layout that keeps the footprint a rectangle — a 3 cm peg standing
 * 15 cm out of the ground at each stake, and the footprint dashed on the
 * ground. Seen from above in plan, the eight ropes are short strokes out
 * from the corners. All of it is click-through and casts no shadow: ropes
 * take ground, they do not shade it (D8).
 */
function ropes(group: THREE.Group, w: number, h: number, d: number, r: number): void {
  // Each corner, and the outward direction of its west/east side (x) and of its north/south side (z).
  const corners: Array<[number, number, number, number]> = [[0, 0, -1, -1], [w, 0, 1, -1], [w, d, 1, 1], [0, d, -1, 1]];
  const points: number[] = [];
  const stakes: Array<[number, number]> = [];
  for (const [x, z, outX, outZ] of corners) {
    stakes.push([x + outX * r, z], [x, z + outZ * r]);
    points.push(x, h, z, x + outX * r, 0, z, x, h, z, x, 0, z + outZ * r);
  }
  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  group.add(tag(new THREE.LineSegments(lines, new THREE.LineBasicMaterial()), 'rope', false));

  const peg = new THREE.CylinderGeometry(0.015, 0.015, 0.15, 6);
  const pegMaterial = new THREE.MeshLambertMaterial();
  for (const [x, z] of stakes) {
    const stake = tag(new THREE.Mesh(peg, pegMaterial), 'stake', false);
    stake.position.set(x, 0.075, z);
    group.add(stake);
  }

  const edge = tag(new THREE.LineSegments(
    outline(-r, -r, w + r, d + r, 0.004),
    new THREE.LineDashedMaterial({ dashSize: 0.3, gapSize: 0.2 }),
  ), 'ropeEdge', false);
  edge.computeLineDistances();
  group.add(edge);
}

export function buildItemObject(item: EditorItem, heightCm: number, look: ItemLook, ropeCm = 0): THREE.Group {
  const preset = SITE_KINDS[item.kind];
  const w = item.widthCm * CM;
  const d = item.depthCm * CM;
  const h = Math.max(1, heightCm) * CM;
  const group = new THREE.Group();
  group.name = item.id;
  group.userData = {
    id: item.id, isNet: preset.shape === 'net', key: geometryKey(item, heightCm, ropeCm),
    kind: item.kind, group: preset.group,
  };

  switch (preset.shape) {
    case 'sofa': {
      group.add(box(w, h * 0.5, d, 0, 0));
      // The back stands on the north edge, or the west one when the sofa is turned.
      group.add(w >= d ? box(w, h, Math.max(0.15, d * 0.26), 0, 0) : box(Math.max(0.15, w * 0.26), h, d, 0, 0));
      break;
    }
    case 'tent':
      group.add(solid(tentGeometry(w, h, d), new THREE.Vector3(0, 0, 0)));
      break;
    case 'cylinder':
      group.add(cylinder(w, h, d));
      break;
    case 'fire': {
      group.add(cylinder(w, h, d));
      const top = tag(new THREE.Mesh(new THREE.CylinderGeometry(w * 0.38, w * 0.38, 0.01, 24), new THREE.MeshBasicMaterial()), 'ember');
      top.position.set(w / 2, h + 0.005, d / 2);
      top.scale.set(1, 1, d / w);
      group.add(top);
      break;
    }
    case 'net':
      net(group, w, h, d, (item.insetCm ?? 0) * CM);
      if (ropeCm > 0) ropes(group, w, h, d, ropeCm * CM);
      break;
    default:
      group.add(box(w, h, d, 0, 0));
  }

  if (preset.shape !== 'net') {
    const contact = tag(flat(w + 0.2, d + 0.2, w / 2 + 0.08, 0.002, d / 2 + 0.1, new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false,
    })), 'contact', false);
    group.add(contact);
  }

  group.position.copy(worldOf(item.xCm, item.yCm, 0));
  restyleItemObject(group, look);
  return group;
}

function bodyColour(group: SiteKindGroup, look: ItemLook): THREE.Color {
  const palette = SCENE_PALETTE[look.theme];
  const colour = new THREE.Color(palette.groups[group]);
  if (look.issue === 'outside') colour.lerp(new THREE.Color(palette.bad), 0.34);
  else if (look.issue === 'overlapping') colour.lerp(new THREE.Color(palette.warn), 0.34);
  if (look.state === 'selected') colour.lerp(new THREE.Color(palette.selected), 0.25);
  else if (look.state === 'hover') colour.lerp(new THREE.Color(palette.hover), look.theme === 'dark' ? 0.08 : 0.2);
  return colour;
}

function lineColour(look: ItemLook): string {
  const palette = SCENE_PALETTE[look.theme];
  if (look.state === 'selected') return palette.selected;
  if (look.issue === 'outside') return palette.bad;
  if (look.issue === 'overlapping') return palette.warn;
  return palette.edge;
}

/** Colours only: selection, hover, problems, theme and the sun never rebuild geometry. */
export function restyleItemObject(object: THREE.Group, look: ItemLook): void {
  const palette = SCENE_PALETTE[look.theme];
  const alpha = SCENE_ALPHA[look.theme];
  const group = object.userData.group as SiteKindGroup;
  object.traverse((child) => {
    const part = child.userData.part as Part | undefined;
    if (part === undefined) return;
    const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial | THREE.MeshLambertMaterial | THREE.LineBasicMaterial;
    switch (part) {
      case 'body': material.color.copy(bodyColour(group, look)); break;
      case 'edge': material.color.set(lineColour(look)); break;
      case 'ember': material.color.set(palette.ember); break;
      case 'pole': material.color.set(palette.fence); break;
      case 'cloth':
        material.color.set(look.state === 'selected' ? palette.selected : palette.cloth);
        material.opacity = look.state === 'selected' ? alpha.cloth + 0.06 : alpha.cloth;
        break;
      case 'clothEdge':
        material.color.set(look.state === 'hover' ? palette.edge : look.state === 'normal' && look.issue === 'none' ? palette.clothEdge : lineColour(look));
        break;
      case 'inset': material.color.set(palette.clothEdge); break;
      case 'rope':
      case 'stake':
        material.color.set(palette.fence);
        break;
      case 'ropeEdge':
        // Red when the footprint crosses the fence: a net is outside by its ropes (D8).
        material.color.set(look.issue === 'outside' ? palette.bad : palette.clothEdge);
        break;
      case 'patch':
        material.color.set(palette.shadeGround);
        child.visible = look.sun !== true;
        break;
      case 'contact':
        material.color.set(palette.contact);
        material.opacity = alpha.contact;
        child.visible = look.sun !== true;
        break;
      case 'caster': break;
    }
  });
}

/* ── the pipes and cables ─────────────────────────────────────────────── */

/** A run's width and height on the ground, in metres: wide enough to see and to click at the plot's zoom, low enough to be a hose. */
const LINE_WIDTH = 0.12;
const LINE_HEIGHT = 0.05;

export interface LineLook {
  theme: SceneTheme;
  state: 'normal' | 'hover' | 'selected';
}

/** What decides a line's geometry: its kind and every point of its path. A moved end or a moved bend rebuilds it. */
export function lineGeometryKey(kind: SiteLineKind, path: readonly SiteLinePoint[]): string {
  return `${kind}:${path.map((p) => `${p[0]},${p[1]}`).join(';')}`;
}

/**
 * A pipe or a cable as it lies on the ground: one low box per leg of its
 * path, turned to run along the leg, and a short round joint at every point
 * of the path — the ends included, where the run meets the item's wall.
 * Every part is a solid the raycaster can hit, so a click on a run selects
 * it (`picking.ts`). Origin is the map's origin: the path is in world
 * coordinates, so a move of either end is a rebuild, never a reposition.
 */
export function buildLineObject(line: { id: string; kind: SiteLineKind }, path: readonly SiteLinePoint[], look: LineLook): THREE.Group {
  const group = new THREE.Group();
  group.name = line.id;
  group.userData = { id: line.id, isLine: true, kind: line.kind, key: lineGeometryKey(line.kind, path) };
  const material = new THREE.MeshLambertMaterial();
  const joint = new THREE.CylinderGeometry(LINE_WIDTH * 0.9, LINE_WIDTH * 0.9, LINE_HEIGHT * 1.4, 12);
  for (let i = 0; i < path.length; i += 1) {
    const at = worldOf(path[i][0], path[i][1], 0);
    const cap = tag(new THREE.Mesh(joint, material), 'lineJoint');
    cap.position.set(at.x, LINE_HEIGHT * 0.7, at.z);
    cap.castShadow = true;
    group.add(cap);
    if (i === 0) continue;
    const from = worldOf(path[i - 1][0], path[i - 1][1], 0);
    const dx = at.x - from.x;
    const dz = at.z - from.z;
    const length = Math.hypot(dx, dz);
    if (length === 0) continue;
    const leg = tag(new THREE.Mesh(new THREE.BoxGeometry(length, LINE_HEIGHT, LINE_WIDTH), material), 'lineBody');
    leg.position.set((from.x + at.x) / 2, LINE_HEIGHT / 2, (from.z + at.z) / 2);
    // A box along +X turned about +Y by θ points at (cos θ, 0, −sin θ).
    leg.rotation.y = Math.atan2(-dz, dx);
    leg.castShadow = true;
    leg.receiveShadow = true;
    group.add(leg);
  }
  restyleLineObject(group, look);
  return group;
}

/** Colour only: hover, selection and theme never rebuild a run. */
export function restyleLineObject(object: THREE.Group, look: LineLook): void {
  const palette = SCENE_PALETTE[look.theme];
  const kind = object.userData.kind as SiteLineKind;
  const colour = new THREE.Color(palette.lines[kind]);
  if (look.state === 'selected') colour.lerp(new THREE.Color(palette.selected), 0.45);
  else if (look.state === 'hover') colour.lerp(new THREE.Color(palette.hover), look.theme === 'dark' ? 0.12 : 0.25);
  object.traverse((child) => {
    const part = child.userData.part as Part | undefined;
    if (part !== 'lineBody' && part !== 'lineJoint') return;
    ((child as THREE.Mesh).material as THREE.MeshLambertMaterial).color.copy(colour);
  });
}

/** The plot, the ground around it, the grid (minor and every five metres) and the dashed fence. */
export function buildGround(plot: EditorPlot, theme: SceneTheme): THREE.Group {
  const palette = SCENE_PALETTE[theme];
  const w = plot.widthCm * CM;
  const d = plot.depthCm * CM;
  const ground = new THREE.Group();
  ground.name = 'ground';

  const layer = <T extends THREE.Object3D>(object: T, name: string, order: number): T => {
    object.name = name;
    object.renderOrder = order;
    object.userData.pick = false;
    ground.add(object);
    return object;
  };
  /* The ground never hides anything — everything stands on it — so it writes
     no depth and is drawn first, in this order, and nothing on it flickers. */
  const surface = (colour: string) => new THREE.MeshLambertMaterial({ color: colour, depthWrite: false });

  const margin = 200;
  layer(flat(w + margin, d + margin, w / 2, 0, d / 2, surface(palette.outside)), 'outside', -5).receiveShadow = true;
  layer(flat(w, d, w / 2, 0, d / 2, surface(palette.plot)), 'plot', -4).receiveShadow = true;

  const lines = (stepCm: number): THREE.BufferGeometry => {
    const points: number[] = [];
    for (let x = 0; x <= plot.widthCm; x += stepCm) points.push(x * CM, 0, 0, x * CM, 0, d);
    for (let y = 0; y <= plot.depthCm; y += stepCm) points.push(0, 0, y * CM, w, 0, y * CM);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return geometry;
  };
  const lineMaterial = (colour: string) => new THREE.LineBasicMaterial({ color: colour, depthWrite: false });
  const minorCount = plot.gridCm > 0 ? (plot.widthCm + plot.depthCm) / plot.gridCm : Infinity;
  if (minorCount <= 2000) layer(new THREE.LineSegments(lines(plot.gridCm), lineMaterial(palette.gridMinor)), 'gridMinor', -2);
  layer(new THREE.LineSegments(lines(500), lineMaterial(palette.gridMajor)), 'gridMajor', -1.5);

  const fence = layer(new THREE.LineSegments(outline(0, 0, w, d, 0), new THREE.LineDashedMaterial({
    color: palette.fence, dashSize: 0.35, gapSize: 0.25, depthWrite: false,
  })), 'fence', -1);
  fence.computeLineDistances();
  return ground;
}

/** Frees every geometry and material under `object`, each once. */
export function disposeObject(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    const drawable = child as THREE.Mesh;
    if (drawable.geometry instanceof THREE.BufferGeometry) geometries.add(drawable.geometry);
    const material = drawable.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((entry) => materials.add(entry));
    else if (material instanceof THREE.Material) materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}
