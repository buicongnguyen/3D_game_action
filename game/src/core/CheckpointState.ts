import type {
  BuildState,
  PlayerState,
  RunModifiers,
  RunMode,
  RunProgress,
  RunResources,
  RunStats,
  SpiderState,
  Structure,
  TrailState,
} from "./types.ts";
import type { GameWorld } from "../game/GameWorld.ts";
import type { RunStateSystem } from "../game/systems/RunStateSystem.ts";
import { getBlueprint } from "../data/structures.ts";
import { WEAPON_ORDER } from "../data/weaponShop.ts";

const STORAGE_KEY = "iron-march.checkpoint-retry.v1";

export interface CheckpointSnapshot {
  version: 1;
  seed: number;
  mode: RunMode;
  segmentId: string;
  player: PlayerState;
  spider: SpiderState;
  build: BuildState;
  resources: RunResources;
  progress: RunProgress;
  stats: RunStats;
  modifiers: RunModifiers;
  structures: Structure[];
  fieldItems: GameWorld["fieldItems"];
  loadout: GameWorld["loadout"];
  trail: number;
  trailState: TrailState;
  pursuitTime: number;
  elapsed: number;
  tick: number;
  cylindersReady: number;
  cylinderTimer: number;
  salvageTimeRemaining: number;
  salvageScore: number;
  nextId: number;
  randomState: number;
  directorRandomState: number;
  cosmeticRandomState: number;
}

/** Captures the durable state at the entrance to a stage, before its loot rolls. */
export function captureCheckpoint(world: GameWorld): CheckpointSnapshot | null {
  const segmentId = world.route.segment?.id;
  if (!segmentId) return null;
  return clone({
    version: 1 as const,
    seed: world.stats.seed,
    mode: world.mode,
    segmentId,
    player: world.player,
    spider: world.spider,
    build: world.build,
    resources: world.resources,
    progress: world.progress,
    stats: world.stats,
    modifiers: world.modifiers,
    structures: world.structures,
    fieldItems: world.fieldItems,
    loadout: world.loadout,
    trail: world.trail,
    trailState: world.trailState,
    pursuitTime: world.pursuitTime,
    elapsed: world.elapsed,
    tick: world.tick,
    cylindersReady: world.cylindersReady,
    cylinderTimer: world.cylinderTimer,
    salvageTimeRemaining: world.salvageTimeRemaining,
    salvageScore: world.salvageScore,
    nextId: world.nextEntityId,
    randomState: world.random.getState(),
    directorRandomState: world.directorRandom.getState(),
    cosmeticRandomState: world.cosmeticRandom.getState(),
  });
}

/** Restores campaign state; transient combat entities deliberately start empty. */
export function restoreCheckpoint(
  world: GameWorld,
  runState: RunStateSystem,
  snapshot: CheckpointSnapshot,
): void {
  if (snapshot.version !== 1 || snapshot.seed !== world.stats.seed || snapshot.mode !== world.mode) {
    throw new Error("Checkpoint does not belong to this run");
  }

  const state = clone(snapshot);
  Object.assign(world.player, state.player);
  // Weapon levels were added after checkpoint retry. Keep queued snapshots from
  // older builds playable and never present an unlocked weapon as Mk 0.
  world.player.weaponLevels ??= {
    shotgun: 1,
    carbine: 0,
    rifle: 0,
    flamer: 0,
    arc: 0,
    launcher: 0,
  };
  for (const kind of WEAPON_ORDER) {
    world.player.weaponLevels[kind] ??= 0;
    if (world.player.unlockedWeapons.includes(kind)) {
      world.player.weaponLevels[kind] = Math.max(1, world.player.weaponLevels[kind]);
    }
  }
  Object.assign(world.spider, state.spider);
  Object.assign(world.build, state.build);
  Object.assign(world.resources, state.resources);
  Object.assign(world.progress, state.progress);
  world.progress.turretUpgrades ??= { power: 0, volley: 0, range: 0, autoloader: 0 };
  world.modifiers.turretVolley ??= 1;
  Object.assign(world.stats, state.stats);
  Object.assign(world.modifiers, state.modifiers);
  Object.assign(world.fieldItems, state.fieldItems);
  world.loadout.splice(0, world.loadout.length, ...state.loadout);
  world.structures.splice(0, world.structures.length, ...state.structures);

  world.enemies.releaseAll();
  world.projectiles.releaseAll();
  world.pickups.releaseAll();
  world.encounterSites.length = 0;
  world.navigation.clearDynamic();

  world.route.start();
  runState.pendingOffers = [];
  runState.pendingModules = [];
  runState.pendingRoutes = [];
  runState.pendingLoadout = false;
  runState.pendingShop = false;
  runState.pendingStory = undefined;
  runState.checkpointTimer = 0;
  runState.departCheckpoint(world, state.segmentId);

  world.phaseTime = 0;
  world.trail = state.trail;
  world.trailState = state.trailState;
  world.pursuitTime = state.pursuitTime;
  world.elapsed = state.elapsed;
  world.tick = state.tick;
  world.cylindersReady = state.cylindersReady;
  world.cylinderTimer = state.cylinderTimer;
  world.salvageTimeRemaining = state.salvageTimeRemaining;
  world.salvageScore = state.salvageScore;
  world.setNextEntityId(state.nextId);
  world.random.setState(state.randomState);
  world.directorRandom.setState(state.directorRandomState);
  world.cosmeticRandom.setState(state.cosmeticRandomState);

  // Re-register restored barricades after the dynamic navigation grid reset.
  for (let i = 0; i < world.structures.length; i++) {
    const structure = world.structures[i];
    if (structure.kind === "barricade" && structure.state !== "destroyed") {
      world.navigation.addObstacle(
        structure.x,
        structure.z,
        getBlueprint("barricade").radius,
        structure.id,
      );
    }
  }
}

export function queueCheckpointRetry(snapshot: CheckpointSnapshot): boolean {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function peekQueuedCheckpoint(): Pick<CheckpointSnapshot, "seed" | "mode"> | null {
  const snapshot = readQueuedCheckpoint(false);
  return snapshot ? { seed: snapshot.seed, mode: snapshot.mode } : null;
}

export function takeQueuedCheckpoint(): CheckpointSnapshot | null {
  return readQueuedCheckpoint(true);
}

function readQueuedCheckpoint(remove: boolean): CheckpointSnapshot | null {
  if (typeof window === "undefined") return null;
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  if (remove) {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Reading succeeded, so the one queued restore remains safe to use.
    }
  }
  try {
    const value = JSON.parse(raw) as Partial<CheckpointSnapshot>;
    const valid = value.version === 1 &&
      typeof value.seed === "number" &&
      (value.mode === "expedition" || value.mode === "salvageRush") &&
      typeof value.segmentId === "string";
    if (!valid && !remove) {
      try {
        window.sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        // Invalid data is ignored even if this browser refuses its removal.
      }
    }
    return valid
      ? value as CheckpointSnapshot
      : null;
  } catch {
    if (!remove) {
      try {
        window.sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        // Invalid data is ignored even if this browser refuses its removal.
      }
    }
    return null;
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
