import { describe, it, expect } from "vitest";
import { GameWorld } from "../src/game/GameWorld.ts";
import { responsiveColumns } from "../src/ui/Screens.ts";
import { PickupReceipt, controlHint, purchasePrice, weaponPreview, turretPreview } from "../src/ui/EngagementPresentation.ts";

describe("engagement presentation", () => {
  it("matches navigation columns to portrait and landscape layouts", () => {
    expect(responsiveColumns(390, 844, 3)).toBe(1);
    expect(responsiveColumns(844, 390, 3)).toBe(2);
    expect(responsiveColumns(1280, 720, 3)).toBe(3);
  });
  it("explains purchasing and active input without mixed glyphs", () => {
    expect(purchasePrice(30, 12.2)).toBe("30 scrap · need 17.8 more");
    expect(purchasePrice(30, 29.99)).toBe("30 scrap · need 0.1 more");
    expect(controlHint("keyboard", "build")).not.toContain("L1");
    expect(controlHint("gamepad", "weapon")).not.toContain("Click");
    const world = new GameWorld(1);
    expect(weaponPreview(world, "shotgun")).toContain("→");
    expect(weaponPreview(world, "rifle")).not.toContain("→");
    expect(turretPreview(world, "volley")).toContain("1 → 2");
  });
  it("aggregates receipts without reusing expired or different resources", () => {
    const receipt = new PickupReceipt();
    receipt.add("scrap", 2, 0); receipt.add("scrap", 3, 100);
    expect(receipt.text(200)).toContain("+5 Scrap");
    receipt.add("weaponPart", 1, 300);
    expect(receipt.text(400)).toContain("+1 Weapon parts");
    expect(receipt.text(400)).toContain("+5 Scrap");
    expect(receipt.text(6400)).toBe("");
    receipt.add("weaponPart", 2, 7000);
    expect(receipt.text(7100)).toContain("+2 Weapon parts");
  });
});
