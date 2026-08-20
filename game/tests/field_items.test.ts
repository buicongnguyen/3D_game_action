import { describe, expect, it } from "vitest";
import { createEmptySnapshot } from "../src/input/InputActions.ts";
import { GameWorld } from "../src/game/GameWorld.ts";
import { ConstructionSystem } from "../src/game/systems/ConstructionSystem.ts";
import { FieldItemSystem } from "../src/game/systems/FieldItemSystem.ts";
import { InteractionSystem } from "../src/game/systems/InteractionSystem.ts";
import { formatFieldItems } from "../src/ui/HudBridge.ts";

function pressTool() {
  const input = createEmptySnapshot();
  input.buttons.tool.pressed = true;
  input.buttons.tool.held = true;
  return input;
}

describe("finite field items", () => {
  it("increments every blue/special pickup by its quantity and exposes the totals", () => {
    const world = new GameWorld(9);
    const interaction = new InteractionSystem(new ConstructionSystem());
    const x = world.player.x;
    const z = world.player.z;
    interaction.spawnPickup(world, "pressureCanister", x, z, 2, 0, 0);
    interaction.spawnPickup(world, "shockMine", x, z, 2, 0, 0);
    interaction.spawnPickup(world, "armorPlate", x, z, 2, 0, 0);
    interaction.spawnPickup(world, "weaponPart", x, z, 2, 0, 0);

    interaction.collectPickups(world, 1 / 60);

    expect(world.cylindersReady).toBe(2);
    expect(world.fieldItems.shockMines).toBe(2);
    expect(world.fieldItems.armorPlates).toBe(2);
    expect(world.fieldItems.weaponParts).toBe(2);
    expect(formatFieldItems(world.fieldItems)).toContain("MINE×2");
    expect(formatFieldItems(world.fieldItems)).toContain("PLATE×2");
    expect(formatFieldItems(world.fieldItems)).toContain("PART×2 (2/3)");
  });

  it("stores a repair kit and applies it to a nearby damaged machine", () => {
    const world = new GameWorld(10);
    const construction = new ConstructionSystem();
    const interaction = new InteractionSystem(construction);
    const items = new FieldItemSystem(construction);
    interaction.spawnPickup(world, "repairKit", world.player.x, world.player.z, 1, 0, 0);
    interaction.collectPickups(world, 1 / 60);
    expect(world.fieldItems.repairKits).toBe(1);
    const turret = construction.spawnStructure(world, "rivetTurret", world.player.x + 2, world.player.z, 0, 0.3, 0);
    turret.state = "active";
    const before = turret.health;
    items.update(world, pressTool());
    expect(turret.health).toBeGreaterThan(before);
    expect(world.fieldItems.repairKits).toBe(0);
  });

  it("deploys a collected shock mine without spending scrap", () => {
    const world = new GameWorld(11);
    const construction = new ConstructionSystem();
    const items = new FieldItemSystem(construction);
    world.fieldItems.shockMines = 1;
    const scrap = world.resources.scrap;
    items.update(world, pressTool());
    expect(world.structures.some((structure) => structure.kind === "mine")).toBe(true);
    expect(world.fieldItems.shockMines).toBe(0);
    expect(world.resources.scrap).toBe(scrap);
  });

  it("banks an armor plate only while standing in the Spider service radius", () => {
    const world = new GameWorld(12);
    const items = new FieldItemSystem(new ConstructionSystem());
    world.fieldItems.armorPlates = 1;
    world.player.x = world.spider.x + world.spider.serviceRadius + 4;
    items.update(world, pressTool());
    expect(world.fieldItems.armorPlates).toBe(1);
    const maxBefore = world.spider.maxCoreHealth;
    world.player.x = world.spider.x;
    world.player.z = world.spider.z;
    items.update(world, pressTool());
    expect(world.fieldItems.armorPlates).toBe(0);
    expect(world.spider.maxCoreHealth).toBe(maxBefore + 25);
  });
});
