import type { WeaponKind } from "../core/types.ts";
import type { GameWorld } from "../game/GameWorld.ts";
import { WEAPONS } from "./balance.ts";

export const MAX_WEAPON_LEVEL = 5;

export interface WeaponShopDefinition {
  kind: WeaponKind;
  icon: string;
  unlockCost: number;
  upgradeBaseCost: number;
  role: string;
}

export const WEAPON_SHOP: readonly WeaponShopDefinition[] = [
  { kind: "shotgun", icon: "✦", unlockCost: 0, upgradeBaseCost: 18, role: "Close spread · strong knockback" },
  { kind: "carbine", icon: "≣", unlockCost: 38, upgradeBaseCost: 22, role: "Fast automatic fire" },
  { kind: "rifle", icon: "⌁", unlockCost: 48, upgradeBaseCost: 25, role: "Long range · piercing" },
  { kind: "flamer", icon: "≋", unlockCost: 55, upgradeBaseCost: 28, role: "Short-range crowd control" },
  { kind: "arc", icon: "ϟ", unlockCost: 72, upgradeBaseCost: 32, role: "Piercing electrical blasts" },
  { kind: "launcher", icon: "✹", unlockCost: 78, upgradeBaseCost: 36, role: "Heavy area explosions" },
];

export const WEAPON_ORDER: readonly WeaponKind[] = WEAPON_SHOP.map((entry) => entry.kind);

export function weaponShopDefinition(kind: WeaponKind): WeaponShopDefinition {
  return WEAPON_SHOP.find((entry) => entry.kind === kind) ?? WEAPON_SHOP[0];
}

export function weaponUpgradeCost(kind: WeaponKind, currentLevel: number): number {
  const definition = weaponShopDefinition(kind);
  return definition.upgradeBaseCost + Math.max(0, currentLevel - 1) * Math.ceil(definition.upgradeBaseCost * 0.55);
}

export function weaponLevelDamage(level: number): number {
  return 1 + Math.max(0, level - 1) * 0.16;
}

export function weaponLevelFireRate(level: number): number {
  return 1 + Math.max(0, level - 1) * 0.045;
}

export type ShopPurchaseResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export function purchaseWeaponUpgrade(world: GameWorld, kind: WeaponKind): ShopPurchaseResult {
  const player = world.player;
  const definition = weaponShopDefinition(kind);
  const unlocked = player.unlockedWeapons.includes(kind);
  const level = player.weaponLevels[kind] ?? 0;
  const cost = unlocked ? weaponUpgradeCost(kind, level) : definition.unlockCost;

  if (unlocked && level >= MAX_WEAPON_LEVEL) return { ok: false, message: `${WEAPONS[kind].name} is fully upgraded` };
  if (world.resources.scrap < cost) return { ok: false, message: `Need ${cost} scrap` };

  world.resources.scrap -= cost;
  world.events.emit({ type: "resource.spent", kind: "scrap", amount: cost, reason: `weapon.${kind}` });
  if (!unlocked) {
    player.unlockedWeapons.push(kind);
    player.weaponLevels[kind] = 1;
    player.currentWeapon = kind;
    return { ok: true, message: `Purchased ${WEAPONS[kind].name}` };
  }

  player.weaponLevels[kind] = level + 1;
  return { ok: true, message: `${WEAPONS[kind].name} upgraded to Mk ${level + 1}` };
}
