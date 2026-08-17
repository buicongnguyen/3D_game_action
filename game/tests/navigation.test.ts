import { describe, expect, it } from "vitest";
import { NAVIGATION } from "../src/data/balance.ts";
import { FlowField } from "../src/game/navigation/FlowField.ts";
import { NavigationGrid } from "../src/game/navigation/NavigationGrid.ts";
import { SpatialHash } from "../src/game/navigation/SpatialHash.ts";
import {
  avoidObstacles,
  createSteeringScratch,
  separation,
  seek,
  type SteeringAgent,
} from "../src/game/navigation/Steering.ts";

function agent(x: number, z: number, radius = 0.4): SteeringAgent {
  return { x, z, radius };
}

describe("NavigationGrid", () => {
  it("covers the configured extent", () => {
    const grid = new NavigationGrid();
    expect(grid.cellSize).toBe(NAVIGATION.cellSize);
    expect(grid.width).toBe(grid.height);
    expect(grid.width * grid.cellSize).toBeGreaterThanOrEqual(NAVIGATION.gridHalfExtent * 2);
  });

  it("round trips world coordinates through cell indices", () => {
    const grid = new NavigationGrid();
    const half = grid.cellSize * 0.5;
    const samples = [0, 0.4, -0.4, 3.75, -12.6, 41.2, -49.9, 55.05];

    for (const x of samples) {
      for (const z of samples) {
        const index = grid.worldToCell(x, z);
        expect(index).toBeGreaterThanOrEqual(0);

        const cx = grid.cellToWorldX(index);
        const cz = grid.cellToWorldZ(index);
        expect(Math.abs(cx - x)).toBeLessThanOrEqual(half + 1e-9);
        expect(Math.abs(cz - z)).toBeLessThanOrEqual(half + 1e-9);

        expect(grid.worldToCell(cx, cz)).toBe(index);
      }
    }
  });

  it("reports points outside the window as out of bounds", () => {
    const grid = new NavigationGrid();
    expect(grid.inBounds(0, 0)).toBe(true);
    expect(grid.inBounds(1000, 0)).toBe(false);
    expect(grid.worldToCell(0, -1000)).toBe(-1);
    expect(grid.isBlocked(-1)).toBe(true);
    expect(grid.getCost(-1)).toBe(Infinity);
  });

  it("adding then removing an obstacle restores passability", () => {
    const grid = new NavigationGrid();
    const index = grid.worldToCell(10, -6);
    expect(grid.isBlocked(index)).toBe(false);
    expect(grid.getCost(index)).toBe(1);

    grid.addObstacle(10, -6, 1.5, 77);
    expect(grid.isBlocked(index)).toBe(true);
    expect(grid.getCost(index)).toBe(Infinity);
    expect(grid.obstacleCount).toBe(1);

    grid.removeObstacle(77);
    expect(grid.isBlocked(index)).toBe(false);
    expect(grid.getCost(index)).toBe(1);
    expect(grid.obstacleCount).toBe(0);
  });

  it("keeps a cell blocked while any overlapping obstacle remains", () => {
    const grid = new NavigationGrid();
    const index = grid.worldToCell(4, 4);

    grid.addObstacle(4, 4, 1.2, 1);
    grid.addObstacle(4.3, 4.1, 1.2, 2);
    expect(grid.isBlocked(index)).toBe(true);

    grid.removeObstacle(1);
    expect(grid.isBlocked(index)).toBe(true);

    grid.removeObstacle(2);
    expect(grid.isBlocked(index)).toBe(false);
  });

  it("charges extra cost in the soft ring around an obstacle", () => {
    const grid = new NavigationGrid();
    grid.addObstacle(0, 0, 1, 5);

    const ringIndex = grid.worldToCell(2.2, 0);
    expect(grid.isBlocked(ringIndex)).toBe(false);
    expect(grid.getCost(ringIndex)).toBeGreaterThan(1);

    grid.removeObstacle(5);
    expect(grid.getCost(ringIndex)).toBe(1);
  });

  it("clearDynamic keeps static terrain and clearStatic keeps obstacles", () => {
    const grid = new NavigationGrid();
    grid.setStatic(-8, 2, 1.5);
    grid.addObstacle(8, 2, 1.5, 9);

    const staticIndex = grid.worldToCell(-8, 2);
    const dynamicIndex = grid.worldToCell(8, 2);

    grid.clearDynamic();
    expect(grid.isBlocked(staticIndex)).toBe(true);
    expect(grid.isBlocked(dynamicIndex)).toBe(false);

    grid.addObstacle(8, 2, 1.5, 9);
    grid.clearStatic();
    expect(grid.isBlocked(staticIndex)).toBe(false);
    expect(grid.isBlocked(dynamicIndex)).toBe(true);
  });

  it("recenter preserves obstacles in world space", () => {
    const grid = new NavigationGrid();
    grid.setStatic(30, 30, 2);
    grid.addObstacle(32, 28, 1.6, 42);

    expect(grid.isBlocked(grid.worldToCell(30, 30))).toBe(true);
    expect(grid.isBlocked(grid.worldToCell(32, 28))).toBe(true);

    grid.recenter(40, 40);
    expect(grid.originX).toBeGreaterThan(-60);
    expect(grid.isBlocked(grid.worldToCell(30, 30))).toBe(true);
    expect(grid.isBlocked(grid.worldToCell(32, 28))).toBe(true);

    grid.recenter(0, 0);
    expect(grid.isBlocked(grid.worldToCell(30, 30))).toBe(true);
    expect(grid.isBlocked(grid.worldToCell(32, 28))).toBe(true);

    grid.removeObstacle(42);
    expect(grid.isBlocked(grid.worldToCell(32, 28))).toBe(false);
    expect(grid.isBlocked(grid.worldToCell(30, 30))).toBe(true);
  });

  it("re-adding the same obstacle id moves rather than duplicates it", () => {
    const grid = new NavigationGrid();
    grid.addObstacle(0, 0, 1.2, 3);
    grid.addObstacle(20, 0, 1.2, 3);

    expect(grid.obstacleCount).toBe(1);
    expect(grid.isBlocked(grid.worldToCell(0, 0))).toBe(false);
    expect(grid.isBlocked(grid.worldToCell(20, 0))).toBe(true);
  });
});

describe("FlowField", () => {
  const out = { x: 0, z: 0 };

  it("descends toward the goal from several sample points", () => {
    const grid = new NavigationGrid();
    const field = new FlowField(grid);
    field.rebuild(0, 0);

    expect(field.lastRebuildCells).toBeGreaterThan(grid.width * grid.height * 0.9);

    const points = [
      [20, 0],
      [-18, 6],
      [3, -25],
      [-30, -30],
      [14.4, 21.7],
    ];

    for (const [x, z] of points) {
      expect(field.sample(out, x, z)).toBe(true);

      const toGoalX = -x;
      const toGoalZ = -z;
      const length = Math.hypot(toGoalX, toGoalZ);
      const alignment = (out.x * toGoalX + out.z * toGoalZ) / length;
      expect(alignment).toBeGreaterThan(0.9);

      const step = grid.cellSize;
      expect(field.costAt(x + out.x * step, z + out.z * step)).toBeLessThan(field.costAt(x, z));
    }
  });

  it("produces directions that are not snapped to eight octants", () => {
    const grid = new NavigationGrid();
    const field = new FlowField(grid);
    field.rebuild(0, 0);

    const angles = new Set<number>();
    for (let i = 0; i < 24; i++) {
      const t = (i / 24) * Math.PI * 2;
      const x = Math.cos(t) * 17.3;
      const z = Math.sin(t) * 17.3;
      expect(field.sample(out, x, z)).toBe(true);
      angles.add(Math.round(Math.atan2(out.z, out.x) * 100));
    }
    expect(angles.size).toBeGreaterThan(8);
  });

  it("routes around a wall instead of through it", () => {
    const grid = new NavigationGrid();
    // A wall across z = 0 from x = -30 to x = 6, leaving a gap on the right.
    for (let x = -30; x <= 6; x += 0.6) {
      grid.setStatic(x, 0, 0.6);
    }

    const field = new FlowField(grid);
    field.rebuild(0, 14);

    expect(field.sample(out, 0, -12)).toBe(true);
    expect(out.x).toBeGreaterThan(0.2);

    let x = 0;
    let z = -12;
    let reached = false;
    for (let step = 0; step < 900; step++) {
      if (Math.hypot(x - 0, z - 14) < 1.5) {
        reached = true;
        break;
      }
      if (!field.sample(out, x, z)) break;
      if (out.x === 0 && out.z === 0) {
        reached = true;
        break;
      }
      x += out.x * 0.25;
      z += out.z * 0.25;
      expect(grid.isBlocked(grid.worldToCell(x, z))).toBe(false);
    }
    expect(reached).toBe(true);
  });

  it("reports no flow inside a sealed pocket", () => {
    const grid = new NavigationGrid();
    for (let a = 0; a < Math.PI * 2; a += 0.06) {
      grid.setStatic(Math.cos(a) * 6 + 20, Math.sin(a) * 6 + 20, 0.7);
    }

    const field = new FlowField(grid);
    field.rebuild(0, 0);

    expect(field.sample(out, 20, 20)).toBe(false);
    expect(field.costAt(20, 20)).toBe(Infinity);
    expect(field.sample(out, 0, 8)).toBe(true);
  });

  it("falls back to the nearest passable cell when the goal is blocked", () => {
    const grid = new NavigationGrid();
    grid.setStatic(5, 5, 2.5);

    const field = new FlowField(grid);
    field.rebuild(5, 5);

    expect(field.sample(out, 5, -10)).toBe(true);
    expect(out.z).toBeGreaterThan(0.3);
  });

  it("survives a recenter between rebuilds without reading the wrong cells", () => {
    const grid = new NavigationGrid();
    const field = new FlowField(grid);
    field.rebuild(0, 0);

    grid.recenter(200, 0);
    // The stale field still answers in its own frame; the far window does not.
    expect(field.sample(out, 200, 0)).toBe(false);

    field.rebuild(200, 0);
    expect(field.sample(out, 180, 0)).toBe(true);
    expect(out.x).toBeGreaterThan(0.9);
  });
});

describe("SpatialHash", () => {
  it("finds exactly the ids inside a radius and no others", () => {
    const hash = new SpatialHash();
    const xs: number[] = [];
    const zs: number[] = [];

    let value = 12345;
    const next = () => {
      value = (value * 1103515245 + 12345) & 0x7fffffff;
      return value / 0x7fffffff;
    };

    for (let id = 0; id < 400; id++) {
      const x = (next() - 0.5) * 160;
      const z = (next() - 0.5) * 160;
      xs.push(x);
      zs.push(z);
      hash.insert(id, x, z);
    }

    expect(hash.size).toBe(400);
    expect(hash.cellCount).toBeGreaterThan(0);

    const out: number[] = [];
    for (const radius of [1, 3.5, 9, 25]) {
      for (const centre of [
        [0, 0],
        [40, -40],
        [-63, 12],
        [7.5, 7.5],
      ]) {
        const count = hash.query(out, centre[0], centre[1], radius);
        expect(out.length).toBe(count);

        const expected: number[] = [];
        for (let id = 0; id < 400; id++) {
          if (Math.hypot(xs[id] - centre[0], zs[id] - centre[1]) <= radius) expected.push(id);
        }
        expect([...out].sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));
      }
    }
  });

  it("handles negative coordinates without collision leakage", () => {
    const hash = new SpatialHash();
    hash.insert(1, -100.25, -100.25);
    hash.insert(2, 100.25, 100.25);
    hash.insert(3, -100.75, -99.9);

    const out: number[] = [];
    expect(hash.query(out, -100.25, -100.25, 1)).toBe(2);
    expect([...out].sort()).toEqual([1, 3]);

    expect(hash.query(out, 100.25, 100.25, 1)).toBe(1);
    expect(out[0]).toBe(2);
  });

  it("clear empties the structure and truncates reused output arrays", () => {
    const hash = new SpatialHash();
    for (let id = 0; id < 50; id++) hash.insert(id, id * 0.5, 0);

    const out: number[] = [];
    expect(hash.query(out, 0, 0, 100)).toBe(50);
    expect(out.length).toBe(50);

    hash.clear();
    expect(hash.size).toBe(0);
    expect(hash.query(out, 0, 0, 100)).toBe(0);
    expect(out.length).toBe(0);
  });

  it("grows past its initial capacity", () => {
    const hash = new SpatialHash();
    for (let id = 0; id < 1500; id++) hash.insert(id, (id % 40) * 2, Math.floor(id / 40) * 2);

    const out: number[] = [];
    expect(hash.query(out, 0, 0, 500)).toBe(1500);
  });
});

describe("Steering", () => {
  const out = { x: 0, z: 0 };

  it("seek produces a desired velocity at max speed", () => {
    seek(out, 0, 0, 3, 4, 6);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(6, 6);
    expect(out.x).toBeCloseTo(3.6, 6);
    expect(out.z).toBeCloseTo(4.8, 6);

    seek(out, 2, 2, 2, 2, 6);
    expect(out.x).toBe(0);
    expect(out.z).toBe(0);
  });

  it("separation pushes two coincident agents apart", () => {
    const a = agent(5, 5);
    const b = agent(5, 5);
    const agents: SteeringAgent[] = [a, b];
    const neighbours = [0, 1];

    const pushA = { x: 0, z: 0 };
    const pushB = { x: 0, z: 0 };

    expect(separation(pushA, a, neighbours, 2, agents, NAVIGATION.separationRadius, 4)).toBe(1);
    expect(separation(pushB, b, neighbours, 2, agents, NAVIGATION.separationRadius, 4)).toBe(1);

    expect(Math.hypot(pushA.x, pushA.z)).toBeCloseTo(4, 6);
    expect(Math.hypot(pushB.x, pushB.z)).toBeCloseTo(4, 6);
    // Different tie-break directions, so the pair actually separates.
    expect(pushA.x * pushB.x + pushA.z * pushB.z).toBeLessThan(4 * 4 - 1e-6);

    a.x += pushA.x * 0.1;
    a.z += pushA.z * 0.1;
    b.x += pushB.x * 0.1;
    b.z += pushB.z * 0.1;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.05);
  });

  it("separation points away from a crowding neighbour and ignores distant ones", () => {
    const self = agent(0, 0);
    const near = agent(0.5, 0);
    const far = agent(20, 0);
    const agents: SteeringAgent[] = [self, near, far];

    expect(separation(out, self, [0, 1, 2], 3, agents, NAVIGATION.separationRadius, 5)).toBe(1);
    expect(out.x).toBeLessThan(0);
    expect(Math.abs(out.z)).toBeLessThan(1e-9);

    expect(separation(out, self, [0, 2], 2, agents, NAVIGATION.separationRadius, 5)).toBe(0);
    expect(out.x).toBe(0);
    expect(out.z).toBe(0);
  });

  it("obstacle avoidance steers away from a blocked cell and is silent in the open", () => {
    const grid = new NavigationGrid();
    expect(avoidObstacles(out, grid, 0, 0, 0, 1, 2, 4)).toBe(false);
    expect(out.x).toBe(0);
    expect(out.z).toBe(0);

    grid.addObstacle(0, 1.6, 1, 1);
    expect(avoidObstacles(out, grid, 0, 0, 0, 1, 2, 4)).toBe(true);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(4, 6);
    expect(out.z).toBeLessThan(0.5);
  });

  it("scratch objects are reusable and independent", () => {
    const scratch = createSteeringScratch();
    seek(scratch.seek, 0, 0, 1, 0, 2);
    expect(scratch.seek.x).toBeCloseTo(2, 6);
    expect(scratch.separation.x).toBe(0);
    expect(scratch.avoid.x).toBe(0);
  });
});
