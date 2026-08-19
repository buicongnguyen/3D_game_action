import { clamp, distSq, headingFromDirection } from "../../core/math.ts";
import type { Vec2 } from "../../core/math.ts";
import type { Enemy } from "../../core/types.ts";
import { DIRECTOR } from "../../data/balance.ts";
import { SLICE_ROSTER, getArchetype } from "../../data/enemies.ts";
import { AWAKEN_DURATION, SPAWN_SETTLE_DURATION } from "./EnemyNavigationSystem.ts";
import type { GameWorld } from "../GameWorld.ts";

/**
 * The spawn director: a budget, a clock and a roster.
 *
 * Pressure is expressed as one number — budget per second, handed in by the run
 * state system from the Trail — and the director's only job is to convert it
 * into bodies at the right place. Everything about how the game *feels* under
 * pressure (waves rather than a trickle, arriving behind you, escalating in kind
 * rather than only in count) falls out of how that budget is spent, which is why
 * it is spent in groups against a per-archetype cost table rather than one
 * enemy at a time.
 *
 * Pursuit ramps enemy speed toward `1 + pursuitSpeedBonusMax` over
 * `pursuitSpeedRampSeconds`. That is the only escalation applied to living
 * enemies, and it is deliberately a soft one: Pursuit must become progressively
 * untenable, but nothing here can end a run on its own — no timer, no instant
 * loss. The player is always allowed to outrun, out-build or out-fight it.
 */

/**
 * Ceiling on banked budget. Without it a quiet stretch would bank enough to
 * dump an unsurvivable wall the moment the cap frees up, which reads as the
 * game cheating rather than as escalation.
 */
const MAX_BANKED_BUDGET = 60;

/** Radius the members of one group are scattered over around the group point. */
const GROUP_SPREAD = 3.6;

/** Attempts to find a spawn point that is also off-camera before giving up. */
const SPAWN_POINT_ATTEMPTS = 4;

/** Ring radius used by the debug force-spawn seam. */
const FORCE_SPAWN_RADIUS = 14;
/** Golden angle: spreads a forced ring evenly for any count. */
const GOLDEN_ANGLE = 2.399963229728653;

const SPAWN_MIN_DISTANCE_SQ = DIRECTOR.spawnMinDistance * DIRECTOR.spawnMinDistance;

const spawnPoint: Vec2 = { x: 0, z: 0 };
const jitter: Vec2 = { x: 0, z: 0 };
const clearSpawnPoint: Vec2 = { x: 0, z: 0 };

/** Rings searched when authored spawn ground happens to contain a solid prop. */
const CLEARANCE_RINGS = 5;
const CLEARANCE_SAMPLES = 12;
const CLEARANCE_STEP = 1.5;

export class HordeDirector {
  readonly stats = { budget: 0, spawnedTotal: 0, active: 0, deniedByCap: 0 };

  private budget = 0;
  private evaluationTimer = 0;
  /** Current Pursuit speed multiplier, applied to every living enemy. */
  private speedScale = 1;

  /** Reused weight buffer, one slot per roster entry; no per-evaluation array. */
  private readonly weights: number[] = new Array(SLICE_ROSTER.length).fill(0);

  update(world: GameWorld, dt: number, budgetPerSecond: number): void {
    this.budget += budgetPerSecond * dt;
    if (this.budget > MAX_BANKED_BUDGET) this.budget = MAX_BANKED_BUDGET;

    this.evaluationTimer += dt;
    if (this.evaluationTimer >= DIRECTOR.evaluationInterval) {
      // Consume whole intervals rather than resetting, so a long frame does not
      // silently drop an evaluation.
      while (this.evaluationTimer >= DIRECTOR.evaluationInterval) {
        this.evaluationTimer -= DIRECTOR.evaluationInterval;
      }
      this.updateSpeedScale(world);
      this.evaluate(world);
    }

    this.stats.budget = this.budget;
    this.stats.active = world.enemies.active;
  }

  // -------------------------------------------------------------------------
  // Pursuit
  // -------------------------------------------------------------------------

  private updateSpeedScale(world: GameWorld): void {
    const ramp =
      world.trailState === "PURSUIT"
        ? clamp(world.pursuitTime / DIRECTOR.pursuitSpeedRampSeconds, 0, 1)
        : 0;
    this.speedScale = 1 + DIRECTOR.pursuitSpeedBonusMax * ramp;

    const backing = world.enemies.backing;
    for (let i = 0; i < backing.length; i++) {
      const enemy = backing[i];
      if (!enemy.active) continue;
      enemy.speedScale = this.speedScale;
    }
  }

  // -------------------------------------------------------------------------
  // Evaluation
  // -------------------------------------------------------------------------

  private evaluate(world: GameWorld): void {
    if (world.phase !== "MARCH" && world.phase !== "FINAL_ESCAPE") return;
    if (!world.route.spline) return;

    const active = world.enemies.active;
    if (active >= DIRECTOR.maxActiveEnemies) {
      this.stats.deniedByCap++;
      return;
    }

    const cheapest = this.refreshWeights(world);
    if (cheapest < 0) return;

    // A group is the unit of pressure, so the director waits until it can afford
    // a whole small one rather than dribbling single enemies onto the map.
    if (this.budget < cheapest * DIRECTOR.minGroupSize) return;

    let groupSize = world.directorRandom.int(DIRECTOR.minGroupSize, DIRECTOR.maxGroupSize);
    const headroom = DIRECTOR.maxActiveEnemies - active;
    if (groupSize > headroom) groupSize = headroom;
    if (groupSize > world.enemies.available) groupSize = world.enemies.available;
    if (groupSize <= 0) {
      this.stats.deniedByCap++;
      return;
    }

    if (!this.pickGroupPoint(world)) return;

    const groupX = spawnPoint.x;
    const groupZ = spawnPoint.z;

    for (let i = 0; i < groupSize; i++) {
      const archetypeId = this.chooseArchetype(world);
      if (archetypeId === null) break;

      world.directorRandom.pointInCircle(jitter, GROUP_SPREAD);
      const spawned = this.spawn(world, archetypeId, groupX + jitter.x, groupZ + jitter.z, false);
      if (!spawned) break;
      this.budget -= getArchetype(archetypeId).spawnCost;
    }
  }

  /**
   * Fills the weight buffer with the eligible archetypes for the current Trail
   * and returns the cheapest eligible cost, or -1 when nothing is eligible.
   */
  private refreshWeights(world: GameWorld): number {
    let cheapest = -1;
    let activeMachines = 0;
    for (let i = 0; i < world.structures.length; i++) {
      const structure = world.structures[i];
      if (structure.state === "active" && structure.maxBuffer > 0) activeMachines++;
    }
    const playerExposure = Math.sqrt(
      distSq(world.player.x, world.player.z, world.spider.x, world.spider.z),
    );
    for (let i = 0; i < SLICE_ROSTER.length; i++) {
      const archetype = getArchetype(SLICE_ROSTER[i]);
      if (archetype.minimumThreat > world.trail) {
        this.weights[i] = 0;
        continue;
      }
      let weight = archetype.weight;
      if (archetype.targetRole === "saboteur") {
        weight *= 1 + Math.min(1.25, activeMachines * 0.18);
      } else if (archetype.targetRole === "hunter" && playerExposure > 10) {
        weight *= 1.35;
      } else if (archetype.targetRole === "breaker" && world.trailState === "PURSUIT") {
        weight *= 1.45;
      }
      this.weights[i] = weight;
      if (cheapest < 0 || archetype.spawnCost < cheapest) cheapest = archetype.spawnCost;
    }
    return cheapest;
  }

  /** Weighted draw among archetypes that are eligible *and* currently affordable. */
  private chooseArchetype(world: GameWorld): string | null {
    let anyAffordable = false;
    for (let i = 0; i < SLICE_ROSTER.length; i++) {
      if (this.weights[i] <= 0) continue;
      if (getArchetype(SLICE_ROSTER[i]).spawnCost > this.budget) {
        // Zeroed for this draw only; refreshWeights rebuilds it next evaluation.
        this.weights[i] = 0;
        continue;
      }
      anyAffordable = true;
    }
    if (!anyAffordable) return null;

    const index = world.directorRandom.weightedIndex(this.weights);
    if (index < 0) return null;
    return SLICE_ROSTER[index];
  }

  /**
   * Finds a group point on the route that is also outside the camera. The
   * frustum is approximated as a disc of `spawnMinDistance` around the player,
   * which is conservative in every camera orientation and costs one comparison.
   */
  private pickGroupPoint(world: GameWorld): boolean {
    const rearBias = DIRECTOR.rearBias[world.trailState];
    const player = world.player;

    for (let attempt = 0; attempt < SPAWN_POINT_ATTEMPTS; attempt++) {
      const found = world.route.pickSpawnPoint(
        spawnPoint,
        world.spider.distanceAlongRoute,
        world.trail,
        rearBias,
        world.directorRandom,
      );
      if (!found) return false;
      if (distSq(spawnPoint.x, spawnPoint.z, player.x, player.z) >= SPAWN_MIN_DISTANCE_SQ) {
        return true;
      }
    }
    // Every candidate landed in view. Skipping this evaluation keeps the budget
    // banked; popping enemies into the frustum would be worse than waiting.
    return false;
  }

  // -------------------------------------------------------------------------
  // Spawning
  // -------------------------------------------------------------------------

  /**
   * Test and debug seam: places `count` enemies of one archetype on a ring
   * around the spider, ignoring the budget, the route and the active cap. It
   * still respects the pool, so the 200-enemy stress scenario never exhausts it.
   */
  forceSpawn(world: GameWorld, archetypeId: string, count: number): number {
    const spider = world.spider;
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      const angle = i * GOLDEN_ANGLE;
      // Two rings' worth of radius variation so a large force does not overlap
      // itself into a single ring of coincident bodies.
      const radius = FORCE_SPAWN_RADIUS + (i % 7) * 1.3;
      const x = spider.x + Math.sin(angle) * radius;
      const z = spider.z + Math.cos(angle) * radius;
      if (!this.spawn(world, archetypeId, x, z, false)) break;
      spawned++;
    }
    this.stats.active = world.enemies.active;
    return spawned;
  }

  /**
   * Releases a finite authored squad from a visible world location. Unlike the
   * ambient director this ignores Trail and budget, but still respects pool
   * capacity, collision clearance, and the normal enemy initialization path.
   */
  spawnEncounterGroup(
    world: GameWorld,
    archetypeId: string,
    count: number,
    x: number,
    z: number,
  ): number {
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      const angle = i * GOLDEN_ANGLE;
      const radius = 1.4 + (i % 3) * 0.7;
      if (!this.spawn(
        world,
        archetypeId,
        x + Math.cos(angle) * radius,
        z + Math.sin(angle) * radius,
        true,
      )) continue;
      spawned++;
    }
    this.stats.active = world.enemies.active;
    return spawned;
  }

  /**
   * Acquires a pool slot and writes a complete enemy into it.
   *
   * Every mutable field is assigned here. `ObjectPool.acquire` already ran
   * `resetEnemy`, but writing the full set explicitly is what makes a slot's
   * second life provably independent of its first — the pooling test asserts
   * field by field, and a field silently inherited from the previous occupant
   * is the classic pooling bug this guards against.
   */
  private spawn(
    world: GameWorld,
    archetypeId: string,
    x: number,
    z: number,
    visible: boolean,
  ): Enemy | null {
    const archetype = getArchetype(archetypeId);
    if (!this.findClearSpawn(world, x, z, archetype.radius)) return null;

    // Checked before acquiring so a full pool is a counted denial rather than a
    // recorded exhaustion; `pool.exhaustions` stays a pure bug signal.
    if (world.enemies.available <= 0) {
      this.stats.deniedByCap++;
      return null;
    }

    const enemy = world.enemies.acquire();
    if (!enemy) {
      this.stats.deniedByCap++;
      return null;
    }

    const spider = world.spider;
    x = clearSpawnPoint.x;
    z = clearSpawnPoint.z;
    const heading = headingFromDirection(spider.x - x, spider.z - z);

    enemy.id = world.allocateId();
    enemy.archetype = archetype.id;
    enemy.x = x;
    enemy.z = z;
    enemy.prevX = x;
    enemy.prevZ = z;
    enemy.velocityX = 0;
    enemy.velocityZ = 0;
    enemy.heading = heading;
    enemy.prevHeading = heading;
    enemy.health = archetype.health;
    enemy.maxHealth = archetype.health;
    enemy.radius = archetype.radius;
    enemy.speed = archetype.speed;
    enemy.speedScale = this.speedScale;
    enemy.state = "SPAWNING";
    enemy.stateTimer = visible ? AWAKEN_DURATION : SPAWN_SETTLE_DURATION;
    enemy.targetKind = "core";
    enemy.targetId = -1;
    enemy.targetCooldown = 0;
    enemy.attackCooldown = 0;
    enemy.lodTimer = 0;
    enemy.lodTier = 0;
    enemy.active = true;
    enemy.knockX = 0;
    enemy.knockZ = 0;
    enemy.spawnedVisible = visible;
    enemy.phase = world.directorRandom.next();
    enemy.hitFlash = 0;
    enemy.hitDirX = 0;
    enemy.hitDirZ = 0;
    enemy.stuckTime = 0;
    enemy.playerLootCredit = false;

    this.stats.spawnedTotal++;
    world.events.emit({
      type: "enemy.spawned",
      enemyId: enemy.id,
      archetype: archetype.id,
      x,
      z,
    });
    return enemy;
  }

  /**
   * Props and enemy spawn zones intentionally share the threatening outer
   * corridor. Find a nearby open point before acquiring a body; otherwise an
   * enemy born inside a tree cannot take its first integration step and looks
   * like part of a motionless crowd. The first sample on every ring faces the
   * spider, so relocation tends to bring the attacker out of cover.
   */
  private findClearSpawn(world: GameWorld, x: number, z: number, radius: number): boolean {
    const navigation = world.navigation;
    // The director runs before enemy navigation in the fixed-step order. A
    // segment transition can therefore reach its first spawn evaluation before
    // the normal navigation pass recentres the sliding window.
    navigation.recenter(world.spider.x, world.spider.z);
    if (!navigation.isBlockedCircle(x, z, radius)) {
      clearSpawnPoint.x = x;
      clearSpawnPoint.z = z;
      return true;
    }

    const towardSpider = Math.atan2(world.spider.z - z, world.spider.x - x);
    for (let ring = 1; ring <= CLEARANCE_RINGS; ring++) {
      const distance = ring * CLEARANCE_STEP;
      for (let sample = 0; sample < CLEARANCE_SAMPLES; sample++) {
        const angle = towardSpider + (sample / CLEARANCE_SAMPLES) * Math.PI * 2;
        const candidateX = x + Math.cos(angle) * distance;
        const candidateZ = z + Math.sin(angle) * distance;
        if (navigation.isBlockedCircle(candidateX, candidateZ, radius)) continue;
        clearSpawnPoint.x = candidateX;
        clearSpawnPoint.z = candidateZ;
        return true;
      }
    }
    return false;
  }

  /** Resets the director between runs. */
  reset(): void {
    this.budget = 0;
    this.evaluationTimer = 0;
    this.speedScale = 1;
    this.stats.budget = 0;
    this.stats.spawnedTotal = 0;
    this.stats.active = 0;
    this.stats.deniedByCap = 0;
  }

  /** Banked budget, exposed for the debug overlay and for tests. */
  get bankedBudget(): number {
    return this.budget;
  }

  /** Current Pursuit speed multiplier. */
  get pursuitSpeedScale(): number {
    return this.speedScale;
  }
}
