import { clamp, distSq } from "../../core/math.ts";
import type { ContextualActionKind, PickupKind, Structure } from "../../core/types.ts";
import type { InputSnapshot } from "../../input/InputActions.ts";
import { ECONOMY, PICKUPS, PLAYER, PRESSURE, STRUCTURES } from "../../data/balance.ts";
import { getBlueprint, getStructureConfig } from "../../data/structures.ts";
import type { ConstructionSystem } from "./ConstructionSystem.ts";
import type { GameWorld } from "../GameWorld.ts";

/**
 * Every "sustain" and "abandon" action: repair, refuel, recharge, fold, carry,
 * reinstall, and Last Shot.
 *
 * The design rule from §25 is that each action must produce a large, immediate
 * result. So repairs restore 22% of maximum health in one 0.9 s hold and a
 * cylinder restores an entire 30 s buffer — never a trickle, never a bar that
 * needs topping up every few seconds. A player who services a turret should
 * feel they bought most of a stretch, not a few more shots.
 */
export class InteractionSystem {
  /**
   * The action the HUD should advertise right now. This is the single most
   * useful thing to do, but it is only a suggestion for display.
   */
  availableAction: ContextualActionKind | null = null;
  availableTargetId = -1;
  availableLabel = "";

  /**
   * Square and Triangle are separate buttons, so they resolve separately.
   *
   * Collapsing them into one "best action" is what made a damaged turret
   * impossible to recover: repair always outranked fold for display, and the
   * fold button then had nothing to do. Since the leapfrog depends on picking
   * up machines that have been chewed on, each button gets its own target.
   */
  serviceAction: ContextualActionKind | null = null;
  serviceTargetId = -1;
  foldTargetId = -1;

  constructor(private readonly construction: ConstructionSystem) {}

  update(world: GameWorld, dt: number, input: InputSnapshot): void {
    const player = world.player;

    this.updateStructureTimers(world, dt);

    if (player.downed || world.build.ghostActive || world.build.radialOpen) {
      this.availableAction = null;
      this.availableTargetId = -1;
      this.availableLabel = "";
      this.serviceAction = null;
      this.serviceTargetId = -1;
      this.foldTargetId = -1;
      this.cancelHeldAction(world);
      return;
    }

    this.resolveAvailableAction(world);
    this.updateHeldAction(world, dt, input);
    this.updateInstantActions(world, input);
  }

  // -------------------------------------------------------------------------
  // Structure lifecycle timers
  // -------------------------------------------------------------------------

  private updateStructureTimers(world: GameWorld, dt: number): void {
    for (let i = world.structures.length - 1; i >= 0; i--) {
      const structure = world.structures[i];

      if (structure.stateTimer > 0) structure.stateTimer -= dt;

      switch (structure.state) {
        case "deploying":
          if (structure.stateTimer <= 0) structure.state = "active";
          break;

        case "overloading":
          this.updateOverload(world, structure, dt);
          break;

        case "folding":
          if (structure.stateTimer <= 0) this.completeFold(world, structure, false);
          break;

        default:
          break;
      }

      if (structure.health <= 0 && structure.state !== "destroyed") {
        this.destroyStructure(world, structure);
      }
    }

    this.updateLeftBehindFlags(world);
  }

  /**
   * Marks structures the spider has passed. This is the signal the HUD turns
   * into a "leaving something behind" alert, and it is the moment the player
   * has to choose between going back and letting it go.
   */
  private updateLeftBehindFlags(world: GameWorld): void {
    const spline = world.route.spline;
    if (!spline) return;
    const spiderDistance = world.spider.distanceAlongRoute;

    for (let i = 0; i < world.structures.length; i++) {
      const structure = world.structures[i];
      if (structure.state === "destroyed") continue;
      const distance = spline.projectPoint(scratch, structure.x, structure.z);
      const behind = distance < spiderDistance - 6;
      if (behind && !structure.behindSpider) {
        structure.behindSpider = true;
        if (structure.category === "foldable") {
          world.events.emit({
            type: "structure.leftBehind",
            structureId: structure.id,
            kind: structure.kind,
            x: structure.x,
            z: structure.z,
          });
        }
      } else if (!behind) {
        structure.behindSpider = false;
      }
    }
  }

  private updateOverload(world: GameWorld, structure: Structure, dt: number): void {
    void dt;
    if (structure.stateTimer > 0) return;
    const config = getStructureConfig(structure.kind);
    world.events.emit({
      type: "structure.exploded",
      structureId: structure.id,
      x: structure.x,
      z: structure.z,
      radius: config.explosionRadius,
    });
    structure.state = "destroyed";
    structure.health = 0;
    this.construction.removeStructure(world, structure);
  }

  // -------------------------------------------------------------------------
  // Contextual action resolution
  // -------------------------------------------------------------------------

  /**
   * Picks the single most useful action for the player's current position and
   * payload. Exactly one prompt is ever shown; a context menu on a controller
   * under horde pressure would be unusable.
   */
  private resolveAvailableAction(world: GameWorld): void {
    const player = world.player;
    this.availableAction = null;
    this.availableTargetId = -1;
    this.availableLabel = "";
    this.serviceAction = null;
    this.serviceTargetId = -1;
    this.foldTargetId = -1;

    const rangeSq = PLAYER.interactionRange * PLAYER.interactionRange;

    // Triangle always folds the nearest foldable machine, whatever the prompt
    // happens to be advertising.
    if (player.carry.kind === "none") {
      const foldable = this.nearestStructure(world, rangeSq, true);
      if (foldable) this.foldTargetId = foldable.id;
    }

    // Carrying a folded machine: the only useful action is putting it down.
    if (player.carry.kind === "structure") {
      this.availableAction = "install";
      this.availableLabel = `Install ${getBlueprint(player.carry.structureType).name}`;
      return;
    }

    // Field salvage is already folded and inert. Treat it like loot: one tap
    // collects it, while installed machines retain the deliberate recovery
    // hold that makes leapfrogging risky under pressure.
    if (player.carry.kind === "none") {
      const dropped = this.nearestDroppedStructure(world, rangeSq);
      if (dropped) {
        this.availableAction = "collect";
        this.availableTargetId = dropped.id;
        this.availableLabel = `Collect ${getBlueprint(dropped.kind).name}`;
        return;
      }
    }

    // Near the spider with a cylinder: hand it over as fuel is not the point;
    // the cylinder charges machines, so the spider offers a swap instead.
    const spiderInRange =
      distSq(player.x, player.z, world.spider.x, world.spider.z) <
      (rangeSq + 25);

    if (player.carry.kind === "cylinder") {
      const target = this.nearestChargeableStructure(world, rangeSq);
      if (target) {
        this.setService(world, "recharge", target.id, `Recharge ${getBlueprint(target.kind).name}`);
        return;
      }
    }

    if (spiderInRange) {
      if (world.spider.fuel < world.spider.maxFuel - 1 && world.resources.fuel > 0) {
        this.setService(world, "refuel", -1, "Refuel spider");
        return;
      }
      if (
        world.spider.coreHealth < world.spider.maxCoreHealth - 1 &&
        world.resources.scrap >= ECONOMY.repairCostPer10Percent
      ) {
        this.setService(world, "repair", -1, "Repair spider core");
        return;
      }
      if (player.carry.kind === "none" && world.cylindersReady > 0) {
        this.availableAction = "pickupCylinder";
        this.availableLabel = "Take pressure cylinder";
        return;
      }
    }

    const structure = this.nearestStructure(world, rangeSq);
    if (!structure) return;

    const blueprint = getBlueprint(structure.kind);

    if (
      structure.state !== "overloading" &&
      structure.state !== "dropped" &&
      structure.health < structure.maxHealth - 1 &&
      world.resources.scrap >= ECONOMY.repairCostPer10Percent
    ) {
      this.setService(world, "repair", structure.id, `Repair ${blueprint.name}`);
    }

    // Last Shot is the dramatic primary choice; Recover remains available on
    // its dedicated fold button through foldTargetId. Previously fold returned
    // first, making this signature mechanic unreachable through normal input.
    if (
      structure.state !== "overloading" &&
      structure.state !== "dropped" &&
      structure.category === "foldable" &&
      structure.buffer > 0
    ) {
      this.availableAction = "lastShot";
      this.availableTargetId = structure.id;
      this.availableLabel = `Overload ${blueprint.name}`;
      return;
    }

    // With no Last Shot available, a valid service action remains the primary
    // prompt and Recover is advertised as its secondary alternative.
    if (this.serviceAction !== null) return;

    if (this.foldTargetId >= 0) {
      const target = world.findStructure(this.foldTargetId);
      if (target) {
        this.availableAction = "fold";
        this.availableTargetId = target.id;
        this.availableLabel = `Recover ${getBlueprint(target.kind).name}`;
        return;
      }
    }

  }

  /**
   * Records a Square action both as the advertised prompt and as the target the
   * service button will act on, so the two can never drift apart.
   */
  private setService(
    world: GameWorld,
    kind: ContextualActionKind,
    targetId: number,
    label: string,
  ): void {
    void world;
    this.availableAction = kind;
    this.availableTargetId = targetId;
    this.availableLabel = label;
    this.serviceAction = kind;
    this.serviceTargetId = targetId;
  }

  private nearestStructure(
    world: GameWorld,
    rangeSq: number,
    foldableOnly = false,
  ): Structure | null {
    const player = world.player;
    let best: Structure | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < world.structures.length; i++) {
      const structure = world.structures[i];
      if (
        structure.state === "destroyed" ||
        structure.state === "folding" ||
        structure.state === "overloading"
      ) continue;
      if (foldableOnly && structure.category !== "foldable") continue;
      const blueprint = getBlueprint(structure.kind);
      // Measure to the structure's surface, not its centre, so a big barricade
      // is not harder to reach than a small mine.
      const reach = rangeSq + blueprint.radius * blueprint.radius;
      const d = distSq(player.x, player.z, structure.x, structure.z);
      if (d <= reach && d < bestDistance) {
        bestDistance = d;
        best = structure;
      }
    }
    return best;
  }

  private nearestChargeableStructure(world: GameWorld, rangeSq: number): Structure | null {
    const player = world.player;
    let best: Structure | null = null;
    let bestFraction = 1;
    for (let i = 0; i < world.structures.length; i++) {
      const structure = world.structures[i];
      if (
        structure.maxBuffer <= 0 ||
        structure.state === "destroyed" ||
        structure.state === "overloading" ||
        structure.state === "dropped"
      ) continue;
      if (distSq(player.x, player.z, structure.x, structure.z) > rangeSq + 1) continue;
      const fraction = structure.buffer / structure.maxBuffer;
      if (fraction < bestFraction) {
        bestFraction = fraction;
        best = structure;
      }
    }
    return best;
  }

  private nearestDroppedStructure(world: GameWorld, rangeSq: number): Structure | null {
    const player = world.player;
    let best: Structure | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < world.structures.length; i++) {
      const structure = world.structures[i];
      if (structure.state !== "dropped" || structure.category !== "foldable") continue;
      const radius = getBlueprint(structure.kind).radius;
      const d = distSq(player.x, player.z, structure.x, structure.z);
      if (d <= rangeSq + radius * radius && d < bestDistance) {
        best = structure;
        bestDistance = d;
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Held actions
  // -------------------------------------------------------------------------

  private updateHeldAction(world: GameWorld, dt: number, input: InputSnapshot): void {
    const player = world.player;

    // Square services (repair/refuel/recharge); Triangle recovers (fold). The
    // two are independent, so a battered turret can be picked up without first
    // being forced through a repair.
    const serviceHeld = input.buttons.service.held;
    const foldHeld = input.buttons.fold.held;

    let desired: ContextualActionKind | null = null;
    let targetId = -1;

    if (foldHeld && this.foldTargetId >= 0) {
      desired = "fold";
      targetId = this.foldTargetId;
    } else if (serviceHeld && this.serviceAction !== null) {
      desired = this.serviceAction;
      targetId = this.serviceTargetId;
    }

    if (desired === null) {
      this.cancelHeldAction(world);
      return;
    }

    if (player.actionKind !== desired || player.actionTargetId !== targetId) {
      player.actionKind = desired;
      player.actionTargetId = targetId;
      player.actionProgress = 0;
    }

    const duration = this.actionDuration(world, desired);
    player.actionProgress += dt;
    player.animState = desired === "fold" ? "repair" : "repair";

    if (player.actionProgress >= duration) {
      player.actionProgress = 0;
      this.completeAction(world, desired, targetId);
      // Folding removes the target, so the held action must not repeat blindly.
      if (desired === "fold") {
        player.actionKind = null;
        player.actionTargetId = -1;
      }
    }
  }

  private actionDuration(world: GameWorld, kind: ContextualActionKind): number {
    switch (kind) {
      case "repair":
        return PLAYER.repairDuration;
      case "refuel":
        return PLAYER.refuelDuration;
      case "recharge":
        return PLAYER.refuelDuration;
      case "fold":
        return PLAYER.foldDuration / world.modifiers.foldSpeed;
      default:
        return PLAYER.installDuration;
    }
  }

  private cancelHeldAction(world: GameWorld): void {
    const player = world.player;
    if (player.actionKind === null) return;
    player.actionKind = null;
    player.actionTargetId = -1;
    player.actionProgress = 0;
  }

  private completeAction(world: GameWorld, kind: ContextualActionKind, targetId: number): void {
    switch (kind) {
      case "repair":
        this.performRepair(world, targetId);
        break;
      case "refuel":
        this.performRefuel(world);
        break;
      case "recharge":
        this.performRecharge(world, targetId);
        break;
      case "fold":
        this.beginFold(world, targetId);
        break;
      default:
        break;
    }
  }

  private performRepair(world: GameWorld, targetId: number): void {
    const cost = ECONOMY.repairCostPer10Percent;
    if (world.resources.scrap < cost) return;
    world.resources.scrap -= cost;
    world.events.emit({ type: "resource.spent", kind: "scrap", amount: cost, reason: "repair" });

    const fraction = ECONOMY.repairFractionPerAction * world.modifiers.repairPower;

    if (targetId < 0) {
      const spider = world.spider;
      const amount = spider.maxCoreHealth * fraction;
      spider.coreHealth = Math.min(spider.maxCoreHealth, spider.coreHealth + amount);
      world.events.emit({
        type: "structure.repaired",
        structureId: -1,
        x: spider.x,
        z: spider.z,
        amount,
      });
    } else {
      const structure = world.findStructure(targetId);
      if (!structure) return;
      const amount = structure.maxHealth * fraction;
      structure.health = Math.min(structure.maxHealth, structure.health + amount);
      world.events.emit({
        type: "structure.repaired",
        structureId: structure.id,
        x: structure.x,
        z: structure.z,
        amount,
      });
    }
    this.grantActionXp(world, 1);
  }

  private performRefuel(world: GameWorld): void {
    const spider = world.spider;
    const available = Math.min(world.resources.fuel, ECONOMY.refuelPerAction);
    if (available <= 0) return;
    const accepted = Math.min(available, spider.maxFuel - spider.fuel);
    spider.fuel += accepted;
    world.resources.fuel -= accepted;
    world.events.emit({ type: "spider.refuelled", amount: accepted, total: spider.fuel });
    this.grantActionXp(world, 1);
  }

  private performRecharge(world: GameWorld, targetId: number): void {
    const structure = world.findStructure(targetId);
    if (!structure) return;
    if (world.player.carry.kind !== "cylinder") return;
    structure.buffer = Math.min(structure.maxBuffer, structure.buffer + PRESSURE.cylinderCharge);
    if (structure.state === "starved") structure.state = "active";
    world.player.carry = { kind: "none" };
    world.events.emit({
      type: "structure.recharged",
      structureId: structure.id,
      x: structure.x,
      z: structure.z,
    });
    this.grantActionXp(world, 1);
  }

  private beginFold(world: GameWorld, targetId: number): void {
    const structure = world.findStructure(targetId);
    if (!structure || structure.category !== "foldable") return;
    if (world.player.carry.kind !== "none") return;
    structure.state = "folding";
    structure.stateTimer = 0;
    this.completeFold(world, structure, false);
  }

  private completeFold(world: GameWorld, structure: Structure, bankImmediately: boolean): void {
    const awardRecoveryXp = !structure.recoveryXpGranted;
    if (!bankImmediately) {
      world.player.carry = {
        kind: "structure",
        structureType: structure.kind,
        health: structure.health / structure.maxHealth,
        buffer: structure.buffer,
        recoveryXpGranted: true,
      };
    }
    world.stats.structuresRecovered++;
    world.events.emit({
      type: "structure.folded",
      structureId: structure.id,
      kind: structure.kind,
      x: structure.x,
      z: structure.z,
    });
    structure.state = "destroyed";
    this.construction.removeStructure(world, structure);
    if (awardRecoveryXp) this.grantActionXp(world, 5);
    if (awardRecoveryXp && world.mode === "salvageRush") {
      const blueprint = getBlueprint(structure.kind);
      const condition = structure.health / Math.max(1, structure.maxHealth);
      const score = Math.round(blueprint.cost * 5 * (0.5 + condition * 0.5) + structure.buffer * 2);
      world.salvageScore += score;
      // Salvage Rush banks recovered machinery immediately at the Spider's
      // abstract rack. Filling the engineer's hands after one pickup made the
      // collection mode ask for an install/drop action between every item.
      if (bankImmediately) world.player.carry = { kind: "none" };
      world.events.emit({
        type: "ui.toast",
        message: `Salvaged ${blueprint.name} · +${score}`,
        tone: "success",
        duration: 3,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Instant actions
  // -------------------------------------------------------------------------

  private updateInstantActions(world: GameWorld, input: InputSnapshot): void {
    if (!input.buttons.confirm.pressed) return;
    const player = world.player;

    if (player.carry.kind === "structure") {
      this.installCarried(world);
      return;
    }

    if (this.availableAction === "pickupCylinder" && world.cylindersReady > 0) {
      world.cylindersReady--;
      player.carry = { kind: "cylinder" };
      player.animState = "interact";
      player.animLock = 0.4;
      return;
    }

    if (this.availableAction === "collect" && this.availableTargetId >= 0) {
      const structure = world.findStructure(this.availableTargetId);
      if (structure?.state === "dropped") this.completeFold(world, structure, world.mode === "salvageRush");
      return;
    }

    if (this.availableAction === "lastShot" && this.availableTargetId >= 0) {
      this.triggerLastShot(world, this.availableTargetId, "manual");
    }
  }

  /**
   * Puts a carried machine down. Reinstalling is free — the scrap was already
   * spent — which is what makes recovering a turret compete with building a
   * fresh one, and what makes the rear turret worth walking back for.
   */
  private installCarried(world: GameWorld): void {
    const player = world.player;
    if (player.carry.kind !== "structure") return;

    const kind = player.carry.structureType;
    const heading = player.heading;

    // Search outward from straight ahead for somewhere the machine will fit.
    //
    // Refusing the drop because the exact spot two metres ahead is occupied is
    // the wrong answer during the one action the whole loop is built around:
    // the player is standing in a fight holding a turret, and "no" without a
    // remedy is just friction. A short spiral finds the nearest legal spot,
    // which is what they meant anyway.
    let placedX = 0;
    let placedZ = 0;
    let found = false;
    let lastReason = "No room to install";

    for (let ring = 0; ring < INSTALL_RINGS && !found; ring++) {
      const distance = 2 + ring * 0.9;
      const arcs = ring === 0 ? 1 : 4 + ring * 2;
      for (let arc = 0; arc < arcs && !found; arc++) {
        // Alternate left and right of the facing, so the result stays close to
        // where the player was actually looking.
        const spread = arc === 0 ? 0 : ((arc + 1) >> 1) * 0.55 * (arc % 2 === 0 ? 1 : -1);
        const angle = heading + spread;
        const candidateX = Math.round((player.x + Math.sin(angle) * distance) * 2) / 2;
        const candidateZ = Math.round((player.z + Math.cos(angle) * distance) * 2) / 2;
        const result = this.construction.validate(world, kind, candidateX, candidateZ);
        if (result.validity === "invalid") {
          lastReason = result.reason;
          continue;
        }
        placedX = candidateX;
        placedZ = candidateZ;
        found = true;
      }
    }

    if (!found) {
      world.events.emit({ type: "build.rejected", reason: lastReason });
      return;
    }

    this.construction.spawnStructure(
      world,
      kind,
      placedX,
      placedZ,
      heading + Math.PI,
      player.carry.health,
      player.carry.buffer,
      {
        source: "reinstall",
        recoveryXpGranted: player.carry.recoveryXpGranted,
      },
    );
    player.carry = { kind: "none" };
    player.animState = "interact";
    player.animLock = 0.35;
  }

  /**
   * Last Shot: an abandoned machine overloads, fires far harder for a few
   * seconds, then detonates. It turns "I cannot get back there in time" from a
   * pure loss into a decision with a payoff.
   */
  triggerLastShot(world: GameWorld, structureId: number, trigger: "manual" | "buffer"): void {
    const structure = world.findStructure(structureId);
    if (!structure) return;
    if (structure.state === "overloading" || structure.state === "destroyed") return;
    const config = getStructureConfig(structure.kind);
    if (config.lastShotDuration <= 0) return;

    structure.state = "overloading";
    structure.stateTimer = config.lastShotDuration;
    world.stats.lastShotsTriggered++;
    world.stats.structuresAbandoned++;

    world.events.emit({
      type: "structure.lastShot",
      structureId: structure.id,
      x: structure.x,
      z: structure.z,
      trigger,
    });
  }

  private destroyStructure(world: GameWorld, structure: Structure): void {
    structure.state = "destroyed";
    world.events.emit({
      type: "structure.destroyed",
      structureId: structure.id,
      kind: structure.kind,
      x: structure.x,
      z: structure.z,
    });
    this.construction.removeStructure(world, structure);
  }

  private grantActionXp(world: GameWorld, amount: number): void {
    world.progress.xp += amount;
  }

  /** Pickup collection, called from the main tick. */
  collectPickups(world: GameWorld, dt: number): void {
    const player = world.player;
    const magnetRadius = PLAYER.magnetRadius * world.modifiers.magnetRadius;
    const collectSq = 0.8 * 0.8;
    const backing = world.pickups.backing;

    for (let i = 0; i < backing.length; i++) {
      const pickup = backing[i];
      if (!pickup.active) continue;

      if (pickup.lifetime > 0) {
        pickup.lifetime -= dt;
        if (pickup.lifetime <= 0) {
          pickup.active = false;
          world.pickups.release(i);
          continue;
        }
      }

      if (pickup.settleTimer > 0) {
        pickup.settleTimer -= dt;
        continue;
      }

      const activeRadius = Math.max(magnetRadius, pickup.claimRadius);
      const d = distSq(pickup.x, pickup.z, player.x, player.z);
      if (d > activeRadius * activeRadius) {
        pickup.attracted = false;
        continue;
      }
      pickup.attracted = true;

      if (d <= collectSq) {
        this.consumePickup(world, i);
        continue;
      }

      const distance = Math.sqrt(d) || 1;
      // Accelerate as it closes, so collection reads as a satisfying snap
      // rather than a slow drift.
      const pull = PLAYER.magnetSpeed * (1 + (1 - clamp(distance / activeRadius, 0, 1)) * 1.5);
      pickup.x += ((player.x - pickup.x) / distance) * pull * dt;
      pickup.z += ((player.z - pickup.z) / distance) * pull * dt;
    }
  }

  /**
   * Removes persistent authored pickups from the segment being left. Enemy
   * drops have a positive lifetime and are deliberately left to expire by
   * their normal rule instead of disappearing at a checkpoint boundary.
   */
  clearRoutePickups(world: GameWorld): number {
    let cleared = 0;
    const backing = world.pickups.backing;
    for (let i = 0; i < backing.length; i++) {
      const pickup = backing[i];
      if (!pickup.active || pickup.lifetime > 0) continue;
      pickup.active = false;
      world.pickups.release(i);
      cleared++;
    }
    return cleared;
  }

  private consumePickup(world: GameWorld, index: number): void {
    const pickup = world.pickups.at(index);
    const amount = pickup.kind === "scrap" ? pickup.amount * world.modifiers.scrapYield : pickup.amount;

    if (pickup.kind === "scrap") {
      world.resources.scrap += amount;
      world.stats.scrapCollected += amount;
      world.progress.xp += 0.35;
    } else if (pickup.kind === "fuel") {
      world.resources.fuel += amount;
      world.stats.fuelCollected += amount;
      world.progress.xp += 0.35;
    } else if (pickup.kind === "cylinder" || pickup.kind === "pressureCanister") {
      world.cylindersReady++;
    } else if (pickup.kind === "repairKit") {
      world.fieldItems.repairKits++;
      world.events.emit({ type: "ui.toast", message: "Repair kit stored · R1 to use", tone: "success", duration: 2.2 });
    } else if (pickup.kind === "shockMine") {
      world.fieldItems.shockMines++;
      world.events.emit({ type: "ui.toast", message: "Shock mine stored · R1 to deploy", tone: "success", duration: 2.2 });
    } else if (pickup.kind === "armorPlate") {
      world.fieldItems.armorPlates++;
      world.events.emit({ type: "ui.toast", message: "Armor plate recovered · bank it at the Spider", tone: "success", duration: 2.5 });
    } else if (pickup.kind === "weaponPart") {
      world.fieldItems.weaponParts++;
      if (world.fieldItems.weaponParts % 3 === 0) {
        world.modifiers.playerDamage *= 1.08;
        world.events.emit({ type: "ui.toast", message: "Weapon rebuilt · +8% damage", tone: "success", duration: 2.5 });
      } else {
        world.events.emit({ type: "ui.toast", message: `Weapon part ${world.fieldItems.weaponParts % 3}/3`, tone: "info", duration: 1.6 });
      }
    }

    world.events.emit({
      type: "pickup.collected",
      kind: pickup.kind === "fuel" ? "fuel" : "scrap",
      amount,
      x: pickup.x,
      z: pickup.z,
    });

    pickup.active = false;
    world.pickups.release(index);
  }

  /** Spawns a pickup at a world position. Returns false when the pool is full. */
  spawnPickup(
    world: GameWorld,
    kind: PickupKind,
    x: number,
    z: number,
    amount: number,
    settle: number,
    lifetime: number = PICKUPS.dropLifetime,
    claimRadius = 0,
  ): boolean {
    const pickup = world.pickups.acquire();
    if (!pickup) return false;
    pickup.id = world.allocateId();
    pickup.kind = kind;
    pickup.x = x;
    pickup.z = z;
    pickup.y = 0.35;
    pickup.amount = amount;
    pickup.settleTimer = settle;
    pickup.lifetime = lifetime;
    pickup.attracted = false;
    pickup.claimRadius = claimRadius;
    pickup.active = true;
    pickup.phase = world.cosmeticRandom.next();
    return true;
  }
}

const scratch = { x: 0, z: 0 };

/**
 * Rings searched when dropping a carried machine. Four keeps the result within
 * about five metres of the player, which is inside build range, so the machine
 * never lands somewhere they would not have chosen.
 */
const INSTALL_RINGS = 4;

/** Buffer fraction, clamped, for HUD gauges. */
export function bufferFraction(structure: Structure): number {
  if (structure.maxBuffer <= 0) return 1;
  return clamp(structure.buffer / structure.maxBuffer, 0, 1);
}

/** Seconds of operation a structure has left outside the network. */
export function secondsOfAutonomy(structure: Structure): number {
  if (structure.maxBuffer <= 0) return Infinity;
  return structure.buffer;
}

export const RELAY_RANGE = STRUCTURES.relay.range;
