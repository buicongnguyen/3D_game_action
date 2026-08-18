import { distSq } from "../../core/math.ts";
import { PRESSURE, STRUCTURES } from "../../data/balance.ts";
import type { GameWorld } from "../GameWorld.ts";

/**
 * The pressure network — the rule that produces the whole game.
 *
 * The spider generates pressure while it has fuel. Anything inside the service
 * radius (directly, or via a powered relay) refills its buffer. Outside it, a
 * structure keeps working until its buffer drains, then starves.
 *
 * That single rule is what creates the leapfrog: a turret placed ahead is
 * useless until the spider catches up, and a turret left behind has a known
 * countdown before it goes quiet. Both halves of the decision are legible from
 * one number, which is why the buffer is expressed in seconds rather than as
 * an abstract charge.
 */
export class PressureNetworkSystem {
  /** Relays serving this tick, on a source or on their own buffer. */
  private readonly poweredRelays: number[] = [];
  /** Relays fed by the spider directly - the only legal hop sources. */
  private readonly directRelays: number[] = [];
  /** Relays with a real upstream source, and so the only ones that recharge. */
  private readonly suppliedRelays = new Set<number>();

  update(world: GameWorld, dt: number): void {
    const spider = world.spider;
    const serviceRadius = spider.serviceRadius * world.modifiers.serviceRadius;
    const serviceRadiusSq = serviceRadius * serviceRadius;
    // A dry spider produces no pressure. Fuel is therefore not just speed: it
    // is every turret on the field.
    const producing = spider.fuel > 0;

    this.resolveRelays(world, serviceRadiusSq, producing);
    this.updateStructures(world, dt, serviceRadiusSq, producing);
    this.updateCylinderProduction(world, dt, producing);
  }

  /**
   * Relays are resolved first and in a single pass from the spider outward, so
   * a relay only extends the network if it is itself powered. Chaining is
   * intentionally limited to one hop past a directly-powered relay: unlimited
   * chaining would let a player build a permanent base, which is exactly what
   * this game is not.
   */
  private resolveRelays(world: GameWorld, serviceRadiusSq: number, producing: boolean): void {
    this.poweredRelays.length = 0;
    this.directRelays.length = 0;
    this.suppliedRelays.clear();
    const spider = world.spider;
    const relayRangeSq = STRUCTURES.relay.range * STRUCTURES.relay.range;

    for (let i = 0; i < world.structures.length; i++) {
      const structure = world.structures[i];
      if (structure.kind !== "relay") continue;
      if (structure.state !== "active") {
        structure.powered = false;
        continue;
      }
      const direct =
        producing && distSq(structure.x, structure.z, spider.x, spider.z) <= serviceRadiusSq;
      // Two different questions, and conflating them let a relay live forever.
      //
      // `supplied` is "something upstream is feeding this": the spider, or one
      // hop from a relay the spider itself feeds. `powered` is "this is still
      // serving", which a relay does on its own buffer after it drops out of
      // range - the grace period that makes a relay worth carrying.
      //
      // Only `supplied` may recharge. When `powered` drove the recharge, any
      // relay with a scrap of buffer counted as powered, recharged from that,
      // and so never drained: a permanent free network node, which is the exact
      // thing the one-hop limit above exists to prevent.
      if (direct) {
        this.directRelays.push(i);
        this.suppliedRelays.add(i);
      }
      structure.powered = direct || structure.buffer > 0;
      if (structure.powered) this.poweredRelays.push(i);
    }

    // Second pass: one hop from a *directly supplied* relay. The source list is
    // the first pass's snapshot, so a relay this loop adds cannot itself become
    // a source and turn "one hop" into a chain of any length.
    for (let i = 0; i < world.structures.length; i++) {
      const structure = world.structures[i];
      if (structure.kind !== "relay" || structure.state !== "active") continue;
      if (this.suppliedRelays.has(i)) continue;
      for (let j = 0; j < this.directRelays.length; j++) {
        const other = world.structures[this.directRelays[j]];
        if (distSq(structure.x, structure.z, other.x, other.z) <= relayRangeSq) {
          this.suppliedRelays.add(i);
          if (!structure.powered) {
            structure.powered = true;
            this.poweredRelays.push(i);
          }
          break;
        }
      }
    }
  }

  private updateStructures(
    world: GameWorld,
    dt: number,
    serviceRadiusSq: number,
    producing: boolean,
  ): void {
    const spider = world.spider;
    const relayRangeSq = STRUCTURES.relay.range * STRUCTURES.relay.range;

    for (let i = 0; i < world.structures.length; i++) {
      const structure = world.structures[i];
      if (structure.state === "destroyed") continue;
      if (structure.state === "dropped") {
        structure.powered = false;
        continue;
      }

      if (structure.maxBuffer <= 0) {
        structure.powered = true;
        continue;
      }
      // Whether this structure has an upstream source right now. For everything
      // but a relay that is the same as `powered`; for a relay it deliberately
      // is not, because a relay running on its own buffer still serves the
      // network while it drains, and must not refill itself from itself.
      let inNetwork: boolean;
      if (structure.kind === "relay") {
        inNetwork = this.suppliedRelays.has(i);
      } else {
        inNetwork =
          producing && distSq(structure.x, structure.z, spider.x, spider.z) <= serviceRadiusSq;
        if (!inNetwork) {
          for (let j = 0; j < this.poweredRelays.length; j++) {
            const relay = world.structures[this.poweredRelays[j]];
            if (distSq(structure.x, structure.z, relay.x, relay.z) <= relayRangeSq) {
              inNetwork = true;
              break;
            }
          }
        }
        structure.powered = inNetwork;
      }

      if (structure.state === "overloading") continue;

      if (inNetwork) {
        if (structure.buffer < structure.maxBuffer) {
          structure.buffer = Math.min(
            structure.maxBuffer,
            structure.buffer + PRESSURE.rechargePerSecond * dt,
          );
        }
        if (structure.state === "starved") {
          structure.state = "active";
        }
      } else {
        const wasRunning = structure.buffer > 0;
        structure.buffer = Math.max(0, structure.buffer - dt);
        if (wasRunning && structure.buffer <= 0) {
          structure.state = "starved";
          world.events.emit({
            type: "structure.bufferEmpty",
            structureId: structure.id,
            x: structure.x,
            z: structure.z,
          });
        }
      }
    }
  }

  /**
   * The boiler produces carryable cylinders. They are physical objects, not a
   * third currency: you can hold exactly one, and carrying it means not
   * carrying a folded turret.
   */
  private updateCylinderProduction(world: GameWorld, dt: number, producing: boolean): void {
    if (!producing) return;
    const spider = world.spider;
    const maxHeld = 2 + (spider.installedModules.includes("module.boiler") ? 2 : 0);
    if (world.cylindersReady >= maxHeld) return;

    const rate = spider.installedModules.includes("module.boiler") ? 1.8 : 1;
    world.cylinderTimer += dt * rate;
    if (world.cylinderTimer >= PRESSURE.cylinderProductionTime) {
      world.cylinderTimer -= PRESSURE.cylinderProductionTime;
      world.cylindersReady++;
    }
  }

  /** True when a world point is currently served by the network. */
  isServed(world: GameWorld, x: number, z: number): boolean {
    const spider = world.spider;
    if (spider.fuel <= 0) return false;
    const radius = spider.serviceRadius * world.modifiers.serviceRadius;
    if (distSq(x, z, spider.x, spider.z) <= radius * radius) return true;
    const relayRangeSq = STRUCTURES.relay.range * STRUCTURES.relay.range;
    for (let i = 0; i < world.structures.length; i++) {
      const structure = world.structures[i];
      if (structure.kind !== "relay" || !structure.powered || structure.state !== "active") continue;
      if (distSq(x, z, structure.x, structure.z) <= relayRangeSq) return true;
    }
    return false;
  }
}
