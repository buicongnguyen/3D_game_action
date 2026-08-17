import type { ModuleDefinition, RunModifiers } from "../core/types.ts";

/**
 * Spider modules. The slice offers two; both are deliberately double-edged so
 * the safe stop presents a decision rather than a free pickup.
 */

export interface SliceModule extends ModuleDefinition {
  apply: (modifiers: RunModifiers) => void;
}

export const MODULES: Record<string, SliceModule> = {
  "module.crane": {
    id: "module.crane",
    name: "Salvage Crane",
    description: "+1 transport rack and 60% faster folding.",
    tradeoff: "The extra mass costs 15% fuel efficiency.",
    apply: (m) => {
      m.rackSlots += 1;
      m.foldSpeed *= 1.6;
      m.fuelEfficiency *= 0.85;
    },
  },
  "module.dorsalTurret": {
    id: "module.dorsalTurret",
    name: "Dorsal Turret",
    description: "A permanent turret on the spider's back, never needs servicing.",
    tradeoff: "Its noise adds 0.9 Trail per second for the rest of the run.",
    apply: (m) => {
      m.dorsalTurret = true;
      m.extraTrailPerSecond += 0.9;
    },
  },
  "module.boiler": {
    id: "module.boiler",
    name: "Efficient Boiler",
    description: "+35% service radius and cylinders are produced far faster.",
    tradeoff: "The louder boiler adds 0.4 Trail per second.",
    apply: (m) => {
      m.serviceRadius *= 1.35;
      m.extraTrailPerSecond += 0.4;
    },
  },
  "module.reactiveArmor": {
    id: "module.reactiveArmor",
    name: "Reactive Armour",
    description: "Doubles the spider's regenerating shield.",
    tradeoff: "The plating drops march speed slightly and burns 10% more fuel.",
    apply: (m) => {
      m.spiderShield *= 2;
      m.fuelEfficiency *= 0.9;
    },
  },
};

/** The two modules offered at the slice's single safe stop. */
export const SLICE_MODULE_OFFER: readonly string[] = ["module.crane", "module.dorsalTurret"];

export function getModule(id: string): SliceModule {
  const module = MODULES[id];
  if (!module) throw new Error(`Unknown module: ${id}`);
  return module;
}
