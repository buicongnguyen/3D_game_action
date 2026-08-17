import { clamp } from "../../core/math.ts";
import type { TrailState } from "../../core/types.ts";
import { DIRECTOR, TRAIL, XP } from "../../data/balance.ts";
import { getCheckpoint } from "../../data/routes.ts";
import { rollUpgradeOffers } from "../../data/upgrades.ts";
import type { GameWorld } from "../GameWorld.ts";

/**
 * The run's phase machine and the Trail.
 *
 * The Trail is the game's single tension variable: it folds together elapsed
 * time, the noise the expedition makes, and how close the horde has got. One
 * number drives the spawn budget, the music, the fog colour and the HUD, which
 * is why escalation reads as one continuous pressure rather than as several
 * unrelated systems ramping at once.
 */
export class RunStateSystem {
  /** Upgrade offers currently on screen; empty when no choice is pending. */
  pendingOffers: string[] = [];
  /** Module ids offered at the current checkpoint. */
  pendingModules: string[] = [];
  /** Segment ids offered at the current fork. */
  pendingRoutes: string[] = [];

  /** Seconds left on the current checkpoint's departure timer. */
  checkpointTimer = 0;

  update(world: GameWorld, dt: number): void {
    world.phaseTime += dt;
    world.elapsed += dt;
    world.stats.elapsedSeconds = world.elapsed;

    switch (world.phase) {
      case "CHECKPOINT_PREP":
        this.updateCheckpoint(world, dt);
        break;
      case "MARCH":
      case "FINAL_ESCAPE":
        this.updateMarch(world, dt);
        break;
      default:
        break;
    }

    this.updateProgression(world);
  }

  // -------------------------------------------------------------------------
  // Trail
  // -------------------------------------------------------------------------

  private updateTrail(world: GameWorld, dt: number): void {
    const rate = TRAIL.passivePerSecond + world.modifiers.extraTrailPerSecond;
    world.trail = clamp(world.trail + rate * dt, 0, TRAIL.max);

    if (world.trail > world.stats.peakTrail) world.stats.peakTrail = world.trail;

    const next = resolveTrailState(world.trail);
    if (next !== world.trailState) {
      const from = world.trailState;
      world.trailState = next;
      world.events.emit({ type: "trail.stateChanged", from, to: next, trail: world.trail });
    }

    if (world.trailState === "PURSUIT") {
      world.pursuitTime += dt;
      world.stats.timeInPursuit += dt;
    }
  }

  private updateMarch(world: GameWorld, dt: number): void {
    this.updateTrail(world, dt);

    const route = world.route;
    if (!route.spline) return;

    // The final segment forces Pursuit after a short grace period; the climax
    // is authored, not left to whether the player happened to be noisy.
    const segment = route.segment;
    if (segment && world.phaseTime > segment.pursuitStartSeconds) {
      world.trail = TRAIL.max;
    }

    if (route.isSegmentComplete(world.spider.distanceAlongRoute)) {
      this.arriveAtCheckpoint(world);
    }
  }

  private arriveAtCheckpoint(world: GameWorld): void {
    const destination = world.route.destinationCheckpointId();

    if (destination === "gate.final") {
      world.setPhase("VICTORY");
      world.events.emit({ type: "run.ended", outcome: "victory", reason: "gate" });
      return;
    }

    const checkpoint = getCheckpoint(destination);
    world.spider.docked = true;
    world.spider.speedMode = "march";
    world.trail = Math.min(world.trail, TRAIL.checkpointReset);
    world.trailState = resolveTrailState(world.trail);
    world.pursuitTime = 0;

    this.checkpointTimer = checkpoint.duration;
    this.pendingModules = [...checkpoint.moduleOffer];
    this.pendingRoutes = [...checkpoint.nextSegments];

    world.setPhase("CHECKPOINT_PREP");
    world.events.emit({
      type: "run.checkpointReached",
      checkpointId: destination,
      index: world.route.checkpointIndex,
    });
  }

  private updateCheckpoint(world: GameWorld, dt: number): void {
    // A safe stop is quiet: the Trail bleeds off, which is the reward for
    // arriving with something left rather than a full reset handed out free.
    world.trail = Math.max(0, world.trail - TRAIL.dockedDecayPerSecond * dt);
    world.trailState = resolveTrailState(world.trail);

    this.checkpointTimer -= dt;
    if (this.checkpointTimer <= 0 && this.pendingRoutes.length <= 1) {
      this.departCheckpoint(world);
    }
  }

  /** Leaves the checkpoint on the chosen route. */
  departCheckpoint(world: GameWorld, segmentId?: string): void {
    const chosen = segmentId ?? this.pendingRoutes[0];
    if (!chosen) return;

    world.route.enterSegment(chosen);
    world.spider.docked = false;
    world.spider.distanceAlongRoute = 0;
    world.spider.prevDistanceAlongRoute = 0;
    this.pendingRoutes = [];
    this.pendingModules = [];
    this.checkpointTimer = 0;

    const segment = world.route.segment;
    world.setPhase(segment && segment.modifiers.includes("pursuit") ? "FINAL_ESCAPE" : "MARCH");
  }

  // -------------------------------------------------------------------------
  // Progression
  // -------------------------------------------------------------------------

  private updateProgression(world: GameWorld): void {
    const progress = world.progress;
    progress.xpToNext = Math.round(XP.base * Math.pow(XP.growth, progress.level - 1));

    while (progress.xp >= progress.xpToNext) {
      progress.xp -= progress.xpToNext;
      progress.level++;
      progress.pendingLevelUps++;
      progress.xpToNext = Math.round(XP.base * Math.pow(XP.growth, progress.level - 1));
      world.events.emit({ type: "run.levelUp", level: progress.level });
    }
  }

  /** Opens the upgrade screen when a level-up is queued and play is safe to pause. */
  tryOpenUpgradeChoice(world: GameWorld): boolean {
    if (world.progress.pendingLevelUps <= 0) return false;
    if (world.phase !== "MARCH" && world.phase !== "FINAL_ESCAPE" && world.phase !== "CHECKPOINT_PREP") {
      return false;
    }
    this.pendingOffers = rollUpgradeOffers(world.progress.chosenUpgrades, XP.offerCount, (weights) =>
      world.random.weightedIndex(weights),
    );
    if (this.pendingOffers.length === 0) {
      world.progress.pendingLevelUps = 0;
      return false;
    }
    world.setPhase("UPGRADE_CHOICE");
    return true;
  }

  /** Returns to play after an upgrade or route modal closes. */
  resumeFromModal(world: GameWorld): void {
    const segment = world.route.segment;
    if (world.spider.docked) {
      world.setPhase("CHECKPOINT_PREP");
    } else {
      world.setPhase(segment && segment.modifiers.includes("pursuit") ? "FINAL_ESCAPE" : "MARCH");
    }
  }

  /** Director budget multiplier for the current state, including Pursuit ramp. */
  budgetPerSecond(world: GameWorld): number {
    const base = DIRECTOR.budgetPerSecond[world.trailState];
    if (world.trailState !== "PURSUIT") return base;
    return base + world.pursuitTime * DIRECTOR.pursuitRampPerSecond;
  }
}

/** Maps a Trail value to its named state. Pure, so it is directly testable. */
export function resolveTrailState(trail: number): TrailState {
  if (trail >= TRAIL.thresholds.PURSUIT) return "PURSUIT";
  if (trail >= TRAIL.thresholds.HEAVY) return "HEAVY";
  if (trail >= TRAIL.thresholds.SWARM) return "SWARM";
  if (trail >= TRAIL.thresholds.PROBING) return "PROBING";
  return "QUIET";
}

/** Adds noise from a world event, capped at the Trail maximum. */
export function emitNoise(world: GameWorld, amount: number, x: number, z: number, reason: string): void {
  if (amount <= 0) return;
  world.trail = clamp(world.trail + amount, 0, TRAIL.max);
  world.events.emit({ type: "noise.generated", amount, x, z, reason });
}
