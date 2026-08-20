import { clamp } from "../core/math.ts";
import type { Structure } from "../core/types.ts";
import type { GameWorld } from "./GameWorld.ts";

/**
 * A Rivet Turret remains recoverable for the whole player tether window. Once
 * it is farther behind the Spider than the engineer can possibly reach, it
 * retires without exploding so abandoned permanent defenses do not accumulate
 * for the rest of a long stage.
 */
export const RIVET_RETIRE_START_DISTANCE = 26;
export const RIVET_RETIRE_END_DISTANCE = 46;

const projection = { x: 0, z: 0 };

/** 0 while retained, 1 once the turret should be removed from simulation. */
export function rivetRetirementProgress(world: GameWorld, structure: Structure): number {
  if (structure.kind !== "rivetTurret" || !structure.behindSpider) return 0;
  if (structure.state === "destroyed" || structure.state === "overloading") return 0;

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
