/**
 * localStorage-backed persistence for §21's save schema. Owns two storage
 * slots: a primary and a one-save-behind backup. Reads are defensive at
 * every step (missing key, corrupt JSON, wrong/future version, a throwing
 * Storage) so a corrupted or absent save never crashes the game — it just
 * degrades to defaults.
 */

import type { SaveData } from "./SaveSchema.ts";
import { CURRENT_VERSION, createDefaultSave, validateSave } from "./SaveSchema.ts";
import { migrate } from "./migrations.ts";

const PRIMARY_KEY = "marchaDeFerro.save.v1";
const BACKUP_KEY = "marchaDeFerro.save.v1.backup";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class SaveManager {
  private readonly storage: Storage | null;
  private _data: SaveData;
  private _recoveredFromBackup = false;

  constructor(storage?: Storage) {
    this.storage =
      storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    this._data = createDefaultSave();
    this.load();
  }

  get data(): SaveData {
    return this._data;
  }

  get recoveredFromBackup(): boolean {
    return this._recoveredFromBackup;
  }

  /** Reads and validates the save from storage, falling back through the backup to defaults. */
  load(): SaveData {
    this._recoveredFromBackup = false;

    const primary = this.readSlot(PRIMARY_KEY);
    if (primary !== null) {
      this._data = primary;
      return this._data;
    }

    const backup = this.readSlot(BACKUP_KEY);
    if (backup !== null) {
      this._recoveredFromBackup = true;
      this._data = backup;
      this.save();
      return this._data;
    }

    this._data = createDefaultSave();
    return this._data;
  }

  /** Parses, migrates and validates a single storage slot. Returns null when unusable. */
  private readSlot(key: string): SaveData | null {
    if (!this.storage) return null;

    let raw: string | null;
    try {
      raw = this.storage.getItem(key);
    } catch {
      return null;
    }
    if (raw == null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!isPlainObject(parsed)) return null;

    const version = typeof parsed.version === "number" ? parsed.version : 0;
    if (version > CURRENT_VERSION) return null;

    const migrated = version < CURRENT_VERSION ? migrate(parsed) : parsed;
    return validateSave(migrated);
  }

  /** Persists the current data, rotating the previous known-good primary into the backup slot first. */
  save(): void {
    if (!this.storage) return;
    try {
      const existingPrimary = this.storage.getItem(PRIMARY_KEY);
      if (existingPrimary !== null) {
        try {
          JSON.parse(existingPrimary);
          this.storage.setItem(BACKUP_KEY, existingPrimary);
        } catch {
          // Existing primary was already corrupt; do not propagate it into the backup.
        }
      }
      this.storage.setItem(PRIMARY_KEY, JSON.stringify(this._data));
    } catch {
      // Quota exceeded or storage unavailable (e.g. private browsing). Keep
      // playing on the in-memory copy rather than throwing.
    }
  }

  /** Mutates the in-memory save, re-validates it, and persists in one call. */
  update(mutator: (data: SaveData) => void): void {
    mutator(this._data);
    this._data = validateSave(this._data);
    this.save();
  }

  /** Resets to defaults and persists immediately. */
  reset(): void {
    this._data = createDefaultSave();
    this.save();
  }
}
