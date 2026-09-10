import type { GameWorld } from "../game/GameWorld.ts";
import type { WeaponKind, TurretUpgradeKind } from "../core/types.ts";
import { WEAPONS, STRUCTURES } from "../data/balance.ts";
import { weaponLevelDamage, weaponLevelFireRate } from "../data/weaponShop.ts";

export function weaponPreview(world: GameWorld, kind: WeaponKind): string {
  const level = world.player.weaponLevels[kind] || 1;
  const config = WEAPONS[kind];
  const damage = (lv: number) => (config.damage * world.modifiers.playerDamage * weaponLevelDamage(lv)).toFixed(1);
  const rate = (lv: number) => (world.modifiers.playerFireRate * weaponLevelFireRate(lv) / config.fireInterval).toFixed(1);
  if (!world.player.unlockedWeapons.includes(kind)) return `${damage(1)} damage / projectile · ${rate(1)} shots/s`;
  return `Damage ${damage(level)} → ${damage(level + 1)} / projectile · Shots/s ${rate(level)} → ${rate(level + 1)}`;
}

export function turretPreview(world: GameWorld, kind: TurretUpgradeKind): string {
  const m = world.modifiers, base = STRUCTURES.rivetTurret;
  if (kind === "volley") return `Rivets per salvo ${m.turretVolley} → ${m.turretVolley + 1}`;
  const value = kind === "power" ? base.damage * m.turretDamage
    : kind === "range" ? base.range * m.turretRange : m.turretFireRate / base.fireInterval;
  const factor = kind === "power" ? 1.22 : kind === "range" ? 1.15 : 1.12;
  return `${kind === "power" ? "Damage" : kind === "range" ? "Range (m)" : "Shots/s"} ${value.toFixed(1)} → ${(value * factor).toFixed(1)}`;
}

export function purchasePrice(cost: number, scrap: number): string {
  return scrap >= cost ? `${cost} scrap` : `${cost} scrap · need ${Math.ceil(cost - scrap)} more`;
}

export function controlHint(device: string, action: "weapon" | "build" | "menu"): string {
  const pad = device === "gamepad";
  if (action === "weapon") return pad ? "B / ↓ switch" : "Tap / click to switch";
  if (action === "menu") return pad ? "Stick / D-pad · Navigate" : "Tap / click an option · Arrows navigate";
  return pad ? "Hold L1 to select · ✕ to place" : "Select an item · Tap Place or press E";
}

/** Bounded, allocation-light same-kind receipt; never reports a stale gain. */
const PICKUP_NAMES: Record<string, string> = { weaponPart: "weapon parts", pressureCanister: "canisters", cylinder: "canisters", repairKit: "repair kits", shockMine: "shock mines", armorPlate: "armor plates" };
export class PickupReceipt {
  kind = "";
  amount = 0;
  until = 0;
  add(kind: string, amount: number, now: number): void {
    this.amount = this.kind === kind && now < this.until ? this.amount + amount : amount;
    this.kind = kind;
    this.until = now + 2200;
  }
  text(now: number): string {
    if (now >= this.until) return "";
    return `+${Number(this.amount.toFixed(1))} ${PICKUP_NAMES[this.kind] ?? this.kind}`;
  }
}
