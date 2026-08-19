import { describe, expect, it } from "vitest";
import { ObjectPool } from "../src/core/ObjectPool.ts";

describe("ObjectPool lifecycle", () => {
  it("resets every object when releasing the whole pool", () => {
    const pool = new ObjectPool(
      3,
      () => ({ active: false, value: 0 }),
      (item) => { item.active = false; item.value = 0; },
    );
    const first = pool.acquire()!;
    const second = pool.acquire()!;
    first.active = true;
    first.value = 41;
    second.active = true;
    second.value = 42;

    pool.releaseAll();

    expect(pool.active).toBe(0);
    expect(pool.available).toBe(pool.capacity);
    expect(pool.backing.every((item) => !item.active && item.value === 0)).toBe(true);
  });
});
