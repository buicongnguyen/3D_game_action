import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Points,
  PointsMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from "three";
import { clamp } from "../core/math.ts";
import { FEEDBACK } from "../art/palette.ts";
import { PERFORMANCE } from "../data/balance.ts";
import type { MeshForge } from "../art/MeshForge.ts";

/**
 * Pooled visual effects.
 *
 * Everything here is additive geometry, never a light. A muzzle flash that
 * spawned a real PointLight would force a shader recompile and add a full
 * lighting pass for two frames of sparkle; a two-triangle additive quad costs
 * nothing and reads better at this camera distance.
 *
 * Effects are stored in flat parallel arrays and drawn from a small number of
 * InstancedMeshes, so a hundred simultaneous impacts stay at a handful of draw
 * calls.
 */

type EffectKind = 0 | 1 | 2 | 3;
const FLASH: EffectKind = 0;
const IMPACT: EffectKind = 1;
const EXPLOSION: EffectKind = 2;
/** Ground-aligned expanding ring, used for shockwaves and placement pulses. */
const DUST: EffectKind = 3;

const CAPACITY = PERFORMANCE.vfxPoolCapacity;
const PARTICLE_CAPACITY = 900;

export class VfxSystem {
  private readonly root = new Group();

  private readonly kind = new Uint8Array(CAPACITY);
  private readonly x = new Float32Array(CAPACITY);
  private readonly y = new Float32Array(CAPACITY);
  private readonly z = new Float32Array(CAPACITY);
  private readonly rotation = new Float32Array(CAPACITY);
  private readonly life = new Float32Array(CAPACITY);
  private readonly maxLife = new Float32Array(CAPACITY);
  private readonly size = new Float32Array(CAPACITY);
  private readonly colorR = new Float32Array(CAPACITY);
  private readonly colorG = new Float32Array(CAPACITY);
  private readonly colorB = new Float32Array(CAPACITY);
  private readonly free: number[] = [];

  private quadMesh: InstancedMesh | null = null;
  private ringMesh: InstancedMesh | null = null;

  /** Simple particle field for sparks, bone chips and embers. */
  private particles: Points | null = null;
  private readonly particlePositions = new Float32Array(PARTICLE_CAPACITY * 3);
  private readonly particleVelocities = new Float32Array(PARTICLE_CAPACITY * 3);
  private readonly particleLife = new Float32Array(PARTICLE_CAPACITY);
  private readonly particleColors = new Float32Array(PARTICLE_CAPACITY * 3);
  private particleCursor = 0;

  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly scale = new Vector3();
  private readonly color = new Color();

  constructor(
    private readonly scene: Scene,
    private readonly forge: MeshForge,
  ) {
    this.scene.add(this.root);
    for (let i = CAPACITY - 1; i >= 0; i--) this.free.push(i);
  }

  prepare(): void {
    const quad = new BufferGeometry();
    // A single camera-facing quad in the XZ plane. The camera pitch is fixed,
    // so a ground-aligned quad reads correctly without per-frame billboarding.
    const half = 0.5;
    quad.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([
          -half, 0, -half, half, 0, -half, half, 0, half,
          -half, 0, -half, half, 0, half, -half, 0, half,
        ]),
        3,
      ),
    );
    quad.setAttribute(
      "uv",
      new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), 2),
    );
    quad.computeVertexNormals();

    this.quadMesh = new InstancedMesh(quad, this.forge.materials.additive(0xffffff), CAPACITY);
    this.quadMesh.frustumCulled = false;
    this.quadMesh.count = 0;
    this.quadMesh.renderOrder = 6;
    this.quadMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    this.root.add(this.quadMesh);

    const ring = this.forge.ringGeometry();
    this.ringMesh = new InstancedMesh(ring, this.forge.materials.additive(0xffffff), CAPACITY);
    this.ringMesh.frustumCulled = false;
    this.ringMesh.count = 0;
    this.ringMesh.renderOrder = 5;
    this.ringMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    this.root.add(this.ringMesh);

    const particleGeometry = new BufferGeometry();
    particleGeometry.setAttribute("position", new BufferAttribute(this.particlePositions, 3));
    particleGeometry.setAttribute("color", new BufferAttribute(this.particleColors, 3));
    this.particles = new Points(
      particleGeometry,
      new PointsMaterial({
        size: 0.22,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 7;
    this.root.add(this.particles);

    // Park unused particles far below the ground rather than resizing the
    // buffer every frame.
    for (let i = 0; i < PARTICLE_CAPACITY; i++) this.particlePositions[i * 3 + 1] = -1000;
  }

  // -------------------------------------------------------------------------
  // Emitters
  // -------------------------------------------------------------------------

  /**
   * A muzzle flash has to survive being looked at from twenty metres up.
   *
   * The first version lasted 60 ms at under a metre across, which is correct
   * for a first-person camera and invisible at this one: a reviewer looking at
   * a frame of a hundred-enemy firefight with three turrets in contact could
   * not find a single shot being fired. It now lives about three times as long
   * and reads at roughly the width of the barrel it leaves.
   */
  muzzleFlash(x: number, y: number, z: number, heading: number, heavy: boolean): void {
    this.spawn(FLASH, x, y, z, heading, heavy ? 0.2 : 0.15, heavy ? 2.6 : 1.9, FEEDBACK.muzzle);
    this.spawn(FLASH, x, y, z, heading, heavy ? 0.16 : 0.12, heavy ? 1.5 : 1.05, FEEDBACK.muzzleCore);
    this.burst(x, y, z, heavy ? 9 : 5, 6.5, FEEDBACK.muzzle, heading, 0.5);
  }

  impact(x: number, y: number, z: number, bone: boolean): void {
    this.spawn(
      IMPACT,
      x,
      y,
      z,
      this.spin(),
      0.22,
      1.15,
      bone ? FEEDBACK.bloodBone : FEEDBACK.impact,
    );
    this.burst(x, y, z, bone ? 6 : 4, 3.8, bone ? FEEDBACK.bloodBone : FEEDBACK.impact, 0, 6.283);
  }

  /** Cheap varied rotation without touching the simulation's PRNG. */
  private spinSeed = 0;
  private spin(): number {
    this.spinSeed = (this.spinSeed + 0.618) % 1;
    return this.spinSeed * 6.283;
  }

  explosion(x: number, z: number, radius: number): void {
    this.spawn(EXPLOSION, x, 0.35, z, 0, 0.62, radius * 0.62, FEEDBACK.explosion);
    this.spawn(EXPLOSION, x, 0.5, z, 0.7, 0.42, radius * 0.34, FEEDBACK.explosionCore);
    // The expanding ring is what makes the damage radius legible after the
    // fact, so the player can learn the weapon rather than guess at it.
    this.spawn(DUST, x, 0.08, z, 0, 0.55, radius, FEEDBACK.explosion);
    this.burst(x, 0.4, z, 26, 12, FEEDBACK.explosion, 0, 6.283);
  }

  /**
   * A death is a small puff of bone dust, not a shockwave. At a hundred kills a
   * minute a ring the size of the one an explosion earns would carpet the
   * screen in white donuts and bury the combat it is meant to punctuate.
   */
  deathPoof(x: number, z: number, scale: number): void {
    this.spawn(DUST, x, 0.1, z, 0, 0.26, 0.7 * scale, FEEDBACK.bloodBone);
    this.burst(x, 0.5 * scale, z, 8, 4.5, FEEDBACK.bloodBone, 0, 6.283);
  }

  pickupPop(x: number, z: number, fuel: boolean): void {
    this.spawn(IMPACT, x, 0.5, z, 0, 0.3, 0.5, fuel ? FEEDBACK.fuel : FEEDBACK.scrap);
  }

  placementPulse(x: number, z: number, color: number): void {
    this.spawn(DUST, x, 0.06, z, 0, 0.4, 1.5, color);
  }

  lastShotCharge(x: number, z: number): void {
    this.spawn(EXPLOSION, x, 0.9, z, 0, 0.5, 1.6, FEEDBACK.lastShot);
    this.burst(x, 0.9, z, 14, 6, FEEDBACK.lastShot, 0, 6.283);
  }

  /**
   * Steam venting from an overloading machine, escalating as the fuse runs
   * down. This is the cue that still reads when the ground ring is hidden
   * behind the spider's leg, which is exactly when it matters.
   */
  overloadVent(x: number, z: number, urgency: number): void {
    this.spawn(FLASH, x, 1.05, z, this.spin(), 0.28, 0.8 + urgency * 0.9, FEEDBACK.explosionCore);
    this.burst(x, 1.1, z, 3 + Math.round(urgency * 5), 3 + urgency * 5, FEEDBACK.explosion, 0, 6.283);
  }

  repairSparks(x: number, z: number): void {
    this.burst(x, 0.9, z, 5, 4.2, FEEDBACK.scrap, 0, 6.283);
  }

  private spawn(
    kind: EffectKind,
    x: number,
    y: number,
    z: number,
    rotation: number,
    life: number,
    size: number,
    color: number,
  ): void {
    const index = this.free.pop();
    // Dropping the newest effect when saturated is correct: the screen is
    // already full, and the alternative is an unbounded frame-time spike.
    if (index === undefined) return;

    this.kind[index] = kind;
    this.x[index] = x;
    this.y[index] = y;
    this.z[index] = z;
    this.rotation[index] = rotation;
    this.life[index] = life;
    this.maxLife[index] = life;
    this.size[index] = size;
    this.color.setHex(color);
    this.colorR[index] = this.color.r;
    this.colorG[index] = this.color.g;
    this.colorB[index] = this.color.b;
  }

  private burst(
    x: number,
    y: number,
    z: number,
    count: number,
    speed: number,
    color: number,
    heading: number,
    spread: number,
  ): void {
    this.color.setHex(color);
    for (let i = 0; i < count; i++) {
      const index = this.particleCursor;
      this.particleCursor = (this.particleCursor + 1) % PARTICLE_CAPACITY;

      const angle = heading + (Math.random() - 0.5) * spread;
      const magnitude = speed * (0.45 + Math.random() * 0.55);
      this.particlePositions[index * 3] = x;
      this.particlePositions[index * 3 + 1] = y;
      this.particlePositions[index * 3 + 2] = z;
      this.particleVelocities[index * 3] = Math.sin(angle) * magnitude;
      this.particleVelocities[index * 3 + 1] = 2 + Math.random() * magnitude * 0.55;
      this.particleVelocities[index * 3 + 2] = Math.cos(angle) * magnitude;
      this.particleLife[index] = 0.35 + Math.random() * 0.4;
      this.particleColors[index * 3] = this.color.r;
      this.particleColors[index * 3 + 1] = this.color.g;
      this.particleColors[index * 3 + 2] = this.color.b;
    }
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  update(dt: number): void {
    this.updateEffects(dt);
    this.updateParticles(dt);
  }

  private updateEffects(dt: number): void {
    const quad = this.quadMesh;
    const ring = this.ringMesh;
    if (!quad || !ring) return;

    let quadCount = 0;
    let ringCount = 0;
    const quadColors = quad.instanceColor!.array as Float32Array;
    const ringColors = ring.instanceColor!.array as Float32Array;

    for (let i = 0; i < CAPACITY; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.free.push(i);
        continue;
      }

      const t = 1 - this.life[i] / this.maxLife[i];
      const kind = this.kind[i];
      const isRing = kind === DUST;

      let scale: number;
      let fade: number;
      switch (kind) {
        case FLASH:
          // A flash is instant and gone: no growth, hard falloff.
          scale = this.size[i] * (1 + t * 0.35);
          fade = 1 - t * t;
          break;
        case IMPACT:
          scale = this.size[i] * (0.6 + t * 1.4);
          fade = 1 - t;
          break;
        case EXPLOSION:
          scale = this.size[i] * (0.4 + easeOutCubic(t) * 1.5);
          fade = 1 - easeInCubic(t);
          break;
        case DUST:
          scale = this.size[i] * (0.25 + easeOutCubic(t) * 1.2);
          // Rings read as a UI element if they hold their brightness, so they
          // start dim and fall away quickly. The shape carries the information;
          // the intensity would only compete with the combat underneath.
          fade = (1 - t) * (1 - t) * 0.42;
          break;
        default:
          scale = this.size[i];
          fade = 1 - t;
          break;
      }

      this.position.set(this.x[i], this.y[i], this.z[i]);
      this.quaternion.setFromAxisAngle(UP, this.rotation[i] + t * 0.4);
      this.scale.set(scale, scale, scale);
      this.matrix.compose(this.position, this.quaternion, this.scale);

      const target = isRing ? ring : quad;
      const targetColors = isRing ? ringColors : quadColors;
      const slot = isRing ? ringCount++ : quadCount++;
      target.setMatrixAt(slot, this.matrix);
      targetColors[slot * 3] = this.colorR[i] * fade;
      targetColors[slot * 3 + 1] = this.colorG[i] * fade;
      targetColors[slot * 3 + 2] = this.colorB[i] * fade;
    }

    quad.count = quadCount;
    ring.count = ringCount;
    if (quadCount > 0) {
      quad.instanceMatrix.needsUpdate = true;
      quad.instanceColor!.needsUpdate = true;
    }
    if (ringCount > 0) {
      ring.instanceMatrix.needsUpdate = true;
      ring.instanceColor!.needsUpdate = true;
    }
  }

  private updateParticles(dt: number): void {
    const points = this.particles;
    if (!points) return;
    let anyAlive = false;

    for (let i = 0; i < PARTICLE_CAPACITY; i++) {
      if (this.particleLife[i] <= 0) continue;
      anyAlive = true;
      this.particleLife[i] -= dt;

      const base = i * 3;
      if (this.particleLife[i] <= 0) {
        this.particlePositions[base + 1] = -1000;
        continue;
      }

      this.particleVelocities[base + 1] -= 16 * dt;
      this.particlePositions[base] += this.particleVelocities[base] * dt;
      this.particlePositions[base + 1] += this.particleVelocities[base + 1] * dt;
      this.particlePositions[base + 2] += this.particleVelocities[base + 2] * dt;

      // Bounce once off the ground, then stop; sliding debris looks wrong.
      if (this.particlePositions[base + 1] < 0.05) {
        this.particlePositions[base + 1] = 0.05;
        this.particleVelocities[base + 1] *= -0.32;
        this.particleVelocities[base] *= 0.55;
        this.particleVelocities[base + 2] *= 0.55;
      }

      const fade = clamp(this.particleLife[i] * 2.5, 0, 1);
      this.particleColors[base] *= fade > 0.98 ? 1 : 0.97;
      this.particleColors[base + 1] *= fade > 0.98 ? 1 : 0.97;
      this.particleColors[base + 2] *= fade > 0.98 ? 1 : 0.97;
    }

    if (anyAlive) {
      const geometry = points.geometry;
      geometry.getAttribute("position").needsUpdate = true;
      geometry.getAttribute("color").needsUpdate = true;
    }
  }

  get activeEffects(): number {
    return CAPACITY - this.free.length;
  }

  dispose(): void {
    this.quadMesh?.dispose();
    this.ringMesh?.dispose();
    this.particles?.geometry.dispose();
    (this.particles?.material as { dispose?: () => void })?.dispose?.();
    this.root.removeFromParent();
  }
}

const UP = new Vector3(0, 1, 0);

function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

function easeInCubic(t: number): number {
  return t * t * t;
}
