/**
 * Sequential save migrations. Each entry maps FROM its key version TO the
 * next version up; `migrate()` walks the chain until it reaches
 * `CURRENT_VERSION` (or runs out of steps, leaving the caller's validator to
 * repair whatever is left).
 */

import { CURRENT_VERSION, createDefaultSave } from "./SaveSchema.ts";

export type Migration = (data: any) => any;

/**
 * Pre-versioning save shape (no `version` field). This was the flat layout
 * used before §21's nested schema existed; kept here purely so the v0 -> v1
 * step has a real, exercised source shape rather than a hypothetical one.
 */
interface LegacySaveV0 {
  masterVolume?: number;
  musicVolume?: number;
  sfxVolume?: number;
  vibrationEnabled?: boolean;
  shakeIntensity?: number;
  stickDeadZone?: number;
  unlockedStructures?: string[];
  unlockedWeapons?: string[];
  unlockedModules?: string[];
  unlockedChassis?: string[];
  scrapBanked?: number;
  runsPlayed?: number;
  runsWon?: number;
  maxDifficulty?: number;
  farthestDistance?: number;
  topScore?: number;
  routesSeen?: string[];
  loadout?: string[];
}

function migrateV0toV1(raw: unknown): unknown {
  const legacy = (raw ?? {}) as LegacySaveV0;
  const fallback = createDefaultSave();
  return {
    version: 1,
    settings: {
      masterVolume: legacy.masterVolume ?? fallback.settings.masterVolume,
      musicVolume: legacy.musicVolume ?? fallback.settings.musicVolume,
      effectsVolume: legacy.sfxVolume ?? fallback.settings.effectsVolume,
      vibration: legacy.vibrationEnabled ?? fallback.settings.vibration,
      cameraShake: legacy.shakeIntensity ?? fallback.settings.cameraShake,
      gamepadDeadZone: legacy.stickDeadZone ?? fallback.settings.gamepadDeadZone,
    },
    unlocks: {
      structures: legacy.unlockedStructures ?? fallback.unlocks.structures,
      weapons: legacy.unlockedWeapons ?? fallback.unlocks.weapons,
      modules: legacy.unlockedModules ?? fallback.unlocks.modules,
      chassis: legacy.unlockedChassis ?? fallback.unlocks.chassis,
    },
    progression: {
      currency: legacy.scrapBanked ?? fallback.progression.currency,
      runsPlayed: legacy.runsPlayed ?? fallback.progression.runsPlayed,
      wins: legacy.runsWon ?? fallback.progression.wins,
      highestDifficulty: legacy.maxDifficulty ?? fallback.progression.highestDifficulty,
    },
    records: {
      bestDistance: legacy.farthestDistance ?? fallback.records.bestDistance,
      bestScore: legacy.topScore ?? fallback.records.bestScore,
      discoveredRoutes: legacy.routesSeen ?? fallback.records.discoveredRoutes,
    },
    lastLoadout: legacy.loadout ?? fallback.lastLoadout,
  };
}

/** Keyed by the FROM version: `MIGRATIONS[0]` takes v0 data to v1, etc. */
export const MIGRATIONS: Record<number, Migration> = {
  0: migrateV0toV1,
};

/**
 * Runs migrations sequentially from `data.version` (missing/non-numeric
 * treated as 0, the legacy flat shape) up to `CURRENT_VERSION`. Stops early
 * if a step is missing from the table, leaving the caller's validator to
 * fill in whatever could not be migrated.
 */
export function migrate(data: any): any {
  let current = data;
  let version = typeof current?.version === "number" ? current.version : 0;

  while (version < CURRENT_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) break;
    current = step(current);
    const reported = typeof current?.version === "number" ? current.version : version + 1;
    // Guard against a migration that forgets to bump `version`, which would
    // otherwise spin forever.
    version = reported > version ? reported : version + 1;
  }

  return current;
}
