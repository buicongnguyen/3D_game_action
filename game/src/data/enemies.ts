import type { EnemyArchetype } from "../core/types.ts";

/**
 * Enemy roster for the vertical slice. The Necromancer is defined but not
 * registered in `SLICE_ROSTER`; it is post-slice content per the spec.
 */

export const ENEMY_ARCHETYPES: Record<string, EnemyArchetype> = {
  minion: {
    id: "minion",
    name: "Skeleton Minion",
    health: 20,
    speed: 2.3,
    spawnCost: 1,
    minimumThreat: 0,
    weight: 10,
    radius: 0.38,
    damage: 6,
    attackInterval: 1.1,
    attackRange: 1.35,
    xp: 1,
    scrapDrop: 3,
    scrapDropChance: 0.34,
    scale: 0.94,
    rig: "medium",
    structurePreference: 0.55,
    knockbackResistance: 0,
  },
  warrior: {
    id: "warrior",
    name: "Skeleton Warrior",
    health: 80,
    speed: 1.7,
    spawnCost: 4,
    minimumThreat: 40,
    weight: 5,
    radius: 0.46,
    damage: 14,
    attackInterval: 1.5,
    attackRange: 1.6,
    xp: 4,
    scrapDrop: 4,
    scrapDropChance: 0.6,
    scale: 1.06,
    rig: "medium",
    // Warriors are the structure-breakers; they bias hard toward buildings.
    structurePreference: 1.5,
    knockbackResistance: 0.45,
  },
  golem: {
    id: "golem",
    name: "Skeleton Golem",
    health: 400,
    speed: 1.1,
    spawnCost: 15,
    minimumThreat: 70,
    weight: 1.6,
    radius: 0.95,
    damage: 34,
    attackInterval: 2.2,
    attackRange: 2.6,
    xp: 22,
    scrapDrop: 12,
    scrapDropChance: 1,
    scale: 1.62,
    rig: "large",
    // The golem is the spider-killer; it walks past everything for the core.
    structurePreference: 0.25,
    knockbackResistance: 0.92,
  },
  necromancer: {
    id: "necromancer",
    name: "Necromancer",
    health: 120,
    speed: 1.4,
    spawnCost: 10,
    minimumThreat: 65,
    weight: 2,
    radius: 0.44,
    damage: 12,
    attackInterval: 2.6,
    attackRange: 11,
    xp: 14,
    scrapDrop: 8,
    scrapDropChance: 0.8,
    scale: 1.04,
    rig: "medium",
    structurePreference: 0.4,
    knockbackResistance: 0.2,
  },
};

/** Archetypes the director may draw from during the vertical slice. */
export const SLICE_ROSTER: readonly string[] = ["minion", "warrior", "golem"];

export function getArchetype(id: string): EnemyArchetype {
  const archetype = ENEMY_ARCHETYPES[id];
  if (!archetype) throw new Error(`Unknown enemy archetype: ${id}`);
  return archetype;
}
