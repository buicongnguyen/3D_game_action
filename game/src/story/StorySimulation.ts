import { Random } from "../core/Random.ts";
import { CHAPTERS, COW_NAMES, STORY_ENEMIES, STORY_LIMITS, STORY_WEAPONS, type Chapter, type Point, type StoryEnemyKind, type StoryWeapon } from "./StoryData.ts";
import { blocked, clearLine, groundHeight, HILL_LAUNCH, HOME_LENGTH, homePoint, MAZE_CRATES, MAZE_EXIT, MAZE_PEN, MAZE_START, mazeCell, mazeDistances, mazeWaypoint, spiralPoint, cellPoint, SPIRAL_JUMP } from "./StoryMaps.ts";
import { IDLE_STORY_INPUT, type StoryCheckpoint, type StoryEnemy, type StoryInput, type StoryProgress, type StoryState } from "./StoryState.ts";
import { validStoryCheckpoint } from "./StorySave.ts";

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export function segmentDistance(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x, dz = b.z - a.z, d = dx * dx + dz * dz;
  const t = d ? clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / d, 0, 1) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
}
/** Same cone/range falloff used by the tank game's flame; independent of visuals and frame rate. */
export function storyFlameExposure(origin: Point, heading: number, target: Point): number {
  const dx = target.x - origin.x, dz = target.z - origin.z, range = Math.hypot(dx, dz);
  if (range > 10 || range > 0 && (dx * Math.sin(heading) + dz * Math.cos(heading)) / range < Math.cos(Math.PI * 35 / 180)) return 0;
  return 1 - 0.55 * range / 10;
}

export class StorySimulation {
  state!: StoryState;
  checkpoint!: StoryCheckpoint;
  private random!: Random;
  private nextId = 1;
  private flowCell = -1;
  private flow = mazeDistances(MAZE_START);
  constructor(seed = 71309, checkpoint?: StoryCheckpoint | null) {
    const progress: StoryProgress = checkpoint && validStoryCheckpoint(checkpoint) ? copy(checkpoint.progress) : {
      safeAtFarm: 6, missing: 3, rescued: 0, shells: 5, damageLevel: 0, volley: 1, armorLevel: 0, weapons: ["rifle"], selected: "rifle", chapter: 1,
    };
    this.enter(progress, checkpoint && validStoryCheckpoint(checkpoint) ? checkpoint.seed : seed);
  }
  private enter(progress: StoryProgress, seed: number): void {
    const chapter = progress.chapter;
    this.random = new Random(seed + chapter * 7919); this.nextId = 1; this.flowCell = -1;
    if (chapter >= 2 && !progress.weapons.includes("laser")) progress.weapons.push("laser");
    if (chapter >= 3) for (const weapon of ["rocket", "flame"] as const) if (!progress.weapons.includes(weapon)) progress.weapons.push(weapon);
    const machine = chapter === 1 ? { x: 0, z: -2 } : chapter === 2 ? { x: -34, z: 24 } : chapter === 3 ? { x: 0, z: 24 } : homePoint(0);
    const player = chapter === 1 ? { x: 7, z: 3 } : chapter === 2 ? MAZE_START : { x: machine.x + 6, z: machine.z };
    this.state = {
      seed, chapter, status: "briefing", time: 0, chapterTime: 0, progress,
      player: { ...player, hp: 100 + progress.armorLevel * 15, maxHp: 100 + progress.armorLevel * 15, heading: Math.PI, cooldown: 0, heat: 0, invincible: 0, dodge: 0, speed: 0 },
      machine: { ...machine, hp: 320, maxHp: 320, fuel: chapter === 4 ? 55 : 100, distance: 0, heading: Math.PI, speed: 0, rest: 0, rested: false },
      cows: COW_NAMES.map((name, i) => ({ name, x: -4 + (i % 3) * 3, z: 3 + Math.floor(i / 3) * 2.6, hp: 50, status: "safe", timer: 0 })),
      enemies: [], pickups: [], effects: [], projectiles: [], stones: [], turrets: [],
      spawned: 0, killed: 0, wave: 1, spawnClock: 3, waveRest: 0, stoneCooldown: 0,
      penOpen: false, crates: [false, false, false], pendingCrate: -1,
      queenPhase: "warning", queenClock: 3, slam: { x: player.x, z: player.z }, bossDefeated: false, rescueSecured: false,
      message: "", messageTime: 0, receipt: "", receiptTime: 0, selectedAction: "context", reason: "",
    };
    this.checkpoint = { version: 1, seed, progress: copy(progress) };
    if (chapter === 2) {
      for (const [i, p] of [cellPoint(5, 11), cellPoint(9, 9), cellPoint(3, 5), cellPoint(11, 3), cellPoint(13, 7), cellPoint(7, 3)].entries()) this.spawn(i % 2 ? "husk" : "broodling", p);
    }
    if (chapter === 3) this.spawn("queen", { x: 0, z: -10 });
    if (chapter === 4) for (const d of [12, 28, 43, 64, 83, 103]) {
      const p = homePoint(d); this.pickup("supply", { x: p.x + (d % 2 ? 5 : -5), z: p.z }, 15);
    }
  }
  start(): void { if (this.state.status === "briefing") this.state.status = "playing"; }
  retry(): void { this.enter(copy(this.checkpoint.progress), this.checkpoint.seed); }
  nextChapter(): boolean {
    const s = this.state;
    if (s.status !== "complete" || s.chapter >= 4) return false;
    const progress = copy(s.progress); progress.chapter = (s.chapter + 1) as Chapter; progress.shells += 12;
    this.enter(progress, s.seed); return true;
  }
  selectWeapon(weapon: StoryWeapon): boolean {
    if (!this.state.progress.weapons.includes(weapon)) return false;
    this.state.progress.selected = weapon; return true;
  }
  cycleWeapon(): void {
    const p = this.state.progress;
    this.selectWeapon(p.weapons[(p.weapons.indexOf(p.selected) + 1) % p.weapons.length]);
  }
  chooseUpgrade(choice: "volley" | "damage" | "armor"): boolean {
    const s = this.state;
    if (s.status !== "upgrade" || s.pendingCrate < 0 || s.crates[s.pendingCrate]) return false;
    if (choice === "volley" && s.progress.volley < 3) { s.progress.volley++; this.receipt(`Projectiles per rifle shot: ${s.progress.volley - 1} → ${s.progress.volley}`); }
    else if (choice === "damage" && s.progress.damageLevel < 3) { s.progress.damageLevel++; this.receipt(`Weapon damage: +${s.progress.damageLevel * 20}% total`); }
    else if (choice === "armor" && s.progress.armorLevel < 3) { s.progress.armorLevel++; s.player.maxHp += 15; s.player.hp = Math.min(s.player.maxHp, s.player.hp + 15); this.receipt("Armor fitted: +15 maximum health"); }
    else return false;
    s.crates[s.pendingCrate] = true; s.pendingCrate = -1; s.status = "playing"; return true;
  }
  closeUpgrade(): void { if (this.state.status === "upgrade") { this.state.pendingCrate = -1; this.state.status = "playing"; } }
  actionLabel(): string {
    const s = this.state, p = s.player;
    if (s.chapter === 1) {
      const cow = s.cows.find(c => c.status === "webbed" && distance(c, p) <= 3.2);
      if (cow) return `Free ${cow.name}`;
      if (distance(p, HILL_LAUNCH) <= 4.5) return s.stoneCooldown > 0 ? "Launcher cooling" : s.progress.shells < 5 ? "Stone needs 5 shell parts" : "Launch stone · 5 parts";
      return "Go to gold stone launcher";
    }
    if (s.chapter === 2) {
      if (!s.penOpen && distance(p, MAZE_PEN) <= 3) return "Open cow holding pen";
      if (MAZE_CRATES.some((c, i) => !s.crates[i] && distance(p, c) <= 2.8)) return "Open upgrade crate";
      if (distance(p, MAZE_EXIT) <= 3) return s.penOpen ? "Leave for the quarry" : "Free the holding pen first";
      return "Find the pen / upgrade crates";
    }
    if (s.chapter === 3) return s.bossDefeated ? distance(p, { x: 0, z: -23 }) <= 4 ? "Secure the rescued cows" : "Go to the gold cow cage" : "Defeat the Queen first";
    if (s.selectedAction === "turret") return s.turrets.length >= STORY_LIMITS.turrets ? "Turret limit reached" : "Deploy turret · 8 parts";
    return distance(p, s.machine) <= 9 ? s.machine.hp >= s.machine.maxHp ? "Spider fully repaired" : s.progress.shells < 5 ? "Repair needs 5 parts" : "Repair Spider · 5 parts" : "Move near Spider to repair";
  }
  canAct(): boolean {
    const s = this.state, p = s.player;
    if (s.status !== "playing") return false;
    if (s.chapter === 1) return s.cows.some(c => c.status === "webbed" && distance(c, p) <= 3.2) ||
      distance(p, HILL_LAUNCH) <= 4.5 && s.progress.shells >= 5 && s.stoneCooldown <= 0 && s.stones.length < STORY_LIMITS.stones;
    if (s.chapter === 2) return !s.penOpen && distance(p, MAZE_PEN) <= 3 || s.penOpen && distance(p, MAZE_EXIT) <= 3 ||
      MAZE_CRATES.some((c, i) => !s.crates[i] && distance(p, c) <= 2.8);
    if (s.chapter === 3) return s.bossDefeated && distance(p, { x: 0, z: -23 }) <= 4;
    return s.selectedAction === "turret" ? s.progress.shells >= 8 && s.turrets.length < STORY_LIMITS.turrets && s.turrets.every(t => distance(t, p) > 2) :
      distance(p, s.machine) <= 9 && s.machine.hp < s.machine.maxHp && s.progress.shells >= 5;
  }
  act(): boolean {
    const s = this.state, p = s.player;
    if (s.status !== "playing") return false;
    if (s.chapter === 1) {
      const cow = s.cows.find(c => c.status === "webbed" && distance(c, p) <= 3.2);
      if (cow) { cow.status = "safe"; cow.hp = 35; cow.timer = 0; this.receipt(`${cow.name} freed · back in the herd`); return true; }
      if (distance(p, HILL_LAUNCH) <= 4.5 && s.progress.shells >= 5 && s.stoneCooldown <= 0 && s.stones.length < STORY_LIMITS.stones) {
        s.progress.shells -= 5; s.stoneCooldown = 3; s.stones.push({ t: 1, size: 1 + s.progress.armorLevel * 0.15, hits: [] });
        this.receipt("−5 shell parts · rolling stone launched"); return true;
      }
    } else if (s.chapter === 2) {
      if (!s.penOpen && distance(p, MAZE_PEN) <= 3) {
        s.penOpen = true; s.progress.rescued = Math.ceil(s.progress.missing / 2); this.receipt(`${s.progress.rescued} cows freed · rendezvous crew is taking them to safety`); return true;
      }
      for (let i = 0; i < MAZE_CRATES.length; i++) if (!s.crates[i] && distance(p, MAZE_CRATES[i]) <= 2.8) { s.pendingCrate = i; s.status = "upgrade"; return true; }
      if (s.penOpen && distance(p, MAZE_EXIT) <= 3) { s.status = "complete"; return true; }
    } else if (s.chapter === 3 && s.bossDefeated && distance(p, { x: 0, z: -23 }) <= 4) {
      s.progress.rescued = s.progress.missing; s.rescueSecured = true; s.status = "complete"; return true;
    } else if (s.chapter === 4) {
      if (s.selectedAction === "turret" && s.progress.shells >= 8 && s.turrets.length < STORY_LIMITS.turrets && s.turrets.every(t => distance(t, p) > 2)) {
        s.progress.shells -= 8; s.turrets.push({ x: p.x, z: p.z, cooldown: 0 }); this.receipt("−8 parts · permanent Rivet Turret deployed"); s.selectedAction = "context"; return true;
      }
      if (s.selectedAction === "context" && distance(p, s.machine) <= 9 && s.machine.hp < s.machine.maxHp && s.progress.shells >= 5) {
        s.progress.shells -= 5; s.machine.hp = Math.min(s.machine.maxHp, s.machine.hp + 45); this.receipt("−5 parts · Spider repaired +45 health"); return true;
      }
    }
    this.message(this.actionLabel()); return false;
  }
  /** Public for deterministic scenario construction; never spawns beyond the fixed population budget. */
  spawn(kind: StoryEnemyKind, p: Point, path = 0): StoryEnemy | null {
    const s = this.state, def = STORY_ENEMIES[kind];
    if (s.enemies.length >= STORY_LIMITS.enemies) return null;
    const e: StoryEnemy = { ...p, id: this.nextId++, kind, hp: def.hp, maxHp: def.hp, heading: 0, cooldown: 0.5, path, jumped: false, jump: 0, jumpFrom: 0, burn: 0, burnDps: 0 };
    s.enemies.push(e); return e;
  }
  hit(enemy: StoryEnemy, damage: number, playerCredit = false): void {
    const s = this.state;
    if (!Number.isFinite(damage) || damage <= 0 || enemy.hp <= 0 || !s.enemies.includes(enemy)) return;
    if (playerCredit) enemy.playerLootCredit = true;
    enemy.hp -= damage * (enemy.kind === "queen" && s.queenPhase !== "open" ? 0.45 : 1);
    if (enemy.hp > 0) return;
    s.enemies.splice(s.enemies.indexOf(enemy), 1); s.killed++;
    if (s.chapter === 1 && (s.killed === 10 || s.killed === 20) && s.progress.armorLevel < 3) {
      s.progress.armorLevel++; s.player.maxHp += 15; s.player.hp = Math.min(s.player.maxHp, s.player.hp + 15);
      this.message(`Shell armor fitted: +15 maximum health. New stones are ${Math.round(s.progress.armorLevel * 15)}% larger.`);
    }
    this.effect(enemy.kind === "queen" ? "blast" : "death", enemy, enemy, 0.3, enemy.kind === "queen" ? 6 : 1.1);
    if (enemy.kind === "queen") {
      s.bossDefeated = true; s.enemies.length = 0; s.effects = s.effects.filter(e => e.kind !== "web" && e.kind !== "warning");
      this.message("The Queen is defeated. Secure the cows at the gold cage.");
    } else {
      const amount = enemy.kind === "shellback" || enemy.kind === "stitcher" ? 2 : 1;
      if (enemy.playerLootCredit && distance(enemy, s.player) > 3.2) this.awardPickup("shell", amount, true);
      else this.pickup("shell", enemy, amount);
    }
  }
  private pickup(kind: "shell" | "supply", p: Point, amount: number): void {
    if (this.state.pickups.length >= STORY_LIMITS.pickups) {
      const old = this.state.pickups.find(v => v.kind === kind);
      if (old) old.amount += amount;
      return;
    }
    this.state.pickups.push({ ...p, kind, amount, id: this.nextId++ });
  }
  private receipt(text: string): void { this.state.receipt = text; this.state.receiptTime = 3; }
  private message(text: string): void { this.state.message = text; this.state.messageTime = 4; }
  private effect(kind: StoryState["effects"][number]["kind"], p: Point, end: Point, life: number, radius: number, weapon?: StoryWeapon): void {
    const effects = this.state.effects;
    if (effects.length >= STORY_LIMITS.effects) {
      const old = effects.findIndex(e => e.kind !== "web" && e.kind !== "warning");
      if (old < 0) return; effects.splice(old, 1);
    }
    effects.push({ ...p, kind, toX: end.x, toZ: end.z, life, maxLife: life, radius, weapon });
  }
  step(dt: number, input: StoryInput = IDLE_STORY_INPUT): void {
    if (!Number.isFinite(dt) || dt <= 0 || this.state.status !== "playing") return;
    // Fixed subdivisions also make headless tests at 30/60/120 Hz comparable.
    const steps = Math.ceil(Math.min(dt, 0.25) * 120), slice = Math.min(dt, 0.25) / steps;
    for (let i = 0; i < steps && this.state.status === "playing"; i++) this.tick(slice, i ? { ...input, action: false, dodge: false } : input);
  }
  private tick(dt: number, input: StoryInput): void {
    const s = this.state, p = s.player;
    s.time += dt; s.chapterTime += dt; s.messageTime -= dt; s.receiptTime -= dt; s.stoneCooldown -= dt;
    p.cooldown -= dt; p.invincible -= dt; p.dodge -= dt; p.heat = Math.max(0, p.heat - dt * 0.24);
    s.effects = s.effects.filter(e => (e.life -= dt) > 0);
    this.movePlayer(dt, input);
    if (input.action) { this.act(); if (s.status !== "playing") return; }
    this.collect();
    this.direct(dt);
    if (s.chapter === 3 && !s.bossDefeated) this.boss(dt);
    this.moveEnemies(dt);
    if (s.status !== "playing") return;
    this.fire(); this.projectiles(dt); this.rollStones(dt); this.turrets(dt);
    if (s.chapter === 1) this.herd(dt);
    if (s.chapter === 4) this.escort(dt);
    if (p.hp <= 0 || s.machine.hp <= 0) this.fail(p.hp <= 0 ? "The engineer needs help. Retry this chapter with your starting supplies." : "The Iron Spider needs repairs. Retry this chapter.");
  }
  private movePlayer(dt: number, input: StoryInput): void {
    const s = this.state, p = s.player;
    let x = Number.isFinite(input.x) ? input.x : 0, z = Number.isFinite(input.z) ? input.z : 0;
    const mag = Math.hypot(x, z); if (mag > 1) { x /= mag; z /= mag; }
    if (input.dodge && p.dodge <= -0.9 && mag > 0.1) { p.dodge = 0.22; p.invincible = 0.3; }
    const webbed = s.effects.some(e => e.kind === "web" && distance(e, p) < e.radius);
    const speed = (p.dodge > 0 ? 15 : 6.5) * (webbed ? 0.6 : 1);
    const oldX = p.x, oldZ = p.z;
    if (!blocked(s.chapter, p.x + x * speed * dt, p.z)) p.x += x * speed * dt;
    if (!blocked(s.chapter, p.x, p.z + z * speed * dt)) p.z += z * speed * dt;
    p.speed = Math.hypot(p.x - oldX, p.z - oldZ) / dt;
    if (mag > 0.1) p.heading = Math.atan2(x, z);
  }
  private collect(): void {
    const s = this.state;
    for (let i = s.pickups.length - 1; i >= 0; i--) {
      const drop = s.pickups[i];
      if (distance(drop, s.player) > 3.2 || !clearLine(s.chapter, drop, s.player)) continue;
      this.awardPickup(drop.kind, drop.amount);
      s.pickups.splice(i, 1);
    }
  }
  private awardPickup(kind: "shell" | "supply", amount: number, remote = false): void {
    const s = this.state, gained = Math.min(amount, 10000 - s.progress.shells);
    s.progress.shells += gained;
    if (kind === "supply") {
      const fuel = Math.min(20, 100 - s.machine.fuel), health = Math.min(20, s.player.maxHp - s.player.hp);
      s.machine.fuel += fuel; s.player.hp += health;
      this.receipt(`Supply diamond: +${gained} parts · +${Math.round(fuel * 10) / 10} fuel · +${Math.round(health * 10) / 10} health`);
    } else this.receipt(`${remote ? "Auto-collected · " : "Gold coin · "}+${gained} shell part${gained === 1 ? "" : "s"} · ${s.progress.shells} stored`);
  }
  private direct(dt: number): void {
    const s = this.state; s.spawnClock -= dt;
    if (s.chapter === 1) {
      if (s.spawned === s.wave * 10 && !s.enemies.length && s.wave < 4) {
        if (!s.waveRest) { s.waveRest = 6; this.message(`Wave ${s.wave} cleared · gather parts before the next attack`); }
        s.waveRest -= dt;
        if (s.waveRest <= 0) { s.wave++; s.waveRest = 0; s.spawnClock = 1; }
      }
      if (s.spawnClock <= 0 && s.spawned < s.wave * 10 && s.spawned < 40) {
        const kind: StoryEnemyKind = s.wave >= 3 && s.spawned % 5 === 0 ? "shellback" : s.wave >= 2 && s.spawned % 3 === 0 ? "jumper" : "broodling";
        if (this.spawn(kind, spiralPoint(0))) { s.spawned++; s.spawnClock = 0.85; }
      }
    } else if (s.chapter === 2 && s.spawned < 14 && s.enemies.length < 12 && s.spawnClock <= 0) {
      const p = [cellPoint(13, 13), cellPoint(1, 1), cellPoint(11, 11)][s.spawned % 3];
      if (distance(p, s.player) > 9) { this.spawn(s.spawned % 2 ? "husk" : "broodling", p); s.spawned++; }
      s.spawnClock = 7;
    } else if (s.chapter === 4 && s.machine.distance > 8 && s.machine.rest <= 0 && s.spawnClock <= 0 && s.spawned < 44 && s.enemies.length < 18) {
      const index = s.spawned % 4;
      const kind: StoryEnemyKind = s.machine.distance > 78 && index === 0 ? "stitcher" : index === 1 ? "husk" : index === 2 ? "jumper" : "broodling";
      this.spawn(kind, { x: s.machine.x + (s.spawned % 2 ? 19 : -19), z: s.machine.z + this.random.signed(13) });
      s.spawned++; s.spawnClock = s.machine.distance > 78 ? 1.7 : 3.4;
    }
  }
  private moveEnemies(dt: number): void {
    const s = this.state;
    if (s.chapter === 2 && mazeCell(s.player) !== this.flowCell) { this.flowCell = mazeCell(s.player); this.flow = mazeDistances(s.player); }
    for (const e of [...s.enemies]) {
      if (e.hp <= 0) continue;
      if (e.burn > 0) { const t = Math.min(dt, e.burn); e.burn -= t; this.hit(e, e.burnDps * t); if (e.hp <= 0) continue; }
      if (e.kind === "queen") continue;
      e.cooldown -= dt;
      const def = STORY_ENEMIES[e.kind];
      if (s.chapter === 1 && e.path < 1) {
        if (e.kind === "jumper" && !e.jumped && e.path >= 0.23) { e.jumped = true; e.jump = 1.5; e.jumpFrom = e.path; }
        if (e.jump > 0) {
          e.jump = Math.max(0, e.jump - dt);
          if (e.jump < 1) e.path = Math.min(1, e.jumpFrom + SPIRAL_JUMP * (1 - e.jump));
        } else e.path = Math.min(1, e.path + def.speed * dt / 265);
        let target = spiralPoint(e.path);
        if (e.jump > 0 && e.jump < 1) {
          const from = spiralPoint(e.jumpFrom), to = spiralPoint(Math.min(1, e.jumpFrom + SPIRAL_JUMP));
          target = { x: from.x + (to.x - from.x) * (1 - e.jump), z: from.z + (to.z - from.z) * (1 - e.jump) };
        }
        e.heading = Math.atan2(target.x - e.x, target.z - e.z); Object.assign(e, target); continue;
      }
      let target: Point = s.player;
      let cow = s.chapter === 1 ? s.cows.filter(c => c.status === "safe").sort((a, b) => distance(a, e) - distance(b, e))[0] : undefined;
      if (cow && distance(e, s.player) > 2) target = cow;
      if (s.chapter === 4 && distance(e, s.machine) < distance(e, s.player) + 4) target = s.machine;
      const attackRange = target === s.machine ? 5.2 : 1.2;
      if (distance(e, target) <= attackRange) {
        if (e.cooldown <= 0) {
          e.cooldown = 1.1;
          if (target === s.player) this.hurtPlayer(def.damage);
          else if (target === s.machine) s.machine.hp -= def.damage;
          else if (cow) { cow.hp -= def.damage; if (cow.hp <= 0) { cow.status = "webbed"; cow.timer = 12; this.message(`${cow.name} is webbed! Reach her and press the action button.`); } }
        }
        continue;
      }
      if (s.chapter === 2 && !clearLine(2, e, s.player)) target = mazeWaypoint(e, this.flow);
      const d = distance(e, target);
      if (d < 0.02) continue;
      const move = Math.min(d, def.speed * dt), dx = (target.x - e.x) / d, dz = (target.z - e.z) / d;
      e.heading = Math.atan2(dx, dz);
      if (!blocked(s.chapter, e.x + dx * move, e.z, 0.4)) e.x += dx * move;
      if (!blocked(s.chapter, e.x, e.z + dz * move, 0.4)) e.z += dz * move;
    }
  }
  private herd(dt: number): void {
    const s = this.state;
    for (const cow of s.cows) if (cow.status === "webbed") {
      cow.timer -= dt;
      if (cow.timer <= 0) { cow.status = "captured"; this.message(`${cow.name} was carried away. She can still be rescued in the forest.`); }
    }
    const safe = s.cows.filter(c => c.status !== "captured").length;
    if (!safe) { this.fail("The inner pasture was overrun. Retry Bellflower Hill and free webbed cows before the timer ends."); return; }
    if (s.killed >= 40 && s.spawned === 40 && !s.enemies.length) {
      for (const cow of s.cows) if (cow.status === "webbed") { cow.status = "safe"; cow.hp = 35; }
      s.progress.safeAtFarm = safe; s.progress.missing = 9 - safe; s.status = "complete";
    }
  }
  private fire(): void {
    const s = this.state, p = s.player, weapon = s.progress.selected, def = STORY_WEAPONS[weapon];
    if (p.cooldown > 0 || p.dodge > 0 || p.heat + def.heat > 1) return;
    let target: StoryEnemy | undefined, nearest = def.range + 1;
    for (const e of s.enemies) {
      const d = distance(e, p);
      if (e.hp > 0 && d <= def.range && d < nearest && clearLine(s.chapter, p, e)) { target = e; nearest = d; }
    }
    if (!target) return;
    p.heading = Math.atan2(target.x - p.x, target.z - p.z); p.cooldown = def.interval; p.heat += def.heat;
    this.effect("muzzle", p, target, 0.16, 1, weapon);
    const damage = def.damage * (1 + s.progress.damageLevel * 0.2);
    if (weapon === "laser") {
      let end = { x: p.x + Math.sin(p.heading) * def.range, z: p.z + Math.cos(p.heading) * def.range };
      for (let d = 0.5; d <= def.range; d += 0.5) {
        const q = { x: p.x + Math.sin(p.heading) * d, z: p.z + Math.cos(p.heading) * d };
        if (blocked(s.chapter, q.x, q.z, 0.04)) { end = q; break; }
      }
      for (const e of [...s.enemies]) if (segmentDistance(p, end, e) <= STORY_ENEMIES[e.kind].radius + 0.2 && clearLine(s.chapter, p, e)) this.hit(e, damage, true);
      this.effect("laser", p, end, 0.16, 0.12);
    } else if (weapon === "flame") {
      for (const e of [...s.enemies]) {
        const factor = storyFlameExposure(p, p.heading, e);
        if (!factor || !clearLine(s.chapter, p, e)) continue;
        this.hit(e, damage * factor, true); if (e.hp > 0) { e.burn = 2; e.burnDps = Math.max(e.burnDps, 12 * factor * (1 + s.progress.damageLevel * 0.2)); }
      }
      s.effects = s.effects.filter(e => e.kind !== "web" || storyFlameExposure(p, p.heading, e) === 0);
      for (let i = -2; i <= 2; i++) { const a = p.heading + i * 0.22; this.effect("flame", p, { x: p.x + Math.sin(a) * 9, z: p.z + Math.cos(a) * 9 }, 0.22, 0.7); }
    } else {
      const shots = weapon === "rifle" ? s.progress.volley : 1;
      for (let i = 0; i < shots && s.projectiles.length < STORY_LIMITS.projectiles; i++) {
        const a = p.heading + (i - (shots - 1) / 2) * 0.10;
        s.projectiles.push({ x: p.x, z: p.z, dx: Math.sin(a), dz: Math.cos(a), damage, rocket: weapon === "rocket", life: def.range / (weapon === "rocket" ? 17 : 35), hit: [] });
      }
    }
  }
  private projectiles(dt: number): void {
    const s = this.state;
    for (let i = s.projectiles.length - 1; i >= 0; i--) {
      const p = s.projectiles[i], old = { x: p.x, z: p.z }, speed = p.rocket ? 17 : 35;
      p.x += p.dx * speed * dt; p.z += p.dz * speed * dt; p.life -= dt;
      const wall = !clearLine(s.chapter, old, p);
      const hit = wall ? undefined : s.enemies.filter(e => e.hp > 0 && segmentDistance(old, p, e) <= STORY_ENEMIES[e.kind].radius + 0.15).sort((a, b) => distance(a, old) - distance(b, old))[0];
      if (hit || wall || p.life <= 0) {
        if (p.rocket) {
          for (const e of [...s.enemies]) if (distance(e, p) <= 5 + STORY_ENEMIES[e.kind].radius && clearLine(s.chapter, p, e)) this.hit(e, p.damage, true);
          this.effect("blast", p, p, 0.45, 5);
        } else if (hit) { this.hit(hit, p.damage, true); this.effect("impact", hit, hit, 0.2, 1); }
        s.projectiles.splice(i, 1);
      }
    }
  }
  private rollStones(dt: number): void {
    const s = this.state;
    for (let i = s.stones.length - 1; i >= 0; i--) {
      const stone = s.stones[i], old = spiralPoint(stone.t); stone.t -= dt * 0.075; const p = spiralPoint(stone.t);
      for (const e of [...s.enemies]) {
        if (stone.hits.includes(e.id) || e.jump > 0 && e.jump < 0.95) continue;
        if (segmentDistance(old, p, e) <= 2.4 * stone.size) { stone.hits.push(e.id); this.hit(e, 85); }
      }
      if (stone.t < 0) s.stones.splice(i, 1);
    }
  }
  private boss(dt: number): void {
    const s = this.state, queen = s.enemies.find(e => e.kind === "queen"); if (!queen) return;
    s.queenClock -= dt;
    if (s.queenClock > 0) return;
    if (s.queenPhase === "warning") {
      if (distance(s.player, s.slam) < 5.5) this.hurtPlayer(24);
      this.effect("blast", s.slam, s.slam, 0.5, 5.5); s.queenPhase = "open"; s.queenClock = 4;
      this.message("Core exposed! Strike the Queen now.");
    } else if (s.queenPhase === "open") {
      s.queenPhase = "brood"; s.queenClock = 5;
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; this.spawn(queen.hp < queen.maxHp * 0.55 && i === 0 ? "stitcher" : "broodling", { x: queen.x + Math.sin(a) * 5, z: queen.z + Math.cos(a) * 5 }); }
      if (queen.hp < queen.maxHp * 0.7) this.effect("web", { x: s.player.x + 2, z: s.player.z - 2 }, s.player, 9, 3);
    } else {
      s.queenPhase = "warning"; s.queenClock = 2; s.slam = { x: s.player.x, z: s.player.z };
      this.message("Slam incoming—leave the gold circle!");
    }
  }
  private turrets(dt: number): void {
    const s = this.state;
    for (const turret of s.turrets) {
      turret.cooldown -= dt; if (turret.cooldown > 0) continue;
      const enemy = s.enemies.find(e => e.hp > 0 && distance(e, turret) < 16);
      if (!enemy) continue;
      turret.cooldown = 0.65; this.effect("shot", turret, enemy, 0.12, 0.06); this.hit(enemy, 18 * (1 + s.progress.damageLevel * 0.2));
    }
  }
  private escort(dt: number): void {
    const s = this.state, m = s.machine;
    if (!m.rested && m.distance >= 55) {
      m.rested = true; m.rest = 7; m.hp = Math.min(m.maxHp, m.hp + 100); m.fuel = Math.min(100, m.fuel + 35);
      this.message("Rendezvous repair stop · +100 Spider health · +35 fuel");
    }
    m.rest = Math.max(0, m.rest - dt); m.speed = m.rest > 0 ? 0 : m.fuel > 0 ? 1.15 : 0.35;
    m.fuel = Math.max(0, m.fuel - dt * m.speed * 0.4);
    m.distance = Math.min(HOME_LENGTH, m.distance + dt * m.speed);
    const next = homePoint(m.distance); if (distance(m, next) > 0.0001) m.heading = Math.atan2(next.x - m.x, next.z - m.z); Object.assign(m, next);
    if (m.distance >= HOME_LENGTH) { s.status = "victory"; s.enemies.length = 0; s.projectiles.length = 0; m.speed = 0; }
  }
  private hurtPlayer(amount: number): void {
    if (this.state.player.invincible > 0) return;
    this.state.player.hp = Math.max(0, this.state.player.hp - amount); this.state.player.invincible = 0.55;
  }
  private fail(reason: string): void { this.state.status = "defeat"; this.state.reason = reason; this.state.machine.speed = 0; }
  objective(): string {
    const s = this.state;
    if (s.chapter === 1) return `Wave ${s.wave}/4 · attackers ${s.killed}/40 · cows safe ${s.cows.filter(c => c.status === "safe").length}/6`;
    if (s.chapter === 2) return `${s.penOpen ? "Pen secured—reach the northeast exit" : "Find the cow pen"} · ${s.progress.rescued}/${s.progress.missing} rescued`;
    if (s.chapter === 3) return s.bossDefeated ? "Queen defeated · secure the gold cage" : `Silk Queen · ${s.queenPhase === "open" ? "CORE EXPOSED" : s.queenPhase === "warning" ? "SLAM WARNING" : "Brood emerging"}`;
    return `Bellflower Gate · ${Math.round(s.machine.distance / HOME_LENGTH * 100)}% · ${s.progress.rescued} cows aboard`;
  }
  get title(): string { return CHAPTERS[this.state.chapter].title; }
  height(p: Point): number { return groundHeight(this.state.chapter, p.x, p.z); }
}
