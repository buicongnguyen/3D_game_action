import { dampAngle, clamp } from "../../core/math.ts";
import { SPIDER, TRAIL } from "../../data/balance.ts";
import type { GameWorld } from "../GameWorld.ts";

const scratchPos = { x: 0, z: 0 };

/**
 * Drives the spider along the route spline.
 *
 * Two rules from the spec are load-bearing here and are easy to get wrong:
 *
 *  1. `distanceAlongRoute` in metres is canonical. The spline's arc-length
 *     table converts it to a world position, so speed through a tight curve is
 *     the same as speed on a straight. Advancing a curve parameter instead
 *     would make the spider visibly slow down in corners.
 *
 *  2. Movement never depends on the leg animation. The gait solver reads this
 *     system's output; it never writes to it. That separation is a phase gate.
 */
export class SpiderMovementSystem {
  update(world: GameWorld, dt: number): void {
    const spider = world.spider;

    spider.prevX = spider.x;
    spider.prevZ = spider.z;
    spider.prevHeading = spider.heading;
    spider.prevDistanceAlongRoute = spider.distanceAlongRoute;

    this.updateShield(world, dt);

    if (spider.docked) {
      spider.speed = 0;
      spider.emergencyBurn = false;
      this.syncTransform(world, dt, true);
      return;
    }

    const hold = world.route.segment?.departureHoldSeconds ?? 0;
    if (hold > 0 && world.phaseTime < hold) {
      spider.speed = 0;
      spider.emergencyBurn = false;
      this.syncTransform(world, dt, true);
      return;
    }

    const speed = this.resolveSpeed(world, dt);
    spider.speed = speed;
    spider.distanceAlongRoute += speed * dt;
    world.stats.distanceTravelled += speed * dt;

    this.syncTransform(world, dt, false);
  }

  /**
   * Resolves the speed mode, burns fuel, and falls back to burning scrap when
   * the tank is dry. Returning to a crawl rather than stopping is what keeps a
   * fuel mistake recoverable instead of a soft-lock.
   */
  private resolveSpeed(world: GameWorld, dt: number): number {
    const spider = world.spider;
    const efficiency = world.modifiers.fuelEfficiency;

    if (spider.fuel <= 0) {
      spider.fuel = 0;
      if (spider.speedMode !== "fallback") {
        spider.speedMode = "fallback";
        world.events.emit({ type: "spider.speedMode", mode: "fallback" });
        world.events.emit({ type: "spider.fuelEmpty" });
      }
      const burn = SPIDER.scrapPerSecondFallback * dt;
      if (world.resources.scrap > 0) {
        world.resources.scrap = Math.max(0, world.resources.scrap - burn);
        spider.emergencyBurn = true;
      } else {
        spider.emergencyBurn = false;
      }
      return SPIDER.speedFallback;
    }

    spider.emergencyBurn = false;

    if (spider.speedMode === "fallback") {
      spider.speedMode = "march";
      world.events.emit({ type: "spider.speedMode", mode: "march" });
    }

    if (spider.speedMode === "overdrive") {
      spider.fuel = Math.max(0, spider.fuel - (SPIDER.fuelPerSecondOverdrive / efficiency) * dt);
      // Overdrive is loud: the escape it buys is paid for in horde pressure.
      world.trail = Math.min(TRAIL.max, world.trail + SPIDER.overdriveTrailPerSecond * dt);
      return SPIDER.speedOverdrive;
    }

    spider.fuel = Math.max(0, spider.fuel - (SPIDER.fuelPerSecondMarch / efficiency) * dt);
    return SPIDER.speedMarch;
  }

  private updateShield(world: GameWorld, dt: number): void {
    const spider = world.spider;
    const maxShield = SPIDER.shield * world.modifiers.spiderShield;
    spider.maxShield = maxShield;

    if (spider.shieldRegenDelay > 0) {
      spider.shieldRegenDelay = Math.max(0, spider.shieldRegenDelay - dt);
      return;
    }
    if (spider.shield < maxShield) {
      spider.shield = Math.min(maxShield, spider.shield + SPIDER.shieldRegenPerSecond * dt);
    }
  }

  private syncTransform(world: GameWorld, dt: number, docked: boolean): void {
    const spline = world.route.spline;
    if (!spline) return;
    const spider = world.spider;

    const distance = clamp(spider.distanceAlongRoute, 0, spline.length);
    spline.positionAt(scratchPos, distance);
    spider.x = scratchPos.x;
    spider.z = scratchPos.z;

    // Facing comes from a point ahead on the spline rather than from velocity,
    // so the hull leads into a curve instead of chasing it.
    const lookDistance = Math.min(spline.length, distance + SPIDER.headingLookahead);
    const targetHeading = spline.headingAt(lookDistance);
    spider.heading = docked
      ? targetHeading
      : dampAngle(spider.heading, targetHeading, 1 / SPIDER.turnRate, dt);
  }

  /** Toggles overdrive. Refused when the tank is dry so the HUD can explain why. */
  toggleOverdrive(world: GameWorld): void {
    const spider = world.spider;
    if (spider.docked) return;
    if (spider.speedMode === "overdrive") {
      spider.speedMode = "march";
      world.events.emit({ type: "spider.speedMode", mode: "march" });
      return;
    }
    if (spider.fuel <= 1) {
      world.events.emit({
        type: "ui.toast",
        message: "No fuel for overdrive",
        tone: "warning",
        duration: 2,
      });
      return;
    }
    spider.speedMode = "overdrive";
    world.events.emit({ type: "spider.speedMode", mode: "overdrive" });
  }
}
