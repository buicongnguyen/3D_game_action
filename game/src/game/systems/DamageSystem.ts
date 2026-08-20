import { clamp01, distSq } from "../../core/math.ts";
import type { StructureExplodedEvent } from "../../core/events.ts";
import type { DamageInfo, DamageSource, Enemy, Structure, StructureKind } from "../../core/types.ts";
import { ENEMY_LIFECYCLE, PICKUPS, PLAYER, SPIDER, STRUCTURES, TRAIL } from "../../data/balance.ts";
import { getArchetype } from "../../data/enemies.ts";
import { getStructureConfig } from "../../data/structures.ts";
import type { GameWorld } from "../GameWorld.ts";
import { MAX_TARGET_RADIUS, refreshEnemyHash } from "./CollisionSystem.ts";
import type { InteractionSystem } from "./InteractionSystem.ts";
import { emitNoise } from "./RunStateSystem.ts";

/**
 * The single funnel every point of damage passes through.
 *
 * Centralising it is what makes the §7.3 damage-share gate measurable: there is
 * exactly one place that decides whether a hit is credited to the engineer or to
 * the machines, so `stats.damageByPlayer` / `stats.damageByStructures` can be
 * trusted as a balance instrument rather than as an estimate.
 *
 * Attribution counts *applied* damage, never the raw roll, so a 400-damage
 * overkill on a 20 hp minion cannot inflate either side of the ratio.
 */

/** Damage retained at the rim of a blast. The centre always takes the full amount. */
const EXPLOSION_RIM_FRACTION = 0.35;

/** Knockback impulse scale for explosions, relative to the blast radius. */
const EXPLOSION_KNOCKBACK = 0.9;

/**
 * Relative scrap-drop bonus when the engineer lands the killing blow. It gives
 * `killedByPlayer` real weight without punishing a turret kill, which would
 * fight the 60-70% structure-damage target the whole design rests on.
 */
const PLAYER_KILL_LOOT_BONUS = 1.25;

/** Seconds of grace granted on revival, on top of the normal hit immunity. */
const REVIVE_IMMUNITY = 1.6;

/** Distance behind the spider where the rescue automaton drops the engineer. */
const REVIVE_OFFSET = 3.2;

export class DamageSystem {
  /** Seconds left before the rescue automaton puts the engineer back up. */
  private downedTimer = 0;

  /**
   * Kind by structure id. A structure is already spliced out of the world by
   * the time its `structure.exploded` event drains, so the blast payload has to
   * be resolved from a record taken while it still existed.
   */
  private readonly structureKinds = new Map<number, StructureKind>();

  private subscribedWorld: GameWorld | null = null;
  private unsubscribe: (() => void) | null = null;

  private readonly explodeCandidates: number[] = [];

  constructor(private readonly interactions: InteractionSystem) {}

  private readonly handleExplosion = (event: StructureExplodedEvent): void => {
    const world = this.subscribedWorld;
    if (!world) return;
    const kind = this.resolveExplodedKind(event);
    const config = getStructureConfig(kind);
    this.structureKinds.delete(event.structureId);
    if (config.explosionDamage <= 0) return;
    this.explode(
      world,
      event.x,
      event.z,
      event.radius > 0 ? event.radius : config.explosionRadius,
      config.explosionDamage,
      "structure.explosion",
    );
  };

  update(world: GameWorld, dt: number): void {
    if (this.subscribedWorld !== world) {
      if (this.unsubscribe) this.unsubscribe();
      this.subscribedWorld = world;
      this.unsubscribe = world.events.on("structure.exploded", this.handleExplosion);
    }

    // Snapshot kinds while the structures are still in the array; explosions are
    // resolved from this after the structure has been removed.
    if (this.structureKinds.size > 256) this.structureKinds.clear();
    for (let i = 0; i < world.structures.length; i++) {
      const structure = world.structures[i];
      this.structureKinds.set(structure.id, structure.kind);
    }

    this.updateDowned(world, dt);
  }

  // -------------------------------------------------------------------------
  // Enemies
  // -------------------------------------------------------------------------

  applyToEnemy(world: GameWorld, enemy: Enemy, info: DamageInfo): void {
    if (!enemy.active || enemy.health <= 0 || enemy.state === "DEAD") return;

    const applied = info.amount < enemy.health ? info.amount : enemy.health;
    enemy.health -= info.amount;

    if (info.source === "player.weapon") {
      enemy.playerLootCredit = true;
      world.stats.damageByPlayer += applied;
    } else if (info.source === "structure.turret" || info.source === "structure.explosion") {
      world.stats.damageByStructures += applied;
    }

    if (info.knockback > 0) {
      const archetype = getArchetype(enemy.archetype);
      const push = info.knockback * (1 - archetype.knockbackResistance);
      if (push > 0) {
        let dx = enemy.x - info.originX;
        let dz = enemy.z - info.originZ;
        const lenSq = dx * dx + dz * dz;
        if (lenSq > 1e-6) {
          const inv = 1 / Math.sqrt(lenSq);
          dx *= inv;
          dz *= inv;
        } else {
          dx = 0;
          dz = 1;
        }
        enemy.knockX += dx * push;
        enemy.knockZ += dz * push;
      }
    }

    // Hit reaction. Combat previously had cause and no visible effect: a
    // skeleton being shot rendered identically to an untouched one, which every
    // visual reviewer flagged independently. Flash and shove direction live on
    // the entity so the render layer can express them without another event
    // subscription and without a material per body.
    enemy.hitFlash = info.critical ? 0.17 : 0.12;
    let hitX = enemy.x - info.originX;
    let hitZ = enemy.z - info.originZ;
    const hitLenSq = hitX * hitX + hitZ * hitZ;
    if (hitLenSq > 1e-6) {
      const inv = 1 / Math.sqrt(hitLenSq);
      hitX *= inv;
      hitZ *= inv;
    } else {
      hitX = 0;
      hitZ = 1;
    }
    enemy.hitDirX = hitX;
    enemy.hitDirZ = hitZ;

    const fraction = enemy.maxHealth > 0 ? clamp01(enemy.health / enemy.maxHealth) : 0;
    world.events.emit({
      type: "enemy.damaged",
      enemyId: enemy.id,
      x: enemy.x,
      z: enemy.z,
      amount: applied,
      source: info.source,
      healthFraction: fraction,
      critical: info.critical,
    });

    if (enemy.health <= 0) this.killEnemy(world, enemy, info.source);
  }

  private killEnemy(world: GameWorld, enemy: Enemy, source: DamageSource): void {
    const archetype = getArchetype(enemy.archetype);
    const killedByPlayer = source === "player.weapon";

    enemy.health = 0;
    enemy.state = "DEAD";
    enemy.stateTimer = ENEMY_LIFECYCLE.deathDuration;
    enemy.velocityX = 0;
    enemy.velocityZ = 0;
    enemy.knockX = 0;
    enemy.knockZ = 0;
    enemy.targetId = -1;
    // Keep a nearby rig for the collapse; distant bodies without a rig are
    // deliberately hidden by WorldView instead of showing an upright card.
    enemy.lodTier = 0;
    world.stats.enemiesKilled++;

    world.events.emit({
      type: "enemy.died",
      enemyId: enemy.id,
      archetype: enemy.archetype,
      x: enemy.x,
      z: enemy.z,
      killedByPlayer,
      xp: archetype.xp,
    });

    const chance = killedByPlayer
      ? archetype.scrapDropChance * PLAYER_KILL_LOOT_BONUS
      : archetype.scrapDropChance;
    if (archetype.scrapDrop > 0 && world.random.next() < chance) {
      this.interactions.spawnPickup(
        world, "scrap", enemy.x, enemy.z, archetype.scrapDrop, 0.35,
        undefined, enemy.playerLootCredit ? PICKUPS.creditedLootRadius : 0,
      );
    }

  }

  // -------------------------------------------------------------------------
  // Player
  // -------------------------------------------------------------------------

  applyToPlayer(world: GameWorld, info: DamageInfo): void {
    const player = world.player;
    if (player.downed) return;
    // The dodge grants immunity for its whole duration plus a tail; both are
    // checked explicitly so a dodge started this very tick already protects.
    if (player.dodgeTimer > 0 || player.invulnerability > 0) return;
    if (info.amount <= 0) return;

    const applied = info.amount < player.health ? info.amount : player.health;
    player.health -= info.amount;
    if (player.health < 0) player.health = 0;
    player.invulnerability = PLAYER.hitInvulnerability;
    player.animState = "hit";
    player.animLock = 0.25;

    world.events.emit({
      type: "player.damaged",
      amount: applied,
      remaining: player.health,
      fromX: info.originX,
      fromZ: info.originZ,
    });
    world.events.emit({ type: "camera.shake", intensity: 0.35, duration: 0.25 });

    if (player.health <= 0) this.downPlayer(world);
  }

  private downPlayer(world: GameWorld): void {
    const player = world.player;
    player.health = 0;
    player.downed = true;
    player.animState = "death";
    player.velocityX = 0;
    player.velocityZ = 0;
    this.downedTimer = PLAYER.downedDuration;

    if (player.rescueCharges > 0) player.rescueCharges--;

    world.events.emit({
      type: "player.downed",
      x: player.x,
      z: player.z,
      chargesRemaining: player.rescueCharges,
    });
  }

  /**
   * §13 simplification for the slice: going down is always survivable, and the
   * run only ends when the core does. The cost is paid in scrap and in core
   * health, which is what keeps a knockdown expensive without ending the run on
   * a single mistake.
   */
  private updateDowned(world: GameWorld, dt: number): void {
    const player = world.player;
    if (!player.downed) return;

    this.downedTimer -= dt;
    if (this.downedTimer > 0) return;

    const spider = world.spider;
    player.downed = false;
    player.health = player.maxHealth * PLAYER.reviveHealthFraction;
    player.invulnerability = PLAYER.hitInvulnerability + REVIVE_IMMUNITY;
    player.animState = "idle";
    player.animLock = 0;
    player.actionKind = null;
    player.actionTargetId = -1;
    player.actionProgress = 0;
    player.carry = { kind: "none" };
    player.velocityX = 0;
    player.velocityZ = 0;

    player.x = spider.x - Math.sin(spider.heading) * REVIVE_OFFSET;
    player.z = spider.z - Math.cos(spider.heading) * REVIVE_OFFSET;
    player.prevX = player.x;
    player.prevZ = player.z;

    const penalty = Math.min(world.resources.scrap, PLAYER.reviveScrapPenalty);
    if (penalty > 0) {
      world.resources.scrap -= penalty;
      world.events.emit({ type: "resource.spent", kind: "scrap", amount: penalty, reason: "rescue" });
    }

    spider.coreHealth = Math.max(0, spider.coreHealth - PLAYER.reviveCoreDamage);

    world.events.emit({ type: "player.revived", x: player.x, z: player.z });

    if (spider.coreHealth <= 0) this.endRunOnCoreLoss(world);
  }

  // -------------------------------------------------------------------------
  // Spider
  // -------------------------------------------------------------------------

  applyToSpider(world: GameWorld, info: DamageInfo): void {
    const spider = world.spider;
    if (info.amount <= 0 || spider.coreHealth <= 0) return;

    let remaining = info.amount;
    let absorbed = 0;
    if (spider.shield > 0) {
      absorbed = remaining < spider.shield ? remaining : spider.shield;
      spider.shield -= absorbed;
      remaining -= absorbed;
    }

    // Any contact resets the regeneration delay, so sustained pressure keeps the
    // shield down; that is what makes the shield a buffer against burst damage
    // rather than a second health bar.
    spider.shieldRegenDelay = SPIDER.shieldRegenDelay;

    const coreApplied = remaining < spider.coreHealth ? remaining : spider.coreHealth;
    if (remaining > 0) spider.coreHealth = Math.max(0, spider.coreHealth - remaining);

    world.events.emit({
      type: "spider.damaged",
      amount: absorbed + coreApplied,
      remaining: spider.coreHealth,
      absorbedByShield: remaining <= 0 && absorbed > 0,
      x: spider.x,
      z: spider.z,
    });
    world.events.emit({ type: "camera.shake", intensity: 0.45, duration: 0.3 });

    if (spider.coreHealth <= 0) this.endRunOnCoreLoss(world);
  }

  private endRunOnCoreLoss(world: GameWorld): void {
    if (world.phase === "DEFEAT") return;
    world.setPhase("DEFEAT");
    world.events.emit({ type: "run.ended", outcome: "defeat", reason: "core" });
  }

  // -------------------------------------------------------------------------
  // Structures
  // -------------------------------------------------------------------------

  /**
   * Reduces structure health only. Destruction is deliberately left to
   * `InteractionSystem.updateStructureTimers`, which already owns the
   * destroyed/removed transition; duplicating it here would emit
   * `structure.destroyed` twice for the same machine.
   */
  applyToStructure(world: GameWorld, structure: Structure, info: DamageInfo): void {
    if (structure.state === "destroyed" || info.amount <= 0) return;
    // Emplaced rivet turrets are permanent defenses once deployed. The mobile
    // crawler remains vulnerable, preserving the risk attached to a machine
    // that follows the Spider into combat.
    if (structure.kind === "rivetTurret") return;
    if (structure.health <= 0) return;
    structure.health -= info.amount;
    if (structure.health < 0) structure.health = 0;
    void world;
  }

  // -------------------------------------------------------------------------
  // Explosions
  // -------------------------------------------------------------------------

  /**
   * Radial damage with linear falloff from full at the centre to
   * `EXPLOSION_RIM_FRACTION` at the rim. Enemies only: a Last Shot that also
   * wrecked the barricade in front of it (or the engineer triggering it) would
   * make §8.3's "turn a loss into a tactical choice" into a trap.
   */
  explode(
    world: GameWorld,
    x: number,
    z: number,
    radius: number,
    damage: number,
    source: DamageSource,
  ): void {
    if (radius <= 0 || damage <= 0) return;

    refreshEnemyHash(world);
    const count = world.enemyHash.query(this.explodeCandidates, x, z, radius + MAX_TARGET_RADIUS);
    const backing = world.enemies.backing;

    for (let i = 0; i < count; i++) {
      const index = this.explodeCandidates[i];
      if (index < 0 || index >= backing.length) continue;
      const enemy = backing[index];
      if (!enemy.active || enemy.health <= 0) continue;

      const d2 = distSq(x, z, enemy.x, enemy.z);
      const reach = radius + enemy.radius;
      if (d2 > reach * reach) continue;

      const t = clamp01(Math.sqrt(d2) / radius);
      blastInfo.amount = damage * (1 - (1 - EXPLOSION_RIM_FRACTION) * t);
      blastInfo.source = source;
      blastInfo.originX = x;
      blastInfo.originZ = z;
      blastInfo.knockback = radius * EXPLOSION_KNOCKBACK;
      blastInfo.critical = false;
      this.applyToEnemy(world, enemy, blastInfo);
    }

    emitNoise(world, TRAIL.noiseExplosion, x, z, "explosion");
    world.events.emit({
      type: "vfx.request",
      effect: "explosion",
      x,
      y: 0.6,
      z,
      heading: 0,
      scale: radius,
    });
    world.events.emit({ type: "camera.shake", intensity: 0.8, duration: 0.45 });
  }

  /** Matches a drained explosion event back to the structure kind that caused it. */
  private resolveExplodedKind(event: StructureExplodedEvent): StructureKind {
    const known = this.structureKinds.get(event.structureId);
    if (known) return known;
    // Fallback for a machine that exploded before it was ever snapshotted: the
    // authored blast radii are distinct, so the radius identifies the kind.
    if (Math.abs(event.radius - STRUCTURES.mine.explosionRadius) < 1e-3) return "mine";
    if (Math.abs(event.radius - STRUCTURES.relay.explosionRadius) < 1e-3) return "relay";
    return "rivetTurret";
  }
}

const blastInfo: DamageInfo = {
  amount: 0,
  source: "structure.explosion",
  originX: 0,
  originZ: 0,
  knockback: 0,
  critical: false,
};
