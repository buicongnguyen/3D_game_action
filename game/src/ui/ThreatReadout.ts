import { distSq } from "../core/math.ts";
import type { GameWorld } from "../game/GameWorld.ts";

export interface ThreatReadout {
  label: string;
  detail: string;
  health: number;
  maxHealth: number;
}

/** One local priority, not a label for every enemy. Dead bosses never linger. */
export function updateThreatReadout(world: GameWorld, out: ThreatReadout): void {
  out.label = "";
  out.detail = "";
  out.health = 0;
  out.maxHealth = 1;
  let nearest = 32 * 32;
  for (const enemy of world.enemies.backing) {
    if (!enemy.active || enemy.health <= 0 || enemy.state === "DEAD" || enemy.archetype !== "golem") continue;
    const distance = Math.min(
      distSq(enemy.x, enemy.z, world.spider.x, world.spider.z),
      distSq(enemy.x, enemy.z, world.player.x, world.player.z),
    );
    if (distance >= nearest) continue;
    nearest = distance;
    out.label = "BOSS · Bone Colossus";
    out.detail = "Protect the Spider · focus heavy fire";
    out.health = enemy.health;
    out.maxHealth = enemy.maxHealth;
  }
  if (out.label) return;
  for (const site of world.encounterSites) {
    if (!site.active || !site.triggered || site.health <= 0) continue;
    const distance = Math.min(
      distSq(site.x, site.z, world.spider.x, world.spider.z),
      distSq(site.x, site.z, world.player.x, world.player.z),
    );
    if (distance >= nearest) continue;
    nearest = distance;
    out.label = "ENEMY NEST · +25 scrap";
    out.detail = site.wavesReleased >= 3
      ? "Waves exhausted · destroy for salvage"
      : `${site.wavesReleased === 0 ? "First wave" : "Reinforcements"} in ${Math.max(0, Math.ceil(site.reinforcementTimer))}s · destroy to stop`;
    out.health = site.health;
    out.maxHealth = site.maxHealth;
  }
}
