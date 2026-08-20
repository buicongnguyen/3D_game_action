import { describe, expect, it } from "vitest";
import { WEAPONS } from "../src/data/balance.ts";
import {
  MAX_WEAPON_LEVEL,
  WEAPON_SHOP,
  hasAffordableWeaponPurchase,
  purchaseWeaponUpgrade,
  weaponLevelDamage,
  weaponLevelFireRate,
} from "../src/data/weaponShop.ts";
import { GameWorld } from "../src/game/GameWorld.ts";

describe("checkpoint weapon shop", () => {
  it("detects when no non-maxed weapon purchase is affordable", () => {
    const world = new GameWorld(6100);
    world.resources.scrap = 0;
    expect(hasAffordableWeaponPurchase(world)).toBe(false);
    world.resources.scrap = 18;
    expect(hasAffordableWeaponPurchase(world)).toBe(true);
  });

  it("offers six distinct functional weapons", () => {
    expect(WEAPON_SHOP).toHaveLength(6);
    expect(new Set(WEAPON_SHOP.map((entry) => entry.kind)).size).toBe(6);
    for (const entry of WEAPON_SHOP) expect(WEAPONS[entry.kind].damage).toBeGreaterThan(0);
  });

  it("buys a locked weapon and equips it", () => {
    const world = new GameWorld(6101);
    world.resources.scrap = 100;
    const cost = WEAPON_SHOP.find((entry) => entry.kind === "carbine")!.unlockCost;

    const result = purchaseWeaponUpgrade(world, "carbine");

    expect(result.ok).toBe(true);
    expect(world.resources.scrap).toBe(100 - cost);
    expect(world.player.unlockedWeapons).toContain("carbine");
    expect(world.player.weaponLevels.carbine).toBe(1);
    expect(world.player.currentWeapon).toBe("carbine");
  });

  it("upgrades only the purchased weapon through five meaningful marks", () => {
    const world = new GameWorld(6102);
    world.resources.scrap = 10_000;
    for (let level = 1; level < MAX_WEAPON_LEVEL; level++) {
      expect(purchaseWeaponUpgrade(world, "shotgun").ok).toBe(true);
    }
    expect(world.player.weaponLevels.shotgun).toBe(MAX_WEAPON_LEVEL);
    expect(purchaseWeaponUpgrade(world, "shotgun").ok).toBe(false);
    expect(world.player.weaponLevels.carbine).toBe(0);
    expect(weaponLevelDamage(MAX_WEAPON_LEVEL)).toBeGreaterThan(weaponLevelDamage(1));
    expect(weaponLevelFireRate(MAX_WEAPON_LEVEL)).toBeGreaterThan(weaponLevelFireRate(1));
  });

  it("does not unlock a weapon without enough scrap", () => {
    const world = new GameWorld(6103);
    world.resources.scrap = 0;
    expect(purchaseWeaponUpgrade(world, "arc").ok).toBe(false);
    expect(world.player.unlockedWeapons).not.toContain("arc");
    expect(world.player.weaponLevels.arc).toBe(0);
  });
});
