import { clamp, dist, dampAngle, headingFromDirection } from "../../core/math.ts";
import type { InputSnapshot } from "../../input/InputActions.ts";
import { PLAYER } from "../../data/balance.ts";
import type { GameWorld } from "../GameWorld.ts";
import { ConstructionSystem } from "./ConstructionSystem.ts";

/**
 * Camera-relative movement, dodge, and the safety tether.
 *
 * Movement is camera-relative because the camera yaw is fixed at 45 degrees:
 * pushing the stick "up" must move the engineer up the screen, not along +Z.
 * The camera basis is injected rather than read from the camera object so the
 * simulation stays free of Three.js.
 */
export class PlayerMovementSystem {
  constructor(private readonly construction = new ConstructionSystem()) {}

  /** Camera-space basis on the XZ plane, set once per frame by the renderer. */
  private forwardX = 0;
  private forwardZ = 1;
  private rightX = 1;
  private rightZ = 0;

  setCameraBasis(forwardX: number, forwardZ: number, rightX: number, rightZ: number): void {
    this.forwardX = forwardX;
    this.forwardZ = forwardZ;
    this.rightX = rightX;
    this.rightZ = rightZ;
  }

  update(world: GameWorld, dt: number, input: InputSnapshot): void {
    const player = world.player;
    player.prevX = player.x;
    player.prevZ = player.z;
    player.prevHeading = player.heading;

    if (player.invulnerability > 0) player.invulnerability -= dt;
    if (player.dodgeCooldown > 0) player.dodgeCooldown -= dt;
    if (player.animLock > 0) player.animLock -= dt;

    if (player.downed) {
      player.velocityX = 0;
      player.velocityZ = 0;
      return;
    }

    if (player.dodgeTimer > 0) {
      this.updateDodge(world, dt);
    } else {
      // Release the simulation pose once the roll ends. The renderer owns its
      // short action blend; leaving this as dodge retriggered it indefinitely.
      if (player.animState === "dodge") player.animState = "idle";
      this.updateWalk(world, dt, input);
      this.tryDodge(world, input);
    }

    this.integrate(world, dt);
    this.updateTether(world, dt);
    this.updateAim(world, input);
  }

  private updateWalk(world: GameWorld, dt: number, input: InputSnapshot): void {
    const player = world.player;
    const stick = input.leftStick;

    // The ghost owns the sticks while placing, but the engineer keeps walking
    // so repositioning a turret never means standing still under fire.
    const moveScale = world.build.ghostActive ? 0.55 : 1;

    let dirX = 0;
    let dirZ = 0;
    if (stick.active) {
      // Raw gamepad Y is -1 for up, so forward is -y.
      dirX = this.rightX * stick.x + this.forwardX * -stick.y;
      dirZ = this.rightZ * stick.x + this.forwardZ * -stick.y;
      const len = Math.hypot(dirX, dirZ);
      if (len > 1e-5) {
        dirX /= len;
        dirZ /= len;
      }
    }

    const carrying = player.carry.kind !== "none";
    const baseSpeed = carrying ? PLAYER.carrySpeed : PLAYER.speed;
    const maxSpeed = baseSpeed * world.modifiers.playerSpeed * moveScale;

    // A held contextual action roots the engineer; that cost is what makes
    // choosing to service a turret under pressure a real decision.
    const rooted = player.actionKind !== null && player.actionKind !== "install";
    const targetX = rooted ? 0 : dirX * maxSpeed * stick.magnitude;
    const targetZ = rooted ? 0 : dirZ * maxSpeed * stick.magnitude;

    const accelerating = Math.hypot(targetX, targetZ) > Math.hypot(player.velocityX, player.velocityZ);
    const rate = (accelerating ? PLAYER.acceleration : PLAYER.deceleration) * dt;

    player.velocityX = approach(player.velocityX, targetX, rate);
    player.velocityZ = approach(player.velocityZ, targetZ, rate);

    if (dirX !== 0 || dirZ !== 0) {
      const target = headingFromDirection(dirX, dirZ);
      player.heading = dampAngle(player.heading, target, 1 / PLAYER.turnRate, dt);
    }
  }

  private tryDodge(world: GameWorld, input: InputSnapshot): void {
    const player = world.player;
    if (!input.buttons.cancel.pressed) return;
    // Circle cancels the build first; only a free Circle is a dodge.
    if (world.build.ghostActive || world.build.radialOpen) return;
    if (player.dodgeCooldown > 0) return;

    let dirX = player.velocityX;
    let dirZ = player.velocityZ;
    if (Math.hypot(dirX, dirZ) < 0.5) {
      dirX = Math.sin(player.heading);
      dirZ = Math.cos(player.heading);
    }
    const len = Math.hypot(dirX, dirZ) || 1;

    player.dodgeDirX = dirX / len;
    player.dodgeDirZ = dirZ / len;
    player.dodgeTimer = PLAYER.dodgeDuration;
    player.dodgeCooldown = PLAYER.dodgeCooldown;
    player.invulnerability = Math.max(
      player.invulnerability,
      PLAYER.dodgeDuration + PLAYER.dodgeInvulnerabilityTail,
    );
    player.animState = "dodge";
    player.animLock = PLAYER.dodgeDuration;
    // A dodge cancels a held action; committing to a repair means committing.
    player.actionKind = null;
    player.actionProgress = 0;

    world.events.emit({
      type: "player.dodged",
      x: player.x,
      z: player.z,
      dirX: player.dodgeDirX,
      dirZ: player.dodgeDirZ,
    });
  }

  private updateDodge(world: GameWorld, dt: number): void {
    const player = world.player;
    player.dodgeTimer = Math.max(0, player.dodgeTimer - dt);

    // Ease-out over the roll so it launches hard and settles, rather than
    // sliding at a constant speed.
    const t = 1 - player.dodgeTimer / PLAYER.dodgeDuration;
    const speed = (PLAYER.dodgeDistance / PLAYER.dodgeDuration) * (1 - t * t * 0.72);
    player.velocityX = player.dodgeDirX * speed;
    player.velocityZ = player.dodgeDirZ * speed;
    player.heading = dampAngle(
      player.heading,
      headingFromDirection(player.dodgeDirX, player.dodgeDirZ),
      0.05,
      dt,
    );
  }

  private integrate(world: GameWorld, dt: number): void {
    const player = world.player;
    let nextX = player.x + player.velocityX * dt;
    let nextZ = player.z + player.velocityZ * dt;

    // Static terrain blocks the engineer. Resolve on each axis separately so a
    // glancing contact slides along the obstacle instead of stopping dead.
    const nav = world.navigation;
    if (nav.isBlockedCircle(nextX, player.z, PLAYER.radius)) {
      nextX = player.x;
      player.velocityX = 0;
    }
    if (nav.isBlockedCircle(nextX, nextZ, PLAYER.radius)) {
      nextZ = player.z;
      player.velocityZ = 0;
    }

    player.x = nextX;
    player.z = nextZ;
  }

  /**
   * The tether pulls the engineer back rather than killing them. Straying is
   * punished with damage and a dropped payload, which is a recoverable mistake.
   */
  private updateTether(world: GameWorld, dt: number): void {
    const player = world.player;
    const spider = world.spider;
    const distance = dist(player.x, player.z, spider.x, spider.z);

    player.tetherStrain = clamp(
      (distance - PLAYER.comfortableDistance) /
        (PLAYER.tetherDistance - PLAYER.comfortableDistance),
      0,
      1,
    );

    if (distance <= PLAYER.tetherDistance) {
      player.tethered = false;
      return;
    }

    const dx = (spider.x - player.x) / distance;
    const dz = (spider.z - player.z) / distance;
    player.x += dx * PLAYER.tetherPullSpeed * dt;
    player.z += dz * PLAYER.tetherPullSpeed * dt;

    const droppedCarry = player.carry.kind !== "none";
    if (player.carry.kind === "structure") {
      this.construction.dropCarriedStructure(
        world,
        player.carry,
        player.x,
        player.z,
        player.heading,
      );
    }
    if (droppedCarry) player.carry = { kind: "none" };

    this.applyTetherDamage(world, dt);

    // The pull and the damage are per step; the announcement is per event.
    // The engineer crossing the line is one thing that happened, and it stays
    // one thing however many steps they spend being hauled back. Dropping the
    // payload is always announced, since it can only happen once per carry.
    if (!player.tethered || droppedCarry) {
      world.events.emit({ type: "player.tethered", x: player.x, z: player.z, droppedCarry });
    }
    player.tethered = true;
  }

  private applyTetherDamage(world: GameWorld, dt: number): void {
    const player = world.player;
    player.health = Math.max(1, player.health - PLAYER.tetherDamagePerSecond * dt);
  }

  private updateAim(world: GameWorld, input: InputSnapshot): void {
    const player = world.player;
    // While the ghost is up the right stick is positioning it, not aiming.
    if (world.build.ghostActive || world.build.radialOpen) {
      player.aimX = 0;
      player.aimZ = 0;
      return;
    }
    const stick = input.rightStick;
    if (!stick.active) {
      player.aimX = 0;
      player.aimZ = 0;
      return;
    }
    player.aimX = this.rightX * stick.x + this.forwardX * -stick.y;
    player.aimZ = this.rightZ * stick.x + this.forwardZ * -stick.y;
    const len = Math.hypot(player.aimX, player.aimZ);
    if (len > 1e-5) {
      player.aimX /= len;
      player.aimZ /= len;
    }
  }
}

function approach(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}
