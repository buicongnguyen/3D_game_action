import { describe, expect, it } from "vitest";
import { buildRockGeometry } from "../src/art/environment.ts";
import { Random } from "../src/core/Random.ts";

describe("grounded rock silhouettes", () => {
  it("keeps each stone rooted with a shallow buried base and bounded detail", () => {
    for (let seed = 1; seed <= 25; seed++) {
      for (let variant = 0; variant < 3; variant++) {
        const geometry = buildRockGeometry(variant, new Random(seed));
        try {
          geometry.computeBoundingBox();
          expect(geometry.boundingBox!.min.y).toBeCloseTo(-0.08, 5);
          expect(geometry.boundingBox!.max.y).toBeGreaterThan(0.2);
          const triangles = (geometry.index?.count ?? geometry.getAttribute("position").count) / 3;
          expect(triangles).toBe(80 + variant * 20);
          const positions = geometry.getAttribute("position");
          const normals = geometry.getAttribute("normal");
          expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
          expect(Array.from(normals.array).every(Number.isFinite)).toBe(true);
        } finally { geometry.dispose(); }
      }
    }
  });
});
