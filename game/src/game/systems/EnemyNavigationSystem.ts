import { clamp, damp, dampAngle, distSq, headingFromDirection } from "../../core/math.ts";
import type { Vec2 } from "../../core/math.ts";
import type {
  DamageInfo,
  Enemy,
  EnemyArchetype,
  EnemyTargetKind,
  Structure,
} from "../../core/types.ts";
import { DIRECTOR, NAVIGATION, PERFORMANCE, PLAYER, SPIDER, STRUCTURES } from "../../data/balance.ts";
import { ENEMY_ARCHETYPES, getArchetype } from "../../data/enemies.ts";
import { getBlueprint } from "../../data/structures.ts";
import type { NavigationGrid } from "../navigation/NavigationGrid.ts";
import {
  arrive,
  avoidObstacles,
  combine,
  createSteeringScratch,
  followFlow,
  separation,
} from "../navigation/Steering.ts";
import type { GameWorld } from "../GameWorld.ts";
import { terrainSpeedMultiplier } from "../route/RouteHazards.ts";

/**
 * Horde navigation, target selection, the enemy state machine and LOD.
 *
 * The whole horde shares one flow field toward the spider's core, rebuilt three
 * times a second — never per enemy, never per tick. That single sweep is what
 * turns "130 pathfinders" into "one Dijkstra plus 130 vector adds", and it is
 * the reason 200 enemies fit inside the 5 ms simulation budget from §22.
 *
 * The split of work per tick is deliberate:
 *   - timers, target scoring and state transitions run every tick for every
 *     enemy (a subtract and a compare each — the cooldowns are the throttle);
 *   - steering, neighbour queries, obstacle probes and integration run on an
 *     LOD stride, with the accumulated dt, because those are the costly parts.
 *
 * Target selection is scored, not nearest-first, and the score is held for
 * ~1.2 s per enemy. Without that hold a barricade and a turret at similar range
 * make the horde jitter between them; with it, a barricade reads as a decoy the
 * player deliberately placed.
 */

// ---------------------------------------------------------------------------
// Tuning that is local to the AI rather than global balance.
// ---------------------------------------------------------------------------

/** Seconds between target re-scores, before the per-enemy phase stagger. */
const TARGET_RESCORE_INTERVAL = 1.2;
/** Stagger band applied to the interval, keyed on `enemy.phase`. */
const TARGET_RESCORE_JITTER = 0.4;
/** A new target must beat the held one by this factor to steal it. */
const TARGET_SWITCH_MARGIN = 1.12;

/** Distance at which the proximity term has fallen to half. */
const PROXIMITY_REFERENCE = 12;
/** Baseline desirability of the spider's core. Everything is relative to this. */
const CORE_WEIGHT = 1;
/** Baseline desirability of the engineer, before the close-range bonus. */
const PLAYER_WEIGHT = 0.8;
/** Extra weight the engineer gains at zero range, falling off linearly. */
const PLAYER_CLOSE_BONUS = 1.6;
const PLAYER_THREAT_DISTANCE = 7;
/** Distant enemies rally on the encounter before choosing a tactical target. */
const OUTER_RALLY_DISTANCE = 18;

/** Inside this range an enemy seeks its target directly, unquantised by cells. */
const DIRECT_SEEK_DISTANCE = 7;
/** A blocked enemy is nudged to the nearest reachable cell after this long. */
const STUCK_RECOVERY_SECONDS = 1.1;
/** Fraction of intended step distance that still counts as useful progress. */
const STUCK_PROGRESS_FRACTION = 0.2;

/**
 * Awakening beat for an on-screen spawn; the off-screen case is near-instant.
 * Exported because the director is what decides whether a given spawn earns the
 * awakening at all, and both halves must agree on the length of the beat.
 */
export const AWAKEN_DURATION = 1.15;
export const SPAWN_SETTLE_DURATION = 0.12;

/**
 * An enemy staggers when the impulse pushes it back faster than this multiple
 * of its own walking speed — "knocked off its stride", literally. Expressing the
 * threshold against the archetype's speed rather than as a flat number is what
 * keeps a shotgun blast meaningful against a minion and a mere nudge against
 * the slower, heavier things that already resist most of the impulse.
 */
const STAGGER_SPEED_FACTOR = 0.9;
const STAGGER_DURATION = 0.45;
/** Half-life of the knockback impulse. */
const KNOCK_HALF_LIFE = 0.09;
/** Below this the knockback is no longer worth an integration step. */
const KNOCK_EPSILON = 0.05;

/** Velocity and heading smoothing, so the horde has weight without lag. */
const VELOCITY_HALF_LIFE = 0.07;
const HEADING_HALF_LIFE = 0.06;

/** Extra reach before an attacker gives up and closes again. */
const ATTACK_RELEASE_MARGIN = 0.6;

/** The spider's hull is wide; enemies must not have to reach its centre. */
const CORE_TARGET_RADIUS = SPIDER.bodyWidth * 0.5;

const BARRICADE_TAUNT = STRUCTURES.barricade.tauntWeight;

const DESPAWN_DISTANCE_SQ = DIRECTOR.despawnDistance * DIRECTOR.despawnDistance;
const LOD_NEAR_SQ = NAVIGATION.lodNearDistance * NAVIGATION.lodNearDistance;
const LOD_FAR_SQ = NAVIGATION.lodFarDistance * NAVIGATION.lodFarDistance;
const FLOW_INTERVAL = 1 / NAVIGATION.flowFieldHz;

/** Largest radius in the roster, so one hash query covers every pairing. */
const MAX_ENEMY_RADIUS = largestEnemyRadius();

function largestEnemyRadius(): number {
  let largest = 0;
  for (const id in ENEMY_ARCHETYPES) {
    const radius = ENEMY_ARCHETYPES[id].radius;
    if (radius > largest) largest = radius;
  }
  return largest;
}

// ---------------------------------------------------------------------------
// Module-scope scratch. Reused every tick by every enemy; never reallocated.
// ---------------------------------------------------------------------------

const steerOut: Vec2 = { x: 0, z: 0 };

/** Resolved target of the enemy currently being stepped. */
const target = { x: 0, z: 0, radius: 0 };
let targetStructure: Structure | null = null;

// ---------------------------------------------------------------------------
// Adapters
//
// `NavigationGrid` answers per-cell questions; enemies are circles. This is the
// only place that bridges the two, and it deliberately treats "outside the
// sliding window" as open ground: the window is 60 m around the spider while
// enemies live out to the 78 m despawn distance, so reading out-of-bounds as
// blocked would freeze every enemy still walking in.
// ---------------------------------------------------------------------------

function isBlockedCircle(grid: NavigationGrid, x: number, z: number, radius: number): boolean {
  let cell = grid.worldToCell(x, z);
  if (cell >= 0 && grid.isBlocked(cell)) return true;
  cell = grid.worldToCell(x + radius, z);
  if (cell >= 0 && grid.isBlocked(cell)) return true;
  cell = grid.worldToCell(x - radius, z);
  if (cell >= 0 && grid.isBlocked(cell)) return true;
  cell = grid.worldToCell(x, z + radius);
  if (cell >= 0 && grid.isBlocked(cell)) return true;
  cell = grid.worldToCell(x, z - radius);
  return cell >= 0 && grid.isBlocked(cell);
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// ---------------------------------------------------------------------------

export class EnemyNavigationSystem {
  readonly stats = { flowRebuilds: 0, steered: 0, fullLod: 0, unstuck: 0, lastRebuildMs: 0 };

  private focusX = 0;
  private focusZ = 0;
  private hasFocus = false;

  private flowTimer = 0;
  /** Own step counter: the stride must not depend on another system's tick. */
  private step = 0;

  private readonly scratch = createSteeringScratch();
  /** Neighbour ids from the spatial hash; `query` truncates, never reallocates. */
  private readonly neighbours: number[] = [];

  /** Bounded max-heap holding the `maxFullAnimationEnemies` nearest distances. */
  private readonly lodHeap = new Float64Array(PERFORMANCE.maxFullAnimationEnemies);
  private lodHeapSize = 0;

  /** Camera focus, so LOD is computed against what the player can actually see. */
  setFocus(x: number, z: number): void {
    this.focusX = x;
    this.focusZ = z;
    this.hasFocus = true;
  }

  update(world: GameWorld, dt: number): void {
    this.step++;
    this.stats.steered = 0;

    this.rebuildHash(world);
    this.updateFlowField(world, dt);
    this.assignLod(world);
    this.stepEnemies(world, dt);
  }

  // -------------------------------------------------------------------------
  // Shared per-tick structures
  // -------------------------------------------------------------------------

  /**
   * The hash is rebuilt from scratch every tick rather than updated in place.
   * Enemies move every tick, so a full rebuild is both cheaper and immune to the
   * stale-cell bugs that an incremental version invites.
   */
  private rebuildHash(world: GameWorld): void {
    const hash = world.enemyHash;
    hash.clear();
    const backing = world.enemies.backing;
    for (let i = 0; i < backing.length; i++) {
      const enemy = backing[i];
      if (!enemy.active || enemy.state === "DEAD") continue;
      // The id is the pool slot, so separation can index the backing array
      // directly instead of scanning for an entity id.
      hash.insert(i, enemy.x, enemy.z);
    }
  }

  private updateFlowField(world: GameWorld, dt: number): void {
    this.flowTimer -= dt;
    if (this.flowTimer > 0) return;
    this.flowTimer = FLOW_INTERVAL;

    const spider = world.spider;
    const started = nowMs();
    // Recentre first: the field snapshots the window origin at rebuild time.
    world.navigation.recenter(spider.x, spider.z);
    world.flowField.rebuild(spider.x, spider.z);
    this.stats.lastRebuildMs = nowMs() - started;
    this.stats.flowRebuilds++;
  }

  // -------------------------------------------------------------------------
  // Level of detail
  // -------------------------------------------------------------------------

  /**
   * Assigns `lodTier` by distance from the camera focus, then caps the number of
   * full-rate enemies at `PERFORMANCE.maxFullAnimationEnemies` by preferring the
   * nearest. The cut-off comes from a bounded max-heap rather than a sort, so
   * the pass is O(n log 64) with no allocation and no comparator closure.
   */
  private assignLod(world: GameWorld): void {
    const focusX = this.hasFocus ? this.focusX : world.player.x;
    const focusZ = this.hasFocus ? this.focusZ : world.player.z;
    const cap = PERFORMANCE.maxFullAnimationEnemies;
    const backing = world.enemies.backing;

    this.lodHeapSize = 0;
    for (let i = 0; i < backing.length; i++) {
      const enemy = backing[i];
      if (!enemy.active || enemy.state === "DEAD") continue;
      const d2 = distSq(enemy.x, enemy.z, focusX, focusZ);
      if (d2 > LOD_NEAR_SQ) continue;
      this.heapOffer(d2, cap);
    }

    const threshold = this.lodHeapSize >= cap ? this.lodHeap[0] : Infinity;

    let full = 0;
    for (let i = 0; i < backing.length; i++) {
      const enemy = backing[i];
      if (!enemy.active) continue;
      const d2 = distSq(enemy.x, enemy.z, focusX, focusZ);
      if (d2 <= LOD_NEAR_SQ && d2 <= threshold && full < cap) {
        enemy.lodTier = 0;
        full++;
      } else if (d2 <= LOD_FAR_SQ) {
        enemy.lodTier = 1;
      } else {
        enemy.lodTier = 2;
      }
    }
    this.stats.fullLod = full;
  }

  /** Keeps the `cap` smallest values seen; the root is the largest of those. */
  private heapOffer(value: number, cap: number): void {
    const heap = this.lodHeap;
    if (this.lodHeapSize < cap) {
      let i = this.lodHeapSize++;
      heap[i] = value;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (heap[parent] >= heap[i]) break;
        const swap = heap[parent];
        heap[parent] = heap[i];
        heap[i] = swap;
        i = parent;
      }
      return;
    }
    if (value >= heap[0]) return;
    heap[0] = value;
    let i = 0;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let largest = i;
      if (left < cap && heap[left] > heap[largest]) largest = left;
      if (right < cap && heap[right] > heap[largest]) largest = right;
      if (largest === i) break;
      const swap = heap[largest];
      heap[largest] = heap[i];
      heap[i] = swap;
      i = largest;
    }
  }

  // -------------------------------------------------------------------------
  // Per-enemy update
  // -------------------------------------------------------------------------

  private stepEnemies(world: GameWorld, dt: number): void {
    const backing = world.enemies.backing;
    const player = world.player;
    const spider = world.spider;

    for (let i = 0; i < backing.length; i++) {
      const enemy = backing[i];
      if (!enemy.active) continue;

      if (enemy.health <= 0) {
        // Death, loot and XP belong to the experience system; this only stops
        // a corpse from steering while that system gets to it.
        enemy.state = "DEAD";
        continue;
      }
      if (enemy.state === "DEAD") continue;

      enemy.prevX = enemy.x;
      enemy.prevZ = enemy.z;
      enemy.prevHeading = enemy.heading;

      // Recycled silently: no death event, no loot. An enemy the player never
      // saw must not pay out, or walking away would farm the director.
      if (
        distSq(enemy.x, enemy.z, player.x, player.z) > DESPAWN_DISTANCE_SQ &&
        distSq(enemy.x, enemy.z, spider.x, spider.z) > DESPAWN_DISTANCE_SQ
      ) {
        releaseEnemy(world, enemy);
        continue;
      }

      const archetype = getArchetype(enemy.archetype);

      if (enemy.targetCooldown > 0) enemy.targetCooldown -= dt;
      if (enemy.attackCooldown > 0) enemy.attackCooldown -= dt;
      if (enemy.stateTimer > 0) enemy.stateTimer -= dt;
      if (enemy.lodTimer > 0) enemy.lodTimer -= dt;

      this.applyKnockback(world, enemy, archetype, dt);

      let valid = this.resolveTarget(world, enemy);
      if (enemy.targetCooldown <= 0 || !valid) {
        this.scoreTargets(world, enemy, archetype);
        enemy.targetCooldown =
          TARGET_RESCORE_INTERVAL * (1 - TARGET_RESCORE_JITTER * 0.5 + TARGET_RESCORE_JITTER * enemy.phase);
        valid = this.resolveTarget(world, enemy);
      }

      const stride = 1 << enemy.lodTier;
      const mask = stride - 1;
      // Phase-derived offset spreads a tier's work evenly across its ticks.
      const offset = mask === 0 ? 0 : ((enemy.phase * 4096) | 0) & mask;
      const stepping = ((this.step + offset) & mask) === 0;

      this.advanceState(world, enemy, archetype, valid, dt);

      if (!stepping) continue;
      const stepDt = dt * stride;
      enemy.lodTimer = stepDt;

      this.steer(world, enemy, archetype, valid, stepDt);
      this.stats.steered++;
    }
  }

  /**
   * `knockX`/`knockZ` hold the *effective* impulse: whoever dealt the damage
   * already multiplied it by `1 - archetype.knockbackResistance` at the moment
   * of the hit, which is the only place the hit's direction and magnitude are
   * both known. Scaling again here would square the resistance and leave a
   * golem immovable by a factor of 150. So this reads the impulse as given,
   * applies it, and decays it.
   *
   * The archetype is still consulted for the stagger threshold below, which is
   * what makes the same shotgun blast sprawl a minion and barely rock a golem.
   */
  private applyKnockback(
    world: GameWorld,
    enemy: Enemy,
    archetype: EnemyArchetype,
    dt: number,
  ): void {
    // The hit flash decays here rather than in the render layer, so it advances
    // with simulated time and is unaffected by frame rate or by a paused frame.
    if (enemy.hitFlash > 0) enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);

    const kx = enemy.knockX;
    const kz = enemy.knockZ;
    const magnitudeSq = kx * kx + kz * kz;

    const staggerSpeed = archetype.speed * STAGGER_SPEED_FACTOR;
    if (magnitudeSq > staggerSpeed * staggerSpeed) {
      if (enemy.state === "APPROACHING" || enemy.state === "ATTACKING") {
        enemy.state = "STAGGERED";
        enemy.stateTimer = STAGGER_DURATION;
      }
    }

    if (magnitudeSq > KNOCK_EPSILON * KNOCK_EPSILON) {
      this.integrate(world, enemy, kx, kz, dt);
    }

    enemy.knockX = damp(enemy.knockX, 0, KNOCK_HALF_LIFE, dt);
    enemy.knockZ = damp(enemy.knockZ, 0, KNOCK_HALF_LIFE, dt);
  }

  // -------------------------------------------------------------------------
  // Target selection
  // -------------------------------------------------------------------------

  /** Writes the current target into module scratch. False when it is gone. */
  private resolveTarget(world: GameWorld, enemy: Enemy): boolean {
    targetStructure = null;

    if (enemy.targetKind === "core") {
      target.x = world.spider.x;
      target.z = world.spider.z;
      target.radius = CORE_TARGET_RADIUS;
      return true;
    }

    if (enemy.targetKind === "player") {
      if (world.player.downed) return false;
      target.x = world.player.x;
      target.z = world.player.z;
      target.radius = PLAYER.radius;
      return true;
    }

    const structures = world.structures;
    for (let i = 0; i < structures.length; i++) {
      const structure = structures[i];
      if (structure.id !== enemy.targetId) continue;
      if (structure.state === "destroyed" || structure.state === "dropped") return false;
      target.x = structure.x;
      target.z = structure.z;
      target.radius = getBlueprint(structure.kind).radius;
      targetStructure = structure;
      return true;
    }
    return false;
  }

  /**
   * Scores every candidate and writes the winner onto the enemy.
   *
   * The proximity term is `ref / (ref + distance)`, which is smooth, bounded and
   * has no singularity at zero — a plain `1/d` would make anything underfoot
   * infinitely attractive and pin the horde to whatever it last touched.
   *
   * The weights are what give each archetype its personality: a warrior's 1.5
   * structure preference beats the core outright, a golem's 0.25 never does even
   * against a barricade's taunt, and the engineer's close bonus means the horde
   * always answers someone standing in it.
   */
  private scoreTargets(world: GameWorld, enemy: Enemy, archetype: EnemyArchetype): void {
    const spider = world.spider;
    const player = world.player;

    let bestScore = -1;
    let bestKind: EnemyTargetKind = "core";
    let bestId = -1;
    let heldScore = -1;

    const coreDistance = Math.sqrt(distSq(enemy.x, enemy.z, spider.x, spider.z));
    const coreRoleWeight = archetype.targetRole === "breaker" ? 1.65 : CORE_WEIGHT;
    const coreScore =
      (PROXIMITY_REFERENCE / (PROXIMITY_REFERENCE + coreDistance)) * coreRoleWeight;
    bestScore = coreScore;
    if (enemy.targetKind === "core") heldScore = coreScore;

    const outerRally = coreDistance > OUTER_RALLY_DISTANCE;

    const structures = world.structures;
    for (let i = 0; i < structures.length; i++) {
      const structure = structures[i];
      if (structure.state === "destroyed" || structure.state === "dropped") continue;

      const distance = Math.sqrt(distSq(enemy.x, enemy.z, structure.x, structure.z));
      if (outerRally && distance > PLAYER_THREAT_DISTANCE) continue;
      const decoy = structure.kind === "barricade";
      let roleWeight = 1;
      if (archetype.targetRole === "saboteur") {
        if (structure.kind === "relay") roleWeight *= 1.9;
        else if (structure.kind === "rivetTurret") roleWeight *= 1.35;
        if (structure.behindSpider) roleWeight *= 1.45;
      }
      const weight = archetype.structurePreference * (decoy ? BARRICADE_TAUNT : roleWeight);
      const score = (PROXIMITY_REFERENCE / (PROXIMITY_REFERENCE + distance)) * weight;

      if (enemy.targetId === structure.id && enemy.targetKind !== "core" && enemy.targetKind !== "player") {
        heldScore = score;
      }
      if (score > bestScore) {
        bestScore = score;
        bestKind = decoy ? "decoy" : "structure";
        bestId = structure.id;
      }
    }

    if (!player.downed) {
      const distance = Math.sqrt(distSq(enemy.x, enemy.z, player.x, player.z));
      if (!outerRally || distance <= PLAYER_THREAT_DISTANCE) {
        let weight = archetype.targetRole === "hunter" ? 1.15 : PLAYER_WEIGHT;
        if (distance < PLAYER_THREAT_DISTANCE) {
          weight += PLAYER_CLOSE_BONUS * (1 - distance / PLAYER_THREAT_DISTANCE);
        }
        const score = (PROXIMITY_REFERENCE / (PROXIMITY_REFERENCE + distance)) * weight;
        if (enemy.targetKind === "player") heldScore = score;
        if (score > bestScore) {
          bestScore = score;
          bestKind = "player";
          bestId = -1;
        }
      }
    }

    // Hysteresis on top of the cooldown: a marginal winner does not get to pull
    // the horde off what it is already committed to.
    if (heldScore >= 0 && bestScore <= heldScore * TARGET_SWITCH_MARGIN) return;

    if (enemy.targetKind !== bestKind || enemy.targetId !== bestId) {
      enemy.targetKind = bestKind;
      enemy.targetId = bestId;
      if (enemy.state === "ATTACKING") enemy.state = "APPROACHING";
    }
  }

  // -------------------------------------------------------------------------
  // State machine: SPAWNING -> APPROACHING -> ATTACKING -> STAGGERED -> DEAD
  // -------------------------------------------------------------------------

  private advanceState(
    world: GameWorld,
    enemy: Enemy,
    archetype: EnemyArchetype,
    valid: boolean,
    dt: number,
  ): void {
    switch (enemy.state) {
      case "SPAWNING":
        // The awakening beat is the whole reason a visible spawn is legible:
        // the player sees it stand up before it is allowed to threaten them.
        if (enemy.stateTimer <= 0) {
          enemy.state = "APPROACHING";
          enemy.stateTimer = 0;
        }
        return;

      case "STAGGERED":
        if (enemy.stateTimer <= 0) {
          enemy.state = "APPROACHING";
          enemy.stateTimer = 0;
        }
        return;

      case "APPROACHING": {
        if (!valid) return;
        const reach = archetype.attackRange + enemy.radius + target.radius;
        if (distSq(enemy.x, enemy.z, target.x, target.z) <= reach * reach) {
          enemy.state = "ATTACKING";
          enemy.stateTimer = 0;
        }
        return;
      }

      case "ATTACKING": {
        if (!valid) {
          enemy.state = "APPROACHING";
          // The target vanished under it; re-score on the next tick.
          enemy.targetCooldown = 0;
          return;
        }
        const release = archetype.attackRange + enemy.radius + target.radius + ATTACK_RELEASE_MARGIN;
        if (distSq(enemy.x, enemy.z, target.x, target.z) > release * release) {
          enemy.state = "APPROACHING";
          return;
        }
        enemy.heading = dampAngle(
          enemy.heading,
          headingFromDirection(target.x - enemy.x, target.z - enemy.z),
          HEADING_HALF_LIFE,
          dt,
        );
        if (enemy.attackCooldown <= 0) {
          this.attack(world, enemy, archetype);
          enemy.attackCooldown = archetype.attackInterval;
        }
        return;
      }

      default:
        return;
    }
  }

  private attack(world: GameWorld, enemy: Enemy, archetype: EnemyArchetype): void {
    switch (enemy.targetKind) {
      case "core":
        damageSpider(world, archetype.damage, enemy.x, enemy.z);
        return;
      case "player":
        damagePlayer(world, archetype.damage, enemy.x, enemy.z);
        return;
      default:
        if (targetStructure) damageStructure(world, targetStructure, archetype.damage);
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Steering and integration
  // -------------------------------------------------------------------------

  private steer(
    world: GameWorld,
    enemy: Enemy,
    archetype: EnemyArchetype,
    valid: boolean,
    dt: number,
  ): void {
    // An awakening enemy is rooted, and a staggered one has lost its footing.
    if (enemy.state === "SPAWNING" || enemy.state === "STAGGERED") {
      enemy.velocityX = damp(enemy.velocityX, 0, VELOCITY_HALF_LIFE, dt);
      enemy.velocityZ = damp(enemy.velocityZ, 0, VELOCITY_HALF_LIFE, dt);
      return;
    }

    const maxSpeed = enemy.speed * enemy.speedScale * terrainSpeedMultiplier(world, enemy.x, enemy.z);
    const goalX = valid ? target.x : world.spider.x;
    const goalZ = valid ? target.z : world.spider.z;

    if (enemy.state === "ATTACKING") {
      enemy.velocityX = damp(enemy.velocityX, 0, VELOCITY_HALF_LIFE, dt);
      enemy.velocityZ = damp(enemy.velocityZ, 0, VELOCITY_HALF_LIFE, dt);
      this.integrate(world, enemy, enemy.velocityX, enemy.velocityZ, dt);
      return;
    }

    const toTargetSq = distSq(enemy.x, enemy.z, goalX, goalZ);
    const seekVec = this.scratch.seek;

    // The shared field is built toward the core, so it only answers for enemies
    // heading there. Anything committed to a structure, a decoy or the engineer
    // steers itself, and so does anyone close enough that a 1.25 m cell would
    // visibly quantise the last few metres.
    if (enemy.targetKind === "core" && toTargetSq > DIRECT_SEEK_DISTANCE * DIRECT_SEEK_DISTANCE) {
      followFlow(seekVec, world.flowField, enemy.x, enemy.z, goalX, goalZ, maxSpeed);
    } else {
      const goalRadius = valid ? target.radius : CORE_TARGET_RADIUS;
      const slowRadius = archetype.attackRange + enemy.radius + goalRadius;
      arrive(seekVec, enemy.x, enemy.z, goalX, goalZ, maxSpeed, slowRadius);
    }

    const queryRadius = NAVIGATION.separationRadius + enemy.radius + MAX_ENEMY_RADIUS;
    const count = world.enemyHash.query(this.neighbours, enemy.x, enemy.z, queryRadius);
    separation(
      this.scratch.separation,
      enemy,
      this.neighbours,
      count,
      world.enemies.backing,
      NAVIGATION.separationRadius,
      maxSpeed,
    );

    // Far-LOD enemies skip the eight-cell obstacle probe. They are beyond the
    // near band by definition, so nobody can see them clip a rock.
    if (enemy.lodTier === 0) {
      avoidObstacles(
        this.scratch.avoid,
        world.navigation,
        enemy.x,
        enemy.z,
        seekVec.x,
        seekVec.z,
        enemy.radius + world.navigation.cellSize,
        maxSpeed,
      );
    } else {
      this.scratch.avoid.x = 0;
      this.scratch.avoid.z = 0;
    }

    combine(steerOut, seekVec, this.scratch.separation, this.scratch.avoid, maxSpeed);

    enemy.velocityX = damp(enemy.velocityX, steerOut.x, VELOCITY_HALF_LIFE, dt);
    enemy.velocityZ = damp(enemy.velocityZ, steerOut.z, VELOCITY_HALF_LIFE, dt);

    const speedSq = enemy.velocityX * enemy.velocityX + enemy.velocityZ * enemy.velocityZ;
    if (speedSq > 1e-4) {
      enemy.heading = dampAngle(
        enemy.heading,
        headingFromDirection(enemy.velocityX, enemy.velocityZ),
        HEADING_HALF_LIFE,
        dt,
      );
    }

    this.integrate(world, enemy, enemy.velocityX, enemy.velocityZ, dt, true);
  }

  /** Axis-separated so a glancing contact slides instead of stopping dead. */
  private integrate(
    world: GameWorld,
    enemy: Enemy,
    vx: number,
    vz: number,
    dt: number,
    expectsProgress = false,
  ): void {
    const grid = world.navigation;
    const startX = enemy.x;
    const startZ = enemy.z;
    let nextX = enemy.x + vx * dt;
    let nextZ = enemy.z + vz * dt;

    if (isBlockedCircle(grid, nextX, enemy.z, enemy.radius)) {
      nextX = enemy.x;
      enemy.velocityX = 0;
    }
    if (isBlockedCircle(grid, nextX, nextZ, enemy.radius)) {
      nextZ = enemy.z;
      enemy.velocityZ = 0;
    }

    enemy.x = nextX;
    enemy.z = nextZ;

    const wantedSq = vx * vx + vz * vz;
    const movedSq = distSq(startX, startZ, nextX, nextZ);
    const intendedStepSq = wantedSq * dt * dt;
    const minimumProgressSq = intendedStepSq *
      STUCK_PROGRESS_FRACTION * STUCK_PROGRESS_FRACTION;
    const stalled = wantedSq <= 0.2 * 0.2 || movedSq < minimumProgressSq;
    if (expectsProgress && enemy.state === "APPROACHING" && stalled) enemy.stuckTime += dt;
    else enemy.stuckTime = Math.max(0, enemy.stuckTime - dt * 2);

    if (enemy.stuckTime >= STUCK_RECOVERY_SECONDS) this.recoverStuckEnemy(world, enemy);
  }

  /**
   * Searches a small deterministic fan for open, flow-connected ground. This
   * handles authored corners and spawn pockets without an unbounded pathfind
   * per enemy or a visible jump across the whole maze.
   */
  private recoverStuckEnemy(world: GameWorld, enemy: Enemy): void {
    let bestX = enemy.x;
    let bestZ = enemy.z;
    let bestScore = Infinity;
    const base = enemy.phase * Math.PI * 2;
    for (let ring = 1; ring <= 4; ring++) {
      const radius = ring * world.navigation.cellSize * 1.15;
      for (let i = 0; i < 16; i++) {
        const angle = base + (i / 16) * Math.PI * 2;
        const x = enemy.x + Math.cos(angle) * radius;
        const z = enemy.z + Math.sin(angle) * radius;
        if (world.navigation.isBlockedCircle(x, z, enemy.radius)) continue;
        if (!world.flowField.hasFlowAt(x, z)) continue;
        const score = distSq(x, z, world.spider.x, world.spider.z);
        if (score >= bestScore) continue;
        bestScore = score;
        bestX = x;
        bestZ = z;
      }
      if (bestScore < Infinity) break;
    }
    enemy.stuckTime = 0;
    if (bestScore === Infinity) return;
    enemy.x = bestX;
    enemy.z = bestZ;
    enemy.prevX = bestX;
    enemy.prevZ = bestZ;
    enemy.velocityX = 0;
    enemy.velocityZ = 0;
    enemy.targetKind = "core";
    enemy.targetId = -1;
    enemy.targetCooldown = 0;
    this.stats.unstuck++;
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Returns an enemy to the pool with no death event and no loot.
 *
 * Used by the despawn sweep, and safe for any system that has finished with an
 * enemy. `active` doubles as the released sentinel, which makes the call
 * idempotent: releasing the same enemy twice would otherwise push its slot onto
 * the free list twice and hand the same body to two future spawns. The caller
 * must therefore *not* clear `active` before calling.
 *
 * `renderIndex` is the pool slot for a pool-created enemy, but the render layer
 * is allowed to rebind it, so the fast path is verified before it is trusted.
 */
export function releaseEnemy(world: GameWorld, enemy: Enemy): void {
  if (!enemy.active) return;

  let slot = enemy.renderIndex;
  if (slot < 0 || slot >= world.enemies.capacity || world.enemies.at(slot) !== enemy) {
    slot = -1;
    const backing = world.enemies.backing;
    for (let i = 0; i < backing.length; i++) {
      if (backing[i] === enemy) {
        slot = i;
        break;
      }
    }
    if (slot < 0) return;
  }

  enemy.active = false;
  enemy.state = "DEAD";
  world.enemies.release(slot);
}

/**
 * Where enemy melee is actually resolved.
 *
 * These helpers used to apply damage themselves, which quietly created a second
 * damage path: the spider's core could reach zero and the run would never end,
 * because only `DamageSystem` knows how to declare defeat, spend a rescue
 * charge, or drop loot. The sink is injected rather than imported so the two
 * modules stay free of an import cycle. The inline fallbacks below run only in
 * a headless context that has not wired one up.
 */
export type { DamageInfo };

export interface EnemyDamageSink {
  applyToSpider(world: GameWorld, info: DamageInfo): void;
  applyToPlayer(world: GameWorld, info: DamageInfo): void;
  applyToStructure(world: GameWorld, structure: Structure, info: DamageInfo): void;
}

let damageSink: EnemyDamageSink | null = null;

export function setEnemyDamageSink(sink: EnemyDamageSink | null): void {
  damageSink = sink;
}

/** Reused so a hundred simultaneous melee hits allocate nothing. */
const meleeInfo: DamageInfo = {
  amount: 0,
  source: "enemy.melee",
  originX: 0,
  originZ: 0,
  knockback: 0,
  critical: false,
};

function melee(amount: number, fromX: number, fromZ: number): DamageInfo {
  meleeInfo.amount = amount;
  meleeInfo.originX = fromX;
  meleeInfo.originZ = fromZ;
  meleeInfo.knockback = 0;
  meleeInfo.critical = false;
  return meleeInfo;
}

/** Applies enemy melee to the spider: shield first, then the core. */
export function damageSpider(world: GameWorld, amount: number, fromX: number, fromZ: number): void {
  if (damageSink) {
    damageSink.applyToSpider(world, melee(amount, fromX, fromZ));
    return;
  }

  const spider = world.spider;
  let remaining = amount;

  if (spider.shield > 0) {
    const taken = Math.min(spider.shield, remaining);
    spider.shield -= taken;
    remaining -= taken;
  }
  if (remaining > 0) {
    spider.coreHealth = Math.max(0, spider.coreHealth - remaining);
  }
  spider.shieldRegenDelay = SPIDER.shieldRegenDelay;

  world.events.emit({
    type: "spider.damaged",
    amount,
    remaining: spider.coreHealth,
    absorbedByShield: remaining <= 0,
    x: fromX,
    z: fromZ,
  });
}

/** Applies enemy melee to the engineer, respecting dodge invulnerability. */
export function damagePlayer(world: GameWorld, amount: number, fromX: number, fromZ: number): void {
  if (damageSink) {
    damageSink.applyToPlayer(world, melee(amount, fromX, fromZ));
    return;
  }

  const player = world.player;
  if (player.downed || player.invulnerability > 0) return;

  player.health = Math.max(0, player.health - amount);
  player.invulnerability = PLAYER.hitInvulnerability;
  player.animState = "hit";
  player.animLock = 0.3;

  world.events.emit({
    type: "player.damaged",
    amount,
    remaining: player.health,
    fromX,
    fromZ,
  });

  if (player.health <= 0) {
    player.downed = true;
    // The rescue charge is spent by whoever performs the revive, not here.
    world.events.emit({
      type: "player.downed",
      x: player.x,
      z: player.z,
      chargesRemaining: player.rescueCharges,
    });
  }
}

/**
 * Applies enemy melee to a structure. Destruction is deliberately left to the
 * interaction system's per-tick health sweep so there is exactly one place that
 * emits `structure.destroyed` and releases the nav obstacle.
 */
export function damageStructure(world: GameWorld, structure: Structure, amount: number): void {
  if (damageSink) {
    damageSink.applyToStructure(world, structure, melee(amount, structure.x, structure.z));
    return;
  }

  structure.health = Math.max(0, structure.health - amount);
  world.events.emit({
    type: "vfx.request",
    effect: "structureHit",
    x: structure.x,
    y: 0.9,
    z: structure.z,
    heading: structure.heading,
    scale: 1,
  });
}

/** Distance-from-focus LOD tier, exported so the render layer can agree. */
export function lodTierForDistanceSq(distanceSq: number): number {
  if (distanceSq <= LOD_NEAR_SQ) return 0;
  if (distanceSq <= LOD_FAR_SQ) return 1;
  return 2;
}

/** Seconds an enemy's animation should advance per simulated step, given its tier. */
export function lodAnimationScale(tier: number): number {
  return clamp(1 << tier, 1, 4);
}
