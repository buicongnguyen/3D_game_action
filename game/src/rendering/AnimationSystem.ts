import type { Color, Object3D } from "three";
import { clamp, lerp } from "../core/math.ts";
import { SPIDER } from "../data/balance.ts";
import type { PuppetRig } from "../art/characters.ts";
import type { SpiderRig, TurretRig } from "../art/machines.ts";

/**
 * Procedural animation for the rigid-segment puppets.
 *
 * There is no skinning and there are no animation clips. Every character is a
 * short hierarchy of merged parts whose joints are driven by sine waves phased
 * off a single per-entity clock. That is a deliberate trade: it costs a few
 * dozen float operations per character instead of a skinning pass and a mixer,
 * which is what makes 130 animated enemies affordable, and it gives exact
 * control over weight and timing that a generic clip library would not.
 *
 * The rule that keeps it from looking cheap is that no two limbs share a phase
 * and nothing moves at a constant rate: contact poses are held, swings ease,
 * and the torso counter-rotates against the legs.
 */

export interface PuppetAnimationState {
  /** Seconds of animation clock; advanced by the caller at the LOD rate. */
  time: number;
  /**
   * Integrated gait phase in radians, wrapped to one turn.
   *
   * This must be integrated rather than derived as `time * cadence`. Cadence is
   * a function of the entity's current speed, so scaling an ever-growing clock
   * by it makes the actual angular velocity `cadence + time * dCadence/dt` - an
   * error term proportional to how long the run has lasted. Every speed change
   * then teleports the gait, mildly at first and by tens of radians a few
   * minutes in, which reads as legs snapping to random poses. Integrating makes
   * the phase continuous across any cadence change, forever.
   */
  gaitPhase: number;
  /** Blend weight toward the locomotion pose, 0 = idle. */
  locomotion: number;
  /** One-shot timer for attack/hit/death, counting down. */
  actionTimer: number;
  actionDuration: number;
  action: PuppetAction;
  /** Per-entity phase offset so a crowd never marches in lockstep. */
  phase: number;
  /** Smoothed speed, so a stutter in pathing does not pop the gait. */
  smoothedSpeed: number;
  /** Root height the last animated pose asked for; see `animateHumanoid`. */
  rootY: number;
}

export type PuppetAction = "none" | "attack" | "hit" | "death" | "awaken" | "dodge" | "work" | "shoot";

/**
 * State for one impostor - an enemy past the puppet budget, drawn as a single
 * merged mesh with no joints to move.
 *
 * It is deliberately two numbers rather than a `PuppetAnimationState`: there
 * are up to two hundred of these and none of them owns a rig.
 */
export interface ImpostorAnimationState {
  /** Integrated gait phase in radians, wrapped. Same rule as `gaitPhase`. */
  gaitPhase: number;
  /** Smoothed speed, so a stutter in pathing does not pop the bob. */
  smoothedSpeed: number;
}

/** Output of `animateImpostor`, written into a caller-owned object. */
export interface ImpostorPose {
  /** Vertical scale; 1 is the rest height. */
  squash: number;
  /** Forward lean in radians, about the impostor's own right axis. */
  lean: number;
}

const TAU = Math.PI * 2;

/**
 * Stride cadence in radians per second.
 *
 * Rises with speed but sub-linearly, so a sprint does not become a blur of leg
 * frequency. Shared by the puppets and the impostors, because an enemy crossing
 * the LOD boundary must not visibly change its stride rate.
 */
function strideCadence(normalizedSpeed: number): number {
  return 4.2 + normalizedSpeed * 5.4;
}

export function createPuppetState(phase: number): PuppetAnimationState {
  return {
    time: phase * 10,
    gaitPhase: phase * TAU,
    locomotion: 0,
    actionTimer: 0,
    actionDuration: 0,
    action: "none",
    phase,
    smoothedSpeed: 0,
    rootY: 0,
  };
}

export function playAction(
  state: PuppetAnimationState,
  action: PuppetAction,
  duration: number,
): void {
  // Death outranks everything; nothing interrupts a corpse.
  if (state.action === "death") return;
  state.action = action;
  state.actionTimer = duration;
  state.actionDuration = duration;
}

/**
 * Drives a humanoid puppet. `speed` is metres per second; `maxSpeed` scales the
 * cadence so a golem's stride is slow and heavy while a minion scurries.
 */
export function animateHumanoid(
  rig: PuppetRig,
  state: PuppetAnimationState,
  dt: number,
  speed: number,
  maxSpeed: number,
  carrying: boolean,
): void {
  state.time += dt;
  state.smoothedSpeed = lerp(state.smoothedSpeed, speed, clamp(dt * 9, 0, 1));

  const normalizedSpeed = clamp(state.smoothedSpeed / Math.max(0.1, maxSpeed), 0, 1.4);
  state.locomotion = lerp(state.locomotion, clamp(normalizedSpeed, 0, 1), clamp(dt * 10, 0, 1));

  if (state.actionTimer > 0) {
    state.actionTimer -= dt;
    if (state.actionTimer <= 0 && state.action !== "death") state.action = "none";
  }

  state.gaitPhase = (state.gaitPhase + strideCadence(normalizedSpeed) * dt) % TAU;
  const t = state.gaitPhase;
  const swing = Math.sin(t);
  const swingOpposite = Math.sin(t + Math.PI);
  const stride = state.locomotion;

  // Legs
  rig.legL.rotation.x = swing * 0.82 * stride;
  rig.legR.rotation.x = swingOpposite * 0.82 * stride;
  // Knees only bend on the forward half of the swing, which is what separates a
  // walk from a pendulum.
  rig.shinL.rotation.x = Math.max(0, -swing) * 1.15 * stride;
  rig.shinR.rotation.x = Math.max(0, -swingOpposite) * 1.15 * stride;

  // Arms counter-swing against the legs.
  const armSwing = carrying ? 0 : swingOpposite * 0.66 * stride;
  const armSwingOpposite = carrying ? 0 : swing * 0.66 * stride;

  if (carrying) {
    // Both arms forward and up, holding the load against the chest.
    rig.armL.rotation.x = -1.15;
    rig.armR.rotation.x = -1.15;
    rig.forearmL.rotation.x = -1.05;
    rig.forearmR.rotation.x = -1.05;
    rig.armL.rotation.z = 0.22;
    rig.armR.rotation.z = -0.22;
  } else {
    rig.armL.rotation.x = armSwing;
    rig.armR.rotation.x = armSwingOpposite;
    rig.forearmL.rotation.x = -0.28 - Math.max(0, armSwing) * 0.5;
    rig.forearmR.rotation.x = -0.28 - Math.max(0, armSwingOpposite) * 0.5;
    rig.armL.rotation.z = 0.12;
    rig.armR.rotation.z = -0.12;
  }

  // Torso counter-rotation and a two-per-stride vertical bob.
  rig.torso.rotation.y = -swing * 0.16 * stride;
  rig.pelvis.rotation.y = swing * 0.2 * stride;
  rig.torso.position.y = restY(rig.torso) + Math.abs(Math.sin(t)) * 0.055 * stride;
  rig.torso.rotation.x = 0.06 + stride * 0.12;

  // Idle breathing keeps a standing character from looking frozen.
  const idle = 1 - stride;
  rig.head.rotation.x = Math.sin(state.time * 1.3 + state.phase * 4) * 0.05 * idle;
  rig.torso.position.y += Math.sin(state.time * 1.7 + state.phase * 3) * 0.02 * idle;

  // The root's own transform belongs entirely to the actions - the spawn rise,
  // the death topple, the dodge roll - so locomotion returns it to rest before
  // they run. Without this the blend has nothing to blend against there and
  // reads back its own previous output instead, which leaves a small permanent
  // residue on every character that has ever risen, rolled or fallen.
  rig.root.position.y = restY(rig.root);
  rig.root.rotation.x = restRotX(rig.root);

  applyAction(rig, state, stride, dt);

  // Publish the vertical offset the pose wants.
  //
  // Distant enemies are animated on a stride - every 2nd or 4th frame - while
  // their world transform is written every frame, and that write zeroes root Y.
  // Death and awaken are the two poses that lift the root, so without this they
  // flicker between the posed height and the ground at half or a quarter of the
  // frame rate. Recording it here lets the caller reapply it on the frames that
  // skip animation. The entire visible spawn band is strided, so this affected
  // every "rise out of the ground" beat in the game.
  state.rootY = rig.root.position.y;
}

export function createImpostorState(phase: number): ImpostorAnimationState {
  return { gaitPhase: phase * TAU, smoothedSpeed: 0 };
}

/**
 * Drives one impostor. `phaseOffset` shifts this enemy within the stride and
 * must be constant for its lifetime - it de-syncs the crowd and nothing else.
 *
 * An impostor has no joints, so the only motion available is the body's own:
 * the vertical bob of a stride and the lean of a run. Both are driven from the
 * enemy's real speed, which is the whole point. They previously ran at a fixed
 * 6 rad/s with a fixed amplitude, so a skeleton standing still bobbed exactly
 * as fast as one sprinting, and past the puppet budget - three quarters of the
 * horde at the measured 241-enemy figure - nothing on screen was tied to how
 * the enemy was actually moving.
 *
 * The phase is integrated for the same reason the puppet gait is: the cadence
 * is a function of current speed, so multiplying it by a running clock puts an
 * error proportional to elapsed time into the angular velocity and teleports
 * the phase at every speed change. See `PuppetAnimationState.gaitPhase`.
 */
export function animateImpostor(
  state: ImpostorAnimationState,
  out: ImpostorPose,
  dt: number,
  speed: number,
  maxSpeed: number,
  phaseOffset: number,
): void {
  state.smoothedSpeed = lerp(state.smoothedSpeed, speed, clamp(dt * 9, 0, 1));
  const normalizedSpeed = clamp(state.smoothedSpeed / Math.max(0.1, maxSpeed), 0, 1.4);
  state.gaitPhase = (state.gaitPhase + strideCadence(normalizedSpeed) * dt) % TAU;

  // Amplitudes scale with the stride, so a stationary enemy is still and a
  // sprinting one is emphatic. The bob is two per stride, as the puppet's torso
  // bob is, and the lean matches the puppet's torso pitch at full speed so the
  // two tiers read as the same posture.
  const stride = clamp(normalizedSpeed, 0, 1);
  out.squash = 1 + Math.abs(Math.sin(state.gaitPhase + phaseOffset)) * 0.075 * stride;
  out.lean = stride * 0.16;
}

/**
 * Ramp for blending an action pose against the locomotion pose beneath it.
 *
 * Actions used to be written straight over locomotion, so they appeared and
 * vanished on a single frame: `attack` held the torso at -0.5 rad through its
 * recovery and then snapped about half a radian back to the gait value on the
 * frame the timer expired - on every attack of every enemy - and `shoot` slammed
 * both arms to absolute angles on its first frame. Ramping in and out costs one
 * lerp per joint and removes both pops.
 *
 * Two ends are deliberately exempt, because there the pose *is* a hard
 * displacement: `awaken` starts 1.35 m underground, so easing it in would show
 * the body at ground level and then sink it before the rise; and `death` is
 * held after its timer expires, so it must never ease back out.
 */
const ACTION_BLEND_IN = 0.08;
const ACTION_BLEND_OUT = 0.12;

function actionWeight(state: PuppetAnimationState, dt: number): number {
  const elapsed = state.actionDuration - state.actionTimer;
  const rampIn = state.action === "awaken" ? 1 : clamp(elapsed / ACTION_BLEND_IN, 0, 1);
  if (state.action === "death") return rampIn;
  // The tail lands on zero one step early, because the last frame on which the
  // action is applied still has up to a whole step left on its clock. A ramp
  // that only reaches zero at the mathematical instant of expiry leaves that
  // frame's share of the pose to be dropped in one go - which is the pop this
  // exists to remove, just smaller.
  return Math.min(rampIn, clamp((state.actionTimer - dt) / ACTION_BLEND_OUT, 0, 1));
}

/**
 * The locomotion pose, captured before an action overwrites it.
 *
 * A module-level record rather than a return value: `applyAction` runs once per
 * animated character per frame and must not allocate.
 */
const locomotionPose = {
  rootRotX: 0,
  rootY: 0,
  torsoRotX: 0,
  torsoRotY: 0,
  headRotX: 0,
  armLRotX: 0,
  armRRotX: 0,
  forearmLRotX: 0,
  forearmRRotX: 0,
  legLRotX: 0,
  legRRotX: 0,
  shinLRotX: 0,
  shinRRotX: 0,
};

function captureLocomotionPose(rig: PuppetRig): void {
  locomotionPose.rootRotX = rig.root.rotation.x;
  locomotionPose.rootY = rig.root.position.y;
  locomotionPose.torsoRotX = rig.torso.rotation.x;
  locomotionPose.torsoRotY = rig.torso.rotation.y;
  locomotionPose.headRotX = rig.head.rotation.x;
  locomotionPose.armLRotX = rig.armL.rotation.x;
  locomotionPose.armRRotX = rig.armR.rotation.x;
  locomotionPose.forearmLRotX = rig.forearmL.rotation.x;
  locomotionPose.forearmRRotX = rig.forearmR.rotation.x;
  locomotionPose.legLRotX = rig.legL.rotation.x;
  locomotionPose.legRRotX = rig.legR.rotation.x;
  locomotionPose.shinLRotX = rig.shinL.rotation.x;
  locomotionPose.shinRRotX = rig.shinR.rotation.x;
}

/** Pulls the written action pose back toward the captured locomotion pose. */
function blendActionPose(rig: PuppetRig, weight: number): void {
  rig.root.rotation.x = lerp(locomotionPose.rootRotX, rig.root.rotation.x, weight);
  rig.root.position.y = lerp(locomotionPose.rootY, rig.root.position.y, weight);
  rig.torso.rotation.x = lerp(locomotionPose.torsoRotX, rig.torso.rotation.x, weight);
  rig.torso.rotation.y = lerp(locomotionPose.torsoRotY, rig.torso.rotation.y, weight);
  rig.head.rotation.x = lerp(locomotionPose.headRotX, rig.head.rotation.x, weight);
  rig.armL.rotation.x = lerp(locomotionPose.armLRotX, rig.armL.rotation.x, weight);
  rig.armR.rotation.x = lerp(locomotionPose.armRRotX, rig.armR.rotation.x, weight);
  rig.forearmL.rotation.x = lerp(locomotionPose.forearmLRotX, rig.forearmL.rotation.x, weight);
  rig.forearmR.rotation.x = lerp(locomotionPose.forearmRRotX, rig.forearmR.rotation.x, weight);
  rig.legL.rotation.x = lerp(locomotionPose.legLRotX, rig.legL.rotation.x, weight);
  rig.legR.rotation.x = lerp(locomotionPose.legRRotX, rig.legR.rotation.x, weight);
  rig.shinL.rotation.x = lerp(locomotionPose.shinLRotX, rig.shinL.rotation.x, weight);
  rig.shinR.rotation.x = lerp(locomotionPose.shinRRotX, rig.shinR.rotation.x, weight);
}

function applyAction(
  rig: PuppetRig,
  state: PuppetAnimationState,
  stride: number,
  dt: number,
): void {
  if (state.action === "none" || state.actionDuration <= 0) return;
  const progress = clamp(1 - state.actionTimer / state.actionDuration, 0, 1);
  const weight = actionWeight(state, dt);
  if (weight <= 0) return;
  captureLocomotionPose(rig);

  switch (state.action) {
    case "attack": {
      // Wind up over the first 35%, strike fast, recover slowly.
      const windup = clamp(progress / 0.35, 0, 1);
      const strike = clamp((progress - 0.35) / 0.2, 0, 1);
      const recover = clamp((progress - 0.55) / 0.45, 0, 1);
      const raise = lerp(0, -2.3, easeOut(windup)) * (1 - strike);
      const swing = lerp(0, 1.9, easeIn(strike)) * (1 - recover * 0.9);
      rig.armR.rotation.x = raise + swing;
      rig.forearmR.rotation.x = -0.9 + swing * 0.6;
      rig.torso.rotation.y = lerp(0.35, -0.5, easeIn(strike));
      break;
    }
    case "shoot": {
      const recoil = Math.exp(-progress * 9) * Math.sin(progress * 34);
      rig.armR.rotation.x = -1.35 + recoil * 0.32;
      rig.armL.rotation.x = -1.2 + recoil * 0.2;
      rig.forearmR.rotation.x = -0.5;
      rig.forearmL.rotation.x = -0.7;
      rig.torso.rotation.y = 0.18 + recoil * 0.12;
      break;
    }
    case "hit": {
      const shock = Math.exp(-progress * 7) * Math.sin(progress * 40);
      rig.torso.rotation.x = 0.06 + shock * 0.28;
      rig.head.rotation.x = shock * 0.4;
      rig.armL.rotation.x += shock * 0.5;
      rig.armR.rotation.x += shock * 0.5;
      break;
    }
    case "death": {
      // Fold at the waist, knees give way, then topple. Held at the end.
      const fall = easeIn(clamp(progress / 0.75, 0, 1));
      rig.root.rotation.x = fall * 1.5;
      rig.root.position.y = -fall * 0.42;
      rig.torso.rotation.x = 0.06 + fall * 0.8;
      rig.head.rotation.x = fall * 0.9;
      rig.legL.rotation.x = fall * 0.7;
      rig.legR.rotation.x = fall * 0.5;
      rig.shinL.rotation.x = fall * 1.4;
      rig.shinR.rotation.x = fall * 1.2;
      rig.armL.rotation.x = -fall * 1.1;
      rig.armR.rotation.x = -fall * 0.8;
      break;
    }
    case "awaken": {
      // Rise out of the ground: the explicit spawn beat from §10.
      const rise = easeOut(progress);
      rig.root.position.y = lerp(-1.35, 0, rise);
      rig.root.rotation.x = lerp(1.2, 0, easeOut(clamp(progress / 0.7, 0, 1)));
      rig.armL.rotation.x = lerp(-2.2, 0, rise);
      rig.armR.rotation.x = lerp(-2.4, 0, rise);
      rig.head.rotation.x = lerp(-0.5, 0, rise);
      break;
    }
    case "dodge": {
      const roll = easeOut(progress);
      rig.root.rotation.x = Math.sin(roll * Math.PI) * 1.9;
      rig.root.position.y = Math.sin(roll * Math.PI) * 0.28;
      rig.torso.rotation.x = 0.5;
      rig.legL.rotation.x = -1.1;
      rig.legR.rotation.x = -0.9;
      rig.shinL.rotation.x = 1.6;
      rig.shinR.rotation.x = 1.5;
      break;
    }
    case "work": {
      // Hammering: a fast asymmetric arc with a hard stop at the bottom.
      const beat = (state.time * 5.2) % 1;
      const strike = beat < 0.35 ? easeIn(beat / 0.35) : 1 - easeOut((beat - 0.35) / 0.65);
      rig.armR.rotation.x = -1.9 + strike * 2.1;
      rig.forearmR.rotation.x = -1.2 + strike * 0.9;
      rig.armL.rotation.x = -0.8;
      rig.forearmL.rotation.x = -0.6;
      rig.torso.rotation.x = 0.22 + strike * 0.16;
      rig.torso.rotation.y = -0.2;
      break;
    }
    default:
      break;
  }

  if (weight < 1) blendActionPose(rig, weight);
  void stride;
}

/**
 * The spider's gait. Eight legs in two alternating groups of four, the
 * classic tetrapod pattern, with the body oscillating a half cycle out of
 * phase with the legs so the hull settles as each group plants.
 *
 * This reads the spider's speed and never writes to it, which is the phase
 * gate: entity movement must not depend on the visual leg animation.
 */
export function animateSpider(
  rig: SpiderRig,
  dt: number,
  speed: number,
  overdrive: boolean,
  docked: boolean,
  furnaceHeat: number,
): void {
  const normalized = clamp(speed / SPIDER.speedOverdrive, 0, 1.3);
  const cadence = docked ? 0 : 1.55 + normalized * 1.5;
  rig.gaitPhase = (rig.gaitPhase + cadence * dt) % TAU;
  const t = rig.gaitPhase;

  for (let i = 0; i < rig.legs.length; i++) {
    // Groups alternate around the body, not down one side, or the spider
    // would look like it was rowing.
    const group = (i % 2) ^ (i < 4 ? 0 : 1);
    const phase = t + (group ? Math.PI : 0) + i * 0.06;
    const lift = Math.max(0, Math.sin(phase));
    const reach = Math.cos(phase);
    const amount = docked ? 0 : clamp(normalized + 0.25, 0, 1);

    // Every joint offsets from the authored stance. The forge builds the legs
    // arched like an insect's, femur up and tibia down; writing absolute
    // rotations here would straighten them into flat rods and the machine
    // would read as a table rather than as something that walks.
    //
    // The amplitudes are large on purpose. At this camera height a forty-tonne
    // walker is about two hundred pixels across, so a subtle gait is simply not
    // visible - an earlier pass with a third of this range read, correctly, as
    // a sliding table with decorative legs.
    rig.legUpper[i].rotation.x = restRotX(rig.legUpper[i]) + reach * 0.52 * amount;
    // The knee folds hard as the foot lifts and straightens as it plants.
    rig.legLower[i].rotation.x = restRotX(rig.legLower[i]) - lift * 0.95 * amount;
    rig.legFoot[i].rotation.x = restRotX(rig.legFoot[i]) + lift * 0.7 * amount;
    // Sharpened lift curve: a leg spends most of its cycle planted and crosses
    // quickly, which is what separates a walk from a wave.
    rig.legs[i].position.y = restY(rig.legs[i]) + lift * lift * 0.95 * amount;
    // A little lateral reach, so the stride is legible from directly above.
    rig.legs[i].position.z = restZ(rig.legs[i]) + reach * 0.34 * amount;
  }

  // A crouched machine settles onto its legs; this is the safe-stop pose.
  if (docked) {
    for (let i = 0; i < rig.legs.length; i++) {
      rig.legUpper[i].rotation.x = restRotX(rig.legUpper[i]) - 0.24;
      rig.legLower[i].rotation.x = restRotX(rig.legLower[i]) + 0.3;
    }
  }

  // The hull settles twice per stride, a half cycle out of phase with the legs,
  // and rolls slightly onto whichever group is planted. Both are exaggerated
  // past physical accuracy because at this distance the body's motion is the
  // main cue that the machine has weight at all.
  const gaitAmount = docked ? 0 : clamp(normalized + 0.3, 0, 1);
  rig.body.position.y = restY(rig.body) + (docked ? -0.35 : Math.sin(t * 2) * 0.3 * gaitAmount);
  rig.body.rotation.z = docked ? 0 : Math.sin(t) * 0.075 * gaitAmount;
  rig.body.rotation.x = docked ? -0.1 : Math.sin(t * 2 + 1.1) * 0.05 * gaitAmount;

  // The furnace is the game's clearest state light: it breathes at march,
  // roars in overdrive, and dims when the tank is dry.
  // Integrated for the same reason as the gait: the rate steps from 3.1 to 9
  // the instant overdrive engages, and scaling a running clock by it would make
  // the furnace jump rather than quicken.
  rig.furnacePhase = (rig.furnacePhase + (overdrive ? 9 : 3.1) * dt) % TAU;
  const pulse = 0.75 + Math.sin(rig.furnacePhase) * (overdrive ? 0.25 : 0.12);
  const heat = furnaceHeat * pulse;
  rig.furnace.scale.setScalar(0.9 + heat * 0.22);
  // The furnace is an Object3D wrapper around its glow meshes, each of which
  // owns a private emissive material, so the brightness is set on the children.
  for (let i = 0; i < rig.furnace.children.length; i++) {
    const material = materialOf(rig.furnace.children[i]);
    if (!material?.color) continue;
    const level = clamp(0.28 + heat * 0.95, 0, 1.6);
    material.color.copy(material.userData.baseColor ?? cacheBaseColor(material));
    material.color.multiplyScalar(level);
  }

  rig.stackSwayPhase = (rig.stackSwayPhase + 0.7 * dt) % TAU;
  rig.stackPumpPhase = (rig.stackPumpPhase + (overdrive ? 6 : 2.4) * dt) % TAU;
  for (let i = 0; i < rig.smokestacks.length; i++) {
    const stack = rig.smokestacks[i];
    stack.rotation.y = Math.sin(rig.stackSwayPhase + i) * 0.06;
    stack.scale.y = 1 + Math.sin(rig.stackPumpPhase + i * 1.7) * 0.05;
  }
}

/**
 * Turret barrel traverse and recoil. `recoil` is 0..1 and decays externally so
 * the animation stays stateless. `folded` is recovery progress, 0..1.
 *
 * `rootScale` is the scale the caller wants on the root - the deploy pop and
 * the overload swell both live there. It has to be passed in because the fold
 * squashes Y against it: writing a bare 1 here, as this used to, silently ate
 * the caller's deploy scale on every frame of every turret's deployment.
 */
export function animateTurret(
  rig: TurretRig,
  heading: number,
  recoil: number,
  folded: number,
  rootScale = 1,
): void {
  rig.yoke.rotation.y = heading;
  rig.barrel.position.z = restZ(rig.barrel) - recoil * 0.24;
  rig.barrel.rotation.x = -0.06 - recoil * 0.12;

  if (rig.legs.length > 0) {
    for (let i = 0; i < rig.legs.length; i++) {
      const leg = rig.legs[i];
      leg.rotation.x = lerp(leg.userData.restRotationX ?? 0, 1.35, folded);
    }
  }
  rig.root.scale.set(rootScale, rootScale * lerp(1, 0.55, folded), rootScale);
}

/** Reads the material off a mesh-like Object3D without importing Mesh. */
export function materialOf(object: Object3D): AnimatedMaterial | null {
  const material = (object as unknown as { material?: AnimatedMaterial }).material;
  return material ?? null;
}

export interface AnimatedMaterial {
  color?: Color;
  opacity?: number;
  userData: Record<string, unknown> & { baseColor?: Color };
}

/**
 * Emissive materials are modulated by multiplying their colour, which is
 * destructive. Caching the authored colour on first touch lets the modulation
 * be recomputed from the original every frame instead of decaying to black.
 */
function cacheBaseColor(material: AnimatedMaterial): Color {
  const base = material.color!.clone();
  material.userData.baseColor = base;
  return base;
}

function easeIn(t: number): number {
  return t * t;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * Rest-pose readers with a self-healing fallback.
 *
 * Offsetting from an uncaptured `restY` yields `undefined + x`, which is NaN,
 * and a NaN in a transform removes the entire subtree from the render without
 * raising anything. That failure mode is far too quiet for how easy it is to
 * cause, so a missing capture is repaired on first read instead.
 */
function restY(object: Object3D): number {
  const value = object.userData.restY;
  if (typeof value === "number") return value;
  object.userData.restY = object.position.y;
  return object.position.y;
}

function restZ(object: Object3D): number {
  const value = object.userData.restZ;
  if (typeof value === "number") return value;
  object.userData.restZ = object.position.z;
  return object.position.z;
}

function restRotX(object: Object3D): number {
  const value = object.userData.restRotationX;
  if (typeof value === "number") return value;
  object.userData.restRotationX = object.rotation.x;
  return object.rotation.x;
}

/** Records the rest pose of a joint so animation can offset from it. */
export function captureRest(object: Object3D): void {
  object.userData.restY = object.position.y;
  object.userData.restZ = object.position.z;
  object.userData.restRotationX = object.rotation.x;
}

/**
 * Snapshots every joint a puppet animation offsets from. Must be called once
 * on a freshly built rig, before the first animation step, or the torso bob
 * will drift from an already-animated position.
 */
export function captureRigRest(rig: PuppetRig): void {
  captureRest(rig.root);
  captureRest(rig.torso);
  captureRest(rig.head);
  captureRest(rig.pelvis);
  captureRest(rig.armL);
  captureRest(rig.armR);
  captureRest(rig.forearmL);
  captureRest(rig.forearmR);
  captureRest(rig.legL);
  captureRest(rig.legR);
  captureRest(rig.shinL);
  captureRest(rig.shinR);
}

export function captureSpiderRest(rig: SpiderRig): void {
  captureRest(rig.body);
  for (const leg of rig.legs) captureRest(leg);
  for (const upper of rig.legUpper) captureRest(upper);
  for (const lower of rig.legLower) captureRest(lower);
  for (const foot of rig.legFoot) captureRest(foot);
}

export function captureTurretRest(rig: TurretRig): void {
  captureRest(rig.barrel);
  for (const leg of rig.legs) captureRest(leg);
}
