import { clamp, dist } from "../core/math.ts";
import { PLAYER } from "../data/balance.ts";
import type { Structure } from "../core/types.ts";
import type { GameWorld } from "./GameWorld.ts";

/**
 * A Rivet Turret remains recoverable for the whole player tether window. Once
 * it is farther behind the Spider than the engineer can possibly reach, it
 * retires without exploding so abandoned permanent defenses do not accumulate
 * for the rest of a long stage.
 *
 * The ramp below is measured in arc length along the route, which is the right
 * shape for "behind" but is not the same quantity as reach: on a segment that
 * doubles back, a turret 40 m back along the road can be a dozen metres away in
 * a straight line. The tether is a straight-line radius, so the arc ramp is
 * gated on a straight-line test as well and a machine the engineer could still
 * walk to is never deleted out from under them.
 */
export const RIVET_RETIRE_START_DISTANCE = 26;
export const RIVET_RETIRE_END_DISTANCE = 46;

const projection = { x: 0, z: 0 };

/** 0 while retained, 1 once the turret should be removed from simulation. */
export function rivetRetirementProgress(world: GameWorld, structure: Structure): number {
  if (structure.kind !== "rivetTurret" || !structure.behindSpider) return 0;
  // `dropped` is field salvage lying on the ground - in Salvage Rush it is the
  // objective itself - and `folding` is a machine the engineer is in the middle
  // of recovering. Neither is an abandoned turret and neither may be deleted.
  if (
    structure.state === "destroyed" ||
    structure.state === "overloading" ||
    structure.state === "dropped" ||
    structure.state === "folding"
  ) {
    return 0;
  }

  // Still within reach, whatever the road did in between.
  if (dist(structure.x, structure.z, world.spider.x, world.spider.z) <= PLAYER.tetherDistance) {
    return 0;
  }

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

  // Smooth endpoints prevent the retirement animation from visibly snapping.
  return linear * linear * (3 - 2 * linear);
}
