import { describe, expect, it, vi } from "vitest";
import { Game } from "../src/core/Game.ts";
import { GameWorld } from "../src/game/GameWorld.ts";
import { PlayerMovementSystem } from "../src/game/systems/PlayerMovementSystem.ts";
import { PLAYER } from "../src/data/balance.ts";
import { createEmptySnapshot } from "../src/input/InputActions.ts";
import { CameraController } from "../src/rendering/CameraController.ts";
import type { Renderer } from "../src/rendering/Renderer.ts";

describe("review safety regressions", () => {
  it.each([390 / 844, 1, 1280 / 720])("keeps a useful convoy width at aspect %s", (aspect) => {
    const world = new GameWorld(73);
    world.player.x = 0;
    world.player.z = 0;
    world.spider.x = 5;
    world.spider.z = 5;
    const camera = new CameraController({ aspect } as Renderer);
    camera.snapTo(world);
    expect(camera.camera.right).toBeGreaterThan(12);
    expect(camera.halfWidth).toBeCloseTo(camera.camera.right, 8);
    expect(camera.halfHeight).toBeCloseTo(camera.camera.top, 8);
    expect(camera.camera.right / camera.camera.top).toBeCloseTo(aspect, 8);
  });
  it("leaves a distant engineer stationary, even with a wall between them and the Spider", () => {
    const world = new GameWorld(71);
    world.spider.x = 0;
    world.spider.z = 0;
    world.player.x = PLAYER.escortWarningDistance + 8;
    world.player.z = 0;
    world.navigation.setStaticBox(PLAYER.escortWarningDistance + 4, 0, 1, 6, 0);
    const movement = new PlayerMovementSystem();
    const input = createEmptySnapshot();
    for (let i = 0; i < 600; i++) {
      movement.update(world, 1 / 60, input);
      expect(world.navigation.isBlockedCircle(world.player.x, world.player.z, PLAYER.radius)).toBe(false);
    }
    expect(world.player.x).toBe(PLAYER.escortWarningDistance + 8);
    expect(world.player.health).toBe(PLAYER.health);
    expect(world.player.farFromSpider).toBe(true);
  });

  it.each(["VICTORY", "DEFEAT"] as const)("ends the tick immediately after %s", (phase) => {
    const world = new GameWorld(72);
    world.setPhase("MARCH");
    const combat = vi.fn(() => world.setPhase("DEFEAT"));
    const transitions = vi.fn();
    const endStep = vi.fn();
    const game = Object.create(Game.prototype) as { fixedUpdate(dt: number): void };
    Object.assign(game, { world, input: { snapshot: createEmptySnapshot, endStep },
      screens: { controllerDisconnected: false }, handleGlobalInput: () => false,
      modalOpen: false, runState: { update: () => world.setPhase(phase) },
      syncSegmentPresentation: () => {}, updatePhaseTransitions: transitions,
      spiderMovement: { update: combat } });
    game.fixedUpdate(1 / 60);
    expect(world.phase).toBe(phase);
    expect(combat).not.toHaveBeenCalled();
    expect(transitions).toHaveBeenCalledOnce();
    expect(endStep).toHaveBeenCalledOnce();
    expect(world.tick).toBe(1);
  });
});
