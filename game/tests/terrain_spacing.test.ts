import { describe, expect, it } from "vitest";
import { GameWorld } from "../src/game/GameWorld.ts";
import { ENCOUNTER_EXIT_DISTANCE, encounterExitPosition } from "../src/game/systems/EncounterSystem.ts";
import { SOLID_PROP_GAP, propsHaveClearance } from "../src/rendering/TerrainBuilder.ts";

describe("terrain obstacle spacing", () => {
  it("rejects solid props whose collision surfaces would form a connected wall", () => {
    const radius = 1.2;
    expect(propsHaveClearance(0, 0, radius, true, radius * 2 + SOLID_PROP_GAP - 0.01, 0, radius, true)).toBe(false);
    expect(propsHaveClearance(0, 0, radius, true, radius * 2 + SOLID_PROP_GAP, 0, radius, true)).toBe(true);
  });

  it("puts an occupied-house exit toward the route rather than inside the house", () => {
    const world = new GameWorld(2208);
    world.route.enterSegment("seg.mine");
    const encounter = world.route.segment!.encounters![0];
    const exit = encounterExitPosition(world, encounter);
    const spline = world.route.spline!;

    expect(Math.abs(spline.lateralOffset(exit.x, exit.z))).toBeCloseTo(
      Math.abs(encounter.lateral) - ENCOUNTER_EXIT_DISTANCE,
      1,
    );
    expect(Math.abs(spline.lateralOffset(exit.x, exit.z))).toBeLessThan(Math.abs(encounter.lateral));
  });
});
