import { describe, expect, it } from "vitest";
import { Group, Mesh, MeshBasicMaterial, RingGeometry } from "three";
import { GameWorld } from "../src/game/GameWorld.ts";
import { ConstructionSystem } from "../src/game/systems/ConstructionSystem.ts";
import { WorldView } from "../src/rendering/WorldView.ts";
import { getBlueprint } from "../src/data/structures.ts";
import { rivetRetirementProgress } from "../src/game/structureRetirement.ts";
import type { Structure } from "../src/core/types.ts";

describe("retiring structure presentation", () => {
  it.each([30, 120])("keeps the track aligned at %i FPS and restores it on return", (fps) => {
    const world = new GameWorld(27);
    world.route.enterSegment("seg.approach");
    const point = { x: 0, z: 0 };
    world.route.spline!.positionAt(point, 0);
    const structure = new ConstructionSystem().spawnStructure(world, "rivetTurret", point.x, point.z, 0, 1, -1);
    structure.state = "starved";
    structure.buffer = 0;
    structure.behindSpider = true;
    world.spider.distanceAlongRoute = 36;
    world.route.spline!.positionAt(point, 36);
    world.spider.x = point.x;
    world.spider.z = point.z;
    world.player.x = point.x; world.player.z = point.z;
    expect(rivetRetirementProgress(world, structure)).toBeGreaterThan(0);

    const material = new MeshBasicMaterial();
    const visual = { root: new Group(), ring: new Mesh(new RingGeometry(), material),
      track: new Mesh(new RingGeometry(), material), turret: null, gauge: null,
      recoil: 0, folded: 0, ventTimer: 0, ringSweep: -1, batched: false };
    // Exercise the real renderer method without requiring a WebGL context.
    const view = Object.create(WorldView.prototype) as {
      updateStructureVisual(v: typeof visual, s: Structure, w: GameWorld, dt: number): void;
    };
    Object.assign(view, { clock: 0, forge: { materials: { ringDecal: () => material } } });
    const base = Math.max(1.1, getBlueprint(structure.kind).radius * 1.55);
    try {
      for (let frame = 0; frame < fps; frame++) view.updateStructureVisual(visual, structure, world, 1 / fps);
      expect(visual.track.scale.x).toBeCloseTo(visual.ring.scale.x, 8);
      expect(visual.track.scale.x).toBeGreaterThan(base * 0.1);
      world.spider.distanceAlongRoute = 0;
      world.spider.x = structure.x;
      world.spider.z = structure.z;
      view.updateStructureVisual(visual, structure, world, 1 / fps);
      expect(visual.track.scale.x).toBeCloseTo(base, 8);
      expect(visual.ring.scale.x).toBeCloseTo(base, 8);
    } finally {
      visual.ring.geometry.dispose();
      visual.track.geometry.dispose();
      material.dispose();
    }
  });
});
