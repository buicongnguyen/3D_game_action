import type { EnemyDiedEvent, StructurePlacedEvent } from "../../core/events.ts";
import { XP } from "../../data/balance.ts";
import type { GameWorld } from "../GameWorld.ts";

/**
 * XP accrual. Levels themselves belong to `RunStateSystem`; this system only
 * ever adds to `progress.xp`.
 *
 * Kills grant the same XP whether the engineer or a turret landed the last hit.
 * That is deliberate: §7.3 wants the machines doing 60-70% of the damage, so
 * paying less for a turret kill would tax the player for building correctly and
 * push them straight back into the "personal build replaces building" failure
 * mode §25 warns about. `killedByPlayer` pays out in scrap instead, which is a
 * field resource rather than progression.
 *
 * Repair, refuel, recovery and pickup XP are awarded at the point of action by
 * `InteractionSystem`; placement is awarded here because nothing else observes
 * a build completing.
 */
export class ExperienceSystem {
  private subscribedWorld: GameWorld | null = null;
  private unsubscribeDied: (() => void) | null = null;
  private unsubscribePlaced: (() => void) | null = null;

  private readonly onEnemyDied = (event: EnemyDiedEvent): void => {
    const world = this.subscribedWorld;
    if (!world) return;
    if (event.xp > 0) world.progress.xp += event.xp;
  };

  private readonly onStructurePlaced = (event: StructurePlacedEvent): void => {
    const world = this.subscribedWorld;
    if (!world) return;
    void event;
    world.progress.xp += XP.structurePlaced;
  };

  update(world: GameWorld, dt: number): void {
    void dt;
    if (this.subscribedWorld === world) return;

    if (this.unsubscribeDied) this.unsubscribeDied();
    if (this.unsubscribePlaced) this.unsubscribePlaced();

    this.subscribedWorld = world;
    this.unsubscribeDied = world.events.on("enemy.died", this.onEnemyDied);
    this.unsubscribePlaced = world.events.on("structure.placed", this.onStructurePlaced);
  }

  /** Drops subscriptions when a run is torn down. */
  dispose(): void {
    if (this.unsubscribeDied) this.unsubscribeDied();
    if (this.unsubscribePlaced) this.unsubscribePlaced();
    this.unsubscribeDied = null;
    this.unsubscribePlaced = null;
    this.subscribedWorld = null;
  }
}
