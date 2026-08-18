import { describe, expect, it } from "vitest";
import { GameWorld } from "../src/game/GameWorld.ts";
import { terrainSpeedMultiplier } from "../src/game/route/RouteHazards.ts";

function pointAt(world: GameWorld, distance: number, lateral: number): { x: number; z: number } {
  const point = { x: 0, z: 0 };
  const tangent = { x: 0, z: 1 };
  world.route.spline!.positionAt(point, distance);
  world.route.spline!.tangentAt(tangent, distance);
  return {
    x: point.x - tangent.z * lateral,
    z: point.z + tangent.x * lateral,
  };
}

describe("Flooded Works terrain", () => {
  it("slows movement in shallow water but keeps the bridge dry", () => {
    const world = new GameWorld(8);
    world.route.enterSegment("seg.flooded");
    const bridge = pointAt(world, 41, 0);
    const water = pointAt(world, 41, 8);
    const dry = pointAt(world, 65, 8);
    expect(terrainSpeedMultiplier(world, bridge.x, bridge.z)).toBe(1);
    expect(terrainSpeedMultiplier(world, water.x, water.z)).toBeLessThan(0.7);
    expect(terrainSpeedMultiplier(world, dry.x, dry.z)).toBe(1);
  });

  it("authors three bridge funnels and unlocks the flamer", () => {
    const world = new GameWorld(9);
    world.route.enterSegment("seg.flooded");
    expect(world.route.segment?.waterZones).toHaveLength(3);
    expect(world.route.segment?.weaponUnlock).toBe("flamer");
  });
});
