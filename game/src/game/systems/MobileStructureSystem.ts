import { clamp, headingFromDirection, rotateToward } from "../../core/math.ts";
import { SPIDER, STRUCTURES } from "../../data/balance.ts";
import type { GameWorld } from "../GameWorld.ts";

/** Keeps mobile deployables in a readable convoy formation beside the Spider. */
export class MobileStructureSystem {
  private readonly direction = { x: 0, z: 0 };

  update(world: GameWorld, dt: number): void {
    let crawlerIndex = 0;
    for (const structure of world.structures) {
      if (structure.kind !== "crawlerTurret") continue;
      const slot = crawlerIndex++;
      if (
        structure.state !== "active" ||
        structure.health <= 0 ||
        (world.player.actionKind !== null && world.player.actionTargetId === structure.id)
      ) continue;

      const side = slot % 2 === 0 ? 1 : -1;
      const rank = Math.floor(slot / 2);
      const forwardX = Math.sin(world.spider.heading);
      const forwardZ = Math.cos(world.spider.heading);
      const rightX = forwardZ;
      const rightZ = -forwardX;
      const lateral = side * (SPIDER.bodyWidth * 0.5 + 1.5);
      const trailing = STRUCTURES.crawlerTurret.followDistance + rank * 1.8;
      const targetX = world.spider.x + rightX * lateral - forwardX * trailing;
      const targetZ = world.spider.z + rightZ * lateral - forwardZ * trailing;
      const dx = targetX - structure.x;
      const dz = targetZ - structure.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.12) continue;

      const speed = Math.min(STRUCTURES.crawlerTurret.moveSpeed, clamp(distance * 2.2, 0.5, 20));
      const step = Math.min(distance, speed * dt);
      const radius = STRUCTURES.crawlerTurret.radius;
      let directionX = dx / distance;
      let directionZ = dz / distance;
      // Use the convoy flow when a straight approach crosses scenery. Check
      // clearance along the segment, not just at its endpoint.
      for (let travel = Math.min(0.5, distance); travel <= Math.min(distance, 24); travel += 0.5) {
        if (!world.navigation.isBlockedCircle(structure.x + directionX * travel,
          structure.z + directionZ * travel, radius)) continue;
        if (world.flowField.sample(this.direction, structure.x, structure.z)) {
          directionX = this.direction.x;
          directionZ = this.direction.z;
        }
        break;
      }
      const desiredHeading = headingFromDirection(directionX, directionZ);
      // The flow is point-agent based; test the crawler's full footprint before
      // moving, with small angular alternatives around corners.
      for (let candidate = 0; candidate < 9; candidate++) {
        const offset = candidate === 0 ? 0
          : Math.ceil(candidate / 2) * Math.PI / 8 * (candidate % 2 ? 1 : -1);
        const heading = desiredHeading + offset;
        const nextX = structure.x + Math.sin(heading) * step;
        const nextZ = structure.z + Math.cos(heading) * step;
        if (world.navigation.isBlockedCircle(nextX, nextZ, radius)) continue;
        structure.x = nextX;
        structure.z = nextZ;
        structure.heading = rotateToward(structure.heading, heading, 4.4 * dt);
        break;
      }
      structure.behindSpider = false;
    }
  }
}
