import type { RouteEncounterDefinition } from "../../core/types.ts";
import type { GameWorld } from "../GameWorld.ts";
import type { HordeDirector } from "./HordeDirector.ts";

interface PendingEncounter {
  definition: RouteEncounterDefinition;
  timer: number;
  x: number;
  z: number;
}

/** Runs finite, telegraphed encounters authored into a route segment. */
export class EncounterSystem {
  private segmentId = "";
  private readonly started = new Set<string>();
  private readonly completed = new Set<string>();
  private readonly pending: PendingEncounter[] = [];

  constructor(private readonly director: HordeDirector) {}

  update(world: GameWorld, dt: number): void {
    const segment = world.route.segment;
    const spline = world.route.spline;
    if (!segment || !spline || (world.phase !== "MARCH" && world.phase !== "FINAL_ESCAPE")) return;

    if (segment.id !== this.segmentId) {
      this.segmentId = segment.id;
      this.started.clear();
      this.completed.clear();
      this.pending.length = 0;
      world.encounterSites.length = 0;
      const authored = segment.encounters ?? [];
      for (let i = 0; i < authored.length; i++) {
        const encounter = authored[i];
        if (encounter.kind !== "workshopNest") continue;
        const position = encounterPosition(world, encounter);
        world.encounterSites.push({
          id: world.allocateId(), definitionId: encounter.id, ...position,
          health: 180, maxHealth: 180, radius: 2.7, active: true,
          triggered: false, wavesReleased: 0, reinforcementTimer: 0,
        });
      }
    }

    const encounters = segment.encounters ?? [];
    for (let i = 0; i < encounters.length; i++) {
      const encounter = encounters[i];
      if (encounter.occupants.length === 0 || this.started.has(encounter.id)) continue;
      if (world.spider.distanceAlongRoute < encounter.distance - encounter.triggerLead) continue;

      const position = encounterPosition(world, encounter);
      this.started.add(encounter.id);
      const site = world.encounterSites.find((candidate) => candidate.definitionId === encounter.id);
      if (site) site.triggered = true;
      this.pending.push({ definition: encounter, timer: encounter.warningSeconds, ...position });
      world.events.emit({
        type: "ui.toast",
        message: encounter.kind === "workshopNest" ? "Enemy nest awakening!" : "Movement inside the ruins!",
        tone: "warning",
        duration: Math.max(1.5, encounter.warningSeconds),
      });
      world.events.emit({
        type: "vfx.request",
        effect: "spawnDust",
        x: position.x,
        y: 0.5,
        z: position.z,
        heading: 0,
        scale: 1.8,
      });
    }

    for (let i = this.pending.length - 1; i >= 0; i--) {
      const pending = this.pending[i];
      pending.timer -= dt;
      if (pending.timer > 0) continue;
      this.release(world, pending);
      this.pending.splice(i, 1);
    }
    this.updateReinforcements(world, dt);
  }

  private release(world: GameWorld, pending: PendingEncounter): void {
    const encounter = pending.definition;
    let spawned = 0;
    for (let i = 0; i < encounter.occupants.length; i++) {
      const group = encounter.occupants[i];
      spawned += this.director.spawnEncounterGroup(world, group.archetype, group.count, pending.x, pending.z);
    }
    this.completed.add(encounter.id);
    const site = world.encounterSites.find((candidate) => candidate.definitionId === encounter.id);
    if (site) {
      site.wavesReleased = 1;
      site.reinforcementTimer = 8;
    }
    world.events.emit({
      type: "ui.toast",
      message: `${spawned} enemies emerged`,
      tone: "danger",
      duration: 1.8,
    });
    world.events.emit({
      type: "camera.shake",
      intensity: encounter.kind === "workshopNest" ? 0.28 : 0.18,
      duration: 0.3,
    });
  }

  private updateReinforcements(world: GameWorld, dt: number): void {
    for (let i = 0; i < world.encounterSites.length; i++) {
      const site = world.encounterSites[i];
      if (!site.active || !site.triggered || site.wavesReleased <= 0 || site.wavesReleased >= 3) continue;
      site.reinforcementTimer -= dt;
      if (site.reinforcementTimer > 0) continue;
      const count = 3 + site.wavesReleased;
      this.director.spawnEncounterGroup(world, "minion", count, site.x, site.z);
      site.wavesReleased++;
      site.reinforcementTimer = 8;
      world.events.emit({ type: "ui.toast", message: "Nest released reinforcements", tone: "warning", duration: 1.5 });
    }
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  hasCompleted(id: string): boolean {
    return this.completed.has(id);
  }
}

function encounterPosition(
  world: GameWorld,
  encounter: RouteEncounterDefinition,
): { x: number; z: number } {
  const point = { x: 0, z: 0 };
  const tangent = { x: 0, z: 1 };
  world.route.spline!.positionAt(point, encounter.distance);
  world.route.spline!.tangentAt(tangent, encounter.distance);
  return {
    x: point.x - tangent.z * encounter.lateral,
    z: point.z + tangent.x * encounter.lateral,
  };
}
