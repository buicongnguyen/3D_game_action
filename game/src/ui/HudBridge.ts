import { clamp } from "../core/math.ts";
import type { EventBus } from "../core/EventBus.ts";
import type { InputSnapshot } from "../input/InputActions.ts";
import type { CameraController } from "../rendering/CameraController.ts";
import type { GameWorld } from "../game/GameWorld.ts";
import type { InteractionSystem } from "../game/systems/InteractionSystem.ts";
import type { RunStateSystem } from "../game/systems/RunStateSystem.ts";
import { getBlueprint } from "../data/structures.ts";
import { PLAYER, SPIDER, STRUCTURES, WEAPONS } from "../data/balance.ts";
import type { HudController, HudModel } from "./HudController.ts";
import type { RadialMenu } from "./RadialMenu.ts";
import { WEAPON_SHOP } from "../data/weaponShop.ts";

/**
 * Builds the HUD's view model from world state each frame and pipes feedback
 * events into flashes and toasts.
 *
 * The HUD is deliberately given a flat data object rather than the world, so
 * it can never read simulation state at a different moment than the renderer
 * did, and so it can be tested with a literal.
 *
 * The model object is allocated once and mutated, because this runs every
 * frame.
 */
export class HudBridge {
  private readonly model: HudModel = {
    playerHealth: 0,
    playerMaxHealth: 0,
    coreHealth: 0,
    maxCoreHealth: 0,
    shield: 0,
    maxShield: 0,
    fuel: 0,
    maxFuel: 0,
    scrap: 0,
    trail: 0,
    trailState: "QUIET",
    level: 1,
    xp: 0,
    xpToNext: 1,
    carried: null,
    currentWeapon: "Rivet Scattergun",
    weaponIndex: 0,
    weaponCount: 1,
    weaponHeat: 0,
    weapons: [],
    fieldItems: "",
    distanceToCheckpoint: 0,
    etaSeconds: 0,
    objectiveLabel: null,
    objectiveProgress: 0,
    objectiveTarget: 0,
    objectiveComplete: false,
    salvageMode: false,
    salvageSeconds: 0,
    salvageScore: 0,
    speedMode: "march",
    blueprints: [],
    prompt: null,
    promptSecondary: null,
    spiderOffScreen: false,
    spiderScreenAngle: 0,
    leftBehind: [],
    lastDevice: "gamepad",
    emergencyBurn: false,
    cylinders: 0,
  };

  private readonly promptSlot = { text: "", button: "", progress: 0 };
  private readonly altSlot = { text: "", button: "", progress: 0 };
  private readonly unsubscribes: Array<() => void> = [];

  constructor(
    private readonly hud: HudController,
    private readonly radial: RadialMenu,
  ) {
    for (let i = 0; i < 5; i++) {
      this.model.blueprints.push({
        icon: "",
        name: "",
        cost: 0,
        accent: 0xffffff,
        affordable: false,
        selected: false,
      });
    }
    for (let i = 0; i < WEAPON_SHOP.length; i++) {
      const entry = WEAPON_SHOP[i];
      this.model.weapons.push({
        kind: entry.kind,
        icon: entry.icon,
        name: WEAPONS[entry.kind].name,
        level: 0,
        unlocked: false,
        selected: false,
      });
    }
  }

  attach(events: EventBus): void {
    this.unsubscribes.push(
      events.on("player.damaged", (event) =>
        this.hud.flash("damage", clamp(event.amount / 30, 0.25, 1)),
      ),
      events.on("run.levelUp", () => this.hud.flash("levelup", 1)),
      // The event carries no structure kind, and the world marker already names
      // the machine, so the banner says what happened rather than inventing a
      // lookup for something the player can already see.
      events.on("structure.lastShot", (event) => {
        this.hud.flash("lastshot", 1);
        this.hud.showToast(
          event.trigger === "manual" ? "LAST SHOT — overloading" : "Buffer dry — overloading",
          "danger",
          3,
        );
      }),
      events.on("trail.stateChanged", (event) => {
        if (event.to === "PURSUIT") this.hud.flash("pursuit", 1);
        this.hud.showToast(trailMessage(event.to), trailTone(event.to), 3);
      }),
      events.on("build.rejected", (event) => this.hud.showToast(event.reason, "warning", 1.6)),
      events.on("ui.toast", (event) => {
        if (event.duration > 0) this.hud.showToast(event.message, event.tone, event.duration);
      }),
      events.on("player.tethered", (event) =>
        this.hud.showToast(
          event.droppedCarry ? "Tether snapped taut - payload dropped" : "Too far from the spider",
          "danger",
          2,
        ),
      ),
      events.on("structure.leftBehind", (event) =>
        this.hud.showToast(`${getBlueprint(event.kind).name} falling behind`, "warning", 2.4),
      ),
      events.on("spider.fuelEmpty", () =>
        this.hud.showToast("Out of fuel - burning scrap to crawl", "danger", 4),
      ),
      events.on("spider.moduleInstalled", (event) =>
        this.hud.showToast(`Module installed: ${event.moduleId}`, "success", 3),
      ),
    );
  }

  update(
    world: GameWorld,
    interaction: InteractionSystem,
    camera: CameraController,
    input: InputSnapshot,
    runState: RunStateSystem,
  ): void {
    const model = this.model;
    const player = world.player;
    const spider = world.spider;

    model.playerHealth = player.health;
    model.playerMaxHealth = player.maxHealth * world.modifiers.playerMaxHealth;
    model.coreHealth = spider.coreHealth;
    model.maxCoreHealth = spider.maxCoreHealth;
    model.shield = spider.shield;
    model.maxShield = spider.maxShield;
    model.fuel = spider.fuel;
    model.maxFuel = spider.maxFuel;
    model.scrap = Math.floor(world.resources.scrap);
    model.trail = world.trail;
    model.trailState = world.trailState;
    model.level = world.progress.level;
    model.xp = world.progress.xp;
    model.xpToNext = world.progress.xpToNext;
    model.speedMode = spider.speedMode;
    model.emergencyBurn = spider.emergencyBurn;
    model.cylinders = world.cylindersReady;
    model.lastDevice = input.lastDevice;
    model.currentWeapon = WEAPONS[player.currentWeapon].name;
    model.weaponIndex = Math.max(0, player.unlockedWeapons.indexOf(player.currentWeapon));
    model.weaponCount = player.unlockedWeapons.length;
    model.weaponHeat = player.weaponHeat;
    for (let i = 0; i < model.weapons.length; i++) {
      const slot = model.weapons[i];
      const kind = WEAPON_SHOP[i].kind;
      slot.level = player.weaponLevels[kind] ?? 0;
      slot.unlocked = player.unlockedWeapons.includes(kind);
      slot.selected = player.currentWeapon === kind;
    }
    const items = world.fieldItems;
    model.fieldItems = formatFieldItems(items);

    model.carried =
      player.carry.kind === "structure"
        ? getBlueprint(player.carry.structureType).name
        : player.carry.kind === "cylinder"
          ? "Pressure cylinder"
          : null;

    const remaining = world.route.spline
      ? world.route.remaining(spider.distanceAlongRoute)
      : 0;
    model.distanceToCheckpoint = remaining;
    const speed = spider.docked ? SPIDER.speedMarch : Math.max(0.2, spider.speed);
    model.etaSeconds = spider.docked ? runState.checkpointTimer : remaining / speed;
    model.objectiveLabel = runState.objective?.definition.label ?? null;
    model.objectiveProgress = runState.objective?.progress ?? 0;
    model.objectiveTarget = runState.objective?.definition.target ?? 0;
    model.objectiveComplete = runState.objective?.complete ?? false;
    model.salvageMode = world.mode === "salvageRush";
    model.salvageSeconds = world.salvageTimeRemaining;
    model.salvageScore = world.salvageScore;

    this.updateBlueprints(world);
    this.updatePrompt(world, interaction, input);
    this.updateSpiderIndicator(world, camera);
    this.updateLeftBehind(world, camera);

    this.hud.update(model);
    this.updateRadial(world);
  }

  private updateBlueprints(world: GameWorld): void {
    for (let i = 0; i < this.model.blueprints.length; i++) {
      const kind = world.loadout[i];
      const slot = this.model.blueprints[i];
      if (!kind) {
        slot.icon = "";
        slot.name = "";
        slot.cost = 0;
        slot.affordable = false;
        slot.selected = false;
        continue;
      }
      const blueprint = getBlueprint(kind);
      const cost = Math.ceil(blueprint.cost * world.modifiers.structureCost);
      slot.icon = blueprint.icon;
      slot.name = blueprint.shortName;
      slot.cost = cost;
      slot.accent = blueprint.accent;
      slot.affordable = world.resources.scrap >= cost;
      slot.selected = i === world.build.selectedBlueprint;
    }
  }

  private updatePrompt(
    world: GameWorld,
    interaction: InteractionSystem,
    input: InputSnapshot,
  ): void {
    const player = world.player;
    const gamepad = input.lastDevice !== "keyboard";

    if (world.build.ghostActive) {
      // A glyph belongs on an action, never on a statement. "✕ Outside the
      // network" reads as an error badge; the button token is dropped when the
      // line is telling the player something rather than offering them a verb.
      if (world.build.ghostValidity === "invalid") {
        this.promptSlot.text = world.build.ghostReason;
        this.promptSlot.button = "";
      } else if (world.build.ghostValidity === "unpowered") {
        this.promptSlot.text = "Place anyway - it starts when the spider arrives";
        this.promptSlot.button = gamepad ? "cross" : "E";
      } else {
        this.promptSlot.text = "Place";
        this.promptSlot.button = gamepad ? "cross" : "E";
      }
      this.promptSlot.progress = 0;
      this.model.prompt = this.promptSlot;
      return;
    }

    if (!interaction.availableAction) {
      this.model.prompt = null;
      this.model.promptSecondary = null;
      return;
    }

    const holding = player.actionKind !== null;
    const duration = holdDuration(world, interaction.availableAction);
    this.promptSlot.text = interaction.availableLabel;
    this.promptSlot.button = promptButton(interaction.availableAction, gamepad);
    this.promptSlot.progress = holding ? clamp(player.actionProgress / duration, 0, 1) : 0;
    this.model.prompt = this.promptSlot;

    // Advertise the other verb when it is genuinely available and is not the
    // one already being shown. Standing at a damaged turret offers a repair and
    // a recovery, and the player should be able to see both without discovering
    // the second by accident.
    this.model.promptSecondary = null;
    if (
      interaction.foldTargetId >= 0 &&
      interaction.availableAction !== "fold" &&
      interaction.availableAction !== "collect"
    ) {
      const target = world.findStructure(interaction.foldTargetId);
      if (target) {
        this.altSlot.text = `Recover ${getBlueprint(target.kind).name}`;
        this.altSlot.button = gamepad ? "triangle" : "F";
        this.altSlot.progress = 0;
        this.model.promptSecondary = this.altSlot;
      }
    } else if (
      interaction.serviceAction !== null &&
      interaction.availableAction === "fold"
    ) {
      this.altSlot.text = serviceLabel(interaction.serviceAction);
      this.altSlot.button = gamepad ? "square" : "R";
      this.altSlot.progress = 0;
      this.model.promptSecondary = this.altSlot;
    }
  }

  private updateSpiderIndicator(world: GameWorld, camera: CameraController): void {
    const spider = world.spider;
    const visible = camera.isVisible(spider.x, spider.z, SPIDER.bodyLength * 0.5);
    this.model.spiderOffScreen = !visible;
    if (!visible) {
      this.model.spiderScreenAngle = camera.screenAngleTo(
        world.player.x,
        world.player.z,
        spider.x,
        spider.z,
      );
    }
  }

  /**
   * Surfaces every foldable machine the spider has passed, sorted by how close
   * it is to being unrecoverable. That ordering is the point: the alert has to
   * answer "which one do I go back for" and not merely "something is behind".
   */
  private updateLeftBehind(world: GameWorld, camera: CameraController): void {
    const list = this.model.leftBehind;
    list.length = 0;
    // An overloading machine gets a marker before anything else. It was
    // previously the one structure state excluded from this list, so a routine
    // out-of-network turret was labelled while a machine about to detonate was
    // not — exactly backwards.
    for (let i = 0; i < world.structures.length; i++) {
      const structure = world.structures[i];
      if (structure.state !== "overloading") continue;
      const screen = camera.projectToScreen(structure.x, structure.z);
      // The remaining fuse, in seconds. The machine itself carries a countdown
      // arc, but that is only readable while it is on screen — and the marker
      // exists precisely for the case where the player has already walked away.
      // Without a number here, "how long have I got" had no answer off-camera.
      list.push({
        label: `${getBlueprint(structure.kind).name} — LAST SHOT`,
        screenX: screen.x * camera.viewportWidth,
        screenY: screen.y * camera.viewportHeight,
        urgency: 1,
        secondsRemaining: Math.max(0, structure.stateTimer),
      });
    }

    for (let i = 0; i < world.structures.length; i++) {
      const structure = world.structures[i];
      if (!structure.behindSpider || structure.category !== "foldable") continue;
      if (structure.state === "destroyed" || structure.state === "overloading") continue;

      const bufferFraction =
        structure.maxBuffer > 0 ? clamp(structure.buffer / structure.maxBuffer, 0, 1) : 1;
      const distance = Math.hypot(structure.x - world.spider.x, structure.z - world.spider.z);
      const urgency = clamp(distance / (PLAYER.tetherDistance * 1.6), 0, 1) * 0.6 +
        (1 - bufferFraction) * 0.4;

      // The HUD positions markers in CSS pixels, so the normalised projection
      // has to be scaled by the live viewport here. Passing 0..1 straight
      // through parks every marker in the top-left corner.
      const screen = camera.projectToScreen(structure.x, structure.z);
      list.push({
        label: getBlueprint(structure.kind).name,
        screenX: screen.x * camera.viewportWidth,
        screenY: screen.y * camera.viewportHeight,
        urgency,
      });
    }
    list.sort((a, b) => b.urgency - a.urgency);
    if (list.length > 3) list.length = 3;
  }

  private updateRadial(world: GameWorld): void {
    if (world.build.radialOpen && !this.radial.isOpen) {
      this.radial.open(
        world.loadout.map((kind) => {
          const blueprint = getBlueprint(kind!);
          const cost = Math.ceil(blueprint.cost * world.modifiers.structureCost);
          return {
            icon: blueprint.icon,
            name: blueprint.name,
            cost,
            accent: blueprint.accent,
            affordable: world.resources.scrap >= cost,
          };
        }),
      );
    } else if (!world.build.radialOpen && this.radial.isOpen) {
      this.radial.close();
    }
    if (this.radial.isOpen) {
      // The simulation already resolved the selection from the stick, so the
      // menu is driven by replaying that index as a direction rather than by
      // reading the stick twice and risking the two disagreeing on a frame.
      const count = world.loadout.length;
      const angle = (world.build.radialIndex / count) * Math.PI * 2;
      this.radial.aim(Math.sin(angle), -Math.cos(angle));
    }
  }

  detach(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
  }
}

export function formatFieldItems(items: GameWorld["fieldItems"]): string {
  return [
    items.repairKits > 0 ? `KIT×${items.repairKits}` : "",
    items.shockMines > 0 ? `MINE×${items.shockMines}` : "",
    items.armorPlates > 0 ? `PLATE×${items.armorPlates}` : "",
    items.weaponParts > 0 ? `PART×${items.weaponParts} (${items.weaponParts % 3}/3)` : "",
  ].filter(Boolean).join(" · ");
}

function holdDuration(world: GameWorld, kind: string): number {
  switch (kind) {
    case "repair":
      return PLAYER.repairDuration;
    case "refuel":
    case "recharge":
      return PLAYER.refuelDuration;
    case "fold":
      return PLAYER.foldDuration / world.modifiers.foldSpeed;
    default:
      return PLAYER.installDuration;
  }
}

function serviceLabel(kind: string): string {
  switch (kind) {
    case "refuel":
      return "Refuel spider";
    case "recharge":
      return "Recharge";
    default:
      return "Repair";
  }
}

function promptButton(kind: string, gamepad: boolean): string {
  switch (kind) {
    case "repair":
    case "refuel":
    case "recharge":
      return gamepad ? "square" : "R";
    case "fold":
      return gamepad ? "triangle" : "F";
    default:
      return gamepad ? "cross" : "E";
  }
}

function trailMessage(state: string): string {
  switch (state) {
    case "PROBING":
      return "Something is following the noise";
    case "SWARM":
      return "The horde has the trail";
    case "HEAVY":
      return "Heavy pressure - warriors closing";
    case "PURSUIT":
      return "PURSUIT - run for the shelter";
    default:
      return "The trail has gone cold";
  }
}

function trailTone(state: string): "info" | "warning" | "danger" | "success" {
  switch (state) {
    case "PURSUIT":
      return "danger";
    case "HEAVY":
    case "SWARM":
      return "warning";
    case "QUIET":
      return "success";
    default:
      return "info";
  }
}

export const RELAY_RANGE_FOR_HUD = STRUCTURES.relay.range;
