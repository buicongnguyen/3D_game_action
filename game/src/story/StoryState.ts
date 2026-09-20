import type { Chapter, Point, StoryEnemyKind, StoryWeapon } from "./StoryData.ts";
export interface StoryEnemy extends Point {
  id: number; kind: StoryEnemyKind; hp: number; maxHp: number; heading: number; cooldown: number;
  path: number; jumped: boolean; jump: number; jumpFrom: number; burn: number; burnDps: number;
  playerLootCredit?: boolean;
}
export interface StoryCow extends Point { name: string; hp: number; status: "safe" | "webbed" | "captured"; timer: number }
export interface StoryPickup extends Point { id: number; kind: "shell" | "supply"; amount: number }
export interface StoryEffect extends Point { kind: "shot" | "laser" | "flame" | "blast" | "web" | "warning" | "muzzle" | "impact" | "death"; toX: number; toZ: number; life: number; maxLife: number; radius: number; weapon?: StoryWeapon }
export interface StoryProjectile extends Point { dx: number; dz: number; life: number; damage: number; rocket: boolean; hit: number[] }
export interface StoryStone { t: number; size: number; hits: number[] }
export interface StoryTurret extends Point { cooldown: number }
export interface StoryProgress {
  safeAtFarm: number; missing: number; rescued: number; shells: number; damageLevel: number; volley: number; armorLevel: number;
  weapons: StoryWeapon[]; selected: StoryWeapon; chapter: Chapter;
}
export interface StoryCheckpoint { version: 1; seed: number; progress: StoryProgress }
export interface StoryInput { x: number; z: number; action: boolean; dodge: boolean; aimX?: number; aimZ?: number }
export const IDLE_STORY_INPUT: StoryInput = { x: 0, z: 0, action: false, dodge: false };
export type StoryStatus = "briefing" | "playing" | "upgrade" | "complete" | "defeat" | "victory";
export interface StoryState {
  seed: number; chapter: Chapter; status: StoryStatus; time: number; chapterTime: number;
  progress: StoryProgress;
  player: Point & { hp: number; maxHp: number; heading: number; cooldown: number; heat: number; invincible: number; dodge: number; speed: number };
  machine: Point & { hp: number; maxHp: number; fuel: number; distance: number; heading: number; speed: number; rest: number; rested: boolean };
  cows: StoryCow[]; enemies: StoryEnemy[]; pickups: StoryPickup[]; effects: StoryEffect[]; projectiles: StoryProjectile[]; stones: StoryStone[]; turrets: StoryTurret[];
  spawned: number; killed: number; wave: number; spawnClock: number; waveRest: number; stoneCooldown: number;
  penOpen: boolean; crates: boolean[]; pendingCrate: number; queenPhase: "warning" | "open" | "brood"; queenClock: number; slam: Point;
  bossDefeated: boolean; rescueSecured: boolean; message: string; messageTime: number; receipt: string; receiptTime: number;
  selectedAction: "context" | "turret"; reason: string;
}
