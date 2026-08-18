import type { DamageInfo, EncounterSite, Projectile } from "../../core/types.ts";
import { PLAYER, SPIDER } from "../../data/balance.ts";
import { getBlueprint } from "../../data/structures.ts";
import type { GameWorld } from "../GameWorld.ts";
import type { DamageSystem } from "./DamageSystem.ts";

/**
 * Projectile motion and every projectile-vs-body test.
 *
 * A rivet leaves a turret barrel at 46 m/s. At the 60 Hz fixed step that is
 * 0.77 m of travel per tick, while a minion is a 0.38 m circle: a point test at
 * the new position would miss the target more often than it hit it. So every
 * projectile is tested as the *segment* from its previous position to its new
 * one, which makes a hit independent of frame rate and of projectile speed.
 *
 * Broadphase is `world.enemyHash`, queried once per projectile step with a
 * radius that covers the whole swept segment. There is no all-vs-all pass.
 */

/** Largest body radius in the roster (golem, 0.95 m); pads every hash query. */
export const MAX_TARGET_RADIUS = 1;

/**
 * `variant` doubles as the crit flag so a critical hit survives the trip from
 * the muzzle to the impact without widening `Projectile`. It is a *visual*
 * variant index, and a crit rivet is exactly that.
 */
export const PROJECTILE_VARIANT_CRIT = 1;

export class CollisionSystem {
  readonly stats = { projectileChecks: 0, hits: 0 };

  private readonly candidates: number[] = [];
  /** Enemy ids struck by the projectile currently being swept. */
  private readonly struck: number[] = [];

  constructor(private readonly damage: DamageSystem) {}

  update(world: GameWorld, dt: number): void {
    // Rebuilt here rather than assumed fresh: a swept test against stale
    // positions is exactly the tunnelling bug this system exists to prevent.
    refreshEnemyHash(world);

    const backing = world.projectiles.backing;
    for (let i = 0; i < backing.length; i++) {
      const projectile = backing[i];
      if (!projectile.active) continue;

      projectile.lifetime -= dt;
      if (projectile.lifetime <= 0) {
        this.retire(world, projectile, i);
        continue;
      }

      projectile.prevX = projectile.x;
      projectile.prevZ = projectile.z;
      projectile.prevY = projectile.y;
      projectile.x += projectile.velocityX * dt;
      projectile.z += projectile.velocityZ * dt;

      const spent =
        projectile.source === "enemy.ranged"
          ? this.sweepDefenders(world, projectile)
          : this.sweepEnemies(world, projectile);

      if (spent) this.retire(world, projectile, i);
    }
  }

  private retire(world: GameWorld, projectile: Projectile, index: number): void {
    projectile.active = false;
    world.projectiles.release(index);
  }

  /**
   * Sweeps a friendly projectile through the horde. Piercing walks the segment
   * in order of closest approach and records every id it has already struck, so
   * one shot can never bill the same enemy twice on the same step or on a later
   * one (`lastHitId` carries the guard forward).
   */
  private sweepEnemies(world: GameWorld, projectile: Projectile): boolean {
    const ax = projectile.prevX;
    const az = projectile.prevZ;
    const bx = projectile.x;
    const bz = projectile.z;
    const midX = (ax + bx) * 0.5;
    const midZ = (az + bz) * 0.5;
    const dx = bx - ax;
    const dz = bz - az;
    const half = Math.sqrt(dx * dx + dz * dz) * 0.5;

    const count = world.enemyHash.query(
      this.candidates,
      midX,
      midZ,
      half + MAX_TARGET_RADIUS + projectile.radius,
    );
    if (count === 0) return this.sweepEncounterSites(world, projectile, ax, az, bx, bz);

    const backing = world.enemies.backing;
    this.struck.length = 0;

    // One pass per body the projectile may still pass through.
    let passes = projectile.pierceLeft + 1;
    while (passes-- > 0) {
      let bestT = Infinity;
      let victim = -1;

      for (let i = 0; i < count; i++) {
        const index = this.candidates[i];
        if (index < 0 || index >= backing.length) continue;
        const enemy = backing[index];
        if (!enemy.active || enemy.health <= 0) continue;
        if (enemy.id === projectile.lastHitId) continue;
        if (this.alreadyStruck(enemy.id)) continue;

        this.stats.projectileChecks++;
        const reach = enemy.radius + projectile.radius;
        closestApproach(ax, az, bx, bz, enemy.x, enemy.z);
        if (sweep.distSq > reach * reach) continue;
        if (sweep.t < bestT) {
          bestT = sweep.t;
          victim = index;
        }
      }

      if (victim < 0) return this.sweepEncounterSites(world, projectile, ax, az, bx, bz);

      const enemy = backing[victim];
      this.struck.push(enemy.id);
      this.stats.hits++;

      const hitX = ax + dx * bestT;
      const hitZ = az + dz * bestT;
      world.events.emit({
        type: "projectile.hit",
        x: hitX,
        z: hitZ,
        y: projectile.y,
        source: projectile.source,
      });

      hitInfo.amount = projectile.damage;
      hitInfo.source = projectile.source;
      hitInfo.originX = ax;
      hitInfo.originZ = az;
      hitInfo.knockback = projectile.knockback || TURRET_KNOCKBACK;
      hitInfo.critical = projectile.variant === PROJECTILE_VARIANT_CRIT;
      if (projectile.explosionRadius > 0) {
        this.applyExplosion(world, projectile, hitX, hitZ);
        return true;
      }
      this.damage.applyToEnemy(world, enemy, hitInfo);

      projectile.lastHitId = enemy.id;
      if (projectile.pierceLeft <= 0) return true;
      projectile.pierceLeft--;
    }

    return true;
  }

  private sweepEncounterSites(
    world: GameWorld,
    projectile: Projectile,
    ax: number,
    az: number,
    bx: number,
    bz: number,
  ): boolean {
    for (let i = 0; i < world.encounterSites.length; i++) {
      const site = world.encounterSites[i];
      if (!site.active || !site.triggered) continue;
      closestApproach(ax, az, bx, bz, site.x, site.z);
      const reach = site.radius + projectile.radius;
      if (sweep.distSq > reach * reach) continue;
      this.damageEncounterSite(world, site, projectile.damage);
      world.events.emit({ type: "projectile.hit", x: site.x, z: site.z, y: projectile.y, source: projectile.source });
      return true;
    }
    return false;
  }

  private applyExplosion(world: GameWorld, projectile: Projectile, x: number, z: number): void {
    const radius = projectile.explosionRadius;
    const radiusSq = radius * radius;
    const backing = world.enemies.backing;
    for (let i = 0; i < backing.length; i++) {
      const enemy = backing[i];
      if (!enemy.active || enemy.health <= 0) continue;
      const dx = enemy.x - x;
      const dz = enemy.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > radiusSq) continue;
      const falloff = 1 - Math.sqrt(d2) / radius;
      hitInfo.amount = projectile.damage * (0.35 + falloff * 0.65);
      hitInfo.source = projectile.source;
      hitInfo.originX = x;
      hitInfo.originZ = z;
      hitInfo.knockback = projectile.knockback * (0.4 + falloff * 0.6);
      hitInfo.critical = projectile.variant === PROJECTILE_VARIANT_CRIT;
      this.damage.applyToEnemy(world, enemy, hitInfo);
    }
    for (let i = 0; i < world.encounterSites.length; i++) {
      const site = world.encounterSites[i];
      if (!site.active) continue;
      const distance = Math.hypot(site.x - x, site.z - z);
      if (distance > radius + site.radius) continue;
      this.damageEncounterSite(world, site, projectile.damage * 0.8);
    }
    world.events.emit({
      type: "vfx.request",
      effect: "magneticBlast",
      x,
      y: projectile.y,
      z,
      heading: 0,
      scale: radius,
    });
    world.events.emit({ type: "camera.shake", intensity: 0.22, duration: 0.18 });
  }

  private damageEncounterSite(world: GameWorld, site: EncounterSite, amount: number): void {
    if (!site.active) return;
    const applied = Math.min(site.health, amount);
    site.health -= applied;
    world.stats.damageByPlayer += applied;
    if (site.health > 0) return;
    site.active = false;
    world.resources.scrap += 25;
    world.stats.scrapCollected += 25;
    world.stats.nestsDestroyed++;
    world.events.emit({ type: "vfx.request", effect: "magneticBlast", x: site.x, y: 1, z: site.z, heading: 0, scale: 4.5 });
    world.events.emit({ type: "ui.toast", message: "Enemy nest destroyed · +25 scrap", tone: "success", duration: 2.5 });
  }

  /** Hostile projectiles: the engineer first, then the spider, then structures. */
  private sweepDefenders(world: GameWorld, projectile: Projectile): boolean {
    const ax = projectile.prevX;
    const az = projectile.prevZ;
    const bx = projectile.x;
    const bz = projectile.z;

    const player = world.player;
    this.stats.projectileChecks++;
    closestApproach(ax, az, bx, bz, player.x, player.z);
    const playerReach = PLAYER.radius + projectile.radius;
    if (sweep.distSq <= playerReach * playerReach) {
      this.stats.hits++;
      fillHostileInfo(projectile, ax, az);
      world.events.emit({
        type: "projectile.hit",
        x: player.x,
        z: player.z,
        y: projectile.y,
        source: projectile.source,
      });
      this.damage.applyToPlayer(world, hitInfo);
      return true;
    }

    const spider = world.spider;
    this.stats.projectileChecks++;
    closestApproach(ax, az, bx, bz, spider.x, spider.z);
    const spiderReach = SPIDER.bodyWidth * 0.5 + projectile.radius;
    if (sweep.distSq <= spiderReach * spiderReach) {
      this.stats.hits++;
      fillHostileInfo(projectile, ax, az);
      world.events.emit({
        type: "projectile.hit",
        x: spider.x,
        z: spider.z,
        y: projectile.y,
        source: projectile.source,
      });
      this.damage.applyToSpider(world, hitInfo);
      return true;
    }

    for (let i = 0; i < world.structures.length; i++) {
      const structure = world.structures[i];
      if (structure.state === "destroyed") continue;
      this.stats.projectileChecks++;
      closestApproach(ax, az, bx, bz, structure.x, structure.z);
      const reach = getBlueprint(structure.kind).radius + projectile.radius;
      if (sweep.distSq > reach * reach) continue;
      this.stats.hits++;
      fillHostileInfo(projectile, ax, az);
      world.events.emit({
        type: "projectile.hit",
        x: structure.x,
        z: structure.z,
        y: projectile.y,
        source: projectile.source,
      });
      this.damage.applyToStructure(world, structure, hitInfo);
      return true;
    }

    return false;
  }

  private alreadyStruck(id: number): boolean {
    for (let i = 0; i < this.struck.length; i++) {
      if (this.struck[i] === id) return true;
    }
    return false;
  }
}

/** Knockback carried by a turret rivet; lighter than the engineer's scattergun. */
const TURRET_KNOCKBACK = 0.9;

const hitInfo: DamageInfo = {
  amount: 0,
  source: "player.weapon",
  originX: 0,
  originZ: 0,
  knockback: 0,
  critical: false,
};

/** Closest approach of a point to a segment. Writes into `sweep`; no sqrt. */
const sweep = { t: 0, distSq: 0 };

function closestApproach(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  px: number,
  pz: number,
): void {
  const abx = bx - ax;
  const abz = bz - az;
  const lenSq = abx * abx + abz * abz;
  let t: number;
  if (lenSq < 1e-9) {
    t = 0;
  } else {
    t = ((px - ax) * abx + (pz - az) * abz) / lenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  const cx = ax + abx * t - px;
  const cz = az + abz * t - pz;
  sweep.t = t;
  sweep.distSq = cx * cx + cz * cz;
}

function fillHostileInfo(projectile: Projectile, originX: number, originZ: number): void {
  hitInfo.amount = projectile.damage;
  hitInfo.source = projectile.source;
  hitInfo.originX = originX;
  hitInfo.originZ = originZ;
  hitInfo.knockback = 0;
  hitInfo.critical = false;
}

/**
 * Rebuilds the enemy broadphase, keyed by **pool slot index** rather than by
 * entity id, so a query result resolves to an enemy in O(1) instead of forcing
 * a linear id lookup per candidate. Every combat system calls this immediately
 * before it queries, which makes the systems order-independent.
 */
export function refreshEnemyHash(world: GameWorld): void {
  const hash = world.enemyHash;
  hash.clear();
  const backing = world.enemies.backing;
  for (let i = 0; i < backing.length; i++) {
    const enemy = backing[i];
    if (!enemy.active || enemy.health <= 0) continue;
    hash.insert(i, enemy.x, enemy.z);
  }
}
