import type { PickupKind, RouteObjectiveKind } from "../core/types.ts";
import type { GameWorld } from "../game/GameWorld.ts";
import type { ScreenData } from "./Screens.ts";

export const PICKUP_INFO: Record<PickupKind, { name: string; icon: string; effect: string }> = {
  scrap: { name: "Scrap", icon: "⚙", effect: "Build machines and buy workshop upgrades." },
  fuel: { name: "Fuel reserve", icon: "◆", effect: "Stored fuel, not tank fuel. Refuel beside the Spider." },
  cylinder: { name: "Pressure canisters", icon: "◎", effect: "Stored in the rack. Power or recharge machines." },
  pressureCanister: { name: "Pressure canisters", icon: "◎", effect: "Stored in the rack. Power or recharge machines." },
  repairKit: { name: "Repair kits", icon: "+", effect: "Repair case. Use item heals you or a nearby machine by up to 45%." },
  shockMine: { name: "Shock mines", icon: "✹", effect: "Blue round mine. Place it free with Use item." },
  armorPlate: { name: "Armor plates", icon: "▰", effect: "Blue-gray plate. Use item beside Spider: +25 current and max core HP." },
  weaponPart: { name: "Weapon parts", icon: "⚒", effect: "Every 3 parts automatically multiply gun damage by 1.08." },
};

/** Never round an unearned fraction up to a spendable unit. */
export function resourceAmount(value: number): string {
  return String(Math.floor(Math.max(0, value) * 10 + 1e-7) / 10);
}

export function partsProgress(parts: number): string {
  const boosts = Math.floor(parts / 3);
  return `${parts % 3}/3 parts to next +8% gun damage · ${boosts} ${boosts === 1 ? "boost" : "boosts"} earned`;
}

export function objectiveUnit(kind: RouteObjectiveKind | "service" | "combat" | undefined): string {
  switch (kind) {
    case "recover": return "machines recovered";
    case "salvage": return "scrap collected";
    case "nests": return "nests cleared";
    case "combat": return "enemies defeated";
    case "service": return "s assisted";
    case "pressure": return "s powered";
    case "pursuit": return "s survived";
    default: return "";
  }
}

export function inventoryScreenData(world: GameWorld): ScreenData {
  const items = world.fieldItems;
  const balances: Array<[PickupKind, number]> = [
    ["scrap", world.resources.scrap], ["fuel", world.resources.fuel],
    ["pressureCanister", world.cylindersReady], ["repairKit", items.repairKits],
    ["shockMine", items.shockMines], ["armorPlate", items.armorPlates], ["weaponPart", items.weaponParts],
  ];
  return {
    eyebrow: "Inventory · game paused",
    title: "Know your supplies",
    subtitle: "Collected items are stored here. Picking up fuel or a repair kit does not instantly refill a health or fuel bar. Scroll / swipe / D-pad up and down to read more.",
    facts: balances.map(([kind, amount]) => ({
      label: `${PICKUP_INFO[kind].icon} ${PICKUP_INFO[kind].name} · ${resourceAmount(amount)}${kind === "weaponPart" ? " collected this run" : " available"}`,
      detail: kind === "weaponPart" ? `${partsProgress(amount)}. Parts are counted, not lost when a boost is earned.` : PICKUP_INFO[kind].effect,
    })),
    body: `Use item: V / right mouse, R1 on controller, or tap / click Use item. Priority: repair a nearby damaged machine → heal yourself → fit an armor plate beside the Spider → deploy a mine.\nRefuel: hold R / controller Square beside the Spider; transfers reserve into its tank.\nEngineer level ${world.progress.level}: ${resourceAmount(world.progress.xp)} / ${world.progress.xpToNext} XP toward level ${world.progress.level + 1}. XP earns upgrade choices; weapon Mk is a separate workshop upgrade rank.\nHealth and tank bars show current / maximum. Trail is enemy pressure out of 100. Stage % is distance travelled, not enemies defeated. Build-card prices spend Scrap; their Key labels are shortcuts. Gun heat is not ammunition.`,
    options: [{ id: "resume", label: "Back" }],
  };
}
