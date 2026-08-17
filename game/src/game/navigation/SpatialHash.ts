import { NAVIGATION } from "../../data/balance.ts";

/**
 * An unbounded uniform-grid hash over the XZ plane.
 *
 * Cells are hashed into a fixed power-of-two bucket table, so the structure
 * covers the whole world without knowing its extent and without a single string
 * key. Buckets are singly-linked lists threaded through flat `Int32Array`s;
 * `clear` is one `fill`, `insert` is a prepend, and `query` walks chains while
 * rejecting entries whose true cell differs (hash collisions are expected and
 * cheap to reject because each entry stores its own cell coordinates).
 */

const CELL_SIZE = NAVIGATION.spatialHashCellSize;
const INV_CELL_SIZE = 1 / CELL_SIZE;

/** Power of two, so the hash can mask instead of dividing. */
const TABLE_SIZE = 4096;
const TABLE_MASK = TABLE_SIZE - 1;

const INITIAL_CAPACITY = 512;

export class SpatialHash {
  readonly cellSize = CELL_SIZE;

  private readonly bucketHead = new Int32Array(TABLE_SIZE);
  private entryNext = new Int32Array(INITIAL_CAPACITY);
  private entryId = new Int32Array(INITIAL_CAPACITY);
  private entryX = new Float64Array(INITIAL_CAPACITY);
  private entryZ = new Float64Array(INITIAL_CAPACITY);
  private entryCellX = new Int32Array(INITIAL_CAPACITY);
  private entryCellZ = new Int32Array(INITIAL_CAPACITY);

  private capacity = INITIAL_CAPACITY;
  private count = 0;
  private occupiedBuckets = 0;

  constructor() {
    this.bucketHead.fill(-1);
  }

  /** Entries currently inserted. */
  get size(): number {
    return this.count;
  }

  /** Non-empty buckets, i.e. the occupied cell count modulo hash collisions. */
  get cellCount(): number {
    return this.occupiedBuckets;
  }

  clear(): void {
    if (this.count !== 0) {
      this.bucketHead.fill(-1);
      this.count = 0;
      this.occupiedBuckets = 0;
    }
  }

  insert(id: number, x: number, z: number): void {
    if (this.count === this.capacity) this.grow();

    const cellX = Math.floor(x * INV_CELL_SIZE);
    const cellZ = Math.floor(z * INV_CELL_SIZE);
    const bucket = hashCell(cellX, cellZ);

    const slot = this.count++;
    this.entryId[slot] = id;
    this.entryX[slot] = x;
    this.entryZ[slot] = z;
    this.entryCellX[slot] = cellX;
    this.entryCellZ[slot] = cellZ;

    const head = this.bucketHead[bucket];
    if (head === -1) this.occupiedBuckets++;
    this.entryNext[slot] = head;
    this.bucketHead[bucket] = slot;
  }

  /**
   * Writes ids of entries within `radius` into `out`, which is truncated to the
   * result count. Indices are written before the truncation so an `out` array
   * reused across frames keeps its backing store and the call allocates nothing.
   */
  query(out: number[], x: number, z: number, radius: number): number {
    const minCellX = Math.floor((x - radius) * INV_CELL_SIZE);
    const maxCellX = Math.floor((x + radius) * INV_CELL_SIZE);
    const minCellZ = Math.floor((z - radius) * INV_CELL_SIZE);
    const maxCellZ = Math.floor((z + radius) * INV_CELL_SIZE);
    const radiusSq = radius * radius;

    const bucketHead = this.bucketHead;
    const entryNext = this.entryNext;
    const entryId = this.entryId;
    const entryX = this.entryX;
    const entryZ = this.entryZ;
    const entryCellX = this.entryCellX;
    const entryCellZ = this.entryCellZ;

    let found = 0;
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        let slot = bucketHead[hashCell(cellX, cellZ)];
        while (slot !== -1) {
          if (entryCellX[slot] === cellX && entryCellZ[slot] === cellZ) {
            const dx = entryX[slot] - x;
            const dz = entryZ[slot] - z;
            if (dx * dx + dz * dz <= radiusSq) {
              out[found++] = entryId[slot];
            }
          }
          slot = entryNext[slot];
        }
      }
    }

    out.length = found;
    return found;
  }

  private grow(): void {
    const next = this.capacity * 2;
    this.entryNext = growInt32(this.entryNext, next);
    this.entryId = growInt32(this.entryId, next);
    this.entryCellX = growInt32(this.entryCellX, next);
    this.entryCellZ = growInt32(this.entryCellZ, next);
    this.entryX = growFloat64(this.entryX, next);
    this.entryZ = growFloat64(this.entryZ, next);
    this.capacity = next;
  }
}

/**
 * Multiplicative cell hash. `Math.imul` keeps the products in int32 so the XOR
 * behaves and the mask yields a non-negative bucket for negative coordinates.
 */
function hashCell(cellX: number, cellZ: number): number {
  return (Math.imul(cellX, 73856093) ^ Math.imul(cellZ, 19349663)) & TABLE_MASK;
}

function growInt32(source: Int32Array<ArrayBuffer>, capacity: number): Int32Array<ArrayBuffer> {
  const next = new Int32Array(capacity);
  next.set(source);
  return next;
}

function growFloat64(
  source: Float64Array<ArrayBuffer>,
  capacity: number,
): Float64Array<ArrayBuffer> {
  const next = new Float64Array(capacity);
  next.set(source);
  return next;
}
