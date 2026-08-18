import { clamp, distSq, headingFromDirection } from "../../core/math.ts";
import type { DamageSource, Enemy } from "../../core/types.ts";
import { TRAIL, WEAPONS } from "../../data/balance.ts";
import { getArchetype } from "../../data/enemies.ts";
import type { GameWorld } from "../GameWorld.ts";
import { MAX_TARGET_RADIUS, PROJECTILE_VARIANT_CRIT, refreshEnemyHash } from "./CollisionSystem.ts";
import { emitNoise } from "./RunStateSystem.ts";

/**
 * The engineer's personal weapon.
 *
 * It fires by itself, always. §7.3 is explicit that there is no aim button:
 * the right stick only *prioritises*, and the trigger only *narrows*. That is
 * what leaves both thumbs free for movement and building while a fight is on,
 * and it is why the engineer's damage share can be capped at 30-40% without the
 * player feeling like a spectator — they are always shooting, they are just not
 * out-damaging the machines they placed.
 */

/** Muzzle offset ahead of the engineer, and its height, for VFX and tracers. */
const MUZZLE_FORWARD = 0.55;
const MUZZLE_HEIGHT = 1.1;

/** R2 narrows the priority cone to this fraction of its resting half-angle. */
const FOCUS_CONE_TIGHTEN = 0.45;

/**
 * Score multiplier for a target outside the priority cone. Non-zero so the
 * weapon still engages when nothing is in the cone, but low enough that the
 * cone always wins when it holds anything at all.
 */
const OUTSIDE_CONE_SCORE = 0.12;

/** Threat weight per point of spawn cost: a golem outranks a minion by ~1.7x. */
const THREAT_PER_COST = 0.05;
const MAX_THREAT_COST = 15;

export class WeaponSystem {
  readonly stats = { shotsFired: 0, targetsAcquired: 0 };

  /**
   * R2. The signature this system is contracted to (`update(world, dt)`) takes
   * no input snapshot, so the trigger is pushed in by the tick assembler rather
   * than pulled from the snapshot here.
   */
  focusFire = false;
  private cycleRequested = false;
  private lastSegmentId = "";

  private readonly candidates: number[] = [];
  private lastTargetId = -1;

  setFocusFire(held: boolean): void {
    this.focusFire = held;
  }

  requestCycle(requested: boolean): void {
    this.cycleRequested = requested;
  }

  update(world: GameWorld, dt: number): void {
    const player = world.player;

    this.applyStageUnlock(world);
    if (this.cycleRequested) this.cycleWeapon(world);
    this.cycleRequested = false;

    const config = WEAPONS[player.currentWeapon];
    player.weaponHeat = Math.max(0, player.weaponHeat - config.heatCoolRate * dt);
    if (player.weaponOverheated && player.weaponHeat <= 0.35) {
      player.weaponOverheated = false;
      world.events.emit({ type: "ui.toast", message: `${config.name} cooled`, tone: "info", duration: 1.2 });
    }

    if (player.weaponCooldown > 0) player.weaponCooldown -= dt;

    // Downed, placing, or mid-dodge: the engineer is doing something else with
    // their hands. Everything else fires.
    if (player.downed || world.build.ghostActive || world.build.radialOpen) return;
    if (player.dodgeTimer > 0) return;
    if (player.weaponOverheated) return;
    if (player.weaponCooldown > 0) return;

    const target = this.acquireTarget(world);
    if (!target) return;

    if (target.id !== this.lastTargetId) {
      this.lastTargetId = target.id;
      this.stats.targetsAcquired++;
    }

    this.fire(world, target);
  }

  // -------------------------------------------------------------------------
  // Target selection
  // -------------------------------------------------------------------------

  private acquireTarget(world: GameWorld): Enemy | { id: number; x: number; z: number } | null {
    const player = world.player;
    const config = WEAPONS[player.currentWeapon];
    const range = config.range;

    refreshEnemyHash(world);
    const count = world.enemyHash.query(
      this.candidates,
      player.x,
      player.z,
      range + MAX_TARGET_RADIUS,
    );
    if (count === 0) return this.acquireSite(world, range);

    const aimLengthSq = player.aimX * player.aimX + player.aimZ * player.aimZ;
    const aiming = aimLengthSq > 1e-6;
    let aimX = 0;
    let aimZ = 0;
    let halfCone = 0;
    if (aiming) {
      const inv = 1 / Math.sqrt(aimLengthSq);
      aimX = player.aimX * inv;
      aimZ = player.aimZ * inv;
      halfCone = this.focusFire ? config.focusCone * FOCUS_CONE_TIGHTEN : config.focusCone;
    }

    const backing = world.enemies.backing;
    let best: Enemy | null = null;
    let bestScore = -Infinity;

    for (let i = 0; i < count; i++) {
      const index = this.candidates[i];
      if (index < 0 || index >= backing.length) continue;
      const enemy = backing[index];
      if (!enemy.active || enemy.health <= 0 || enemy.state === "DEAD") continue;

      const d2 = distSq(player.x, player.z, enemy.x, enemy.z);
      const reach = range + enemy.radius;
      if (d2 > reach * reach) continue;

      // No stick input: the rule is literally "nearest valid target".
      if (!aiming) {
        if (-d2 > bestScore) {
          bestScore = -d2;
          best = enemy;
        }
        continue;
      }

      const distance = Math.sqrt(d2);
      const inv = distance > 1e-4 ? 1 / distance : 0;
      const dot = clamp((enemy.x - player.x) * aimX * inv + (enemy.z - player.z) * aimZ * inv, -1, 1);
      const angle = Math.acos(dot);

      const inCone = angle <= halfCone;
      const angleFactor = inCone ? 1 - (angle / halfCone) * 0.4 : OUTSIDE_CONE_SCORE;
      const proximity = 1 - clamp(distance / range, 0, 1);
      const score = angleFactor * (0.4 + 0.6 * proximity) * threatWeight(enemy.archetype);

      if (score > bestScore) {
        bestScore = score;
        best = enemy;
      }
    }

    return best ?? this.acquireSite(world, range);
  }

  private acquireSite(world: GameWorld, range: number): { id: number; x: number; z: number } | null {
    const player = world.player;
    let best = null as { id: number; x: number; z: number } | null;
    let bestDistance = range * range;
    for (let i = 0; i < world.encounterSites.length; i++) {
      const site = world.encounterSites[i];
      if (!site.active || !site.triggered) continue;
      const distance = distSq(player.x, player.z, site.x, site.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = site;
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Firing
  // -------------------------------------------------------------------------

  private fire(world: GameWorld, target: { id: number; x: number; z: number }): void {
    const player = world.player;
    const config = WEAPONS[player.currentWeapon];

    const fireRate = Math.max(0.05, world.modifiers.playerFireRate);
    player.weaponCooldown = config.fireInterval / fireRate;

    const heading = headingFromDirection(target.x - player.x, target.z - player.z);
    const muzzleX = player.x + Math.sin(heading) * MUZZLE_FORWARD;
    const muzzleZ = player.z + Math.cos(heading) * MUZZLE_FORWARD;

    const baseDamage = config.damage * world.modifiers.playerDamage;
    const pellets = config.pellets;
    const step = pellets > 1 ? config.spread / (pellets - 1) : 0;
    const jitter = config.spread / (pellets * 4);
    const lifetime = (config.range / config.projectileSpeed) * 1.25;

    for (let i = 0; i < pellets; i++) {
      const projectile = world.projectiles.acquire();
      if (!projectile) break;

      const offset = pellets > 1 ? -config.spread * 0.5 + step * i : 0;
      const angle = heading + offset + world.random.signed(jitter);
      const critical = world.random.next() < config.critChance;

      projectile.id = world.allocateId();
      projectile.x = muzzleX;
      projectile.z = muzzleZ;
      projectile.y = MUZZLE_HEIGHT;
      projectile.prevX = muzzleX;
      projectile.prevZ = muzzleZ;
      projectile.prevY = MUZZLE_HEIGHT;
      projectile.velocityX = Math.sin(angle) * config.projectileSpeed;
      projectile.velocityZ = Math.cos(angle) * config.projectileSpeed;
      projectile.speed = config.projectileSpeed;
      projectile.damage = critical ? baseDamage * config.critMultiplier : baseDamage;
      projectile.radius = config.projectileRadius;
      projectile.lifetime = lifetime;
      projectile.source = "player.weapon" as DamageSource;
      projectile.pierceLeft = config.pierce +
        (player.currentWeapon === "rifle" ? world.modifiers.riflePierceBonus : 0);
      projectile.lastHitId = -1;
      projectile.variant = critical ? PROJECTILE_VARIANT_CRIT : 0;
      projectile.knockback = config.knockback;
      projectile.explosionRadius = config.explosionRadius;
      projectile.active = true;
    }

    this.stats.shotsFired++;

    world.events.emit({
      type: "weapon.fired",
      weaponId: config.id,
      muzzleX,
      muzzleY: MUZZLE_HEIGHT,
      muzzleZ,
      heading,
    });
    emitNoise(world, TRAIL.noiseShot, player.x, player.z, "playerShot");

    if (config.heatPerShot > 0) {
      const heatScale = player.currentWeapon === "flamer" ? world.modifiers.flamerHeatMultiplier : 1;
      player.weaponHeat = Math.min(1, player.weaponHeat + config.heatPerShot * heatScale);
      if (player.weaponHeat >= 1) {
        player.weaponOverheated = true;
        world.events.emit({ type: "ui.toast", message: `${config.name} overheated`, tone: "warning", duration: 1.8 });
      }
    }
  }

  private applyStageUnlock(world: GameWorld): void {
    const segment = world.route.segment;
    if (!segment || segment.id === this.lastSegmentId) return;
    this.lastSegmentId = segment.id;
    const unlock = segment.weaponUnlock;
    if (unlock && !world.player.unlockedWeapons.includes(unlock)) {
      world.player.unlockedWeapons.push(unlock);
      world.player.currentWeapon = unlock;
      world.player.weaponCooldown = 0;
      world.events.emit({
        type: "ui.toast",
        message: `Weapon unlocked: ${WEAPONS[unlock].name} · D-pad down / B to switch`,
        tone: "success",
        duration: 4,
      });
    }
    const blueprints = segment.blueprintUnlocks ?? [];
    for (let i = 0; i < blueprints.length; i++) {
      const blueprint = blueprints[i];
      if (world.loadout.includes(blueprint)) continue;
      world.loadout.push(blueprint);
      world.events.emit({
        type: "ui.toast", message: `Blueprint unlocked: ${blueprint}`, tone: "success", duration: 3,
      });
    }
  }

  private cycleWeapon(world: GameWorld): void {
    const player = world.player;
    if (player.unlockedWeapons.length <= 1) return;
    const current = player.unlockedWeapons.indexOf(player.currentWeapon);
    player.currentWeapon = player.unlockedWeapons[(current + 1) % player.unlockedWeapons.length];
    player.weaponCooldown = Math.min(player.weaponCooldown, 0.18);
    player.weaponOverheated = false;
    world.events.emit({
      type: "ui.toast",
      message: `Equipped ${WEAPONS[player.currentWeapon].name}`,
      tone: "info",
      duration: 1.4,
    });
  }
}

/** Threat class weight, derived from the director's spawn cost for the archetype. */
export function threatWeight(archetypeId: string): number {
  const cost = getArchetype(archetypeId).spawnCost;
  return 1 + Math.min(cost, MAX_THREAT_COST) * THREAT_PER_COST;
}
