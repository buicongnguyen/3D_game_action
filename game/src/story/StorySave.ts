import type { StoryCheckpoint } from "./StoryState.ts";
import { STORY_WEAPONS } from "./StoryData.ts";
export const STORY_SAVE_KEY = "iron-march.homeward.chapter.v1";
export function validStoryCheckpoint(value: unknown): value is StoryCheckpoint {
  if (!value || typeof value !== "object") return false;
  const v = value as StoryCheckpoint, p = v.progress;
  if (v.version !== 1 || !Number.isSafeInteger(v.seed) || !p || ![1, 2, 3, 4].includes(p.chapter)) return false;
  if (![p.safeAtFarm, p.missing, p.rescued, p.shells, p.damageLevel, p.volley, p.armorLevel].every(Number.isSafeInteger)) return false;
  return p.safeAtFarm >= 0 && p.safeAtFarm <= 6 && p.missing >= 3 && p.missing <= 9 && p.safeAtFarm + p.missing === 9 &&
    p.rescued >= 0 && p.rescued <= p.missing && p.shells >= 0 && p.shells <= 10000 && p.damageLevel >= 0 && p.damageLevel <= 3 &&
    p.volley >= 1 && p.volley <= 3 && p.armorLevel >= 0 && p.armorLevel <= 3 && Array.isArray(p.weapons) &&
    p.weapons.length <= 4 && p.weapons.includes("rifle") && p.weapons.every(w => Object.hasOwn(STORY_WEAPONS, w)) && p.weapons.includes(p.selected);
}
export function loadStoryCheckpoint(storage?: Pick<Storage, "getItem">): StoryCheckpoint | null {
  try { const value: unknown = JSON.parse((storage ?? localStorage).getItem(STORY_SAVE_KEY) ?? "null"); return validStoryCheckpoint(value) ? value : null; }
  catch { return null; }
}
export function saveStoryCheckpoint(value: StoryCheckpoint, storage?: Pick<Storage, "setItem">): boolean {
  if (!validStoryCheckpoint(value)) return false;
  try { (storage ?? localStorage).setItem(STORY_SAVE_KEY, JSON.stringify(value)); return true; } catch { return false; }
}
