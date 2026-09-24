import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FOV_DEG, project, type CameraState, type Vec3, type ViewMode } from '@/lib/site/editor/camera';
import { CameraRig } from './camera-rig';
import { CM, worldOf } from './meshes';

const VIEWPORT = { width: 1200, height: 800 };

const STATES: CameraState[] = [
  { targetX: 1300, targetY: 1200, distance: 3000, yaw: 0, pitch: 90 },
  { targetX: 1300, targetY: 1200, distance: 3000, yaw: -26, pitch: 50 },
  { targetX: 500, targetY: 2000, distance: 900, yaw: 135, pitch: 18 },
  { targetX: 2000, targetY: 300, distance: 12_000, yaw: 270, pitch: 89 },
  { targetX: -400, targetY: 2600, distance: 250, yaw: 45, pitch: 60 },
];

const POINTS: Vec3[] = [
  [1300, 1200, 0], [0, 0, 0], [2600, 2400, 0], [2600, 0, 0],
  [1000, 900, 250], [1800, 700, 120], [450, 1950, 30], [2050, 350, 300],
];

/** Where three puts a map point on screen, in CSS pixels from the top-left. */
function threePixel(camera: THREE.Camera, point: Vec3): { x: number; y: number } {
  const ndc = worldOf(point[0], point[1], point[2]).project(camera);
  return { x: ((ndc.x + 1) / 2) * VIEWPORT.width, y: ((1 - ndc.y) / 2) * VIEWPORT.height };
}

describe('the camera rig', () => {
  it('draws exactly what the pure camera maths projects, in both views', () => {
    const rig = new CameraRig();
    let compared = 0;
    for (const mode of ['plan', '3d'] as ViewMode[]) {
      for (const state of STATES) {
        const camera = rig.apply(state, VIEWPORT, mode);
        for (const point of POINTS) {
          const expected = project(state, VIEWPORT, mode, point);
          if (expected === null) continue; // behind a perspective camera
          const actual = threePixel(camera, point);
          expect(Math.abs(actual.x - expected.x), `${mode} ${JSON.stringify(state)} ${point} x`).toBeLessThan(0.5);
          expect(Math.abs(actual.y - expected.y), `${mode} ${JSON.stringify(state)} ${point} y`).toBeLessThan(0.5);
          compared += 1;
        }
      }
    }
    // A cross-check that compared nothing would pass; this one cannot.
    expect(compared).toBeGreaterThanOrEqual(60);
  });

  it('uses the orthographic camera in plan and the perspective one in 3D', () => {
    const rig = new CameraRig();
    expect(rig.apply(STATES[1], VIEWPORT, 'plan')).toBe(rig.orthographic);
    expect(rig.apply(STATES[1], VIEWPORT, '3d')).toBe(rig.perspective);
    expect(rig.perspective.fov).toBe(FOV_DEG);
    expect(rig.perspective.aspect).toBeCloseTo(1.5);
  });

  it('frames plan to what 3D sees at the target, so the switch does not jump', () => {
    const rig = new CameraRig();
    rig.apply(STATES[0], VIEWPORT, 'plan');
    const expected = 2 * STATES[0].distance * CM * Math.tan((FOV_DEG / 2) * (Math.PI / 180));
    expect(rig.orthographic.top - rig.orthographic.bottom).toBeCloseTo(expected, 6);
    expect(rig.orthographic.right - rig.orthographic.left).toBeCloseTo(expected * 1.5, 6);
  });

  it('puts the target in the middle of the screen in both views', () => {
    const rig = new CameraRig();
    for (const mode of ['plan', '3d'] as ViewMode[]) {
      const camera = rig.apply(STATES[1], VIEWPORT, mode);
      const centre = threePixel(camera, [STATES[1].targetX, STATES[1].targetY, 0]);
      expect(centre.x).toBeCloseTo(600, 3);
      expect(centre.y).toBeCloseTo(400, 3);
    }
  });
});
