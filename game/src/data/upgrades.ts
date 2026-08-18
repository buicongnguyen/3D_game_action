import type { RunModifiers, UpgradeDefinition } from "../core/types.ts";

/**
 * Six upgrades for the vertical slice, one pair per category so every level-up
 * offer can present a real choice rather than three flavours of "more damage".
 *
 * Each entry owns its own `apply`, so adding an upgrade never means editing a
 * switch statement somewhere else.
 */

export interface SliceUpgrade extends UpgradeDefinition {
  apply: (modifiers: RunModifiers) => void;
}

export const UPGRADES: Record<string, SliceUpgrade> = {
  "weapon.choke": {
    id: "weapon.choke",
    name: "Armor-Punch Chamber",
    description: "+12% weapon damage; Rivet Rifle rounds pierce one additional target.",
    category: "weapon",
    maxStacks: 2,
    weight: 10,
    apply: (m) => {
      m.playerDamage *= 1.12;
      m.riflePierceBonus += 1;
    },
  },
  "weapon.autoloader": {
    id: "weapon.autoloader",
    name: "Autoloader",
    description: "+15% fire rate; Steam Flamer builds 22% less heat.",
    category: "weapon",
    maxStacks: 2,
    weight: 10,
    apply: (m) => {
      m.playerFireRate *= 1.15;
      m.flamerHeatMultiplier *= 0.78;
    },
  },
  "tool.hydraulics": {
    id: "tool.hydraulics",
    name: "Hydraulic Arms",
    description: "Fold and install 45% faster. Repairs restore half again as much.",
    category: "tool",
    maxStacks: 1,
    weight: 9,
    apply: (m) => {
      m.foldSpeed *= 1.45;
      m.repairPower *= 1.5;
    },
  },
  "tool.magnet": {
    id: "tool.magnet",
    name: "Field Magnet",
    description: "Doubles pickup radius and +20% scrap from every source.",
    category: "tool",
    maxStacks: 1,
    weight: 9,
    apply: (m) => {
      m.magnetRadius *= 2;
      m.scrapYield *= 1.2;
    },
  },
  "structure.pressureTanks": {
    id: "structure.pressureTanks",
    name: "Oversized Tanks",
    description: "+50% structure buffer. A turret runs most of a stretch unattended.",
    category: "structure",
    maxStacks: 2,
    weight: 10,
    apply: (m) => {
      m.structureBuffer *= 1.5;
    },
  },
  "structure.riflingKit": {
    id: "structure.riflingKit",
    name: "Rifling Kit",
    description: "+25% turret damage and +15% turret range.",
    category: "structure",
    maxStacks: 2,
    weight: 10,
    apply: (m) => {
      m.turretDamage *= 1.25;
      m.turretRange *= 1.15;
    },
  },
};

export const SLICE_UPGRADE_POOL: readonly string[] = Object.keys(UPGRADES);

export function getUpgrade(id: string): SliceUpgrade {
  const upgrade = UPGRADES[id];
  if (!upgrade) throw new Error(`Unknown upgrade: ${id}`);
  return upgrade;
}

/**
 * Picks `count` distinct offers, excluding anything already at max stacks.
 * Deterministic given the supplied random stream.
 */
export function rollUpgradeOffers(
  taken: readonly string[],
  count: number,
  nextWeightedIndex: (weights: number[]) => number,
): string[] {
  const stacks = new Map<string, number>();
  for (const id of taken) stacks.set(id, (stacks.get(id) ?? 0) + 1);

  const candidates = SLICE_UPGRADE_POOL.filter((id) => {
    const upgrade = UPGRADES[id];
    return (stacks.get(id) ?? 0) < upgrade.maxStacks;
  });

  const offers: string[] = [];
  const pool = [...candidates];
  while (offers.length < count && pool.length > 0) {
    const weights = pool.map((id) => UPGRADES[id].weight);
    const index = nextWeightedIndex(weights);
    if (index < 0) break;
    offers.push(pool[index]);
    pool.splice(index, 1);
  }
  return offers;
}
