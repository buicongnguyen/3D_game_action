import { EventBus } from "../core/EventBus.ts";
import { ObjectPool } from "../core/ObjectPool.ts";
import { Random } from "../core/Random.ts";
import type {
  BuildState,
  Enemy,
  EncounterSite,
  Pickup,
  PlayerState,
  Projectile,
  RunModifiers,
  RunMode,
  RunPhase,
  RunProgress,
  RunResources,
  RunStats,
  SpiderState,
  Structure,
  TrailState,
} from "../core/types.ts";
import { DIRECTOR, ECONOMY, PERFORMANCE, PLAYER, SPIDER } from "../data/balance.ts";
import { createNeutralModifiers } from "../data/balance.ts";
import { SLICE_LOADOUT } from "../data/structures.ts";
import { NavigationGrid } from "./navigation/NavigationGrid.ts";
import { FlowField } from "./navigation/FlowField.ts";
import { SpatialHash } from "./navigation/SpatialHash.ts";
import { RouteDirector } from "./route/RouteDirector.ts";

/**
 * The complete simulation state for one run.
 *
 * This object is the single source of truth. Systems are stateless functions
 * over it; the render layer reads it and never writes it. Nothing here imports
 * `three`, which is what makes the whole simulation headlessly testable.
 *
 * Entity storage is pooled arrays rather than Maps: iteration order is stable
 * (so ticks are deterministic), memory is contiguous, and spawning never
 * allocates.
 */
export class GameWorld {
  readonly events = new EventBus();
  readonly random: Random;
  /** Separate stream for the director so combat draws never shift terrain. */
  readonly directorRandom: Random;
  /** Separate stream for cosmetic-only draws, safe to desync from simulation. */
  readonly cosmeticRandom: Random;

  readonly player: PlayerState;
  readonly spider: SpiderState;
  readonly build: BuildState;
  readonly resources: RunResources;
  readonly progress: RunProgress;
  readonly stats: RunStats;
  readonly modifiers: RunModifiers;

  readonly enemies: ObjectPool<Enemy>;
  readonly projectiles: ObjectPool<Projectile>;
  readonly pickups: ObjectPool<Pickup>;
  /** Structures are few and long-lived, so a plain array is the right shape. */
  readonly structures: Structure[] = [];
  readonly encounterSites: EncounterSite[] = [];

  readonly navigation: NavigationGrid;
  readonly flowField: FlowField;
  readonly enemyHash: SpatialHash;
  readonly route: RouteDirector;
  readonly mode: RunMode;
  readonly fieldItems = { repairKits: 0, shockMines: 0, armorPlates: 0, weaponParts: 0 };
  salvageTimeRemaining = 0;
  salvageScore = 0;

  phase: RunPhase = "BOOT";
  previousPhase: RunPhase = "BOOT";
  /** Seconds elapsed in the current phase. */
  phaseTime = 0;

  trail = 0;
  trailState: TrailState = "QUIET";
  /** Seconds spent in PURSUIT, which ramps the director's budget and speed. */
  pursuitTime = 0;

  /** Simulation time scale. The build radial slows this to 0.2. */
  timeScale = 1;
  /** True while a full-pause modal is open; `fixedUpdate` early-outs. */
  paused = false;

  /** Blueprints available in the radial, in radial order. */
  loadout: BuildState["ghostKind"][] = ["rivetTurret"];

  /** Monotonic id source for every entity kind. */
  private nextId = 1;

  /** Seconds of simulated time since the run started. */
  elapsed = 0;
  /** Fixed steps executed, used for scheduling work on a stride. */
  tick = 0;

  /** Cylinders currently produced and waiting on the spider's rack. */
  cylindersReady = 0;
  cylinderTimer = 0;

  constructor(seed: number, mode: RunMode = "expedition") {
    this.mode = mode;
    if (mode === "salvageRush") this.loadout = [...SLICE_LOADOUT];
    this.random = new Random(seed);
    this.directorRandom = this.random.fork(0x51ed);
    this.cosmeticRandom = this.random.fork(0xc05a);

    this.modifiers = createNeutralModifiers() as RunModifiers;

    this.player = {
      x: 0,
      z: -4,
      prevX: 0,
      prevZ: -4,
      velocityX: 0,
      velocityZ: 0,
      heading: 0,
      prevHeading: 0,
      health: PLAYER.health,
      maxHealth: PLAYER.health,
      invulnerability: 0,
      dodgeCooldown: 0,
      dodgeTimer: 0,
      dodgeDirX: 0,
      dodgeDirZ: 1,
      carry: { kind: "none" },
      animState: "idle",
      animLock: 0,
      downed: false,
      rescueCharges: PLAYER.rescueCharges,
      actionProgress: 0,
      actionKind: null,
      actionTargetId: -1,
      aimX: 0,
      aimZ: 0,
      weaponCooldown: 0,
      currentWeapon: "shotgun",
      unlockedWeapons: ["shotgun"],
      weaponHeat: 0,
      weaponOverheated: false,
      tetherStrain: 0,
      tethered: false,
    };

    this.spider = {
      coreHealth: SPIDER.coreHealth,
      maxCoreHealth: SPIDER.coreHealth,
      shield: SPIDER.shield,
      maxShield: SPIDER.shield,
      shieldRegenDelay: 0,
      fuel: SPIDER.startFuel,
      maxFuel: SPIDER.maxFuel,
      speedMode: "march",
      distanceAlongRoute: 0,
      prevDistanceAlongRoute: 0,
      x: 0,
      z: 0,
      prevX: 0,
      prevZ: 0,
      heading: 0,
      prevHeading: 0,
      serviceRadius: SPIDER.serviceRadius,
      carriedStructures: new Array(SPIDER.rackSlots).fill(null),
      installedModules: [],
      docked: true,
      speed: 0,
      emergencyBurn: false,
    };

    this.build = {
      radialOpen: false,
      radialIndex: 0,
      ghostActive: false,
      ghostKind: null,
      ghostX: 0,
      ghostZ: 0,
      ghostHeading: 0,
      ghostValidity: "invalid",
      ghostReason: "",
      selectedBlueprint: 0,
    };

    this.resources = { scrap: ECONOMY.startScrap, fuel: 0 };

    this.progress = { level: 1, xp: 0, xpToNext: 12, pendingLevelUps: 0, chosenUpgrades: [] };

    this.stats = {
      seed,
      elapsedSeconds: 0,
      enemiesKilled: 0,
      damageByPlayer: 0,
      damageByStructures: 0,
      structuresPlaced: 0,
      structuresRecovered: 0,
      structuresAbandoned: 0,
      lastShotsTriggered: 0,
      scrapCollected: 0,
      fuelCollected: 0,
      distanceTravelled: 0,
      peakTrail: 0,
      timeInPursuit: 0,
      objectivesCompleted: 0,
      nestsDestroyed: 0,
    };

    this.enemies = new ObjectPool<Enemy>(
      DIRECTOR.enemyPoolCapacity,
      (index) => createEnemy(index),
      resetEnemy,
    );
    this.projectiles = new ObjectPool<Projectile>(
      PERFORMANCE.projectilePoolCapacity,
      (index) => createProjectile(index),
      resetProjectile,
    );
    this.pickups = new ObjectPool<Pickup>(
      PERFORMANCE.pickupPoolCapacity,
      (index) => createPickup(index),
      resetPickup,
    );

    this.navigation = new NavigationGrid();
    this.flowField = new FlowField(this.navigation);
    this.enemyHash = new SpatialHash();
    this.route = new RouteDirector(this.random.fork(0x0d17));
  }

  allocateId(): number {
    return this.nextId++;
  }

  findStructure(id: number): Structure | undefined {
    for (let i = 0; i < this.structures.length; i++) {
      if (this.structures[i].id === id) return this.structures[i];
    }
    return undefined;
  }

  /** Enemy lookup by id. Pool slot is not the id, so this is a linear scan. */
  findEnemy(id: number): Enemy | null {
    const backing = this.enemies.backing;
    for (let i = 0; i < backing.length; i++) {
      const enemy = backing[i];
      if (enemy.active && enemy.id === id) return enemy;
    }
    return null;
  }

  setPhase(phase: RunPhase): void {
    if (phase === this.phase) return;
    this.previousPhase = this.phase;
    this.phase = phase;
    this.phaseTime = 0;
    this.events.emit({ type: "run.phaseChanged", from: this.previousPhase, to: phase });
  }
}

// ---------------------------------------------------------------------------
// Pool factories and resets
//
// `reset` must return an object to exactly its post-construction state.
// A field missed here is a state leak between two lives of the same slot,
// which is the classic pooling bug; the pooling test asserts field-by-field.
// ---------------------------------------------------------------------------

export function createEnemy(renderIndex: number): Enemy {
  return {
    id: 0,
    archetype: "minion",
    x: 0,
    z: 0,
    prevX: 0,
    prevZ: 0,
    velocityX: 0,
    velocityZ: 0,
    heading: 0,
    prevHeading: 0,
    health: 0,
    maxHealth: 0,
    radius: 0.4,
    speed: 0,
    speedScale: 1,
    state: "DEAD",
    stateTimer: 0,
    targetKind: "core",
    targetId: -1,
    targetCooldown: 0,
    attackCooldown: 0,
    lodTimer: 0,
    lodTier: 0,
    active: false,
    renderIndex,
    knockX: 0,
    knockZ: 0,
    spawnedVisible: false,
    phase: 0,
    hitFlash: 0,
    hitDirX: 0,
    hitDirZ: 0,
    stuckTime: 0,
    playerLootCredit: false,
  };
}

export function resetEnemy(enemy: Enemy): void {
  enemy.id = 0;
  enemy.archetype = "minion";
  enemy.x = 0;
  enemy.z = 0;
  enemy.prevX = 0;
  enemy.prevZ = 0;
  enemy.velocityX = 0;
  enemy.velocityZ = 0;
  enemy.heading = 0;
  enemy.prevHeading = 0;
  enemy.health = 0;
  enemy.maxHealth = 0;
  enemy.radius = 0.4;
  enemy.speed = 0;
  enemy.speedScale = 1;
  enemy.state = "SPAWNING";
  enemy.stateTimer = 0;
  enemy.targetKind = "core";
  enemy.targetId = -1;
  enemy.targetCooldown = 0;
  enemy.attackCooldown = 0;
  enemy.lodTimer = 0;
  enemy.lodTier = 0;
  enemy.active = false;
  enemy.knockX = 0;
  enemy.knockZ = 0;
  enemy.spawnedVisible = false;
  enemy.phase = 0;
  enemy.hitFlash = 0;
  enemy.hitDirX = 0;
  enemy.hitDirZ = 0;
  enemy.stuckTime = 0;
  enemy.playerLootCredit = false;
  // renderIndex is the pool slot and is intentionally preserved.
}

export function createProjectile(_index: number): Projectile {
  return {
    id: 0,
    x: 0,
    z: 0,
    y: 1,
    prevX: 0,
    prevZ: 0,
    prevY: 1,
    velocityX: 0,
    velocityZ: 0,
    speed: 0,
    damage: 0,
    radius: 0.18,
    lifetime: 0,
    source: "player.weapon",
    pierceLeft: 0,
    lastHitId: -1,
    active: false,
    variant: 0,
    knockback: 0,
    explosionRadius: 0,
  };
}

export function resetProjectile(projectile: Projectile): void {
  projectile.id = 0;
  projectile.x = 0;
  projectile.z = 0;
  projectile.y = 1;
  projectile.prevX = 0;
  projectile.prevZ = 0;
  projectile.prevY = 1;
  projectile.velocityX = 0;
  projectile.velocityZ = 0;
  projectile.speed = 0;
  projectile.damage = 0;
  projectile.radius = 0.18;
  projectile.lifetime = 0;
  projectile.source = "player.weapon";
  projectile.pierceLeft = 0;
  projectile.lastHitId = -1;
  projectile.active = false;
  projectile.variant = 0;
  projectile.knockback = 0;
  projectile.explosionRadius = 0;
}

export function createPickup(_index: number): Pickup {
  return {
    id: 0,
    kind: "scrap",
    x: 0,
    z: 0,
    y: 0.4,
    amount: 0,
    settleTimer: 0,
    lifetime: 0,
    attracted: false,
    claimRadius: 0,
    velocityX: 0,
    velocityZ: 0,
    active: false,
    phase: 0,
  };
}

export function resetPickup(pickup: Pickup): void {
  pickup.id = 0;
  pickup.kind = "scrap";
  pickup.x = 0;
  pickup.z = 0;
  pickup.y = 0.4;
  pickup.amount = 0;
  pickup.settleTimer = 0;
  pickup.lifetime = 0;
  pickup.attracted = false;
  pickup.claimRadius = 0;
  pickup.velocityX = 0;
  pickup.velocityZ = 0;
  pickup.active = false;
  pickup.phase = 0;
}
