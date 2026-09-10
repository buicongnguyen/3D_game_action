import { OPERATIONS } from "../../data/campaign.ts";
import type { GameWorld } from "../GameWorld.ts";

export interface OperationState {
  segmentId: string;
  status: "waiting" | "choice" | "active" | "success" | "declined" | "failed";
  x: number; z: number; progress: number; elapsed: number; recovery: number;
}

export function beginOperation(world: GameWorld): void {
  const id = world.route.segment?.id ?? "";
  world.operation = null;
  if (world.mode !== "expedition" || !OPERATIONS[id] || !world.route.spline) return;
  // Every site is on the road, ahead of the initial tutorial area.
  const point = { x: 0, z: 0 };
  world.route.spline.positionAt(point, world.route.spline.length * 0.38);
  world.operation = { segmentId: id, status: world.campaign.outcomes[id] ?? "waiting",
    x: point.x, z: point.z, progress: 0, elapsed: 0, recovery: 0 };
}

export function chooseOperation(world: GameWorld, accept: boolean): boolean {
  const op = world.operation;
  if (!op || op.status !== "choice") return false;
  if (!accept) {
    op.status = "declined";
    world.campaign.outcomes[op.segmentId] = "declined";
    return true;
  }
  op.status = "active";
  op.elapsed = 0; op.progress = 0;
  const def = OPERATIONS[op.segmentId];
  if (def.kind === "salvage") {
    // A deterministic local cache; exhaustion cannot cause a soft-lock because
    // all operations time out. Normal pickup collection supplies the credit.
    for (let i = 0; i < 3; i++) {
      const p = world.pickups.acquire();
      if (!p) break;
      p.id = world.allocateId(); p.active = true; p.kind = "scrap"; p.amount = 4;
      p.x = op.x + (i - 1) * 2; p.z = op.z + 3;
      p.lifetime = def.timeout; p.settleTimer = 0; p.claimRadius = 0;
    }
  }
  return true;
}

export function updateOperation(world: GameWorld, dt: number): void {
  if (world.mode !== "expedition" || world.paused ||
      (world.phase !== "MARCH" && world.phase !== "FINAL_ESCAPE")) return;
  if (world.route.segment?.id === "seg.escape" && !world.campaign.finalAidClaimed) {
    world.campaign.finalAidClaimed = true;
    const helped = Object.values(world.campaign.outcomes).filter((v) => v === "success").length;
    if (helped > 0) {
      const fuel = Math.min(30, helped * 5), repair = Math.min(60, helped * 10);
      world.spider.fuel = Math.min(world.spider.maxFuel, world.spider.fuel + fuel);
      world.spider.coreHealth = Math.min(world.spider.maxCoreHealth, world.spider.coreHealth + repair);
      world.events.emit({ type: "ui.toast", message: `Nera: ${helped} communities answered · up to +${fuel} fuel / +${repair} integrity`, tone: "success", duration: 5 });
    }
  }
  const op = world.operation;
  if (!op || op.segmentId !== world.route.segment?.id) return;
  op.recovery = Math.max(0, op.recovery - dt);
  if (op.status === "waiting" && world.route.spline &&
      world.spider.distanceAlongRoute >= world.route.spline.length * 0.38) {
    // Anchor at the actual stopped position to avoid overshoot at low frame rate.
    op.x = world.spider.x; op.z = world.spider.z;
    op.status = "choice";
  }
  if (op.status !== "active") return;
  const def = OPERATIONS[op.segmentId];
  op.elapsed += dt;
  if (!world.player.downed && def.kind === "service" &&
      Math.hypot(world.player.x - op.x, world.player.z - op.z) <= 8) op.progress += dt;
  if (op.progress >= def.target) {
    op.progress = def.target;
    op.status = "success"; op.recovery = 18;
    world.campaign.outcomes[op.segmentId] = "success";
    const reward = def.reward;
    if (reward.kind === "scrap") world.resources.scrap += reward.amount;
    else if (reward.kind === "fuel") world.spider.fuel = Math.min(world.spider.maxFuel, world.spider.fuel + reward.amount);
    else world.spider.coreHealth = Math.min(world.spider.maxCoreHealth, world.spider.coreHealth + reward.amount);
    world.events.emit({ type: "ui.toast", message: `${def.success} · ${reward.amount} ${reward.kind}${reward.kind === "scrap" ? "" : " (up to capacity)"}`, tone: "success", duration: 5 });
  } else if (op.elapsed >= def.timeout) {
    op.status = "failed";
    world.campaign.outcomes[op.segmentId] = "failed";
    world.events.emit({ type: "ui.toast", message: "Mara: We must move. Operation unfinished; no reward lost from your inventory.", tone: "warning", duration: 4 });
  }
}

export function recordOperationKill(world: GameWorld, x: number, z: number): void {
  const op = world.operation;
  if (op?.status === "active" && OPERATIONS[op.segmentId].kind === "combat" &&
      Math.hypot(x - op.x, z - op.z) <= 18) op.progress++;
}
export function recordOperationSalvage(world: GameWorld, x: number, z: number, amount: number): void {
  const op = world.operation;
  if (op?.status === "active" && OPERATIONS[op.segmentId].kind === "salvage" &&
      Math.hypot(x - op.x, z - op.z) <= 18) op.progress += amount;
}
export function operationPressure(world: GameWorld): number {
  const op = world.operation;
  if (world.mode !== "expedition" || !op) return 1;
  if (op.status === "active") return OPERATIONS[op.segmentId].pressure;
  if (op.recovery > 0) return 0.35;
  return op.segmentId === "seg.scrapyard" && op.status === "success" ? 0.65 : 1;
}
