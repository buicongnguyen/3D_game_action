/**
 * Versioned save schema (prompt_guide.md §21). `SaveData` is always the
 * current shape — anything read from storage must pass through `migrate()`
 * (see migrations.ts) and then `validateSave()` before it is trusted.
 */

export interface SaveSettings {
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
  vibration: boolean;
  cameraShake: number;
  gamepadDeadZone: number;
}

export interface SaveUnlocks {
  structures: string[];
  weapons: string[];
  modules: string[];
  chassis: string[];
}

export interface SaveProgression {
  currency: number;
  runsPlayed: number;
  wins: number;
  highestDifficulty: number;
}

export interface SaveRecords {
  bestDistance: number;
  bestScore: number;
  discoveredRoutes: string[];
}

export interface SaveDataV1 {
  version: 1;
  settings: SaveSettings;
  unlocks: SaveUnlocks;
  progression: SaveProgression;
  records: SaveRecords;
  lastLoadout: string[];
}

export type SaveData = SaveDataV1;

export const CURRENT_VERSION = 1;

export function createDefaultSave(): SaveData {
  return {
    version: CURRENT_VERSION,
    settings: {
      masterVolume: 1,
      musicVolume: 0.8,
      effectsVolume: 1,
      vibration: true,
      cameraShake: 1,
      gamepadDeadZone: 0.18,
    },
    unlocks: {
      structures: ["rivetTurret", "relay", "barricade"],
      weapons: ["shotgun"],
      modules: [],
      chassis: ["default"],
    },
    progression: {
      currency: 0,
      runsPlayed: 0,
      wins: 0,
      highestDifficulty: 0,
    },
    records: {
      bestDistance: 0,
      bestScore: 0,
      discoveredRoutes: [],
    },
    lastLoadout: [],
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return n < min ? min : n > max ? max : n;
}

function nonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const floored = Math.floor(value);
  return floored < 0 ? 0 : floored;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toStringArray(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) return fallback.slice();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") out.push(entry);
  }
  return out;
}

/**
 * Deep-validates and repairs a parsed object, filling missing fields with
 * defaults and clamping out-of-range values. Never throws — any shape of
 * garbage input produces a usable SaveData.
 */
export function validateSave(raw: unknown): SaveData {
  const fallback = createDefaultSave();
  if (!isPlainObject(raw)) return fallback;

  const settingsRaw = isPlainObject(raw.settings) ? raw.settings : {};
  const unlocksRaw = isPlainObject(raw.unlocks) ? raw.unlocks : {};
  const progressionRaw = isPlainObject(raw.progression) ? raw.progression : {};
  const recordsRaw = isPlainObject(raw.records) ? raw.records : {};

  return {
    version: CURRENT_VERSION,
    settings: {
      masterVolume: clampNumber(settingsRaw.masterVolume, fallback.settings.masterVolume, 0, 1),
      musicVolume: clampNumber(settingsRaw.musicVolume, fallback.settings.musicVolume, 0, 1),
      effectsVolume: clampNumber(settingsRaw.effectsVolume, fallback.settings.effectsVolume, 0, 1),
      vibration: toBoolean(settingsRaw.vibration, fallback.settings.vibration),
      cameraShake: clampNumber(settingsRaw.cameraShake, fallback.settings.cameraShake, 0, 1),
      gamepadDeadZone: clampNumber(
        settingsRaw.gamepadDeadZone,
        fallback.settings.gamepadDeadZone,
        0,
        0.5,
      ),
    },
    unlocks: {
      structures: toStringArray(unlocksRaw.structures, fallback.unlocks.structures),
      weapons: toStringArray(unlocksRaw.weapons, fallback.unlocks.weapons),
      modules: toStringArray(unlocksRaw.modules, fallback.unlocks.modules),
      chassis: toStringArray(unlocksRaw.chassis, fallback.unlocks.chassis),
    },
    progression: {
      currency: nonNegativeInt(progressionRaw.currency, fallback.progression.currency),
      runsPlayed: nonNegativeInt(progressionRaw.runsPlayed, fallback.progression.runsPlayed),
      wins: nonNegativeInt(progressionRaw.wins, fallback.progression.wins),
      highestDifficulty: nonNegativeInt(
        progressionRaw.highestDifficulty,
        fallback.progression.highestDifficulty,
      ),
    },
    records: {
      bestDistance: clampNumber(
        recordsRaw.bestDistance,
        fallback.records.bestDistance,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      bestScore: clampNumber(
        recordsRaw.bestScore,
        fallback.records.bestScore,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      discoveredRoutes: toStringArray(recordsRaw.discoveredRoutes, fallback.records.discoveredRoutes),
    },
    lastLoadout: toStringArray(raw.lastLoadout, fallback.lastLoadout),
  };
}
