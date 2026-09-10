import { describe, expect, it } from "vitest";
import { PLAYER, CAMERA } from "../src/data/balance.ts";
import { GameWorld } from "../src/game/GameWorld.ts";
import { PlayerMovementSystem } from "../src/game/systems/PlayerMovementSystem.ts";
import { createEmptySnapshot } from "../src/input/InputActions.ts";
import { CameraController } from "../src/rendering/CameraController.ts";
import type { Renderer } from "../src/rendering/Renderer.ts";
import { NavigationGrid } from "../src/game/navigation/NavigationGrid.ts";
import { ConstructionSystem } from "../src/game/systems/ConstructionSystem.ts";
import { rivetRetirementProgress } from "../src/game/structureRetirement.ts";
import { escortWarningLevel, escortWarningTitle } from "../src/ui/EscortPresentation.ts";

function setup(x = 0, z = 0) {
  const world = new GameWorld(123);
  Object.assign(world.spider, { x: 0, z: 0 });
  Object.assign(world.player, { x, z, velocityX: 0, velocityZ: 0 });
  return { world, movement: new PlayerMovementSystem(), input: createEmptySnapshot() };
}

describe("unrestricted escort movement", () => {
  it.each([40, 100, 300, 1000])("never pulls, damages or drops a cylinder at %s metres", (distance) => {
    const { world, movement, input } = setup(distance);
    world.player.carry = { kind: "cylinder" };
    const health = world.player.health;
    for (let i = 0; i < 600; i++) movement.update(world, 1 / 60, input);
    expect(world.player.x).toBe(distance); expect(world.player.z).toBe(0);
    expect(world.player.health).toBe(health);
    expect(world.player.carry).toEqual({ kind: "cylinder" });
    expect(world.player.farFromSpider).toBe(true);
  });
  it("walks through the old boundary at full normal speed", () => {
    const { world, movement, input } = setup(25);
    Object.assign(input.leftStick, { x: 1, y: 0, magnitude: 1, active: true });
    for (let i = 0; i < 1200; i++) movement.update(world, 1 / 60, input);
    expect(world.player.x).toBeGreaterThan(130);
    expect(world.player.velocityX).toBe(PLAYER.speed);
    expect(world.player.health).toBe(PLAYER.health);
  });
  it("keeps dodge movement available far from the Spider", () => {
    const { world, movement, input } = setup(200);
    world.player.heading = Math.PI / 2;
    input.buttons.cancel.pressed = true; movement.update(world, 1 / 60, input);
    input.buttons.cancel.pressed = false;
    for (let i = 0; i < 16; i++) movement.update(world, 1 / 60, input);
    expect(world.player.x).toBeGreaterThan(202);
    expect(world.player.health).toBe(PLAYER.health);
  });
  it("clears the warning on return without flickering at 32 metres", () => {
    const { world, movement, input } = setup(31);
    movement.update(world, 1 / 60, input); expect(world.player.farFromSpider).toBe(false);
    world.player.x = 33; movement.update(world, 1 / 60, input); expect(world.player.farFromSpider).toBe(true);
    for (const x of [31.9, 32.1, 30, 28.1]) {
      world.player.x = x; movement.update(world, 1 / 60, input); expect(world.player.farFromSpider).toBe(true);
    }
    world.player.x = 28; movement.update(world, 1 / 60, input); expect(world.player.farFromSpider).toBe(false);
    world.player.x = 31; movement.update(world, 1 / 60, input); expect(world.player.farFromSpider).toBe(false);
  });
  it("shows no misleading distance warning while downed", () => {
    const { world, movement, input } = setup(100);
    movement.update(world, 1 / 60, input); world.player.downed = true;
    movement.update(world, 1 / 60, input);
    expect(world.player.farFromSpider).toBe(false); expect(world.player.spiderSeparation).toBe(0);
  });
  it.each([390 / 844, 844 / 390, 1280 / 720])("follows a distant engineer at aspect %s without infinite zoom", (aspect) => {
    const { world } = setup(300, -170);
    const camera = new CameraController({ aspect } as Renderer);
    camera.snapTo(world);
    expect(camera.focusX).toBe(world.player.x); expect(camera.focusZ).toBe(world.player.z);
    expect(camera.isVisible(world.player.x, world.player.z, 0)).toBe(true);
    expect(camera.isVisible(world.spider.x, world.spider.z, 0)).toBe(false);
    expect(camera.halfWidth).toBeLessThanOrEqual(CAMERA.maxViewSize * Math.max(1, aspect));
    expect(camera.projectToScreen(world.player.x, world.player.z)).toEqual({ x: .5, y: .5 });
    expect(Number.isFinite(camera.screenAngleTo(300, -170, 0, 0))).toBe(true);
  });
  it("keeps real obstacles solid outside the sliding AI window, but never its border", () => {
    const grid = new NavigationGrid();
    expect(grid.isBlockedCircle(300, 0, PLAYER.radius)).toBe(false);
    grid.addObstacle(300, 0, 2, 100);
    expect(grid.isBlockedCircle(300, 0, PLAYER.radius)).toBe(true);
    grid.removeObstacle(100); expect(grid.isBlockedCircle(300, 0, PLAYER.radius)).toBe(false);
    grid.setStaticBox(300, 0, 4, 1, Math.PI / 2);
    expect(grid.isBlockedCircle(300, 3, PLAYER.radius)).toBe(true);
    expect(grid.isBlockedCircle(303, 0, PLAYER.radius)).toBe(false);
    grid.recenter(300, 0);
    expect(grid.isBlockedCircle(300, 3, PLAYER.radius)).toBe(true);
    expect(grid.isBlockedCircle(310, 0, PLAYER.radius)).toBe(false);
  });
  it("retains a turret near the engineer even after the Spider goes far ahead", () => {
    const { world } = setup(0, 0);
    world.route.enterSegment("seg.approach");
    const construction = new ConstructionSystem();
    const turret = construction.spawnStructure(world, "rivetTurret", 2, 0, 0, 1, -1);
    turret.state = "active"; turret.behindSpider = true;
    Object.assign(world.spider, { x: 150, z: 0, distanceAlongRoute: 150 });
    expect(rivetRetirementProgress(world, turret)).toBe(0);
    world.player.x = 150;
    expect(rivetRetirementProgress(world, turret)).toBe(1);
  });
  it("names the warning and its actual distance with units", () => {
    expect(escortWarningLevel(false, 10)).toBe(0);
    expect(escortWarningLevel(true, 40)).toBe(1);
    expect(escortWarningLevel(true, 80)).toBe(2);
    expect(escortWarningTitle(0, 10)).toBe("");
    expect(escortWarningTitle(1, 40.4)).toBe("Far from Spider · 40 m");
    expect(escortWarningTitle(2, 83.8)).toBe("Very far from Spider · 84 m");
  });
});
