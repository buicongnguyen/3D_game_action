import { NAVIGATION } from "../../data/balance.ts";

/**
 * A sliding-window occupancy and cost grid for horde navigation.
 *
 * The window is a fixed square of cells that follows a focus point, so the
 * simulation can march kilometres down a route while the grid stays a constant,
 * cache-friendly allocation. Obstacles are registered in *world* space and
 * re-stamped whenever the window slides, which is what keeps a barricade placed
 * 40 m back still blocking once the spider has moved on.
 */

const CELL_SIZE = NAVIGATION.cellSize;

/** Square window side in cells, forced even so the focus sits on a boundary. */
const RAW_DIM = Math.max(2, Math.round((NAVIGATION.gridHalfExtent * 2) / CELL_SIZE));
const DIM = RAW_DIM % 2 === 0 ? RAW_DIM : RAW_DIM + 1;
const TOTAL = DIM * DIM;

/**
 * The window origin snaps to this many cells. Without the snap every metre of
 * spider travel would trigger a full re-stamp; with it the focus still stays
 * within a couple of metres of centre while the window has 60 m of margin.
 */
const SNAP_CELLS = 4;

/** Obstacles are inflated by roughly one agent radius before blocking cells. */
const BLOCK_INFLATE = CELL_SIZE * 0.35;

/** Width of the soft ring outside the blocked core that merely costs more. */
const SOFT_MARGIN = CELL_SIZE * 1.2;

const SOFT_COST_PER_STAMP = 0.75;
const MAX_SOFT_COST = 4;

export class NavigationGrid {
  readonly cellSize = CELL_SIZE;
  readonly width = DIM;
  readonly height = DIM;
  readonly cellCount = TOTAL;

  /** Static terrain blockers. A flag, not a count: only `clearStatic` removes. */
  private readonly staticBlocked = new Uint8Array(TOTAL);
  /** Overlapping dynamic stamps, so removing one obstacle cannot free another. */
  private readonly dynamicCount = new Uint16Array(TOTAL);
  private readonly nearStatic = new Uint16Array(TOTAL);
  private readonly nearDynamic = new Uint16Array(TOTAL);

  private readonly obstacleIds: number[] = [];
  private readonly obstacleX: number[] = [];
  private readonly obstacleZ: number[] = [];
  private readonly obstacleR: number[] = [];
  private readonly obstacleSlots = new Map<number, number>();

  private readonly staticX: number[] = [];
  private readonly staticZ: number[] = [];
  private readonly staticR: number[] = [];
  private readonly staticBoxX: number[] = [];
  private readonly staticBoxZ: number[] = [];
  private readonly staticBoxHalfX: number[] = [];
  private readonly staticBoxHalfZ: number[] = [];
  private readonly staticBoxHeading: number[] = [];

  private originCellX = 0;
  private originCellZ = 0;
  private minX = 0;
  private minZ = 0;

  /** Incremented whenever the window slides, so caches can invalidate. */
  private revisionCounter = 0;

  constructor() {
    const half = DIM >> 1;
    this.originCellX = snap(-half);
    this.originCellZ = snap(-half);
    this.minX = this.originCellX * CELL_SIZE;
    this.minZ = this.originCellZ * CELL_SIZE;
  }

  /** World X of the window's minimum corner. */
  get originX(): number {
    return this.minX;
  }

  /** World Z of the window's minimum corner. */
  get originZ(): number {
    return this.minZ;
  }

  get revision(): number {
    return this.revisionCounter;
  }

  recenter(worldX: number, worldZ: number): void {
    const half = DIM >> 1;
    const cellX = snap(Math.floor(worldX / CELL_SIZE) - half);
    const cellZ = snap(Math.floor(worldZ / CELL_SIZE) - half);
    if (cellX === this.originCellX && cellZ === this.originCellZ) return;

    this.originCellX = cellX;
    this.originCellZ = cellZ;
    this.minX = cellX * CELL_SIZE;
    this.minZ = cellZ * CELL_SIZE;
    this.revisionCounter++;

    this.staticBlocked.fill(0);
    this.dynamicCount.fill(0);
    this.nearStatic.fill(0);
    this.nearDynamic.fill(0);

    for (let i = 0; i < this.staticX.length; i++) {
      this.stampCircle(this.staticX[i], this.staticZ[i], this.staticR[i], false, 1);
    }
    for (let i = 0; i < this.staticBoxX.length; i++) {
      this.stampStaticBox(
        this.staticBoxX[i], this.staticBoxZ[i], this.staticBoxHalfX[i],
        this.staticBoxHalfZ[i], this.staticBoxHeading[i],
      );
    }
    for (let i = 0; i < this.obstacleIds.length; i++) {
      this.stampCircle(this.obstacleX[i], this.obstacleZ[i], this.obstacleR[i], true, 1);
    }
  }

  worldToCell(worldX: number, worldZ: number): number {
    const cx = Math.floor((worldX - this.minX) / CELL_SIZE);
    if (cx < 0 || cx >= DIM) return -1;
    const cz = Math.floor((worldZ - this.minZ) / CELL_SIZE);
    if (cz < 0 || cz >= DIM) return -1;
    return cz * DIM + cx;
  }

  cellToWorldX(index: number): number {
    return this.minX + ((index % DIM) + 0.5) * CELL_SIZE;
  }

  cellToWorldZ(index: number): number {
    return this.minZ + (((index / DIM) | 0) + 0.5) * CELL_SIZE;
  }

  isBlocked(index: number): boolean {
    if (index < 0 || index >= TOTAL) return true;
    return this.staticBlocked[index] !== 0 || this.dynamicCount[index] !== 0;
  }

  /**
   * True when a circle of `radius` centred on the world point overlaps any
   * blocked cell. Used by player movement and placement validation, which both
   * reason about a footprint rather than a point.
   *
   * A point outside the sliding window is treated as free: the window is much
   * larger than the corridor, so anything outside it is open ground, and
   * treating it as blocked would trap the engineer against an invisible wall.
   */
  isBlockedCircle(worldX: number, worldZ: number, radius: number): boolean {
    const minCx = Math.floor((worldX - radius - this.minX) / CELL_SIZE);
    const maxCx = Math.floor((worldX + radius - this.minX) / CELL_SIZE);
    const minCz = Math.floor((worldZ - radius - this.minZ) / CELL_SIZE);
    const maxCz = Math.floor((worldZ + radius - this.minZ) / CELL_SIZE);
    if (maxCx < 0 || minCx >= DIM || maxCz < 0 || minCz >= DIM) return false;

    // Half-diagonal expands the cell centre into its square footprint.
    const reach = radius + CELL_SIZE * Math.SQRT1_2;
    const reachSq = reach * reach;
    const startCx = minCx < 0 ? 0 : minCx;
    const endCx = maxCx >= DIM ? DIM - 1 : maxCx;
    const startCz = minCz < 0 ? 0 : minCz;
    const endCz = maxCz >= DIM ? DIM - 1 : maxCz;

    for (let cz = startCz; cz <= endCz; cz++) {
      const rowBase = cz * DIM;
      const cellZ = this.minZ + (cz + 0.5) * CELL_SIZE;
      for (let cx = startCx; cx <= endCx; cx++) {
        const index = rowBase + cx;
        if (this.staticBlocked[index] === 0 && this.dynamicCount[index] === 0) continue;
        const cellX = this.minX + (cx + 0.5) * CELL_SIZE;
        const dx = cellX - worldX;
        const dz = cellZ - worldZ;
        if (dx * dx + dz * dz <= reachSq) return true;
      }
    }
    return false;
  }

  /** Cost multiplier for traversal; Infinity means impassable. */
  getCost(index: number): number {
    if (index < 0 || index >= TOTAL) return Infinity;
    if (this.staticBlocked[index] !== 0 || this.dynamicCount[index] !== 0) return Infinity;
    const stamps = this.nearStatic[index] + this.nearDynamic[index];
    if (stamps === 0) return 1;
    const extra = stamps * SOFT_COST_PER_STAMP;
    return 1 + (extra > MAX_SOFT_COST ? MAX_SOFT_COST : extra);
  }

  /** Stamps a circular obstacle. Used for rocks, ruins, barricades. */
  addObstacle(worldX: number, worldZ: number, radius: number, id: number): void {
    const existing = this.obstacleSlots.get(id);
    if (existing !== undefined) this.removeObstacle(id);

    const slot = this.obstacleIds.length;
    this.obstacleIds.push(id);
    this.obstacleX.push(worldX);
    this.obstacleZ.push(worldZ);
    this.obstacleR.push(radius);
    this.obstacleSlots.set(id, slot);
    this.stampCircle(worldX, worldZ, radius, true, 1);
  }

  removeObstacle(id: number): void {
    const slot = this.obstacleSlots.get(id);
    if (slot === undefined) return;

    this.stampCircle(this.obstacleX[slot], this.obstacleZ[slot], this.obstacleR[slot], true, -1);
    this.obstacleSlots.delete(id);

    const last = this.obstacleIds.length - 1;
    if (slot !== last) {
      this.obstacleIds[slot] = this.obstacleIds[last];
      this.obstacleX[slot] = this.obstacleX[last];
      this.obstacleZ[slot] = this.obstacleZ[last];
      this.obstacleR[slot] = this.obstacleR[last];
      this.obstacleSlots.set(this.obstacleIds[slot], slot);
    }
    this.obstacleIds.length = last;
    this.obstacleX.length = last;
    this.obstacleZ.length = last;
    this.obstacleR.length = last;
  }

  /** Clears all dynamic obstacles but keeps static terrain. */
  clearDynamic(): void {
    this.dynamicCount.fill(0);
    this.nearDynamic.fill(0);
    this.obstacleIds.length = 0;
    this.obstacleX.length = 0;
    this.obstacleZ.length = 0;
    this.obstacleR.length = 0;
    this.obstacleSlots.clear();
  }

  /** Marks static terrain blockers for the current segment. */
  setStatic(worldX: number, worldZ: number, radius: number): void {
    this.staticX.push(worldX);
    this.staticZ.push(worldZ);
    this.staticR.push(radius);
    this.stampCircle(worldX, worldZ, radius, false, 1);
  }

  /** Marks an oriented rectangular blocker matching long walls and buildings. */
  setStaticBox(
    worldX: number,
    worldZ: number,
    halfWidth: number,
    halfDepth: number,
    heading: number,
  ): void {
    this.staticBoxX.push(worldX);
    this.staticBoxZ.push(worldZ);
    this.staticBoxHalfX.push(halfWidth);
    this.staticBoxHalfZ.push(halfDepth);
    this.staticBoxHeading.push(heading);
    this.stampStaticBox(worldX, worldZ, halfWidth, halfDepth, heading);
  }

  clearStatic(): void {
    this.staticBlocked.fill(0);
    this.nearStatic.fill(0);
    this.staticX.length = 0;
    this.staticZ.length = 0;
    this.staticR.length = 0;
    this.staticBoxX.length = 0;
    this.staticBoxZ.length = 0;
    this.staticBoxHalfX.length = 0;
    this.staticBoxHalfZ.length = 0;
    this.staticBoxHeading.length = 0;
  }

  inBounds(worldX: number, worldZ: number): boolean {
    return this.worldToCell(worldX, worldZ) >= 0;
  }

  /** Number of obstacles currently registered, for the debug overlay. */
  get obstacleCount(): number {
    return this.obstacleIds.length;
  }

  private stampCircle(
    worldX: number,
    worldZ: number,
    radius: number,
    dynamic: boolean,
    delta: number,
  ): void {
    const blockR = radius + BLOCK_INFLATE;
    const softR = blockR + SOFT_MARGIN;
    const blockSq = blockR * blockR;
    const softSq = softR * softR;

    let minCX = Math.floor((worldX - softR - this.minX) / CELL_SIZE);
    let maxCX = Math.floor((worldX + softR - this.minX) / CELL_SIZE);
    let minCZ = Math.floor((worldZ - softR - this.minZ) / CELL_SIZE);
    let maxCZ = Math.floor((worldZ + softR - this.minZ) / CELL_SIZE);
    if (maxCX < 0 || maxCZ < 0 || minCX >= DIM || minCZ >= DIM) return;
    if (minCX < 0) minCX = 0;
    if (minCZ < 0) minCZ = 0;
    if (maxCX >= DIM) maxCX = DIM - 1;
    if (maxCZ >= DIM) maxCZ = DIM - 1;

    for (let cz = minCZ; cz <= maxCZ; cz++) {
      const pz = this.minZ + (cz + 0.5) * CELL_SIZE;
      const dz = pz - worldZ;
      const row = cz * DIM;
      for (let cx = minCX; cx <= maxCX; cx++) {
        const px = this.minX + (cx + 0.5) * CELL_SIZE;
        const dx = px - worldX;
        const d2 = dx * dx + dz * dz;
        if (d2 > softSq) continue;
        const index = row + cx;
        if (d2 <= blockSq) {
          if (!dynamic) {
            this.staticBlocked[index] = 1;
          } else if (delta > 0) {
            this.dynamicCount[index]++;
          } else if (this.dynamicCount[index] > 0) {
            this.dynamicCount[index]--;
          }
        } else if (!dynamic) {
          this.nearStatic[index]++;
        } else if (delta > 0) {
          this.nearDynamic[index]++;
        } else if (this.nearDynamic[index] > 0) {
          this.nearDynamic[index]--;
        }
      }
    }
  }

  private stampStaticBox(
    worldX: number,
    worldZ: number,
    halfWidth: number,
    halfDepth: number,
    heading: number,
  ): void {
    const extent = Math.hypot(halfWidth, halfDepth) + SOFT_MARGIN + BLOCK_INFLATE;
    let minCX = Math.floor((worldX - extent - this.minX) / CELL_SIZE);
    let maxCX = Math.floor((worldX + extent - this.minX) / CELL_SIZE);
    let minCZ = Math.floor((worldZ - extent - this.minZ) / CELL_SIZE);
    let maxCZ = Math.floor((worldZ + extent - this.minZ) / CELL_SIZE);
    if (maxCX < 0 || maxCZ < 0 || minCX >= DIM || minCZ >= DIM) return;
    minCX = Math.max(0, minCX); minCZ = Math.max(0, minCZ);
    maxCX = Math.min(DIM - 1, maxCX); maxCZ = Math.min(DIM - 1, maxCZ);
    const sin = Math.sin(heading);
    const cos = Math.cos(heading);
    const blockX = halfWidth + BLOCK_INFLATE;
    const blockZ = halfDepth + BLOCK_INFLATE;
    const softX = blockX + SOFT_MARGIN;
    const softZ = blockZ + SOFT_MARGIN;
    for (let cz = minCZ; cz <= maxCZ; cz++) {
      const pz = this.minZ + (cz + 0.5) * CELL_SIZE - worldZ;
      for (let cx = minCX; cx <= maxCX; cx++) {
        const px = this.minX + (cx + 0.5) * CELL_SIZE - worldX;
        const localX = px * cos - pz * sin;
        const localZ = px * sin + pz * cos;
        if (Math.abs(localX) > softX || Math.abs(localZ) > softZ) continue;
        const index = cz * DIM + cx;
        if (Math.abs(localX) <= blockX && Math.abs(localZ) <= blockZ) this.staticBlocked[index] = 1;
        else this.nearStatic[index]++;
      }
    }
  }
}

function snap(cell: number): number {
  return Math.floor(cell / SNAP_CELLS) * SNAP_CELLS;
}
