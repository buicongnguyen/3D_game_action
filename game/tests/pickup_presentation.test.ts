import { describe, it, expect } from "vitest";
import { GameWorld } from "../src/game/GameWorld.ts";
import { ConstructionSystem } from "../src/game/systems/ConstructionSystem.ts";
import { InteractionSystem } from "../src/game/systems/InteractionSystem.ts";
import { PickupReceipt } from "../src/ui/EngagementPresentation.ts";
import { inventoryScreenData, partsProgress, objectiveUnit, PICKUP_INFO, resourceAmount } from "../src/ui/PickupPresentation.ts";
import { glyphFor } from "../src/ui/HudController.ts";

describe("pickup identities and counter relationships", () => {
  it("explains every pickup, including the two canister variants", () => {
    expect(Object.keys(PICKUP_INFO)).toHaveLength(8);
    expect(PICKUP_INFO.cylinder).toEqual(PICKUP_INFO.pressureCanister);
    for (const entry of Object.values(PICKUP_INFO)) {
      expect(entry.name.length).toBeGreaterThan(3);
      expect(entry.effect.length).toBeGreaterThan(20);
    }
  });
  it("merges canister aliases, keeps mixed loot bounded and explains overflow", () => {
    const receipt = new PickupReceipt();
    receipt.add("cylinder", 1, 0); receipt.add("pressureCanister", 2, 1);
    expect(receipt.text(2)).toContain("+3 Pressure canisters");
    receipt.add("fuel", 2.4, 3); receipt.add("scrap", 1.2, 4); receipt.add("weaponPart", 1, 5);
    expect(receipt.text(6)).toContain("+ 1 other supply types");
    expect(receipt.text(6)).toContain("+2.4 Fuel reserve");
    expect(receipt.text(6, true)).toContain("+2.4 Fuel reserve");
    expect(receipt.text(6, true)).not.toContain("not tank fuel");
    expect(receipt.text(6004)).not.toContain("Fuel reserve");
    receipt.clear(); expect(receipt.text(6)).toBe("");
  });
  it("does not announce invalid gains or round up unearned resources", () => {
    const receipt = new PickupReceipt();
    for (const amount of [NaN, Infinity, -1, 0]) receipt.add("scrap", amount, 0);
    expect(receipt.text(1)).toBe("");
    expect(resourceAmount(29.99)).toBe("29.9");
    expect(resourceAmount(0.1 + 0.2)).toBe("0.3");
  });
  it("names the units for every objective, not just an unexplained fraction", () => {
    expect(objectiveUnit("salvage")).toBe("scrap collected");
    expect(objectiveUnit("combat")).toBe("enemies defeated");
    expect(objectiveUnit("recover")).toBe("machines recovered");
    expect(objectiveUnit("nests")).toBe("nests cleared");
    for (const kind of ["service", "pressure", "pursuit"] as const) expect(objectiveUnit(kind)).toMatch(/^s /);
  });
  it("shows actual stored fuel, without suggesting it filled the tank", () => {
    const world = new GameWorld(321);
    const interaction = new InteractionSystem(new ConstructionSystem());
    const beforeTank = world.spider.fuel;
    const beforeReserve = world.resources.fuel;
    interaction.spawnPickup(world, "fuel", world.player.x, world.player.z, 12, 0, 0);
    interaction.collectPickups(world, 1 / 60);
    const guide = inventoryScreenData(world);
    expect(world.spider.fuel).toBe(beforeTank);
    expect(guide.facts?.find(f => f.label.includes("Fuel reserve"))?.label).toContain(`${beforeReserve + 12} available`);
    expect(guide.subtitle).toContain("does not instantly refill");
    expect(guide.body).toContain("weapon Mk is a separate");
  });
  it("explains the part cycle and the boost actually awarded by collection", () => {
    const world = new GameWorld(322);
    const interaction = new InteractionSystem(new ConstructionSystem());
    const before = world.modifiers.playerDamage;
    interaction.spawnPickup(world, "weaponPart", world.player.x, world.player.z, 7, 0, 0);
    interaction.collectPickups(world, 1 / 60);
    expect(world.modifiers.playerDamage).toBeCloseTo(before * 1.08 ** 2);
    expect(partsProgress(world.fieldItems.weaponParts)).toBe("1/3 parts to next +8% gun damage · 2 boosts earned");
    expect(inventoryScreenData(world).facts?.at(-1)?.label).toContain("7 collected this run");
    expect(partsProgress(3)).toContain("0/3 parts to next");
    expect(partsProgress(3)).toContain("1 boost earned");
  });
  it("does not show controller-only bindings before a controller is used", () => {
    expect(glyphFor("tool", "none").text).toBe("V");
    expect(glyphFor("tool", "gamepad").text).toBe("R1");
  });
});
