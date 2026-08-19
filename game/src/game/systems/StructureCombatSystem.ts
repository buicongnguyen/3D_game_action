import { angleDelta, distSq, headingFromDirection, rotateToward } from "../../core/math.ts";
import type { Enemy, Structure } from "../../core/types.ts";
import { SPIDER, STRUCTURES, TRAIL } from "../../data/balance.ts";
import type { GameWorld } from "../GameWorld.ts";
import { MAX_TARGET_RADIUS, refreshEnemyHash } from "./CollisionSystem.ts";
import { emitNoise } from "./RunStateSystem.ts";
import { threatWeight } from "./WeaponSystem.ts";

/**
 * Everything the machines shoot: emplaced turrets, the dorsal turret module,
 * and the proximity trigger on a mine.
 *
 * The one rule that matters here is the firing gate. A turret fires only while
 * it is `active` and has pressure — buffer left, or a live connection to the
 * network. A starved turret is silent, and that silence is the entire point of
 * §8.2: it is the feedback that turns "the spider is my power grid" from a
 * sentence in a design document into something the player hears happen.
 *
 * Buffer is *not* consumed by firing. `PressureNetworkSystem` drains it, and it
 * drains only while the machine is outside the network, so the countdown a
 * player reads off a turret's gauge is a countdown of abandonment, not of use.
 */

/** Barrel must be within this many radians of the target before it will fire. */
const ON_TARGET_EPSILON = 0.12;

/** Muzzle offset along the barrel, past the turret's own footprint. */
const MUZZLE_FORWARD = 0.35;

/** Fraction of traverse speed used to return to the resting pose when idle. */
const REST_TRAVERSE_FRACTION = 0.5;

/** Dorsal turret muzzle height: the module sits on the spider's back deck. */
const DORSAL_MUZZLE_HEIGHT = SPIDER.bodyHeight;

/** Structure id reported for the dorsal turret, which is not a world structure. */
const DORSAL_ID = -1;

export class StructureCombatSystem {
  readonly stats = { shotsFired: 0, activeTurrets: 0 };

  private readonly candidates: number[] = [];

  /** The dorsal turret has no `Structure` record, so it carries its own state. */
  private dorsalHeading = 0;
  private dorsalCooldown = 0;
  private dorsalTargetId = -1;
  private dorsalLockTimer = 0;

  update(world: GameWorld, dt: number): void {
    refreshEnemyHash(world);
    this.stats.activeTurrets = 0;

    for (let i = 0; i < world.structures.length; i++) {
      const structure = world.structures[i];
      if (structure.kind === "rivetTurret" || structure.kind === "crawlerTurret") {
        this.updateTurret(world, structure, dt);
      } else if (structure.kind === "mine") {
        this.updateMine(world, structure);
      }
    }

    if (world.modifiers.dorsalTurret) this.updateDorsal(world, dt);
  }

  // -------------------------------------------------------------------------
  // Emplaced turrets
  // -------------------------------------------------------------------------

  private updateTurret(world: GameWorld, structure: Structure, dt: number): void {
    const config = structure.kind === "crawlerTurret"
      ? STRUCTURES.crawlerTurret
      : STRUCTURES.rivetTurret;

    if (structure.state === "destroyed" || structure.state === "folding") return;
    if (structure.state === "placing" || structure.state === "deploying") {
      structure.idleTime += dt;
      return;
    }

    const overloading = structure.state === "overloading";
    // Overload runs on the machine tearing itself apart, so it needs no supply.
    const supplied = overloading || (structure.buffer > 0 || structure.powered);
    if (!supplied || (structure.state !== "active" && !overloading)) {
      structure.idleTime += dt;
      structure.targetEnemyId = -1;
      structure.targetLockTimer = 0;
      return;
    }

    this.stats.activeTurrets++;

    if (structure.fireCooldown > 0) structure.fireCooldown -= dt;
    if (structure.targetLockTimer > 0) structure.targetLockTimer -= dt;

    const range = config.range * world.modifiers.turretRange;
    const target = this.resolveTarget(
      world,
      structure.x,
      structure.z,
      range,
      structure.targetEnemyId,
      structure.targetLockTimer > 0,
    );

    if (!target) {
      structure.targetEnemyId = -1;
      structure.targetLockTimer = 0;
      structure.idleTime += dt;
      structure.turretHeading = rotateToward(
        structure.turretHeading,
        structure.heading,
        config.traverseSpeed * REST_TRAVERSE_FRACTION * dt,
      );
      return;
    }

    if (target.id !== structure.targetEnemyId) {
      structure.targetEnemyId = target.id;
      structure.targetLockTimer = config.targetLock;
    }
    structure.idleTime = 0;

    const desired = headingFromDirection(target.x - structure.x, target.z - structure.z);
    structure.turretHeading = rotateToward(
      structure.turretHeading,
      desired,
      config.traverseSpeed * dt,
    );

    // Visibly tracking, then firing, is what sells a turret as a machine rather
    // than as a damage tick; it also costs the player a beat after re-siting one.
    if (Math.abs(angleDelta(structure.turretHeading, desired)) > ON_TARGET_EPSILON) return;
    if (structure.fireCooldown > 0) return;

    const rate = Math.max(
      0.05,
      world.modifiers.turretFireRate * (overloading ? config.lastShotFireRateMultiplier : 1),
    );
    structure.fireCooldown = config.fireInterval / rate;

    const damage =
      config.damage *
      world.modifiers.turretDamage *
      (overloading ? config.lastShotDamageMultiplier : 1);

    const offset = config.radius + MUZZLE_FORWARD;
    const muzzleX = structure.x + Math.sin(structure.turretHeading) * offset;
    const muzzleZ = structure.z + Math.cos(structure.turretHeading) * offset;

    const volley = Math.max(1, Math.floor(world.modifiers.turretVolley));
    const spread = 0.045;
    for (let shot = 0; shot < volley; shot++) {
      const headingOffset = (shot - (volley - 1) * 0.5) * spread;
      this.spawnRivet(
        world,
        muzzleX,
        muzzleZ,
        config.muzzleHeight,
        structure.turretHeading + headingOffset,
        damage,
        range,
      );
    }

    structure.shotsFired++;
    this.stats.shotsFired++;

    world.events.emit({
      type: "structure.fired",
      structureId: structure.id,
      x: structure.x,
      z: structure.z,
      muzzleX,
      muzzleY: config.muzzleHeight,
      muzzleZ,
      heading: structure.turretHeading,
      heavy: overloading,
    });
    emitNoise(
      world,
      overloading ? TRAIL.noiseHeavyShot : TRAIL.noiseShot,
      structure.x,
      structure.z,
      "turret",
    );
  }

  // -------------------------------------------------------------------------
  // Dorsal turret module
  // -------------------------------------------------------------------------

  /**
   * Same code path as an emplaced turret, minus the pressure gate: the module
   * is fed by the spider directly and never needs servicing. It pays for that
   * with Trail, which the modifier table adds passively.
   */
  private updateDorsal(world: GameWorld, dt: number): void {
    const config = STRUCTURES.rivetTurret;
    const spider = world.spider;
    this.stats.activeTurrets++;

    if (this.dorsalCooldown > 0) this.dorsalCooldown -= dt;
    if (this.dorsalLockTimer > 0) this.dorsalLockTimer -= dt;

    const range = config.range * world.modifiers.turretRange;
    const target = this.resolveTarget(
      world,
      spider.x,
      spider.z,
      range,
      this.dorsalTargetId,
      this.dorsalLockTimer > 0,
    );

    if (!target) {
      this.dorsalTargetId = -1;
      this.dorsalLockTimer = 0;
      this.dorsalHeading = rotateToward(
        this.dorsalHeading,
        spider.heading,
        config.traverseSpeed * REST_TRAVERSE_FRACTION * dt,
      );
      return;
    }

    if (target.id !== this.dorsalTargetId) {
      this.dorsalTargetId = target.id;
      this.dorsalLockTimer = config.targetLock;
    }

    const desired = headingFromDirection(target.x - spider.x, target.z - spider.z);
    this.dorsalHeading = rotateToward(this.dorsalHeading, desired, config.traverseSpeed * dt);
    if (Math.abs(angleDelta(this.dorsalHeading, desired)) > ON_TARGET_EPSILON) return;
    if (this.dorsalCooldown > 0) return;

    const rate = Math.max(0.05, world.modifiers.turretFireRate);
    this.dorsalCooldown = config.fireInterval / rate;

    const damage = config.damage * world.modifiers.turretDamage;
    const offset = SPIDER.bodyWidth * 0.5;
    const muzzleX = spider.x + Math.sin(this.dorsalHeading) * offset;
    const muzzleZ = spider.z + Math.cos(this.dorsalHeading) * offset;

    this.spawnRivet(
      world,
      muzzleX,
      muzzleZ,
      DORSAL_MUZZLE_HEIGHT,
      this.dorsalHeading,
      damage,
      range,
    );

    this.stats.shotsFired++;
    world.events.emit({
      type: "structure.fired",
      structureId: DORSAL_ID,
      x: spider.x,
      z: spider.z,
      muzzleX,
      muzzleY: DORSAL_MUZZLE_HEIGHT,
      muzzleZ,
      heading: this.dorsalHeading,
      heavy: false,
    });
    emitNoise(world, TRAIL.noiseShot, spider.x, spider.z, "dorsalTurret");
  }

  // -------------------------------------------------------------------------
  // Mines
  // -------------------------------------------------------------------------

  /**
   * Proximity trigger. The mine is zeroed rather than removed here:
   * `InteractionSystem` owns the destroyed transition, and `DamageSystem`
   * applies the blast when the event drains, so one detonation stays one event.
   */
  private updateMine(world: GameWorld, structure: Structure): void {
    if (structure.health <= 0) return;
    if (structure.state !== "active" && structure.state !== "starved") return;

    const config = STRUCTURES.mine;
    const count = world.enemyHash.query(
      this.candidates,
      structure.x,
      structure.z,
      config.range + MAX_TARGET_RADIUS,
    );
    if (count === 0) return;

    const backing = world.enemies.backing;
    for (let i = 0; i < count; i++) {
      const index = this.candidates[i];
      if (index < 0 || index >= backing.length) continue;
      const enemy = backing[index];
      if (!enemy.active || enemy.health <= 0) continue;

      const reach = config.range + enemy.radius;
      if (distSq(structure.x, structure.z, enemy.x, enemy.z) > reach * reach) continue;

      structure.health = 0;
      world.events.emit({
        type: "structure.exploded",
        structureId: structure.id,
        x: structure.x,
        z: structure.z,
        radius: config.explosionRadius,
      });
      return;
    }
  }

  // -------------------------------------------------------------------------
  // Shared targeting
  // -------------------------------------------------------------------------

  /**
   * One broadphase query serves both jobs: revalidating the locked target and
   * scoring a replacement. Hysteresis keeps the barrel on a target until it
   * dies, leaves range, or the lock expires, so turrets do not flicker between
   * two equidistant minions in a crowd.
   */
  private resolveTarget(
    world: GameWorld,
    x: number,
    z: number,
    range: number,
    lockedId: number,
    locked: boolean,
  ): Enemy | null {
    const count = world.enemyHash.query(this.candidates, x, z, range + MAX_TARGET_RADIUS);
    if (count === 0) return null;

    const backing = world.enemies.backing;
    let held: Enemy | null = null;
    let best: Enemy | null = null;
    let bestScore = -Infinity;

    for (let i = 0; i < count; i++) {
      const index = this.candidates[i];
      if (index < 0 || index >= backing.length) continue;
      const enemy = backing[index];
      if (!enemy.active || enemy.health <= 0 || enemy.state === "DEAD") continue;

      const d2 = distSq(x, z, enemy.x, enemy.z);
      const reach = range + enemy.radius;
      if (d2 > reach * reach) continue;

      if (enemy.id === lockedId) held = enemy;

      const score = threatWeight(enemy.archetype) / (1 + d2 * 0.02);
      if (score > bestScore) {
        bestScore = score;
        best = enemy;
      }
    }

    if (locked && held) return held;
    return best;
  }

  private spawnRivet(
    world: GameWorld,
    x: number,
    z: number,
    y: number,
    heading: number,
    damage: number,
    range: number,
  ): void {
    const config = STRUCTURES.rivetTurret;
    const projectile = world.projectiles.acquire();
    if (!projectile) return;

    projectile.id = world.allocateId();
    projectile.x = x;
    projectile.z = z;
    projectile.y = y;
    projectile.prevX = x;
    projectile.prevZ = z;
    projectile.prevY = y;
    projectile.velocityX = Math.sin(heading) * config.projectileSpeed;
    projectile.velocityZ = Math.cos(heading) * config.projectileSpeed;
    projectile.speed = config.projectileSpeed;
    projectile.damage = damage;
    projectile.lifetime = (range / config.projectileSpeed) * 1.3;
    projectile.source = "structure.turret";
    projectile.pierceLeft = 0;
    projectile.lastHitId = -1;
    projectile.variant = 0;
    projectile.active = true;
  }
}
