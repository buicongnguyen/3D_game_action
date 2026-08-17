/**
 * Seeded PRNG (mulberry32). Every stochastic decision in the simulation must
 * draw from an instance of this so a run is reproducible from its seed alone.
 * `Math.random` is banned inside `fixedUpdate`.
 */
export class Random {
  private state: number;
  readonly seed: number;

  constructor(seed: number) {
    // Normalise to a non-zero uint32 so seed 0 does not degenerate.
    this.seed = seed >>> 0;
    this.state = (this.seed || 0x9e3779b9) >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(min + this.next() * (max - min + 1));
  }

  bool(chance = 0.5): boolean {
    return this.next() < chance;
  }

  /** Uniform in [-magnitude, magnitude). */
  signed(magnitude = 1): number {
    return (this.next() * 2 - 1) * magnitude;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /**
   * Picks an index proportional to `weights`. Returns -1 when every weight is
   * zero or the list is empty, so callers must handle the empty case.
   */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += Math.max(0, weights[i]);
    if (total <= 0) return -1;
    let roll = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= Math.max(0, weights[i]);
      if (roll <= 0) return i;
    }
    return weights.length - 1;
  }

  /** Fisher-Yates, in place. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return items;
  }

  /** Angle in [0, 2PI). */
  angle(): number {
    return this.next() * Math.PI * 2;
  }

  /** Writes a uniform point inside a circle into `out`. */
  pointInCircle(out: { x: number; z: number }, radius: number): void {
    const a = this.angle();
    const r = radius * Math.sqrt(this.next());
    out.x = Math.cos(a) * r;
    out.z = Math.sin(a) * r;
  }

  /** Forks a deterministic child stream, so subsystems do not interleave draws. */
  fork(salt: number): Random {
    return new Random((Math.imul(this.seed ^ salt, 0x85ebca6b) ^ 0x27d4eb2f) >>> 0);
  }

  /** Snapshot/restore, used by tests and by save/replay. */
  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }
}

/** Non-deterministic seed for a fresh run; log it so bugs stay reproducible. */
export function createSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

/**
 * Human-typeable seed: 7 uppercase base-32 characters.
 *
 * A seed is 32 bits, so a longer typed word is folded into that range and the
 * canonical form comes back shorter — "IRONMARCH" displays as "0NMARCH". That
 * round-trips correctly (feeding "0NMARCH" back reproduces the same run, which
 * is the only property that matters), but it looks like a bug to anyone who
 * typed the longer word, so callers that still hold the original string should
 * display that instead. See `formatSeed`.
 */
export function seedToString(seed: number): string {
  return (seed >>> 0).toString(32).toUpperCase().padStart(7, "0");
}

/**
 * Shows what the player typed when they typed something, and the canonical
 * form otherwise. Both reproduce the run.
 */
export function formatSeed(seed: number, original: string | null): string {
  return original && original.trim().length > 0 ? original.trim().toUpperCase() : seedToString(seed);
}

export function seedFromString(text: string): number {
  const trimmed = text.trim();
  const parsed = parseInt(trimmed, 32);
  if (Number.isFinite(parsed) && trimmed.length > 0) return parsed >>> 0;
  // Fall back to a string hash so any typed text is a usable seed.
  let hash = 0x811c9dc5;
  for (let i = 0; i < trimmed.length; i++) {
    hash ^= trimmed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
