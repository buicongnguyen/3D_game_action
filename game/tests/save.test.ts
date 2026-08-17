import { describe, expect, it } from "vitest";
import { SaveManager } from "../src/save/SaveManager.ts";
import { CURRENT_VERSION, createDefaultSave, validateSave } from "../src/save/SaveSchema.ts";
import { MIGRATIONS, migrate } from "../src/save/migrations.ts";

/** Minimal in-memory Storage implementation for tests (vitest runs in "node"). */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

/** Storage that always throws, simulating a disabled/quota-exceeded localStorage. */
class ThrowingStorage implements Storage {
  readonly length = 0;
  clear(): void {
    throw new Error("storage disabled");
  }
  getItem(): string | null {
    throw new Error("storage disabled");
  }
  key(): string | null {
    throw new Error("storage disabled");
  }
  removeItem(): void {
    throw new Error("storage disabled");
  }
  setItem(): void {
    throw new Error("storage disabled");
  }
}

const PRIMARY_KEY = "marchaDeFerro.save.v1";
const BACKUP_KEY = "marchaDeFerro.save.v1.backup";

describe("SaveManager", () => {
  it("produces defaults when the key is missing", () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);

    expect(manager.data).toEqual(createDefaultSave());
    expect(manager.recoveredFromBackup).toBe(false);
  });

  it("falls back to the backup and flags it when the primary is corrupt JSON", () => {
    const storage = new MemoryStorage();
    const backupSave = createDefaultSave();
    backupSave.progression.currency = 250;
    storage.setItem(PRIMARY_KEY, "{not valid json");
    storage.setItem(BACKUP_KEY, JSON.stringify(backupSave));

    const manager = new SaveManager(storage);

    expect(manager.recoveredFromBackup).toBe(true);
    expect(manager.data.progression.currency).toBe(250);
  });

  it("falls back to defaults (not a crash) when no backup exists either", () => {
    const storage = new MemoryStorage();
    storage.setItem(PRIMARY_KEY, "{not valid json");

    const manager = new SaveManager(storage);

    expect(manager.recoveredFromBackup).toBe(false);
    expect(manager.data).toEqual(createDefaultSave());
  });

  it("falls back to defaults when the saved version is newer than this build understands", () => {
    const storage = new MemoryStorage();
    storage.setItem(PRIMARY_KEY, JSON.stringify({ version: CURRENT_VERSION + 1, junk: true }));

    const manager = new SaveManager(storage);

    expect(manager.data).toEqual(createDefaultSave());
  });

  it("does not crash save() or load() when Storage throws on every call", () => {
    const manager = new SaveManager(new ThrowingStorage());

    expect(manager.data).toEqual(createDefaultSave());
    expect(() => manager.save()).not.toThrow();
    expect(() => manager.load()).not.toThrow();
    expect(() => manager.update((data) => (data.progression.currency = 10))).not.toThrow();
  });

  it("update() mutates, re-validates and persists in one call", () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);

    manager.update((data) => {
      data.progression.currency = 500;
      data.settings.masterVolume = 5; // out of range on purpose
    });

    expect(manager.data.progression.currency).toBe(500);
    expect(manager.data.settings.masterVolume).toBe(1);

    const persisted = JSON.parse(storage.getItem(PRIMARY_KEY)!);
    expect(persisted.progression.currency).toBe(500);
    expect(persisted.settings.masterVolume).toBe(1);
  });

  it("reset() restores defaults and persists them", () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    manager.update((data) => (data.progression.currency = 999));

    manager.reset();

    expect(manager.data).toEqual(createDefaultSave());
    const persisted = JSON.parse(storage.getItem(PRIMARY_KEY)!);
    expect(persisted.progression.currency).toBe(0);
  });

  it("rotates the previous good primary into the backup slot on save", () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    manager.update((data) => (data.progression.currency = 1));
    manager.update((data) => (data.progression.currency = 2));

    const backup = JSON.parse(storage.getItem(BACKUP_KEY)!);
    expect(backup.progression.currency).toBe(1);
    expect(manager.data.progression.currency).toBe(2);
  });
});

describe("migrations", () => {
  it("migrates legacy v0 (flat, no version field) data to v1 with every field present", () => {
    const legacy = {
      masterVolume: 0.4,
      musicVolume: 0.5,
      sfxVolume: 0.6,
      vibrationEnabled: false,
      shakeIntensity: 0.2,
      stickDeadZone: 0.3,
      unlockedStructures: ["rivetTurret"],
      unlockedWeapons: ["shotgun"],
      unlockedModules: ["dorsalTurret"],
      unlockedChassis: ["heavy"],
      scrapBanked: 120,
      runsPlayed: 4,
      runsWon: 1,
      maxDifficulty: 2,
      farthestDistance: 980,
      topScore: 4200,
      routesSeen: ["route.industrial"],
      loadout: ["rivetTurret", "barricade"],
    };

    expect(MIGRATIONS[0]).toBeDefined();

    const migrated = migrate(legacy);
    expect(migrated.version).toBe(CURRENT_VERSION);

    const result = validateSave(migrated);

    expect(result).toEqual({
      version: 1,
      settings: {
        masterVolume: 0.4,
        musicVolume: 0.5,
        effectsVolume: 0.6,
        vibration: false,
        cameraShake: 0.2,
        gamepadDeadZone: 0.3,
      },
      unlocks: {
        structures: ["rivetTurret"],
        weapons: ["shotgun"],
        modules: ["dorsalTurret"],
        chassis: ["heavy"],
      },
      progression: {
        currency: 120,
        runsPlayed: 4,
        wins: 1,
        highestDifficulty: 2,
      },
      records: {
        bestDistance: 980,
        bestScore: 4200,
        discoveredRoutes: ["route.industrial"],
      },
      lastLoadout: ["rivetTurret", "barricade"],
    });
  });

  it("migrates an empty v0 object using defaults for every field", () => {
    const migrated = migrate({});
    const result = validateSave(migrated);
    expect(result).toEqual(createDefaultSave());
  });

  it("a real SaveManager load path exercises the v0 -> v1 migration end to end", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      PRIMARY_KEY,
      JSON.stringify({ scrapBanked: 77, unlockedStructures: ["mine"] }),
    );

    const manager = new SaveManager(storage);

    expect(manager.data.version).toBe(CURRENT_VERSION);
    expect(manager.data.progression.currency).toBe(77);
    expect(manager.data.unlocks.structures).toEqual(["mine"]);
  });
});

describe("validateSave", () => {
  it("returns full defaults for non-object input", () => {
    expect(validateSave(null)).toEqual(createDefaultSave());
    expect(validateSave(undefined)).toEqual(createDefaultSave());
    expect(validateSave("garbage")).toEqual(createDefaultSave());
    expect(validateSave(42)).toEqual(createDefaultSave());
    expect(validateSave([1, 2, 3])).toEqual(createDefaultSave());
  });

  it("repairs a partial object, filling missing fields with defaults", () => {
    const result = validateSave({
      version: 1,
      settings: { masterVolume: 0.3 },
      progression: { currency: 50 },
    });

    const defaults = createDefaultSave();
    expect(result.settings.masterVolume).toBe(0.3);
    expect(result.settings.musicVolume).toBe(defaults.settings.musicVolume);
    expect(result.settings.vibration).toBe(defaults.settings.vibration);
    expect(result.progression.currency).toBe(50);
    expect(result.progression.wins).toBe(defaults.progression.wins);
    expect(result.unlocks).toEqual(defaults.unlocks);
    expect(result.records).toEqual(defaults.records);
    expect(result.lastLoadout).toEqual(defaults.lastLoadout);
  });

  it("clamps an out-of-range volume instead of rejecting the whole save", () => {
    const result = validateSave({
      version: 1,
      settings: { masterVolume: 7, musicVolume: -3, effectsVolume: 0.5 },
    });

    expect(result.settings.masterVolume).toBe(1);
    expect(result.settings.musicVolume).toBe(0);
    expect(result.settings.effectsVolume).toBe(0.5);
  });

  it("drops non-string entries from array fields instead of throwing", () => {
    const result = validateSave({
      version: 1,
      unlocks: { structures: ["rivetTurret", 42, null, "relay"] },
    });
    expect(result.unlocks.structures).toEqual(["rivetTurret", "relay"]);
  });

  it("clamps negative progression counters up to zero", () => {
    const result = validateSave({
      version: 1,
      progression: { currency: -10, runsPlayed: -1, wins: -1, highestDifficulty: -1 },
    });
    expect(result.progression).toEqual({
      currency: 0,
      runsPlayed: 0,
      wins: 0,
      highestDifficulty: 0,
    });
  });
});
