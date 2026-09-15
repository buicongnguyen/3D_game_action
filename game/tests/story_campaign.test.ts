import { describe, expect, it } from "vitest";
import { STORY_LIMITS } from "../src/story/StoryData.ts";
import { blocked, clearLine, groundHeight, HILL_LAUNCH, HOME_LENGTH, MAZE, MAZE_CRATES, MAZE_EXIT, MAZE_PEN, MAZE_START, mazeCell, mazeDistances, spiralPoint } from "../src/story/StoryMaps.ts";
import { StorySimulation, storyFlameExposure } from "../src/story/StorySimulation.ts";
import { loadStoryCheckpoint, saveStoryCheckpoint, STORY_SAVE_KEY, validStoryCheckpoint } from "../src/story/StorySave.ts";
import type { Chapter } from "../src/story/StoryData.ts";

function chapter(n: Chapter): StorySimulation {
  const sim = new StorySimulation(73);
  while (sim.state.chapter < n) { sim.state.status = "complete"; sim.nextChapter(); }
  sim.start(); return sim;
}
function step(sim: StorySimulation, seconds: number, hz = 60): void { for (let i = 0; i < seconds * hz; i++) sim.step(1 / hz); }

describe("Homeward foundation and maps", () => {
  it("grows armor and stones at two explicit hill milestones, without duplicate rewards", () => {
    const sim = chapter(1);
    for (let i = 0; i < 20; i++) { const enemy = sim.spawn("broodling", { x: 30, z: 0 })!; sim.hit(enemy, 100); sim.hit(enemy, 100); }
    expect(sim.state.killed).toBe(20); expect(sim.state.player.maxHp).toBe(130); expect(sim.state.progress.armorLevel).toBe(2);
    Object.assign(sim.state.player, HILL_LAUNCH); sim.act(); expect(sim.state.stones[0].size).toBeCloseTo(1.3);
  });
  it("jumps directly across one spiral turn instead of racing around the lane", () => {
    const sim = chapter(1); sim.state.player.cooldown = 100;
    const from = spiralPoint(0.24), to = spiralPoint(0.74);
    const e = sim.spawn("jumper", from, 0.24)!;
    step(sim, 1);
    expect(e.x).toBeCloseTo((from.x + to.x) / 2, 5); expect(e.z).toBeCloseTo((from.z + to.z) / 2, 5);
  });
  it("accounts for six protected cows plus three already missing", () => {
    const sim = new StorySimulation();
    expect(sim.state.progress.safeAtFarm + sim.state.progress.missing).toBe(9);
    expect(sim.state.status).toBe("briefing"); sim.step(1); expect(sim.state.chapterTime).toBe(0);
  });
  it("keeps every authored maze objective and crate reachable", () => {
    const distances = mazeDistances(MAZE_START);
    for (const p of [MAZE_EXIT, MAZE_PEN, ...MAZE_CRATES]) {
      expect(blocked(2, p.x, p.z)).toBe(false);
      expect(distances[mazeCell(p)]).toBeGreaterThan(0);
    }
    for (let i = 0; i < MAZE.length; i++) if (!MAZE[i]) expect(distances[i]).toBeGreaterThanOrEqual(0);
  });
  it("has a continuously rising, nonoverlapping spiral and flat farm plateau", () => {
    let previous = -1;
    for (let i = 0; i <= 100; i++) {
      const p = spiralPoint(i / 100), h = groundHeight(1, p.x, p.z);
      expect(h).toBeGreaterThanOrEqual(previous - 1e-8); previous = h;
    }
    expect(groundHeight(1, 0, 0)).toBe(6);
    expect(groundHeight(2, 0, 0)).toBe(0);
    expect(clearLine(2, MAZE_START, { x: MAZE_START.x - 8, z: MAZE_START.z })).toBe(false);
  });
  it("does not tether or hurt an engineer far from the machine", () => {
    const sim = chapter(4); sim.state.spawned = 44;
    Object.assign(sim.state.player, { x: 38, z: -80 });
    step(sim, 2); expect(sim.state.player.x).toBe(38); expect(sim.state.player.hp).toBe(100);
  });
});

describe("Bellflower defense", () => {
  it("requires forty resolved attackers, not merely a quota while enemies remain", () => {
    const sim = chapter(1); sim.state.spawned = 40; sim.state.killed = 40;
    const e = sim.spawn("broodling", spiralPoint(0))!;
    sim.step(1 / 60); expect(sim.state.status).toBe("playing");
    sim.hit(e, 100); sim.step(1 / 60); expect(sim.state.status).toBe("complete");
  });
  it("makes every wave finite and advances through all forty attackers", () => {
    const sim = chapter(1);
    for (let i = 0; i < 12000 && sim.state.status === "playing"; i++) {
      sim.step(1 / 60);
      for (const e of [...sim.state.enemies]) sim.hit(e, 100);
    }
    expect(sim.state.spawned).toBe(40); expect(sim.state.killed).toBe(40); expect(sim.state.status).toBe("complete");
  });
  it("awards a corpse once and automatically collects its named parts", () => {
    const sim = chapter(1); const e = sim.spawn("broodling", sim.state.player)!;
    sim.hit(e, 100); sim.hit(e, 100); expect(sim.state.pickups).toHaveLength(1);
    sim.step(1 / 60); expect(sim.state.progress.shells).toBe(6); expect(sim.state.receipt).toContain("shell part");
    expect(sim.state.pickups).toHaveLength(0);
  });
  it("lets the engineer free an entangled cow before capture", () => {
    const sim = chapter(1), cow = sim.state.cows[0]; cow.status = "webbed"; cow.timer = 1;
    Object.assign(sim.state.player, { x: cow.x, z: cow.z }); expect(sim.act()).toBe(true);
    step(sim, 2); expect(cow.status).toBe("safe");
  });
  it("preserves real captures in the rescue ledger without taking safe cows", () => {
    const sim = chapter(1); sim.state.cows[0].status = "captured";
    sim.state.spawned = 40; sim.state.killed = 40; sim.step(1 / 60);
    expect(sim.state.progress.safeAtFarm).toBe(5); expect(sim.state.progress.missing).toBe(4);
    sim.nextChapter(); expect(sim.state.progress.safeAtFarm).toBe(5);
  });
  it("fails when every inner-pasture cow is captured", () => {
    const sim = chapter(1); for (const cow of sim.state.cows) cow.status = "captured";
    sim.step(1 / 60); expect(sim.state.status).toBe("defeat"); sim.retry(); expect(sim.state.cows.every(c => c.status === "safe")).toBe(true);
  });
  it("has a one-time jumping state with a real wind-up", () => {
    const sim = chapter(1); const e = sim.spawn("jumper", spiralPoint(0.24), 0.24)!;
    sim.step(1 / 60); expect(e.jumped).toBe(true); expect(e.path).toBe(0.24);
    step(sim, 2); expect(e.path).toBeGreaterThan(0.64); expect(e.jump).toBe(0);
    step(sim, 1); expect(e.jump).toBe(0);
  });
  it("charges five parts once per launch and a stone cannot repeatedly hit one enemy", () => {
    const sim = chapter(1); Object.assign(sim.state.player, HILL_LAUNCH);
    expect(sim.act()).toBe(true); expect(sim.act()).toBe(false); expect(sim.state.progress.shells).toBe(0);
    const e = sim.spawn("shellback", spiralPoint(0.95), 0.95)!; e.hp = 500;
    step(sim, 1); expect(sim.state.stones[0].hits.filter(id => id === e.id)).toHaveLength(1);
  });
});

describe("Maze and chapter progression", () => {
  it("does not let an unopened pen be skipped at the exit", () => {
    const sim = chapter(2); Object.assign(sim.state.player, MAZE_EXIT);
    expect(sim.act()).toBe(false); expect(sim.state.status).toBe("playing");
    Object.assign(sim.state.player, MAZE_PEN); expect(sim.act()).toBe(true);
    expect(sim.state.progress.rescued).toBe(2);
    Object.assign(sim.state.player, MAZE_EXIT); expect(sim.act()).toBe(true); expect(sim.state.status).toBe("complete");
  });
  it("grants each crate only once and caps multishot", () => {
    const sim = chapter(2);
    Object.assign(sim.state.player, MAZE_CRATES[0]); sim.act(); sim.closeUpgrade();
    expect(sim.state.crates[0]).toBe(false); sim.act(); expect(sim.chooseUpgrade("volley")).toBe(true);
    expect(sim.chooseUpgrade("volley")).toBe(false); expect(sim.state.progress.volley).toBe(2);
    Object.assign(sim.state.player, MAZE_CRATES[1]); sim.act(); sim.chooseUpgrade("volley");
    Object.assign(sim.state.player, MAZE_CRATES[2]); sim.act(); expect(sim.chooseUpgrade("volley")).toBe(false);
    expect(sim.chooseUpgrade("damage")).toBe(true); expect(sim.state.progress.volley).toBe(3);
  });
  it("keeps enemies outside solid maze walls while approaching the player", () => {
    const sim = chapter(2); sim.state.player.cooldown = 1000; sim.state.player.invincible = 1000;
    for (let i = 0; i < 600; i++) { sim.step(1 / 60); for (const e of sim.state.enemies) expect(blocked(2, e.x, e.z, 0.35)).toBe(false); }
  });
  it("preserves purchases through chapter transitions and chapter retries", () => {
    const sim = chapter(2); sim.state.progress.damageLevel = 2; sim.state.status = "complete"; sim.nextChapter();
    expect(sim.state.progress.weapons).toEqual(expect.arrayContaining(["rifle", "laser", "rocket", "flame"]));
    sim.state.progress.shells = 0; sim.retry(); expect(sim.state.progress.damageLevel).toBe(2); expect(sim.state.progress.shells).toBeGreaterThan(0);
  });
});

describe("Queen, weapons and homeward escort", () => {
  it("gives the flame a forward cone, finite range and no damage behind the player", () => {
    expect(storyFlameExposure({ x: 0, z: 0 }, 0, { x: 0, z: 5 })).toBeGreaterThan(0);
    expect(storyFlameExposure({ x: 0, z: 0 }, 0, { x: 0, z: -5 })).toBe(0);
    expect(storyFlameExposure({ x: 0, z: 0 }, 0, { x: 0, z: 11 })).toBe(0);
  });
  it("applies the same burn damage at different frame rates", () => {
    const run = (hz: number) => {
      const sim = chapter(3); sim.state.enemies.length = 0; sim.state.bossDefeated = true; sim.state.player.cooldown = 100;
      const e = sim.spawn("shellback", { x: 40, z: 40 })!; e.burn = 2; e.burnDps = 10;
      step(sim, 1, hz); return e.hp;
    };
    expect(run(30)).toBeCloseTo(run(120), 7);
  });
  it("telegraphs the slam and exposes the core after it", () => {
    const sim = chapter(3); sim.state.player.cooldown = 100;
    expect(sim.state.queenPhase).toBe("warning"); step(sim, 3.1);
    expect(sim.state.queenPhase).toBe("open"); expect(sim.state.player.hp).toBe(76);
  });
  it("stops all reinforcements after boss death and requires securing the cage", () => {
    const sim = chapter(3); sim.hit(sim.state.enemies[0], 100000);
    expect(sim.state.enemies).toHaveLength(0); expect(sim.state.status).toBe("playing");
    step(sim, 20); expect(sim.state.enemies).toHaveLength(0);
    Object.assign(sim.state.player, { x: 0, z: -23 }); expect(sim.act()).toBe(true);
    expect(sim.state.progress.rescued).toBe(sim.state.progress.missing); expect(sim.state.status).toBe("complete");
  });
  it("bounds all populations and refuses excess enemies", () => {
    const sim = chapter(3);
    for (let i = 0; i < 100; i++) sim.spawn("broodling", { x: 30, z: 30 });
    expect(sim.state.enemies.length).toBe(STORY_LIMITS.enemies); expect(sim.spawn("husk", { x: 0, z: 0 })).toBeNull();
  });
  it("can always crawl home without fuel, and rewards its rest stop once", () => {
    const sim = chapter(4); sim.state.spawned = 44; sim.state.machine.fuel = 0;
    step(sim, 2); expect(sim.state.machine.distance).toBeGreaterThan(0);
    sim.state.machine.distance = 55; sim.state.machine.hp = 100;
    sim.step(1 / 60); expect(sim.state.machine.hp).toBe(200);
    step(sim, 1); expect(sim.state.machine.hp).toBe(200);
  });
  it("deploys permanent turrets with a single action and explicit resource cost", () => {
    const sim = chapter(4); sim.state.selectedAction = "turret"; const parts = sim.state.progress.shells;
    expect(sim.act()).toBe(true); expect(sim.state.progress.shells).toBe(parts - 8);
    expect(sim.state.turrets).toHaveLength(1); expect(sim.state.selectedAction).toBe("context");
  });
  it("finishes at home without requiring every distant enemy to die", () => {
    const sim = chapter(4); sim.state.machine.distance = HOME_LENGTH - 0.005; sim.state.machine.rested = true;
    sim.spawn("husk", { x: 40, z: 40 }); sim.step(1 / 60);
    expect(sim.state.status).toBe("victory"); expect(sim.state.enemies).toHaveLength(0);
  });
});

describe("Story checkpoint isolation", () => {
  it("retries the chapter-start armor and resources rather than keeping failed-attempt rewards", () => {
    const sim = chapter(1);
    for (let i = 0; i < 10; i++) sim.hit(sim.spawn("broodling", { x: 30, z: 0 })!, 100);
    expect(sim.state.player.maxHp).toBe(115); sim.retry();
    expect(sim.state.player.maxHp).toBe(100); expect(sim.state.progress.shells).toBe(5); expect(sim.state.status).toBe("briefing");
  });
  it("pierces aligned enemies with the actual laser without hitting off-axis enemies", () => {
    const sim = chapter(3); sim.state.enemies.length = 0; sim.state.bossDefeated = true;
    Object.assign(sim.state.player, {x:0,z:0}); sim.selectWeapon("laser");
    const a = sim.spawn("shellback", {x:0,z:6})!, b = sim.spawn("shellback", {x:0,z:10})!, c = sim.spawn("shellback", {x:8,z:8})!;
    sim.step(1/120); expect(a.hp).toBe(40); expect(b.hp).toBe(40); expect(c.hp).toBe(68);
  });
  it("kills a cluster with one real rocket impact and awards each enemy once", () => {
    const sim = chapter(3); sim.state.enemies.length = 0; sim.state.bossDefeated = true;
    Object.assign(sim.state.player, {x:0,z:0}); sim.selectWeapon("rocket");
    sim.spawn("broodling", {x:0,z:4}); sim.spawn("broodling", {x:1,z:4});
    step(sim,0.5); expect(sim.state.killed).toBe(2); expect(sim.state.enemies).toHaveLength(0); expect(sim.state.pickups).toHaveLength(2);
  });
  it("round-trips chapter checkpoints using only the new key", () => {
    const values = new Map<string, string>(); values.set("marchaDeFerro.save.v1", "original");
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const sim = chapter(3); expect(saveStoryCheckpoint(sim.checkpoint, storage)).toBe(true);
    expect(loadStoryCheckpoint(storage)?.progress.chapter).toBe(3);
    expect(values.get("marchaDeFerro.save.v1")).toBe("original"); expect(values.has(STORY_SAVE_KEY)).toBe(true);
  });
  it("rejects corrupt data and survives disabled storage", () => {
    expect(validStoryCheckpoint({ version: 1, seed: 3, progress: {} })).toBe(false);
    expect(loadStoryCheckpoint({ getItem: () => "bad json" })).toBeNull();
    expect(saveStoryCheckpoint(chapter(1).checkpoint, { setItem: () => { throw Error("blocked"); } })).toBe(false);
  });
});
