import type { TurretUpgradeKind, RunModifiers } from "../core/types.ts";
import type { GameWorld } from "../game/GameWorld.ts";

export interface TurretUpgradeDefinition {
  kind: TurretUpgradeKind;
  name: string;
  icon: string;
  description: string;
  maxLevel: number;
  baseCost: number;
  costStep: number;
  apply: (modifiers: RunModifiers) => void;
}

export const TURRET_UPGRADES: readonly TurretUpgradeDefinition[] = [
  {
    kind: "power",
    name: "High-Pressure Rivets",
    icon: "◆",
    description: "+22% damage per level",
    maxLevel: 4,
    baseCost: 30,
    costStep: 18,
    apply: (modifiers) => { modifiers.turretDamage *= 1.22; },
  },
  {
    kind: "volley",
    name: "Multi-Barrel Volley",
    icon: "≋",
    description: "+1 rivet in every salvo",
    maxLevel: 3,
    baseCost: 55,
    costStep: 30,
    apply: (modifiers) => { modifiers.turretVolley += 1; },
  },
  {
    kind: "range",
    name: "Long Rail Barrel",
    icon: "⌁",
    description: "+15% targeting and bullet range",
    maxLevel: 4,
    baseCost: 24,
    costStep: 15,
    apply: (modifiers) => { modifiers.turretRange *= 1.15; },
  },
  {
    kind: "autoloader",
    name: "Rotary Autoloader",
    icon: "↻",
    description: "+12% firing speed per level",
    maxLevel: 4,
    baseCost: 34,
    costStep: 20,
    apply: (modifiers) => { modifiers.turretFireRate *= 1.12; },
  },
];

export function turretUpgradeDefinition(kind: TurretUpgradeKind): TurretUpgradeDefinition {
  return TURRET_UPGRADES.find((entry) => entry.kind === kind) ?? TURRET_UPGRADES[0];
}

export function turretUpgradeCost(kind: TurretUpgradeKind, currentLevel: number): number {
  const definition = turretUpgradeDefinition(kind);
  return definition.baseCost + Math.max(0, currentLevel) * definition.costStep;
}

export function purchaseTurretUpgrade(
  world: GameWorld,
  kind: TurretUpgradeKind,
): { ok: boolean; message: string } {
  const definition = turretUpgradeDefinition(kind);
  const level = world.progress.turretUpgrades[kind] ?? 0;
  if (level >= definition.maxLevel) return { ok: false, message: `${definition.name} is fully upgraded` };

  const cost = turretUpgradeCost(kind, level);
  if (world.resources.scrap < cost) return { ok: false, message: `Need ${cost} scrap` };

  world.resources.scrap -= cost;
  world.progress.turretUpgrades[kind] = level + 1;
  definition.apply(world.modifiers);
  world.events.emit({ type: "resource.spent", kind: "scrap", amount: cost, reason: `turret.${kind}` });
  return { ok: true, message: `${definition.name} upgraded to Mk ${level + 1}` };
}
