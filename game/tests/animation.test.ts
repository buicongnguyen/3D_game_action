import { Group, Object3D } from "three";
import { describe, expect, it } from "vitest";
import {
  animateHumanoid,
  animateImpostor,
  animateSpider,
  animateTurret,
  createImpostorState,
  createPuppetState,
  playAction,
  type ImpostorPose,
} from "../src/rendering/AnimationSystem.ts";
import type { PuppetRig } from "../src/art/characters.ts";
import type { SpiderRig, TurretRig } from "../src/art/machines.ts";

/**
 * Animation regression tests.
 *
 * These exist because an independent review found three defects in the
 * animation layer that no capture could ever have shown, and that nothing here
 * was checking. Every one of them was arithmetic rather than taste: a phase
 * that jumped, a height that flickered, a rate that changed the wrong quantity.
 * Amplitude and timing remain judgement calls for a human watching it move, but
 * continuity is not a judgement call, and continuity is what these assert.
 */

/**
 * A rig of bare nodes. The real builders need a material library and produce
 * geometry these tests would never look at; the animator only ever touches the
 * named joints, so plain `Object3D`s exercise exactly the code under test.
 */
function makeRig(): PuppetRig {
  const node = () => new Object3D();
  const root = new Group();
  const rig: PuppetRig = {
    root,
    torso: node(),
    head: node(),
    pelvis: node(),
    armL: node(),
    armR: node(),
    forearmL: node(),
    forearmR: node(),
    legL: node(),
    legR: node(),
    shinL: node(),
    shinR: node(),
    handL: node(),
    handR: node(),
    height: 1.8,
  };
  root.add(rig.torso, rig.pelvis, rig.legL, rig.legR);
  return rig;
}

function makeSpiderRig(): SpiderRig {
  const legs = Array.from({ length: 8 }, () => new Object3D());
  const legUpper = Array.from({ length: 8 }, () => new Object3D());
  const legLower = Array.from({ length: 8 }, () => new Object3D());
  const legFoot = Array.from({ length: 8 }, () => new Object3D());
  return {
    root: new Group(),
    body: new Object3D(),
    legs,
    legUpper,
    legLower,
    legFoot,
    furnace: new Object3D(),
    smokestacks: [new Object3D(), new Object3D()],
    rackSockets: [],
    moduleSockets: [],
    dorsalMount: new Object3D(),
    gaitPhase: 0,
    furnacePhase: 0,
    stackSwayPhase: 0,
    stackPumpPhase: 0,
  };
}

function makeTurretRig(): TurretRig {
  const legs = Array.from({ length: 4 }, () => new Object3D());
  for (const leg of legs) leg.userData.restRotationX = -0.1;
  return {
    root: new Group(),
    yoke: new Object3D(),
    barrel: new Object3D(),
    muzzle: new Object3D(),
    legs,
    gauge: new Object3D(),
  };
}

const STEP = 1 / 60;

const emptyPose = (): ImpostorPose => ({ squash: 1, lean: 0 });

/** Shortest signed distance between two angles, so wrapping is not a jump. */
function angleDelta(a: number, b: number): number {
  const tau = Math.PI * 2;
  let d = (b - a) % tau;
  if (d > Math.PI) d -= tau;
  if (d < -Math.PI) d += tau;
  return d;
}

describe("gait phase continuity", () => {
  it("does not jump when speed changes, however long the run has lasted", () => {
    // The original bug computed the pose angle as `elapsed * cadence`, so the
    // real angular velocity carried an error proportional to elapsed time. It
    // was invisible in the first seconds and enormous minutes later, which is
    // why only a long-running case catches it.
    const rig = makeRig();
    const state = createPuppetState(0.37);

    // Five simulated minutes at a walk.
    for (let i = 0; i < 60 * 300; i++) animateHumanoid(rig, state, STEP, 1.2, 5.5, false);

    const before = state.gaitPhase;
    // Sprint, from the very next frame.
    animateHumanoid(rig, state, STEP, 5.5, 5.5, false);
    const jump = Math.abs(angleDelta(before, state.gaitPhase));

    // One frame may advance by at most the fastest cadence times the step.
    const maxCadence = 4.2 + 1.4 * 5.4;
    expect(jump).toBeLessThanOrEqual(maxCadence * STEP + 1e-6);
  });

  it("advances at the cadence the speed implies", () => {
    const rig = makeRig();
    const state = createPuppetState(0);
    // Let the smoothed speed settle so cadence is at its steady value.
    for (let i = 0; i < 240; i++) animateHumanoid(rig, state, STEP, 5.5, 5.5, false);

    const before = state.gaitPhase;
    animateHumanoid(rig, state, STEP, 5.5, 5.5, false);
    const advanced = angleDelta(before, state.gaitPhase);

    expect(advanced).toBeCloseTo((4.2 + 1.0 * 5.4) * STEP, 4);
  });

  it("keeps the phase bounded rather than growing without limit", () => {
    const rig = makeRig();
    const state = createPuppetState(0.5);
    for (let i = 0; i < 60 * 600; i++) animateHumanoid(rig, state, STEP, 3, 5.5, false);
    expect(Math.abs(state.gaitPhase)).toBeLessThanOrEqual(Math.PI * 2);
  });

  it("de-syncs the horde: two puppets on the same speed stay out of phase", () => {
    const a = createPuppetState(0.0);
    const b = createPuppetState(0.5);
    const rigA = makeRig();
    const rigB = makeRig();
    for (let i = 0; i < 120; i++) {
      animateHumanoid(rigA, a, STEP, 3, 5.5, false);
      animateHumanoid(rigB, b, STEP, 3, 5.5, false);
    }
    expect(Math.abs(angleDelta(a.gaitPhase, b.gaitPhase))).toBeGreaterThan(0.5);
  });
});

describe("spider gait continuity", () => {
  it("does not jump when the speed mode steps", () => {
    // The spider's speed is assigned from discrete constants with no smoothing,
    // so a gear change is a step function - the worst possible input to the
    // original `clock * cadence` formulation.
    const rig = makeSpiderRig();
    for (let i = 0; i < 60 * 300; i++) animateSpider(rig, STEP, 1.25, false, false, 1);

    const before = rig.gaitPhase;
    animateSpider(rig, STEP, 2.0, true, false, 1);
    const jump = Math.abs(angleDelta(before, rig.gaitPhase));

    expect(jump).toBeLessThanOrEqual((1.55 + 1.3 * 1.5) * STEP + 1e-6);
  });

  it("does not snap the legs when the machine docks", () => {
    // Docking sets the cadence to zero. Under the old formulation that set the
    // pose angle to zero outright, teleporting all eight legs at every
    // checkpoint in the run.
    const rig = makeSpiderRig();
    for (let i = 0; i < 60 * 120; i++) animateSpider(rig, STEP, 1.25, false, false, 1);

    const before = rig.gaitPhase;
    animateSpider(rig, STEP, 0, false, true, 1);
    expect(Math.abs(angleDelta(before, rig.gaitPhase))).toBeLessThanOrEqual(1e-6);
  });

  it("holds the furnace pulse continuous across overdrive", () => {
    const rig = makeSpiderRig();
    for (let i = 0; i < 60 * 180; i++) animateSpider(rig, STEP, 1.25, false, false, 1);
    const before = rig.furnacePhase;
    animateSpider(rig, STEP, 2.0, true, false, 1);
    expect(Math.abs(angleDelta(before, rig.furnacePhase))).toBeLessThanOrEqual(9 * STEP + 1e-6);
  });
});

describe("impostor gait continuity", () => {
  it("does not jump when a distant enemy changes speed", () => {
    // The impostors were the one gait left running on a wall clock after F51:
    // a fixed 6 rad/s, so there was no phase to teleport. Driving them from real
    // speed reintroduces exactly the hazard F51 fixed, which is why this is
    // asserted here rather than assumed.
    const state = createImpostorState(0.37);
    const pose = emptyPose();

    for (let i = 0; i < 60 * 300; i++) animateImpostor(state, pose, STEP, 1.2, 5.5, 0);

    const before = state.gaitPhase;
    animateImpostor(state, pose, STEP, 5.5, 5.5, 0);
    const jump = Math.abs(angleDelta(before, state.gaitPhase));

    const maxCadence = 4.2 + 1.4 * 5.4;
    expect(jump).toBeLessThanOrEqual(maxCadence * STEP + 1e-6);
  });

  it("keeps the impostor phase bounded over a long run", () => {
    const state = createImpostorState(0.5);
    const pose = emptyPose();
    for (let i = 0; i < 60 * 600; i++) animateImpostor(state, pose, STEP, 3, 5.5, 0);
    expect(Math.abs(state.gaitPhase)).toBeLessThanOrEqual(Math.PI * 2);
  });

  it("stops bobbing when the enemy stops, and bobs hardest at a sprint", () => {
    // The defect this closes: the bob ran at one rate and one amplitude whether
    // the enemy was sprinting or standing at a barricade swinging, so past the
    // puppet budget nothing on screen was tied to how the enemy moved.
    const still = createImpostorState(0.1);
    const running = createImpostorState(0.1);
    const stillPose = emptyPose();
    const runningPose = emptyPose();

    let stillPeak = 0;
    let runningPeak = 0;
    // Two seconds, which is several strides, so the peak is really the peak.
    for (let i = 0; i < 120; i++) {
      animateImpostor(still, stillPose, STEP, 0, 5.5, 0);
      animateImpostor(running, runningPose, STEP, 5.5, 5.5, 0);
      stillPeak = Math.max(stillPeak, Math.abs(stillPose.squash - 1));
      runningPeak = Math.max(runningPeak, Math.abs(runningPose.squash - 1));
    }

    expect(stillPeak).toBeLessThan(1e-3);
    expect(runningPeak).toBeGreaterThan(0.05);
    expect(stillPose.lean).toBeLessThan(1e-3);
    expect(runningPose.lean).toBeGreaterThan(0.1);
  });

  it("de-syncs two impostors on the same speed", () => {
    const a = createImpostorState(0);
    const b = createImpostorState(0.5);
    const poseA = emptyPose();
    const poseB = emptyPose();
    for (let i = 0; i < 120; i++) {
      animateImpostor(a, poseA, STEP, 3, 5.5, 0);
      animateImpostor(b, poseB, STEP, 3, 5.5, 0);
    }
    expect(Math.abs(angleDelta(a.gaitPhase, b.gaitPhase))).toBeGreaterThan(0.5);
  });
});

describe("action pose blending", () => {
  /** Frame-to-frame change in one joint, sampled across `frames` steps. */
  function sampleDeltas(
    rig: PuppetRig,
    state: ReturnType<typeof createPuppetState>,
    read: () => number,
    frames: number,
    speed: number,
  ): number[] {
    const deltas: number[] = [];
    let previous = read();
    for (let i = 0; i < frames; i++) {
      animateHumanoid(rig, state, STEP, speed, 5.5, false);
      deltas.push(Math.abs(read() - previous));
      previous = read();
    }
    return deltas;
  }

  it("does not snap the torso back to the gait when an attack expires", () => {
    // `attack` held the torso at -0.5 rad through its recovery and then wrote
    // the locomotion value the frame the timer ran out - about half a radian in
    // one step, on every attack of every enemy in the horde.
    const rig = makeRig();
    const state = createPuppetState(0.2);
    for (let i = 0; i < 120; i++) animateHumanoid(rig, state, STEP, 4, 5.5, false);

    playAction(state, "attack", 0.5);
    // 0.5 s of action plus a little, so the expiry frame is inside the window.
    const deltas: number[] = [];
    let expiry = -1;
    let previous = rig.torso.rotation.y;
    for (let i = 0; i < 36; i++) {
      const acting = state.action === "attack";
      animateHumanoid(rig, state, STEP, 4, 5.5, false);
      const delta = Math.abs(rig.torso.rotation.y - previous);
      previous = rig.torso.rotation.y;
      if (acting && state.action === "none") expiry = delta;
      else deltas.push(delta);
    }
    expect(expiry).toBeGreaterThanOrEqual(0);

    // The hand-off back to locomotion may not move the torso further than the
    // frames that led into it. The blend-out is a deliberate 0.5 rad over 120 ms
    // and measures about 0.064 rad a frame; the hand-off measures a gait step,
    // about 0.026. Unblended it is the whole 0.5 rad in one frame, against a
    // recovery that holds the torso perfectly still.
    const duringRecovery = Math.max(...deltas.slice(18));
    expect(expiry).toBeLessThanOrEqual(duringRecovery);
    expect(expiry).toBeLessThan(0.05);
  });

  it("eases the shoot pose in rather than writing absolute arm angles", () => {
    // `shoot` wrote -1.35 to the arm on its first frame whatever the arm was
    // doing, so the pose arrived in one step from wherever the swing had it.
    const rig = makeRig();
    const state = createPuppetState(0.42);
    for (let i = 0; i < 120; i++) animateHumanoid(rig, state, STEP, 5.5, 5.5, false);

    playAction(state, "shoot", 0.5);
    const deltas = sampleDeltas(rig, state, () => rig.armR.rotation.x, 8, 5.5);

    // Continuity is relative: the first frame of an 80 ms ramp is allowed to
    // move as far as the rest of that ramp does, and no further. Unblended it
    // moves the whole pose distance at once while later frames only carry the
    // recoil, which is the shape this separates.
    const rest = Math.max(...deltas.slice(1, 5));
    expect(deltas[0]).toBeLessThanOrEqual(rest * 1.5);
  });

  it("still holds the death pose after its timer expires", () => {
    // Death is exempt from the blend-out on purpose - a corpse is held, and a
    // ramp keyed to a timer that has already run out would stand it back up.
    const rig = makeRig();
    const state = createPuppetState(0.3);
    playAction(state, "death", 0.9);
    for (let i = 0; i < 60; i++) animateHumanoid(rig, state, STEP, 0, 5.5, false);
    const settled = rig.root.rotation.x;

    for (let i = 0; i < 120; i++) animateHumanoid(rig, state, STEP, 0, 5.5, false);
    expect(state.action).toBe("death");
    expect(rig.root.rotation.x).toBeCloseTo(settled, 6);
  });

  it("leaves no residue on the root once an action is over", () => {
    // The root's position and rotation are written only by actions, so with a
    // blend in front of them the pose being blended against is last frame's own
    // output unless locomotion resets them. That feedback loop freezes a small
    // offset in place for the rest of the character's life.
    const rig = makeRig();
    const state = createPuppetState(0.6);
    playAction(state, "dodge", 0.28);
    for (let i = 0; i < 60; i++) animateHumanoid(rig, state, STEP, 3, 5.5, false);

    expect(state.action).toBe("none");
    expect(rig.root.position.y).toBe(0);
    expect(rig.root.rotation.x).toBe(0);
    expect(state.rootY).toBe(0);
  });

  it("still starts the spawn rise underground on its first frame", () => {
    // The other exemption: `awaken` opens 1.35 m below the ground, so easing it
    // in would show the body at ground level and then sink it before the rise.
    const rig = makeRig();
    const state = createPuppetState(0.1);
    playAction(state, "awaken", 1.1);
    animateHumanoid(rig, state, STEP, 0, 5.5, false);
    expect(rig.root.position.y).toBeLessThan(-1.2);
  });
});

describe("structure fold", () => {
  it("folds the legs and squashes the machine against the caller's scale", () => {
    // `folded` was implemented here and never driven; the deploy pop was also
    // being eaten, because the fold used to write an absolute root scale over
    // whatever the caller had just set.
    const rig = makeTurretRig();

    animateTurret(rig, 0, 0, 0, 0.6);
    expect(rig.root.scale.y).toBeCloseTo(0.6, 6);
    expect(rig.legs[0].rotation.x).toBeCloseTo(-0.1, 6);

    animateTurret(rig, 0, 0, 1, 1);
    expect(rig.root.scale.y).toBeCloseTo(0.55, 6);
    expect(rig.root.scale.x).toBeCloseTo(1, 6);
    expect(rig.legs[0].rotation.x).toBeCloseTo(1.35, 6);
  });
});

describe("root height across an LOD stride", () => {
  it("publishes the posed root height so a skipped frame can reapply it", () => {
    // Distant enemies animate every second or fourth frame while their world
    // transform - which zeroes root Y - is written every frame. Unless the
    // animator hands the height back, the spawn rise strobes.
    const rig = makeRig();
    const state = createPuppetState(0.1);
    playAction(state, "awaken", 0.9);
    animateHumanoid(rig, state, STEP, 0, 5.5, false);

    expect(state.rootY).toBeLessThan(0);
    expect(state.rootY).toBe(rig.root.position.y);
  });

  it("reports zero for poses that do not lift the root", () => {
    const rig = makeRig();
    const state = createPuppetState(0.1);
    for (let i = 0; i < 30; i++) animateHumanoid(rig, state, STEP, 3, 5.5, false);
    expect(state.rootY).toBe(0);
  });

  it("keeps the death pose height stable between animated frames", () => {
    const rig = makeRig();
    const state = createPuppetState(0.1);
    playAction(state, "death", 0.9);
    for (let i = 0; i < 40; i++) animateHumanoid(rig, state, STEP, 0, 5.5, false);

    const settled = state.rootY;
    expect(settled).toBeLessThan(0);

    // A skipped frame: the caller zeroes Y, then restores it from the state.
    rig.root.position.y = 0;
    rig.root.position.y = state.rootY;
    expect(rig.root.position.y).toBe(settled);
  });
});
