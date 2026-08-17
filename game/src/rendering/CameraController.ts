import { OrthographicCamera, Vector3 } from "three";
import { clamp, damp, lerp } from "../core/math.ts";
import { CAMERA, PLAYER, SPIDER } from "../data/balance.ts";
import type { InputSnapshot } from "../input/InputActions.ts";
import type { GameWorld } from "../game/GameWorld.ts";
import type { Renderer } from "./Renderer.ts";

/**
 * Fixed-orientation isometric camera.
 *
 * The camera follows a weighted point between the player and the spider, not
 * the player alone. That is a gameplay decision, not a framing one: the whole
 * game is about the relationship between where you are and where the fortress
 * is, so the camera must always be able to answer "how far ahead am I?" without
 * the player rotating anything.
 *
 * Yaw and pitch never change. A rotating camera would break camera-relative
 * movement muscle memory and would make the 45-degree isometric read — the
 * thing that keeps a 130-enemy screen legible — inconsistent frame to frame.
 */
/** Fraction of the frame kept clear at each border for edge indicators. */
const EDGE_INSET = 0.06;

export class CameraController {
  readonly camera: OrthographicCamera;

  /** Camera-space basis on the XZ plane, consumed by movement and placement. */
  forwardX = 0;
  forwardZ = 1;
  rightX = 1;
  rightZ = 0;

  /** The world point the camera is centred on. */
  focusX = 0;
  focusZ = 0;

  private viewSize: number = CAMERA.viewSize;
  private targetViewSize: number = CAMERA.viewSize;
  private shakeAmount = 0;
  private shakeTime = 0;
  private shakeScale = 1;
  private shakeOffsetX = 0;
  private shakeOffsetZ = 0;
  private readonly offset = new Vector3();
  private readonly scratch = new Vector3();
  private readonly screenPoint = { x: 0, y: 0 };
  private noiseSeed = 0;

  constructor(private readonly renderer: Renderer) {
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 400);

    // A fixed yaw/pitch pair converts directly into a constant view offset.
    const pitch = CAMERA.pitch;
    const yaw = CAMERA.yaw;
    const horizontal = Math.cos(pitch);
    this.offset.set(Math.sin(yaw) * horizontal, Math.sin(pitch), Math.cos(yaw) * horizontal);
    this.offset.multiplyScalar(CAMERA.distance);

    this.computeBasis();
    this.applyProjection();
  }

  /**
   * The camera's forward and right vectors projected onto the ground plane.
   * Movement uses these so "up on the stick" is always "up the screen".
   */
  private computeBasis(): void {
    const yaw = CAMERA.yaw;
    // Forward is the direction the camera looks, flattened: -offset on XZ.
    this.forwardX = -Math.sin(yaw);
    this.forwardZ = -Math.cos(yaw);
    const length = Math.hypot(this.forwardX, this.forwardZ) || 1;
    this.forwardX /= length;
    this.forwardZ /= length;
    // Right is forward rotated -90 degrees about Y.
    this.rightX = -this.forwardZ;
    this.rightZ = this.forwardX;
  }

  private applyProjection(): void {
    const aspect = this.renderer.aspect;
    const halfHeight = this.viewSize;
    const halfWidth = halfHeight * aspect;
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }

  snapTo(world: GameWorld): void {
    this.computeFocusTarget(world);
    this.focusX = this.targetX;
    this.focusZ = this.targetZ;
    this.viewSize = this.targetViewSize;
    this.commit();
  }

  private targetX = 0;
  private targetZ = 0;

  /**
   * Weighted focus plus a lead in the march direction. The lead is what stops
   * the player from running into unseen ground at the top of the screen; the
   * weighting is what keeps the spider on screen without pinning the camera to
   * it and making the engineer feel like a passenger.
   */
  private computeFocusTarget(world: GameWorld): void {
    const player = world.player;
    const spider = world.spider;
    const weight = CAMERA.spiderWeight;

    let x = player.x * (1 - weight) + spider.x * weight;
    let z = player.z * (1 - weight) + spider.z * weight;

    const spline = world.route.spline;
    if (spline && !spider.docked) {
      const heading = spider.heading;
      x += Math.sin(heading) * CAMERA.lookAhead;
      z += Math.cos(heading) * CAMERA.lookAhead;
    }

    // Hard guarantee that the player stays well inside frame.
    //
    // The weighted point plus a march look-ahead can drift far enough toward
    // the spider that the engineer sits near an edge - and the engineer is the
    // thing the player is steering. Rather than reduce the spider's weight and
    // lose the "where is my fortress" read, the focus is pulled back whenever
    // the player would leave the safe box. The result keeps the spider framed
    // in the common case and never sacrifices the player in the uncommon one.
    const dx = player.x - x;
    const dz = player.z - z;
    const screenRight = dx * this.rightX + dz * this.rightZ;
    const screenUp = (dx * this.forwardX + dz * this.forwardZ) * Math.sin(CAMERA.pitch);
    const limitX = this.halfWidth * CAMERA.playerSafeFraction;
    const limitY = this.viewSize * CAMERA.playerSafeFraction;

    const overX = Math.abs(screenRight) - limitX;
    if (overX > 0) {
      const push = Math.sign(screenRight) * overX;
      x += this.rightX * push;
      z += this.rightZ * push;
    }
    const overY = Math.abs(screenUp) - limitY;
    if (overY > 0) {
      const push = (Math.sign(screenUp) * overY) / Math.sin(CAMERA.pitch);
      x += this.forwardX * push;
      z += this.forwardZ * push;
    }

    this.targetX = x;
    this.targetZ = z;

    // Zoom out as the engineer strays, so straying never means losing sight of
    // the fortress you are straying from.
    const separation = Math.hypot(player.x - spider.x, player.z - spider.z);
    const stretch = clamp(separation / PLAYER.tetherDistance, 0, 1);
    const pursuitPush = world.trailState === "PURSUIT" ? 0.18 : 0;
    this.targetViewSize = lerp(
      CAMERA.minViewSize,
      CAMERA.maxViewSize,
      clamp(stretch * 0.85 + pursuitPush, 0, 1),
    );
  }

  update(world: GameWorld, dt: number, input: InputSnapshot): void {
    this.computeFocusTarget(world);

    if (input.buttons.recenter.pressed) {
      // R3 recentres on the engineer, not on the weighted point. The player
      // presses it when they have lost track of themselves, so it should answer
      // that question rather than reframe the fortress.
      this.focusX = world.player.x;
      this.focusZ = world.player.z;
    } else {
      this.focusX = damp(this.focusX, this.targetX, CAMERA.followHalfLife, dt);
      this.focusZ = damp(this.focusZ, this.targetZ, CAMERA.followHalfLife, dt);
    }

    this.viewSize = damp(this.viewSize, this.targetViewSize, CAMERA.zoomHalfLife, dt);
    this.updateShake(dt);
    this.applyProjection();
    this.commit();
    this.renderer.updateShadowFocus(this.focusX, this.focusZ);
  }

  private updateShake(dt: number): void {
    if (this.shakeAmount <= 0.0001) {
      this.shakeOffsetX = 0;
      this.shakeOffsetZ = 0;
      return;
    }
    this.shakeTime += dt;
    this.shakeAmount = Math.max(0, this.shakeAmount - CAMERA.shakeDecay * dt * this.shakeAmount);

    // Two incommensurable frequencies read as a shake; one reads as a wobble.
    const t = this.shakeTime * 34 + this.noiseSeed;
    const magnitude = this.shakeAmount * this.shakeScale;
    this.shakeOffsetX = (Math.sin(t) * 0.6 + Math.sin(t * 2.37) * 0.4) * magnitude;
    this.shakeOffsetZ = (Math.cos(t * 1.13) * 0.6 + Math.cos(t * 2.91) * 0.4) * magnitude;
  }

  private commit(): void {
    const x = this.focusX + this.shakeOffsetX;
    const z = this.focusZ + this.shakeOffsetZ;
    this.camera.position.set(x + this.offset.x, this.offset.y, z + this.offset.z);
    this.scratch.set(x, 0, z);
    this.camera.lookAt(this.scratch);
    this.camera.updateMatrixWorld();
  }

  shake(intensity: number, duration: number): void {
    void duration;
    this.shakeAmount = Math.min(CAMERA.maxShake, this.shakeAmount + intensity);
    this.noiseSeed += 1.7;
  }

  setShakeScale(scale: number): void {
    this.shakeScale = clamp(scale, 0, 2);
  }

  /** Half-height of the view in world units; used for culling and HUD anchors. */
  get halfHeight(): number {
    return this.viewSize;
  }

  get halfWidth(): number {
    return this.viewSize * this.renderer.aspect;
  }

  /**
   * Cheap visibility test in camera space, avoiding a full frustum projection.
   * The camera is orthographic with a fixed orientation, so a point's screen
   * position is an affine function of its world XZ.
   */
  isVisible(worldX: number, worldZ: number, margin: number): boolean {
    const dx = worldX - this.focusX;
    const dz = worldZ - this.focusZ;
    const screenRight = dx * this.rightX + dz * this.rightZ;
    const screenUp = dx * this.forwardX + dz * this.forwardZ;
    // The vertical screen axis is foreshortened by the camera pitch.
    const foreshorten = Math.sin(CAMERA.pitch);
    return (
      Math.abs(screenRight) <= this.halfWidth + margin &&
      Math.abs(screenUp * foreshorten) <= this.halfHeight + margin
    );
  }

  get viewportWidth(): number {
    return this.renderer.viewportWidth;
  }

  get viewportHeight(): number {
    return this.renderer.viewportHeight;
  }

  /** Normalised screen position in [0,1] for a world point on the ground. */
  projectToScreen(worldX: number, worldZ: number): { x: number; y: number } {
    const dx = worldX - this.focusX;
    const dz = worldZ - this.focusZ;
    const screenRight = dx * this.rightX + dz * this.rightZ;
    const screenUp = (dx * this.forwardX + dz * this.forwardZ) * Math.sin(CAMERA.pitch);
    // Inset rather than clamped to the very edge. A marker for something
    // off-screen has to sit *near* the border to read as "over there"; flush in
    // the corner it reads as a layout bug, which is exactly how it was
    // described in review.
    this.screenPoint.x = clamp(0.5 + screenRight / (this.halfWidth * 2), EDGE_INSET, 1 - EDGE_INSET);
    this.screenPoint.y = clamp(
      0.5 - screenUp / (this.halfHeight * 2),
      EDGE_INSET,
      1 - EDGE_INSET,
    );
    return this.screenPoint;
  }

  /** Screen-space angle in radians from one world point to another, 0 = up. */
  screenAngleTo(fromX: number, fromZ: number, toX: number, toZ: number): number {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const screenRight = dx * this.rightX + dz * this.rightZ;
    const screenUp = (dx * this.forwardX + dz * this.forwardZ) * Math.sin(CAMERA.pitch);
    return Math.atan2(screenRight, screenUp);
  }

  /** World-space radius that safely covers the visible area, for culling. */
  get cullRadius(): number {
    return Math.hypot(this.halfWidth, this.halfHeight / Math.sin(CAMERA.pitch)) + SPIDER.bodyLength;
  }
}
