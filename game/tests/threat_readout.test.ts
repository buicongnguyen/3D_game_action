import { describe, expect, it } from "vitest";
import { GameWorld } from "../src/game/GameWorld.ts";
import { updateThreatReadout, type ThreatReadout } from "../src/ui/ThreatReadout.ts";

describe("local threat feedback", () => {
  it("shows a live boss, then falls back to the nest after the boss dies", () => {
    const world = new GameWorld(17);
    const out: ThreatReadout = { label: "", detail: "", health: 0, maxHealth: 1 };
    world.encounterSites.push({
      id: world.allocateId(), definitionId: "nest", x: world.player.x, z: world.player.z,
      health: 90, maxHealth: 180, radius: 2.7, active: true,
      triggered: true, wavesReleased: 1, reinforcementTimer: 4.2,
    });
    const boss = world.enemies.acquire()!;
    Object.assign(boss, { active: true, archetype: "golem", x: world.player.x + 5,
      z: world.player.z, health: 120, maxHealth: 400, state: "APPROACHING" });
    updateThreatReadout(world, out);
    expect(out.label).toContain("BOSS");
    expect(out.health).toBe(120);
    boss.health = 0;
    boss.state = "DEAD";
    updateThreatReadout(world, out);
    expect(out.label).toContain("NEST");
    expect(out.detail).toContain("5s");
    world.encounterSites[0].wavesReleased = 3;
    updateThreatReadout(world, out);
    expect(out.detail).toContain("exhausted");
    world.encounterSites[0].active = false;
    updateThreatReadout(world, out);
    expect(out.label).toBe("");
  });
});
