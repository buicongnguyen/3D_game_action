import type { VfxSystem } from "../rendering/VfxSystem.ts";
import type { StoryEffect, StoryState } from "./StoryState.ts";

/** Consume transient simulation events exactly once, including paused renders. */
export class StoryEffectBridge {
  private state?: StoryState;
  private seen = new WeakSet<StoryEffect>();
  constructor(private vfx: Pick<VfxSystem, "clear" | "weaponFlash" | "impact" | "deathPoof" | "explosion" | "update">, private height: (x: number, z: number) => number) {}
  update(state: StoryState, dt: number): void {
    if (state !== this.state) { this.vfx.clear(); this.seen = new WeakSet(); this.state = state; }
    for (const e of state.effects) {
      if (this.seen.has(e)) continue;
      this.seen.add(e);
      const y = this.height(e.x, e.z), heading = Math.atan2(e.toX - e.x, e.toZ - e.z);
      if (e.kind === "muzzle") this.vfx.weaponFlash(e.x + Math.sin(heading) * 0.8, y + 1.1, e.z + Math.cos(heading) * 0.8, heading, ({ rifle: "rifle", rocket: "launcher", laser: "arc", flame: "flamer" })[e.weapon ?? "rifle"]);
      else if (e.kind === "impact") this.vfx.impact(e.x, y + 1, e.z, false);
      else if (e.kind === "death") this.vfx.deathPoof(e.x, e.z, e.radius);
      else if (e.kind === "blast") this.vfx.explosion(e.x, e.z, e.radius);
    }
    this.vfx.update(dt);
  }
}
