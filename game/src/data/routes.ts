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
    ],
    encounters: [
      { id: "house.departure-cache", kind: "emptyHouse", distance: 78, lateral: -11, triggerLead: 0, warningSeconds: 0, occupants: [] },
    ],
    modifiers: [],
    rewardTable: "basic",
    destinationId: "checkpoint.foundry",
    objective: {
      kind: "recover",
      label: "Recover one field machine",
      target: 1,
      reward: { kind: "scrap", amount: 12 },
    },
  },

  "seg.mine": {
    id: "seg.mine",
    name: "Coal Mine Cut",
    reward: "Abundant fuel - jerrycans and barrels line the cut",
    danger: "Narrow corridor - nowhere to fall back to",
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
    ],
    encounters: [
      { id: "house.mine-1", kind: "occupiedHouse", distance: 48, lateral: 9, triggerLead: 15, warningSeconds: 1.4, occupants: [{ archetype: "minion", count: 5 }] },
      { id: "house.mine-2", kind: "occupiedHouse", distance: 112, lateral: -9, triggerLead: 15, warningSeconds: 1.4, occupants: [{ archetype: "minion", count: 5 }, { archetype: "warrior", count: 1 }] },
      { id: "house.mine-3", kind: "occupiedHouse", distance: 174, lateral: 9, triggerLead: 16, warningSeconds: 1.5, occupants: [{ archetype: "minion", count: 6 }, { archetype: "warrior", count: 2 }] },
    ],
    modifiers: ["narrow"],
    rewardTable: "fuel",
    destinationId: "checkpoint.gate",
    objective: {
      kind: "pressure",
      label: "Power two machines for 25 seconds",
      target: 25,
      reward: { kind: "fuel", amount: 20 },
    },
  },

  "seg.scrapyard": {
    id: "seg.scrapyard",
    name: "Rust Yard",
    reward: "Heaps of scrap - build and rebuild freely",
    danger: "More swarms - the noise carries across open ground",
    points: [
      [4, 0, 172],
      [-22, 0, 196],
      [20, 0, 224],
      [-24, 0, 252],
      [22, 0, 280],
      [-22, 0, 308],
      [20, 0, 336],
      [22, 0, 368],
    ],
    lengthMeters: 330,
    recommendedDuration: 264,
    ambientThreatScale: 1.05,
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
      kind: "salvage",
      label: "Collect 30 scrap on this leg",
      target: 30,
      reward: { kind: "scrap", amount: 24 },
    },
  },

  "seg.escape": {
    id: "seg.escape",
    name: "The Last Gate",
    reward: "The shelter gate",
    danger: "Continuous pursuit",
    points: [
      [22, 0, 368],
      [26, 0, 392],
      [22, 0, 416],
      [12, 0, 438],
      [6, 0, 460],
      [8, 0, 480],
    ],
    lengthMeters: 118,
    recommendedDuration: 100,
    ambientThreatScale: 1.2,
    // Pursuit is forced on this segment regardless of Trail; it is the climax.
    pursuitStartSeconds: 12,
    corridorHalfWidth: 13,
    spawnZones: [
      { fromDistance: 0, toDistance: 118, minLateral: 14, maxLateral: 30, weight: 2.4, minTrail: 0 },
    ],
    resourceZones: [
      { kind: "scrap", fromDistance: 8, toDistance: 100, count: 9, maxLateral: 9 },
      { kind: "fuel", fromDistance: 20, toDistance: 100, count: 3, maxLateral: 9 },
    ],
    modifiers: ["pursuit"],
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
    nextSegments: ["seg.mine", "seg.scrapyard"],
    moduleOffer: ["module.crane", "module.dorsalTurret"],
  },
  "checkpoint.gate": {
    id: "checkpoint.gate",
    name: "Gate Watch",
    duration: 24,
    nextSegments: ["seg.escape"],
    moduleOffer: [],
  },
};

/** Ordered checkpoint chain for the slice. */
export const SLICE_CHECKPOINT_ORDER: readonly string[] = [
  "checkpoint.start",
  "checkpoint.foundry",
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
