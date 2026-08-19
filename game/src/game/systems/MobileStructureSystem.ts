import { clamp, headingFromDirection, rotateToward } from "../../core/math.ts";
import { SPIDER, STRUCTURES } from "../../data/balance.ts";
import type { GameWorld } from "../GameWorld.ts";

/** Keeps mobile deployables in a readable convoy formation beside the Spider. */
export class MobileStructureSystem {
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

      const desiredHeading = headingFromDirection(dx, dz);
      structure.heading = rotateToward(structure.heading, desiredHeading, 4.4 * dt);
      const speed = Math.min(STRUCTURES.crawlerTurret.moveSpeed, clamp(distance * 2.2, 0.5, 20));
      const step = Math.min(distance, speed * dt);
      structure.x += (dx / distance) * step;
      structure.z += (dz / distance) * step;
      structure.behindSpider = false;
    }
  }
}
