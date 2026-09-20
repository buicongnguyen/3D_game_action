import { Matrix4, Quaternion, Vector3 } from "three";
import type { SpiderRig } from "../art/machines.ts";

export const SPIDER_STRIDE = 4.5;
const STANCE = 0.6;
const TAU = Math.PI * 2;
const states = new WeakMap<SpiderRig, {
  feet: { planted: Vector3; from: Vector3; target: Vector3; orientation: Quaternion; elapsed: number; duration: number; swinging: boolean; wasSwing: boolean }[];
  x: number; z: number; y: number;
}>();
const inverse = new Matrix4();
const local = new Vector3();
const desired = new Vector3();
const ankle = new Vector3();
const parentRotation = new Quaternion();
const soleRotation = new Quaternion();
const downRotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
const worldScale = new Vector3();
const decomposedPosition = new Vector3();
export function spiderRigScale(rig: SpiderRig): number {
  return Math.max(0.001, rig.root.getWorldScale(worldScale).x);
}
/** Reset planted contacts when spawning, pooling or taking off/landing. */
export function resetSpiderLegs(rig: SpiderRig): void { states.delete(rig); }
function safeAcos(value: number): number {
  return Math.acos(Math.max(-1, Math.min(1, value)));
}

/** World-space planted contacts and two-bone IK. Only presentation is changed. */
export function solveSpiderLegs(rig: SpiderRig, dt: number, speed: number, moving: boolean, groundHeight?: (x: number, z: number) => number): void {
  // Bare animation test rigs do not carry the builder's segment metadata.
  if (!rig.legs[0]?.userData.femurLength) return;
  // Only the body transform is needed before solving. Traversing every old
  // limb here, then each parent chain twice per leg, duplicated most IK work.
  rig.body.updateWorldMatrix(true, false);
  const scale = spiderRigScale(rig);
  inverse.copy(rig.body.matrixWorld).invert();
  rig.root.getWorldQuaternion(soleRotation);
  soleRotation.multiply(downRotation);
  let state = states.get(rig);
  const reset = !state || Math.hypot(rig.root.position.x - state.x, rig.root.position.z - state.z) > 12 * scale || Math.abs(rig.root.position.y - state.y) > scale;
  if (!state || reset) {
    state = { feet: [], x: rig.root.position.x, z: rig.root.position.z, y: rig.root.position.y };
    for (const leg of rig.legs) {
      desired.set(leg.userData.restX, 0, leg.userData.restZ).applyMatrix4(rig.root.matrixWorld);
      desired.y = groundHeight?.(desired.x, desired.z) ?? 0;
      state.feet.push({ planted: desired.clone(), from: desired.clone(), target: desired.clone(), orientation: soleRotation.clone(),
        elapsed: 0, duration: 1, swinging: false, wasSwing: false });
    }
    states.set(rig, state);
  }
  state.x = rig.root.position.x;
  state.z = rig.root.position.z;
  state.y = rig.root.position.y;
  let airborneGroup = -1;
  for (let i = 0; i < state.feet.length; i++) {
    if (state.feet[i].swinging) airborneGroup = ((i >> 1) + (i & 1)) & 1;
  }
  for (let i = 0; i < rig.legs.length; i++) {
    const leg = rig.legs[i];
    const foot = state.feet[i];
    // Builder order is front-left/right, then the next left/right pair.
    const group = ((i >> 1) + (i & 1)) & 1;
    const cycle = ((rig.gaitPhase / TAU + group * 0.5) % 1 + 1) % 1;
    const swingPhase = cycle >= STANCE;
    const canLift = airborneGroup < 0 || airborneGroup === group;
    if (moving && swingPhase && !foot.wasSwing && !foot.swinging && canLift) {
      airborneGroup = group;
      foot.from.copy(foot.planted);
      foot.elapsed = 0;
      foot.duration = (1 - STANCE) * SPIDER_STRIDE * scale / Math.max(0.1, speed);
      foot.swinging = true;
    }
    foot.wasSwing = moving && swingPhase && canLift;
    if (foot.swinging) {
      foot.orientation.slerp(soleRotation, Math.min(1, dt * 8));
      // Landing leads the hip by half a stance stride. Re-evaluate while
      // airborne so turning changes the landing point, not a planted contact.
      desired.set(leg.userData.restX, 0,
        leg.userData.restZ + (moving ? SPIDER_STRIDE * STANCE * 0.5 : 0))
        .applyMatrix4(rig.root.matrixWorld);
      desired.y = groundHeight?.(desired.x, desired.z) ?? 0;
      foot.elapsed += Math.max(0, dt);
      const progress = foot.elapsed / foot.duration;
      const t = progress >= 1 - 1e-8 ? 1 : progress;
      const smooth = t * t * (3 - 2 * t);
      foot.target.lerpVectors(foot.from, desired, smooth);
      foot.target.y += Math.sin(Math.PI * t) * 0.65 * scale;
      if (t >= 1) {
        foot.planted.copy(foot.target);
        foot.swinging = false;
      }
    } else foot.target.copy(foot.planted);

    // The foot geometry's claws end 0.30 beyond its nominal foot length.
    // Keep the claw contact on the ground, and the sole world-level.
    ankle.copy(foot.target);
    ankle.y += (leg.userData.footLength + 0.3) * scale;
    local.copy(ankle).applyMatrix4(inverse).sub(leg.position);
    const horizontal = Math.hypot(local.x, local.z);
    const a = leg.userData.femurLength as number;
    const b = leg.userData.tibiaLength as number;
    const distance = Math.min(a + b - 0.001, Math.max(Math.abs(a - b) + 0.001, Math.hypot(horizontal, local.y)));
    leg.rotation.y = Math.atan2(local.x, local.z);
    rig.legUpper[i].rotation.x = Math.atan2(-local.y, horizontal)
      - safeAcos((a * a + distance * distance - b * b) / (2 * a * distance));
    rig.legLower[i].rotation.x = Math.PI - safeAcos((a * a + b * b - distance * distance) / (2 * a * b));
    leg.updateWorldMatrix(false, false);
    rig.legUpper[i].updateWorldMatrix(false, false);
    rig.legLower[i].updateWorldMatrix(false, false);
    rig.legLower[i].matrixWorld.decompose(decomposedPosition, parentRotation, worldScale);
    rig.legFoot[i].quaternion.copy(parentRotation.invert().multiply(foot.orientation));
  }
}
