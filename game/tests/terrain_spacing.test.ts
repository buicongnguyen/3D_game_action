import { describe, expect, it } from "vitest";
import { TERRAIN_STYLES } from "../src/core/types.ts";
import { ROUTE_SEGMENTS } from "../src/data/routes.ts";
import { GameWorld } from "../src/game/GameWorld.ts";
import { ENCOUNTER_EXIT_DISTANCE, encounterExitPosition } from "../src/game/systems/EncounterSystem.ts";
import {
  SOLID_PROP_GAP,
  TERRAIN_PALETTES,
  propsHaveClearance,
} from "../src/rendering/TerrainBuilder.ts";

describe("terrain obstacle spacing", () => {
  it("uses all eight visually distinct terrain styles across the expanded campaign", () => {
    const used = new Set(Object.values(ROUTE_SEGMENTS).map((segment) => segment.terrainStyle));
    expect(used).toEqual(new Set(TERRAIN_STYLES));
    expect(Object.keys(ROUTE_SEGMENTS).length).toBeGreaterThanOrEqual(10);

    const groundColors = TERRAIN_STYLES.map((style) => TERRAIN_PALETTES[style].groundBase);
    expect(new Set(groundColors).size).toBe(TERRAIN_STYLES.length);
    for (const style of TERRAIN_STYLES) {
      expect(TERRAIN_PALETTES[style].houseColors.length).toBeGreaterThanOrEqual(3);
    }
    expect(TERRAIN_PALETTES.mountain.reliefScale).toBeGreaterThan(TERRAIN_PALETTES.valley.reliefScale);
  });

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
