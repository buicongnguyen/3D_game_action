/**
 * The full simulation event vocabulary. Every event carries the data a
 * presentation listener needs so audio/VFX/HUD never have to reach back into
 * simulation state to interpret one.
 */

import type { DamageSource, StructureKind } from "./types.ts";

export interface EnemySpawnedEvent {
  type: "enemy.spawned";
  enemyId: number;
  archetype: string;
  x: number;
  z: number;
}

export interface EnemyDiedEvent {
  type: "enemy.died";
  enemyId: number;
  archetype: string;
  x: number;
  z: number;
  /** True when a player weapon landed the last hit; drives the XP/loot split. */
  killedByPlayer: boolean;
  xp: number;
}

export interface EnemyDamagedEvent {
  type: "enemy.damaged";
  enemyId: number;
  x: number;
  z: number;
  amount: number;
  source: DamageSource;
  /** Post-hit fraction in [0,1], so a health bar can update without a lookup. */
  healthFraction: number;
  critical: boolean;
}

export interface PlayerDamagedEvent {
  type: "player.damaged";
  amount: number;
  remaining: number;
  /** Direction the hit came from, for the directional damage vignette. */
  fromX: number;
  fromZ: number;
}

export interface PlayerDownedEvent {
  type: "player.downed";
  x: number;
  z: number;
  /** Rescue charges left after this knockdown. */
  chargesRemaining: number;
}

export interface PlayerRevivedEvent {
  type: "player.revived";
  x: number;
  z: number;
}

export interface PlayerDodgedEvent {
  type: "player.dodged";
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
}

export interface PlayerTetheredEvent {
  type: "player.tethered";
  x: number;
  z: number;
  droppedCarry: boolean;
}

export interface SpiderDamagedEvent {
  type: "spider.damaged";
  amount: number;
  remaining: number;
  /** True when the regenerating shield absorbed the hit instead of the core. */
  absorbedByShield: boolean;
  x: number;
  z: number;
}

export interface SpiderFuelEmptyEvent {
  type: "spider.fuelEmpty";
}

export interface SpiderRefuelledEvent {
  type: "spider.refuelled";
  amount: number;
  total: number;
}

export interface SpiderSpeedModeEvent {
  type: "spider.speedMode";
  mode: "fallback" | "march" | "overdrive";
}

export interface SpiderModuleInstalledEvent {
  type: "spider.moduleInstalled";
  moduleId: string;
  slot: number;
}

export interface StructurePlacedEvent {
  type: "structure.placed";
  structureId: number;
  kind: StructureKind;
  x: number;
  z: number;
}

export interface StructureFoldedEvent {
  type: "structure.folded";
  structureId: number;
  kind: StructureKind;
  x: number;
  z: number;
}

export interface StructureDestroyedEvent {
  type: "structure.destroyed";
  structureId: number;
  kind: StructureKind;
  x: number;
  z: number;
}

export interface StructureFiredEvent {
  type: "structure.fired";
  structureId: number;
  x: number;
  z: number;
  /** Muzzle world position, already offset along the barrel. */
  muzzleX: number;
  muzzleY: number;
  muzzleZ: number;
  heading: number;
  heavy: boolean;
}

export interface StructureBufferEmptyEvent {
  type: "structure.bufferEmpty";
  structureId: number;
  x: number;
  z: number;
}

export interface StructureLastShotEvent {
  type: "structure.lastShot";
  structureId: number;
  x: number;
  z: number;
  /** "manual" when the player triggered it, "buffer" when it ran dry. */
  trigger: "manual" | "buffer";
}

export interface StructureExplodedEvent {
  type: "structure.exploded";
  structureId: number;
  x: number;
  z: number;
  radius: number;
}

export interface StructureRepairedEvent {
  type: "structure.repaired";
  structureId: number;
  x: number;
  z: number;
  amount: number;
}

export interface StructureRechargedEvent {
  type: "structure.recharged";
  structureId: number;
  x: number;
  z: number;
}

export interface StructureLeftBehindEvent {
  type: "structure.leftBehind";
  structureId: number;
  kind: StructureKind;
  x: number;
  z: number;
}

export interface PickupCollectedEvent {
  type: "pickup.collected";
  kind: "scrap" | "fuel";
  amount: number;
  x: number;
  z: number;
}

export interface ResourceSpentEvent {
  type: "resource.spent";
  kind: "scrap" | "fuel";
  amount: number;
  reason: string;
}

export interface ProjectileHitEvent {
  type: "projectile.hit";
  x: number;
  z: number;
  y: number;
  source: DamageSource;
}

export interface WeaponFiredEvent {
  type: "weapon.fired";
  weaponId: string;
  muzzleX: number;
  muzzleY: number;
  muzzleZ: number;
  heading: number;
}

export interface TrailStateEvent {
  type: "trail.stateChanged";
  from: string;
  to: string;
  trail: number;
}

export interface NoiseEvent {
  type: "noise.generated";
  amount: number;
  x: number;
  z: number;
  reason: string;
}

export interface RunPhaseEvent {
  type: "run.phaseChanged";
  from: string;
  to: string;
}

export interface CheckpointReachedEvent {
  type: "run.checkpointReached";
  checkpointId: string;
  index: number;
}

export interface LevelUpEvent {
  type: "run.levelUp";
  level: number;
}

export interface UpgradeChosenEvent {
  type: "run.upgradeChosen";
  upgradeId: string;
}

export interface RunEndedEvent {
  type: "run.ended";
  outcome: "victory" | "defeat";
  reason: string;
}

export interface CameraShakeEvent {
  type: "camera.shake";
  /** 0..1 nominal; values above 1 are clamped by the camera controller. */
  intensity: number;
  duration: number;
}

export interface VfxRequestEvent {
  type: "vfx.request";
  effect: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  scale: number;
}

export interface UiToastEvent {
  type: "ui.toast";
  message: string;
  tone: "info" | "warning" | "danger" | "success";
  /** Seconds. */
  duration: number;
}

export interface BuildRejectedEvent {
  type: "build.rejected";
  reason: string;
}

export type GameEvent =
  | EnemySpawnedEvent
  | EnemyDiedEvent
  | EnemyDamagedEvent
  | PlayerDamagedEvent
  | PlayerDownedEvent
  | PlayerRevivedEvent
  | PlayerDodgedEvent
  | PlayerTetheredEvent
  | SpiderDamagedEvent
  | SpiderFuelEmptyEvent
  | SpiderRefuelledEvent
  | SpiderSpeedModeEvent
  | SpiderModuleInstalledEvent
  | StructurePlacedEvent
  | StructureFoldedEvent
  | StructureDestroyedEvent
  | StructureFiredEvent
  | StructureBufferEmptyEvent
  | StructureLastShotEvent
  | StructureExplodedEvent
  | StructureRepairedEvent
  | StructureRechargedEvent
  | StructureLeftBehindEvent
  | PickupCollectedEvent
  | ResourceSpentEvent
  | ProjectileHitEvent
  | WeaponFiredEvent
  | TrailStateEvent
  | NoiseEvent
  | RunPhaseEvent
  | CheckpointReachedEvent
  | LevelUpEvent
  | UpgradeChosenEvent
  | RunEndedEvent
  | CameraShakeEvent
  | VfxRequestEvent
  | UiToastEvent
  | BuildRejectedEvent;

export type GameEventType = GameEvent["type"];
