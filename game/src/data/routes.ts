import type { RouteSegmentDefinition } from "../core/types.ts";

/**
 * Authored route for the vertical slice.
 *
 * Layout: simple opening road -> safe stop -> two-way stage fork -> final escape.
 * At the spider's 1.25 m/s march speed the total is roughly 8.5-9.5 minutes,
 * which is the Stage 5 target. Most splines stay compact corridors with short
 * side pockets. Rust Yard uses repeated switchbacks as the optional mode's
 * maze-like salvage lane without lengthening every branch of the expedition.
 *
 * Points are control points for a CatmullRom curve. They are deliberately
 * sparse and smooth - the arc-length table does the rest.
 */

export const ROUTE_SEGMENTS: Record<string, RouteSegmentDefinition> = {
  "seg.approach": {
    id: "seg.approach",
    name: "Ashfall Approach",
    reward: "Opening stretch",
    danger: "Light probing",
    points: [
      [0, 0, 0],
      [0, 0, 26],
      [1, 0, 52],
      [0, 0, 78],
      [0, 0, 104],
      [0, 0, 128],
      [2, 0, 152],
      [4, 0, 172],
    ],
    lengthMeters: 176,
    recommendedDuration: 140,
    ambientThreatScale: 0.55,
    pursuitStartSeconds: 999,
    corridorHalfWidth: 15,
    spawnZones: [
      { fromDistance: 28, toDistance: 176, minLateral: 18, maxLateral: 34, weight: 0.62, minTrail: 0 },
      { fromDistance: 112, toDistance: 176, minLateral: 15, maxLateral: 28, weight: 0.85, minTrail: 28 },
    ],
    resourceZones: [
      { kind: "scrap", fromDistance: 14, toDistance: 170, count: 16, maxLateral: 12 },
      { kind: "scrapLarge", fromDistance: 40, toDistance: 160, count: 3, maxLateral: 11 },
      { kind: "fuel", fromDistance: 30, toDistance: 165, count: 4, maxLateral: 11 },
      { kind: "repairKit", fromDistance: 72, toDistance: 84, count: 1, maxLateral: 11 },
    ],
    encounters: [
      { id: "house.departure-cache", kind: "emptyHouse", distance: 78, lateral: -11, triggerLead: 0, warningSeconds: 0, occupants: [] },
    ],
    modifiers: [],
    rewardTable: "basic",
    destinationId: "checkpoint.foundry",
    objective: {
      kind: "salvage",
      label: "Collect 18 scrap along Departure Road",
      target: 18,
      reward: { kind: "scrap", amount: 12 },
    },
  },

  "seg.mine": {
    id: "seg.mine",
    name: "Broken Settlement",
    reward: "Rivet Rifle and abundant fuel",
    danger: "Occupied houses release escalating squads",
    points: [
      [4, 0, 172],
      [14, 0, 196],
      [22, 0, 222],
      [20, 0, 250],
      [10, 0, 274],
      [2, 0, 300],
      [6, 0, 326],
      [16, 0, 348],
      [22, 0, 368],
    ],
    lengthMeters: 208,
    recommendedDuration: 170,
    ambientThreatScale: 0.9,
    weaponUnlock: "rifle",
    blueprintUnlocks: ["relay"],
    pursuitStartSeconds: 999,
    // The cut is genuinely tight: less room to reposition, more forced contact.
    corridorHalfWidth: 10,
    spawnZones: [
      { fromDistance: 10, toDistance: 208, minLateral: 12, maxLateral: 24, weight: 1, minTrail: 0 },
      { fromDistance: 40, toDistance: 208, minLateral: 10, maxLateral: 20, weight: 1.8, minTrail: 50 },
    ],
    resourceZones: [
      { kind: "fuel", fromDistance: 12, toDistance: 200, count: 11, maxLateral: 8 },
      { kind: "fuelBarrel", fromDistance: 30, toDistance: 190, count: 3, maxLateral: 8 },
      { kind: "scrap", fromDistance: 12, toDistance: 200, count: 12, maxLateral: 8 },
      { kind: "weaponPart", fromDistance: 35, toDistance: 190, count: 3, maxLateral: 7 },
      { kind: "repairKit", fromDistance: 90, toDistance: 170, count: 1, maxLateral: 7 },
    ],
    encounters: [
      { id: "house.mine-1", kind: "occupiedHouse", distance: 48, lateral: 9, triggerLead: 15, warningSeconds: 1.4, occupants: [{ archetype: "minion", count: 5 }] },
      { id: "house.mine-2", kind: "occupiedHouse", distance: 112, lateral: -9, triggerLead: 15, warningSeconds: 1.4, occupants: [{ archetype: "minion", count: 5 }, { archetype: "warrior", count: 1 }] },
      { id: "house.mine-3", kind: "occupiedHouse", distance: 174, lateral: 9, triggerLead: 16, warningSeconds: 1.5, occupants: [{ archetype: "minion", count: 6 }, { archetype: "warrior", count: 2 }] },
    ],
    modifiers: ["narrow"],
    rewardTable: "fuel",
    destinationId: "checkpoint.settlement",
    objective: {
      kind: "pressure",
      label: "Power two machines for 25 seconds",
      target: 25,
      reward: { kind: "fuel", amount: 20 },
    },
  },

  "seg.flooded": {
    id: "seg.flooded",
    name: "Flooded Works",
    reward: "Steam Flamer and pressure canisters",
    danger: "Water slows foot movement; bridges become attack funnels",
    points: [
      [22, 0, 368], [18, 0, 394], [10, 0, 420], [14, 0, 446],
      [26, 0, 472], [30, 0, 500], [24, 0, 528], [20, 0, 552],
    ],
    lengthMeters: 190,
    recommendedDuration: 152,
    ambientThreatScale: 1,
    weaponUnlock: "flamer",
    blueprintUnlocks: ["barricade"],
    pursuitStartSeconds: 999,
    corridorHalfWidth: 14,
    spawnZones: [
      { fromDistance: 10, toDistance: 190, minLateral: 15, maxLateral: 28, weight: 1.2, minTrail: 0 },
      { fromDistance: 55, toDistance: 190, minLateral: 12, maxLateral: 24, weight: 1.8, minTrail: 40 },
    ],
    resourceZones: [
      { kind: "fuel", fromDistance: 10, toDistance: 180, count: 8, maxLateral: 11 },
      { kind: "scrap", fromDistance: 12, toDistance: 182, count: 15, maxLateral: 12 },
      { kind: "pressureCanister", fromDistance: 40, toDistance: 170, count: 3, maxLateral: 9 },
      { kind: "shockMine", fromDistance: 70, toDistance: 165, count: 2, maxLateral: 10 },
    ],
    waterZones: [
      { fromDistance: 35, toDistance: 48, bridgeHalfWidth: 3.2, channelHalfWidth: 28 },
      { fromDistance: 92, toDistance: 108, bridgeHalfWidth: 3, channelHalfWidth: 30 },
      { fromDistance: 148, toDistance: 163, bridgeHalfWidth: 2.8, channelHalfWidth: 27 },
    ],
    encounters: [
      { id: "house.flooded-pump", kind: "occupiedHouse", distance: 76, lateral: 11, triggerLead: 16, warningSeconds: 1.5, occupants: [{ archetype: "minion", count: 7 }, { archetype: "warrior", count: 1 }] },
      { id: "house.flooded-lock", kind: "occupiedHouse", distance: 138, lateral: -11, triggerLead: 18, warningSeconds: 1.5, occupants: [{ archetype: "minion", count: 8 }, { archetype: "warrior", count: 2 }] },
    ],
    modifiers: ["water", "bridges"],
    rewardTable: "fuel",
    destinationId: "checkpoint.pump",
    objective: {
      kind: "salvage",
      label: "Collect 24 scrap across the flooded works",
      target: 24,
      reward: { kind: "fuel", amount: 24 },
    },
  },

  "seg.floodedShortcut": {
    id: "seg.floodedShortcut",
    name: "Flooded Works — Spillway",
    reward: "More salvage and weapon parts",
    danger: "Fewer safe bridges; stronger ambushes",
    points: [
      [22, 0, 368], [20, 0, 394], [18, 0, 420], [22, 0, 446],
      [20, 0, 472], [24, 0, 500], [22, 0, 528], [20, 0, 552],
    ],
    lengthMeters: 184,
    recommendedDuration: 147,
    ambientThreatScale: 1.22,
    weaponUnlock: "flamer",
    blueprintUnlocks: ["barricade"],
    pursuitStartSeconds: 999,
    corridorHalfWidth: 12,
    spawnZones: [
      { fromDistance: 8, toDistance: 184, minLateral: 13, maxLateral: 23, weight: 1.7, minTrail: 0 },
      { fromDistance: 35, toDistance: 184, minLateral: 11, maxLateral: 20, weight: 2.2, minTrail: 35 },
    ],
    resourceZones: [
      { kind: "scrap", fromDistance: 8, toDistance: 178, count: 22, maxLateral: 10 },
      { kind: "scrapLarge", fromDistance: 30, toDistance: 172, count: 5, maxLateral: 9 },
      { kind: "pressureCanister", fromDistance: 35, toDistance: 168, count: 2, maxLateral: 8 },
      { kind: "weaponPart", fromDistance: 40, toDistance: 165, count: 2, maxLateral: 8 },
      { kind: "shockMine", fromDistance: 70, toDistance: 160, count: 2, maxLateral: 8 },
    ],
    waterZones: [
      { fromDistance: 24, toDistance: 40, bridgeHalfWidth: 2.6, channelHalfWidth: 27 },
      { fromDistance: 65, toDistance: 82, bridgeHalfWidth: 2.5, channelHalfWidth: 29 },
      { fromDistance: 108, toDistance: 126, bridgeHalfWidth: 2.5, channelHalfWidth: 30 },
      { fromDistance: 148, toDistance: 166, bridgeHalfWidth: 2.4, channelHalfWidth: 28 },
    ],
    encounters: [
      { id: "house.spillway-1", kind: "occupiedHouse", distance: 54, lateral: -10, triggerLead: 17, warningSeconds: 1.4, occupants: [{ archetype: "minion", count: 8 }, { archetype: "warrior", count: 2 }] },
      { id: "house.spillway-2", kind: "occupiedHouse", distance: 137, lateral: 10, triggerLead: 18, warningSeconds: 1.5, occupants: [{ archetype: "minion", count: 10 }, { archetype: "warrior", count: 3 }] },
    ],
    modifiers: ["water", "bridges", "swarm"],
    rewardTable: "scrap",
    destinationId: "checkpoint.pump",
    objective: {
      kind: "salvage",
      label: "Collect 36 scrap from the spillway",
      target: 36,
      reward: { kind: "scrap", amount: 28 },
    },
  },

  "seg.scrapyard": {
    id: "seg.scrapyard",
    name: "Rust Yard",
    reward: "Heaps of scrap - build and rebuild freely",
    danger: "More swarms - the noise carries across open ground",
    points: [
      [20, 0, 552],
      [-6, 0, 576],
      [36, 0, 604],
      [-8, 0, 632],
      [38, 0, 660],
      [-6, 0, 688],
      [36, 0, 716],
      [38, 0, 748],
    ],
    lengthMeters: 330,
    recommendedDuration: 264,
    ambientThreatScale: 1.05,
    weaponUnlock: "launcher",
    blueprintUnlocks: ["mine"],
    pursuitStartSeconds: 999,
    corridorHalfWidth: 12,
    spawnZones: [
      { fromDistance: 10, toDistance: 330, minLateral: 14, maxLateral: 17, weight: 1.6, minTrail: 0 },
      { fromDistance: 30, toDistance: 330, minLateral: 13, maxLateral: 17, weight: 2.2, minTrail: 40 },
    ],
    resourceZones: [
      { kind: "scrap", fromDistance: 12, toDistance: 320, count: 26, maxLateral: 10 },
      { kind: "scrapLarge", fromDistance: 30, toDistance: 315, count: 6, maxLateral: 9 },
      { kind: "fuel", fromDistance: 40, toDistance: 305, count: 3, maxLateral: 9 },
      { kind: "armorPlate", fromDistance: 80, toDistance: 290, count: 2, maxLateral: 9 },
      { kind: "weaponPart", fromDistance: 50, toDistance: 300, count: 3, maxLateral: 9 },
    ],
    encounters: [
      { id: "nest.rust-1", kind: "workshopNest", distance: 82, lateral: -9, triggerLead: 18, warningSeconds: 1.5, occupants: [{ archetype: "minion", count: 8 }, { archetype: "warrior", count: 1 }] },
      { id: "nest.rust-2", kind: "workshopNest", distance: 176, lateral: 9, triggerLead: 18, warningSeconds: 1.5, occupants: [{ archetype: "minion", count: 9 }, { archetype: "warrior", count: 2 }] },
      { id: "nest.rust-3", kind: "workshopNest", distance: 272, lateral: -9, triggerLead: 20, warningSeconds: 1.6, occupants: [{ archetype: "minion", count: 10 }, { archetype: "warrior", count: 2 }, { archetype: "golem", count: 1 }] },
    ],
    modifiers: ["swarm", "maze"],
    rewardTable: "scrap",
    destinationId: "checkpoint.gate",
    objective: {
      kind: "nests",
      label: "Destroy all three workshop nests",
      target: 3,
      reward: { kind: "scrap", amount: 24 },
    },
  },

  "seg.escape": {
    id: "seg.escape",
    name: "The Last Gate",
    reward: "The shelter gate",
    danger: "Continuous pursuit",
    points: [
      [38, 0, 748],
      [42, 0, 772],
      [38, 0, 796],
      [28, 0, 818],
      [22, 0, 840],
      [24, 0, 860],
    ],
    lengthMeters: 118,
    recommendedDuration: 100,
    ambientThreatScale: 1.2,
    // Pursuit is forced on this segment regardless of Trail; it is the climax.
    pursuitStartSeconds: 12,
    departureHoldSeconds: 18,
    corridorHalfWidth: 13,
    spawnZones: [
      { fromDistance: 0, toDistance: 118, minLateral: 14, maxLateral: 30, weight: 2.4, minTrail: 0 },
    ],
    resourceZones: [
      { kind: "scrap", fromDistance: 8, toDistance: 100, count: 9, maxLateral: 9 },
      { kind: "fuel", fromDistance: 20, toDistance: 100, count: 3, maxLateral: 9 },
      { kind: "repairKit", fromDistance: 12, toDistance: 80, count: 1, maxLateral: 8 },
    ],
    waterZones: [
      { fromDistance: 58, toDistance: 72, bridgeHalfWidth: 3, channelHalfWidth: 25 },
    ],
    encounters: [
      { id: "nest.gate-hold", kind: "workshopNest", distance: 20, lateral: -10, triggerLead: 24, warningSeconds: 1.2, occupants: [{ archetype: "minion", count: 12 }, { archetype: "warrior", count: 3 }, { archetype: "golem", count: 1 }] },
      { id: "house.gate-flank", kind: "occupiedHouse", distance: 48, lateral: 10, triggerLead: 18, warningSeconds: 1.3, occupants: [{ archetype: "minion", count: 9 }, { archetype: "warrior", count: 2 }] },
    ],
    modifiers: ["pursuit", "water", "bridges"],
    rewardTable: "final",
    destinationId: "gate.final",
    objective: {
      kind: "pursuit",
      label: "Survive 45 seconds of Pursuit",
      target: 45,
      reward: { kind: "core", amount: 35 },
    },
  },
};

export interface CheckpointDefinition {
  id: string;
  name: string;
  /** Seconds the spider stays docked before departing automatically. */
  duration: number;
  /** Segments offered as the next leg. One entry means no choice. */
  nextSegments: string[];
  /** Module ids offered here; empty means none. */
  moduleOffer: string[];
  /** Short stage-completion message shown before checkpoint rewards. */
  arrivalStory?: {
    speaker: string;
    text: string;
  };
}

export const CHECKPOINTS: Record<string, CheckpointDefinition> = {
  "checkpoint.start": {
    id: "checkpoint.start",
    name: "Departure Yard",
    duration: 26,
    nextSegments: ["seg.approach"],
    moduleOffer: [],
  },
  "checkpoint.foundry": {
    id: "checkpoint.foundry",
    name: "Foundry Halt",
    duration: 30,
    nextSegments: ["seg.mine"],
    moduleOffer: [],
    arrivalStory: {
      speaker: "Foundry Keeper Mara",
      text: "Thank you for escorting us to Foundry Halt. The furnaces can breathe again because you held the road. We believe in you—keep the Iron Spider moving.",
    },
  },
  "checkpoint.settlement": {
    id: "checkpoint.settlement",
    name: "Broken Settlement",
    duration: 24,
    nextSegments: ["seg.flooded", "seg.floodedShortcut"],
    moduleOffer: ["module.crane", "module.dorsalTurret"],
    arrivalStory: {
      speaker: "Settlement Watchman",
      text: "You brought us safely through the broken streets. The families here saw your courage, and now they have hope. The next road is harder, but we believe in you.",
    },
  },
  "checkpoint.pump": {
    id: "checkpoint.pump",
    name: "Pump Station",
    duration: 24,
    nextSegments: ["seg.scrapyard"],
    moduleOffer: ["module.boiler", "module.reactiveArmor"],
    arrivalStory: {
      speaker: "Pump Engineer Ilya",
      text: "Thank you for reaching the Pump Station. Fresh water will flow behind you because you refused to stop. Rest for a moment—the whole march is counting on you.",
    },
  },
  "checkpoint.gate": {
    id: "checkpoint.gate",
    name: "Gate Watch",
    duration: 24,
    nextSegments: ["seg.escape"],
    moduleOffer: [],
    arrivalStory: {
      speaker: "Captain of the Gate",
      text: "You carried our last hope to Gate Watch. One final road remains, and every defender is standing because of you. We believe you can bring the Spider home.",
    },
  },
};

export const FINAL_GATE_STORY =
  "You brought the Iron Spider through every road and delivered us safely to the gate. Tonight the lights stay on because of you. Thank you, Engineer—we always believed in you.";

/** Ordered checkpoint chain for the slice. */
export const SLICE_CHECKPOINT_ORDER: readonly string[] = [
  "checkpoint.start",
  "checkpoint.foundry",
  "checkpoint.settlement",
  "checkpoint.pump",
  "checkpoint.gate",
];

export function getSegment(id: string): RouteSegmentDefinition {
  const segment = ROUTE_SEGMENTS[id];
  if (!segment) throw new Error(`Unknown route segment: ${id}`);
  return segment;
}

export function getCheckpoint(id: string): CheckpointDefinition {
  const checkpoint = CHECKPOINTS[id];
  if (!checkpoint) throw new Error(`Unknown checkpoint: ${id}`);
  return checkpoint;
}
