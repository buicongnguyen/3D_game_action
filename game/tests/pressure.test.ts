import { describe, expect, it } from "vitest";
import { GameWorld } from "../src/game/GameWorld.ts";
import { PressureNetworkSystem } from "../src/game/systems/PressureNetworkSystem.ts";
import { STRUCTURES } from "../src/data/balance.ts";
import type { Structure } from "../src/core/types.ts";

/**
 * Pressure network behaviour.
 *
 * The relay had no behavioural test of any kind, and that is how it came to
 * recharge itself forever: `powered` meant both "has an upstream source" and
 * "is still serving", and the recharge branch read the second while meaning the
 * first. A relay with any buffer left counted as powered, recharged because it
 * was powered, and so never drained - a permanent free network node, which is
 * the exact thing the one-hop chaining limit exists to prevent.
 *
 * These assert the rule the whole game rests on: pressure comes from the
 * spider, and nothing manufactures its own.
 */

function addRelay(world: GameWorld, x: number, z: number): Structure {
  const relay = {
    id: world.structures.length + 1,
    kind: "relay",
    x,
    z,
    heading: 0,
    health: STRUCTURES.relay.health,
    maxHealth: STRUCTURES.relay.health,
    buffer: STRUCTURES.relay.maxBuffer,
    maxBuffer: STRUCTURES.relay.maxBuffer,
    state: "active",
    stateTimer: 0,
    powered: false,
    fireCooldown: 0,
    targetEnemyId: -1,
    targetLockTimer: 0,
    turretHeading: 0,
    shotsFired: 0,
    behindSpider: false,
    category: "foldable",
    level: 1,
    ownerSlot: -1,
  } as unknown as Structure;
  world.structures.push(relay);
  return relay;
}

function fuelledWorld(): GameWorld {
  const world = new GameWorld(20260817);
  world.spider.fuel = 100;
  world.spider.x = 0;
  world.spider.z = 0;
  return world;
}

const STEP = 1 / 60;

describe("relays draw pressure rather than making it", () => {
  it("drains and starves once it is out of the spider's radius", () => {
    const world = fuelledWorld();
    const stranded = addRelay(world, 500, 500);
    const system = new PressureNetworkSystem();
    expect(stranded.buffer).toBeGreaterThan(0);

    for (let i = 0; i < 60 * 90; i++) system.update(world, STEP);

    expect(stranded.buffer).toBe(0);
    expect(stranded.state).toBe("starved");
  });

  it("still serves while it drains, which is what makes it worth carrying", () => {
    const world = fuelledWorld();
    const stranded = addRelay(world, 500, 500);
    const system = new PressureNetworkSystem();

    system.update(world, STEP);
    expect(stranded.powered).toBe(true);
    expect(stranded.buffer).toBeLessThan(STRUCTURES.relay.maxBuffer);
  });

  it("recharges inside the spider's radius", () => {
    const world = fuelledWorld();
    const near = addRelay(world, 1, 1);
    near.buffer = 1;
    const system = new PressureNetworkSystem();

    for (let i = 0; i < 120; i++) system.update(world, STEP);

    expect(near.buffer).toBeGreaterThan(1);
    expect(near.powered).toBe(true);
  });

  it("chains exactly one hop and never two", () => {
    const world = fuelledWorld();
    const range = STRUCTURES.relay.range;
    const direct = addRelay(world, 1, 0);
    const oneHop = addRelay(world, 1 + range * 0.9, 0);
    const twoHops = addRelay(world, 1 + range * 1.8, 0);
    oneHop.buffer = 0;
    twoHops.buffer = 0;
    const system = new PressureNetworkSystem();

    for (let i = 0; i < 300; i++) system.update(world, STEP);

    expect(direct.powered).toBe(true);
    expect(oneHop.buffer).toBeGreaterThan(0);
    // The second hop must never be supplied, however long the run lasts, or a
    // player can lay a chain of relays and build a permanent base.
    expect(twoHops.buffer).toBe(0);
  });

  it("stops supplying anything once the spider runs dry", () => {
    const world = fuelledWorld();
    const near = addRelay(world, 1, 1);
    const system = new PressureNetworkSystem();

    world.spider.fuel = 0;
    for (let i = 0; i < 60 * 90; i++) system.update(world, STEP);

    expect(near.buffer).toBe(0);
    expect(near.state).toBe("starved");
  });
});
