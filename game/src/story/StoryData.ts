export type Chapter = 1 | 2 | 3 | 4;
export type StoryWeapon = "rifle" | "laser" | "rocket" | "flame";
export type StoryEnemyKind = "broodling" | "jumper" | "shellback" | "husk" | "stitcher" | "queen";
export type Point = { x: number; z: number };
export const STORY_LIMITS = { enemies: 48, projectiles: 96, effects: 120, pickups: 100, stones: 3, turrets: 6 } as const;
export const COW_NAMES = ["Clover", "Pip", "Daisy", "Button", "Maple", "Moss"] as const;
export const STORY_WEAPONS: Record<StoryWeapon, { name: string; damage: number; interval: number; range: number; heat: number; color: number; role: string }> = {
  rifle: { name: "Rivet Rifle", damage: 13, interval: 0.36, range: 17, heat: 0, color: 0xffd56c, role: "Reliable automatic fire · unlimited" },
  laser: { name: "Piercing Laser", damage: 28, interval: 0.85, range: 24, heat: 0.23, color: 0x66f3ff, role: "Pierces a line · walls stop the beam" },
  rocket: { name: "Quarry Rocket", damage: 46, interval: 1.35, range: 23, heat: 0.3, color: 0xffa24f, role: "5 m explosion · clears clusters" },
  flame: { name: "Webburner", damage: 7, interval: 0.15, range: 10, heat: 0.055, color: 0xff713a, role: "Short cone · burns silk and enemies" },
};
export const STORY_ENEMIES: Record<StoryEnemyKind, { name: string; hp: number; speed: number; radius: number; damage: number; color: number }> = {
  broodling: { name: "Broodling", hp: 24, speed: 2.5, radius: 0.65, damage: 6, color: 0xd08a46 },
  jumper: { name: "One-leap Jumper", hp: 28, speed: 2.9, radius: 0.65, damage: 7, color: 0x55d5d5 },
  shellback: { name: "Shellback", hp: 68, speed: 1.8, radius: 0.9, damage: 10, color: 0xa96239 },
  husk: { name: "Webbound Husk", hp: 48, speed: 1.5, radius: 0.65, damage: 9, color: 0xe7e8cf },
  stitcher: { name: "Stitcher", hp: 80, speed: 2.15, radius: 0.8, damage: 12, color: 0xb7a0cf },
  queen: { name: "The Silk Queen", hp: 1250, speed: 0, radius: 3.2, damage: 24, color: 0x9964bf },
};
export const CHAPTERS: Record<Chapter, { title: string; subtitle: string; briefing: string; ending: string; goal: string; color: number }> = {
  1: { title: "Bellflower Hill", subtitle: "Chapter 1 · Protect the herd", color: 0x81975d,
    briefing: "Three cows vanished from the outer pasture before dawn. Keep the six cows on this hill safe. Stand by the gold launcher and release a stone down the spiral; gather fallen shell parts to make more. At 10 and 20 defeats, shell armor adds 15 health and strengthens your next stones.",
    ending: "The inner pasture is quiet again. Beyond the fence, raiders drag the missing cows toward the old quarry. The cows you protected stay safe here. Follow those bells—we can still bring the others home.", goal: "Defend the herd · defeat 40 attackers" },
  2: { title: "The Tanglewood Maze", subtitle: "Chapter 2 · Follow the bells", color: 0x477d72,
    briefing: "The Iron Spider will take the wide road around the forest. Find the holding pen inside this maze, free its cows, then reach the northeast exit. White figures wear living silk: the Queen's parasites are moving old bodies. Supply crates offer a choice, not a mystery.",
    ending: "The first cows are safe with the rendezvous crew. The remaining bells echo inside the quarry. Your machine has reached the other entrance. It is time to break the nest.", goal: "Free the holding pen · reach the northeast exit" },
  3: { title: "The Silk Quarry", subtitle: "Chapter 3 · Break the nest", color: 0x8a748b,
    briefing: "The Silk Queen guards the last cage. Watch her gold warning circle, dodge the slam, then strike her exposed core. Rockets clear crowds; the laser pierces lines; the Webburner cuts through close swarms and silk. All special weapons cool automatically. The rifle never runs dry.",
    ending: "The nest falls silent. The last cows step into daylight and climb aboard the Iron Spider. Its cooling tank was cracked during the battle. One road remains: bring your companion and the herd back to Bellflower.", goal: "Defeat the Silk Queen · secure the cage" },
  4: { title: "The Homeward March", subtitle: "Chapter 4 · Bring everyone home", color: 0xa59a64,
    briefing: "The rescued cows are aboard. Scout freely, collect supplies and keep the Iron Spider alive. Stand near it and use E / the action button to repair with shell parts. You can place up to six permanent turrets. There is a repair stop halfway home, and one last ambush beyond it.",
    ending: "Every bell we brought home is another tomorrow. Rest now, old friend. You carried us all. All nine cows are together at Bellflower, and the Iron Spider folds its legs beside the farmhouse.", goal: "Escort the Iron Spider to Bellflower Gate" },
};
