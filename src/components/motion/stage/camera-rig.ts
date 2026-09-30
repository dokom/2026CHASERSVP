import { CatmullRomCurve3, Vector3, type PerspectiveCamera } from 'three'
import { LAST_ACT } from '@/lib/motion/acts'
import { CAMERA_POSITIONS, CAMERA_TARGETS, type Vec3 } from '@/lib/motion/stage-layout'

const toCurve = (keys: readonly Vec3[]) => new CatmullRomCurve3(keys.map(([x, y, z]) => new Vector3(x, y, z)))

/**
 * Places the camera on a spline through one key per act. It samples the
 * already-damped stage position rather than damping itself, so the camera
 * always rides the path (never cuts across it after a fast scroll) and stays
 * in lockstep with the particle morphs driven by the same number.
 */
export class CameraRig {
  private readonly positions = toCurve(CAMERA_POSITIONS)
  private readonly targets = toCurve(CAMERA_TARGETS)
  private readonly target = new Vector3()

  apply(camera: PerspectiveCamera, stage: number): void {
    // getPoint (not getPointAt) puts key i exactly at t = i / LAST_ACT.
    const t = Math.min(1, Math.max(0, stage / LAST_ACT))
    this.positions.getPoint(t, camera.position)
    this.targets.getPoint(t, this.target)
    camera.lookAt(this.target)
  }
}
