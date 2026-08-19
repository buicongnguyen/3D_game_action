import { describe, expect, it } from "vitest";
import { getArchetype } from "../src/data/enemies.ts";
import { GameWorld } from "../src/game/GameWorld.ts";
import { ConstructionSystem } from "../src/game/systems/ConstructionSystem.ts";
import { DamageSystem } from "../src/game/systems/DamageSystem.ts";
import { InteractionSystem } from "../src/game/systems/InteractionSystem.ts";
import { MobileStructureSystem } from "../src/game/systems/MobileStructureSystem.ts";
import { RunStateSystem } from "../src/game/systems/RunStateSystem.ts";
import { StructureCombatSystem } from "../src/game/systems/StructureCombatSystem.ts";
import { createEmptySnapshot } from "../src/input/InputActions.ts";

function activeCrawler(world: GameWorld, x: number, z: number) {
  const crawler = new ConstructionSystem().spawnStructure(world, "crawlerTurret", x, z, 0, 1, -1);
  crawler.state = "active";
  crawler.powered = true;
  return crawler;
}

describe("crawler tank", () => {
  it("unlocks its blueprint at engineer level 3", () => {
    const world = new GameWorld(8301);
    world.progress.level = 3;
    new RunStateSystem().update(world, 1 / 60);
    expect(world.loadout).toContain("crawlerTurret");
  });

  it("moves into formation beside the Spider", () => {
    const world = new GameWorld(8302);
    world.spider.x = 10;
    world.spider.z = 20;
    world.spider.heading = 0;
    world.spider.docked = false;
    const crawler = activeCrawler(world, -10, -10);
    const before = Math.hypot(crawler.x - world.spider.x, crawler.z - world.spider.z);
    const movement = new MobileStructureSystem();
    for (let i = 0; i < 480; i++) movement.update(world, 1 / 60);
    const after = Math.hypot(crawler.x - world.spider.x, crawler.z - world.spider.z);
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThan(6);
  });

  it("automatically fires and inherits turret volley upgrades", () => {
    const world = new GameWorld(8303);
    world.setPhase("MARCH");
    world.modifiers.turretVolley = 2;
    const crawler = activeCrawler(world, 0, 0);
    crawler.turretHeading = 0;

    const archetype = getArchetype("minion");
    const enemy = world.enemies.acquire()!;
    enemy.id = world.allocateId();
    enemy.archetype = archetype.id;
    enemy.x = 0;
    enemy.z = 7;
    enemy.prevX = enemy.x;
    enemy.prevZ = enemy.z;
    enemy.health = archetype.health;
    enemy.maxHealth = archetype.health;
    enemy.radius = archetype.radius;
    enemy.speed = archetype.speed;
    enemy.state = "APPROACHING";
    enemy.active = true;

    new StructureCombatSystem().update(world, 1 / 60);
    expect(world.projectiles.backing.filter((projectile) => projectile.active)).toHaveLength(2);
  });

  it("is permanently removed when enemy damage depletes its health", () => {
    const world = new GameWorld(8304);
    const construction = new ConstructionSystem();
    const interaction = new InteractionSystem(construction);
    const damage = new DamageSystem(interaction);
    const crawler = activeCrawler(world, 0, 0);
    let destroyed = false;
    world.events.on("structure.destroyed", (event) => {
      if (event.structureId === crawler.id) destroyed = true;
    });

    damage.applyToStructure(world, crawler, {
      amount: crawler.maxHealth,
      source: "enemy.melee",
      originX: 0,
      originZ: 1,
      knockback: 0,
      critical: false,
    });
    interaction.update(world, 1 / 60, createEmptySnapshot());
    world.events.drain();

    expect(destroyed).toBe(true);
    expect(world.findStructure(crawler.id)).toBeUndefined();
  });
});
