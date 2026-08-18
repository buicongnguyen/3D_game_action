import type { RouteSegmentDefinition } from "../core/types.ts";

/**
 * Authored route for the vertical slice.
 *
 * Layout: opening stretch -> safe stop -> two-way fork -> final escape.
 * At the spider's 1.25 m/s march speed the total is roughly 8.5-9.5 minutes,
 * which is the Stage 5 target. Splines stay a compact corridor with short side
 * pockets; nothing here invites the player to leave the spider behind.
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
      [6, 0, 52],
      [10, 0, 78],
      [4, 0, 104],
      [-6, 0, 128],
      [-4, 0, 152],
      [4, 0, 172],
    ],
    lengthMeters: 176,
    recommendedDuration: 140,
    pursuitStartSeconds: 999,
    corridorHalfWidth: 15,
    spawnZones: [
      { fromDistance: 20, toDistance: 176, minLateral: 16, maxLateral: 34, weight: 1, minTrail: 0 },
      { fromDistance: 70, toDistance: 176, minLateral: 12, maxLateral: 28, weight: 1.4, minTrail: 25 },
    ],
    resourceZones: [
      { kind: "scrap", fromDistance: 14, toDistance: 170, count: 16, maxLateral: 12 },
      { kind: "scrapLarge", fromDistance: 40, toDistance: 160, count: 3, maxLateral: 11 },
      { kind: "fuel", fromDistance: 30, toDistance: 165, count: 4, maxLateral: 11 },
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
      [-8, 0, 196],
      [-20, 0, 222],
      [-24, 0, 250],
      [-16, 0, 276],
      [-4, 0, 300],
      [2, 0, 326],
      [10, 0, 348],
      [22, 0, 368],
    ],
    lengthMeters: 214,
    recommendedDuration: 172,
    pursuitStartSeconds: 999,
    corridorHalfWidth: 18,
    spawnZones: [
      { fromDistance: 10, toDistance: 214, minLateral: 18, maxLateral: 36, weight: 1.6, minTrail: 0 },
      { fromDistance: 30, toDistance: 214, minLateral: 14, maxLateral: 30, weight: 2.2, minTrail: 40 },
    ],
    resourceZones: [
      { kind: "scrap", fromDistance: 12, toDistance: 206, count: 26, maxLateral: 14 },
      { kind: "scrapLarge", fromDistance: 30, toDistance: 200, count: 6, maxLateral: 13 },
      { kind: "fuel", fromDistance: 40, toDistance: 190, count: 3, maxLateral: 12 },
    ],
    modifiers: ["swarm"],
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
