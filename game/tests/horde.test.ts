import { describe, expect, it } from "vitest";
import type { Enemy } from "../src/core/types.ts";
import { DIRECTOR, PERFORMANCE, SIM, WEAPONS } from "../src/data/balance.ts";
import { getArchetype } from "../src/data/enemies.ts";
import { GameWorld } from "../src/game/GameWorld.ts";
import { ConstructionSystem } from "../src/game/systems/ConstructionSystem.ts";
import { HordeDirector } from "../src/game/systems/HordeDirector.ts";
import {
  AWAKEN_DURATION,
  EnemyNavigationSystem,
  SPAWN_SETTLE_DURATION,
  releaseEnemy,
} from "../src/game/systems/EnemyNavigationSystem.ts";

/**
 * The horde is the phase gate: 100 active enemies at 60 FPS, and a 200-enemy
 * stress run that neither crashes nor leaks a pool slot. These tests fix the
 * behaviours that make that possible — bounded spawning, clean pooling, and
 * target scoring that does not oscillate.
 */

const STEP = SIM.fixedStep;

/** A world already marching down a real segment, so the director can spawn. */
function marchingWorld(seed: number): GameWorld {
  const world = new GameWorld(seed);
  world.route.enterSegment("seg.approach");
  world.phase = "MARCH";
  world.spider.docked = false;
  world.spider.distanceAlongRoute = 60;
  const spline = world.route.spline!;
  const point = { x: 0, z: 0 };
  spline.positionAt(point, world.spider.distanceAlongRoute);
  world.spider.x = point.x;
  world.spider.z = point.z;
  world.player.x = point.x;
  world.player.z = point.z - 4;
  return world;
}

/** Runs the director alone for a number of simulated seconds. */
function runDirector(world: GameWorld, director: HordeDirector, seconds: number, budget: number): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    director.update(world, STEP, budget);
  }
}

/** Places a structure without going through the build UI or spending scrap. */
function place(
  world: GameWorld,
  construction: ConstructionSystem,
  kind: "rivetTurret" | "crawlerTurret" | "relay" | "barricade" | "mine",
  x: number,
  z: number,
) {
  const structure = construction.spawnStructure(world, kind, x, z, 0, 1, -1);
  structure.state = "active";
  structure.stateTimer = 0;
  return structure;
}

/** Spawns one enemy at an exact position, bypassing the ring layout. */
function placeEnemy(world: GameWorld, director: HordeDirector, archetype: string, x: number, z: number): Enemy {
  expect(director.forceSpawn(world, archetype, 1)).toBe(1);
  const backing = world.enemies.backing;
  for (let i = backing.length - 1; i >= 0; i--) {
    const enemy = backing[i];
    if (!enemy.active) continue;
    if (enemy.archetype !== archetype) continue;
    enemy.x = x;
    enemy.z = z;
    enemy.prevX = x;
    enemy.prevZ = z;
    return enemy;
  }
  throw new Error("forceSpawn reported success but produced no active enemy");
}

// ---------------------------------------------------------------------------
// Director budget
// ---------------------------------------------------------------------------

describe("HordeDirector budget", () => {
  it("accrues budget and spends it deterministically for a fixed seed", () => {
    const runA = marchingWorld(0xa11ce);
    const runB = marchingWorld(0xa11ce);
    const directorA = new HordeDirector();
    const directorB = new HordeDirector();

    runDirector(runA, directorA, 40, DIRECTOR.budgetPerSecond.SWARM);
    runDirector(runB, directorB, 40, DIRECTOR.budgetPerSecond.SWARM);

    expect(directorA.stats.spawnedTotal).toBeGreaterThan(0);
    expect(directorB.stats.spawnedTotal).toBe(directorA.stats.spawnedTotal);
    expect(directorB.bankedBudget).toBeCloseTo(directorA.bankedBudget, 10);
    expect(runB.enemies.active).toBe(runA.enemies.active);

    // Position by position, both runs must have produced the identical horde.
    const a = runA.enemies.backing;
    const b = runB.enemies.backing;
    for (let i = 0; i < a.length; i++) {
      expect(b[i].active).toBe(a[i].active);
      if (!a[i].active) continue;
      expect(b[i].archetype).toBe(a[i].archetype);
      expect(b[i].x).toBeCloseTo(a[i].x, 10);
      expect(b[i].z).toBeCloseTo(a[i].z, 10);
      expect(b[i].phase).toBeCloseTo(a[i].phase, 10);
    }
  });

  it("accrues at the rate it is given and banks what it cannot spend", () => {
    const world = marchingWorld(0x5eed);
    // Not marching: the director must bank rather than spawn.
    world.phase = "CHECKPOINT_PREP";
    const director = new HordeDirector();

    runDirector(world, director, 10, 1.5);

    expect(director.stats.spawnedTotal).toBe(0);
    expect(world.enemies.active).toBe(0);
    expect(director.bankedBudget).toBeCloseTo(15, 6);
  });

  it("only draws archetypes whose minimum threat the Trail has reached", () => {
    const world = marchingWorld(0xbeef);
    world.trail = 10;
    world.trailState = "QUIET";
    const director = new HordeDirector();

    runDirector(world, director, 120, DIRECTOR.budgetPerSecond.SWARM);

    expect(director.stats.spawnedTotal).toBeGreaterThan(0);
    const backing = world.enemies.backing;
    for (let i = 0; i < backing.length; i++) {
      if (!backing[i].active) continue;
      // Warrior needs 40, golem needs 70; at Trail 10 only minions are eligible.
      expect(backing[i].archetype).toBe("minion");
    }
  });

  it("adapts the spawn mix toward saboteurs when a large machine network is active", () => {
    const quietBuild = marchingWorld(0x51ab);
    const defended = marchingWorld(0x51ab);
    quietBuild.trail = defended.trail = 60;
    quietBuild.trailState = defended.trailState = "SWARM";
    const construction = new ConstructionSystem();
    for (let i = 0; i < 6; i++) {
      const machine = place(
        defended,
        construction,
        "rivetTurret",
        defended.spider.x + i - 3,
        defended.spider.z + 5,
      );
      machine.powered = true;
    }

    // Use a high budget so both minions and the costlier warrior are affordable
    // on every draw; this isolates weighting from budget availability.
    runDirector(quietBuild, new HordeDirector(), 30, 40);
    runDirector(defended, new HordeDirector(), 30, 40);

    const warriorShare = (world: GameWorld) => {
      const active = world.enemies.backing.filter((enemy) => enemy.active);
      return active.filter((enemy) => enemy.archetype === "warrior").length / active.length;
    };
    expect(warriorShare(defended)).toBeGreaterThan(warriorShare(quietBuild));
  });

  it("never exceeds maxActiveEnemies and counts the denials", () => {
    const world = marchingWorld(0xc0ffee);
    world.trail = 100;
    world.trailState = "PURSUIT";
    const director = new HordeDirector();

    // Far more budget than the cap can absorb, for a long time.
    runDirector(world, director, 300, 40);

    expect(world.enemies.active).toBeLessThanOrEqual(DIRECTOR.maxActiveEnemies);
    expect(world.enemies.active).toBeGreaterThan(DIRECTOR.maxActiveEnemies / 2);
    expect(director.stats.deniedByCap).toBeGreaterThan(0);
    expect(world.enemies.exhaustions).toBe(0);
  });

  it("ramps enemy speedScale during Pursuit without ever ending the run", () => {
    const world = marchingWorld(0x9a11);
    const director = new HordeDirector();
    director.forceSpawn(world, "minion", 5);

    world.trail = 100;
    world.trailState = "PURSUIT";
    world.pursuitTime = DIRECTOR.pursuitSpeedRampSeconds;
    director.update(world, DIRECTOR.evaluationInterval, 0);

    const expected = 1 + DIRECTOR.pursuitSpeedBonusMax;
    expect(director.pursuitSpeedScale).toBeCloseTo(expected, 10);

    const backing = world.enemies.backing;
    for (let i = 0; i < backing.length; i++) {
      if (!backing[i].active) continue;
      expect(backing[i].speedScale).toBeCloseTo(expected, 10);
    }

    // Pursuit escalates pressure; it must not decide the run by itself.
    expect(world.phase).toBe("MARCH");
    expect(world.spider.coreHealth).toBe(world.spider.maxCoreHealth);

    // And the ramp is bounded: twice the ramp time is not twice the bonus.
    world.pursuitTime = DIRECTOR.pursuitSpeedRampSeconds * 4;
    director.update(world, DIRECTOR.evaluationInterval, 0);
    expect(director.pursuitSpeedScale).toBeCloseTo(expected, 10);
  });

  it("places spawns outside the approximate camera frustum", () => {
    const world = marchingWorld(0x11fe);
    world.trail = 60;
    world.trailState = "SWARM";
    const director = new HordeDirector();

    runDirector(world, director, 60, DIRECTOR.budgetPerSecond.SWARM);
    expect(director.stats.spawnedTotal).toBeGreaterThan(0);

    const backing = world.enemies.backing;
    const player = world.player;
    for (let i = 0; i < backing.length; i++) {
      const enemy = backing[i];
      if (!enemy.active) continue;
      expect(enemy.spawnedVisible).toBe(false);
      const dx = enemy.x - player.x;
      const dz = enemy.z - player.z;
      // The group point clears spawnMinDistance; members are scattered around
      // it, so allow exactly the authored group spread.
      expect(Math.sqrt(dx * dx + dz * dz)).toBeGreaterThan(DIRECTOR.spawnMinDistance - 4);
    }
  });

  it("relocates enemies born inside terrain blockers so they can join the attack", () => {
    const world = marchingWorld(0xb10c);
    const director = new HordeDirector();
    const spider = world.spider;

    // Match forceSpawn's first ring positions and deliberately block them.
    for (let i = 0; i < 7; i++) {
      const angle = i * 2.399963229728653;
      const radius = 14 + (i % 7) * 1.3;
      world.navigation.addObstacle(
        spider.x + Math.sin(angle) * radius,
        spider.z + Math.cos(angle) * radius,
        1.2,
        10_000 + i,
      );
    }

    expect(director.forceSpawn(world, "minion", 7)).toBe(7);
    const enemies = world.enemies.backing.filter((enemy) => enemy.active);
    expect(enemies).toHaveLength(7);
    for (const enemy of enemies) {
      expect(world.navigation.isBlockedCircle(enemy.x, enemy.z, enemy.radius)).toBe(false);
    }

    const navigation = new EnemyNavigationSystem();
    const before = enemies.map((enemy) => ({ x: enemy.x, z: enemy.z }));
    for (let i = 0; i < 120; i++) navigation.update(world, STEP);
    const joinedAttack = enemies.filter(
      (enemy, i) => Math.hypot(enemy.x - before[i].x, enemy.z - before[i].z) > 0.5,
    );
    expect(joinedAttack.length).toBeGreaterThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// Pooling
// ---------------------------------------------------------------------------

describe("enemy pooling", () => {
  it("fully resets a spawned enemy, leaking nothing from the slot's last life", () => {
    const world = marchingWorld(0xd00d);
    const director = new HordeDirector();

    expect(director.forceSpawn(world, "golem", 1)).toBe(1);
    const first = world.enemies.at(0);
    expect(first.active).toBe(true);

    // Dirty every mutable field, then hand the slot back.
    first.health = 3;
    first.maxHealth = 3;
    first.velocityX = 99;
    first.velocityZ = -99;
    first.heading = 2.5;
    first.prevHeading = 2.5;
    first.state = "ATTACKING";
    first.stateTimer = 7;
    first.targetKind = "decoy";
    first.targetId = 4242;
    first.targetCooldown = 5;
    first.attackCooldown = 5;
    first.lodTimer = 5;
    first.lodTier = 2;
    first.knockX = 12;
    first.knockZ = -12;
    first.spawnedVisible = true;
    first.phase = 0.5;
    const firstId = first.id;
    const firstRenderIndex = first.renderIndex;

    releaseEnemy(world, first);
    expect(world.enemies.active).toBe(0);

    expect(director.forceSpawn(world, "minion", 1)).toBe(1);
    const reused = world.enemies.at(0);
    expect(reused).toBe(first);

    const minion = getArchetype("minion");
    expect(reused.id).not.toBe(firstId);
    expect(reused.archetype).toBe("minion");
    expect(reused.health).toBe(minion.health);
    expect(reused.maxHealth).toBe(minion.health);
    expect(reused.radius).toBe(minion.radius);
    expect(reused.speed).toBe(minion.speed);
    expect(reused.speedScale).toBe(1);
    expect(reused.state).toBe("SPAWNING");
    expect(reused.stateTimer).toBe(SPAWN_SETTLE_DURATION);
    expect(reused.targetKind).toBe("core");
    expect(reused.targetId).toBe(-1);
    expect(reused.targetCooldown).toBe(0);
    expect(reused.attackCooldown).toBe(0);
    expect(reused.lodTimer).toBe(0);
    expect(reused.lodTier).toBe(0);
    expect(reused.velocityX).toBe(0);
    expect(reused.velocityZ).toBe(0);
    expect(reused.knockX).toBe(0);
    expect(reused.knockZ).toBe(0);
    expect(reused.spawnedVisible).toBe(false);
    expect(reused.active).toBe(true);
    expect(reused.prevX).toBe(reused.x);
    expect(reused.prevZ).toBe(reused.z);
    expect(reused.prevHeading).toBe(reused.heading);
    expect(reused.phase).toBeGreaterThanOrEqual(0);
    expect(reused.phase).toBeLessThan(1);
    // The render slot is the pool slot and must survive the recycle.
    expect(reused.renderIndex).toBe(firstRenderIndex);
  });

  it("gives an awakening beat only to a visible spawn", () => {
    const world = marchingWorld(0xa1a1);
    const director = new HordeDirector();
    director.forceSpawn(world, "minion", 1);
    const enemy = world.enemies.at(0);

    expect(enemy.spawnedVisible).toBe(false);
    expect(enemy.stateTimer).toBe(SPAWN_SETTLE_DURATION);
    expect(AWAKEN_DURATION).toBeGreaterThan(SPAWN_SETTLE_DURATION);

    // The awakening holds the enemy in SPAWNING; the settle does not for long.
    const navigation = new EnemyNavigationSystem();
    enemy.spawnedVisible = true;
    enemy.state = "SPAWNING";
    enemy.stateTimer = AWAKEN_DURATION;
    for (let i = 0; i < 30; i++) navigation.update(world, STEP);
    expect(enemy.state).toBe("SPAWNING");
    for (let i = 0; i < 60; i++) navigation.update(world, STEP);
    expect(enemy.state).not.toBe("SPAWNING");
  });

  it("releasing an enemy returns its slot", () => {
    const world = marchingWorld(0xf00d);
    const director = new HordeDirector();

    director.forceSpawn(world, "minion", 3);
    expect(world.enemies.active).toBe(3);
    const before = world.enemies.available;

    releaseEnemy(world, world.enemies.at(1));
    expect(world.enemies.active).toBe(2);
    expect(world.enemies.available).toBe(before + 1);
    expect(world.enemies.at(1).active).toBe(false);

    // Releasing twice must not corrupt the free list.
    releaseEnemy(world, world.enemies.at(1));
    expect(world.enemies.active).toBe(2);
    expect(world.enemies.available).toBe(before + 1);
  });

  it("survives 200 forced spawns and a full release with no leak", () => {
    const world = marchingWorld(0x2005);
    const director = new HordeDirector();
    const navigation = new EnemyNavigationSystem();
    navigation.setFocus(world.spider.x, world.spider.z);

    expect(director.forceSpawn(world, "minion", 200)).toBe(200);
    expect(world.enemies.active).toBe(200);
    expect(world.enemies.exhaustions).toBe(0);

    // A full second of simulation at the stress count must not throw.
    for (let i = 0; i < 60; i++) navigation.update(world, STEP);

    const backing = world.enemies.backing;
    for (let i = 0; i < backing.length; i++) {
      if (backing[i].active) releaseEnemy(world, backing[i]);
    }

    expect(world.enemies.active).toBe(0);
    expect(world.enemies.exhaustions).toBe(0);
    expect(world.enemies.available).toBe(world.enemies.capacity);

    // The pool is intact: it can be filled to capacity all over again.
    expect(director.forceSpawn(world, "minion", world.enemies.capacity)).toBe(
      world.enemies.capacity,
    );
    expect(world.enemies.exhaustions).toBe(0);
    expect(director.forceSpawn(world, "minion", 1)).toBe(0);
    expect(world.enemies.exhaustions).toBe(0);
  });

  it("recycles enemies that stray beyond the despawn distance, silently", () => {
    const world = marchingWorld(0xdeca);
    const director = new HordeDirector();
    const navigation = new EnemyNavigationSystem();

    director.forceSpawn(world, "minion", 1);
    const enemy = world.enemies.at(0);
    enemy.state = "APPROACHING";
    enemy.x = world.spider.x + DIRECTOR.despawnDistance + 30;
    enemy.z = world.spider.z + DIRECTOR.despawnDistance + 30;

    let deaths = 0;
    world.events.on("enemy.died", () => {
      deaths++;
    });

    navigation.update(world, STEP);
    world.events.drain();

    expect(world.enemies.active).toBe(0);
    expect(deaths).toBe(0);
    expect(world.pickups.active).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Target scoring
// ---------------------------------------------------------------------------

describe("enemy target scoring", () => {
  it("prefers a barricade over an equidistant turret", () => {
    const world = marchingWorld(0xba21);
    const construction = new ConstructionSystem();
    const director = new HordeDirector();
    const navigation = new EnemyNavigationSystem();

    const sx = world.spider.x;
    const sz = world.spider.z;
    const barricade = place(world, construction, "barricade", sx + 3, sz + 27);
    const turret = place(world, construction, "rivetTurret", sx - 3, sz + 27);

    const enemy = placeEnemy(world, director, "minion", sx, sz + 30);
    // Equidistant by construction, so only the taunt weight can break the tie.
    const toBarricade = Math.hypot(barricade.x - enemy.x, barricade.z - enemy.z);
    const toTurret = Math.hypot(turret.x - enemy.x, turret.z - enemy.z);
    expect(toBarricade).toBeCloseTo(toTurret, 10);

    navigation.update(world, STEP);

    expect(enemy.targetKind).toBe("decoy");
    expect(enemy.targetId).toBe(barricade.id);
  });

  it("sends a golem to the core over an equidistant structure", () => {
    const world = marchingWorld(0x901e);
    const construction = new ConstructionSystem();
    const director = new HordeDirector();
    const navigation = new EnemyNavigationSystem();

    const sx = world.spider.x;
    const sz = world.spider.z;
    // Golem 12 m from the core and 12 m from the turret.
    const enemy = placeEnemy(world, director, "golem", sx, sz + 12);
    const turret = place(world, construction, "rivetTurret", sx + 12, sz + 12);

    expect(Math.hypot(turret.x - enemy.x, turret.z - enemy.z)).toBeCloseTo(12, 6);
    expect(Math.hypot(world.spider.x - enemy.x, world.spider.z - enemy.z)).toBeCloseTo(12, 6);

    navigation.update(world, STEP);

    expect(enemy.targetKind).toBe("core");
    expect(enemy.targetId).toBe(-1);
  });

  it("sends a warrior to a vulnerable crawler but ignores a permanent turret", () => {
    const world = marchingWorld(0x1477);
    const construction = new ConstructionSystem();
    const director = new HordeDirector();
    const navigation = new EnemyNavigationSystem();

    const sx = world.spider.x;
    const sz = world.spider.z;
    const enemy = placeEnemy(world, director, "warrior", sx, sz + 12);
    const permanentTurret = place(world, construction, "rivetTurret", sx - 12, sz + 12);
    const crawler = place(world, construction, "crawlerTurret", sx + 12, sz + 12);

    navigation.update(world, STEP);

    expect(enemy.targetKind).toBe("structure");
    expect(enemy.targetId).toBe(crawler.id);
    expect(enemy.targetId).not.toBe(permanentTurret.id);
  });

  it("sends saboteurs after relays and rear crawlers, never permanent turrets", () => {
    const world = marchingWorld(0x5ab0);
    const construction = new ConstructionSystem();
    const director = new HordeDirector();
    const navigation = new EnemyNavigationSystem();
    const sx = world.spider.x;
    const sz = world.spider.z;
    const enemy = placeEnemy(world, director, "warrior", sx, sz + 20);
    const turret = place(world, construction, "rivetTurret", sx - 4, sz + 16);
    const relay = place(world, construction, "relay", sx + 4, sz + 16);

    navigation.update(world, STEP);
    expect(enemy.targetId).toBe(relay.id);

    // Once the relay is gone, an equally placed rear defense has priority.
    construction.removeStructure(world, relay);
    const rear = place(world, construction, "crawlerTurret", sx + 4, sz + 16);
    rear.behindSpider = true;
    enemy.targetCooldown = 0;
    enemy.targetId = -1;
    enemy.targetKind = "core";
    navigation.update(world, STEP);
    expect(enemy.targetId).toBe(rear.id);
    expect(enemy.targetId).not.toBe(turret.id);
  });

  it("answers the engineer when they stand in the horde", () => {
    const world = marchingWorld(0x9147);
    const director = new HordeDirector();
    const navigation = new EnemyNavigationSystem();

    const enemy = placeEnemy(world, director, "minion", world.spider.x + 20, world.spider.z + 20);
    world.player.x = enemy.x + 1.5;
    world.player.z = enemy.z;

    navigation.update(world, STEP);

    expect(enemy.targetKind).toBe("player");
  });

  it("holds a target through the cooldown instead of oscillating", () => {
    const world = marchingWorld(0x0501);
    const construction = new ConstructionSystem();
    const director = new HordeDirector();
    const navigation = new EnemyNavigationSystem();

    const sx = world.spider.x;
    const sz = world.spider.z;
    const barricade = place(world, construction, "barricade", sx + 3, sz + 27);
    const enemy = placeEnemy(world, director, "minion", sx, sz + 30);
    enemy.speed = 0;

    navigation.update(world, STEP);
    expect(enemy.targetId).toBe(barricade.id);
    const cooldown = enemy.targetCooldown;
    expect(cooldown).toBeGreaterThan(0);

    // A second barricade appears marginally closer. Inside the cooldown, and
    // then inside the switch margin, the enemy must stay committed.
    const rival = place(world, construction, "barricade", sx + 0.4, sz + 27.4);
    for (let i = 0; i < 30; i++) navigation.update(world, STEP);
    expect(enemy.targetId).toBe(barricade.id);
    expect(rival.id).not.toBe(barricade.id);
  });

  it("drops a target that no longer exists and re-scores", () => {
    const world = marchingWorld(0x0d0d);
    const construction = new ConstructionSystem();
    const director = new HordeDirector();
    const navigation = new EnemyNavigationSystem();

    const sx = world.spider.x;
    const sz = world.spider.z;
    const barricade = place(world, construction, "barricade", sx + 3, sz + 27);
    const enemy = placeEnemy(world, director, "minion", sx, sz + 30);

    navigation.update(world, STEP);
    expect(enemy.targetId).toBe(barricade.id);

    construction.removeStructure(world, barricade);
    navigation.update(world, STEP);

    expect(enemy.targetId).toBe(-1);
    // At the outer edge it rallies toward the Spider rather than wandering
    // after the distant engineer; local hunter scoring resumes inside 18 m.
    expect(enemy.targetKind).toBe("core");
  });
});

// ---------------------------------------------------------------------------
// Navigation, LOD and the state machine
// ---------------------------------------------------------------------------

describe("EnemyNavigationSystem", () => {
  it("rebuilds the flow field on a stride, not per tick", () => {
    const world = marchingWorld(0xf10a);
    const navigation = new EnemyNavigationSystem();

    for (let i = 0; i < 60; i++) navigation.update(world, STEP);

    // 3 Hz over one second: the first tick plus the scheduled rebuilds.
    expect(navigation.stats.flowRebuilds).toBeGreaterThanOrEqual(3);
    expect(navigation.stats.flowRebuilds).toBeLessThanOrEqual(4);
  });

  it("caps full-rate enemies and tiers the rest by distance from focus", () => {
    const world = marchingWorld(0x10d0);
    const director = new HordeDirector();
    const navigation = new EnemyNavigationSystem();

    director.forceSpawn(world, "minion", 200);
    navigation.setFocus(world.spider.x, world.spider.z);
    navigation.update(world, STEP);

    expect(navigation.stats.fullLod).toBeLessThanOrEqual(
      PERFORMANCE.maxFullAnimationEnemies,
    );

    const backing = world.enemies.backing;
    let active = 0;
    let tiered = 0;
    for (let i = 0; i < backing.length; i++) {
      const enemy = backing[i];
      if (!enemy.active) continue;
      active++;
      expect(enemy.lodTier).toBeGreaterThanOrEqual(0);
      expect(enemy.lodTier).toBeLessThanOrEqual(2);
      if (enemy.lodTier > 0) tiered++;
    }

    // 200 bodies is more than the budget, so the cap must be saturated exactly
    // — not merely respected. Asserting the surplus this way keeps the test
    // honest when the budget moves: it is the *relationship* that is fixed,
    // not the count. (Budget 64 -> 128 is what dated the old literals here.)
    expect(active).toBeGreaterThan(PERFORMANCE.maxFullAnimationEnemies);
    expect(navigation.stats.fullLod).toBe(PERFORMANCE.maxFullAnimationEnemies);
    // Everything the cap could not take must have been demoted, none dropped.
    expect(tiered).toBe(active - PERFORMANCE.maxFullAnimationEnemies);
    expect(tiered).toBeGreaterThan(0);
  });

  it("still moves every enemy, whatever its LOD tier", () => {
    const world = marchingWorld(0x1eaf);
    const director = new HordeDirector();
    const navigation = new EnemyNavigationSystem();

    director.forceSpawn(world, "minion", 120);
    navigation.setFocus(world.spider.x, world.spider.z);

    const backing = world.enemies.backing;
    const startX: number[] = [];
    const startZ: number[] = [];
    for (let i = 0; i < backing.length; i++) {
      startX.push(backing[i].x);
      startZ.push(backing[i].z);
    }

    // One second: long enough for the SPAWNING settle and four full strides.
    for (let i = 0; i < 60; i++) navigation.update(world, STEP);

    for (let i = 0; i < backing.length; i++) {
      const enemy = backing[i];
      if (!enemy.active) continue;
      const moved = Math.hypot(enemy.x - startX[i], enemy.z - startZ[i]);
      expect(moved).toBeGreaterThan(0.05);
    }
  });

  it("recovers an enemy trapped in an unreachable obstacle pocket", () => {
    const world = marchingWorld(0x57ac);
    const director = new HordeDirector();
    const navigation = new EnemyNavigationSystem();
    const enemy = placeEnemy(
      world,
      director,
      "minion",
      world.spider.x + 10,
      world.spider.z + 10,
    );
    enemy.state = "APPROACHING";
    world.navigation.setStatic(enemy.x, enemy.z, 2.4);
    const startX = enemy.x;
    const startZ = enemy.z;

    for (let i = 0; i < 60 * 4; i++) navigation.update(world, STEP);

    expect(navigation.stats.unstuck).toBeGreaterThan(0);
    expect(Math.hypot(enemy.x - startX, enemy.z - startZ)).toBeGreaterThan(2.4);
    expect(world.navigation.isBlockedCircle(enemy.x, enemy.z, enemy.radius)).toBe(false);
    expect(enemy.targetKind).toBe("core");
  });

  it("does not mistake legitimate shallow-water movement for being stuck", () => {
    const world = marchingWorld(0x57ad);
    world.route.enterSegment("seg.flooded");
    world.spider.distanceAlongRoute = 60;
    const spline = world.route.spline!;
    const spiderPoint = { x: 0, z: 0 };
    const waterPoint = { x: 0, z: 0 };
    const tangent = { x: 0, z: 1 };
    spline.positionAt(spiderPoint, 60);
    spline.positionAt(waterPoint, 40);
    spline.tangentAt(tangent, 40);
    world.spider.x = spiderPoint.x;
    world.spider.z = spiderPoint.z;
    world.player.x = spiderPoint.x;
    world.player.z = spiderPoint.z;
    const director = new HordeDirector();
    const navigation = new EnemyNavigationSystem();
    const enemy = placeEnemy(
      world, director, "minion",
      waterPoint.x - tangent.z * 8,
      waterPoint.z + tangent.x * 8,
    );
    enemy.state = "APPROACHING";
    const startX = enemy.x;
    const startZ = enemy.z;

    for (let i = 0; i < 60 * 2; i++) navigation.update(world, STEP);

    expect(navigation.stats.unstuck).toBe(0);
    expect(Math.hypot(enemy.x - startX, enemy.z - startZ)).toBeGreaterThan(0.5);
  });

  it("walks an enemy to its target and attacks the spider core", () => {
    const world = marchingWorld(0xc02e);
    const director = new HordeDirector();
    const navigation = new EnemyNavigationSystem();

    const enemy = placeEnemy(world, director, "minion", world.spider.x, world.spider.z + 14);
    enemy.state = "APPROACHING";
    // The engineer is out of the picture for this one.
    world.player.x = world.spider.x + 400;
    world.player.z = world.spider.z + 400;

    const shieldBefore = world.spider.shield;
    for (let i = 0; i < 60 * 20; i++) navigation.update(world, STEP);

    expect(enemy.state).toBe("ATTACKING");
    expect(enemy.targetKind).toBe("core");
    expect(world.spider.shield).toBeLessThan(shieldBefore);
    expect(world.spider.shieldRegenDelay).toBeGreaterThan(0);
  });

  it("staggers a light enemy on the same blast that barely rocks a golem", () => {
    const world = marchingWorld(0x57a6);
    const director = new HordeDirector();
    const navigation = new EnemyNavigationSystem();

    const minion = placeEnemy(world, director, "minion", world.spider.x + 6, world.spider.z + 6);
    const golem = placeEnemy(world, director, "golem", world.spider.x - 6, world.spider.z + 6);
    minion.state = "APPROACHING";
    golem.state = "APPROACHING";

    // knockX/knockZ carry the impulse *after* the archetype's resistance has
    // been applied by the damage system, which is the contract this relies on.
    const blast = WEAPONS.shotgun.knockback;
    minion.knockX = blast * (1 - getArchetype("minion").knockbackResistance);
    golem.knockX = blast * (1 - getArchetype("golem").knockbackResistance);
    expect(golem.knockX).toBeLessThan(minion.knockX);

    navigation.update(world, STEP);

    expect(minion.state).toBe("STAGGERED");
    expect(golem.state).toBe("APPROACHING");

    // The impulse must not be re-scaled here; a golem that had its resistance
    // applied twice would barely move at all.
    const golemPushed = Math.abs(golem.x - (world.spider.x - 6));
    expect(golemPushed).toBeGreaterThan(golem.knockX * STEP * 0.5);

    // The stagger is short, and recovery returns to the approach.
    for (let i = 0; i < 60; i++) navigation.update(world, STEP);
    expect(minion.state).not.toBe("STAGGERED");
    expect(minion.knockX).toBeLessThan(0.01);
  });

  it("keeps the horde apart instead of stacking it on one point", () => {
    const world = marchingWorld(0x5e9a);
    const director = new HordeDirector();
    const navigation = new EnemyNavigationSystem();

    director.forceSpawn(world, "minion", 40);
    navigation.setFocus(world.spider.x, world.spider.z);

    const backing = world.enemies.backing;
    for (let i = 0; i < backing.length; i++) {
      if (!backing[i].active) continue;
      backing[i].x = world.spider.x + 8;
      backing[i].z = world.spider.z + 8;
      backing[i].state = "APPROACHING";
    }

    for (let i = 0; i < 120; i++) navigation.update(world, STEP);

    let spread = 0;
    let counted = 0;
    for (let i = 0; i < backing.length; i++) {
      const enemy = backing[i];
      if (!enemy.active) continue;
      spread += Math.hypot(enemy.x - (world.spider.x + 8), enemy.z - (world.spider.z + 8));
      counted++;
    }
    expect(counted).toBeGreaterThan(0);
    expect(spread / counted).toBeGreaterThan(0.5);
  });

  it("holds 200 enemies through a full simulated second without leaking", () => {
    const world = marchingWorld(0x2c00);
    world.trail = 100;
    world.trailState = "PURSUIT";
    const director = new HordeDirector();
    const navigation = new EnemyNavigationSystem();
    navigation.setFocus(world.spider.x, world.spider.z);

    director.forceSpawn(world, "minion", 140);
    director.forceSpawn(world, "warrior", 40);
    director.forceSpawn(world, "golem", 20);
    expect(world.enemies.active).toBe(200);

    for (let i = 0; i < 60; i++) {
      director.update(world, STEP, DIRECTOR.budgetPerSecond.PURSUIT);
      navigation.update(world, STEP);
    }

    expect(world.enemies.exhaustions).toBe(0);
    expect(world.enemies.active).toBeLessThanOrEqual(world.enemies.capacity);
    expect(navigation.stats.steered).toBeGreaterThan(0);
    expect(Number.isFinite(navigation.stats.lastRebuildMs)).toBe(true);

    const backing = world.enemies.backing;
    for (let i = 0; i < backing.length; i++) {
      const enemy = backing[i];
      if (!enemy.active) continue;
      expect(Number.isFinite(enemy.x)).toBe(true);
      expect(Number.isFinite(enemy.z)).toBe(true);
      expect(Number.isFinite(enemy.heading)).toBe(true);
    }
  });
});
