import { GameLoop } from "./GameLoop.ts";
import { GameWorld } from "../game/GameWorld.ts";
import { InputManager } from "../input/InputManager.ts";
import type { InputSnapshot } from "../input/InputActions.ts";
import type { RunMode } from "./types.ts";
import { PlayerMovementSystem } from "../game/systems/PlayerMovementSystem.ts";
import { SpiderMovementSystem } from "../game/systems/SpiderMovementSystem.ts";
import { ConstructionSystem } from "../game/systems/ConstructionSystem.ts";
import { InteractionSystem } from "../game/systems/InteractionSystem.ts";
import { PressureNetworkSystem } from "../game/systems/PressureNetworkSystem.ts";
import { RunStateSystem } from "../game/systems/RunStateSystem.ts";
import { HordeDirector } from "../game/systems/HordeDirector.ts";
import { EncounterSystem } from "../game/systems/EncounterSystem.ts";
import {
  EnemyNavigationSystem,
  setEnemyDamageSink,
} from "../game/systems/EnemyNavigationSystem.ts";
import { WeaponSystem } from "../game/systems/WeaponSystem.ts";
import { StructureCombatSystem } from "../game/systems/StructureCombatSystem.ts";
import { CollisionSystem } from "../game/systems/CollisionSystem.ts";
import { DamageSystem } from "../game/systems/DamageSystem.ts";
import { ExperienceSystem } from "../game/systems/ExperienceSystem.ts";
import { Renderer } from "../rendering/Renderer.ts";
import { CameraController } from "../rendering/CameraController.ts";
import { WorldView } from "../rendering/WorldView.ts";
import { VfxSystem } from "../rendering/VfxSystem.ts";
import { MeshForge } from "../art/MeshForge.ts";
import { AudioDirector } from "../audio/AudioDirector.ts";
import { SaveManager } from "../save/SaveManager.ts";
import { HudController } from "../ui/HudController.ts";
import { RadialMenu } from "../ui/RadialMenu.ts";
import {
  ScreenManager,
  adjustSetting,
  formatSetting,
  routeOption,
  settingsScreenData,
  type ScreenKind,
} from "../ui/Screens.ts";
import { DebugOverlay } from "../ui/DebugOverlay.ts";
import { HudBridge } from "../ui/HudBridge.ts";
import { AudioBridge } from "../audio/AudioBridge.ts";
import { createSeed, formatSeed, seedToString } from "./Random.ts";
import { getBlueprint } from "../data/structures.ts";
import { getModule } from "../data/modules.ts";
import { getUpgrade } from "../data/upgrades.ts";
import { PERFORMANCE, PLAYER, SALVAGE_RUSH, SIM, SPIDER, TRAIL } from "../data/balance.ts";

/** Card glyph per upgrade category, so the three offers read apart at a glance. */
const UPGRADE_GLYPHS: Record<string, string> = {
  weapon: "✦",
  tool: "⚒",
  structure: "◈",
  spider: "⚙",
};

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

/**
 * The orchestrator. Owns the world, every system, the renderer and the UI, and
 * runs the fixed system order from §16.4 of the design document.
 *
 * The system order is not incidental. It is the contract that makes a tick
 * reproducible: input is sampled once, the spider moves before the player (so
 * the tether and the service radius are measured against the spider's new
 * position), pressure resolves before turrets decide whether they may fire, and
 * pools are recycled only after everything that could reference an entity has
 * run.
 */
export class Game {
  readonly world: GameWorld;
  private readonly loop: GameLoop;

  private readonly input = new InputManager();
  private readonly forge = new MeshForge();
  private readonly audio = new AudioDirector();
  private readonly save = new SaveManager();

  private readonly renderer: Renderer;
  private readonly camera: CameraController;
  private readonly view: WorldView;
  private readonly vfx: VfxSystem;

  private readonly hud: HudController;
  private readonly radial: RadialMenu;
  private readonly screens: ScreenManager;
  private readonly debug: DebugOverlay;
  private readonly hudBridge: HudBridge;
  private readonly audioBridge: AudioBridge;

  private readonly construction = new ConstructionSystem();
  private readonly playerMovement = new PlayerMovementSystem(this.construction);
  private readonly spiderMovement = new SpiderMovementSystem();
  private readonly interaction: InteractionSystem;
  private readonly pressure = new PressureNetworkSystem();
  private readonly runState = new RunStateSystem();
  private readonly director = new HordeDirector();
  private readonly encounters = new EncounterSystem(this.director);
  private readonly enemyNavigation = new EnemyNavigationSystem();
  private readonly weapons = new WeaponSystem();
  private readonly structureCombat = new StructureCombatSystem();
  private readonly collision: CollisionSystem;
  private readonly damage: DamageSystem;
  private readonly experience = new ExperienceSystem();

  /** Set while a modal owns input; the simulation is fully paused. */
  private modalOpen = false;
  private booted = false;
  /** A recentre asked for during a fixed step, awaiting the next render. */
  private recenterRequested = false;

  constructor(
    canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
    seed?: number,
    options: { preserveDrawingBuffer?: boolean; mode?: RunMode } = {},
  ) {
    const runSeed = seed ?? createSeed();
    this.world = new GameWorld(runSeed, options.mode ?? "expedition");

    this.interaction = new InteractionSystem(this.construction);
    this.damage = new DamageSystem(this.interaction);
    this.collision = new CollisionSystem(this.damage);
    // Enemy melee resolves through the same system as everything else, so the
    // core reaching zero actually ends the run.
    setEnemyDamageSink(this.damage);

    this.renderer = new Renderer(canvas, options);
    this.camera = new CameraController(this.renderer);
    this.view = new WorldView(this.renderer.scene, this.forge);
    this.vfx = new VfxSystem(this.renderer.scene, this.forge);
    this.view.setVfx(this.vfx);

    this.hud = new HudController(uiRoot);
    this.radial = new RadialMenu(uiRoot);
    this.screens = new ScreenManager(uiRoot);
    this.screens.onChoose = (kind, optionId) => this.applyModalChoice(kind, optionId);
    this.screens.onBack = (kind) => {
      // Only a screen the player may decline is dismissable; a route fork and a
      // level-up demand an answer, or the run would resume in a broken state.
      // Settings reaches this only when it was opened as the root screen; from
      // pause it is pushed, and `back()` pops to pause without asking.
      if (kind === "pause" || kind === "settings") this.closeModal();
    };
    this.screens.onAdjust = (kind, optionId, delta) => {
      if (kind === "settings") this.stepSetting(optionId, delta);
    };
    this.debug = new DebugOverlay(uiRoot);
    this.hudBridge = new HudBridge(this.hud, this.radial);
    this.audioBridge = new AudioBridge(this.audio);

    this.loop = new GameLoop(
      (dt) => this.poll(dt),
      (dt) => this.fixedUpdate(dt),
      (alpha, dt) => this.render(alpha, dt),
    );
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  async boot(onProgress: (fraction: number, label: string) => void): Promise<void> {
    onProgress(0.05, "Reading settings");
    this.save.load();
    this.applySettings();

    onProgress(0.15, "Forging geometry");
    this.forge.build((fraction: number, label: string) => onProgress(0.15 + fraction * 0.55, label));

    onProgress(0.74, "Building the world");
    this.view.prepare();
    this.vfx.prepare();

    onProgress(0.86, "Wiring input");
    this.input.attach(window);
    this.input.onConnectionChange((connected) => this.onControllerChange(connected));

    onProgress(0.93, "Connecting feedback");
    this.audioBridge.attach(this.world.events);
    this.hudBridge.attach(this.world.events);
    this.attachVisualFeedback();

    onProgress(1, "Ready");
    this.booted = true;
  }

  /**
   * Every screen-facing reaction to a simulation event, in one list.
   *
   * Feedback is layered deliberately: a turret shot gets a muzzle flash, a
   * tracer, a sound and a barrel recoil, but no shake, because a shake for
   * every one of three turrets firing four times a second would be unreadable.
   * Shake is reserved for events the player must not miss.
   */
  private attachVisualFeedback(): void {
    const events = this.world.events;

    events.on("run.ended", (event) => this.onRunEnded(event.outcome));
    events.on("camera.shake", (event) => this.camera.shake(event.intensity, event.duration));
    events.on("vfx.request", (event) => {
      if (event.effect === "spawnDust") this.vfx.deathPoof(event.x, event.z, event.scale);
    });

    events.on("weapon.fired", (event) => {
      this.vfx.muzzleFlash(event.muzzleX, event.muzzleY, event.muzzleZ, event.heading, false);
      this.camera.shake(0.045, 0.08);
    });
    events.on("structure.fired", (event) => {
      this.vfx.muzzleFlash(event.muzzleX, event.muzzleY, event.muzzleZ, event.heading, event.heavy);
    });
    events.on("projectile.hit", (event) => {
      this.vfx.impact(event.x, event.y, event.z, event.source !== "structure.explosion");
    });
    events.on("enemy.died", (event) => {
      this.vfx.deathPoof(event.x, event.z, 1);
      // The mark outlives the puff, so a stretch the player fought over still
      // looks fought over a minute later.
      this.view.markDeath(event.x, event.z, event.archetype === "golem" ? 2.2 : 1);
    });
    events.on("structure.exploded", (event) => {
      this.camera.shake(0.6, 0.4);
      this.vfx.explosion(event.x, event.z, event.radius);
    });
    events.on("structure.destroyed", (event) => {
      this.vfx.explosion(event.x, event.z, 2.2);
      this.camera.shake(0.2, 0.2);
    });
    events.on("structure.lastShot", (event) => {
      this.vfx.lastShotCharge(event.x, event.z);
      this.camera.shake(0.3, 0.3);
    });
    events.on("structure.placed", (event) => {
      this.vfx.placementPulse(event.x, event.z, 0x6de26d);
    });
    events.on("structure.repaired", (event) => this.vfx.repairSparks(event.x, event.z));
    events.on("pickup.collected", (event) =>
      this.vfx.pickupPop(event.x, event.z, event.kind === "fuel"),
    );
    events.on("player.damaged", (event) => {
      this.camera.shake(0.35, 0.25);
      this.input.rumble(0.55, 0.3, 180);
      void event;
    });
    events.on("spider.damaged", (event) => {
      if (!event.absorbedByShield) this.camera.shake(0.22, 0.2);
    });
    events.on("player.dodged", (event) => {
      this.vfx.placementPulse(event.x, event.z, 0xffc978);
      this.input.rumble(0.2, 0.15, 90);
    });
  }

  start(): void {
    if (!this.booted) throw new Error("Game.start() called before boot() completed");
    this.beginRun();
    this.loop.start();
  }

  /**
   * Restarts the render loop without touching the run.
   *
   * This exists because `start()` does not: it calls `beginRun()`, which
   * re-enters the first segment, teleports the spider and the engineer back to
   * the start, respawns the segment's pickups and hides any open screen while
   * leaving `modalOpen` set. The hidden-tab handler called `start()` on the way
   * back in, so alt-tabbing away and returning silently threw the run away
   * mid-march - and if a modal had been open when the tab was hidden, the run
   * came back with the screen gone and input still swallowed by it.
   */
  resume(): void {
    if (!this.booted) throw new Error("Game.resume() called before boot() completed");
    this.loop.start();
  }

  /**
   * Sets a run up without starting the render loop. Visual-QA captures drive
   * `advance()` themselves so the scene is a function of the scenario rather
   * than of how long the screenshot tool took to attach.
   */
  startForCapture(): void {
    if (!this.booted) throw new Error("Game.startForCapture() called before boot() completed");
    this.suppressAutoModals = true;
    this.beginRun();
  }

  /** Opens a screen deliberately, for the captures that exist to show one. */
  showScreenForCapture(kind: Exclude<ScreenKind, "none">): void {
    this.openModal(kind);
  }

  /** Lets a capture scenario stage the offers a screen will render. */
  runStateForCapture(): RunStateSystem {
    return this.runState;
  }

  /** The seed exactly as the player typed it, when they typed one. */
  private seedLabel: string | null = null;

  setSeedLabel(original: string | null): void {
    this.seedLabel = original;
  }

  /**
   * Jumps the camera to its target. A capture teleports the spider a hundred
   * metres, and the follow damping would still be catching up when the shot is
   * taken, framing the subject half off the bottom of the screen.
   */
  snapCamera(): void {
    this.camera.snapTo(this.world);
  }

  /** Redraws the current state without advancing the simulation. */
  renderFrozen(): void {
    this.render(0, 1 / 60);
  }

  /**
   * Redraws whenever the drawing buffer is reallocated. A resize clears the
   * buffer, so a capture that rendered before a late layout pass would be read
   * back empty. Bounded, because each redraw is a full frame.
   */
  redrawOnResize(limit: number): void {
    let left = limit;
    this.renderer.onResized = () => {
      if (left-- <= 0) return;
      this.renderFrozen();
    };
  }

  /**
   * Steps the simulation without drawing. Separating the two is what lets the
   * performance report say how much of a frame is simulation and how much is
   * submission, which is the difference between a CPU problem and a GPU one.
   */
  advanceSimulationOnly(seconds: number): void {
    const steps = Math.max(1, Math.round(seconds / SIM.fixedStep));
    this.input.poll(SIM.fixedStep);
    for (let i = 0; i < steps; i++) this.fixedUpdate(SIM.fixedStep);
  }

  stop(): void {
    this.loop.stop();
  }

  private beginRun(): void {
    const world = this.world;
    world.route.start();
    const openingSegment = world.mode === "salvageRush" ? "seg.scrapyard" : "seg.approach";
    this.runState.departCheckpoint(world, openingSegment);
    world.spider.docked = false;
    if (world.mode === "salvageRush") {
      world.salvageTimeRemaining = SALVAGE_RUSH.duration;
      world.salvageScore = 0;
      world.trail = TRAIL.thresholds.PROBING;
    }

    this.view.buildSegment(world);
    this.spawnSegmentResources();
    if (world.mode === "salvageRush") this.spawnSalvageMachines();

    // Start beside the hull rather than well behind it: close enough to read as
    // one expedition, but outside the body footprint so the engineer remains
    // visible instead of spawning underneath the Spider.
    world.player.x = world.spider.x + SPIDER.bodyWidth * 0.5 + 1;
    world.player.z = world.spider.z + 1.5;
    world.player.prevX = world.player.x;
    world.player.prevZ = world.player.z;

    this.camera.snapTo(world);
    this.hud.setVisible(true);
    this.screens.hide();
    this.audio.setTension(world.trailState, false);
  }

  private spawnSegmentResources(): void {
    const world = this.world;
    const placements = world.route.generateResources(world.random);
    for (let i = 0; i < placements.length; i++) {
      const placement = placements[i];
      const kind = placement.kind === "fuel" ? "fuel" : "scrap";
      const copies = world.mode === "salvageRush" ? SALVAGE_RUSH.resourcePocketMultiplier : 1;
      for (let copy = 0; copy < copies; copy++) {
        const offset = copy === 0 ? 0 : (copy % 2 === 0 ? -1 : 1) * (1 + copy * 0.55);
        this.interaction.spawnPickup(
          world,
          kind,
          placement.x + offset,
          placement.z - offset * 0.4,
          placement.amount,
          0,
          0,
        );
      }
    }
  }

  private spawnSalvageMachines(): void {
    const world = this.world;
    const spline = world.route.spline;
    if (!spline) return;
    const point = { x: 0, z: 0 };
    const tangent = { x: 0, z: 1 };
    for (let i = 0; i < SALVAGE_RUSH.salvageMachines; i++) {
      const distance = 16 + i * 10.5;
      spline.positionAt(point, distance);
      spline.tangentAt(tangent, distance);
      const side = i % 2 === 0 ? -1 : 1;
      const offset = 5.5 + (i % 3) * 1.2;
      this.construction.dropCarriedStructure(
        world,
        {
          kind: "structure",
          structureType: i % 3 === 0 ? "relay" : "rivetTurret",
          health: 0.45 + (i % 4) * 0.13,
          buffer: 5 + (i % 3) * 5,
          recoveryXpGranted: false,
        },
        point.x - tangent.z * offset * side,
        point.z + tangent.x * offset * side,
        Math.atan2(tangent.x, tangent.z) + Math.PI,
      );
    }
  }

  private applySettings(): void {
    const settings = this.save.data.settings;
    this.audio.setMasterVolume(settings.masterVolume);
    this.audio.setMusicVolume(settings.musicVolume);
    this.audio.setEffectsVolume(settings.effectsVolume);
    this.input.setDeadZone(settings.gamepadDeadZone);
    this.input.setVibrationEnabled(settings.vibration);
    this.camera.setShakeScale(settings.cameraShake);
  }

  /**
   * One notch on the settings screen.
   *
   * Applied immediately rather than on leaving the screen: a dead zone and a
   * shake scale can only be judged by feel, and a value that takes effect
   * somewhere else later is not adjustable, it is guesswork. Persisted for the
   * same reason - the screen would otherwise be a lie the moment the run ends.
   * `adjustSetting` reports whether the value actually moved, so holding a
   * direction against the end of a range costs neither a re-apply nor a write.
   * Switching vibration on answers with a short pulse, because it is the one
   * setting here whose new state is otherwise invisible until combat.
   */
  private stepSetting(optionId: string, delta: number): void {
    const settings = this.save.data.settings;
    if (!adjustSetting(settings, optionId, delta)) return;
    this.applySettings();
    this.save.save();
    this.screens.setOptionValue(optionId, formatSetting(settings, optionId));
    if (optionId === "vibration" && settings.vibration) this.input.rumble(0.35, 0.2, 140);
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  private poll(dt: number): void {
    this.input.poll(dt);
  }

  /**
   * One 60 Hz simulation step. The ordering below is the contract from §16.4;
   * changing it changes the game's behaviour, so it is written out explicitly
   * rather than hidden behind a system registry.
   */
  private fixedUpdate(dt: number): void {
    // `finally`, because every early return below is still a step that had its
    // chance to read the input. Leaving the edge latched on those paths would
    // hand the same press to the next step: the one that closes a modal would
    // then be read again as gameplay, firing a dodge or a manual Last Shot on
    // the way out of a menu.
    try {
      this.stepSimulation(dt);
    } finally {
      this.input.endStep();
    }
  }

  private stepSimulation(dt: number): void {
    const world = this.world;
    const input = this.input.snapshot();

    if (
      this.screens.controllerDisconnected &&
      input.lastDevice === "keyboard" &&
      Object.values(input.buttons).some((button) => button.pressed)
    ) {
      this.screens.setControllerDisconnected(false);
      world.paused = this.modalOpen;
      this.loop.resetAccumulator();
      return;
    }

    // Latched here and consumed by the next render. The camera runs during
    // render, after this step has spent the frame's input edges, so it cannot
    // read the button itself. Captured before the early returns below so a
    // recentre asked for while a modal is closing is not swallowed with it.
    if (input.buttons.recenter.pressed) this.recenterRequested = true;

    if (this.handleGlobalInput(input)) return;
    if (this.modalOpen || world.paused) return;
    if (world.phase === "VICTORY" || world.phase === "DEFEAT") return;

    const scaled = dt * world.timeScale;

    // 1-2. run state and Trail
    this.runState.update(world, scaled);

    // 3. spider
    this.spiderMovement.update(world, scaled);
    if (input.buttons.overdrive.pressed) this.spiderMovement.toggleOverdrive(world);

    // 4. player
    this.playerMovement.update(world, scaled, input);

    // 5. interaction, building, collection
    this.construction.update(world, scaled, input);
    this.interaction.update(world, scaled, input);
    this.interaction.collectPickups(world, scaled);

    // 6. pressure network
    this.pressure.update(world, scaled);

    // 7. director and spawning
    this.encounters.update(world, scaled);
    this.director.update(
      world,
      scaled,
      this.runState.budgetPerSecond(world) * (world.route.segment?.ambientThreatScale ?? 1),
    );

    // 8. enemy navigation
    this.enemyNavigation.setFocus(this.camera.focusX, this.camera.focusZ);
    this.enemyNavigation.update(world, scaled);

    // 9. weapons and projectiles
    this.weapons.setFocusFire(input.buttons.focusFire.held);
    this.weapons.update(world, scaled);
    this.structureCombat.update(world, scaled);

    // 10. collisions and damage
    this.collision.update(world, scaled);
    this.damage.update(world, scaled);

    // 11. deaths, loot and XP
    this.experience.update(world, scaled);

    // 12. checkpoints and upgrades
    this.updatePhaseTransitions();

    // 13. drain the event queue so presentation sees a complete, ordered tick
    world.events.drain();

    world.tick++;
  }

  /**
   * Pause, debug toggle and controller acquisition are handled outside the
   * simulation so they still work while the world is paused.
   */
  private handleGlobalInput(input: InputSnapshot): boolean {
    if (input.buttons.pause.pressed) {
      // Settings counts as pause here as well as in `onBack`: the button that
      // opened the pause stack has to be able to close it from anywhere inside
      // it, or the player is one screen deep with no way out but Circle.
      const kind = this.screens.kind;
      if (kind === "pause" || kind === "settings") {
        this.closeModal();
      } else if (!this.modalOpen) {
        this.openModal("pause");
      }
      return true;
    }

    if (this.modalOpen) {
      this.screens.handleInput(input);
      return true;
    }
    return false;
  }

  /**
   * Set by visual-QA capture mode. A scripted combat scene generates XP, and a
   * level-up modal opening mid-shot would hide the very thing being scored.
   */
  suppressAutoModals = false;

  private updatePhaseTransitions(): void {
    const world = this.world;
    if (this.suppressAutoModals) return;

    if (world.progress.pendingLevelUps > 0 && !this.modalOpen) {
      if (this.runState.tryOpenUpgradeChoice(world)) {
        this.openModal("upgrade");
        return;
      }
    }

    if (world.phase !== "CHECKPOINT_PREP" || this.modalOpen) return;

    // Checkpoints are decision beats, not thirty-second idle screens. Present
    // salvage first, then the route choice on the next simulation tick.
    if (this.runState.pendingModules.length > 0) {
      this.openModal("module");
      return;
    }

    if (this.runState.pendingRoutes.length > 1) {
      this.openModal("route");
    }
  }

  private openModal(kind: Exclude<ScreenKind, "none">): void {
    this.modalOpen = true;
    this.world.paused = true;
    // A modal that opened while the build radial was up would otherwise keep
    // the simulation stuck at 20% speed after it closed.
    this.world.timeScale = 1;
    this.construction.cancelGhost(this.world);
    // The gameplay HUD is frozen mid-frame behind a modal, so leaving it up
    // shows stale bars and lets a screen's footer prompts collide with the
    // blueprint bar. The screen owns the display while it is open.
    this.hud.setVisible(false);

    switch (kind) {
      case "upgrade":
        this.screens.show("upgrade", {
          eyebrow: `Level ${this.world.progress.level}`,
          layout: "cards",
          options: this.runState.pendingOffers.map((id) => {
            const upgrade = getUpgrade(id);
            return {
              id,
              label: upgrade.name,
              reward: upgrade.description,
              tag: upgrade.category,
              glyph: UPGRADE_GLYPHS[upgrade.category] ?? "◆",
            };
          }),
        });
        break;

      case "route":
        this.screens.show("route", {
          eyebrow: "Two roads out",
          layout: "cards",
          options: this.runState.pendingRoutes.map((id) =>
            routeOption(this.world.route.graph.getSegment(id)),
          ),
        });
        break;

      case "module":
        this.screens.show("module", {
          eyebrow: "Salvaged at the halt",
          layout: "cards",
          options: this.runState.pendingModules.map((id) => {
            const module = getModule(id);
            return {
              id,
              label: module.name,
              reward: module.description,
              danger: module.tradeoff,
              glyph: "⚙",
            };
          }),
        });
        break;

      case "pause":
        this.screens.show("pause", {
          subtitle: `${this.world.mode === "salvageRush" ? "Salvage Rush" : "Expedition"} · Seed ${formatSeed(this.world.stats.seed, this.seedLabel)}`,
          options: [
            { id: "resume", label: "Resume the march" },
            { id: "settings", label: "Settings" },
            {
              id: this.world.mode === "salvageRush" ? "mode.expedition" : "mode.salvageRush",
              label: this.world.mode === "salvageRush" ? "Start Expedition" : "Start Salvage Rush",
            },
            { id: "restart", label: "Restart the run" },
          ],
          hints: [
            { button: "cross", label: "Select" },
            { button: "pause", label: "Resume" },
          ],
        });
        break;

      case "settings":
        this.screens.show("settings", settingsScreenData(this.save.data.settings));
        break;

      default:
        this.screens.show(kind);
        break;
    }
  }

  private closeModal(): void {
    this.modalOpen = false;
    this.world.paused = false;
    this.screens.hide();
    this.hud.setVisible(true);
    // The wall clock kept running while the modal was open; without this the
    // loop would try to catch up on every second the player spent deciding.
    this.loop.resetAccumulator();
  }

  private applyModalChoice(screen: ScreenKind, value: string): void {
    const world = this.world;
    switch (screen) {
      case "upgrade": {
        const upgrade = getUpgrade(value);
        upgrade.apply(world.modifiers);
        world.progress.chosenUpgrades.push(value);
        world.progress.pendingLevelUps--;
        this.applyModifierSideEffects();
        world.events.emit({ type: "run.upgradeChosen", upgradeId: value });
        this.closeModal();
        this.runState.resumeFromModal(world);
        break;
      }
      case "route": {
        this.closeModal();
        this.runState.departCheckpoint(world, value);
        this.view.buildSegment(world);
        this.spawnSegmentResources();
        break;
      }
      case "module": {
        const module = getModule(value);
        module.apply(world.modifiers);
        world.spider.installedModules.push(value);
        this.applyModifierSideEffects();
        world.events.emit({
          type: "spider.moduleInstalled",
          moduleId: value,
          slot: world.spider.installedModules.length - 1,
        });
        // A checkpoint offer is single-use. Clearing it lets the next tick
        // advance to the route decision instead of reopening this modal.
        this.runState.pendingModules = [];
        this.closeModal();
        break;
      }
      case "pause": {
        if (value === "resume") this.closeModal();
        else if (value === "restart") this.restart();
        else if (value === "mode.expedition") this.switchMode("expedition");
        else if (value === "mode.salvageRush") this.switchMode("salvageRush");
        else if (value === "settings") {
          // Pushed, not shown: `back()` then returns to pause rather than
          // dropping the player straight back into a march they paused.
          this.screens.pushScreen("settings", settingsScreenData(this.save.data.settings));
        }
        break;
      }
      case "settings":
        // Every row here is adjusted with left and right, never chosen, and the
        // footer says so. Confirm is deliberately inert rather than falling
        // through to the default and closing the modal under the player.
        break;
      case "victory":
      case "defeat":
      case "summary": {
        if (value === "restart") this.restart();
        break;
      }
      default:
        this.closeModal();
        break;
    }
  }

  /**
   * Some modifiers change state that was already sized from the old values.
   * Applying a multiplier without this leaves, say, a crane's extra rack slot
   * counted in the modifiers but absent from the spider.
   */
  private applyModifierSideEffects(): void {
    const world = this.world;
    const spider = world.spider;

    const targetRacks = SPIDER.rackSlots + world.modifiers.rackSlots;
    while (spider.carriedStructures.length < targetRacks) spider.carriedStructures.push(null);

    spider.maxShield = SPIDER.shield * world.modifiers.spiderShield;
    world.player.maxHealth = PLAYER.health * world.modifiers.playerMaxHealth;
    world.player.health = Math.min(world.player.health, world.player.maxHealth);
  }

  /**
   * A disconnected pad pauses the run and covers the screen with an
   * instruction, per §24. It deliberately does not use the modal stack: the
   * player must be able to reconnect and carry on exactly where they were,
   * including mid-placement.
   */
  private onControllerChange(connected: boolean): void {
    this.screens.setControllerDisconnected(!connected);
    this.world.paused = !connected || this.modalOpen;
    if (connected) this.loop.resetAccumulator();
  }

  private onRunEnded(outcome: "victory" | "defeat"): void {
    this.world.setPhase(outcome === "victory" ? "VICTORY" : "DEFEAT");
    this.modalOpen = true;
    this.world.paused = true;
    this.hud.setVisible(false);

    const stats = this.world.stats;
    const totalDamage = Math.max(1, stats.damageByPlayer + stats.damageByStructures);
    const salvage = this.world.mode === "salvageRush";
    this.screens.show(outcome, {
      title: salvage
        ? outcome === "victory" ? "Shift complete" : "Salvage lost"
        : undefined,
      subtitle:
        salvage && outcome === "victory"
          ? `Recovered value: ${this.world.salvageScore}`
          : outcome === "victory"
          ? "The spider crossed the gate."
          : "The core went cold on the road.",
      options: [{ id: "restart", label: "March again" }],
      stats: [
        { label: "Time", value: formatDuration(stats.elapsedSeconds) },
        { label: "Distance", value: `${stats.distanceTravelled.toFixed(0)} m` },
        { label: "Kills", value: `${stats.enemiesKilled}` },
        {
          label: "Damage by machines",
          value: `${Math.round((stats.damageByStructures / totalDamage) * 100)}%`,
        },
        { label: "Structures placed", value: `${stats.structuresPlaced}` },
        { label: "Recovered", value: `${stats.structuresRecovered}` },
        { label: "Abandoned", value: `${stats.structuresAbandoned}` },
        { label: "Last Shots", value: `${stats.lastShotsTriggered}` },
        { label: "Objectives", value: `${stats.objectivesCompleted}` },
        ...(salvage ? [{ label: "Salvage score", value: `${this.world.salvageScore}` }] : []),
        { label: "Peak Trail", value: stats.peakTrail.toFixed(0) },
        { label: "Seed", value: formatSeed(stats.seed, this.seedLabel) },
      ],
      // The footer names the input, not the action; the button already says
      // "March again" and repeating it read as two competing prompts.
      hints: [{ button: "cross", label: "Confirm" }],
    });
  }

  restart(): void {
    this.stop();
    window.location.reload();
  }

  private switchMode(mode: RunMode): void {
    const url = new URL(window.location.href);
    if (mode === "expedition") url.searchParams.delete("mode");
    else url.searchParams.set("mode", "salvage");
    window.location.assign(url.toString());
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  private render(alpha: number, dt: number): void {
    const world = this.world;

    this.camera.update(world, dt, this.recenterRequested);
    this.recenterRequested = false;
    // Movement and the placement ghost are camera-relative, so the simulation
    // is handed the camera basis here, one frame behind. At 60 Hz with a damped
    // camera that lag is imperceptible and it keeps three.js out of the sim.
    this.playerMovement.setCameraBasis(
      this.camera.forwardX,
      this.camera.forwardZ,
      this.camera.rightX,
      this.camera.rightZ,
    );
    this.construction.setCameraBasis(
      this.camera.forwardX,
      this.camera.forwardZ,
      this.camera.rightX,
      this.camera.rightZ,
    );

    this.view.sync(world, alpha, dt);
    this.vfx.update(dt);
    this.renderer.setTrailMood(world.trailState, dt);
    this.renderer.render(this.camera.camera);

    this.hudBridge.update(
      world,
      this.interaction,
      this.camera,
      this.input.snapshot(),
      this.runState,
    );
    this.audio.setListener(this.camera.focusX, this.camera.focusZ);
    this.audio.setTension(world.trailState, world.trail >= TRAIL.max);
    this.audio.update(dt);

    if (this.debug.visible) this.updateDebugOverlay();
  }

  private updateDebugOverlay(): void {
    const world = this.world;
    const info = this.renderer.info;
    this.debug.update({
      fps: (1000 / Math.max(0.001, this.loop.medianFrameMs())).toFixed(0),
      "frame p50": `${this.loop.medianFrameMs().toFixed(2)} ms`,
      "frame p95": `${this.loop.percentileFrameMs(0.95).toFixed(2)} ms`,
      "frame worst": `${this.loop.worstFrameMs().toFixed(2)} ms`,
      budget: `${PERFORMANCE.frameBudgetMs} ms`,
      "draw calls": info.calls,
      triangles: info.triangles,
      enemies: world.enemies.active,
      "enemies peak": world.enemies.peak,
      "full lod": this.enemyNavigation.stats.fullLod,
      projectiles: world.projectiles.active,
      pickups: world.pickups.active,
      structures: world.structures.length,
      "pool exhaustions": world.enemies.exhaustions + world.projectiles.exhaustions,
      "flow rebuild": `${this.enemyNavigation.stats.lastRebuildMs.toFixed(2)} ms`,
      trail: `${world.trail.toFixed(1)} ${world.trailState}`,
      seed: seedToString(world.stats.seed),
      "sim steps": this.loop.stepsLastFrame,
      carried: world.player.carry.kind === "structure"
        ? getBlueprint(world.player.carry.structureType).name
        : world.player.carry.kind,
    });
  }

  toggleDebug(): void {
    this.debug.setVisible(!this.debug.visible);
  }

  /**
   * Runs the simulation for a wall-clock-independent span and draws one frame.
   *
   * `requestAnimationFrame` does not fire in a backgrounded tab, which is
   * correct for play but makes the game unobservable to an automated check.
   * This drives the same `fixedUpdate` and `render` the loop would, so a
   * headless verification exercises the real code path rather than a mock.
   */
  advance(seconds: number): number {
    const steps = Math.max(1, Math.round(seconds / SIM.fixedStep));
    this.input.poll(SIM.fixedStep);
    for (let i = 0; i < steps; i++) this.fixedUpdate(SIM.fixedStep);
    // Render with the whole advanced span, not one step. Effect lifetimes and
    // camera damping are driven by render delta, so passing a single frame here
    // would leave two seconds of muzzle flashes and dust rings frozen at their
    // spawn size, stacked on top of each other.
    this.render(0, steps * SIM.fixedStep);
    return steps;
  }

  /** Exposed for the automated browser checks and for bug reports. */
  get debugApi() {
    return {
      world: this.world,
      advance: (seconds: number) => this.advance(seconds),
      forceSpawn: (archetype: string, count: number) =>
        this.director.forceSpawn(this.world, archetype, count),
      setTrail: (value: number) => {
        this.world.trail = value;
      },
      giveScrap: (amount: number) => {
        this.world.resources.scrap += amount;
      },
      teleportSpider: (distance: number) => {
        this.world.spider.distanceAlongRoute = distance;
      },
      enterSegment: (segmentId: string) => {
        this.runState.departCheckpoint(this.world, segmentId);
        this.view.buildSegment(this.world);
        this.spawnSegmentResources();
      },
      /**
       * Places live machines around the spider. The performance scenarios need
       * this: §12 asks for "Pursuit with structures, projectiles, VFX and HUD
       * active", and a measurement taken with an empty field understates the
       * frame by every mesh and shadow caster a defended position actually has.
       */
      placeStructures: (kind: string, count: number, radius = 7) => {
        const world = this.world;
        world.resources.scrap += count * 60;
        let placed = 0;
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2;
          const structure = this.construction.spawnStructure(
            world,
            kind as never,
            world.spider.x + Math.sin(angle) * radius,
            world.spider.z + Math.cos(angle) * radius,
            angle + Math.PI,
            1,
            -1,
          );
          structure.state = "active";
          structure.stateTimer = 0;
          placed++;
        }
        return placed;
      },
      /**
       * Refills the core and the engineer so a measurement cannot be cut short
       * by the run ending.
       *
       * `fixedUpdate` returns immediately once the phase is VICTORY or DEFEAT,
       * so a scenario whose core dies mid-sample stops simulating and begins
       * reporting the cost of an early return instead. That is how the Pursuit
       * scenario - the heaviest of the four, and the one §12 most wants
       * measured - came to report a simulation cost fifty times lower than a
       * lighter one. The implausible ordering was the only tell.
       */
      sustainCore: () => {
        const world = this.world;
        world.spider.coreHealth = world.spider.maxCoreHealth;
        world.player.health = world.player.maxHealth;
      },
      phase: () => this.world.phase,
      stats: () => this.world.stats,
      frame: () => ({
        p50: this.loop.medianFrameMs(),
        p95: this.loop.percentileFrameMs(0.95),
        worst: this.loop.worstFrameMs(),
        calls: this.renderer.info.calls,
        triangles: this.renderer.info.triangles,
      }),
      resetFrameStats: () => this.loop.resetStats(),
      toggleDebug: () => this.toggleDebug(),
      scene: this.renderer.scene,
      /**
       * Normalised screen position of a world point, 0..1 with (0.5, 0.5) at
       * frame centre. Exists so the camera's "the player never leaves the safe
       * box" guarantee can be measured rather than eyeballed.
       */
      screenPositionOf: (x: number, z: number) => {
        const point = this.camera.projectToScreen(x, z);
        return { x: point.x, y: point.y };
      },
      playerScreenPosition: () => {
        const point = this.camera.projectToScreen(this.world.player.x, this.world.player.z);
        return { x: point.x, y: point.y };
      },
      /** Draw-call breakdown by object name, for the performance record. */
      sceneAudit: () => {
        const byName: Record<string, number> = {};
        let meshes = 0;
        let instanced = 0;
        let casters = 0;
        this.renderer.scene.traverse((object) => {
          const node = object as unknown as {
            isMesh?: boolean;
            isInstancedMesh?: boolean;
            isPoints?: boolean;
            castShadow?: boolean;
            visible: boolean;
            name: string;
          };
          if (!node.isMesh && !node.isInstancedMesh && !node.isPoints) return;
          if (!node.visible) return;
          meshes++;
          if (node.isInstancedMesh) instanced++;
          if (node.castShadow) casters++;
          const key = node.name || "unnamed";
          byName[key] = (byName[key] ?? 0) + 1;
        });
        return { meshes, instanced, casters, byName };
      },
    };
  }

  dispose(): void {
    this.loop.stop();
    this.input.detach();
    this.view.dispose();
    this.vfx.dispose();
    this.renderer.dispose();
    this.forge.dispose();
    this.audio.dispose();
    this.hud.dispose();
  }
}
