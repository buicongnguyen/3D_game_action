import type { GameWorld } from "../GameWorld.ts";

const projected = { x: 0, z: 0 };

/** Movement multiplier for shallow water; the centre bridge remains dry. */
export function terrainSpeedMultiplier(world: GameWorld, x: number, z: number): number {
  const spline = world.route.spline;
  const zones = world.route.segment?.waterZones;
  if (!spline || !zones || zones.length === 0) return 1;
  const distance = spline.projectPoint(projected, x, z);
  const lateral = Math.hypot(x - projected.x, z - projected.z);
  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    if (distance < zone.fromDistance || distance > zone.toDistance) continue;
    if (lateral <= zone.bridgeHalfWidth) return 1;
    if (lateral <= zone.channelHalfWidth) return 0.58;
  }
  return 1;
}
