import { describe, expect, it } from "vitest";
import { GameWorld } from "../src/game/GameWorld.ts";
import { PlayerMovementSystem } from "../src/game/systems/PlayerMovementSystem.ts";
import { SpiderMovementSystem } from "../src/game/systems/SpiderMovementSystem.ts";
import { ConstructionSystem } from "../src/game/systems/ConstructionSystem.ts";
import { InteractionSystem } from "../src/game/systems/InteractionSystem.ts";
import { PressureNetworkSystem } from "../src/game/systems/PressureNetworkSystem.ts";
import { RunStateSystem, emitNoise } from "../src/game/systems/RunStateSystem.ts";
import { HordeDirector } from "../src/game/systems/HordeDirector.ts";
import {
  EnemyNavigationSystem,
  damageSpider,
  setEnemyDamageSink,
} from "../src/game/systems/EnemyNavigationSystem.ts";
import { WeaponSystem } from "../src/game/systems/WeaponSystem.ts";
import { StructureCombatSystem } from "../src/game/systems/StructureCombatSystem.ts";
import { CollisionSystem } from "../src/game/systems/CollisionSystem.ts";
import { DamageSystem } from "../src/game/systems/DamageSystem.ts";
import { ExperienceSystem } from "../src/game/systems/ExperienceSystem.ts";
import { createEmptySnapshot, type InputSnapshot } from "../src/input/InputActions.ts";
import { PICKUPS, PLAYER, PRESSURE, SIM, SPIDER, STRUCTURES, TRAIL } from "../src/data/balance.ts";
import type { GameEvent } from "../src/core/events.ts";
import type { RunMode } from "../src/core/types.ts";

/**
 * Whole-loop integration tests.
 *
 * These drive the real system stack in the real order, headlessly, with no
 * renderer. That is the only way to assert on the thing the project is actually
 * judged by - "is it fun, clear and tense to leapfrog two turrets forward while
 * the spider keeps walking" - as a reproducible check rather than as an
 * impression from a play session.
 */

const STEP = SIM.fixedStep;

/** The full system stack, wired in the §16.4 order. */
class Harness {
  readonly world: GameWorld;
  readonly input: InputSnapshot = createEmptySnapshot();
  readonly events: GameEvent[] = [];

  private readonly playerMovement: PlayerMovementSystem;
  private readonly spiderMovement = new SpiderMovementSystem();
  readonly construction = new ConstructionSystem();
  readonly interaction: InteractionSystem;
  private readonly pressure = new PressureNetworkSystem();
  readonly runState = new RunStateSystem();
  readonly director = new HordeDirector();
  private readonly enemyNavigation = new EnemyNavigationSystem();
  private readonly weapons = new WeaponSystem();
  private readonly structureCombat = new StructureCombatSystem();
  private readonly collision: CollisionSystem;
  private readonly damage: DamageSystem;
  private readonly experience = new ExperienceSystem();

  constructor(seed: number, options: { spawns?: boolean; mode?: RunMode } = {}) {
    this.world = new GameWorld(seed, options.mode);
    this.playerMovement = new PlayerMovementSystem(this.construction);
    this.interaction = new InteractionSystem(this.construction);
    this.damage = new DamageSystem(this.interaction);
    this.collision = new CollisionSystem(this.damage);
    // Wired exactly as Game does it. Without this the enemy AI resolves melee
    // through its own fallback and the run can never end in defeat.
    setEnemyDamageSink(this.damage);
    this.spawnsEnabled = options.spawns ?? true;

    // A fixed camera basis: forward is +Z, right is +X. Real play feeds the
    // live camera, but a test must not depend on renderer state.
    this.playerMovement.setCameraBasis(0, 1, 1, 0);
    this.construction.setCameraBasis(0, 1, 1, 0);

    this.world.events.onAny((event) => this.events.push(event));

    this.world.route.start();
    this.runState.departCheckpoint(this.world, "seg.approach");
    this.world.spider.docked = false;
    const spline = this.world.route.spline!;
    const point = { x: 0, z: 0 };
    spline.positionAt(point, 0);
    this.world.player.x = point.x + 2;
    this.world.player.z = point.z + 3;
    this.world.player.prevX = this.world.player.x;
    this.world.player.prevZ = this.world.player.z;
  }

  spawnsEnabled: boolean;

  step(count = 1): void {
    for (let i = 0; i < count; i++) {
      const world = this.world;
      const dt = STEP * world.timeScale;

      this.runState.update(world, dt);
      this.spiderMovement.update(world, dt);
      this.playerMovement.update(world, dt, this.input);
      this.construction.update(world, dt, this.input);
      this.interaction.update(world, dt, this.input);
      this.interaction.collectPickups(world, dt);
      this.pressure.update(world, dt);
      if (this.spawnsEnabled) {
        this.director.update(world, dt, this.runState.budgetPerSecond(world));
      }
      this.enemyNavigation.setFocus(world.player.x, world.player.z);
      this.enemyNavigation.update(world, dt);
      this.weapons.update(world, dt);
      this.structureCombat.update(world, dt);
      this.collision.update(world, dt);
      this.damage.update(world, dt);
      this.experience.update(world, dt);
      world.events.drain();
      world.tick++;
      this.clearEdges();
    }
  }

  seconds(value: number): void {
    this.step(Math.round(value / STEP));
  }

  /** Presses an action for exactly one step. */
  press(action: keyof InputSnapshot["buttons"]): void {
    const button = this.input.buttons[action];
    button.pressed = true;
    button.held = true;
    button.value = 1;
  }

  hold(action: keyof InputSnapshot["buttons"], held: boolean): void {
    const button = this.input.buttons[action];
    button.held = held;
    button.value = held ? 1 : 0;
  }

  stick(which: "leftStick" | "rightStick", x: number, y: number): void {
    const stick = this.input[which];
    stick.x = x;
    stick.y = y;
    stick.magnitude = Math.min(1, Math.hypot(x, y));
    stick.active = stick.magnitude > 0;
  }

  /** Edge flags last exactly one step, as the real InputManager guarantees. */
  private clearEdges(): void {
    for (const key of Object.keys(this.input.buttons) as Array<keyof InputSnapshot["buttons"]>) {
      const button = this.input.buttons[key];
      button.pressed = false;
      button.released = false;
      if (button.held) button.heldFor += STEP;
      else button.heldFor = 0;
    }
  }

  /** Teleports the engineer, for setting up a scenario without walking there. */
  placePlayerNear(x: number, z: number): void {
    this.world.player.x = x;
    this.world.player.z = z;
    this.world.player.prevX = x;
    this.world.player.prevZ = z;
  }

  countEvents(type: GameEvent["type"]): number {
    return this.events.filter((event) => event.type === type).length;
  }
}

describe("the march", () => {
  it("advances the spider at the specified speed and burns fuel at the specified rate", () => {
    const harness = new Harness(1234, { spawns: false });
    const startFuel = harness.world.spider.fuel;

    harness.seconds(10);

    expect(harness.world.spider.distanceAlongRoute).toBeCloseTo(SPIDER.speedMarch * 10, 1);
    expect(startFuel - harness.world.spider.fuel).toBeCloseTo(SPIDER.fuelPerSecondMarch * 10, 1);
  });

  it("moves the spider along the spline independently of any animation", () => {
    const harness = new Harness(99, { spawns: false });
    harness.seconds(20);
    const spider = harness.world.spider;
    const spline = harness.world.route.spline!;
    const expected = { x: 0, z: 0 };
    spline.positionAt(expected, spider.distanceAlongRoute);
    expect(spider.x).toBeCloseTo(expected.x, 3);
    expect(spider.z).toBeCloseTo(expected.z, 3);
  });

  it("drops to the fallback crawl and burns scrap rather than stalling when fuel runs out", () => {
    const harness = new Harness(7, { spawns: false });
    harness.world.spider.fuel = 0.01;
    const scrapBefore = harness.world.resources.scrap;

    harness.seconds(3);

    expect(harness.world.spider.speedMode).toBe("fallback");
    expect(harness.world.spider.speed).toBeCloseTo(SPIDER.speedFallback, 3);
    expect(harness.world.resources.scrap).toBeLessThan(scrapBefore);
    // A dry tank must never be a soft-lock: the spider still moves.
    expect(harness.world.spider.distanceAlongRoute).toBeGreaterThan(0.5);
  });

  it("pulls a straying engineer back instead of killing them", () => {
    const harness = new Harness(42, { spawns: false });
    harness.placePlayerNear(harness.world.spider.x + 60, harness.world.spider.z);
    harness.seconds(2);

    const distance = Math.hypot(
      harness.world.player.x - harness.world.spider.x,
      harness.world.player.z - harness.world.spider.z,
    );
    expect(distance).toBeLessThan(60);
    expect(harness.world.player.health).toBeGreaterThan(0);
    expect(harness.countEvents("player.tethered")).toBeGreaterThan(0);
  });

  it("allows exploration thirty metres from the spider before the tether engages", () => {
    const harness = new Harness(43, { spawns: false });
    harness.placePlayerNear(harness.world.spider.x + 30, harness.world.spider.z);
    harness.step();

    expect(harness.world.player.tethered).toBe(false);
    expect(harness.countEvents("player.tethered")).toBe(0);
    expect(Math.hypot(
      harness.world.player.x - harness.world.spider.x,
      harness.world.player.z - harness.world.spider.z,
    )).toBeGreaterThan(29);
  });

  it("drops a carried machine as a recoverable folded structure at the tether", () => {
    const harness = new Harness(4242, { spawns: false });
    const placedBefore = harness.world.stats.structuresPlaced;
    harness.world.player.carry = {
      kind: "structure",
      structureType: "rivetTurret",
      health: 0.55,
      buffer: 9,
      recoveryXpGranted: false,
    };
    harness.placePlayerNear(
      harness.world.spider.x + PLAYER.tetherDistance + 2,
      harness.world.spider.z,
    );

    harness.step();

    expect(harness.world.player.carry.kind).toBe("none");
    expect(harness.world.structures).toHaveLength(1);
    const dropped = harness.world.structures[0];
    expect(dropped.state).toBe("dropped");
    expect(dropped.health / dropped.maxHealth).toBeCloseTo(0.55, 3);
    expect(dropped.buffer).toBeCloseTo(9, 3);
    expect(harness.world.stats.structuresPlaced).toBe(placedBefore);

    // Bring the dropped object into a safe test position and recover it through
    // the same fold input used for every other machine.
    dropped.x = harness.world.spider.x + 1;
    dropped.z = harness.world.spider.z;
    harness.placePlayerNear(dropped.x, dropped.z + 0.5);
    harness.hold("fold", true);
    harness.seconds(PLAYER.foldDuration + 0.2);
    harness.hold("fold", false);

    expect(harness.world.structures).toHaveLength(0);
    expect(harness.world.player.carry.kind).toBe("structure");
  });
});

describe("the engineering loop", () => {
  /** Places a turret next to the engineer, the way the radial flow would. */
  function buildTurret(harness: Harness, offsetX: number, offsetZ: number) {
    const player = harness.world.player;
    return harness.construction.spawnStructure(
      harness.world,
      "rivetTurret",
      Math.round((player.x + offsetX) * 2) / 2,
      Math.round((player.z + offsetZ) * 2) / 2,
      0,
      1,
      -1,
    );
  }

  it("places a turret in three actions after the radial opens, with no mouse", () => {
    const harness = new Harness(2024, { spawns: false });
    harness.world.resources.scrap = 200;

    // 1. hold L1 to open the radial
    harness.hold("buildRadial", true);
    harness.step(2);
    expect(harness.world.build.radialOpen).toBe(true);
    // Time slows while choosing, which is what makes this survivable under fire.
    expect(harness.world.timeScale).toBeCloseTo(0.2, 5);

    // 2. flick the right stick to the top slice (the turret)
    harness.stick("rightStick", 0, -1);
    harness.step(2);
    expect(harness.world.build.radialIndex).toBe(0);

    // 3. release L1, steer briefly, confirm with Cross
    harness.hold("buildRadial", false);
    harness.stick("rightStick", 0, 0);
    harness.step(2);
    expect(harness.world.build.ghostActive).toBe(true);

    harness.press("confirm");
    harness.step(2);

    expect(harness.world.structures.length).toBe(1);
    expect(harness.world.structures[0].kind).toBe("rivetTurret");
    expect(harness.world.timeScale).toBe(1);
  });

  it("selects blueprint slots directly from the keyboard number row", () => {
    const harness = new Harness(2025, { spawns: false });
    harness.world.loadout.push("relay", "barricade");
    harness.input.blueprintSlot = 2;
    harness.step();
    expect(harness.world.build.selectedBlueprint).toBe(2);
    expect(harness.world.loadout[2]).toBe("barricade");
  });

  it("charges scrap and refuses a placement that cannot be afforded", () => {
    const harness = new Harness(5, { spawns: false });
    harness.world.resources.scrap = 10;

    harness.hold("buildRadial", true);
    harness.step(2);
    harness.hold("buildRadial", false);
    harness.step(2);

    expect(harness.world.build.ghostActive).toBe(false);
    expect(harness.countEvents("build.rejected")).toBeGreaterThan(0);
  });

  it("marks a turret placed ahead of the spider as unpowered, then powers it on arrival", () => {
    const harness = new Harness(88, { spawns: false });
    harness.world.resources.scrap = 200;

    // 30 m ahead is well outside the 10 m service radius.
    const spline = harness.world.route.spline!;
    const ahead = { x: 0, z: 0 };
    spline.positionAt(ahead, harness.world.spider.distanceAlongRoute + 30);
    harness.placePlayerNear(ahead.x, ahead.z);

    const turret = buildTurret(harness, 2, 0);
    harness.seconds(1);
    expect(turret.powered).toBe(false);

    // Let the spider walk up to it. This is the leapfrog paying off.
    harness.seconds(28);
    expect(turret.powered).toBe(true);
    expect(turret.buffer).toBeGreaterThan(0);
  });

  it("drains a stranded turret's buffer and starves it on a legible countdown", () => {
    const harness = new Harness(31, { spawns: false });
    harness.world.resources.scrap = 200;
    // Inside the tether radius: past it the engineer is dragged back mid-action,
    // which is correct behaviour but makes the scenario untestable.
    harness.placePlayerNear(harness.world.spider.x + 9, harness.world.spider.z + 9);
    const turret = buildTurret(harness, 1, 0);
    turret.state = "active";
    turret.buffer = 4;

    harness.seconds(5);

    expect(turret.buffer).toBe(0);
    expect(turret.state).toBe("starved");
    expect(harness.countEvents("structure.bufferEmpty")).toBe(1);
  });

  it("folds, carries and reinstalls a turret, preserving its wear", () => {
    const harness = new Harness(4242, { spawns: false });
    harness.world.resources.scrap = 200;

    // A dry spider produces no pressure, so the buffer under test cannot be
    // topped up by the network between setup and assertion.
    harness.world.spider.fuel = 0;
    const turret = buildTurret(harness, 1.2, 0);
    turret.state = "active";
    turret.health = turret.maxHealth * 0.5;
    turret.buffer = 12;
    const scrapAfterBuild = harness.world.resources.scrap;

    harness.hold("fold", true);
    harness.seconds(2);
    harness.hold("fold", false);

    expect(harness.world.structures.length).toBe(0);
    expect(harness.world.player.carry.kind).toBe("structure");
    if (harness.world.player.carry.kind === "structure") {
      expect(harness.world.player.carry.health).toBeCloseTo(0.5, 2);
      // Drains while the fold plays out, which is the point: wear carries over.
      expect(harness.world.player.carry.buffer).toBeGreaterThan(9);
      expect(harness.world.player.carry.buffer).toBeLessThanOrEqual(12);
    }

    harness.press("confirm");
    harness.step(3);

    expect(harness.world.structures.length).toBe(1);
    expect(harness.world.player.carry.kind).toBe("none");
    // Reinstalling is free; the scrap was spent when it was first built. The
    // small drift is the dry spider burning scrap to crawl, set up above.
    expect(harness.world.resources.scrap).toBeGreaterThan(scrapAfterBuild - 5);
    const reinstalled = harness.world.structures[0];
    expect(reinstalled.health / reinstalled.maxHealth).toBeCloseTo(0.5, 1);
    expect(reinstalled.buffer).toBeGreaterThan(9);
  });

  it("awards recovery XP only once for the same physical machine", () => {
    const harness = new Harness(5252, { spawns: false });
    harness.world.resources.scrap = 200;
    const turret = buildTurret(harness, 1.2, 0);
    turret.state = "active";
    harness.step(); // subscribe ExperienceSystem and consume the original build event
    harness.world.progress.xp = 0;

    harness.hold("fold", true);
    harness.seconds(PLAYER.foldDuration + 0.2);
    harness.hold("fold", false);
    expect(harness.world.progress.xp).toBe(5);

    harness.press("confirm");
    harness.step(3);
    const reinstalled = harness.world.structures[0];
    expect(reinstalled.recoveryXpGranted).toBe(true);
    harness.placePlayerNear(reinstalled.x, reinstalled.z + 0.5);
    harness.hold("fold", true);
    harness.seconds(PLAYER.foldDuration + 0.2);
    harness.hold("fold", false);

    expect(harness.world.progress.xp).toBe(5);
  });

  it("finds a nearby spot rather than refusing when the drop point is occupied", () => {
    const harness = new Harness(8181, { spawns: false });
    const world = harness.world;
    world.resources.scrap = 300;

    // Something already standing exactly where the carried machine would land.
    const blocker = buildTurret(harness, 0, 0);
    blocker.state = "active";
    const carried = buildTurret(harness, 3.2, 0);
    carried.state = "active";
    harness.placePlayerNear(carried.x, carried.z + 1);

    harness.hold("fold", true);
    harness.seconds(2);
    harness.hold("fold", false);
    expect(world.player.carry.kind).toBe("structure");

    // Face the blocker, so straight ahead is unavailable.
    world.player.heading = Math.atan2(blocker.x - world.player.x, blocker.z - world.player.z);
    harness.press("confirm");
    harness.step(3);

    // It went down somewhere legal rather than being refused.
    expect(world.player.carry.kind).toBe("none");
    expect(world.structures.length).toBe(2);
    const placed = world.structures.find((s) => s.id !== blocker.id)!;
    expect(placed).toBeDefined();
    // Still within arm's reach of where the player was standing.
    expect(Math.hypot(placed.x - world.player.x, placed.z - world.player.z)).toBeLessThan(
      PLAYER.buildRange + 1,
    );
  });

  it("carries exactly one object at a time", () => {
    const harness = new Harness(606, { spawns: false });
    harness.world.resources.scrap = 200;
    const first = buildTurret(harness, 1.2, 0);
    first.state = "active";

    harness.hold("fold", true);
    harness.seconds(2);
    harness.hold("fold", false);
    expect(harness.world.player.carry.kind).toBe("structure");

    const second = buildTurret(harness, -1.4, 0);
    second.state = "active";
    harness.hold("fold", true);
    harness.seconds(2);
    harness.hold("fold", false);

    // The second turret is still standing: hands were already full.
    expect(harness.world.structures.length).toBe(1);
  });

  it("recharges a starved turret from a carried cylinder", () => {
    const harness = new Harness(777, { spawns: false });
    harness.world.resources.scrap = 200;
    // Inside the tether radius: past it the engineer is dragged back mid-action,
    // which is correct behaviour but makes the scenario untestable.
    harness.placePlayerNear(harness.world.spider.x + 9, harness.world.spider.z + 9);

    const turret = buildTurret(harness, 1.2, 0);
    turret.state = "starved";
    turret.buffer = 0;
    harness.world.player.carry = { kind: "cylinder" };

    harness.hold("service", true);
    harness.seconds(2);
    harness.hold("service", false);

    // A cylinder is a whole cycle of autonomy, not a top-up; the couple of
    // seconds that drain while walking over are noise against that.
    expect(turret.buffer).toBeGreaterThan(PRESSURE.cylinderCharge * 0.9);
    expect(turret.state).toBe("active");
    expect(harness.world.player.carry.kind).toBe("none");
  });

  it("repairs a damaged turret for scrap, in one consequential action", () => {
    const harness = new Harness(303, { spawns: false });
    harness.world.resources.scrap = 200;
    const turret = buildTurret(harness, 1.2, 0);
    turret.state = "active";
    turret.health = turret.maxHealth * 0.2;
    const scrapBefore = harness.world.resources.scrap;

    harness.hold("service", true);
    harness.seconds(1.2);
    harness.hold("service", false);

    // One hold must buy a large, obvious result, not a sliver.
    expect(turret.health / turret.maxHealth).toBeGreaterThan(0.4);
    expect(harness.world.resources.scrap).toBeLessThan(scrapBefore);
  });

  it("triggers Last Shot on an abandoned turret and detonates it", () => {
    const harness = new Harness(9090, { spawns: false });
    harness.world.resources.scrap = 200;
    const turret = buildTurret(harness, 1.2, 0);
    turret.state = "active";
    turret.health *= 0.5;
    const id = turret.id;

    // Exercise the public input path: Recover used to return before Last Shot
    // could ever become the advertised primary action.
    harness.press("confirm");
    harness.step();
    expect(turret.state).toBe("overloading");

    harness.seconds(STRUCTURES.rivetTurret.lastShotDuration + 0.5);

    expect(harness.countEvents("structure.lastShot")).toBe(1);
    expect(harness.countEvents("structure.exploded")).toBe(1);
    expect(harness.world.findStructure(id)).toBeUndefined();
    expect(harness.world.stats.lastShotsTriggered).toBe(1);
  });

  it("warns when a foldable structure is left behind by the march", () => {
    const harness = new Harness(1717, { spawns: false });
    harness.world.resources.scrap = 200;
    const turret = buildTurret(harness, 1.2, 0);
    turret.state = "active";

    harness.seconds(20);

    expect(turret.behindSpider).toBe(true);
    expect(harness.countEvents("structure.leftBehind")).toBeGreaterThan(0);
  });
});

describe("the leapfrog, end to end", () => {
  /**
   * The project's own decisive test, run as code: place a turret ahead, let the
   * spider pass the rear one, recover it, carry it forward and reinstall it,
   * all without a mouse and while the spider keeps walking.
   */
  it("leapfrogs two turrets forward across a stretch while the spider keeps moving", () => {
    const harness = new Harness(20260816, { spawns: false });
    const world = harness.world;
    world.resources.scrap = 300;

    const spline = world.route.spline!;
    const point = { x: 0, z: 0 };
    const startDistance = world.spider.distanceAlongRoute;

    const placeAhead = (metresAhead: number) => {
      spline.positionAt(point, world.spider.distanceAlongRoute + metresAhead);
      harness.placePlayerNear(point.x, point.z);
      const structure = harness.construction.spawnStructure(
        world,
        "rivetTurret",
        Math.round((point.x + 1.5) * 2) / 2,
        Math.round(point.z * 2) / 2,
        0,
        1,
        -1,
      );
      structure.state = "active";
      return structure;
    };

    const rear = placeAhead(6);
    const front = placeAhead(20);
    expect(world.structures.length).toBe(2);

    // Walk the spider past the rear turret.
    harness.seconds(14);
    expect(rear.behindSpider).toBe(true);

    // Go back for it while it is still inside the tether. That window - about
    // thirteen seconds of march after the spider passes - is the whole cost of
    // recovering a machine, and it is why abandoning one is a real option.
    expect(
      Math.hypot(rear.x - world.spider.x, rear.z - world.spider.z),
    ).toBeLessThan(22);
    harness.placePlayerNear(rear.x, rear.z + 1);
    harness.hold("fold", true);
    harness.seconds(2);
    harness.hold("fold", false);
    expect(world.player.carry.kind).toBe("structure");

    // Reinstall inside the tether. Carrying a machine past 22 m makes the
    // engineer drop it, which is the rule that stops a player from ferrying a
    // turret arbitrarily far ahead of the expedition.
    spline.positionAt(point, world.spider.distanceAlongRoute + 15);
    harness.placePlayerNear(point.x, point.z);
    harness.press("confirm");
    harness.step(3);

    expect(world.player.carry.kind).toBe("none");
    expect(world.structures.length).toBe(2);
    expect(world.stats.structuresRecovered).toBe(1);

    // The front turret is now the rear one; abandon it with a Last Shot.
    harness.seconds(20);
    expect(front.behindSpider).toBe(true);
    harness.interaction.triggerLastShot(world, front.id, "manual");
    harness.seconds(STRUCTURES.rivetTurret.lastShotDuration + 0.5);

    expect(world.stats.lastShotsTriggered).toBe(1);
    expect(world.structures.length).toBe(1);
    // The whole sequence happened while the expedition kept moving.
    expect(world.spider.distanceAlongRoute).toBeGreaterThan(startDistance + 50);
  });
});

describe("trail and pursuit", () => {
  /**
   * The passive rate alone cannot reach HEAVY, because a checkpoint clamps the
   * Trail back to ~17 roughly every 140 seconds and 0.3/s only buys about 42 in
   * that time. That is the intended shape: escalation is driven by the noise the
   * expedition makes, so a quiet, efficient run genuinely is a calmer one. This
   * test therefore runs a real fight rather than an idle march.
   */
  it("escalates through every named state and reaches PURSUIT when the run is noisy", () => {
    const harness = new Harness(50505, { spawns: false });
    const world = harness.world;

    const seen = new Set<string>();
    world.events.on("trail.stateChanged", (event) => seen.add(event.to));

    // A defended, working expedition at roughly the noise a pair of firing
    // turrets and regular building produces. The passive rate alone never gets
    // here, and that is the design: a quiet run is genuinely a calmer one.
    for (let i = 0; i < 6000 && world.trailState !== "PURSUIT"; i++) {
      emitNoise(world, 0.02, world.spider.x, world.spider.z, "test.combat");
      harness.step(1);
    }

    expect(seen.has("PROBING")).toBe(true);
    expect(seen.has("SWARM")).toBe(true);
    expect(seen.has("HEAVY")).toBe(true);
    expect(world.trailState).toBe("PURSUIT");
    expect(world.trail).toBe(TRAIL.max);
  });

  it("forces Pursuit on the final escape leg regardless of how quiet the run was", () => {
    const harness = new Harness(1212, { spawns: false });
    harness.runState.departCheckpoint(harness.world, "seg.escape");
    expect(harness.world.phase).toBe("FINAL_ESCAPE");
    harness.world.trail = 0;

    harness.seconds(20);

    expect(harness.world.trail).toBe(TRAIL.max);
    expect(harness.world.trailState).toBe("PURSUIT");
  });

  it("keeps spawning under Pursuit without ever declaring a timed loss", () => {
    const harness = new Harness(60606);
    harness.world.trail = TRAIL.max;
    // A core deep enough to outlast the window. The point of this test is that
    // nothing ends the run on a clock; an undefended spider dying to the horde
    // is the intended outcome and is covered separately.
    harness.world.spider.maxCoreHealth = 1e7;
    harness.world.spider.coreHealth = 1e7;

    harness.seconds(90);

    expect(harness.world.enemies.active).toBeGreaterThan(0);
    // Pressure, not a clock: nothing ends the run on time alone.
    expect(harness.countEvents("run.ended")).toBe(0);
    expect(harness.world.enemies.exhaustions).toBe(0);
  });

  it("spawns enemies behind the march far more often than ahead during Pursuit", () => {
    const harness = new Harness(70707);
    harness.world.trail = TRAIL.max;
    const spline = harness.world.route.spline!;
    const scratch = { x: 0, z: 0 };

    let behind = 0;
    let ahead = 0;
    harness.world.events.on("enemy.spawned", (event) => {
      const distance = spline.projectPoint(scratch, event.x, event.z);
      if (distance < harness.world.spider.distanceAlongRoute) behind++;
      else ahead++;
    });

    harness.seconds(45);

    expect(behind + ahead).toBeGreaterThan(20);
    expect(behind).toBeGreaterThan(ahead);
  });

  it("quietens the trail at a safe stop without resetting it to zero", () => {
    const harness = new Harness(80808, { spawns: false });
    harness.world.trail = 30;
    harness.world.trailState = "PROBING";
    harness.world.spider.docked = true;
    harness.world.setPhase("CHECKPOINT_PREP");
    harness.runState.checkpointTimer = 30;
    const transitions: string[] = [];
    harness.world.events.on("trail.stateChanged", (event) => transitions.push(event.to));

    harness.seconds(8);

    expect(harness.world.trail).toBeLessThan(30);
    expect(harness.world.trail).toBeGreaterThan(0);
    expect(transitions).toContain("QUIET");
  });

  it("guarantees campaign upgrade beats and requires a finale loadout", () => {
    const harness = new Harness(81818, { spawns: false });
    harness.world.spider.distanceAlongRoute = harness.world.route.spline!.length;
    harness.runState.update(harness.world, STEP);
    expect(harness.world.phase).toBe("CHECKPOINT_PREP");
    expect(harness.world.progress.pendingLevelUps).toBe(1);

    harness.runState.departCheckpoint(harness.world, "seg.mine");
    harness.runState.departCheckpoint(harness.world, "seg.flooded");
    harness.runState.departCheckpoint(harness.world, "seg.scrapyard");
    harness.world.spider.distanceAlongRoute = harness.world.route.spline!.length;
    harness.runState.update(harness.world, STEP);

    expect(harness.runState.pendingLoadout).toBe(true);
    expect(harness.world.progress.pendingLevelUps).toBe(2);
    harness.runState.checkpointTimer = -1;
    harness.runState.update(harness.world, STEP);
    expect(harness.world.phase).toBe("CHECKPOINT_PREP");
  });
});

describe("route objectives", () => {
  it("tracks and rewards the distinct objective authored for each route", () => {
    const opening = new Harness(6101, { spawns: false });
    const openingScrap = opening.world.resources.scrap;
    opening.world.stats.scrapCollected += 18;
    opening.runState.update(opening.world, STEP);
    expect(opening.runState.objective?.complete).toBe(true);
    expect(opening.world.resources.scrap).toBe(openingScrap + 12);

    const mine = new Harness(6102, { spawns: false });
    mine.runState.departCheckpoint(mine.world, "seg.mine");
    for (let i = 0; i < 2; i++) {
      const structure = mine.construction.spawnStructure(
        mine.world,
        "rivetTurret",
        mine.world.spider.x + i + 1,
        mine.world.spider.z,
        0,
        1,
        -1,
      );
      structure.state = "active";
      structure.powered = true;
    }
    mine.runState.update(mine.world, 25);
    expect(mine.runState.objective?.complete).toBe(true);
    expect(mine.world.resources.fuel).toBe(20);

    const yard = new Harness(6103, { spawns: false });
    yard.runState.departCheckpoint(yard.world, "seg.scrapyard");
    yard.world.stats.nestsDestroyed += 3;
    const yardScrap = yard.world.resources.scrap;
    yard.runState.update(yard.world, STEP);
    expect(yard.runState.objective?.complete).toBe(true);
    expect(yard.world.resources.scrap).toBe(yardScrap + 24);

    const escape = new Harness(6104, { spawns: false });
    escape.runState.departCheckpoint(escape.world, "seg.escape");
    escape.world.spider.coreHealth = 100;
    escape.world.trail = TRAIL.max;
    escape.world.trailState = "PURSUIT";
    escape.runState.update(escape.world, 45);
    expect(escape.runState.objective?.complete).toBe(true);
    expect(escape.world.spider.coreHealth).toBe(135);
  });
});

describe("Salvage Rush", () => {
  it("collects a dropped field machine with one confirm tap", () => {
    const harness = new Harness(9000, { spawns: false, mode: "salvageRush" });
    const turret = harness.construction.spawnStructure(
      harness.world,
      "rivetTurret",
      harness.world.player.x + 1,
      harness.world.player.z,
      0,
      0.8,
      12,
    );
    turret.state = "dropped";

    harness.press("confirm");
    harness.step(2);

    expect(harness.world.player.carry.kind).toBe("none");
    expect(harness.world.structures).toHaveLength(0);
    expect(harness.world.stats.structuresRecovered).toBe(1);
  });

  it("ends the fixed shift successfully when its timer reaches zero", () => {
    const harness = new Harness(9001, { spawns: false, mode: "salvageRush" });
    harness.runState.departCheckpoint(harness.world, "seg.scrapyard");
    harness.world.salvageTimeRemaining = 1;

    harness.runState.update(harness.world, 1);
    harness.world.events.drain();

    expect(harness.world.phase).toBe("VICTORY");
    expect(harness.countEvents("run.ended")).toBe(1);
  });

  it("scores each physical machine once across reinstall cycles", () => {
    const harness = new Harness(9002, { spawns: false, mode: "salvageRush" });
    harness.world.salvageTimeRemaining = 90;
    const turret = harness.construction.spawnStructure(
      harness.world,
      "rivetTurret",
      harness.world.player.x + 1,
      harness.world.player.z,
      0,
      0.75,
      10,
    );
    turret.state = "dropped";

    harness.hold("fold", true);
    harness.seconds(PLAYER.foldDuration + 0.2);
    harness.hold("fold", false);
    const firstScore = harness.world.salvageScore;
    expect(firstScore).toBeGreaterThan(0);

    harness.press("confirm");
    harness.step(3);
    const reinstalled = harness.world.structures[0];
    harness.placePlayerNear(reinstalled.x, reinstalled.z + 0.5);
    harness.hold("fold", true);
    harness.seconds(PLAYER.foldDuration + 0.2);
    harness.hold("fold", false);

    expect(harness.world.salvageScore).toBe(firstScore);
  });
});

describe("losing the run", () => {
  /**
   * Regression guard. Enemy melee originally resolved through a second,
   * private damage path that knew how to subtract health but not how to end a
   * run, so an undefended spider could be chewed down to a core of zero and the
   * game would simply keep marching. Nothing else in the suite caught it,
   * because every other test damaged the spider through `DamageSystem`
   * directly. This one lets the horde do it.
   */
  it("ends the run when the horde actually kills the core", () => {
    const harness = new Harness(24680);
    const world = harness.world;
    world.trail = TRAIL.max;
    world.spider.maxCoreHealth = 90;
    world.spider.coreHealth = 90;
    world.spider.shield = 0;

    harness.director.forceSpawn(world, "warrior", 20);

    for (let i = 0; i < 60 * 90 && world.phase !== "DEFEAT"; i++) harness.step(1);

    expect(world.spider.coreHealth).toBe(0);
    expect(world.phase).toBe("DEFEAT");
    const ended = harness.events.filter((event) => event.type === "run.ended");
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ outcome: "defeat", reason: "core" });
  });

  it("declares defeat exactly once, however much more damage lands", () => {
    const harness = new Harness(13579, { spawns: false });
    const world = harness.world;
    world.spider.shield = 0;
    world.spider.coreHealth = 10;

    for (let i = 0; i < 12; i++) {
      damageSpider(world, 40, world.spider.x, world.spider.z);
      harness.step(1);
    }

    expect(world.phase).toBe("DEFEAT");
    expect(harness.countEvents("run.ended")).toBe(1);
  });
});

describe("determinism", () => {
  it("produces an identical run from the same seed", () => {
    const runOnce = () => {
      const harness = new Harness(13571357);
      harness.seconds(45);
      const world = harness.world;
      return {
        distance: world.spider.distanceAlongRoute,
        trail: world.trail,
        enemies: world.enemies.active,
        spawned: harness.countEvents("enemy.spawned"),
        killed: world.stats.enemiesKilled,
        core: world.spider.coreHealth,
        scrap: world.resources.scrap,
      };
    };

    expect(runOnce()).toEqual(runOnce());
  });

  it("produces a different run from a different seed", () => {
    const sample = (seed: number) => {
      const harness = new Harness(seed);
      harness.seconds(45);
      // Counts can legitimately coincide across two seeds. Sample positions as
      // well so the assertion tests generated run state, not a lossy checksum.
      return harness.world.enemies.backing
        .filter((enemy) => enemy.active)
        .slice(0, 8)
        .map((enemy) => [enemy.archetype, enemy.x, enemy.z]);
    };
    expect(sample(1)).not.toEqual(sample(2));
  });
});

describe("pooling", () => {
  it("clears obsolete route resources without deleting timed enemy loot", () => {
    const harness = new Harness(403, { spawns: false });
    const x = harness.world.player.x + 10;
    const z = harness.world.player.z;
    harness.interaction.spawnPickup(harness.world, "repairKit", x, z, 1, 0, 0);
    harness.interaction.spawnPickup(harness.world, "scrap", x + 1, z, 3, 0, 20);

    expect(harness.interaction.clearRoutePickups(harness.world)).toBe(1);
    expect(harness.world.pickups.active).toBe(1);
    const survivor = harness.world.pickups.backing.find((pickup) => pickup.active);
    expect(survivor?.kind).toBe("scrap");
    expect(survivor?.lifetime).toBe(20);
  });

  it("expires enemy drops but keeps authored route resources", () => {
    const harness = new Harness(404, { spawns: false });
    const x = harness.world.player.x + 50;
    const z = harness.world.player.z + 50;
    harness.interaction.spawnPickup(harness.world, "scrap", x, z, 2, 0);
    harness.interaction.spawnPickup(harness.world, "fuel", x + 2, z, 2, 0, 0);

    for (let i = 0; i < PICKUPS.dropLifetime + 1; i++) {
      harness.interaction.collectPickups(harness.world, 1);
    }

    expect(harness.world.pickups.active).toBe(1);
    const persistent = harness.world.pickups.backing.find((pickup) => pickup.active);
    expect(persistent?.kind).toBe("fuel");
    expect(persistent?.lifetime).toBe(0);
  });

  it("never exhausts or leaks a pool across a long, busy run", { timeout: 60000 }, () => {
    const harness = new Harness(31415);
    harness.world.trail = TRAIL.max;

    harness.seconds(180);

    expect(harness.world.enemies.exhaustions).toBe(0);
    expect(harness.world.projectiles.exhaustions).toBe(0);
    expect(harness.world.pickups.exhaustions).toBe(0);
    expect(harness.world.enemies.active).toBeLessThanOrEqual(harness.world.enemies.capacity);
    expect(harness.world.enemies.active).toBeGreaterThanOrEqual(0);
  });
});
