import type { GameWorld } from "../game/GameWorld.ts";

export type Specialization = "engineer" | "convoy" | "assault";
export type AidOutcome = "success" | "declined" | "failed";
export interface CampaignState {
  specialization: Specialization | null;
  outcomes: Record<string, AidOutcome>;
  finalAidClaimed: boolean;
}
export const createCampaignState = (): CampaignState => ({ specialization: null, outcomes: {}, finalAidClaimed: false });

export const SPECIALIZATIONS = [
  { id: "engineer", name: "Field Engineer", reward: "Construction costs −15% · repairs +30%", tradeoff: "Personal weapon damage −10%" },
  { id: "convoy", name: "Convoy Commander", reward: "Crawler Tank unlocked now · turret range +20%", tradeoff: "Construction costs +10%" },
  { id: "assault", name: "Assault Specialist", reward: "Personal damage +20% · rifle pierces 1 extra enemy", tradeoff: "Turret damage −15%" },
] as const;

export function chooseSpecialization(world: GameWorld, id: string): boolean {
  if (world.mode !== "expedition" || world.campaign.specialization ||
      !SPECIALIZATIONS.some((s) => s.id === id)) return false;
  world.campaign.specialization = id as Specialization;
  if (id === "engineer") {
    world.modifiers.structureCost *= 0.85;
    world.modifiers.repairPower *= 1.3;
    world.modifiers.playerDamage *= 0.9;
  } else if (id === "convoy") {
    world.modifiers.structureCost *= 1.1;
    world.modifiers.turretRange *= 1.2;
    if (!world.loadout.includes("crawlerTurret")) world.loadout.push("crawlerTurret");
  } else {
    world.modifiers.playerDamage *= 1.2;
    world.modifiers.riflePierceBonus++;
    world.modifiers.turretDamage *= 0.85;
  }
  return true;
}

export interface OperationDefinition {
  title: string;
  speaker: string;
  briefing: string;
  action: string;
  kind: "service" | "salvage" | "combat";
  target: number;
  timeout: number;
  pressure: number;
  reward: { kind: "scrap" | "fuel" | "repair"; amount: number };
  success: string;
}
export const OPERATIONS: Record<string, OperationDefinition> = {
  "seg.approach": { title: "Keep the heart beating", speaker: "Mara · Chief engineer",
    briefing: "This Spider carries the furnace-heart that can relight the city's defenses. Help me calibrate its cooling before we reach the broken streets.",
    action: "Stay inside the beacon to calibrate", kind: "service", target: 8, timeout: 35, pressure: 0.6,
    reward: { kind: "repair", amount: 25 }, success: "Mara: The heart is steady. You and this machine might just get us home." },
  "seg.mine": { title: "A voice in the workshop", speaker: "Nera · Route scout",
    briefing: "Ilya is trapped beneath a collapsed workshop door. Stop here and cover the lifting gear. He knows how to repair the settlements ahead.",
    action: "Stay inside the beacon to rescue Ilya", kind: "service", target: 18, timeout: 55, pressure: 1.35,
    reward: { kind: "scrap", amount: 24 }, success: "Ilya: I thought nobody was coming. My tools are yours; I'll help at the next safe stops." },
  "seg.flooded": { title: "Water for the valley", speaker: "Mara · Chief engineer",
    briefing: "The bridge pump is dead. Hold this control point while we restart it. The recovered coolant can refill the Spider.",
    action: "Stay inside the beacon to restart the pump", kind: "service", target: 22, timeout: 65, pressure: 1.35,
    reward: { kind: "fuel", amount: 25 }, success: "Mara: Water is moving again. The valley has another morning." },
  "seg.floodedShortcut": { title: "Spillway emergency", speaker: "Nera · Route scout",
    briefing: "This spillway still holds a reserve of coolant, but the exposed controls will take longer to restore. We can leave it and keep moving.",
    action: "Stay inside the beacon to open the spillway", kind: "service", target: 28, timeout: 65, pressure: 1.5,
    reward: { kind: "fuel", amount: 35 }, success: "Nera: The shortcut paid off. Coolant is flowing into the Spider." },
  "seg.badlands": { title: "Nera's hidden cache", speaker: "Nera · Route scout",
    briefing: "I buried spare parts here before the road fell. Collect the marked cache while the Spider waits; we cannot linger forever.",
    action: "Collect scrap around the beacon", kind: "salvage", target: 9, timeout: 40, pressure: 1,
    reward: { kind: "scrap", amount: 18 }, success: "Nera: You found it. Those parts will keep our guns working across the ridge." },
  "seg.mountain": { title: "The narrow passage", speaker: "Mara · Chief engineer",
    briefing: "The safe passage needs a guide cable. Cover the rigging crew at this beacon while they secure the traverse.",
    action: "Stay inside the beacon to secure the passage", kind: "service", target: 26, timeout: 70, pressure: 1.4,
    reward: { kind: "repair", amount: 45 }, success: "Mara: Cable secured. The crew patched our armor while the winch cooled." },
  "seg.flower": { title: "A moment among flowers", speaker: "Nera · Route scout",
    briefing: "A seed station still shelters this valley. We can make a short repair stop here. Fewer patrols use this road, but keep watch.",
    action: "Stay inside the beacon for field repairs", kind: "service", target: 10, timeout: 40, pressure: 0.25,
    reward: { kind: "repair", amount: 55 }, success: "Nera: Keep a packet of seeds. There should be something worth planting when we arrive." },
  "seg.scrapyard": { title: "Silence the factory relay", speaker: "Mara · Chief engineer",
    briefing: "The factory patrol guards a command relay. Defeat six attackers near the beacon while our crew cuts its signal. It will slow reinforcements for the rest of this road.",
    action: "Defeat enemies within 18 m of the beacon", kind: "combat", target: 6, timeout: 65, pressure: 1.5,
    reward: { kind: "scrap", amount: 35 }, success: "Mara: Relay silenced. The factory's reinforcement signal is weakening." },
  "seg.crystal": { title: "A light through the storm", speaker: "Nera · Route scout",
    briefing: "This unstable beacon can guide supply runners toward the final gate. Holding here is risky. Stabilize it, or take the road without the extra fuel.",
    action: "Stay inside the beacon to stabilize it", kind: "service", target: 30, timeout: 70, pressure: 1.55,
    reward: { kind: "fuel", amount: 40 }, success: "Nera: The runners can see us. One last march, Engineer." },
};

export const OPENING_STORY = "The city is losing power. Your Iron Spider carries the last furnace-heart capable of restoring its defenses. Escort it, gather supplies, and decide who you can help along the road. The Spider is your travelling home—keep it alive.";

export function campaignArrival(world: GameWorld, fallback: { speaker: string; text: string } | undefined) {
  if (world.mode !== "expedition" || !fallback) return fallback;
  const rescued = world.campaign.outcomes["seg.mine"] === "success";
  const result = world.campaign.outcomes[world.route.segment?.id ?? ""];
  return { speaker: fallback.speaker, text: fallback.text +
    (result === "success" ? " Your help on this road will be remembered at the final gate." :
      result === "failed" ? " We could not finish the roadside operation. The expedition still has a chance." : "") +
    (rescued ? " Ilya is aboard: he repairs up to 15 integrity at each safe stop." : "") };
}
