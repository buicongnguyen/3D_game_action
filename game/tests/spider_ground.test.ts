import { describe, expect, it } from "vitest";
import { BufferGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { GameWorld } from "../src/game/GameWorld.ts";
import { TerrainBuilder } from "../src/rendering/TerrainBuilder.ts";
import { ROUTE_SEGMENTS } from "../src/data/routes.ts";
import type { RouteSegmentDefinition } from "../src/core/types.ts";

describe("visible road surface under Spider feet", () => {
  it("keeps the rendered inner road at foot-contact height", () => {
    const builder = Object.create(TerrainBuilder.prototype) as {
      buildGroundGeometry(world: GameWorld, segment: RouteSegmentDefinition): BufferGeometry;
      groundHeightAtPosition(x: number, z: number): number;
    };
    const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
    const point = { x: 0, z: 0 };
    const tangent = { x: 0, z: 0 };
    let highest = 0;
    let location = "";
    for (const [id, segment] of Object.entries(ROUTE_SEGMENTS)) {
      const world = new GameWorld(22);
      world.route.enterSegment(id);
      const geometry = builder.buildGroundGeometry(world, segment);
      // Default front-face material also catches incorrect triangle winding.
      const material = new MeshBasicMaterial();
      const ground = new Mesh(geometry, material);
      ground.updateMatrixWorld();
      try {
        expect(geometry.getAttribute("position").count).toBeLessThan(30000);
        for (let distance = 0; distance <= world.route.spline!.length; distance += 8) {
          world.route.spline!.positionAt(point, distance);
          world.route.spline!.tangentAt(tangent, distance);
          for (const lateral of [-4, 0, 4]) {
            ray.ray.origin.set(point.x - tangent.z * lateral, 20, point.z + tangent.x * lateral);
            const hit = ray.intersectObject(ground, false)[0];
            expect(hit).toBeDefined();
            expect(hit.point.y).toBeGreaterThanOrEqual(-0.0001);
            if (hit.point.y > highest) { highest = hit.point.y; location = `${id} at ${distance}m, lateral ${lateral}`; }
          }
          for (const lateral of [-65, -23, 21, 64]) {
            const x = point.x - tangent.z * lateral;
            const z = point.z + tangent.x * lateral;
            ray.ray.origin.set(x, 20, z);
            const hit = ray.intersectObject(ground, false)[0];
            expect(hit).toBeDefined();
            expect(builder.groundHeightAtPosition(x, z)).toBeCloseTo(hit.point.y, 4);
          }
        }
      } finally { geometry.dispose(); material.dispose(); }
    }
    expect(highest, location).toBeLessThan(0.025);
  });
});
