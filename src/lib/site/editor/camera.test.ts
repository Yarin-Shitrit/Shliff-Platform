import { describe, it, expect } from 'vitest';
import {
  DISTANCE_MAX, DISTANCE_MIN, PITCH_MAX, PITCH_MIN, cameraFrame, fitRect, groundAt, interpolate, orbit, panBy,
  project, pxPerCm, screenArrowToMap, zoomAt, type CameraState, type ScreenBox, type Vec3, type ViewMode,
  type Viewport,
} from './camera';

const VIEW: Viewport = { width: 1000, height: 800 };
/**
 * tan 15° = 2 − √3, so the focal length on an 800 px tall viewport is
 * 400 / (2 − √3) = 400 · (2 + √3) ≈ 1492.82 px. At that distance one
 * centimetre at the target is one pixel.
 */
const ONE_PX_PER_CM = 400 * (2 + Math.sqrt(3));
const PLOT = { widthCm: 2600, depthCm: 2400 };

function state(over: Partial<CameraState> = {}): CameraState {
  return { targetX: 1300, targetY: 1200, distance: ONE_PX_PER_CM, yaw: 0, pitch: 50, ...over };
}

function expectClose(actual: readonly number[] | null, expected: readonly number[], digits = 6): void {
  expect(actual).not.toBeNull();
  expected.forEach((value, index) => expect(actual![index]).toBeCloseTo(value, digits));
}

function screenBox(camera: CameraState, mode: ViewMode, points: readonly Vec3[]): ScreenBox {
  const box = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
  for (const point of points) {
    const at = project(camera, VIEW, mode, point);
    if (at === null) throw new Error('a framed point is behind the camera');
    box.l = Math.min(box.l, at.x); box.r = Math.max(box.r, at.x);
    box.t = Math.min(box.t, at.y); box.b = Math.max(box.b, at.y);
  }
  return box;
}

function cornersOf(rect: { x: number; y: number; width: number; depth: number }, z = 0): Vec3[] {
  return [
    [rect.x, rect.y, z], [rect.x + rect.width, rect.y, z],
    [rect.x, rect.y + rect.depth, z], [rect.x + rect.width, rect.y + rect.depth, z],
  ];
}

describe('the camera frame', () => {
  it('looks straight down in plan, north up, east right', () => {
    const frame = cameraFrame(state({ distance: 4000 }), VIEW, 'plan');
    expectClose(frame.eye, [1300, 1200, 4000]);
    expectClose(frame.right, [1, 0, 0]);
    expectClose(frame.up, [0, -1, 0]);
    expectClose(frame.forward, [0, 0, -1]);
    expect(frame.focalPx).toBeCloseTo(ONE_PX_PER_CM, 9);
    expect(frame.orthoHalfHeight).toBeCloseTo(4000 * (2 - Math.sqrt(3)), 9);
  });

  it('stands south of the target at yaw 0 in 3D, looking north and down', () => {
    // pitch 60: the eye is distance · cos 60 = 500 south and distance · sin 60 above.
    const frame = cameraFrame(state({ distance: 1000, pitch: 60 }), VIEW, '3d');
    expectClose(frame.eye, [1300, 1700, 1000 * Math.sin(Math.PI / 3)]);
    expectClose(frame.forward, [0, -0.5, -Math.sin(Math.PI / 3)]);
  });
});

describe('projecting', () => {
  it('draws plan mode at one pixel per centimetre at this distance, north up', () => {
    const camera = state();
    expectClose(xy(project(camera, VIEW, 'plan', [1400, 1200, 0])), [600, 400]);
    expectClose(xy(project(camera, VIEW, 'plan', [1300, 1100, 0])), [500, 300]);
  });

  it('ignores the pitch in plan mode', () => {
    expect(project(state({ pitch: 30 }), VIEW, 'plan', [1400, 1150, 90]))
      .toEqual(project(state({ pitch: 89 }), VIEW, 'plan', [1400, 1150, 90]));
  });

  it('turns with the yaw: at 90 the viewer looks west, so north is right and east is down', () => {
    const camera = state({ yaw: 90 });
    expectClose(xy(project(camera, VIEW, 'plan', [1300, 1100, 0])), [600, 400]);
    expectClose(xy(project(camera, VIEW, 'plan', [1400, 1200, 0])), [500, 500]);
  });

  it('puts the target in the middle of the screen in 3D, at the camera’s distance', () => {
    const at = project(state(), VIEW, '3d', [1300, 1200, 0]);
    expectClose(at && [at.x, at.y, at.depth], [500, 400, ONE_PX_PER_CM]);
    // One metre east of the target is one metre across: 100 px at this distance.
    expectClose(xy(project(state(), VIEW, '3d', [1400, 1200, 0])), [600, 400]);
  });

  it('refuses a point behind the eye in 3D', () => {
    expect(project(state({ pitch: 30 }), VIEW, '3d', [1300, 9000, 0])).toBeNull();
  });
});

function xy(at: { x: number; y: number } | null): number[] | null {
  return at && [at.x, at.y];
}

describe('the ground under a screen point', () => {
  const cameras: Array<[string, CameraState, ViewMode]> = [
    ['plan, north up', state({ distance: 3000 }), 'plan'],
    ['plan, turned', state({ distance: 5200, yaw: 215 }), 'plan'],
    ['3D, low', state({ distance: 2500, pitch: PITCH_MIN, yaw: 37 }), '3d'],
    ['3D, middle', state({ distance: 4000, pitch: 50, yaw: 300 }), '3d'],
    ['3D, nearly overhead', state({ distance: 6000, pitch: PITCH_MAX, yaw: 90 }), '3d'],
  ];
  const points: Array<[number, number]> = [[1300, 1200], [0, 0], [2600, 2400], [1800, 900], [950, 1650]];

  it.each(cameras)('comes back to the point projected, %s', (_name, camera, mode) => {
    for (const [x, y] of points) {
      const at = project(camera, VIEW, mode, [x, y, 0]);
      expect(at).not.toBeNull();
      expectClose(groundAt(camera, VIEW, mode, at!.x, at!.y), [x, y], 6);
    }
  });

  it('finds a point on a raised plane too', () => {
    const camera = state({ distance: 4000, pitch: 40, yaw: 20 });
    const at = project(camera, VIEW, '3d', [1500, 1000, 300]);
    expectClose(groundAt(camera, VIEW, '3d', at!.x, at!.y, 300), [1500, 1000], 6);
  });

  it('is null above the horizon in 3D, and never in plan', () => {
    // At pitch 18 a ray 400 px above the top edge leaves the camera about 10° upward.
    expect(groundAt(state({ pitch: PITCH_MIN }), VIEW, '3d', 500, -400)).toBeNull();
    expect(groundAt(state({ pitch: PITCH_MIN }), VIEW, 'plan', 500, -400)).not.toBeNull();
  });
});

describe('zooming, panning and orbiting', () => {
  it.each(['plan', '3d'] as const)('keeps the ground under the cursor under the cursor (%s)', (mode) => {
    const camera = state({ distance: 4000, yaw: 25, pitch: 45 });
    const before = groundAt(camera, VIEW, mode, 200, 150);
    const zoomed = zoomAt(camera, VIEW, mode, 200, 150, 0.5);
    expect(zoomed.distance).toBeCloseTo(2000, 9);
    expectClose(groundAt(zoomed, VIEW, mode, 200, 150), before!, 6);
  });

  it('stops zooming at the nearest and farthest distances', () => {
    expect(zoomAt(state(), VIEW, '3d', 500, 400, 1e-6).distance).toBe(DISTANCE_MIN);
    expect(zoomAt(state(), VIEW, '3d', 500, 400, 1e6).distance).toBe(DISTANCE_MAX);
  });

  it('pans by map centimetres', () => {
    expect(panBy(state(), 150, -40)).toEqual(state({ targetX: 1450, targetY: 1160 }));
  });

  it('orbits the yaw all the way round and holds the pitch between its limits', () => {
    expect(orbit(state({ yaw: 350 }), 20, 0).yaw).toBe(10);
    expect(orbit(state({ yaw: 10 }), -30, 0).yaw).toBe(340);
    expect(orbit(state({ pitch: 50 }), 0, 60).pitch).toBe(PITCH_MAX);
    expect(orbit(state({ pitch: 50 }), 0, -60).pitch).toBe(PITCH_MIN);
  });

  it('never rounds the yaw up to exactly 360 at the floating-point edge', () => {
    // -0.1 then -0.2 off 0.3 leaves a tiny-negative remainder that a naive
    // `wrapped + 360` rounds up to 360.0 exactly.
    const twice = orbit(orbit(state({ yaw: 0.3 }), -0.1, 0), -0.2, 0);
    expect(twice.yaw).toBeGreaterThanOrEqual(0);
    expect(twice.yaw).toBeLessThan(360);
  });
});

describe('framing a rectangle', () => {
  const WHOLE: ScreenBox = { l: 0, t: 0, r: 1000, b: 800 };
  /** Where the panels leave room: 320 px on the left, 100 on the right, a top bar and a bottom strip. */
  const SAFE: ScreenBox = { l: 320, t: 60, r: 900, b: 740 };
  const EPS = 1e-6;

  function expectInside(box: ScreenBox, safe: ScreenBox): void {
    expect(box.l).toBeGreaterThanOrEqual(safe.l - EPS);
    expect(box.r).toBeLessThanOrEqual(safe.r + EPS);
    expect(box.t).toBeGreaterThanOrEqual(safe.t - EPS);
    expect(box.b).toBeLessThanOrEqual(safe.b + EPS);
  }

  it('frames the plot for null — an empty map — in plan, filling the tighter side', () => {
    // 1000 / 2600 across against 800 / 2400 up: the height decides, a third of a pixel per centimetre.
    const camera = fitRect(null, 0, 50, VIEW, 'plan', WHOLE, PLOT);
    expect(pxPerCm(camera, VIEW)).toBeCloseTo(1 / 3, 9);
    expect(camera.targetX).toBeCloseTo(1300, 6);
    expect(camera.targetY).toBeCloseTo(1200, 6);
    const box = screenBox(camera, 'plan', cornersOf({ x: 0, y: 0, width: 2600, depth: 2400 }));
    expectInside(box, WHOLE);
    expect(box.b - box.t).toBeCloseTo(800, 6);
  });

  it('frames into the safe box, off the screen’s middle, turned a quarter', () => {
    // At yaw 90 the plot's 24 m runs across and its 26 m up: min(580 / 2400, 680 / 2600).
    const camera = fitRect(null, 90, 50, VIEW, 'plan', SAFE, PLOT);
    expect(pxPerCm(camera, VIEW)).toBeCloseTo(580 / 2400, 9);
    const box = screenBox(camera, 'plan', cornersOf({ x: 0, y: 0, width: 2600, depth: 2400 }));
    expectInside(box, SAFE);
    expect((box.l + box.r) / 2).toBeCloseTo(610, 6);
    expect((box.t + box.b) / 2).toBeCloseTo(400, 6);
  });

  it.each([
    ['the plot', null],
    ['a rect entirely outside the plot', { x: 3000, y: -800, width: 400, depth: 300 }],
    ['one fridge', { x: 1000, y: 1000, width: 70, depth: 70 }],
  ] as const)('frames %s in 3D, every corner and roof inside the safe box', (_name, rect) => {
    const camera = fitRect(rect, 30, 50, VIEW, '3d', SAFE, PLOT);
    const framed = rect ?? { x: 0, y: 0, width: 2600, depth: 2400 };
    const box = screenBox(camera, '3d', [...cornersOf(framed), ...cornersOf(framed, 300)]);
    expectInside(box, SAFE);
    // Tight, too: one side of the box is within 3% of the safe box's.
    expect(Math.max((box.r - box.l) / 580, (box.b - box.t) / 680)).toBeGreaterThan(0.97);
  });

  it('stops at the nearest distance for a point', () => {
    const camera = fitRect({ x: 500, y: 500, width: 0, depth: 0 }, 0, 50, VIEW, 'plan', WHOLE, PLOT);
    expect(camera.distance).toBe(DISTANCE_MIN);
    expect(camera.targetX).toBeCloseTo(500, 6);
    expect(camera.targetY).toBeCloseTo(500, 6);
  });
});

describe('between two views', () => {
  const a = state({ targetX: 0, targetY: 0, distance: 1000, yaw: 350, pitch: 30 });
  const b = state({ targetX: 1000, targetY: 500, distance: 4000, yaw: 10, pitch: 70 });

  it('turns the short way round and moves evenly in log distance', () => {
    const half = interpolate(a, b, 0.5);
    expect(half.yaw).toBeCloseTo(0, 9);
    expect(half.distance).toBeCloseTo(2000, 6);
    expect(half.targetX).toBe(500);
    expect(half.targetY).toBe(250);
    expect(half.pitch).toBe(50);
  });

  it('starts at the first and ends at the second', () => {
    expect(interpolate(a, b, 0)).toEqual(a);
    const end = interpolate(a, b, 1);
    expect(end.yaw).toBeCloseTo(10, 9);
    expect(end.distance).toBeCloseTo(4000, 6);
  });

  it('never rounds the yaw up to exactly 360 at the floating-point edge', () => {
    const at = interpolate(state({ yaw: 0 }), state({ yaw: 350 }), 1e-15);
    expect(at.yaw).toBeGreaterThanOrEqual(0);
    expect(at.yaw).toBeLessThan(360);
  });
});

describe('arrow keys', () => {
  it('follow the screen whichever way the view is turned', () => {
    expect(screenArrowToMap(0, 'ArrowUp')).toEqual([0, -1]);
    expect(screenArrowToMap(0, 'ArrowRight')).toEqual([1, 0]);
    expect(screenArrowToMap(0, 'ArrowDown')).toEqual([0, 1]);
    expect(screenArrowToMap(0, 'ArrowLeft')).toEqual([-1, 0]);
    expect(screenArrowToMap(90, 'ArrowUp')).toEqual([-1, 0]);
    expect(screenArrowToMap(90, 'ArrowRight')).toEqual([0, -1]);
    expect(screenArrowToMap(180, 'ArrowUp')).toEqual([0, 1]);
    expect(screenArrowToMap(270, 'ArrowUp')).toEqual([1, 0]);
  });

  it('move along the nearest map axis when the view is turned part way', () => {
    expect(screenArrowToMap(30, 'ArrowUp')).toEqual([0, -1]);
    expect(screenArrowToMap(60, 'ArrowUp')).toEqual([-1, 0]);
  });
});

describe('the scale', () => {
  it('is the focal length over the distance', () => {
    expect(pxPerCm(state(), VIEW)).toBeCloseTo(1, 12);
    expect(pxPerCm(state({ distance: ONE_PX_PER_CM * 4 }), VIEW)).toBeCloseTo(0.25, 12);
  });
});
