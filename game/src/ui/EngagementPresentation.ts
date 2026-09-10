import type { GameWorld } from "../game/GameWorld.ts";
import type { WeaponKind, TurretUpgradeKind } from "../core/types.ts";
import { WEAPONS, STRUCTURES } from "../data/balance.ts";
import { weaponLevelDamage, weaponLevelFireRate } from "../data/weaponShop.ts";
import type { PickupKind } from "../core/types.ts";
import { PICKUP_INFO, resourceAmount } from "./PickupPresentation.ts";

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
  return `${kind === "power" ? "Damage / rivet" : kind === "range" ? "Range (m)" : "Salvos/s"} ${value.toFixed(1)} → ${(value * factor).toFixed(1)}`;
}

export function purchasePrice(cost: number, scrap: number): string {
  const shortfall = Math.ceil((cost - scrap) * 10 - 1e-7) / 10;
  return scrap >= cost ? `${cost} scrap` : `${cost} scrap · need ${shortfall} more`;
}

export function controlHint(device: string, action: "weapon" | "build" | "menu"): string {
  const pad = device === "gamepad";
  if (action === "weapon") return pad ? "B / ↓ switch" : "Tap / click to switch";
  if (action === "menu") return pad ? "Stick / D-pad · Navigate" : "Tap / click an option · Arrows navigate";
  return pad ? "Hold L1 to select · ✕ to place" : "Select an item · Tap Place or press E";
}

/** At most seven resource groups; mixed drops cannot overwrite each other. */
export class PickupReceipt {
  private readonly entries = new Map<PickupKind, { amount: number; until: number }>();
  private cachedText = "";
  private cachedCompact = "";
  private dirty = false;
  add(kind: PickupKind, amount: number, now: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (kind === "cylinder") kind = "pressureCanister";
    const previous = this.entries.get(kind);
    const sum = previous && now < previous.until ? previous.amount + amount : amount;
    this.entries.delete(kind);
    this.entries.set(kind, { amount: sum, until: now + 6000 });
    this.dirty = true;
  }
  text(now: number, compact = false): string {
    for (const [kind, entry] of this.entries) {
      if (now >= entry.until) { this.entries.delete(kind); this.dirty = true; }
    }
    if (!this.dirty) return compact ? this.cachedCompact : this.cachedText;
    const entries = [...this.entries].reverse();
    this.cachedText = entries.slice(0, 3).map(([kind, entry]) =>
      `${PICKUP_INFO[kind].icon} +${resourceAmount(entry.amount)} ${PICKUP_INFO[kind].name}\n${PICKUP_INFO[kind].effect}`,
    ).join("\n\n");
    if (entries.length > 3) this.cachedText += `\n+ ${entries.length - 3} other supply types · see Inventory`;
    this.cachedCompact = entries.slice(0, 3).map(([kind, entry]) =>
      `${PICKUP_INFO[kind].icon} +${resourceAmount(entry.amount)} ${PICKUP_INFO[kind].name}`).join("\n");
    if (entries.length > 3) this.cachedCompact += `\n+ ${entries.length - 3} other types`;
    if (entries.length) this.cachedCompact += "\nInventory / guide explains each item";
    this.dirty = false;
    return compact ? this.cachedCompact : this.cachedText;
  }
  clear(): void {
    this.entries.clear(); this.cachedText = ""; this.cachedCompact = ""; this.dirty = false;
  }
}
