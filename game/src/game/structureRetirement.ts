import { clamp, dist, smoothstep } from "../core/math.ts";
import type { Structure } from "../core/types.ts";
import type { GameWorld } from "./GameWorld.ts";

/**
 * Abandoned Rivet Turrets retire behind the convoy, but anything near either
 * the engineer or Spider stays recoverable. The engineer is free to explore;
 * a turret must not disappear beside them just because the Spider moved on.
 *
 * The ramp below is measured in arc length along the route, which is the right
 * shape for "behind" but is not the same quantity as reach: on a segment that
 * doubles back, a turret 40 m back along the road can be a dozen metres away in
 * a straight line. Straight-line proximity therefore scales the arc ramp too.
 */
export const RIVET_RETIRE_START_DISTANCE = 26;
export const RIVET_RETIRE_END_DISTANCE = 46;
/** Object retention radius, not a player movement boundary. */
export const RIVET_RETIRE_KEEP_RADIUS = 32;

const projection = { x: 0, z: 0 };

/** 0 while retained, 1 once the turret should be removed from simulation. */
export function rivetRetirementProgress(world: GameWorld, structure: Structure): number {
  if (structure.kind !== "rivetTurret" || !structure.behindSpider) return 0;
  // `folding` is a machine the engineer is in the middle of recovering, and a
  // machine cannot be recovered and deleted in the same breath.
  if (
    structure.state === "destroyed" ||
    structure.state === "overloading" ||
    structure.state === "folding"
  ) {
    return 0;
  }
  // Dropped salvage is the objective in Salvage Rush and must never be cleaned
  // up there. On an expedition it is just a machine the player set down, and
  // the proximity gate below protects nearby equipment.
  if (structure.state === "dropped" && world.mode === "salvageRush") return 0;

  const spline = world.route.spline;
  if (!spline) return 0;

  const structureDistance = spline.projectPoint(projection, structure.x, structure.z);
  const distanceBehind = world.spider.distanceAlongRoute - structureDistance;
  const linear = clamp(
    (distanceBehind - RIVET_RETIRE_START_DISTANCE) /
      (RIVET_RETIRE_END_DISTANCE - RIVET_RETIRE_START_DISTANCE),
    0,
    1,
  );

  // Reach scales the ramp; it does not gate it.
  //
  // A hard `return 0` inside the retention radius caused a pop: the arc
  // ramp starts at 26 m while retention is 32, so by the time a turret left
  // reach the ramp had already climbed, and the first frame past the line
  // resumed at that value instead of zero. Measured at 0.202 in a single step -
  // the turret dropping 15 cm and snapping to 80% size in one frame, which is
  // exactly what the smoothstep below exists to prevent. Worse, on a curve the
  // straight-line distance can oscillate across the threshold and flicker it.
  const reach = Math.min(
    dist(structure.x, structure.z, world.spider.x, world.spider.z),
    dist(structure.x, structure.z, world.player.x, world.player.z),
  );
  const reachGate = smoothstep(RIVET_RETIRE_KEEP_RADIUS, RIVET_RETIRE_KEEP_RADIUS + 8, reach);

  // Smooth endpoints prevent the retirement animation from visibly snapping.
  return linear * linear * (3 - 2 * linear) * reachGate;
}
