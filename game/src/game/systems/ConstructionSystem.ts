import { clamp, dist, distSq, headingFromDirection } from "../../core/math.ts";
import type { InputSnapshot } from "../../input/InputActions.ts";
import type { PlacementValidity, Structure, StructureKind } from "../../core/types.ts";
import { PLAYER, STRUCTURES, TRAIL } from "../../data/balance.ts";
import { getBlueprint, getStructureConfig } from "../../data/structures.ts";
import type { GameWorld } from "../GameWorld.ts";

/**
 * Controller-first placement, per §8.5.
 *
 * The whole interaction is: hold L1, flick the right stick to a blueprint,
 * release L1, steer the ghost, press Cross. That is three actions after the
 * radial opens, which is the acceptance criterion, and it never needs a cursor.
 *
 * Time slows to 20% while the radial is open. That is not a convenience — it
 * is what makes opening the radial under horde pressure survivable, and so it
 * is what makes building during a fight a real option rather than a trap.
 */
export class ConstructionSystem {
  /** Ghost offset from the player, in world space. Steered by the right stick. */
  private ghostOffsetX = 0;
  private ghostOffsetZ = 2.5;

  private cameraForwardX = 0;
  private cameraForwardZ = 1;
  private cameraRightX = 1;
  private cameraRightZ = 0;

  setCameraBasis(forwardX: number, forwardZ: number, rightX: number, rightZ: number): void {
    this.cameraForwardX = forwardX;
    this.cameraForwardZ = forwardZ;
    this.cameraRightX = rightX;
    this.cameraRightZ = rightZ;
  }

  update(world: GameWorld, dt: number, input: InputSnapshot): void {
    const build = world.build;

    this.updateBlueprintCycling(world, input);

    if (input.buttons.buildRadial.held) {
      if (!build.radialOpen) this.openRadial(world);
      this.updateRadialSelection(world, input);
      world.timeScale = 0.2;
      return;
    }

    if (build.radialOpen) {
      this.closeRadial(world);
      world.timeScale = 1;
    }

    if (build.ghostActive) {
      this.updateGhost(world, dt, input);
    }
  }

  private updateBlueprintCycling(world: GameWorld, input: InputSnapshot): void {
    const build = world.build;
    const count = world.loadout.length;
    if (input.buttons.blueprintNext.pressed) {
      build.selectedBlueprint = (build.selectedBlueprint + 1) % count;
    }
    if (input.buttons.blueprintPrev.pressed) {
      build.selectedBlueprint = (build.selectedBlueprint - 1 + count) % count;
    }
  }

  private openRadial(world: GameWorld): void {
    world.build.radialOpen = true;
    world.build.radialIndex = world.build.selectedBlueprint;
    world.events.emit({ type: "ui.toast", message: "", tone: "info", duration: 0 });
  }

  private updateRadialSelection(world: GameWorld, input: InputSnapshot): void {
    const stick = input.rightStick;
    if (!stick.active || stick.magnitude < 0.5) return;
    // Screen-space angle: up is index 0, then clockwise. atan2(x, -y) puts 0 at
    // the top and increases clockwise, which matches how the radial is drawn.
    const angle = Math.atan2(stick.x, -stick.y);
    const normalized = (angle + Math.PI * 2) % (Math.PI * 2);
    const count = world.loadout.length;
    const index = Math.round((normalized / (Math.PI * 2)) * count) % count;
    world.build.radialIndex = index;
  }

  private closeRadial(world: GameWorld): void {
    const build = world.build;
    build.radialOpen = false;
    build.selectedBlueprint = build.radialIndex;

    const kind = world.loadout[build.selectedBlueprint];
    if (!kind) return;

    const blueprint = getBlueprint(kind);
    const cost = Math.ceil(blueprint.cost * world.modifiers.structureCost);
    if (world.resources.scrap < cost) {
      world.events.emit({ type: "build.rejected", reason: `Need ${cost} scrap` });
      return;
    }

    build.ghostActive = true;
    build.ghostKind = kind;
    this.ghostOffsetX = Math.sin(world.player.heading) * 3;
    this.ghostOffsetZ = Math.cos(world.player.heading) * 3;
  }

  private updateGhost(world: GameWorld, dt: number, input: InputSnapshot): void {
    const build = world.build;
    const player = world.player;

    if (input.buttons.cancel.pressed) {
      this.cancelGhost(world);
      return;
    }

    const stick = input.rightStick;
    if (stick.active) {
      const dirX = this.cameraRightX * stick.x + this.cameraForwardX * -stick.y;
      const dirZ = this.cameraRightZ * stick.x + this.cameraForwardZ * -stick.y;
      const speed = 7.5 * stick.magnitude;
      this.ghostOffsetX += dirX * speed * dt;
      this.ghostOffsetZ += dirZ * speed * dt;
    }

    // Clamp the offset to the build range so the ghost can never leave reach.
    const offsetLength = Math.hypot(this.ghostOffsetX, this.ghostOffsetZ);
    const maxRange = PLAYER.buildRange;
    if (offsetLength > maxRange) {
      this.ghostOffsetX = (this.ghostOffsetX / offsetLength) * maxRange;
      this.ghostOffsetZ = (this.ghostOffsetZ / offsetLength) * maxRange;
    } else if (offsetLength < 1.2) {
      // Never let the ghost sit inside the engineer's own footprint.
      const angle = offsetLength < 1e-4 ? player.heading : Math.atan2(this.ghostOffsetX, this.ghostOffsetZ);
      this.ghostOffsetX = Math.sin(angle) * 1.2;
      this.ghostOffsetZ = Math.cos(angle) * 1.2;
    }

    // Snapping to a half-metre grid removes fiddly precision from the stick
    // without the player ever having to think about a grid.
    const rawX = player.x + this.ghostOffsetX;
    const rawZ = player.z + this.ghostOffsetZ;
    build.ghostX = Math.round(rawX * 2) / 2;
    build.ghostZ = Math.round(rawZ * 2) / 2;

    // Automatic rotation: structures face away from the spider's travel, which
    // is where the horde comes from. The player never rotates by hand.
    build.ghostHeading = this.autoHeading(world, build.ghostX, build.ghostZ);

    const result = this.validate(world, build.ghostKind!, build.ghostX, build.ghostZ);
    build.ghostValidity = result.validity;
    build.ghostReason = result.reason;

    if (input.buttons.confirm.pressed) {
      if (result.validity === "invalid") {
        world.events.emit({ type: "build.rejected", reason: result.reason });
      } else {
        this.commit(world);
      }
    }
  }

  /**
   * Faces a structure back down the route, toward the pursuing horde. Turrets
   * still traverse freely; this only sets the resting pose and the barricade's
   * blocking axis.
   */
  private autoHeading(world: GameWorld, x: number, z: number): number {
    const spline = world.route.spline;
    if (!spline) return 0;
    const distance = spline.projectPoint(scratchPoint, x, z);
    const forward = spline.headingAt(clamp(distance, 0, spline.length));
    return forward + Math.PI;
  }

  /**
   * Placement validation. Returns "unpowered" rather than "invalid" when the
   * only problem is being outside the pressure network, because placing ahead
   * of the spider is the whole leapfrog technique - the yellow ghost means
   * "this will work once the spider catches up", which is exactly the signal
   * the player needs.
   */
  validate(
    world: GameWorld,
    kind: StructureKind,
    x: number,
    z: number,
  ): { validity: PlacementValidity; reason: string } {
    const blueprint = getBlueprint(kind);
    const cost = Math.ceil(blueprint.cost * world.modifiers.structureCost);

    if (world.resources.scrap < cost) {
      return { validity: "invalid", reason: `Need ${cost} scrap` };
    }

    const player = world.player;
    if (distSq(x, z, player.x, player.z) > PLAYER.buildRange * PLAYER.buildRange + 0.01) {
      return { validity: "invalid", reason: "Out of range" };
    }

    if (!world.route.isInsideCorridor(x, z)) {
      return { validity: "invalid", reason: "Off the route" };
    }

    if (world.navigation.isBlockedCircle(x, z, blueprint.radius)) {
      return { validity: "invalid", reason: "Blocked ground" };
    }

    // The spider must never be able to walk into its own defences.
    const spider = world.spider;
    const spiderClearance = 3.4 + blueprint.radius;
    if (distSq(x, z, spider.x, spider.z) < spiderClearance * spiderClearance) {
      return { validity: "invalid", reason: "Too close to the spider" };
    }

    for (let i = 0; i < world.structures.length; i++) {
      const other = world.structures[i];
      if (other.state === "destroyed") continue;
      const minimum = blueprint.radius + getBlueprint(other.kind).radius + 0.5;
      if (distSq(x, z, other.x, other.z) < minimum * minimum) {
        return { validity: "invalid", reason: "Too close to a structure" };
      }
    }

    if (blueprint.usesPressure && !this.isInPressureNetwork(world, x, z)) {
      return { validity: "unpowered", reason: "Outside the pressure network" };
    }

    return { validity: "valid", reason: "" };
  }

  private isInPressureNetwork(world: GameWorld, x: number, z: number): boolean {
    const spider = world.spider;
    const radius = spider.serviceRadius * world.modifiers.serviceRadius;
    if (distSq(x, z, spider.x, spider.z) <= radius * radius) return true;

    for (let i = 0; i < world.structures.length; i++) {
      const structure = world.structures[i];
      if (structure.kind !== "relay") continue;
      if (structure.state !== "active" || !structure.powered) continue;
      const relayRange = STRUCTURES.relay.range;
      if (distSq(x, z, structure.x, structure.z) <= relayRange * relayRange) return true;
    }
    return false;
  }

  private commit(world: GameWorld): void {
    const build = world.build;
    const kind = build.ghostKind;
    if (!kind) return;

    const blueprint = getBlueprint(kind);
    const cost = Math.ceil(blueprint.cost * world.modifiers.structureCost);
    world.resources.scrap -= cost;
    world.events.emit({ type: "resource.spent", kind: "scrap", amount: cost, reason: kind });

    this.spawnStructure(world, kind, build.ghostX, build.ghostZ, build.ghostHeading, 1, -1);

    build.ghostActive = false;
    build.ghostKind = null;
  }

  /**
   * Creates a structure. `healthFraction` and `buffer` let a reinstalled
   * machine carry its wear forward: recovering a damaged turret gives you back
   * a damaged turret, which is what makes repairing before folding matter.
   */
  spawnStructure(
    world: GameWorld,
    kind: StructureKind,
    x: number,
    z: number,
    heading: number,
    healthFraction: number,
    buffer: number,
  ): Structure {
    const config = getStructureConfig(kind);
    const maxBuffer = config.maxBuffer * world.modifiers.structureBuffer;

    const structure: Structure = {
      id: world.allocateId(),
      kind,
      category: config.category,
      x,
      z,
      heading,
      health: config.health * healthFraction,
      maxHealth: config.health,
      buffer: buffer >= 0 ? Math.min(buffer, maxBuffer) : maxBuffer,
      maxBuffer,
      state: "deploying",
      stateTimer: config.deployTime,
      powered: false,
      fireCooldown: 0,
      targetEnemyId: -1,
      targetLockTimer: 0,
      turretHeading: heading,
      shotsFired: 0,
      behindSpider: false,
      idleTime: 0,
      active: true,
    };

    world.structures.push(structure);
    world.stats.structuresPlaced++;

    // A barricade physically blocks pathing, so the nav grid must learn about
    // it immediately or enemies will walk straight through.
    if (kind === "barricade") {
      world.navigation.addObstacle(x, z, config.radius, structure.id);
    }

    world.trail = Math.min(TRAIL.max, world.trail + TRAIL.noiseStructurePlaced);
    world.events.emit({ type: "structure.placed", structureId: structure.id, kind, x, z });
    world.events.emit({
      type: "noise.generated",
      amount: TRAIL.noiseStructurePlaced,
      x,
      z,
      reason: "build",
    });
    return structure;
  }

  cancelGhost(world: GameWorld): void {
    world.build.ghostActive = false;
    world.build.ghostKind = null;
  }

  /** Removes a structure from the world and releases its nav obstacle. */
  removeStructure(world: GameWorld, structure: Structure): void {
    if (structure.kind === "barricade") {
      world.navigation.removeObstacle(structure.id);
    }
    const index = world.structures.indexOf(structure);
    if (index >= 0) world.structures.splice(index, 1);
  }
}

const scratchPoint = { x: 0, z: 0 };

/** Shared helper: distance from a structure to the nearest live pressure source. */
export function distanceToNetwork(world: GameWorld, x: number, z: number): number {
  const spider = world.spider;
  let best = dist(x, z, spider.x, spider.z) - spider.serviceRadius * world.modifiers.serviceRadius;
  for (let i = 0; i < world.structures.length; i++) {
    const structure = world.structures[i];
    if (structure.kind !== "relay" || structure.state !== "active" || !structure.powered) continue;
    const d = dist(x, z, structure.x, structure.z) - STRUCTURES.relay.range;
    if (d < best) best = d;
  }
  return best;
}

/** Heading a structure should face given a direction of travel. */
export function facingFromTravel(dirX: number, dirZ: number): number {
  return headingFromDirection(-dirX, -dirZ);
}
