import { describe, expect, it } from "vitest";
import type { Enemy, Projectile, Structure, StructureKind } from "../src/core/types.ts";
import { ENEMY_LIFECYCLE, PLAYER, SPIDER, STRUCTURES, WEAPONS } from "../src/data/balance.ts";
import { getArchetype } from "../src/data/enemies.ts";
import { getStructureConfig } from "../src/data/structures.ts";
import { GameWorld } from "../src/game/GameWorld.ts";
import { CollisionSystem } from "../src/game/systems/CollisionSystem.ts";
import { ConstructionSystem } from "../src/game/systems/ConstructionSystem.ts";
import { DamageSystem } from "../src/game/systems/DamageSystem.ts";
import { InteractionSystem } from "../src/game/systems/InteractionSystem.ts";
import { PressureNetworkSystem } from "../src/game/systems/PressureNetworkSystem.ts";
import { StructureCombatSystem } from "../src/game/systems/StructureCombatSystem.ts";
import { WeaponSystem } from "../src/game/systems/WeaponSystem.ts";
import { EnemyNavigationSystem, releaseEnemy } from "../src/game/systems/EnemyNavigationSystem.ts";

const STEP = 1 / 60;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Rig {
  world: GameWorld;
  damage: DamageSystem;
  collision: CollisionSystem;
  weapons: WeaponSystem;
  turrets: StructureCombatSystem;
  pressure: PressureNetworkSystem;
  interactions: InteractionSystem;
}

function createRig(seed = 20260816): Rig {
  const world = new GameWorld(seed);
  world.setPhase("MARCH");
  const construction = new ConstructionSystem();
  const interactions = new InteractionSystem(construction);
  const damage = new DamageSystem(interactions);
  return {
    world,
    damage,
    collision: new CollisionSystem(damage),
    weapons: new WeaponSystem(),
    turrets: new StructureCombatSystem(),
    pressure: new PressureNetworkSystem(),
    interactions,
  };
}

function spawnEnemy(world: GameWorld, archetypeId: string, x: number, z: number): Enemy {
  const archetype = getArchetype(archetypeId);
  const enemy = world.enemies.acquire();
  if (!enemy) throw new Error("enemy pool exhausted");
  enemy.id = world.allocateId();
  enemy.archetype = archetype.id;
  enemy.x = x;
  enemy.z = z;
  enemy.prevX = x;
  enemy.prevZ = z;
  enemy.health = archetype.health;
  enemy.maxHealth = archetype.health;
  enemy.radius = archetype.radius;
  enemy.speed = archetype.speed;
  enemy.state = "APPROACHING";
  enemy.active = true;
  return enemy;
}

/** A structure built directly, bypassing placement validation and deploy time. */
function placeStructure(world: GameWorld, kind: StructureKind, x: number, z: number): Structure {
  const config = getStructureConfig(kind);
  const structure: Structure = {
    id: world.allocateId(),
    kind,
    category: config.category,
    x,
    z,
    heading: 0,
    health: config.health,
    maxHealth: config.health,
    buffer: config.maxBuffer,
    maxBuffer: config.maxBuffer,
    state: "active",
    stateTimer: 0,
    powered: true,
    fireCooldown: 0,
    targetEnemyId: -1,
    targetLockTimer: 0,
    turretHeading: 0,
    shotsFired: 0,
    behindSpider: false,
      idleTime: 0,
      recoveryXpGranted: false,
      active: true,
  };
  world.structures.push(structure);
  return structure;
}

function launchProjectile(
  world: GameWorld,
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  speed: number,
  damage: number,
  pierce: number,
): Projectile {
  const projectile = world.projectiles.acquire();
  if (!projectile) throw new Error("projectile pool exhausted");
  projectile.id = world.allocateId();
  projectile.x = x;
  projectile.z = z;
  projectile.y = 1;
  projectile.prevX = x;
  projectile.prevZ = z;
  projectile.prevY = 1;
  projectile.velocityX = dirX * speed;
  projectile.velocityZ = dirZ * speed;
  projectile.speed = speed;
  projectile.damage = damage;
  projectile.lifetime = 2;
  projectile.source = "player.weapon";
  projectile.pierceLeft = pierce;
  projectile.lastHitId = -1;
  projectile.variant = 0;
  projectile.active = true;
  return projectile;
}

function countActiveProjectiles(world: GameWorld): number {
  let count = 0;
  const backing = world.projectiles.backing;
  for (let i = 0; i < backing.length; i++) if (backing[i].active) count++;
  return count;
}

// ---------------------------------------------------------------------------
// Swept collision
// ---------------------------------------------------------------------------

describe("projectile sweeping", () => {
  it("registers a hit on an enemy the projectile crosses entirely within one step", () => {
    const rig = createRig();
    const enemy = spawnEnemy(rig.world, "minion", 0, 3);
    // Deliberately tiny target and absurd muzzle velocity: 10 m of travel in one
    // step against a 0.38 m body. A point test at the post-step position lands
    // at z = 10, over 6 m past the enemy, and would report no contact at all.
    enemy.radius = 0.19;
    launchProjectile(rig.world, 0, 0, 0, 1, 600, 12, 0);

    rig.collision.update(rig.world, STEP);

    expect(rig.collision.stats.hits).toBe(1);
    expect(enemy.health).toBe(getArchetype("minion").health - 12);
    // The projectile is spent, not left flying past its victim.
    expect(countActiveProjectiles(rig.world)).toBe(0);
  });

  it("is not fooled by a 46 m/s rivet at the real fixed step", () => {
    const rig = createRig();
    const enemy = spawnEnemy(rig.world, "minion", 0, 0.5);
    launchProjectile(rig.world, 0, 0, 0, 1, STRUCTURES.rivetTurret.projectileSpeed, 9, 0);

    rig.collision.update(rig.world, STEP);

    expect(enemy.health).toBe(getArchetype("minion").health - 9);
  });

  it("pierces N distinct enemies and never bills the same one twice", () => {
    const rig = createRig();
    const first = spawnEnemy(rig.world, "warrior", 0, 2);
    const second = spawnEnemy(rig.world, "warrior", 0, 4);
    const third = spawnEnemy(rig.world, "warrior", 0, 6);
    const fourth = spawnEnemy(rig.world, "warrior", 0, 8);

    // pierce 2 => three bodies total: the first hit plus two pass-throughs.
    launchProjectile(rig.world, 0, 0, 0, 1, 600, 10, 2);

    rig.collision.update(rig.world, STEP);
    // A second step proves the spent projectile cannot come back for seconds.
    rig.collision.update(rig.world, STEP);

    const full = getArchetype("warrior").health;
    expect(first.health).toBe(full - 10);
    expect(second.health).toBe(full - 10);
    expect(third.health).toBe(full - 10);
    expect(fourth.health).toBe(full);
    expect(rig.collision.stats.hits).toBe(3);
    expect(countActiveProjectiles(rig.world)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Player and spider damage
// ---------------------------------------------------------------------------

describe("player damage", () => {
  it("blocks damage during dodge i-frames and lets it through afterwards", () => {
    const rig = createRig();
    const player = rig.world.player;
    player.dodgeTimer = PLAYER.dodgeDuration;

    rig.damage.applyToPlayer(rig.world, {
      amount: 25,
      source: "enemy.melee",
      originX: 0,
      originZ: 1,
      knockback: 0,
      critical: false,
    });
    expect(player.health).toBe(PLAYER.health);

    player.dodgeTimer = 0;
    player.invulnerability = 0;
    rig.damage.applyToPlayer(rig.world, {
      amount: 25,
      source: "enemy.melee",
      originX: 0,
      originZ: 1,
      knockback: 0,
      critical: false,
    });
    expect(player.health).toBe(PLAYER.health - 25);
    // The hit itself grants immunity, so a second contact in the same beat is free.
    expect(player.invulnerability).toBeCloseTo(PLAYER.hitInvulnerability, 6);
  });

  it("downs the engineer, spends the rescue charge, and revives at the spider", () => {
    const rig = createRig();
    const world = rig.world;
    world.spider.x = 12;
    world.spider.z = -5;
    world.resources.scrap = 60;

    rig.damage.applyToPlayer(world, {
      amount: 999,
      source: "enemy.melee",
      originX: 0,
      originZ: 0,
      knockback: 0,
      critical: false,
    });

    expect(world.player.downed).toBe(true);
    expect(world.player.rescueCharges).toBe(PLAYER.rescueCharges - 1);

    for (let i = 0; i < Math.ceil(PLAYER.downedDuration / STEP) + 1; i++) {
      rig.damage.update(world, STEP);
    }

    expect(world.player.downed).toBe(false);
    expect(world.player.health).toBeCloseTo(PLAYER.health * PLAYER.reviveHealthFraction, 6);
    expect(world.resources.scrap).toBe(60 - PLAYER.reviveScrapPenalty);
    expect(world.spider.coreHealth).toBe(SPIDER.coreHealth - PLAYER.reviveCoreDamage);
    // Dropped next to the spider, not where they fell.
    expect(Math.hypot(world.player.x - world.spider.x, world.player.z - world.spider.z)).toBeLessThan(
      4,
    );
    // §13: the run continues. Only the core ends it.
    expect(world.phase).toBe("MARCH");
  });
});

describe("spider damage", () => {
  it("spends the shield before the core and delays regeneration", () => {
    const rig = createRig();
    const spider = rig.world.spider;

    rig.damage.applyToSpider(rig.world, {
      amount: 50,
      source: "enemy.melee",
      originX: 0,
      originZ: 0,
      knockback: 0,
      critical: false,
    });

    expect(spider.shield).toBe(SPIDER.shield - 50);
    expect(spider.coreHealth).toBe(SPIDER.coreHealth);
    expect(spider.shieldRegenDelay).toBe(SPIDER.shieldRegenDelay);

    const events = rig.world.events.drain();
    const damaged = events.find((event) => event.type === "spider.damaged");
    expect(damaged && damaged.type === "spider.damaged" && damaged.absorbedByShield).toBe(true);

    // Overflow spills into the core, and that hit is not "absorbed".
    rig.damage.applyToSpider(rig.world, {
      amount: 100,
      source: "enemy.melee",
      originX: 0,
      originZ: 0,
      knockback: 0,
      critical: false,
    });
    expect(spider.shield).toBe(0);
    expect(spider.coreHealth).toBe(SPIDER.coreHealth - 30);
    const second = rig.world.events
      .drain()
      .find((event) => event.type === "spider.damaged");
    expect(second && second.type === "spider.damaged" && second.absorbedByShield).toBe(false);
  });

  it("ends the run when the core reaches zero", () => {
    const rig = createRig();
    rig.damage.applyToSpider(rig.world, {
      amount: SPIDER.shield + SPIDER.coreHealth,
      source: "enemy.melee",
      originX: 0,
      originZ: 0,
      knockback: 0,
      critical: false,
    });
    const ended = rig.world.events.drain().find((event) => event.type === "run.ended");
    expect(ended && ended.type === "run.ended" && ended.outcome).toBe("defeat");
    expect(ended && ended.type === "run.ended" && ended.reason).toBe("core");
    expect(rig.world.phase).toBe("DEFEAT");
  });
});

// ---------------------------------------------------------------------------
// Explosions
// ---------------------------------------------------------------------------

describe("explosions", () => {
  it("damages everything inside the radius with linear falloff and nothing outside", () => {
    const rig = createRig();
    const radius = STRUCTURES.rivetTurret.explosionRadius;
    const damage = STRUCTURES.rivetTurret.explosionDamage;

    const centre = spawnEnemy(rig.world, "golem", 0, 0);
    const middle = spawnEnemy(rig.world, "golem", 0, radius * 0.5);
    const outside = spawnEnemy(rig.world, "golem", 0, radius + 6);

    rig.damage.explode(rig.world, 0, 0, radius, damage, "structure.explosion");

    const full = getArchetype("golem").health;
    // Falloff is linear from 1.0 at the centre to 0.35 at the rim.
    expect(full - centre.health).toBeCloseTo(damage, 4);
    expect(full - middle.health).toBeCloseTo(damage * (1 - 0.65 * 0.5), 4);
    expect(outside.health).toBe(full);
    expect(rig.world.stats.damageByStructures).toBeGreaterThan(0);
  });

  it("applies a Last Shot detonation from the structure.exploded event", () => {
    const rig = createRig();
    const world = rig.world;
    const turret = placeStructure(world, "rivetTurret", 0, 0);
    const victim = spawnEnemy(world, "golem", 0, 1);

    rig.damage.update(world, STEP); // records the kind before the machine is gone
    world.events.emit({
      type: "structure.exploded",
      structureId: turret.id,
      x: turret.x,
      z: turret.z,
      radius: STRUCTURES.rivetTurret.explosionRadius,
    });
    world.events.drain();

    expect(victim.health).toBeLessThan(getArchetype("golem").health);
  });
});

// ---------------------------------------------------------------------------
// Turret pressure gate
// ---------------------------------------------------------------------------

describe("turret firing gate", () => {
  it("stays silent when starved and fires once pressure returns", () => {
    const rig = createRig();
    const world = rig.world;
    const turret = placeStructure(world, "rivetTurret", 0, 0);
    turret.state = "starved";
    turret.buffer = 0;
    turret.powered = false;
    spawnEnemy(world, "minion", 0, 6);

    for (let i = 0; i < 60; i++) rig.turrets.update(world, STEP);
    expect(rig.turrets.stats.shotsFired).toBe(0);
    expect(rig.turrets.stats.activeTurrets).toBe(0);

    // A cylinder's worth of buffer, exactly as InteractionSystem.performRecharge
    // would leave it: active again, with autonomy but still outside the network.
    turret.state = "active";
    turret.buffer = STRUCTURES.rivetTurret.maxBuffer;
    turret.powered = false;

    for (let i = 0; i < 60; i++) rig.turrets.update(world, STEP);
    expect(rig.turrets.stats.shotsFired).toBeGreaterThan(0);
    expect(rig.turrets.stats.activeTurrets).toBe(1);
  });

  it("fires while inside the network even with an empty buffer", () => {
    const rig = createRig();
    const world = rig.world;
    const turret = placeStructure(world, "rivetTurret", 0, 0);
    turret.buffer = 0;
    turret.powered = true;
    spawnEnemy(world, "minion", 0, 6);

    for (let i = 0; i < 60; i++) rig.turrets.update(world, STEP);
    expect(rig.turrets.stats.shotsFired).toBeGreaterThan(0);
  });

  it("traverses toward the target before it shoots", () => {
    const rig = createRig();
    const world = rig.world;
    const turret = placeStructure(world, "rivetTurret", 0, 0);
    // Resting pose points at +Z; the target is directly behind the turret.
    turret.heading = 0;
    turret.turretHeading = 0;
    spawnEnemy(world, "minion", 0, -6);

    rig.turrets.update(world, STEP);
    expect(rig.turrets.stats.shotsFired).toBe(0);
    expect(Math.abs(turret.turretHeading)).toBeGreaterThan(0);

    for (let i = 0; i < 120; i++) rig.turrets.update(world, STEP);
    expect(rig.turrets.stats.shotsFired).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Automatic personal weapon
// ---------------------------------------------------------------------------

describe("personal weapon", () => {
  it("fires automatically with no aim input and no button", () => {
    const rig = createRig();
    const world = rig.world;
    world.player.aimX = 0;
    world.player.aimZ = 0;
    spawnEnemy(world, "minion", 0, 5);

    rig.weapons.update(world, STEP);

    expect(rig.weapons.stats.shotsFired).toBe(1);
    expect(countActiveProjectiles(world)).toBe(WEAPONS.shotgun.pellets);
    const fired = world.events.drain().find((event) => event.type === "weapon.fired");
    expect(fired && fired.type === "weapon.fired" && fired.muzzleY).toBeCloseTo(1.1, 6);
  });

  it("holds fire while downed, dodging, or placing a structure", () => {
    const rig = createRig();
    const world = rig.world;
    spawnEnemy(world, "minion", 0, 5);

    world.player.downed = true;
    rig.weapons.update(world, STEP);
    world.player.downed = false;
    world.player.dodgeTimer = 0.2;
    rig.weapons.update(world, STEP);
    world.player.dodgeTimer = 0;
    world.build.ghostActive = true;
    rig.weapons.update(world, STEP);

    expect(rig.weapons.stats.shotsFired).toBe(0);
  });

  it("prefers a warrior inside the focus cone over a nearer minion outside it", () => {
    const rig = createRig();
    const world = rig.world;
    // Aim down +X. The minion is closer but sits behind the engineer.
    world.player.aimX = 1;
    world.player.aimZ = 0;
    const warrior = spawnEnemy(world, "warrior", 7, 0);
    spawnEnemy(world, "minion", 0, -3);

    rig.weapons.update(world, STEP);

    const health = getArchetype("warrior").health;
    for (let i = 0; i < 20; i++) rig.collision.update(world, STEP);
    expect(warrior.health).toBeLessThan(health);
  });

  it("unlocks a stage weapon and cycles between genuine sidegrades", () => {
    const rig = createRig();
    rig.world.route.enterSegment("seg.mine");
    rig.weapons.update(rig.world, STEP);
    expect(rig.world.player.unlockedWeapons).toEqual(["shotgun", "rifle"]);
    expect(rig.world.player.currentWeapon).toBe("rifle");

    rig.weapons.requestCycle(true);
    rig.weapons.update(rig.world, STEP);
    expect(rig.world.player.currentWeapon).toBe("shotgun");
  });

  it("lets the HUD cycle stronger guns but never selects a locked weapon", () => {
    const rig = createRig();
    expect(rig.weapons.cycleUnlockedWeapon(rig.world)).toBe(false);
    expect(rig.world.player.currentWeapon).toBe("shotgun");

    rig.world.player.unlockedWeapons.push("rifle", "launcher");
    expect(rig.weapons.cycleUnlockedWeapon(rig.world)).toBe(true);
    expect(rig.world.player.currentWeapon).toBe("rifle");
    expect(rig.weapons.cycleUnlockedWeapon(rig.world)).toBe(true);
    expect(rig.world.player.currentWeapon).toBe("launcher");
  });

  it("gives the rifle longer range and piercing instead of shotgun crowd spread", () => {
    const rig = createRig();
    const world = rig.world;
    world.player.currentWeapon = "rifle";
    world.player.unlockedWeapons.push("rifle");
    spawnEnemy(world, "warrior", 0, 19);
    rig.weapons.update(world, STEP);
    expect(countActiveProjectiles(world)).toBe(1);
    const shot = world.projectiles.backing.find((projectile) => projectile.active)!;
    expect(shot.pierceLeft).toBe(WEAPONS.rifle.pierce);
    expect(shot.speed).toBe(WEAPONS.rifle.projectileSpeed);
  });

  it("forces the flamer to cool after sustained crowd control", () => {
    const rig = createRig();
    const world = rig.world;
    world.player.currentWeapon = "flamer";
    world.player.unlockedWeapons.push("flamer");
    spawnEnemy(world, "golem", 0, 5);
    for (let i = 0; i < 60 * 8 && !world.player.weaponOverheated; i++) {
      rig.weapons.update(world, STEP);
      rig.collision.update(world, STEP);
    }
    expect(world.player.weaponOverheated).toBe(true);
    const shotsAtHeat = rig.weapons.stats.shotsFired;
    for (let i = 0; i < 30; i++) rig.weapons.update(world, STEP);
    expect(rig.weapons.stats.shotsFired).toBe(shotsAtHeat);
  });

  it("makes the magnetic launcher damage a clustered group", () => {
    const rig = createRig();
    const world = rig.world;
    world.player.currentWeapon = "launcher";
    world.player.unlockedWeapons.push("launcher");
    const target = spawnEnemy(world, "golem", 0, 5);
    const neighbour = spawnEnemy(world, "golem", 2.2, 5);
    const outside = spawnEnemy(world, "golem", 7, 5);
    rig.weapons.update(world, STEP);
    for (let i = 0; i < 30; i++) rig.collision.update(world, STEP);
    const full = getArchetype("golem").health;
    expect(target.health).toBeLessThan(full);
    expect(neighbour.health).toBeLessThan(full);
    expect(outside.health).toBe(full);
  });

  it("targets and permanently destroys an awakened enemy nest", () => {
    const rig = createRig();
    const world = rig.world;
    world.player.currentWeapon = "rifle";
    world.encounterSites.push({
      id: world.allocateId(), definitionId: "test.nest", x: 0, z: 5,
      health: 10, maxHealth: 10, radius: 2, active: true, triggered: true,
      wavesReleased: 1, reinforcementTimer: 8,
    });
    const scrap = world.resources.scrap;
    rig.weapons.update(world, STEP);
    for (let i = 0; i < 20; i++) rig.collision.update(world, STEP);
    expect(world.encounterSites[0].active).toBe(false);
    expect(world.resources.scrap).toBe(scrap + 25);
  });

  it("pulls distant scrap back when the player tagged the enemy before it died", () => {
    const rig = createRig(20260820);
    const world = rig.world;
    const enemy = spawnEnemy(world, "golem", world.player.x, world.player.z + 22);
    rig.damage.applyToEnemy(world, enemy, {
      amount: 1, source: "player.weapon", originX: world.player.x,
      originZ: world.player.z, knockback: 0, critical: false,
    });
    rig.damage.applyToEnemy(world, enemy, {
      amount: enemy.health, source: "structure.turret", originX: world.spider.x,
      originZ: world.spider.z, knockback: 0, critical: false,
    });

    expect(enemy.state).toBe("DEAD");
    expect(enemy.active).toBe(true);
    const navigation = new EnemyNavigationSystem();
    navigation.update(world, ENEMY_LIFECYCLE.deathDuration + STEP);
    expect(enemy.active).toBe(false);
    expect(world.findEnemy(enemy.id)).toBeNull();
    expect(world.enemies.active).toBe(0);
    expect(world.enemies.available).toBe(world.enemies.capacity);
    const pickup = world.pickups.backing.find((candidate) => candidate.active)!;
    expect(pickup.claimRadius).toBeGreaterThan(22);
    const scrapBefore = world.resources.scrap;
    for (let i = 0; i < 60 * 4 && world.pickups.active > 0; i++) {
      rig.interactions.collectPickups(world, STEP);
    }
    expect(world.pickups.active).toBe(0);
    expect(world.resources.scrap).toBeGreaterThan(scrapBefore);
  });

  it("makes a lethal hit inert immediately and releases the corpse after its collapse", () => {
    const rig = createRig(20260821);
    const enemy = spawnEnemy(rig.world, "minion", 0, 3);

    rig.damage.applyToEnemy(rig.world, enemy, {
      amount: enemy.health,
      source: "player.weapon",
      originX: 0,
      originZ: 0,
      knockback: 5,
      critical: false,
    });

    expect(enemy.state).toBe("DEAD");
    expect(enemy.health).toBe(0);
    expect(enemy.velocityX).toBe(0);
    expect(enemy.velocityZ).toBe(0);
    expect(enemy.targetId).toBe(-1);

    const navigation = new EnemyNavigationSystem();
    navigation.update(rig.world, ENEMY_LIFECYCLE.deathDuration * 0.5);
    expect(enemy.active).toBe(true);
    navigation.update(rig.world, ENEMY_LIFECYCLE.deathDuration * 0.5 + STEP);
    expect(enemy.active).toBe(false);
    expect(rig.world.enemies.active).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The §7.3 damage-share gate
// ---------------------------------------------------------------------------

interface EncounterResult {
  player: number;
  structures: number;
  kills: number;
  playerShare: number;
}

/**
 * A scripted 60 s hold: the spider stationary, `turretCount` rivet turrets
 * inside the service radius, the engineer working just behind the machine, and
 * a steady minion stream with a warrior every three seconds. Everything here
 * except the horde's pathing runs the real systems.
 */
function runEncounter(turretCount: number, duration = 60): EncounterResult {
  const rig = createRig(0xc0ffee);
  const world = rig.world;

  world.spider.fuel = 70;
  world.spider.docked = false;
  world.player.x = 0;
  world.player.z = -3.5;
  world.player.aimX = 0;
  world.player.aimZ = 0;

  for (let i = 0; i < turretCount; i++) {
    const angle = (i / turretCount) * Math.PI * 2;
    placeStructure(world, "rivetTurret", Math.sin(angle) * 7, Math.cos(angle) * 7);
  }

  const steps = Math.round(duration / STEP);
  let minionTimer = 0;
  let warriorTimer = 0;
  const maxAlive = 45;

  for (let step = 0; step < steps; step++) {
    minionTimer -= STEP;
    warriorTimer -= STEP;
    if (minionTimer <= 0) {
      minionTimer += 0.4;
      if (world.enemies.active < maxAlive) spawnOnRing(world, "minion");
    }
    if (warriorTimer <= 0) {
      warriorTimer += 3;
      if (world.enemies.active < maxAlive) spawnOnRing(world, "warrior");
    }

    advanceHorde(world, STEP);

    rig.pressure.update(world, STEP);
    rig.weapons.update(world, STEP);
    rig.turrets.update(world, STEP);
    rig.collision.update(world, STEP);
    rig.damage.update(world, STEP);
    world.events.drain();
  }

  const player = world.stats.damageByPlayer;
  const structures = world.stats.damageByStructures;
  return {
    player,
    structures,
    kills: world.stats.enemiesKilled,
    playerShare: (player / (player + structures)) * 100,
  };
}

describe("damage share (§7.3)", () => {
  it("splits damage between the engineer and the machines, with the machines ahead", () => {
    // Three turrets is the representative mid-run position: two rack slots plus
    // one built in the field is what a leapfrog rotation actually sustains.
    const two = runEncounter(2);
    const three = runEncounter(3);
    const four = runEncounter(4);

    console.log(
      "[§7.3 damage share] 60 s hold, measured player / structures:\n" +
        `  2 turrets: ${two.playerShare.toFixed(1)}% / ${(100 - two.playerShare).toFixed(1)}%` +
        `   (${two.player.toFixed(0)} vs ${two.structures.toFixed(0)} hp, ${two.kills} kills)\n` +
        `  3 turrets: ${three.playerShare.toFixed(1)}% / ${(100 - three.playerShare).toFixed(1)}%` +
        `   (${three.player.toFixed(0)} vs ${three.structures.toFixed(0)} hp, ${three.kills} kills)` +
        "   <- representative\n" +
        `  4 turrets: ${four.playerShare.toFixed(1)}% / ${(100 - four.playerShare).toFixed(1)}%` +
        `   (${four.player.toFixed(0)} vs ${four.structures.toFixed(0)} hp, ${four.kills} kills)`,
    );

    expect(three.player + three.structures).toBeGreaterThan(2000);
    expect(three.kills).toBeGreaterThan(40);

    // Generous bounds: these assert the split is real and that the machines lead,
    // not that it is tuned. The printed figure is what a balance pass moves.
    expect(three.playerShare).toBeGreaterThan(10);
    expect(three.playerShare).toBeLessThan(50);
    expect(100 - three.playerShare).toBeGreaterThan(50);

    // More machines must always mean a smaller personal share, or the pressure
    // economy is not actually paying for itself.
    expect(four.playerShare).toBeLessThan(three.playerShare);
    expect(three.playerShare).toBeLessThan(two.playerShare);
  });
});

/** Places one enemy on a ring around the spider, walking inward. */
function spawnOnRing(world: GameWorld, archetypeId: string): void {
  const angle = world.directorRandom.angle();
  const radius = world.directorRandom.range(15, 18);
  spawnEnemy(
    world,
    archetypeId,
    world.spider.x + Math.sin(angle) * radius,
    world.spider.z + Math.cos(angle) * radius,
  );
}

/**
 * A deliberately dumb stand-in for `EnemyNavigationSystem`: walk at the core,
 * stop at attack range. It has to be local so this test measures the combat
 * systems and nothing else.
 */
function advanceHorde(world: GameWorld, dt: number): void {
  const backing = world.enemies.backing;
  for (let i = 0; i < backing.length; i++) {
    const enemy = backing[i];
    if (!enemy.active) continue;
    if (enemy.health <= 0) {
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) releaseEnemy(world, enemy);
      continue;
    }
    const archetype = getArchetype(enemy.archetype);
    const dx = world.spider.x - enemy.x;
    const dz = world.spider.z - enemy.z;
    const distance = Math.hypot(dx, dz);
    const stop = SPIDER.bodyWidth * 0.5 + archetype.attackRange;
    if (distance <= stop) continue;
    const stepLength = Math.min(enemy.speed * dt, distance - stop);
    enemy.prevX = enemy.x;
    enemy.prevZ = enemy.z;
    enemy.x += (dx / distance) * stepLength;
    enemy.z += (dz / distance) * stepLength;
  }
}
