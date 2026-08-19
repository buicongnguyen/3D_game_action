import { describe, expect, it } from "vitest";
import { captureCheckpoint, restoreCheckpoint } from "../src/core/CheckpointState.ts";
import { GameWorld } from "../src/game/GameWorld.ts";
import { RunStateSystem } from "../src/game/systems/RunStateSystem.ts";
import { ConstructionSystem } from "../src/game/systems/ConstructionSystem.ts";

describe("stage checkpoint state", () => {
  it("rewinds durable run state and clears the failed attempt's combat entities", () => {
    const world = new GameWorld(4401);
    const runState = new RunStateSystem();
    const construction = new ConstructionSystem();
    world.route.start();
    runState.departCheckpoint(world, "seg.mine");
    world.player.health = 73;
    world.resources.scrap = 48;
    world.fieldItems.shockMines = 2;
    world.loadout.push("relay");
    world.progress.level = 3;
    world.stats.enemiesKilled = 12;
    const barricade = construction.spawnStructure(world, "barricade", 5, 6, 0, 0.75, 0, {
      countPlacement: false,
      generateNoise: false,
    });
    const snapshot = captureCheckpoint(world)!;
    const expectedRandom = world.random.next();

    world.player.health = 0;
    world.player.downed = true;
    world.resources.scrap = 1;
    world.fieldItems.shockMines = 0;
    world.loadout.length = 1;
    world.progress.level = 8;
    world.stats.enemiesKilled = 99;
    world.structures.length = 0;
    const enemy = world.enemies.acquire()!;
    enemy.active = true;
    const projectile = world.projectiles.acquire()!;
    projectile.active = true;
    const pickup = world.pickups.acquire()!;
    pickup.active = true;
    world.random.next();

    restoreCheckpoint(world, runState, snapshot);

    expect(world.route.segment?.id).toBe("seg.mine");
    expect(world.player.health).toBe(73);
    expect(world.player.downed).toBe(false);
    expect(world.resources.scrap).toBe(48);
    expect(world.fieldItems.shockMines).toBe(2);
    expect(world.loadout).toContain("relay");
    expect(world.progress.level).toBe(3);
    expect(world.stats.enemiesKilled).toBe(12);
    expect(world.structures).toHaveLength(1);
    expect(world.structures[0].id).toBe(barricade.id);
    expect(world.enemies.active).toBe(0);
    expect(world.projectiles.active).toBe(0);
    expect(world.pickups.active).toBe(0);
    expect(world.random.next()).toBe(expectedRandom);
  });

  it("owns a deep copy rather than changing with the live world", () => {
    const world = new GameWorld(4402);
    const runState = new RunStateSystem();
    world.route.start();
    runState.departCheckpoint(world, "seg.approach");
    world.player.unlockedWeapons.push("rifle");
    const snapshot = captureCheckpoint(world)!;

    world.player.unlockedWeapons.push("flamer");
    world.spider.carriedStructures[0] = "rivetTurret";

    expect(snapshot.player.unlockedWeapons).toEqual(["shotgun", "rifle"]);
    expect(snapshot.spider.carriedStructures[0]).toBeNull();
  });
});
