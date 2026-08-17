import { describe, expect, it } from "vitest";
import { GameWorld } from "../src/game/GameWorld.ts";
import { PlayerMovementSystem } from "../src/game/systems/PlayerMovementSystem.ts";
import { SpiderMovementSystem } from "../src/game/systems/SpiderMovementSystem.ts";
import { ConstructionSystem } from "../src/game/systems/ConstructionSystem.ts";
import { InteractionSystem } from "../src/game/systems/InteractionSystem.ts";
import { PressureNetworkSystem } from "../src/game/systems/PressureNetworkSystem.ts";
import { RunStateSystem } from "../src/game/systems/RunStateSystem.ts";
import { HordeDirector } from "../src/game/systems/HordeDirector.ts";
import { EnemyNavigationSystem } from "../src/game/systems/EnemyNavigationSystem.ts";
import { WeaponSystem } from "../src/game/systems/WeaponSystem.ts";
import { StructureCombatSystem } from "../src/game/systems/StructureCombatSystem.ts";
import { CollisionSystem } from "../src/game/systems/CollisionSystem.ts";
import { DamageSystem } from "../src/game/systems/DamageSystem.ts";
import { ExperienceSystem } from "../src/game/systems/ExperienceSystem.ts";
import { createEmptySnapshot } from "../src/input/InputActions.ts";
import { SIM, TRAIL } from "../src/data/balance.ts";

/**
 * Simulation cost, measured with real timers.
 *
 * The browser performance harness cannot time anything useful, because the
 * headless run advances virtual time in jumps and `performance.now()` freezes
 * between them. Node has real timers, and the simulation is pure numeric state
 * with no renderer, so it can be measured here honestly.
 *
 * The budget from §22 of the design document is 5 ms of CPU simulation per
 * 16.7 ms frame. The thresholds below are deliberately loose - this runs on
 * shared CI-like hardware and is a regression guard, not a benchmark. A real
 * regression shows up as a 10x, not as a 20% drift.
 */

const STEP = SIM.fixedStep;

function buildStack(seed: number) {
  const world = new GameWorld(seed);
  const construction = new ConstructionSystem();
  const interaction = new InteractionSystem(construction);
  const damage = new DamageSystem(interaction);
  const systems = {
    world,
    construction,
    interaction,
    damage,
    playerMovement: new PlayerMovementSystem(),
    spiderMovement: new SpiderMovementSystem(),
    pressure: new PressureNetworkSystem(),
    runState: new RunStateSystem(),
    director: new HordeDirector(),
    navigation: new EnemyNavigationSystem(),
    weapons: new WeaponSystem(),
    structureCombat: new StructureCombatSystem(),
    collision: new CollisionSystem(damage),
    experience: new ExperienceSystem(),
    input: createEmptySnapshot(),
  };

  systems.playerMovement.setCameraBasis(0, 1, 1, 0);
  world.route.start();
  systems.runState.departCheckpoint(world, "seg.approach");
  world.spider.docked = false;
  return systems;
}

type Stack = ReturnType<typeof buildStack>;

function tick(s: Stack): void {
  const world = s.world;
  s.runState.update(world, STEP);
  s.spiderMovement.update(world, STEP);
  s.playerMovement.update(world, STEP, s.input);
  s.construction.update(world, STEP, s.input);
  s.interaction.update(world, STEP, s.input);
  s.interaction.collectPickups(world, STEP);
  s.pressure.update(world, STEP);
  s.director.update(world, STEP, s.runState.budgetPerSecond(world));
  s.navigation.setFocus(world.player.x, world.player.z);
  s.navigation.update(world, STEP);
  s.weapons.update(world, STEP);
  s.structureCombat.update(world, STEP);
  s.collision.update(world, STEP);
  s.damage.update(world, STEP);
  s.experience.update(world, STEP);
  world.events.drain();
  world.tick++;
}

/** Median of `samples` measured tick times, in milliseconds. */
function measure(s: Stack, samples: number): { p50: number; p95: number; worst: number } {
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    tick(s);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return {
    p50: times[Math.floor(times.length * 0.5)],
    p95: times[Math.floor(times.length * 0.95)],
    worst: times[times.length - 1],
  };
}

function fill(s: Stack, minion: number, warrior: number, golem: number): void {
  s.world.trail = TRAIL.max;
  s.director.forceSpawn(s.world, "minion", minion);
  s.director.forceSpawn(s.world, "warrior", warrior);
  s.director.forceSpawn(s.world, "golem", golem);
  // Let the horde form up and the flow field settle before measuring.
  for (let i = 0; i < 180; i++) tick(s);
}

function addTurrets(s: Stack, count: number): void {
  s.world.resources.scrap = 10000;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const structure = s.construction.spawnStructure(
      s.world,
      "rivetTurret",
      s.world.spider.x + Math.sin(angle) * 6,
      s.world.spider.z + Math.cos(angle) * 6,
      0,
      1,
      -1,
    );
    structure.state = "active";
  }
}

describe("simulation cost", () => {
  it("runs a quiet march far inside the 5 ms simulation budget", () => {
    const stack = buildStack(1001);
    for (let i = 0; i < 120; i++) tick(stack);
    const timing = measure(stack, 300);

    console.log(
      `[perf] quiet march: p50 ${timing.p50.toFixed(3)} ms, p95 ${timing.p95.toFixed(3)} ms`,
    );
    expect(timing.p50).toBeLessThan(2);
  });

  it("holds 100 active enemies inside the simulation budget", { timeout: 60000 }, () => {
    const stack = buildStack(2002);
    addTurrets(stack, 3);
    fill(stack, 72, 24, 4);
    expect(stack.world.enemies.active).toBeGreaterThanOrEqual(90);

    const timing = measure(stack, 300);
    console.log(
      `[perf] ${stack.world.enemies.active} enemies: p50 ${timing.p50.toFixed(3)} ms, ` +
        `p95 ${timing.p95.toFixed(3)} ms, worst ${timing.worst.toFixed(3)} ms`,
    );
    expect(timing.p50).toBeLessThan(5);
    expect(timing.p95).toBeLessThan(8);
  });

  it("survives the 200-enemy stress scenario without exhausting a pool", { timeout: 90000 }, () => {
    const stack = buildStack(3003);
    addTurrets(stack, 4);
    fill(stack, 150, 42, 8);
    expect(stack.world.enemies.active).toBeGreaterThanOrEqual(180);

    const peak = stack.world.enemies.peak;
    const timing = measure(stack, 300);
    console.log(
      `[perf] stress peak ${peak} enemies (${stack.world.enemies.active} still alive after the ` +
        `measured window): p50 ${timing.p50.toFixed(3)} ms, p95 ${timing.p95.toFixed(3)} ms, ` +
        `worst ${timing.worst.toFixed(3)} ms`,
    );
    expect(peak).toBeGreaterThanOrEqual(200);

    expect(stack.world.enemies.exhaustions).toBe(0);
    expect(stack.world.projectiles.exhaustions).toBe(0);
    // Twice the normal load must not cost anywhere near the whole frame.
    expect(timing.p50).toBeLessThan(9);
  });

  it("does not grow its per-tick cost over a long Pursuit soak", { timeout: 120000 }, () => {
    const stack = buildStack(4004);
    const world = stack.world;
    addTurrets(stack, 3);
    // Keep the run in Pursuit for the whole soak. Left alone the spider reaches
    // the checkpoint, docks, and the Trail decays - which is correct play but
    // would mean measuring an idle march and calling it a stress soak.
    world.events.on("run.checkpointReached", () => {
      stack.runState.departCheckpoint(world, "seg.scrapyard");
    });
    world.spider.maxCoreHealth = 1e9;
    world.spider.coreHealth = 1e9;

    fill(stack, 90, 30, 6);
    const early = measure(stack, 200);
    const earlyActive = world.enemies.active;

    // Four more simulated minutes of continuous Pursuit.
    for (let i = 0; i < 14400; i++) {
      world.trail = TRAIL.max;
      tick(stack);
    }
    const late = measure(stack, 200);

    console.log(
      `[perf] pursuit soak: early p50 ${early.p50.toFixed(3)} ms (${earlyActive} enemies), ` +
        `late p50 ${late.p50.toFixed(3)} ms (${world.enemies.active} enemies), ` +
        `spawned total ${stack.director.stats.spawnedTotal}, peak ${world.enemies.peak}`,
    );

    // The soak must actually have stayed under load, or the timing means nothing.
    expect(world.trailState).toBe("PURSUIT");
    expect(world.enemies.active).toBeGreaterThan(40);
    expect(world.enemies.exhaustions).toBe(0);
    // A leak shows as unbounded growth. Allow real variance, catch a runaway.
    expect(late.p50).toBeLessThan(Math.max(0.5, early.p50) * 4);
  });
});

describe("allocation discipline", () => {
  it("does not grow the heap materially across a busy stretch", { timeout: 90000 }, () => {
    const stack = buildStack(5005);
    addTurrets(stack, 3);
    fill(stack, 90, 30, 6);

    const usage = () => {
      const memory = (globalThis as { process?: { memoryUsage?: () => { heapUsed: number } } })
        .process?.memoryUsage;
      return memory ? memory().heapUsed : 0;
    };

    // Settle, then sample. Without a forced GC this is a coarse signal, so the
    // assertion only catches an unbounded leak, not per-tick churn.
    for (let i = 0; i < 600; i++) tick(stack);
    const before = usage();
    for (let i = 0; i < 6000; i++) tick(stack);
    const after = usage();

    if (before > 0) {
      const growthMb = (after - before) / (1024 * 1024);
      console.log(`[perf] heap growth over 6000 ticks: ${growthMb.toFixed(1)} MB`);
      expect(growthMb).toBeLessThan(120);
    }
    expect(stack.world.enemies.exhaustions).toBe(0);
  });
});
