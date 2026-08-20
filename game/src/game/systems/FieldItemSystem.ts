import { distSq } from "../../core/math.ts";
import type { InputSnapshot } from "../../input/InputActions.ts";
import { PLAYER } from "../../data/balance.ts";
import type { GameWorld } from "../GameWorld.ts";
import type { ConstructionSystem } from "./ConstructionSystem.ts";

const USE_RANGE_SQ = 4.5 * 4.5;

/** R1 consumes finite field items; it never creates a permanent blueprint. */
export class FieldItemSystem {
  constructor(private readonly construction: ConstructionSystem) {}

  update(world: GameWorld, input: InputSnapshot): void {
    if (!input.buttons.tool.pressed || world.paused || world.player.downed) return;
    const player = world.player;
    const inventory = world.fieldItems;

    const damaged = nearestDamagedStructure(world);
    if (inventory.repairKits > 0 && damaged) {
      inventory.repairKits--;
      const amount = damaged.maxHealth * 0.45;
      damaged.health = Math.min(damaged.maxHealth, damaged.health + amount);
      world.events.emit({ type: "structure.repaired", structureId: damaged.id, x: damaged.x, z: damaged.z, amount });
      world.events.emit({ type: "ui.toast", message: "Repair kit applied to machine", tone: "success", duration: 1.6 });
      return;
    }

    const maxHealth = player.maxHealth * world.modifiers.playerMaxHealth;
    if (inventory.repairKits > 0 && player.health < maxHealth) {
      inventory.repairKits--;
      player.health = Math.min(maxHealth, player.health + maxHealth * 0.45);
      world.events.emit({ type: "ui.toast", message: "Repair kit applied to engineer", tone: "success", duration: 1.6 });
      return;
    }

    if (
      inventory.armorPlates > 0 &&
      distSq(player.x, player.z, world.spider.x, world.spider.z) <= world.spider.serviceRadius ** 2
    ) {
      inventory.armorPlates--;
      world.spider.maxCoreHealth += 25;
      world.spider.coreHealth = Math.min(world.spider.maxCoreHealth, world.spider.coreHealth + 25);
      world.events.emit({ type: "ui.toast", message: "Armor plate banked · +25 core integrity", tone: "success", duration: 2.2 });
      return;
    }

    if (inventory.shockMines > 0) {
      const x = player.x + Math.sin(player.heading) * 1.6;
      const z = player.z + Math.cos(player.heading) * 1.6;
      if (world.navigation.isBlockedCircle(x, z, PLAYER.radius)) {
        world.events.emit({ type: "ui.toast", message: "No room for shock mine", tone: "warning", duration: 1.3 });
        return;
      }
      const mine = this.construction.spawnStructure(world, "mine", x, z, player.heading, 1, 0);
      mine.state = "active";
      mine.stateTimer = 0;
      inventory.shockMines--;
      world.events.emit({ type: "ui.toast", message: "Shock mine deployed", tone: "info", duration: 1.4 });
      return;
    }

    world.events.emit({ type: "ui.toast", message: "No usable field item", tone: "info", duration: 1.2 });
  }
}

function nearestDamagedStructure(world: GameWorld) {
  let best = null as GameWorld["structures"][number] | null;
  let bestDistance = USE_RANGE_SQ;
  for (let i = 0; i < world.structures.length; i++) {
    const structure = world.structures[i];
    // Same exclusions `InteractionSystem.nearestStructure` already applies. A
    // repair kit is finite, and spending one on a machine that is detonating,
    // being folded away, or lying on the ground as salvage is spending it on
    // nothing - while also shadowing the engineer's own healing, which this
    // function is checked ahead of.
    if (
      !structure.active ||
      structure.state === "destroyed" ||
      structure.state === "overloading" ||
      structure.state === "folding" ||
      structure.state === "dropped" ||
      structure.health >= structure.maxHealth
    ) {
      continue;
    }
    const distance = distSq(world.player.x, world.player.z, structure.x, structure.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = structure;
    }
  }
  return best;
}
