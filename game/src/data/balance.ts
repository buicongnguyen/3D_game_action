/**
 * Every tunable number in the simulation. Systems must read from here rather
 * than embedding literals, so a balance pass is a single-file edit and a
 * playtest can be reproduced from a seed plus this table.
 *
 * Units: metres, seconds, m/s. Damage is in health points.
 */

export const SIM = {
  /** Fixed simulation step. Rendering interpolates between steps. */
  fixedStep: 1 / 60,
  /** Longest frame the accumulator will honour, to avoid a spiral of death. */
  maxFrameTime: 0.1,
  /** Hard cap on catch-up steps per frame. */
  maxStepsPerFrame: 5,
} as const;

export const PLAYER = {
  health: 100,
  speed: 5.5,
  carrySpeed: 3.8,
  /** Acceleration and braking, tuned so the engineer feels responsive but heavy. */
  acceleration: 55,
  deceleration: 70,
  turnRate: 14,
  radius: 0.42,
  /** Exploration stays warning-free through nearby houses and side chambers. */
  comfortableDistance: 26,
  /** Hard escort leash; long enough for ranged loot and maze side rooms. */
  tetherDistance: 32,
  /** Damage per second applied while past the tether limit. */
  tetherDamagePerSecond: 6,
  /** Speed of the pull-back applied at the tether limit. */
  tetherPullSpeed: 7,
  interactionRange: 2.2,
  buildRange: 5,
  deadZone: 0.18,
  dodgeDistance: 4.2,
  dodgeDuration: 0.28,
  dodgeCooldown: 0.85,
  /** Invulnerability granted for the whole dodge plus this tail. */
  dodgeInvulnerabilityTail: 0.08,
  hitInvulnerability: 0.55,
  magnetRadius: 2.6,
  magnetSpeed: 13,
  /** Seconds to complete each held contextual action. */
  repairDuration: 0.9,
  refuelDuration: 0.8,
  foldDuration: 1.15,
  installDuration: 0.35,
  rescueCharges: 1,
  /** Health restored and scrap cost when the rescue automaton revives you. */
  reviveHealthFraction: 0.6,
  reviveScrapPenalty: 15,
  reviveCoreDamage: 40,
  downedDuration: 1.6,
} as const;

export const SPIDER = {
  coreHealth: 500,
  shield: 120,
  /** Seconds after taking damage before the shield begins to regenerate. */
  shieldRegenDelay: 6,
  shieldRegenPerSecond: 9,
  maxFuel: 100,
  startFuel: 70,
  speedMarch: 1.25,
  speedOverdrive: 2.0,
  speedFallback: 0.45,
  fuelPerSecondMarch: 0.12,
  fuelPerSecondOverdrive: 0.6,
  /** Scrap burned per second when the tank is dry. */
  scrapPerSecondFallback: 0.8,
  serviceRadius: 10,
  rackSlots: 2,
  moduleSlots: 4,
  /** Collision footprint on the XZ plane. */
  bodyLength: 9.5,
  bodyWidth: 6.0,
  /** Height of the deck, used for camera framing and occlusion. */
  bodyHeight: 4.4,
  legCount: 8,
  legReach: 5.6,
  /** Trail added per second while in overdrive, on top of the passive rate. */
  overdriveTrailPerSecond: 1.6,
  /** How fast the spider yaws to follow the spline. */
  turnRate: 1.4,
  /** Distance ahead on the spline used to compute facing. */
  headingLookahead: 3.5,
  dockedTrailMultiplier: 0.15,
  /** Radius within which the player is "aboard" for pickup at the gate. */
  boardingRadius: 12,
} as const;

export const TRAIL = {
  max: 100,
  passivePerSecond: 0.3,
  /** Noise emitted by a single turret shot, a heavy shot and an explosion. */
  // Sustained automated fire should be powerful but loud enough to wake the
  // Trail naturally instead of leaving escalation entirely to the finale.
  noiseShot: 0.07,
  noiseHeavyShot: 0.16,
  noiseExplosion: 1.4,
  noiseMining: 0.5,
  noiseStructurePlaced: 0.6,
  /** Value the Trail drops to when a checkpoint is reached. */
  checkpointReset: 17,
  /** Trail thresholds, inclusive lower bounds. */
  thresholds: {
    QUIET: 0,
    PROBING: 25,
    SWARM: 50,
    HEAVY: 75,
    PURSUIT: 100,
  },
  /** Decay applied per second while docked at a safe stop. */
  dockedDecayPerSecond: 3.5,
} as const;

export const DIRECTOR = {
  /** Spawn budget accrued per second, scaled by Trail state. */
  budgetPerSecond: {
    QUIET: 0.35,
    PROBING: 1.1,
    SWARM: 2.4,
    HEAVY: 4.0,
    PURSUIT: 6.2,
  },
  /** Extra budget per second added for each minute spent in Pursuit. */
  pursuitRampPerSecond: 0.035,
  /** Hard cap on concurrently active enemies during normal play. */
  maxActiveEnemies: 130,
  /** Absolute pool ceiling; the stress scenario exercises this. */
  enemyPoolCapacity: 260,
  /** Minimum and maximum distance from the player at which enemies appear. */
  spawnMinDistance: 26,
  spawnMaxDistance: 42,
  /** Fraction of spawns placed behind the march direction, per Trail state. */
  rearBias: {
    QUIET: 0.5,
    PROBING: 0.55,
    SWARM: 0.62,
    HEAVY: 0.7,
    PURSUIT: 0.86,
  },
  /** Enemy speed multiplier applied during Pursuit, ramping over time. */
  pursuitSpeedBonusMax: 0.3,
  pursuitSpeedRampSeconds: 90,
  /** Seconds between director evaluations. */
  evaluationInterval: 0.5,
  /** Group size when the director releases a wave. */
  minGroupSize: 3,
  maxGroupSize: 9,
  /** Enemies further than this from both player and spider are recycled. */
  despawnDistance: 78,
} as const;

export const STRUCTURES = {
  rivetTurret: {
    cost: 25,
    category: "foldable" as const,
    health: 220,
    maxBuffer: 30,
    deployTime: 0.7,
    foldTime: 1.15,
    range: 13.5,
    damage: 9,
    fireInterval: 0.28,
    /** Radians per second the barrel can traverse. */
    traverseSpeed: 4.2,
    /** Seconds a target stays locked before re-scoring. */
    targetLock: 0.6,
    projectileSpeed: 46,
    radius: 0.85,
    /** Muzzle height above ground for VFX and projectile origin. */
    muzzleHeight: 1.15,
    lastShotDuration: 4,
    lastShotFireRateMultiplier: 3.2,
    lastShotDamageMultiplier: 1.5,
    explosionDamage: 140,
    explosionRadius: 6.5,
  },
  relay: {
    cost: 18,
    category: "foldable" as const,
    health: 140,
    maxBuffer: 45,
    deployTime: 0.6,
    foldTime: 0.95,
    /** Radius over which the relay redistributes pressure. */
    range: 11,
    damage: 0,
    fireInterval: 0,
    traverseSpeed: 0,
    targetLock: 0,
    projectileSpeed: 0,
    radius: 0.7,
    muzzleHeight: 0.9,
    lastShotDuration: 2.5,
    lastShotFireRateMultiplier: 1,
    lastShotDamageMultiplier: 1,
    explosionDamage: 90,
    explosionRadius: 7.5,
  },
  barricade: {
    cost: 8,
    category: "anchored" as const,
    health: 260,
    maxBuffer: 0,
    deployTime: 0.45,
    foldTime: 0,
    range: 0,
    damage: 0,
    fireInterval: 0,
    traverseSpeed: 0,
    targetLock: 0,
    projectileSpeed: 0,
    radius: 1.1,
    muzzleHeight: 0.8,
    lastShotDuration: 0,
    lastShotFireRateMultiplier: 1,
    lastShotDamageMultiplier: 1,
    explosionDamage: 0,
    explosionRadius: 0,
    /** Extra targeting weight; enemies prefer chewing through a barricade. */
    tauntWeight: 2.4,
  },
  mine: {
    cost: 6,
    category: "anchored" as const,
    health: 30,
    maxBuffer: 0,
    deployTime: 0.3,
    foldTime: 0,
    range: 3.4,
    damage: 0,
    fireInterval: 0,
    traverseSpeed: 0,
    targetLock: 0,
    projectileSpeed: 0,
    radius: 0.45,
    muzzleHeight: 0.2,
    lastShotDuration: 0,
    lastShotFireRateMultiplier: 1,
    lastShotDamageMultiplier: 1,
    explosionDamage: 120,
    explosionRadius: 5.5,
  },
} as const;

export const PRESSURE = {
  /** Buffer seconds restored per second while inside the service radius. */
  rechargePerSecond: 12,
  /** A carried cylinder refills this many buffer seconds. */
  cylinderCharge: 30,
  /** Seconds a boiler takes to produce a fresh cylinder. */
  cylinderProductionTime: 22,
  /** Buffer fraction below which the HUD raises a warning. */
  warningFraction: 0.25,
} as const;

export const ECONOMY = {
  startScrap: 40,
  scrapSmall: 3,
  scrapLarge: 12,
  jerrycanFuel: 15,
  fuelBarrel: 30,
  /** Scrap cost to repair 10% of a target's maximum health. */
  repairCostPer10Percent: 4,
  /** Health fraction restored per repair action. */
  repairFractionPerAction: 0.22,
  /** Fuel transferred per refuel action. */
  refuelPerAction: 18,
} as const;

export const WEAPONS = {
  shotgun: {
    id: "shotgun",
    name: "Rivet Scattergun",
    /**
     * The engineer remains dangerous at close range, but no longer replaces
     * the construction loop by standing on the spider and firing forever. A
     * turret contributes comparable sustained damage, so positioning machines
     * materially changes an encounter's outcome.
     */
    damage: 9,
    fireInterval: 0.66,
    range: 13.5,
    pellets: 5,
    /** Total cone width in radians. */
    spread: 0.36,
    projectileSpeed: 40,
    /** The scattergun controls one close target layer; turrets handle the pack. */
    pierce: 0,
    /** Cone half-angle within which right-stick focus prioritises a target. */
    focusCone: 0.6,
    knockback: 2.2,
    /** Fraction of damage applied on a critical hit, above the base. */
    critMultiplier: 1.8,
    critChance: 0.08,
    heatPerShot: 0,
    heatCoolRate: 0.55,
    explosionRadius: 0,
    projectileRadius: 0.18,
  },
  carbine: {
    id: "carbine",
    name: "Gearburst Carbine",
    damage: 10.5,
    fireInterval: 0.22,
    range: 18,
    pellets: 1,
    spread: 0.075,
    projectileSpeed: 50,
    pierce: 0,
    focusCone: 0.48,
    knockback: 0.45,
    critMultiplier: 1.65,
    critChance: 0.09,
    heatPerShot: 0.028,
    heatCoolRate: 0.42,
    explosionRadius: 0,
    projectileRadius: 0.12,
  },
  rifle: {
    id: "rifle",
    name: "Rivet Rifle",
    damage: 18,
    fireInterval: 0.48,
    range: 24,
    pellets: 1,
    spread: 0.025,
    projectileSpeed: 58,
    pierce: 1,
    focusCone: 0.35,
    knockback: 0.8,
    critMultiplier: 2.1,
    critChance: 0.12,
    heatPerShot: 0,
    heatCoolRate: 0.55,
    explosionRadius: 0,
    projectileRadius: 0.13,
  },
  flamer: {
    id: "flamer",
    name: "Steam Flamer",
    damage: 5.5,
    fireInterval: 0.14,
    range: 8.5,
    pellets: 3,
    spread: 0.62,
    projectileSpeed: 20,
    pierce: 1,
    focusCone: 0.75,
    knockback: 0.25,
    critMultiplier: 1.35,
    critChance: 0.03,
    heatPerShot: 0.075,
    heatCoolRate: 0.28,
    explosionRadius: 0,
    projectileRadius: 0.28,
  },
  arc: {
    id: "arc",
    name: "Arc Projector",
    damage: 27,
    fireInterval: 0.82,
    range: 17,
    pellets: 1,
    spread: 0.02,
    projectileSpeed: 46,
    pierce: 2,
    focusCone: 0.46,
    knockback: 1.4,
    critMultiplier: 1.7,
    critChance: 0.08,
    heatPerShot: 0.11,
    heatCoolRate: 0.34,
    explosionRadius: 1.7,
    projectileRadius: 0.2,
  },
  launcher: {
    id: "launcher",
    name: "Magnetic Launcher",
    damage: 46,
    fireInterval: 1.45,
    range: 19,
    pellets: 1,
    spread: 0.04,
    projectileSpeed: 26,
    pierce: 0,
    focusCone: 0.42,
    knockback: 3.4,
    critMultiplier: 1.5,
    critChance: 0.05,
    heatPerShot: 0,
    heatCoolRate: 0.55,
    explosionRadius: 3.8,
    projectileRadius: 0.32,
  },
} as const;

export const XP = {
  /** XP required for level N is base * growth^(N-1). */
  base: 12,
  growth: 1.34,
  /** XP granted for engineering actions, which keeps building competitive. */
  structurePlaced: 3,
  structureRecovered: 5,
  repairAction: 1,
  refuelAction: 1,
  pickupScrap: 0.35,
  /** Number of upgrade offers presented at each level. */
  offerCount: 3,
} as const;

export const PICKUPS = {
  /** Enemy drops expire; authored route resources pass 0 and remain persistent. */
  dropLifetime: 45,
  /** Rifle-range loot from an enemy tagged by the player flies back automatically. */
  creditedLootRadius: 32,
} as const;

export const SALVAGE_RUSH = {
  duration: 90,
  trailRateMultiplier: 1.8,
  resourcePocketMultiplier: 2,
  salvageMachines: 8,
} as const;

export const CAMERA = {
  /** Orthographic half-height in world units at the default zoom. */
  viewSize: 21,
  minViewSize: 18,
  maxViewSize: 31,
  yaw: Math.PI * 0.25,
  pitch: 52 * (Math.PI / 180),
  /**
   * How far back the orthographic camera sits. Distance does not affect an
   * orthographic image, so this only has to clear the tallest geometry - but it
   * does set where fog begins, so it is paired with ENV.fogNear.
   */
  distance: 90,
  /** Weight of the spider when averaging the follow point; player gets 1-w. */
  spiderWeight: 0.32,
  /** Metres the camera leads in the march direction. */
  lookAhead: 4.2,
  /**
   * Fraction of the half-view the engineer is guaranteed to stay within. At
   * 0.62 the player can never leave the middle ~62% of the frame, however far
   * the weighted follow point has drifted toward the spider.
   */
  playerSafeFraction: 0.62,
  followHalfLife: 0.16,
  zoomHalfLife: 0.45,
  maxDevicePixelRatio: 1.5,
  /** Occluder raycast frequency in Hz. */
  occlusionHz: 10,
  shakeDecay: 4.5,
  maxShake: 0.85,
} as const;

export const NAVIGATION = {
  cellSize: 1.25,
  /** Flow-field rebuild frequency in Hz. */
  flowFieldHz: 3,
  /** Half-extent of the nav grid around the spider, in metres. */
  gridHalfExtent: 60,
  spatialHashCellSize: 3.5,
  /** Steering weights. */
  seekWeight: 1,
  separationWeight: 1.35,
  avoidWeight: 1.6,
  separationRadius: 1.4,
  /** Enemies beyond this distance from the camera focus drop to a lower LOD. */
  lodNearDistance: 26,
  lodFarDistance: 46,
} as const;

export const PERFORMANCE = {
  /**
   * Maximum enemies rendered with individually animated puppets, and - because
   * the two must agree or an articulated enemy would steer at a quarter rate -
   * the cap on full-rate LOD in `EnemyNavigationSystem`.
   *
   * 96 keeps the closest, most readable enemies articulated while leaving
   * headroom for the full normal horde. Distant enemies retain animated
   * impostor motion but avoid the mesh, matrix and full-rate steering costs.
   */
  maxFullAnimationEnemies: 96,
  projectilePoolCapacity: 420,
  pickupPoolCapacity: 220,
  vfxPoolCapacity: 180,
  damageNumberPoolCapacity: 90,
  /** Target frame budget in ms, used by the debug overlay's colour coding. */
  frameBudgetMs: 16.7,
} as const;

/** Multipliers all start neutral; upgrades and modules mutate a copy. */
export function createNeutralModifiers() {
  return {
    playerDamage: 1,
    playerFireRate: 1,
    riflePierceBonus: 0,
    flamerHeatMultiplier: 1,
    playerSpeed: 1,
    playerMaxHealth: 1,
    turretDamage: 1,
    turretFireRate: 1,
    turretRange: 1,
    turretVolley: 1,
    structureBuffer: 1,
    structureCost: 1,
    serviceRadius: 1,
    foldSpeed: 1,
    repairPower: 1,
    magnetRadius: 1,
    scrapYield: 1,
    fuelEfficiency: 1,
    rackSlots: 0,
    spiderShield: 1,
    extraTrailPerSecond: 0,
    dorsalTurret: false,
  };
}
