import * as THREE from 'three';
import {
  cameraFrame, FOV_DEG, type CameraState, type ViewMode, type Viewport,
} from '@/lib/site/editor/camera';
import { CM, directionOf, worldOf } from './meshes';

/**
 * How much higher than the plain eye height (`cameraFrame`'s `eye[2]`) the
 * orthographic plan camera actually stands, in map centimetres. An
 * orthographic projection's screen x, y for a point never depends on how far
 * along the view axis the camera sits — only its near/far clip planes do —
 * so this changes nothing `project()` predicts. What it fixes is the near
 * plane: at the closest zoom (`distance` 250 cm) the plain eye height is
 * only 2.5 m off the ground, so anything taller reaches past the camera
 * itself and is clipped before it is ever drawn or picked. Standing the
 * camera 20 m higher leaves headroom for anything the plot holds.
 */
const PLAN_LIFT_CM = 2000;

/**
 * Applies the camera state the pure maths holds (`camera.ts`) to a real
 * three camera — perspective in 3D, orthographic straight down in plan — so
 * what `project()` computes and what WebGL draws are the same picture. The
 * position and the orientation both come from `cameraFrame`; nothing about
 * the view is decided twice. `directionOf` and `worldOf` (`meshes.ts`) own
 * the one map→three axis swap; this file never repeats it.
 *
 * Plan's frustum is framed to match: half its height is
 * `distance · tan(FOV / 2)`, which is exactly what the perspective camera
 * sees at the target, so switching modes at pitch 90 does not jump.
 */
export class CameraRig {
  readonly perspective = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 1000);
  readonly orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  private readonly basis = new THREE.Matrix4();

  apply(state: CameraState, viewport: Viewport, mode: ViewMode): THREE.Camera {
    const frame = cameraFrame(state, viewport, mode);
    const aspect = viewport.width / Math.max(1, viewport.height);
    const distanceM = state.distance * CM;
    const camera = mode === 'plan' ? this.orthographic : this.perspective;
    const eyeZ = mode === 'plan' ? frame.eye[2] + PLAN_LIFT_CM : frame.eye[2];

    camera.position.copy(worldOf(frame.eye[0], frame.eye[1], eyeZ));
    // A camera looks down its own −Z with +Y up and +X right.
    this.basis.makeBasis(directionOf(frame.right), directionOf(frame.up), directionOf(frame.forward).negate());
    camera.quaternion.setFromRotationMatrix(this.basis);

    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = FOV_DEG;
      camera.aspect = aspect;
      // Near scales with distance so the depth buffer stays sharp from 2.5 m to 400 m.
      camera.near = Math.max(0.05, distanceM * 0.02);
      camera.far = distanceM * 3 + 300;
    } else {
      const half = frame.orthoHalfHeight * CM;
      camera.top = half;
      camera.bottom = -half;
      camera.left = -half * aspect;
      camera.right = half * aspect;
      camera.near = 0.1;
      // Far grows by the same lift, so the ground stays as deep inside the
      // frustum as it always was.
      camera.far = distanceM + 300 + PLAN_LIFT_CM * CM;
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return camera;
  }
}
