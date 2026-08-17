import type { EventBus } from "../core/EventBus.ts";
import type { AudioCue, AudioDirector } from "./AudioDirector.ts";

/**
 * Translates simulation events into audio cues.
 *
 * This lives outside `AudioDirector` on purpose: the director knows how to
 * synthesise a sound and how to budget voices, and this file knows what the
 * game means. Keeping them apart is what lets the audio be swapped or muted
 * wholesale without touching gameplay, and it keeps every `world.events`
 * subscription for sound in one readable list.
 */
export class AudioBridge {
  private readonly unsubscribes: Array<() => void> = [];

  constructor(private readonly audio: AudioDirector) {}

  attach(events: EventBus): void {
    const add = this.unsubscribes;
    const audio = this.audio;

    add.push(events.on("weapon.fired", (e) => audio.play("shot.player", e.muzzleX, e.muzzleZ)));
    add.push(
      events.on("structure.fired", (e) =>
        audio.play("shot.turret", e.muzzleX, e.muzzleZ, e.heavy ? 1.4 : 1),
      ),
    );
    add.push(
      events.on("enemy.damaged", (e) => audio.play("hit.bone", e.x, e.z, e.critical ? 1.3 : 0.8)),
    );
    add.push(events.on("enemy.died", (e) => audio.play("enemy.death", e.x, e.z)));
    add.push(events.on("enemy.spawned", (e) => audio.play("enemy.spawn", e.x, e.z, 0.5)));
    add.push(events.on("projectile.hit", (e) => audio.play("hit.metal", e.x, e.z, 0.6)));

    add.push(events.on("player.damaged", () => audio.play("player.hurt")));
    add.push(events.on("player.dodged", (e) => audio.play("player.dodge", e.x, e.z)));
    add.push(events.on("player.downed", (e) => audio.play("player.down", e.x, e.z)));

    add.push(events.on("spider.damaged", (e) => audio.play("spider.damage", e.x, e.z)));
    add.push(
      events.on("spider.speedMode", (e) => {
        if (e.mode === "overdrive") audio.play("spider.overdrive");
      }),
    );
    add.push(events.on("spider.fuelEmpty", () => audio.play("spider.lowFuel")));
    add.push(events.on("spider.refuelled", () => audio.play("refuel")));

    add.push(events.on("structure.placed", (e) => audio.play("build.place", e.x, e.z)));
    add.push(events.on("structure.folded", (e) => audio.play("build.fold", e.x, e.z)));
    add.push(events.on("structure.repaired", (e) => audio.play("repair", e.x, e.z)));
    add.push(events.on("structure.recharged", (e) => audio.play("refuel", e.x, e.z)));
    add.push(events.on("structure.lastShot", (e) => audio.play("lastShot.charge", e.x, e.z, 1.4)));
    add.push(events.on("structure.exploded", (e) => audio.play("explosion", e.x, e.z, 1.5)));
    add.push(events.on("structure.destroyed", (e) => audio.play("explosion", e.x, e.z, 0.7)));
    add.push(events.on("build.rejected", () => audio.play("build.invalid")));

    add.push(
      events.on("pickup.collected", (e) =>
        audio.play(e.kind === "fuel" ? "pickup.fuel" : "pickup.scrap", e.x, e.z, 0.5),
      ),
    );

    add.push(
      events.on("trail.stateChanged", () =>
        audio.play("trail.escalate", undefined, undefined, 1.2),
      ),
    );
    add.push(events.on("run.levelUp", () => audio.play("levelUp")));
    add.push(events.on("run.checkpointReached", () => audio.play("checkpoint")));
    add.push(
      events.on("run.ended", (e) => audio.play(e.outcome === "victory" ? "victory" : "defeat")),
    );
  }

  /** UI sounds are driven directly rather than through the simulation bus. */
  ui(cue: Extract<AudioCue, `ui.${string}`>): void {
    this.audio.play(cue);
  }

  detach(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
  }
}
