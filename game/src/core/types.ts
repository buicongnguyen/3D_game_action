/**
 * Simulation-side type contracts.
 *
 * Nothing in this file may import from `three`. Entities are plain numeric
 * state; `RenderSyncSystem` is the only bridge to `Object3D`s. Keeping this
 * boundary sharp is what lets the simulation be unit-tested headlessly and
 * lets pooling reset an entity by assigning fields rather than rebuilding a
 * scene graph.
 */

// ---------------------------------------------------------------------------
// Run structure
// ---------------------------------------------------------------------------

export type RunPhase =
  | "BOOT"
  | "TITLE"
  | "LOADOUT"
  | "CHECKPOINT_PREP"
  | "MARCH"
  | "ROUTE_CHOICE"
  | "UPGRADE_CHOICE"
  | "FINAL_ESCAPE"
  | "VICTORY"
  | "DEFEAT"
  | "RUN_SUMMARY";

export type TrailState = "QUIET" | "PROBING" | "SWARM" | "HEAVY" | "PURSUIT";
export type RunMode = "expedition" | "salvageRush";
export type WeaponKind = "shotgun" | "rifle" | "flamer" | "launcher";

export type SpeedMode = "fallback" | "march" | "overdrive";

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

export type DamageSource =
  | "player.weapon"
  | "structure.turret"
  | "structure.explosion"
  | "enemy.melee"
  | "enemy.ranged"
  | "environment"
  | "tether";

export interface DamageInfo {
  amount: number;
  source: DamageSource;
  /** World-space origin, used for knockback and directional feedback. */
  originX: number;
  originZ: number;
  knockback: number;
  critical: boolean;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export type PlayerAnimState =
  | "idle"
  | "run"
  | "carry"
  | "carryRun"
  | "repair"
  | "interact"
  | "dodge"
  | "shoot"
  | "hit"
  | "death";

/** What the engineer physically has in their hands. Only ever one thing. */
export type CarryPayload =
  | { kind: "none" }
  | { kind: "cylinder" }
  | {
      kind: "structure";
      structureType: StructureKind;
      health: number;
      buffer: number;
      /** Persists across reinstall cycles so one machine awards recovery XP once. */
      recoveryXpGranted: boolean;
    };

export interface PlayerState {
  x: number;
  z: number;
  /** Previous tick position, used for render interpolation. */
  prevX: number;
  prevZ: number;
  velocityX: number;
  velocityZ: number;
  heading: number;
  prevHeading: number;
  health: number;
  maxHealth: number;
  /** Seconds of damage immunity remaining. */
  invulnerability: number;
  dodgeCooldown: number;
  dodgeTimer: number;
  dodgeDirX: number;
  dodgeDirZ: number;
  carry: CarryPayload;
  animState: PlayerAnimState;
  /** Seconds the current one-shot animation has left; 0 when looping. */
  animLock: number;
  downed: boolean;
  rescueCharges: number;
  /** Progress in seconds of the currently held contextual action. */
  actionProgress: number;
  actionKind: ContextualActionKind | null;
  actionTargetId: number;
  /** Right-stick aim direction; zero length means "auto target nearest". */
  aimX: number;
  aimZ: number;
  weaponCooldown: number;
  currentWeapon: WeaponKind;
  unlockedWeapons: WeaponKind[];
  /** Normalized heat used by heat-limited weapons. */
  weaponHeat: number;
  weaponOverheated: boolean;
  /** Set by the tether system when the engineer has strayed too far. */
  tetherStrain: number;
  /**
   * True while the leash is taut, so `player.tethered` fires on the edge and
   * not on the level. Emitting it every step the engineer was over the line
   * meant sixty toasts a second, each one evicting whatever else was on the
   * stack - a Last Shot warning included.
   */
  tethered: boolean;
}

export type ContextualActionKind =
  | "repair"
  | "refuel"
  | "collect"
  | "fold"
  | "install"
  | "recharge"
  | "pickupCylinder"
  | "lastShot"
  | "mine";

// ---------------------------------------------------------------------------
// Spider
// ---------------------------------------------------------------------------

export interface SpiderState {
  coreHealth: number;
  maxCoreHealth: number;
  shield: number;
  maxShield: number;
  /** Seconds until the shield starts regenerating after a hit. */
  shieldRegenDelay: number;
  fuel: number;
  maxFuel: number;
  speedMode: SpeedMode;
  /** Canonical position along the route, in metres. */
  distanceAlongRoute: number;
  prevDistanceAlongRoute: number;
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  heading: number;
  prevHeading: number;
  serviceRadius: number;
  /** Fixed-length array of rack slots; null means empty. */
  carriedStructures: Array<StructureKind | null>;
  installedModules: string[];
  /** Set while parked at a checkpoint; the spider is stationary and quiet. */
  docked: boolean;
  /** Current speed in m/s, after modifiers. */
  speed: number;
  /** Scrap burned this second while out of fuel, for HUD feedback. */
  emergencyBurn: boolean;
}

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------

export type StructureKind = "rivetTurret" | "relay" | "barricade" | "mine";

export type StructureCategory = "foldable" | "anchored";

export type StructureRuntimeState =
  | "placing"
  | "deploying"
  | "active"
  | "starved"
  | "overloading"
  | "folding"
  | "dropped"
  | "destroyed";

export interface Structure {
  id: number;
  kind: StructureKind;
  category: StructureCategory;
  x: number;
  z: number;
  heading: number;
  health: number;
  maxHealth: number;
  /** Seconds of operation left in the pressure buffer. */
  buffer: number;
  maxBuffer: number;
  state: StructureRuntimeState;
  /** Seconds remaining in `deploying`, `folding` or `overloading`. */
  stateTimer: number;
  /** True while inside the spider's service radius (or a relay's). */
  powered: boolean;
  fireCooldown: number;
  targetEnemyId: number;
  /** Seconds until the target may be re-evaluated. */
  targetLockTimer: number;
  /** Barrel yaw, simulated so the render layer never drives gameplay. */
  turretHeading: number;
  /** Ammo-independent shot counter, used for burst pacing and audio. */
  shotsFired: number;
  /** Set once the spider has passed it; drives the "left behind" warning. */
  behindSpider: boolean;
  /** Seconds since the structure last had line of sight to a target. */
  idleTime: number;
  /** True after this physical machine has paid its one recovery XP award. */
  recoveryXpGranted: boolean;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

export type EnemyAiState = "SPAWNING" | "APPROACHING" | "ATTACKING" | "STAGGERED" | "DEAD";

export type EnemyTargetKind = "core" | "structure" | "player" | "decoy";

export interface Enemy {
  id: number;
  archetype: string;
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  velocityX: number;
  velocityZ: number;
  heading: number;
  prevHeading: number;
  health: number;
  maxHealth: number;
  radius: number;
  speed: number;
  /** Multiplier applied by the director during Pursuit. */
  speedScale: number;
  state: EnemyAiState;
  stateTimer: number;
  targetKind: EnemyTargetKind;
  targetId: number;
  /** Seconds until the target may be re-scored, preventing oscillation. */
  targetCooldown: number;
  attackCooldown: number;
  /** Seconds until this enemy's animation/steering is updated again (LOD). */
  lodTimer: number;
  /** 0 = full rate, 1 = half rate, 2 = quarter rate. */
  lodTier: number;
  active: boolean;
  /** Index of the pooled render instance, or -1 when not yet bound. */
  renderIndex: number;
  /** Accumulated knockback impulse, applied and decayed each tick. */
  knockX: number;
  knockZ: number;
  /** Distinguishes the awakening spawn animation from an off-screen spawn. */
  spawnedVisible: boolean;
  /** Random 0..1 fixed at spawn; de-syncs animation phase across the horde. */
  phase: number;
  /**
   * Seconds left on the white hit flash. The render layer decays it and turns
   * it into a per-instance colour, so a hundred enemies can flash without a
   * material per body.
   */
  hitFlash: number;
  /** Direction the last hit came from, for the recoil shove. */
  hitDirX: number;
  hitDirZ: number;
  /** Time spent trying to move without making progress; drives bounded recovery. */
  stuckTime: number;
  /** A player weapon has tagged this enemy, so its eventual loot is recoverable. */
  playerLootCredit: boolean;
}

export interface EnemyArchetype {
  id: string;
  name: string;
  health: number;
  speed: number;
  /** Budget cost charged to the director when spawning one. */
  spawnCost: number;
  /** Minimum Trail value before the director will consider this archetype. */
  minimumThreat: number;
  weight: number;
  radius: number;
  damage: number;
  attackInterval: number;
  attackRange: number;
  xp: number;
  /** Scrap dropped on death, before magnet/luck modifiers. */
  scrapDrop: number;
  scrapDropChance: number;
  /** Render scale relative to the 1.8 m reference humanoid. */
  scale: number;
  rig: "medium" | "large";
  /** Higher values pull enemy targeting toward structures over the player. */
  structurePreference: number;
  /** Tactical role used by scoring and the adaptive spawn mix. */
  targetRole: "hunter" | "saboteur" | "breaker" | "support";
  knockbackResistance: number;
}

// ---------------------------------------------------------------------------
// Projectiles & pickups
// ---------------------------------------------------------------------------

export interface Projectile {
  id: number;
  x: number;
  z: number;
  y: number;
  prevX: number;
  prevZ: number;
  prevY: number;
  velocityX: number;
  velocityZ: number;
  speed: number;
  damage: number;
  radius: number;
  lifetime: number;
  source: DamageSource;
  /** Enemies already hit, for piercing shots. -1 entries are unused slots. */
  pierceLeft: number;
  lastHitId: number;
  active: boolean;
  /** Visual variant index into the projectile mesh table. */
  variant: number;
  knockback: number;
  explosionRadius: number;
}

export type PickupKind =
  | "scrap"
  | "fuel"
  | "cylinder"
  | "repairKit"
  | "pressureCanister"
  | "shockMine"
  | "armorPlate"
  | "weaponPart";

export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number;
  z: number;
  y: number;
  amount: number;
  /** Seconds before the magnet may pull it; stops drops snapping instantly. */
  settleTimer: number;
  lifetime: number;
  /** Set while being pulled toward the player by the magnet. */
  attracted: boolean;
  /** Optional attraction radius for combat-earned loot; zero uses the normal magnet. */
  claimRadius: number;
  velocityX: number;
  velocityZ: number;
  active: boolean;
  /** Bob/spin phase so a field of pickups does not move in lockstep. */
  phase: number;
}

// ---------------------------------------------------------------------------
// Build / placement
// ---------------------------------------------------------------------------

export type PlacementValidity = "valid" | "unpowered" | "invalid";

export interface PlacementResult {
  validity: PlacementValidity;
  /** Player-facing explanation; empty when valid. */
  reason: string;
  x: number;
  z: number;
  heading: number;
}

export interface BuildState {
  /** True while L1 is held and the radial is open. */
  radialOpen: boolean;
  radialIndex: number;
  /** True once a blueprint is chosen and the ghost is being positioned. */
  ghostActive: boolean;
  ghostKind: StructureKind | null;
  ghostX: number;
  ghostZ: number;
  ghostHeading: number;
  ghostValidity: PlacementValidity;
  ghostReason: string;
  /** Index of the currently selected blueprint in the loadout. */
  selectedBlueprint: number;
}

// ---------------------------------------------------------------------------
// Resources & progression
// ---------------------------------------------------------------------------

export interface RunResources {
  scrap: number;
  fuel: number;
}

export interface RunProgress {
  level: number;
  xp: number;
  xpToNext: number;
  pendingLevelUps: number;
  chosenUpgrades: string[];
}

export interface RunStats {
  seed: number;
  elapsedSeconds: number;
  enemiesKilled: number;
  damageByPlayer: number;
  damageByStructures: number;
  structuresPlaced: number;
  structuresRecovered: number;
  structuresAbandoned: number;
  lastShotsTriggered: number;
  scrapCollected: number;
  fuelCollected: number;
  distanceTravelled: number;
  peakTrail: number;
  timeInPursuit: number;
  objectivesCompleted: number;
  nestsDestroyed: number;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export interface SpawnZoneDefinition {
  /** Distance along the route where this zone becomes eligible. */
  fromDistance: number;
  toDistance: number;
  /** Lateral offset band from the route centreline, in metres. */
  minLateral: number;
  maxLateral: number;
  /** Relative weight when the director picks a zone. */
  weight: number;
  /** Restricts a zone to a Trail state range. */
  minTrail: number;
}

export interface ResourceZoneDefinition {
  kind: PickupKind | "scrapLarge" | "fuelBarrel";
  fromDistance: number;
  toDistance: number;
  count: number;
  maxLateral: number;
}

export interface RouteEncounterDefinition {
  id: string;
  kind: "emptyHouse" | "occupiedHouse" | "workshopNest";
  /** Position along the route and signed offset from its centreline. */
  distance: number;
  lateral: number;
  /** Spider distance before activation. Occupied sites warn before releasing. */
  triggerLead: number;
  warningSeconds: number;
  occupants: Array<{ archetype: string; count: number }>;
}

export interface EncounterSite {
  id: number;
  definitionId: string;
  x: number;
  z: number;
  health: number;
  maxHealth: number;
  radius: number;
  active: boolean;
  triggered: boolean;
  wavesReleased: number;
  reinforcementTimer: number;
}

export interface WaterZoneDefinition {
  /** Longitudinal shallow-water band across the route. */
  fromDistance: number;
  toDistance: number;
  /** Dry bridge half-width either side of the route centreline. */
  bridgeHalfWidth: number;
  /** Total visible channel half-width. */
  channelHalfWidth: number;
}

export type RouteObjectiveKind = "recover" | "pressure" | "salvage" | "pursuit" | "nests";

export interface RouteObjectiveDefinition {
  kind: RouteObjectiveKind;
  label: string;
  target: number;
  reward: { kind: "scrap" | "fuel" | "core"; amount: number };
}

export interface RouteSegmentDefinition {
  id: string;
  name: string;
  /** Short player-facing reward description, shown at the fork. */
  reward: string;
  /** Short player-facing danger description, shown at the fork. */
  danger: string;
  points: Array<[number, number, number]>;
  lengthMeters: number;
  recommendedDuration: number;
  /** Multiplies ambient horde pressure; authored encounter squads are unaffected. */
  ambientThreatScale?: number;
  /** Guaranteed campaign reward when this stage is first entered. */
  weaponUnlock?: WeaponKind;
  blueprintUnlocks?: StructureKind[];
  pursuitStartSeconds: number;
  /** Optional stationary defense beat before the Spider begins this leg. */
  departureHoldSeconds?: number;
  spawnZones: SpawnZoneDefinition[];
  resourceZones: ResourceZoneDefinition[];
  /** Finite authored beats, rendered and simulated from the same route data. */
  encounters?: RouteEncounterDefinition[];
  waterZones?: WaterZoneDefinition[];
  modifiers: string[];
  rewardTable: string;
  destinationId: string;
  objective: RouteObjectiveDefinition;
  /** Corridor half-width in metres; drives terrain, nav grid and validation. */
  corridorHalfWidth: number;
}

// ---------------------------------------------------------------------------
// Upgrades & modules
// ---------------------------------------------------------------------------

export type UpgradeCategory = "weapon" | "tool" | "structure" | "spider";

export interface UpgradeDefinition {
  id: string;
  name: string;
  description: string;
  category: UpgradeCategory;
  /** Maximum times this upgrade may be taken in one run. */
  maxStacks: number;
  weight: number;
}

export interface ModuleDefinition {
  id: string;
  name: string;
  description: string;
  /** Downside shown alongside the benefit, so the choice has weight. */
  tradeoff: string;
}

/** Aggregated multipliers produced by upgrades and modules. */
export interface RunModifiers {
  playerDamage: number;
  playerFireRate: number;
  /** Behavior upgrades, kept separate from generic damage multipliers. */
  riflePierceBonus: number;
  flamerHeatMultiplier: number;
  playerSpeed: number;
  playerMaxHealth: number;
  turretDamage: number;
  turretFireRate: number;
  turretRange: number;
  structureBuffer: number;
  structureCost: number;
  serviceRadius: number;
  foldSpeed: number;
  repairPower: number;
  magnetRadius: number;
  scrapYield: number;
  fuelEfficiency: number;
  rackSlots: number;
  spiderShield: number;
  /** Additive Trail per second from noisy modules such as the dorsal turret. */
  extraTrailPerSecond: number;
  /** Set by the dorsal turret module. */
  dorsalTurret: boolean;
}
