/**
 * Fixed-capacity object pool.
 *
 * Pools pre-allocate their whole capacity at construction so no allocation
 * happens during a tick. `acquire` returns null when exhausted rather than
 * growing, which turns a runaway spawn into a visible, measurable cap instead
 * of a memory leak and a stutter.
 */
export class ObjectPool<T> {
  private readonly items: T[] = [];
  private readonly free: number[] = [];
  private readonly reset: (item: T) => void;
  private liveCount = 0;
  private highWater = 0;
  private exhaustedCount = 0;

  readonly capacity: number;

  constructor(capacity: number, factory: (index: number) => T, reset: (item: T) => void) {
    this.capacity = capacity;
    this.reset = reset;
    for (let i = 0; i < capacity; i++) {
      this.items.push(factory(i));
      // Fill the free list in reverse so the first acquisitions come out in
      // index order, which keeps instanced-render slots contiguous early on.
      this.free.push(capacity - 1 - i);
    }
  }

  acquire(): T | null {
    const index = this.free.pop();
    if (index === undefined) {
      this.exhaustedCount++;
      return null;
    }
    const item = this.items[index];
    this.reset(item);
    this.liveCount++;
    if (this.liveCount > this.highWater) this.highWater = this.liveCount;
    return item;
  }

  release(index: number): void {
    if (index < 0 || index >= this.capacity) return;
    this.free.push(index);
    this.liveCount--;
    if (this.liveCount < 0) this.liveCount = 0;
  }

  /** Direct indexed access, for systems that iterate the backing array. */
  at(index: number): T {
    return this.items[index];
  }

  /**
   * The backing array in slot order. Systems iterate this and skip inactive
   * entries, which is faster and more cache-friendly than a Map of live items.
   */
  get backing(): readonly T[] {
    return this.items;
  }

  get active(): number {
    return this.liveCount;
  }

  get available(): number {
    return this.free.length;
  }

  /**
   * Highest simultaneous occupancy since construction or the last `resetStats`.
   *
   * Counted on acquire rather than sampled, which is what makes it exact: a
   * burst that fills the pool and drains again inside one step raises this,
   * where anything reading `active` once a frame would never see it.
   */
  get peak(): number {
    return this.highWater;
  }

  /** Times `acquire` was called with nothing free. A non-zero value is a bug. */
  get exhaustions(): number {
    return this.exhaustedCount;
  }

  releaseAll(): void {
    this.free.length = 0;
    for (let i = 0; i < this.capacity; i++) this.free.push(this.capacity - 1 - i);
    this.liveCount = 0;
  }

  /**
   * Starts a fresh measurement window without disturbing what is live.
   *
   * The peak is rebased on the current occupancy, not on zero: what is already
   * held has genuinely been reached. Scenario harnesses call this between
   * scenarios, or every figure after the first would be the peak of everything
   * that had run before it.
   */
  resetStats(): void {
    this.highWater = this.liveCount;
    this.exhaustedCount = 0;
  }
}
