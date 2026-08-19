import { describe, expect, it } from "vitest";
import { getArchetype } from "../src/data/enemies.ts";
import {
  TURRET_UPGRADES,
  purchaseTurretUpgrade,
  turretUpgradeCost,
} from "../src/data/turretShop.ts";
import { GameWorld } from "../src/game/GameWorld.ts";
import { ConstructionSystem } from "../src/game/systems/ConstructionSystem.ts";
import { StructureCombatSystem } from "../src/game/systems/StructureCombatSystem.ts";

describe("checkpoint turret foundry", () => {
  it("offers independent power, volley, range and autoloader tracks", () => {
    expect(TURRET_UPGRADES.map((entry) => entry.kind)).toEqual([
      "power",
      "volley",
      "range",
      "autoloader",
    ]);
  });

  it("spends scrap and changes only the purchased turret statistic", () => {
    const world = new GameWorld(7201);
    world.resources.scrap = 100;
    const cost = turretUpgradeCost("range", 0);

    expect(purchaseTurretUpgrade(world, "range").ok).toBe(true);
    expect(world.resources.scrap).toBe(100 - cost);
    expect(world.progress.turretUpgrades.range).toBe(1);
    expect(world.modifiers.turretRange).toBeCloseTo(1.15);
    expect(world.modifiers.turretDamage).toBe(1);
    expect(world.modifiers.turretVolley).toBe(1);
  });

  it("rejects unaffordable and fully upgraded tracks", () => {
    const world = new GameWorld(7202);
    world.resources.scrap = 0;
    expect(purchaseTurretUpgrade(world, "power").ok).toBe(false);
    expect(world.progress.turretUpgrades.power).toBe(0);

    world.resources.scrap = 10_000;
    const max = TURRET_UPGRADES.find((entry) => entry.kind === "power")!.maxLevel;
    for (let level = 0; level < max; level++) expect(purchaseTurretUpgrade(world, "power").ok).toBe(true);
    expect(purchaseTurretUpgrade(world, "power").ok).toBe(false);
    expect(world.progress.turretUpgrades.power).toBe(max);
  });

  it("fires the upgraded number of rivets in one turret salvo", () => {
    const world = new GameWorld(7203);
    world.setPhase("MARCH");
    world.modifiers.turretVolley = 3;

    const turret = new ConstructionSystem().spawnStructure(world, "rivetTurret", 0, 0, 0, 1, -1);
    turret.state = "active";
    turret.powered = true;
    turret.turretHeading = 0;

    const archetype = getArchetype("minion");
    const enemy = world.enemies.acquire()!;
    enemy.id = world.allocateId();
    enemy.archetype = archetype.id;
    enemy.x = 0;
    enemy.z = 8;
    enemy.prevX = enemy.x;
    enemy.prevZ = enemy.z;
    enemy.health = archetype.health;
    enemy.maxHealth = archetype.health;
    enemy.radius = archetype.radius;
    enemy.speed = archetype.speed;
    enemy.state = "APPROACHING";
    enemy.active = true;

    new StructureCombatSystem().update(world, 1 / 60);

    expect(world.projectiles.backing.filter((projectile) => projectile.active)).toHaveLength(3);
  });
});
