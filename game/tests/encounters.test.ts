import { describe, expect, it } from "vitest";
import { SIM } from "../src/data/balance.ts";
import { GameWorld } from "../src/game/GameWorld.ts";
import { EncounterSystem } from "../src/game/systems/EncounterSystem.ts";
import { HordeDirector } from "../src/game/systems/HordeDirector.ts";

function enter(world: GameWorld, segmentId: string, distance: number): void {
  world.route.enterSegment(segmentId);
  world.phase = "MARCH";
  world.spider.docked = false;
  world.spider.distanceAlongRoute = distance;
  const point = { x: 0, z: 0 };
  world.route.spline!.positionAt(point, distance);
  world.spider.x = point.x;
  world.spider.z = point.z;
  world.navigation.recenter(point.x, point.z);
}

describe("authored house encounters", () => {
  it("keeps the opening cache house peaceful", () => {
    const world = new GameWorld(1);
    enter(world, "seg.approach", 100);
    const encounters = new EncounterSystem(new HordeDirector());
    for (let i = 0; i < 180; i++) encounters.update(world, SIM.fixedStep);
    expect(world.enemies.active).toBe(0);
    expect(encounters.pendingCount).toBe(0);
  });

  it("warns before releasing a finite occupied-house squad exactly once", () => {
    const world = new GameWorld(2);
    enter(world, "seg.mine", 34);
    const encounters = new EncounterSystem(new HordeDirector());
    let warnings = 0;
    world.events.on("ui.toast", (event) => {
      if (event.message.includes("Movement inside")) warnings++;
    });

    encounters.update(world, SIM.fixedStep);
    world.events.drain();
    expect(warnings).toBe(1);
    expect(encounters.pendingCount).toBe(1);
    expect(world.enemies.active).toBe(0);

    for (let i = 0; i < 120; i++) encounters.update(world, SIM.fixedStep);
    expect(world.enemies.active).toBe(5);
    expect(encounters.hasCompleted("house.mine-1")).toBe(true);
    expect(world.enemies.backing.filter((enemy) => enemy.active).every((enemy) => enemy.spawnedVisible)).toBe(true);

    for (let i = 0; i < 300; i++) encounters.update(world, SIM.fixedStep);
    world.events.drain();
    expect(world.enemies.active).toBe(5);
    expect(warnings).toBe(1);
  });

  it("resets authored encounter state on a new route segment", () => {
    const world = new GameWorld(3);
    const encounters = new EncounterSystem(new HordeDirector());
    enter(world, "seg.mine", 34);
    encounters.update(world, SIM.fixedStep);
    expect(encounters.pendingCount).toBe(1);

    enter(world, "seg.scrapyard", 0);
    encounters.update(world, SIM.fixedStep);
    expect(encounters.pendingCount).toBe(0);
  });

  it("bounds nest reinforcements and stops them permanently after destruction", () => {
    const world = new GameWorld(4);
    enter(world, "seg.scrapyard", 65);
    const director = new HordeDirector();
    const encounters = new EncounterSystem(director);
    for (let i = 0; i < 120; i++) encounters.update(world, SIM.fixedStep);
    const site = world.encounterSites[0];
    expect(site.triggered).toBe(true);
    expect(site.wavesReleased).toBe(1);
    const afterInitial = world.enemies.active;
    site.active = false;
    for (let i = 0; i < 60 * 30; i++) encounters.update(world, SIM.fixedStep);
    expect(world.enemies.active).toBe(afterInitial);
    expect(site.wavesReleased).toBe(1);
  });
});
