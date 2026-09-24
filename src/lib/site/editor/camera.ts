import type { Plot, Rect } from '../geometry';

/**
 * The camera's arithmetic, with no `three` in it (spec §3, §7). The adapter
 * (`scene/camera-rig.ts`) turns a `CameraFrame` into a `three` camera; every
 * other question — where a map point lands on screen, which ground point is
 * under the cursor, how to frame a rectangle — is answered here, so it can be
 * tested with numbers worked out on paper.
 *
 * Map coordinates: centimetres, x east, y south, z up. Angles in degrees.
 * The camera orbits `target` on the ground: `yaw` 0 looks north, so north is
 * at the top of the screen; yaw 90 looks west. `pitch` is the angle down
 * from the horizon. Plan mode looks straight down through an orthographic
 * camera whose half-height is `distance · tan(FOV / 2)`: at the target it
 * shows the same scale as the 3D view, so switching views does not jump.
 *
 * Screen coordinates are CSS pixels from the viewport's top-left corner.
 */

export type ViewMode = 'plan' | '3d';
export type Vec3 = [number, number, number];

export interface CameraState {
  targetX: number;
  targetY: number;
  distance: number;
  yaw: number;
  pitch: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface ScreenBox {
  l: number;
  t: number;
  r: number;
  b: number;
}

export const FOV_DEG = 30, PITCH_MIN = 18, PITCH_MAX = 89, DISTANCE_MIN = 250, DISTANCE_MAX = 40_000;

export interface CameraFrame {
  eye: Vec3;
  target: Vec3;
  /** Unit vectors in map coordinates: screen right, screen up, and the way the camera looks. */
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  /** Pixels per unit of `tan(angle)` off the view axis: (viewport height / 2) / tan(FOV / 2). */
  focalPx: number;
  /** Plan mode's frustum half-height, in centimetres. */
  orthoHalfHeight: number;
}

const RAD = Math.PI / 180;
const HALF_FOV_TAN = Math.tan((FOV_DEG / 2) * RAD);
/** Nearer than this in front of the eye, a point is not drawn. */
const NEAR_CM = 1;
/** Framing in 3D keeps this much height above the ground in view, so a caravan's roof is not cut off. */
const FIT_HEIGHT_CM = 300;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Degrees in [0, 360). */
function wrapYaw(yaw: number): number {
  const wrapped = yaw % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped + 0;
}

function focalPx(viewport: Viewport): number {
  return Math.max(1, viewport.height) / 2 / HALF_FOV_TAN;
}

/** The direction, in map coordinates, that screen point (sx, sy) looks — not normalised. */
function rayThrough(frame: CameraFrame, viewport: Viewport, sx: number, sy: number): Vec3 {
  const across = (sx - viewport.width / 2) / frame.focalPx;
  const upward = -(sy - viewport.height / 2) / frame.focalPx;
  return [
    frame.forward[0] + across * frame.right[0] + upward * frame.up[0],
    frame.forward[1] + across * frame.right[1] + upward * frame.up[1],
    frame.forward[2] + across * frame.right[2] + upward * frame.up[2],
  ];
}

export function cameraFrame(state: CameraState, viewport: Viewport, mode: ViewMode): CameraFrame {
  const yaw = state.yaw * RAD;
  // Plan mode is exactly straight down, not cos(90°) ≈ 6e-17 off it.
  const cosPitch = mode === 'plan' ? 0 : Math.cos(state.pitch * RAD);
  const sinPitch = mode === 'plan' ? 1 : Math.sin(state.pitch * RAD);
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  const d = state.distance;
  return {
    eye: [state.targetX + d * cosPitch * sinYaw, state.targetY + d * cosPitch * cosYaw, d * sinPitch],
    target: [state.targetX, state.targetY, 0],
    right: [cosYaw, -sinYaw, 0],
    up: [-sinPitch * sinYaw, -sinPitch * cosYaw, cosPitch],
    forward: [-cosPitch * sinYaw, -cosPitch * cosYaw, -sinPitch],
    focalPx: focalPx(viewport),
    orthoHalfHeight: d * HALF_FOV_TAN,
  };
}

/**
 * Where a map point lands on screen, and how far in front of the eye it is.
 * Null in 3D for a point behind the eye. Plan mode never answers null: an
 * orthographic view sees everything under it, and the rig places its near
 * plane accordingly.
 */
export function project(
  state: CameraState, viewport: Viewport, mode: ViewMode, point: Vec3,
): { x: number; y: number; depth: number } | null {
  const frame = cameraFrame(state, viewport, mode);
  const v: Vec3 = [point[0] - frame.eye[0], point[1] - frame.eye[1], point[2] - frame.eye[2]];
  const depth = dot(v, frame.forward);
  if (mode === '3d' && depth <= NEAR_CM) return null;
  const scale = frame.focalPx / (mode === 'plan' ? state.distance : depth);
  return {
    x: viewport.width / 2 + dot(v, frame.right) * scale,
    y: viewport.height / 2 - dot(v, frame.up) * scale,
    depth,
  };
}

/**
 * The map point at height `planeZ` under a screen point: the drag point, the
 * cursor's ground. Null in 3D when the ray through that pixel never comes
 * down to the plane (above the horizon).
 */
export function groundAt(
  state: CameraState, viewport: Viewport, mode: ViewMode, sx: number, sy: number, planeZ = 0,
): [number, number] | null {
  const frame = cameraFrame(state, viewport, mode);
  if (mode === 'plan') {
    // Every pixel looks straight down from its own point, so the height does not matter.
    const across = (sx - viewport.width / 2) / frame.focalPx;
    const upward = -(sy - viewport.height / 2) / frame.focalPx;
    const d = state.distance;
    return [
      frame.target[0] + (across * frame.right[0] + upward * frame.up[0]) * d,
      frame.target[1] + (across * frame.right[1] + upward * frame.up[1]) * d,
    ];
  }
  const ray = rayThrough(frame, viewport, sx, sy);
  const t = (planeZ - frame.eye[2]) / ray[2];
  if (!Number.isFinite(t) || t <= 0) return null;
  return [frame.eye[0] + t * ray[0], frame.eye[1] + t * ray[1]];
}

/** Zoom by `factor` (under 1 is closer) keeping the ground under the cursor under the cursor. */
export function zoomAt(
  state: CameraState, viewport: Viewport, mode: ViewMode, sx: number, sy: number, factor: number,
): CameraState {
  const next = { ...state, distance: clamp(state.distance * factor, DISTANCE_MIN, DISTANCE_MAX) };
  const before = groundAt(state, viewport, mode, sx, sy);
  const after = groundAt(next, viewport, mode, sx, sy);
  if (before === null || after === null) return next;
  return panBy(next, before[0] - after[0], before[1] - after[1]);
}

export function panBy(state: CameraState, dxCm: number, dyCm: number): CameraState {
  return { ...state, targetX: state.targetX + dxCm, targetY: state.targetY + dyCm };
}

export function orbit(state: CameraState, dYaw: number, dPitch: number): CameraState {
  return { ...state, yaw: wrapYaw(state.yaw + dYaw), pitch: clamp(state.pitch + dPitch, PITCH_MIN, PITCH_MAX) };
}

function cornersOf(rect: Rect, mode: ViewMode): Vec3[] {
  const heights = mode === '3d' ? [0, FIT_HEIGHT_CM] : [0];
  const points: Vec3[] = [];
  for (const [x, y] of [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.depth], [rect.x + rect.width, rect.y + rect.depth]]) {
    for (const z of heights) points.push([x, y, z]);
  }
  return points;
}

function screenBoxOf(state: CameraState, viewport: Viewport, mode: ViewMode, points: readonly Vec3[]): ScreenBox | null {
  const box = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
  for (const point of points) {
    const at = project(state, viewport, mode, point);
    if (at === null) return null;
    box.l = Math.min(box.l, at.x); box.r = Math.max(box.r, at.x);
    box.t = Math.min(box.t, at.y); box.b = Math.max(box.b, at.y);
  }
  return box;
}

/** Plan mode frames exactly: the scale is the tighter of the two fits, and the middle goes to the safe box's middle. */
function fitPlan(rect: Rect, yaw: number, pitch: number, viewport: Viewport, safe: ScreenBox): CameraState {
  const cos = Math.abs(Math.cos(yaw * RAD));
  const sin = Math.abs(Math.sin(yaw * RAD));
  const across = rect.width * cos + rect.depth * sin;
  const upward = rect.width * sin + rect.depth * cos;
  const scale = Math.min((safe.r - safe.l) / Math.max(across, 1), (safe.b - safe.t) / Math.max(upward, 1));
  const middle: CameraState = {
    targetX: rect.x + rect.width / 2,
    targetY: rect.y + rect.depth / 2,
    distance: clamp(focalPx(viewport) / scale, DISTANCE_MIN, DISTANCE_MAX),
    yaw,
    pitch,
  };
  // With the rect's middle at the screen's middle, the ground under the safe
  // box's middle is off by some vector; moving the target back by it puts the
  // rect's middle there instead.
  const [gx, gy] = groundAt(middle, viewport, 'plan', (safe.l + safe.r) / 2, (safe.t + safe.b) / 2) as [number, number];
  return panBy(middle, middle.targetX - gx, middle.targetY - gy);
}

/**
 * The camera at this distance, yaw and pitch that shows `anchor` exactly at
 * screen point (sx, sy). The eye sits on the ray back from the anchor through
 * that pixel, at the height the distance and pitch give it.
 */
function aimedAt(
  anchor: Vec3, sx: number, sy: number, distance: number, yaw: number, pitch: number, viewport: Viewport,
): CameraState {
  const origin: CameraState = { targetX: 0, targetY: 0, distance, yaw, pitch };
  const frame = cameraFrame(origin, viewport, '3d');
  const ray = rayThrough(frame, viewport, sx, sy);
  // The eye is `anchor - t · ray`, and its height is frame.eye[2] whatever the target.
  const t = (anchor[2] - frame.eye[2]) / ray[2];
  return {
    ...origin,
    targetX: anchor[0] - t * ray[0] - frame.eye[0],
    targetY: anchor[1] - t * ray[1] - frame.eye[1],
  };
}

/**
 * 3D has no closed form: perspective draws the near half of a rectangle
 * larger than the far half. So the rect's middle is pinned to a screen point,
 * the nearest distance that keeps every corner and roof inside the safe box
 * is found by halving, and the pin is then moved by however far the drawn box
 * sits off the safe box's middle, a few times over. Every answer comes out of
 * the containment search, so "fit" is a promise, not an approximation.
 */
function fitPerspective(rect: Rect, yaw: number, pitch: number, viewport: Viewport, safe: ScreenBox): CameraState {
  const points = cornersOf(rect, '3d');
  const anchor: Vec3 = [rect.x + rect.width / 2, rect.y + rect.depth / 2, FIT_HEIGHT_CM / 2];
  const middle: [number, number] = [(safe.l + safe.r) / 2, (safe.t + safe.b) / 2];
  const inside = (state: CameraState) => {
    const box = screenBoxOf(state, viewport, '3d', points);
    return box !== null && box.l >= safe.l && box.r <= safe.r && box.t >= safe.t && box.b <= safe.b;
  };
  let pin = middle;
  let state = aimedAt(anchor, pin[0], pin[1], DISTANCE_MAX, yaw, pitch, viewport);
  for (let pass = 0; pass < 8; pass += 1) {
    const at = (distance: number) => aimedAt(anchor, pin[0], pin[1], distance, yaw, pitch, viewport);
    let near = DISTANCE_MIN;
    let far = DISTANCE_MAX;
    if (inside(at(near))) {
      far = near;
    } else if (inside(at(far))) {
      for (let step = 0; step < 40; step += 1) {
        const mid = (near + far) / 2;
        if (inside(at(mid))) far = mid; else near = mid;
      }
    }
    state = at(far);
    const box = screenBoxOf(state, viewport, '3d', points);
    if (box === null) break;
    pin = [pin[0] + middle[0] - (box.l + box.r) / 2, pin[1] + middle[1] - (box.t + box.b) / 2];
  }
  return state;
}

/**
 * The view that shows `rect` as large as it fits inside `safe` — the part of
 * the viewport the floating panels leave free — at the given yaw and pitch.
 * `null` means the whole plot, which is what an empty map, or a map whose
 * items all ended up outside a shrunken plot, frames. A rect outside the
 * plot is framed where it is; fitting never pulls the view back to the plot.
 */
export function fitRect(
  rect: Rect | null, yaw: number, pitch: number, viewport: Viewport, mode: ViewMode,
  safe: ScreenBox, plot: Plot,
): CameraState {
  const frame = rect ?? { x: 0, y: 0, width: plot.widthCm, depth: plot.depthCm };
  const usable = safe.r - safe.l >= 1 && safe.b - safe.t >= 1
    ? safe
    : { l: 0, t: 0, r: viewport.width, b: viewport.height };
  const tilt = clamp(pitch, PITCH_MIN, PITCH_MAX);
  return mode === 'plan'
    ? fitPlan(frame, wrapYaw(yaw), tilt, viewport, usable)
    : fitPerspective(frame, wrapYaw(yaw), tilt, viewport, usable);
}

/**
 * The camera `t` of the way from `a` to `b`: the target and pitch in a
 * straight line, the yaw the short way round, the distance evenly in
 * log — so a fly-in from far away does not rush the last metre.
 */
export function interpolate(a: CameraState, b: CameraState, t: number): CameraState {
  const turn = ((((b.yaw - a.yaw) % 360) + 540) % 360) - 180;
  return {
    targetX: a.targetX + (b.targetX - a.targetX) * t,
    targetY: a.targetY + (b.targetY - a.targetY) * t,
    distance: a.distance * (b.distance / a.distance) ** t,
    yaw: wrapYaw(a.yaw + turn * t),
    pitch: a.pitch + (b.pitch - a.pitch) * t,
  };
}

/**
 * An arrow key as one step on the map, relative to the screen (spec §8): up
 * is away from the viewer, whichever way the view is turned. The answer is
 * the map axis nearest that direction, so a nudge always moves along the grid.
 */
export function screenArrowToMap(
  yaw: number, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
): [number, number] {
  const across = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
  const away = key === 'ArrowUp' ? 1 : key === 'ArrowDown' ? -1 : 0;
  const sin = Math.sin(yaw * RAD);
  const cos = Math.cos(yaw * RAD);
  // On the ground, screen right is (cos, -sin) and away from the viewer is (-sin, -cos).
  const x = across * cos - away * sin;
  const y = -across * sin - away * cos;
  return Math.abs(x) >= Math.abs(y) ? [Math.sign(x), 0] : [0, Math.sign(y)];
}

/** Pixels per centimetre at the target: the scale bar's and the zoom level's number, the same in both views. */
export function pxPerCm(state: CameraState, viewport: Viewport): number {
  return focalPx(viewport) / state.distance;
}
