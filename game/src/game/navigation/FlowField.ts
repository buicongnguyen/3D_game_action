import type { NavigationGrid } from "./NavigationGrid.ts";

/**
 * A shared integration field plus direction field over the navigation grid.
 *
 * One sweep serves the whole horde: 260 agents read the same field instead of
 * running 260 A* searches. The sweep is a queue-relaxed Dijkstra over the grid
 * — every cell is popped, its eight neighbours relaxed, and improved cells are
 * re-queued. Because grid costs sit in a narrow band (1 to 5) the queue drains
 * in little more than one pass, so the whole rebuild is effectively O(cells).
 *
 * Every buffer is allocated once in the constructor. `rebuild` allocates
 * nothing, and neither does `sample`.
 *
 * The field snapshots the grid's window origin at rebuild time and samples
 * against that snapshot, so a `NavigationGrid.recenter` between rebuilds
 * degrades gracefully (points that fell out of the snapshot report no flow)
 * rather than silently reading the wrong cells.
 */

/** Cardinal first, then diagonals; the loop relies on indices 4..7 being diagonal. */
const OFFSET_X = new Int32Array([1, -1, 0, 0, 1, 1, -1, -1]);
const OFFSET_Z = new Int32Array([0, 0, 1, -1, 1, -1, 1, -1]);
const SQRT2 = Math.SQRT2;

/** Cost charged to a blocked or unreached neighbour when taking the gradient. */
const WALL_PENALTY_CELLS = 6;

/** Cells the goal search will spiral through when the goal itself is blocked. */
const GOAL_SEARCH_RADIUS = 8;

const EPSILON = 1e-4;

export class FlowField {
  private readonly grid: NavigationGrid;
  private readonly width: number;
  private readonly height: number;
  private readonly total: number;

  private readonly cost: Float32Array;
  private readonly dirX: Float32Array;
  private readonly dirZ: Float32Array;
  private readonly has: Uint8Array;
  private readonly queue: Int32Array;
  private readonly inQueue: Uint8Array;
  private readonly stepLength: Float64Array;

  /** Window origin captured at the last rebuild. */
  private fieldMinX = 0;
  private fieldMinZ = 0;
  private cellSize: number;
  private rebuildCells = 0;
  private valid = false;

  constructor(grid: NavigationGrid) {
    this.grid = grid;
    this.width = grid.width;
    this.height = grid.height;
    this.total = grid.width * grid.height;
    this.cellSize = grid.cellSize;

    this.cost = new Float32Array(this.total);
    this.dirX = new Float32Array(this.total);
    this.dirZ = new Float32Array(this.total);
    this.has = new Uint8Array(this.total);
    this.queue = new Int32Array(this.total + 1);
    this.inQueue = new Uint8Array(this.total);

    this.stepLength = new Float64Array(8);
    for (let k = 0; k < 8; k++) {
      this.stepLength[k] = k < 4 ? this.cellSize : this.cellSize * SQRT2;
    }

    this.cost.fill(Infinity);
    this.fieldMinX = grid.originX;
    this.fieldMinZ = grid.originZ;
  }

  /** Cells popped during the last rebuild; for the debug overlay. */
  get lastRebuildCells(): number {
    return this.rebuildCells;
  }

  /** Rebuilds toward a goal. Uses a bucketed/Dijkstra sweep, NOT per-agent A*. */
  rebuild(goalX: number, goalZ: number): void {
    const grid = this.grid;
    const width = this.width;
    const height = this.height;
    const cost = this.cost;
    const has = this.has;
    const inQueue = this.inQueue;
    const queue = this.queue;
    const capacity = this.total + 1;

    this.cellSize = grid.cellSize;
    this.fieldMinX = grid.originX;
    this.fieldMinZ = grid.originZ;
    this.rebuildCells = 0;

    cost.fill(Infinity);
    has.fill(0);
    inQueue.fill(0);

    const goal = this.resolveGoalCell(goalX, goalZ);
    if (goal < 0) {
      this.dirX.fill(0);
      this.dirZ.fill(0);
      this.valid = false;
      return;
    }
    this.valid = true;

    cost[goal] = 0;
    inQueue[goal] = 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = goal;

    let pops = 0;
    while (head !== tail) {
      const cell = queue[head++];
      if (head === capacity) head = 0;
      inQueue[cell] = 0;
      pops++;

      const base = cost[cell];
      const cx = cell % width;
      const cz = (cell / width) | 0;

      for (let k = 0; k < 8; k++) {
        const nx = cx + OFFSET_X[k];
        if (nx < 0 || nx >= width) continue;
        const nz = cz + OFFSET_Z[k];
        if (nz < 0 || nz >= height) continue;

        const neighbour = nz * width + nx;
        const cellCost = grid.getCost(neighbour);
        if (cellCost === Infinity) continue;

        if (k >= 4 && (grid.isBlocked(cz * width + nx) || grid.isBlocked(nz * width + cx))) {
          continue;
        }

        const candidate = base + this.stepLength[k] * cellCost;
        if (candidate < cost[neighbour] - EPSILON) {
          cost[neighbour] = candidate;
          if (inQueue[neighbour] === 0) {
            inQueue[neighbour] = 1;
            queue[tail++] = neighbour;
            if (tail === capacity) tail = 0;
          }
        }
      }
    }

    this.rebuildCells = pops;
    this.buildDirections();
  }

  /** Writes a unit direction into out. Returns false if the cell has no flow. */
  sample(out: { x: number; z: number }, worldX: number, worldZ: number): boolean {
    out.x = 0;
    out.z = 0;
    if (!this.valid) return false;

    const fx = (worldX - this.fieldMinX) / this.cellSize - 0.5;
    const fz = (worldZ - this.fieldMinZ) / this.cellSize - 0.5;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;

    const width = this.width;
    const height = this.height;
    const has = this.has;
    const dirX = this.dirX;
    const dirZ = this.dirZ;

    let ax = 0;
    let az = 0;
    let weightSum = 0;

    for (let j = 0; j < 2; j++) {
      const cz = z0 + j;
      if (cz < 0 || cz >= height) continue;
      const wz = j === 0 ? 1 - tz : tz;
      if (wz <= 0) continue;
      const row = cz * width;
      for (let i = 0; i < 2; i++) {
        const cx = x0 + i;
        if (cx < 0 || cx >= width) continue;
        const wx = i === 0 ? 1 - tx : tx;
        if (wx <= 0) continue;
        const cell = row + cx;
        if (has[cell] === 0) continue;
        const w = wx * wz;
        ax += dirX[cell] * w;
        az += dirZ[cell] * w;
        weightSum += w;
      }
    }

    if (weightSum <= 0) return false;

    const length = Math.sqrt(ax * ax + az * az);
    // A zero-length blend means the sample sits on the goal itself, which is a
    // legitimate "you have arrived" answer rather than a missing field.
    if (length < 1e-6) return true;
    out.x = ax / length;
    out.z = az / length;
    return true;
  }

  /** Integrated cost at a world point; used for target scoring. */
  costAt(worldX: number, worldZ: number): number {
    if (!this.valid) return Infinity;

    const fx = (worldX - this.fieldMinX) / this.cellSize - 0.5;
    const fz = (worldZ - this.fieldMinZ) / this.cellSize - 0.5;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;

    const width = this.width;
    const height = this.height;
    const has = this.has;
    const cost = this.cost;

    let accumulated = 0;
    let weightSum = 0;

    for (let j = 0; j < 2; j++) {
      const cz = z0 + j;
      if (cz < 0 || cz >= height) continue;
      const wz = j === 0 ? 1 - tz : tz;
      if (wz <= 0) continue;
      const row = cz * width;
      for (let i = 0; i < 2; i++) {
        const cx = x0 + i;
        if (cx < 0 || cx >= width) continue;
        const wx = i === 0 ? 1 - tx : tx;
        if (wx <= 0) continue;
        const cell = row + cx;
        if (has[cell] === 0) continue;
        const w = wx * wz;
        accumulated += cost[cell] * w;
        weightSum += w;
      }
    }

    if (weightSum <= 0) return Infinity;
    return accumulated / weightSum;
  }

  /** True when a point lies inside the reachable part of the current field. */
  hasFlowAt(worldX: number, worldZ: number): boolean {
    if (!this.valid) return false;
    const cx = Math.floor((worldX - this.fieldMinX) / this.cellSize);
    if (cx < 0 || cx >= this.width) return false;
    const cz = Math.floor((worldZ - this.fieldMinZ) / this.cellSize);
    if (cz < 0 || cz >= this.height) return false;
    return this.has[cz * this.width + cx] !== 0;
  }

  /**
   * Clamps the goal into the window and, if it landed on a blocked cell, walks
   * outward for the nearest passable one. Returns -1 when nothing is reachable.
   */
  private resolveGoalCell(goalX: number, goalZ: number): number {
    const grid = this.grid;
    const width = this.width;
    const height = this.height;

    const rawX = Math.floor((goalX - this.fieldMinX) / this.cellSize);
    const rawZ = Math.floor((goalZ - this.fieldMinZ) / this.cellSize);
    const gx = rawX < 0 ? 0 : rawX >= width ? width - 1 : rawX;
    const gz = rawZ < 0 ? 0 : rawZ >= height ? height - 1 : rawZ;

    const direct = gz * width + gx;
    if (!grid.isBlocked(direct)) return direct;

    for (let ring = 1; ring <= GOAL_SEARCH_RADIUS; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        const cz = gz + dz;
        if (cz < 0 || cz >= height) continue;
        const edge = Math.abs(dz) === ring;
        const stride = edge ? 1 : ring * 2;
        for (let dx = -ring; dx <= ring; dx += stride) {
          const cx = gx + dx;
          if (cx < 0 || cx >= width) continue;
          const cell = cz * width + cx;
          if (!grid.isBlocked(cell)) return cell;
        }
      }
    }
    return -1;
  }

  /**
   * Turns the integration field into a per-cell unit direction using a central
   * difference of the cost. A gradient rather than a "cheapest of eight
   * neighbours" pick is what stops the horde snapping to octant directions;
   * bilinear sampling then smooths what is left.
   */
  private buildDirections(): void {
    const width = this.width;
    const height = this.height;
    const cost = this.cost;
    const dirX = this.dirX;
    const dirZ = this.dirZ;
    const has = this.has;
    const wallPenalty = this.cellSize * WALL_PENALTY_CELLS;

    for (let cz = 0; cz < height; cz++) {
      const row = cz * width;
      for (let cx = 0; cx < width; cx++) {
        const cell = row + cx;
        const here = cost[cell];
        if (here === Infinity) {
          has[cell] = 0;
          dirX[cell] = 0;
          dirZ[cell] = 0;
          continue;
        }
        has[cell] = 1;

        const wall = here + wallPenalty;
        const west = cx > 0 && cost[cell - 1] !== Infinity ? cost[cell - 1] : wall;
        const east = cx < width - 1 && cost[cell + 1] !== Infinity ? cost[cell + 1] : wall;
        const south = cz > 0 && cost[cell - width] !== Infinity ? cost[cell - width] : wall;
        const north = cz < height - 1 && cost[cell + width] !== Infinity ? cost[cell + width] : wall;

        let gx = west - east;
        let gz = south - north;
        let length = Math.sqrt(gx * gx + gz * gz);

        if (length < 1e-6) {
          let bestCost = here;
          let bestK = -1;
          for (let k = 0; k < 8; k++) {
            const nx = cx + OFFSET_X[k];
            if (nx < 0 || nx >= width) continue;
            const nz = cz + OFFSET_Z[k];
            if (nz < 0 || nz >= height) continue;
            const nc = cost[nz * width + nx];
            if (nc < bestCost - EPSILON) {
              bestCost = nc;
              bestK = k;
            }
          }
          if (bestK < 0) {
            dirX[cell] = 0;
            dirZ[cell] = 0;
            continue;
          }
          gx = OFFSET_X[bestK];
          gz = OFFSET_Z[bestK];
          length = Math.sqrt(gx * gx + gz * gz);
        }

        dirX[cell] = gx / length;
        dirZ[cell] = gz / length;
      }
    }
  }
}
