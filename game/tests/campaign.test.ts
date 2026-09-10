import { describe, it, expect } from "vitest";
import { GameWorld } from "../src/game/GameWorld.ts";
import { RunStateSystem } from "../src/game/systems/RunStateSystem.ts";
import { SpiderMovementSystem } from "../src/game/systems/SpiderMovementSystem.ts";
import { OPERATIONS, SPECIALIZATIONS, chooseSpecialization, campaignArrival } from "../src/data/campaign.ts";
import { chooseOperation, updateOperation, recordOperationKill, recordOperationSalvage, operationPressure } from "../src/game/systems/CampaignSystem.ts";
import { captureCheckpoint, restoreCheckpoint } from "../src/core/CheckpointState.ts";
import { ROUTE_SEGMENTS } from "../src/data/routes.ts";

function setup(id = "seg.mine") {
  const world = new GameWorld(42), run = new RunStateSystem();
  world.route.start(); run.departCheckpoint(world, id);
  world.spider.distanceAlongRoute = world.route.spline!.length * 0.38;
  new SpiderMovementSystem().update(world, 0);
  world.player.x = world.spider.x + 5; world.player.z = world.spider.z;
  updateOperation(world, 1 / 60);
  return { world, run };
}

describe("campaign operations", () => {
  it("covers every non-final expedition segment", () => {
    for (const id of Object.keys(ROUTE_SEGMENTS)) {
      expect(Boolean(OPERATIONS[id])).toBe(id !== "seg.escape");
    }
  });
  it.each(Object.keys(OPERATIONS))("completes %s exactly once with bounded time and rewards", (id) => {
    const { world } = setup(id), def = OPERATIONS[id];
    expect(world.operation?.status).toBe("choice");
    expect(chooseOperation(world, true)).toBe(true);
    expect(chooseOperation(world, true)).toBe(false);
    world.spider.coreHealth = 100; world.spider.fuel = 0;
    if (def.kind === "combat") for (let i = 0; i < def.target; i++) recordOperationKill(world, world.spider.x, world.spider.z);
    if (def.kind === "salvage") recordOperationSalvage(world, world.spider.x, world.spider.z, def.target);
    for (let i = 0; i < 3600 && world.operation?.status === "active"; i++) updateOperation(world, 1 / 60);
    expect(world.operation?.status).toBe("success");
    expect(world.campaign.outcomes[id]).toBe("success");
    const before = [world.resources.scrap, world.spider.fuel, world.spider.coreHealth];
    updateOperation(world, 5);
    expect([world.resources.scrap, world.spider.fuel, world.spider.coreHealth]).toEqual(before);
    expect(operationPressure(world)).toBeLessThan(1);
  });
  it("declining resumes movement without spending supplies", () => {
    const { world } = setup(); const scrap = world.resources.scrap;
    const movement = new SpiderMovementSystem(); const distance = world.spider.distanceAlongRoute;
    movement.update(world, 1); expect(world.spider.distanceAlongRoute).toBe(distance);
    chooseOperation(world, false); movement.update(world, 1);
    expect(world.spider.distanceAlongRoute).toBeGreaterThan(distance);
    expect(world.resources.scrap).toBe(scrap);
    expect(world.campaign.outcomes["seg.mine"]).toBe("declined");
  });
  it("requires proximity, freezes during pause, and times out without docking", () => {
    const { world } = setup(); chooseOperation(world, true);
    world.player.x += 50;
    updateOperation(world, 10); expect(world.operation?.progress).toBe(0);
    world.paused = true; updateOperation(world, 100); expect(world.operation?.elapsed).toBe(10);
    world.paused = false;
    for (let i = 0; i < 60; i++) updateOperation(world, 1);
    expect(world.operation?.status).toBe("failed");
    expect(world.spider.docked).toBe(false);
    const distance = world.spider.distanceAlongRoute;
    new SpiderMovementSystem().update(world, 1);
    expect(world.spider.distanceAlongRoute).toBeGreaterThan(distance);
  });
  it("credits only nearby kills and salvage after acceptance", () => {
    const { world, run } = setup("seg.scrapyard");
    recordOperationKill(world, world.spider.x, world.spider.z);
    expect(world.operation?.progress).toBe(0);
    chooseOperation(world, true);
    recordOperationKill(world, world.spider.x + 100, world.spider.z);
    expect(world.operation?.progress).toBe(0);
    recordOperationKill(world, world.spider.x, world.spider.z);
    expect(world.operation?.progress).toBe(1);
    run.departCheckpoint(world, "seg.badlands");
    world.operation!.status = "choice"; chooseOperation(world, true);
    expect(world.pickups.active).toBe(3);
    recordOperationSalvage(world, world.operation!.x + 100, world.operation!.z, 50);
    expect(world.operation?.progress).toBe(0);
  });
  it("final community supplies are capped and delivered once", () => {
    const { world, run } = setup();
    for (const id of Object.keys(OPERATIONS)) world.campaign.outcomes[id] = "success";
    run.departCheckpoint(world, "seg.escape"); world.spider.fuel = 0; world.spider.coreHealth = 100;
    updateOperation(world, 1);
    expect(world.spider.fuel).toBe(30); expect(world.spider.coreHealth).toBe(160);
    updateOperation(world, 1); expect(world.spider.fuel).toBe(30);
    expect(world.campaign.finalAidClaimed).toBe(true);
  });
  it("does not add expedition missions or specializations to Salvage Rush", () => {
    const world = new GameWorld(42, "salvageRush"); const run = new RunStateSystem();
    world.route.start(); run.departCheckpoint(world, "seg.scrapyard");
    updateOperation(world, 300); expect(world.operation).toBeNull();
    expect(chooseSpecialization(world, "engineer")).toBe(false);
  });
  it("remembers a rescued engineer in dialogue and heals at the next halt", () => {
    const { world, run } = setup();
    world.campaign.outcomes["seg.mine"] = "success";
    expect(campaignArrival(world, { speaker: "Mara", text: "Welcome." })?.text).toContain("Ilya is aboard");
    world.spider.coreHealth = 100; world.operation = null;
    world.spider.distanceAlongRoute = world.route.spline!.length;
    run.update(world, 1 / 60); expect(world.spider.coreHealth).toBe(115);
    run.update(world, 1 / 60); expect(world.spider.coreHealth).toBe(115);
  });
});

describe("specialization and retry", () => {
  it.each(["seg.flooded", "seg.floodedShortcut"])("advances the full expedition through %s without a stuck stop", (fork) => {
    const world = new GameWorld(123), run = new RunStateSystem(), movement = new SpiderMovementSystem();
    world.route.start(); run.departCheckpoint(world, "seg.approach");
    let stops = 0;
    // Simulated escort follows the hull; no combat is injected. Operations are
    // declined to prove the campaign remains completable without optional aid.
    for (let tick = 0; tick < 20000 && world.phase !== "VICTORY"; tick++) {
      world.spider.fuel = world.spider.maxFuel;
      world.player.x = world.spider.x + 5; world.player.z = world.spider.z;
      if (world.operation?.status === "choice") chooseOperation(world, false);
      if (world.phase === "CHECKPOINT_PREP") {
        stops++;
        chooseSpecialization(world, "convoy");
        const next = run.pendingRoutes.includes(fork) ? fork : run.pendingRoutes[0];
        run.departCheckpoint(world, next);
      }
      run.update(world, 0.25);
      if (!["VICTORY"].includes(world.phase)) movement.update(world, 0.25);
      world.events.drain();
    }
    expect(world.phase).toBe("VICTORY");
    expect(stops).toBe(8);
    expect(world.campaign.specialization).toBe("convoy");
  });
  it.each(SPECIALIZATIONS)("persists $id without applying its modifiers twice", ({ id }) => {
    const { world, run } = setup();
    expect(chooseSpecialization(world, id)).toBe(true);
    expect(chooseSpecialization(world, "engineer")).toBe(false);
    world.campaign.outcomes["seg.mine"] = "success";
    run.departCheckpoint(world, "seg.flooded");
    const checkpoint = captureCheckpoint(world)!;
    const fresh = new GameWorld(42), freshRun = new RunStateSystem();
    restoreCheckpoint(fresh, freshRun, checkpoint);
    expect(fresh.campaign).toEqual(world.campaign);
    expect(fresh.modifiers).toEqual(world.modifiers);
    expect(chooseSpecialization(fresh, id)).toBe(false);
    if (id === "convoy") expect(fresh.loadout).toContain("crawlerTurret");
  });
  it("keeps old checkpoints usable", () => {
    const { world } = setup(); const checkpoint = captureCheckpoint(world)!;
    delete checkpoint.campaign;
    const fresh = new GameWorld(42); restoreCheckpoint(fresh, new RunStateSystem(), checkpoint);
    expect(fresh.campaign.specialization).toBeNull();
    expect(fresh.campaign.outcomes).toEqual({});
  });
});
