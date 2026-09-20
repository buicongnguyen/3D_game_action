import { describe, expect, it } from "vitest";
import { MeshForge } from "../src/art/MeshForge.ts";
import { GameWorld } from "../src/game/GameWorld.ts";
import { InteractionSystem } from "../src/game/systems/InteractionSystem.ts";
import { ConstructionSystem } from "../src/game/systems/ConstructionSystem.ts";
import { StorySimulation } from "../src/story/StorySimulation.ts";

describe("coin and diamond rewards", () => {
  it("has raised coin faces and distinct, cheap, grounded diamond cuts", () => {
    const forge = new MeshForge();
    try {
      for (const kind of ["scrap", "fuel", "cylinder", "repairKit", "shockMine", "armorPlate", "weaponPart"]) {
        const geo = forge.pickupGeometry(kind); geo.computeBoundingBox();
        expect(geo.boundingBox!.min.y).toBeGreaterThanOrEqual(0);
        expect(geo.getAttribute("position").count).toBeLessThan(1500);
        expect(geo.getAttribute("color").count).toBe(geo.getAttribute("position").count);
        expect(Array.from(geo.getAttribute("position").array).every(Number.isFinite)).toBe(true);
      }
      const box = forge.pickupGeometry("scrap").boundingBox!;
      expect(box.max.z - box.min.z).toBeLessThan(0.3);
      expect(box.max.x - box.min.x).toBeGreaterThan(1);
    } finally { forge.dispose(); }
  });
  it("auto-collects credited Marching loot beyond 32 m once, not distant map supplies", () => {
    const world = new GameWorld(42), system = new InteractionSystem(new ConstructionSystem());
    const before = world.resources.scrap;
    world.modifiers.scrapYield = 1.5;
    system.spawnPickup(world, "scrap", world.player.x + 80, world.player.z, 4, 0.35, undefined, 32);
    system.spawnPickup(world, "fuel", world.player.x + 80, world.player.z, 12, 0, 0);
    const fuel = world.resources.fuel;
    system.collectPickups(world, 0.1); expect(world.resources.scrap).toBe(before);
    for (let i = 0; i < 12; i++) system.collectPickups(world, 0.1);
    expect(world.resources.scrap).toBe(before + 6); expect(world.stats.scrapCollected).toBe(6);
    expect(world.resources.fuel).toBe(fuel); expect(world.pickups.active).toBe(1);
    for (let i = 0; i < 12; i++) system.collectPickups(world, 0.1);
    expect(world.resources.scrap).toBe(before + 6);
  });
  it("does not auto-collect uncredited turret loot", () => {
    const world = new GameWorld(43), system = new InteractionSystem(new ConstructionSystem());
    const before = world.resources.scrap;
    system.spawnPickup(world, "scrap", world.player.x + 80, world.player.z, 4, 0);
    system.collectPickups(world, 0.1);
    expect(world.resources.scrap).toBe(before); expect(world.pickups.active).toBe(1);
  });
  it("credits a real piercing laser across multiple distant targets, not unrelated supplies", () => {
    const sim = new StorySimulation(71309, { version: 1, seed: 71309, progress: { ...new StorySimulation().state.progress, chapter: 3 } });
    sim.start(); sim.state.enemies.length = 0; sim.state.bossDefeated = true; sim.selectWeapon("laser");
    Object.assign(sim.state.player, { x: 0, z: 0 });
    sim.spawn("broodling", { x: 0, z: 15 }); sim.spawn("broodling", { x: 0, z: 21 });
    sim.state.pickups.push({ id: 900, kind: "supply", x: 30, z: 0, amount: 15 });
    const before = sim.state.progress.shells;
    sim.step(1 / 120);
    expect(sim.state.killed).toBe(2); expect(sim.state.progress.shells).toBe(before + 2);
    expect(sim.state.pickups).toHaveLength(1); expect(sim.state.pickups[0].kind).toBe("supply");
    expect(sim.state.receipt).toContain("Auto-collected");
  });
  it("preserves player credit through a turret finish and rejects duplicate rewards", () => {
    const sim = new StorySimulation(), enemy = sim.spawn("shellback", { x: 35, z: 0 })!;
    const before = sim.state.progress.shells;
    sim.hit(enemy, 1, true); sim.state.progress.selected = "flame";
    sim.hit(enemy, 100); sim.hit(enemy, 100, true);
    expect(sim.state.progress.shells).toBe(before + 2); expect(sim.state.pickups).toHaveLength(0);
    const uncredited = sim.spawn("broodling", { x: 35, z: 0 })!; sim.hit(uncredited, 100);
    expect(sim.state.progress.shells).toBe(before + 2); expect(sim.state.pickups).toHaveLength(1);
  });
  it("auto-collection respects the parts cap and does not modify the retry checkpoint", () => {
    const sim = new StorySimulation(); sim.state.progress.shells = 9999;
    sim.hit(sim.spawn("shellback", { x: 35, z: 0 })!, 100, true);
    expect(sim.state.progress.shells).toBe(10000); expect(sim.state.receipt).toContain("+1 shell part");
    sim.retry(); expect(sim.state.progress.shells).toBe(5);
  });
});
