import { describe, expect, it } from "vitest";
import { createEmptySnapshot } from "../src/input/InputActions.ts";
import { FIELD_MECHANIC } from "../src/data/balance.ts";
import { GameWorld } from "../src/game/GameWorld.ts";
import { ConstructionSystem } from "../src/game/systems/ConstructionSystem.ts";
import { InteractionSystem } from "../src/game/systems/InteractionSystem.ts";

function createRig(): { world: GameWorld; interaction: InteractionSystem } {
  const world = new GameWorld(4404);
  world.progress.level = FIELD_MECHANIC.unlockLevel;
  world.spider.coreHealth = world.spider.maxCoreHealth - 100;
  world.resources.scrap = 10;
  world.player.x = world.spider.x;
  world.player.z = world.spider.z;
  return { world, interaction: new InteractionSystem(new ConstructionSystem()) };
}

describe("Field Mechanic", () => {
  it("automatically repairs the Spider when a level-four engineer stays close", () => {
    const { world, interaction } = createRig();
    const input = createEmptySnapshot();

    interaction.update(world, FIELD_MECHANIC.interval, input);

    expect(world.spider.coreHealth).toBeGreaterThan(world.spider.maxCoreHealth - 100);
    expect(world.resources.scrap).toBe(10 - FIELD_MECHANIC.scrapCost);
    expect(world.player.actionKind).toBeNull();
  });

  it("does not repair before unlock, at long range, or without scrap", () => {
    const cases = [
      (world: GameWorld) => { world.progress.level = FIELD_MECHANIC.unlockLevel - 1; },
      (world: GameWorld) => { world.player.x += FIELD_MECHANIC.range + 1; },
      (world: GameWorld) => { world.resources.scrap = FIELD_MECHANIC.scrapCost - 1; },
    ];

    for (const arrange of cases) {
      const { world, interaction } = createRig();
      arrange(world);
      interaction.update(world, FIELD_MECHANIC.interval * 2, createEmptySnapshot());
      expect(world.spider.coreHealth).toBe(world.spider.maxCoreHealth - 100);
    }
  });

  it("does not grant repeatable experience for passive repairs", () => {
    const { world, interaction } = createRig();
    const xp = world.progress.xp;

    interaction.update(world, FIELD_MECHANIC.interval, createEmptySnapshot());

    expect(world.progress.xp).toBe(xp);
  });
});
