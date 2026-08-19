import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  ConeGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  RingGeometry,
  Vector3,
  type Scene,
} from "three";
import { clamp, distSq, lerp } from "../core/math.ts";
import { DIRECTOR, PERFORMANCE, PLAYER, SPIDER, STRUCTURES } from "../data/balance.ts";
import { ENEMY_COLORS, FEEDBACK, PLAYER_COLORS } from "../art/palette.ts";
import { getArchetype } from "../data/enemies.ts";
import { getBlueprint, getStructureConfig } from "../data/structures.ts";
import type { Enemy, PickupKind, Structure, StructureKind } from "../core/types.ts";
import type { MeshForge } from "../art/MeshForge.ts";
import type { PuppetRig } from "../art/characters.ts";
import type { TurretRig } from "../art/machines.ts";
import type { GameWorld } from "../game/GameWorld.ts";
import { TerrainBuilder } from "./TerrainBuilder.ts";
import { HordeBatch } from "./HordeBatch.ts";
import type { VfxSystem } from "./VfxSystem.ts";
import {
  animateHumanoid,
  animateImpostor,
  animateSpider,
  animateTurret,
  captureRigRest,
  captureSpiderRest,
  captureTurretRest,
  createImpostorState,
  createPuppetState,
  playAction,
  type ImpostorAnimationState,
  type ImpostorPose,
  type PuppetAnimationState,
} from "./AnimationSystem.ts";

/**
 * The bridge from simulation state to the scene graph.
 *
 * Every visual here is pooled and every transform is interpolated between the
 * previous and current fixed step, so the picture is smooth at any refresh
 * rate while the simulation stays locked to 60 Hz.
 *
 * Enemy rendering is two-tier. A fixed pool of articulated puppets covers the
 * nearest enemies; everything beyond that is drawn as one instanced impostor
 * mesh per archetype. That is what makes a 200-enemy stress test survivable:
 * the expensive representation is capped by budget, not by how many enemies
 * happen to exist.
 */

interface EnemyVisual {
  rig: PuppetRig | null;
  state: PuppetAnimationState;
  enemyId: number;
  /** Pool slot of the enemy this puppet is bound to, or -1. */
  slot: number;
  /** Batch instance ids, one per mesh in the rig. */
  batchIds: number[];
  /** 1 while the hit flash tint is applied, so it is cleared exactly once. */
  tinted: number;
}

interface StructureVisual {
  id: number;
  kind: StructureKind;
  root: Object3D;
  turret: TurretRig | null;
  gauge: Object3D | null;
  /** Bright arc whose sweep is the remaining service time. */
  ring: Mesh;
  /** Dim full circle behind the arc, so an empty buffer still reads as empty. */
  track: Mesh;
  /** Last sweep written, quantised, so the geometry is only rebuilt on change. */
  ringSweep: number;
  /** Countdown to the next overload steam vent. */
  ventTimer: number;
  /**
   * Integrated Last Shot fuse phase, in radians. The whole intent is that the
   * beat quickens as the fuse burns down, which means the rate changes every
   * frame - so it has to be integrated. Multiplying a running clock by it made
   * the instantaneous frequency climb with elapsed run time instead, reaching
   * well past the frame rate and aliasing into a strobe whose apparent speed
   * depended on when in the run the machine happened to be abandoned.
   */
  fusePhase: number;
  recoil: number;
  /**
   * Recovery progress, 0 upright to 1 folded flat. Eased rather than assigned,
   * so releasing the recover button springs the machine back open instead of
   * snapping it, and so a fold that completes never rewinds on its last frame.
   */
  folded: number;
  /** Batch instance ids, one per mesh; empty when the batch was full. */
  batchIds: number[];
  batched: boolean;
}

/**
 * How many enemies get an articulated puppet at once.
 *
 * A puppet is eleven or twelve separate meshes, because its joints have to move
 * independently, and everything beyond this budget is drawn as a single-mesh
 * impostor instead. The budget was once the biggest lever on the draw-call
 * count, when each of those meshes was its own draw call; since the horde moved
 * into a `BatchedMesh` the whole articulated horde is one call whatever its
 * size, so what it now buys is per-frame matrix work and batch instances. See
 * `PERFORMANCE.maxFullAnimationEnemies` for where the number comes from.
 */
const PUPPET_BUDGET = PERFORMANCE.maxFullAnimationEnemies;

/** Instance slots reserved in the horde batch: one per limb of every puppet. */
const MAX_PARTS_PER_RIG = 14;

/** Concurrent structures the batch can hold before falling back to plain meshes. */
const STRUCTURE_BUDGET = 24;
const MAX_PARTS_PER_STRUCTURE = 18;

/**
 * Geometry pools for the two batches, in vertices and indices.
 *
 * These are not per instance. `HordeBatch` adds each distinct geometry to the
 * batch exactly once and then instances it, and the forge caches part geometry
 * per archetype, so the whole horde resolves to a small fixed set however many
 * puppets are bound. Measured over every rig that can enter each batch: the
 * three enemy archetypes are 22 geometries, 4,734 vertices and 17,448 indices
 * between them; the four structures are 12 geometries, 5,268 vertices and 9,498
 * indices. The pools are about four times that, which is room for another
 * archetype rather than a guess.
 *
 * They were previously sized as budget * parts * 220, which scales a shared
 * buffer by an instance count that cannot affect it: 197k vertices allocated to
 * hold 4.7k, and doubling with any rise in the puppet budget.
 */
const HORDE_BATCH_VERTICES = 20000;
const HORDE_BATCH_INDICES = 72000;
const STRUCTURE_BATCH_VERTICES = 22000;
const STRUCTURE_BATCH_INDICES = 40000;

const TAU = Math.PI * 2;

/** Instanced contact-shadow discs. */
const CONTACT_SHADOW_CAPACITY = DIRECTOR.enemyPoolCapacity + 8;

/** Player pip height: above the spider's hull, so it clears the one thing that hides the player. */
const PIP_HEIGHT = SPIDER.bodyHeight + 1.1;

/** Longest hit flash, used to normalise the decay curve. */
const HIT_FLASH_SECONDS = 0.17;

/** Roughly a full projectile lifetime, used to normalise the tracer fade. */
const PROJECTILE_FADE_SECONDS = 0.44;

/**
 * How many death marks the ground remembers.
 *
 * A run kills a couple of hundred skeletons; without this the battlefield is
 * spotless a second after every fight, which reads as though nothing happened.
 * A ring buffer keeps the evidence bounded at one draw call.
 */
const DEATH_MARK_CAPACITY = 72;
const DEATH_MARK_SECONDS = 26;

/** Fold progress shed per second when a recovery is abandoned part-way. */
const UNFOLD_RATE = 4;

export class WorldView {
  private readonly root = new Group();
  private readonly terrain: TerrainBuilder;

  private playerRig: PuppetRig | null = null;
  private readonly playerState = createPuppetState(0);
  private playerCarryNode: Object3D | null = null;
  private carriedVisual: Object3D | null = null;
  private carriedKind: string | null = null;
  private readonly weaponVisuals: Object3D[] = [];
  private weaponKind = "";

  private spiderRig: ReturnType<MeshForge["createSpider"]> | null = null;

  private readonly enemyVisuals: EnemyVisual[] = [];
  /** Pool slot -> index into enemyVisuals, or -1 when on an impostor. */
  private readonly slotToVisual = new Int16Array(DIRECTOR.enemyPoolCapacity).fill(-1);
  private readonly freeVisuals: number[] = [];
  private readonly impostors = new Map<string, InstancedMesh>();
  private readonly impostorCounts = new Map<string, number>();
  /**
   * Gait state for the impostors, indexed by enemy pool slot rather than by
   * instance, so an enemy keeps its stride when the horde's draw order changes
   * or when it crosses in or out of the puppet budget. A recycled slot inherits
   * a live phase, which is correct: the phase is arbitrary, and the per-enemy
   * offset applied at read time is what actually de-syncs the crowd.
   */
  private readonly impostorStates: ImpostorAnimationState[] = [];
  private readonly impostorPose: ImpostorPose = { squash: 1, lean: 0 };
  private hordeBatch: HordeBatch | null = null;
  private structureBatch: HordeBatch | null = null;
  private contactShadows: InstancedMesh | null = null;
  private contactShadowCount = 0;
  private deathMarks: InstancedMesh | null = null;
  private readonly deathMarkX = new Float32Array(DEATH_MARK_CAPACITY);
  private readonly deathMarkZ = new Float32Array(DEATH_MARK_CAPACITY);
  private readonly deathMarkScale = new Float32Array(DEATH_MARK_CAPACITY);
  private readonly deathMarkAge = new Float32Array(DEATH_MARK_CAPACITY);
  private deathMarkCursor = 0;
  private deathMarkLive = 0;
  private rebalanceTimer = 0;

  private readonly structureVisuals = new Map<number, StructureVisual>();
  private projectileMesh: InstancedMesh | null = null;
  private readonly pickupMeshes = new Map<string, InstancedMesh>();
  private pickupGlow: InstancedMesh | null = null;

  private playerMarker: Mesh | null = null;
  private playerPip: Mesh | null = null;
  private ghost: Object3D | null = null;
  private ghostCoverage: Mesh | null = null;
  private ghostCoverageMaterial: MeshBasicMaterial | null = null;
  private ghostRing: Mesh | null = null;
  private serviceRing: Mesh | null = null;
  private readonly relayRings: Mesh[] = [];

  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly leanQuaternion = new Quaternion();
  private readonly scale = new Vector3(1, 1, 1);
  private readonly tempColor = new Color();
  private clock = 0;

  /**
   * Set by `Game` after construction. The view emits a few effects of its own
   * — ones driven by continuous state rather than by a discrete event, like an
   * overloading machine's steam — which have no event to hang off.
   */
  private vfx: VfxSystem | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly forge: MeshForge,
  ) {
    this.scene.add(this.root);
    this.terrain = new TerrainBuilder(forge, this.root);
  }

  setVfx(vfx: VfxSystem): void {
    this.vfx = vfx;
  }

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  prepare(): void {
    this.playerRig = this.forge.createEngineer();
    // Rest poses must be snapshotted before the first animation step. The
    // animators offset from `userData.restY`; without it the offset is
    // `undefined + bob`, which is NaN, and a NaN transform silently removes the
    // whole subtree from the render with no error anywhere.
    captureRigRest(this.playerRig);
    this.root.add(this.playerRig.root);
    this.playerCarryNode = this.playerRig.handL;

    this.weaponVisuals.push(
      this.forge.createScattergun(),
      this.forge.createGearburstCarbine(),
      this.forge.createRivetRifle(),
      this.forge.createSteamFlamer(),
      this.forge.createArcProjector(),
      this.forge.createMagneticLauncher(),
    );
    for (let i = 0; i < this.weaponVisuals.length; i++) this.playerRig.handR.add(this.weaponVisuals[i]);

    this.spiderRig = this.forge.createSpider();
    captureSpiderRest(this.spiderRig);
    this.root.add(this.spiderRig.root);

    // Sized from the forge's own vertex report so the batch buffer is neither
    // undersized (silent dropped limbs) nor wastefully large.
    this.hordeBatch = new HordeBatch(
      this.forge.materials.surface,
      PUPPET_BUDGET * MAX_PARTS_PER_RIG,
      HORDE_BATCH_VERTICES,
      HORDE_BATCH_INDICES,
    );
    this.root.add(this.hordeBatch.mesh);

    // Structures are far fewer than enemies but heavier per unit - a turret
    // carries more geometry than a skeleton - so the instance count is small
    // while the geometry pool is not much smaller than the horde's.
    this.structureBatch = new HordeBatch(
      this.forge.materials.surface,
      STRUCTURE_BUDGET * MAX_PARTS_PER_STRUCTURE,
      STRUCTURE_BATCH_VERTICES,
      STRUCTURE_BATCH_INDICES,
    );
    this.root.add(this.structureBatch.mesh);

    // Seeded spread across the stride, so a wave of enemies that all reach the
    // impostor tier on the same frame does not march in lockstep.
    for (let slot = 0; slot < DIRECTOR.enemyPoolCapacity; slot++) {
      this.impostorStates.push(createImpostorState(slot / DIRECTOR.enemyPoolCapacity));
    }

    for (let i = 0; i < PUPPET_BUDGET; i++) {
      this.enemyVisuals.push({
        rig: null,
        state: createPuppetState(i / PUPPET_BUDGET),
        enemyId: -1,
        slot: -1,
        batchIds: [],
        tinted: 0,
      });
      this.freeVisuals.push(i);
    }

    this.buildImpostors();
    this.buildContactShadows();
    this.buildDeathMarks();
    this.buildProjectiles();
    this.buildPickups();
    this.buildOverlays();
  }

  /**
   * A single instanced disc layer that grounds every enemy.
   *
   * Real shadow casting from the horde is unaffordable: each enemy is eleven
   * meshes and the shadow pass redraws every one of them, which roughly doubles
   * the frame's draw calls for a detail almost no one can resolve at this camera
   * distance. A darkened disc under each body does the one job the shadow
   * actually has here - telling the player where a thing is standing - for one
   * draw call across the whole horde.
   */
  private buildContactShadows(): void {
    const geometry = new CircleGeometry(0.5, 12);
    geometry.rotateX(-Math.PI / 2);
    const material = new MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      toneMapped: false,
      fog: true,
    });
    this.contactShadows = new InstancedMesh(geometry, material, CONTACT_SHADOW_CAPACITY);
    this.contactShadows.frustumCulled = false;
    this.contactShadows.castShadow = false;
    this.contactShadows.receiveShadow = false;
    this.contactShadows.renderOrder = 1;
    this.contactShadows.count = 0;
    this.contactShadows.name = "contactShadows";
    this.root.add(this.contactShadows);
  }

  /**
   * Ground marks left where enemies died. Oldest is overwritten, so the cost is
   * fixed no matter how long the fight runs.
   */
  private buildDeathMarks(): void {
    const geometry = new CircleGeometry(0.5, 10);
    geometry.rotateX(-Math.PI / 2);
    const material = new MeshBasicMaterial({
      color: ENEMY_COLORS.boneShadow,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      toneMapped: false,
      fog: true,
    });
    this.deathMarks = new InstancedMesh(geometry, material, DEATH_MARK_CAPACITY);
    this.deathMarks.frustumCulled = false;
    this.deathMarks.castShadow = false;
    this.deathMarks.receiveShadow = false;
    this.deathMarks.renderOrder = 1;
    this.deathMarks.count = 0;
    this.deathMarks.name = "deathMarks";
    this.root.add(this.deathMarks);
  }

  /** Records a death mark. Called from the run's `enemy.died` handler. */
  markDeath(x: number, z: number, scale: number): void {
    const index = this.deathMarkCursor;
    this.deathMarkCursor = (this.deathMarkCursor + 1) % DEATH_MARK_CAPACITY;
    this.deathMarkX[index] = x;
    this.deathMarkZ[index] = z;
    this.deathMarkScale[index] = scale * (0.8 + (index % 5) * 0.09);
    this.deathMarkAge[index] = DEATH_MARK_SECONDS;
    if (this.deathMarkLive < DEATH_MARK_CAPACITY) this.deathMarkLive++;
  }

  private syncDeathMarks(dt: number): void {
    const mesh = this.deathMarks;
    if (!mesh || this.deathMarkLive === 0) return;

    let count = 0;
    for (let i = 0; i < DEATH_MARK_CAPACITY; i++) {
      if (this.deathMarkAge[i] <= 0) continue;
      this.deathMarkAge[i] -= dt;
      if (this.deathMarkAge[i] <= 0) continue;
      // Marks spread slightly and fade as they age, so a fresh kill reads apart
      // from one the march has already left behind.
      const life = this.deathMarkAge[i] / DEATH_MARK_SECONDS;
      const spread = this.deathMarkScale[i] * (1.35 - life * 0.35);
      this.position.set(this.deathMarkX[i], 0.03, this.deathMarkZ[i]);
      this.quaternion.setFromAxisAngle(UP, i * 1.37);
      this.scale.set(spread, 1, spread);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      mesh.setMatrixAt(count++, this.matrix);
    }
    mesh.count = count;
    if (count > 0) mesh.instanceMatrix.needsUpdate = true;
  }

  /** Enemy meshes never cast; the contact-shadow layer stands in for them. */
  private stripShadows(root: Object3D): void {
    root.traverse((child) => {
      const node = child as unknown as { castShadow?: boolean; receiveShadow?: boolean };
      if (node.castShadow !== undefined) node.castShadow = false;
      if (node.receiveShadow !== undefined) node.receiveShadow = false;
    });
  }

  private buildImpostors(): void {
    for (const archetype of ["minion", "warrior", "golem"]) {
      const geometry = this.forge.impostorGeometry(archetype);
      // The same lit material the articulated puppets use. A cheaper Lambert
      // shading model saved almost nothing here — impostors are three draw
      // calls for the whole rear horde — and cost a visible seam where distant
      // enemies read paler and flatter than near ones.
      const mesh = new InstancedMesh(
        geometry,
        this.forge.materials.surface,
        DIRECTOR.enemyPoolCapacity,
      );
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.name = `impostor.${archetype}`;
      this.impostors.set(archetype, mesh);
      this.impostorCounts.set(archetype, 0);
      this.root.add(mesh);
    }
  }

  private buildProjectiles(): void {
    // Warm, not white. A neutral-white rivet is the exact value of the bone
    // material it is flying at, so muzzle, tracer and impact have to share one
    // warm hue or the shot never reads as a causal chain.
    this.projectileMesh = new InstancedMesh(
      this.forge.projectileGeometry(),
      this.forge.materials.emissive(FEEDBACK.muzzle, 1.35),
      PERFORMANCE.projectilePoolCapacity,
    );
    this.projectileMesh.frustumCulled = false;
    this.projectileMesh.count = 0;
    this.projectileMesh.name = "projectiles";
    this.projectileMesh.instanceColor = new InstancedBufferAttribute(
      new Float32Array(PERFORMANCE.projectilePoolCapacity * 3),
      3,
    );
    this.root.add(this.projectileMesh);
  }

  private buildPickups(): void {
    for (const kind of [
      "scrap", "fuel", "cylinder", "repairKit", "pressureCanister",
      "shockMine", "armorPlate", "weaponPart",
    ]) {
      const geometry = this.forge.pickupGeometry(kind);
      if (!geometry) continue;
      const mesh = new InstancedMesh(
        geometry,
        this.forge.materials.surface,
        PERFORMANCE.pickupPoolCapacity,
      );
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.name = `pickup.${kind}`;
      this.pickupMeshes.set(kind, mesh);
      this.root.add(mesh);
    }

    // A glow disc under every pickup, coloured by resource. A scrap pile is a
    // ten-pixel prop at this camera height and reviewers could not find them
    // at all; the disc is what makes "there is something to collect over
    // there" answerable across the frame. One draw call for every pickup.
    const discGeometry = new CircleGeometry(0.5, 14);
    discGeometry.rotateX(-Math.PI / 2);
    this.pickupGlow = new InstancedMesh(
      discGeometry,
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        toneMapped: false,
        blending: AdditiveBlending,
        fog: false,
        vertexColors: false,
      }),
      PERFORMANCE.pickupPoolCapacity,
    );
    this.pickupGlow.instanceColor = new InstancedBufferAttribute(
      new Float32Array(PERFORMANCE.pickupPoolCapacity * 3),
      3,
    );
    this.pickupGlow.frustumCulled = false;
    this.pickupGlow.renderOrder = 2;
    this.pickupGlow.count = 0;
    this.pickupGlow.name = "pickupGlow";
    this.root.add(this.pickupGlow);
  }

  /**
   * World-space overlays: the service radius, relay radii and the placement
   * ghost. These are the only way the pressure network is visible, and the
   * whole leapfrog technique depends on the player being able to see where it
   * reaches, so they are drawn in the world rather than described in the HUD.
   */
  /**
   * A warm ring under the engineer.
   *
   * At this camera height the player is a two-metre figure on a screen showing
   * forty metres of ground, and during a horde he is one warm shape among a
   * hundred pale ones. The ring is the single cheapest fix for the first line
   * of the visual rubric - the player must be immediately distinguishable -
   * and it doubles as the read for the dodge cooldown and the tether strain.
   */
  private buildPlayerMarker(): void {
    // A filled disc under a bright ring. The disc is what actually wins the
    // search in a crowd - a thin outline gets lost among a hundred pale
    // silhouettes, while a solid warm pool under one figure does not.
    const ring = new RingGeometry(0.66, 0.92, 40);
    ring.rotateX(-Math.PI / 2);
    const disc = new CircleGeometry(0.66, 40);
    disc.rotateX(-Math.PI / 2);
    disc.scale(1, 1, 1);

    // The ring is depth-tested, so it lies on the ground and is occluded by
    // whatever is genuinely in front of it. An earlier version disabled depth
    // testing to survive the spider standing over the engineer, but that made
    // the ring paint itself onto the spider's deck - it stopped being hidden at
    // the cost of reporting the wrong position, which is worse. Occlusion is
    // handled by the pip below instead.
    this.playerMarker = new Mesh(
      ring,
      new MeshBasicMaterial({
        color: PLAYER_COLORS.glow,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        toneMapped: false,
        blending: AdditiveBlending,
        fog: false,
      }),
    );
    this.playerMarker.renderOrder = 2;
    this.playerMarker.frustumCulled = false;
    this.playerMarker.name = "playerMarker";

    const pool = new Mesh(
      disc,
      new MeshBasicMaterial({
        color: PLAYER_COLORS.glow,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        toneMapped: false,
        blending: AdditiveBlending,
        fog: false,
      }),
    );
    pool.renderOrder = 1;
    pool.frustumCulled = false;
    pool.name = "playerMarkerPool";
    this.playerMarker.add(pool);
    this.root.add(this.playerMarker);

    // A small pip floating above the engineer's head, drawn on top of
    // everything. §25 names "the spider covering the player" as a known risk of
    // this camera. A pip at a fixed height answers "the player is over there"
    // without claiming to be on the ground, so it never contradicts the ring.
    const pipGeometry = new ConeGeometry(0.42, 0.66, 4);
    pipGeometry.rotateX(Math.PI);
    this.playerPip = new Mesh(
      pipGeometry,
      new MeshBasicMaterial({
        color: PLAYER_COLORS.silhouette,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
    );
    this.playerPip.renderOrder = 30;
    this.playerPip.frustumCulled = false;
    this.playerPip.name = "playerPip";
    this.root.add(this.playerPip);
  }

  private buildOverlays(): void {
    this.buildPlayerMarker();
    // The defended-zone boundary is the primary spatial constraint on every
    // placement decision, and as an additive hairline it measured about 2:1
    // against the ground. Thicker and hue-stable, so it reads as a boundary.
    const serviceGeometry = new RingGeometry(1, 1.1, 96);
    serviceGeometry.rotateX(-Math.PI / 2);
    this.serviceRing = new Mesh(serviceGeometry, this.forge.materials.ringDecal(FEEDBACK.network));
    this.serviceRing.renderOrder = 3;
    this.serviceRing.frustumCulled = false;
    this.root.add(this.serviceRing);

    const ghostRingGeometry = new RingGeometry(0.92, 1, 48);
    ghostRingGeometry.rotateX(-Math.PI / 2);
    this.ghostRing = new Mesh(ghostRingGeometry, this.forge.materials.ringDecal(FEEDBACK.valid));
    this.ghostRing.renderOrder = 4;
    this.ghostRing.visible = false;
    this.ghostRing.frustumCulled = false;
    this.root.add(this.ghostRing);

    // Coverage preview. Placement is the game's signature interaction and its
    // whole question is "will this reach the thing I am worried about" — which
    // the player cannot answer from a footprint marker. The disc answers it
    // before the scrap is spent.
    // Subordinate by weight, not by dimness.
    //
    // The shared additive material once made this the brightest thing in the
    // frame, swamping the decision it exists to inform. Dimming it to 0.3 fixed
    // that and overshot: measured against the ground it came in at 1.6-1.8:1,
    // under the 3:1 floor for a non-text element, so the answer to "will this
    // turret reach?" was there and unreadable. It is now a thin but properly
    // opaque line - narrow enough to stay quiet, solid enough to see.
    const coverageGeometry = new RingGeometry(0.985, 1, 96);
    coverageGeometry.rotateX(-Math.PI / 2);
    this.ghostCoverageMaterial = new MeshBasicMaterial({
      color: FEEDBACK.valid,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.ghostCoverage = new Mesh(coverageGeometry, this.ghostCoverageMaterial);
    this.ghostCoverage.renderOrder = 3;
    this.ghostCoverage.visible = false;
    this.ghostCoverage.frustumCulled = false;
    this.root.add(this.ghostCoverage);
  }

  buildSegment(world: GameWorld): void {
    this.terrain.build(world);
  }

  // -------------------------------------------------------------------------
  // Per-frame sync
  // -------------------------------------------------------------------------

  sync(world: GameWorld, alpha: number, dt: number): void {
    this.clock += dt;
    // The contact-shadow layer is shared by the player, the structures and the
    // horde, so its counter is reset here and committed at the end rather than
    // inside any one of them.
    this.contactShadowCount = 0;
    this.syncPlayer(world, alpha, dt);
    this.syncSpider(world, alpha, dt);
    this.syncStructures(world, dt);
    this.syncEnemies(world, alpha, dt);
    this.syncProjectiles(world, alpha);
    this.syncPickups(world);
    this.syncDeathMarks(dt);
    this.syncOverlays(world);

    if (this.contactShadows) {
      this.contactShadows.count = this.contactShadowCount;
      if (this.contactShadowCount > 0) this.contactShadows.instanceMatrix.needsUpdate = true;
    }
  }

  private syncPlayer(world: GameWorld, alpha: number, dt: number): void {
    const rig = this.playerRig;
    if (!rig) return;
    const player = world.player;

    rig.root.position.set(
      lerp(player.prevX, player.x, alpha),
      0,
      lerp(player.prevZ, player.z, alpha),
    );
    rig.root.rotation.y = lerpAngle(player.prevHeading, player.heading, alpha);
    rig.root.visible = !player.downed || Math.sin(this.clock * 18) > 0;

    const speed = Math.hypot(player.velocityX, player.velocityZ);
    const carrying = player.carry.kind !== "none";
    if (this.weaponKind !== player.currentWeapon) {
      this.weaponKind = player.currentWeapon;
      const index = player.currentWeapon === "shotgun" ? 0
        : player.currentWeapon === "carbine" ? 1
        : player.currentWeapon === "rifle" ? 2
        : player.currentWeapon === "flamer" ? 3
        : player.currentWeapon === "arc" ? 4
        : 5;
      for (let i = 0; i < this.weaponVisuals.length; i++) this.weaponVisuals[i].visible = i === index;
    }

    if (player.animState === "dodge" && this.playerState.action !== "dodge") {
      playAction(this.playerState, "dodge", 0.28);
    } else if (player.actionKind !== null && this.playerState.action === "none") {
      playAction(this.playerState, "work", 0.6);
    }

    animateHumanoid(rig, this.playerState, dt, speed, 5.5, carrying);
    this.syncCarried(world);

    if (this.playerMarker) {
      this.playerMarker.position.set(rig.root.position.x, 0.045, rig.root.position.z);
      // The ring reddens and tightens as the tether strains, so straying too
      // far is legible before the pull-back punishes it.
      const strain = player.tetherStrain;
      const pulse = 1 + Math.sin(this.clock * 3.4) * 0.035 + strain * 0.25;
      this.playerMarker.scale.setScalar(pulse);
      const material = this.playerMarker.material as MeshBasicMaterial;
      const tint =
        strain > 0.6 ? FEEDBACK.invalid : strain > 0.2 ? FEEDBACK.warningPulse : PLAYER_COLORS.glow;
      material.color.setHex(tint);
      this.playerMarker.visible = !player.downed;

      if (this.playerPip) {
        // The pip must clear the spider's hull, not the engineer's head. The
        // whole reason it exists is the moment the player is standing *under*
        // the machine, and a pip at head height is then inside it. Depth
        // testing is off, but sitting it above the hull also keeps it from
        // reading as a decal stuck to the deck.
        this.playerPip.position.set(
          rig.root.position.x,
          PIP_HEIGHT + Math.sin(this.clock * 3.4) * 0.1,
          rig.root.position.z,
        );
        this.playerPip.rotation.y = this.clock * 1.1;
        (this.playerPip.material as MeshBasicMaterial).color.setHex(tint);
        this.playerPip.visible = !player.downed;
      }
    }
  }

  /** Shows what the engineer is physically holding. One object, always. */
  private syncCarried(world: GameWorld): void {
    const carry = world.player.carry;
    const wanted = carry.kind === "structure" ? `structure:${carry.structureType}` : carry.kind;

    if (wanted === this.carriedKind) return;
    if (this.carriedVisual) {
      this.carriedVisual.removeFromParent();
      this.carriedVisual = null;
    }
    this.carriedKind = wanted;
    if (carry.kind === "none" || !this.playerCarryNode) return;

    this.carriedVisual =
      carry.kind === "cylinder"
        ? this.forge.createPickup("cylinder", false)
        : this.forge.createFoldedStructure(carry.structureType);
    if (this.carriedVisual) {
      this.carriedVisual.position.set(0.1, 0.25, 0.35);
      this.playerCarryNode.add(this.carriedVisual);
    }
  }

  private syncSpider(world: GameWorld, alpha: number, dt: number): void {
    const rig = this.spiderRig;
    if (!rig) return;
    const spider = world.spider;

    rig.root.position.set(
      lerp(spider.prevX, spider.x, alpha),
      0,
      lerp(spider.prevZ, spider.z, alpha),
    );
    rig.root.rotation.y = lerpAngle(spider.prevHeading, spider.heading, alpha);

    // "The core is cold" is what the defeat screen says, so the machine has to
    // actually go cold behind it. The furnace is the spider's only state light
    // and killing it is the whole in-world consequence of losing.
    const dead = world.spider.coreHealth <= 0;
    const heat = dead
      ? 0
      : spider.fuel > 0
        ? clamp(0.35 + (spider.fuel / spider.maxFuel) * 0.65, 0, 1)
        : 0.12;
    animateSpider(
      rig,
      dt,
      spider.speed,
      spider.speedMode === "overdrive",
      spider.docked || dead,
      heat,
    );
  }

  private syncStructures(world: GameWorld, dt: number): void {
    for (let i = 0; i < world.structures.length; i++) {
      const structure = world.structures[i];
      let visual = this.structureVisuals.get(structure.id);
      if (!visual) {
        visual = this.createStructureVisual(structure);
        this.structureVisuals.set(structure.id, visual);
      }
      this.updateStructureVisual(visual, structure, world, dt);
      this.pushContactShadow(structure.x, structure.z, getBlueprint(structure.kind).radius * 2.6);
    }

    // Anything the simulation dropped is torn down here rather than by the
    // simulation, so the sim never has to know a scene graph exists.
    for (const [id, visual] of this.structureVisuals) {
      if (world.findStructure(id)) continue;
      if (visual.batched) this.structureBatch?.release(visual.batchIds);
      visual.root.removeFromParent();
      visual.ring.removeFromParent();
      visual.ring.geometry.dispose();
      visual.track.removeFromParent();
      visual.track.geometry.dispose();
      this.structureVisuals.delete(id);
    }
  }

  private createStructureVisual(structure: Structure): StructureVisual {
    let root: Object3D;
    let turret: TurretRig | null = null;
    let gauge: Object3D | null = null;

    switch (structure.kind) {
      case "rivetTurret": {
        turret = this.forge.createTurret();
        captureTurretRest(turret);
        root = turret.root;
        gauge = turret.gauge;
        break;
      }
      case "crawlerTurret": {
        turret = this.forge.createCrawlerTurret();
        captureTurretRest(turret);
        root = turret.root;
        gauge = turret.gauge;
        break;
      }
      case "relay": {
        const relay = this.forge.createRelay();
        root = relay.root;
        gauge = relay.gauge;
        break;
      }
      case "mine": {
        const mine = this.forge.createMine();
        root = mine.root;
        gauge = mine.light;
        break;
      }
      default:
        root = this.forge.createBarricade();
        break;
    }

    root.position.set(structure.x, 0, structure.z);
    root.rotation.y = structure.heading;
    // Structures are ~8 meshes each and the shadow pass redraws every one, so a
    // six-machine field cost about 48 extra draw calls and pushed the frame past
    // its ceiling. They are grounded by their state ring and a contact disc
    // instead, exactly as the horde is.
    this.stripShadows(root);

    // And, like the horde, they are batched: the hierarchy is kept only as an
    // animation rig and its resolved matrices are pushed into a single
    // BatchedMesh. Adding the countdown arc and the pickup glows took the frame
    // to 186 calls against a 180 ceiling; this is what buys the headroom back.
    const batchIds: number[] = [];
    const batched = this.structureBatch?.acquireRoot(root, batchIds) ?? false;
    if (!batched) this.root.add(root);

    // A turret is a thirty-pixel object among a hundred skeletons, and finding
    // one in order to service it is the game's central verb. The ring is what
    // makes it findable, and it carries the structure's state in its colour, so
    // "which of my machines needs me" is answerable from across the screen
    // without reading a single number.
    // Two rings: a dim full circle as the track, and a bright arc over it whose
    // sweep is the remaining service time. Colour alone told the player *that*
    // a machine was starving but never *how long* it had — and "how long" is
    // the number the whole leapfrog decision turns on.
    const blueprint = getBlueprint(structure.kind);
    const radius = Math.max(1.1, blueprint.radius * 1.55);

    const trackGeometry = new RingGeometry(0.98, 1.16, 40);
    trackGeometry.rotateX(-Math.PI / 2);
    const track = new Mesh(trackGeometry, this.forge.materials.ringDecal(FEEDBACK.networkDim));
    track.renderOrder = 2;
    track.frustumCulled = false;
    track.name = `structureTrack.${structure.kind}`;
    track.scale.setScalar(radius);
    this.root.add(track);

    // thetaLength is rewritten each frame, so the arc needs its own geometry.
    const ringGeometry = new RingGeometry(0.94, 1.22, 44, 1, Math.PI * 0.5, Math.PI * 2);
    ringGeometry.rotateX(-Math.PI / 2);
    const ring = new Mesh(ringGeometry, this.forge.materials.ringDecal(FEEDBACK.valid));
    ring.renderOrder = 3;
    ring.frustumCulled = false;
    ring.name = `structureRing.${structure.kind}`;
    ring.scale.setScalar(radius);
    this.root.add(ring);

    return {
      id: structure.id,
      kind: structure.kind,
      root,
      turret,
      gauge,
      ring,
      track,
      ringSweep: -1,
      ventTimer: 0,
      fusePhase: 0,
      recoil: 0,
      folded: 0,
      batchIds,
      batched,
    };
  }

  private updateStructureVisual(
    visual: StructureVisual,
    structure: Structure,
    world: GameWorld,
    dt: number,
  ): void {
    visual.recoil = Math.max(0, visual.recoil - dt * 7);
    visual.root.rotation.y = structure.heading;
    if (structure.shotsFired !== visual.root.userData.lastShots) {
      visual.root.userData.lastShots = structure.shotsFired;
      visual.recoil = 1;
    }

    const deploying = structure.state === "deploying";
    const deployProgress = deploying
      ? clamp(1 - structure.stateTimer / Math.max(0.001, STRUCTURES[structure.kind].deployTime), 0, 1)
      : 1;
    const deployScale = lerp(0.35, 1, easeOutBack(deployProgress));

    // Recovery is one of the game's four verbs and had no animation at all: the
    // fold was fully implemented in `animateTurret` and every caller passed a
    // literal 0. Rising follows the real progress; falling is eased over about
    // a quarter second so an abandoned recovery reads as the machine springing
    // back open rather than as a frame of teleporting.
    const fold = foldProgress(world, structure);
    visual.folded =
      fold > visual.folded ? fold : Math.max(fold, visual.folded - dt * UNFOLD_RATE);

    if (visual.turret) {
      animateTurret(
        visual.turret,
        structure.turretHeading - structure.heading,
        visual.recoil,
        visual.folded,
        deployScale,
      );
    } else {
      // The relay folds too and has no turret rig to carry it, so the squash is
      // applied here. For the anchored kinds `folded` is always 0.
      visual.root.scale.set(
        deployScale,
        deployScale * lerp(1, 0.55, visual.folded),
        deployScale,
      );
    }

    if (visual.gauge) {
      // The gauge is the only readout of a structure's remaining autonomy that
      // is visible from the play camera, so it encodes two things at once:
      // height is how much buffer is left, colour is whether it is refilling.
      const fraction = structure.kind === "crawlerTurret"
        ? structure.health / Math.max(1, structure.maxHealth)
        : structure.maxBuffer > 0 ? structure.buffer / structure.maxBuffer : 1;
      const overloading = structure.state === "overloading";
      visual.gauge.scale.y = clamp(fraction, 0.05, 1);

      this.tempColor.setHex(
        overloading
          ? FEEDBACK.lastShot
          : structure.powered
            ? FEEDBACK.network
            : fraction < 0.25
              ? FEEDBACK.invalid
              : FEEDBACK.unpowered,
      );
      // A starved turret pulses; a supplied one is steady. Motion is what the
      // eye catches first in a busy frame.
      const pulse = overloading
        ? 0.55 + 0.45 * Math.sin(this.clock * 22)
        : structure.powered
          ? 1
          : 0.65 + 0.35 * Math.sin(this.clock * 5);
      applyGaugeColor(visual.gauge, this.tempColor, pulse);
    }

    if (structure.state === "overloading") {
      // Everything escalates together as the fuse runs down: the jitter, the
      // swell, and the rate of both. A machine tearing itself apart should be
      // unmistakable from across a busy screen.
      const total = Math.max(0.001, getStructureConfig(structure.kind).lastShotDuration);
      const urgency = clamp(1 - structure.stateTimer / total, 0, 1);
      const rate = 26 + urgency * 46;
      const amplitude = 0.03 + urgency * 0.11;
      visual.root.position.set(
        structure.x + Math.sin(this.clock * rate) * amplitude,
        0,
        structure.z + Math.cos(this.clock * rate * 1.31) * amplitude * 0.8,
      );
      visual.root.scale.multiplyScalar(1 + urgency * 0.14 + Math.sin(this.clock * rate) * 0.04);

      // Venting steam, accelerating. This is the one cue that reads even when
      // the ring is behind the spider's leg.
      visual.ventTimer -= dt;
      if (visual.ventTimer <= 0) {
        visual.ventTimer = 0.16 - urgency * 0.11;
        this.vfx?.overloadVent(structure.x, structure.z, urgency);
      }
    } else {
      visual.root.position.set(structure.x, 0, structure.z);
      visual.ventTimer = 0;
    }

    this.updateStructureRing(visual, structure, dt);

    // The hierarchy is not in the scene when batched, so its animated pose only
    // reaches the screen through here.
    if (visual.batched) {
      this.structureBatch?.updateRoot(visual.root, visual.batchIds, true);
    }
  }

  /**
   * The ring is the structure's state readout at play distance.
   *
   * Colour answers "does this need me": cyan is served by the network, amber is
   * running on its own buffer, red is dry. An overloading machine gets a fast
   * red pulse and an expanding radius, which is the only reading of Last Shot
   * that survives a screen with a hundred enemies on it.
   */
  private updateStructureRing(
    visual: StructureVisual,
    structure: Structure,
    dt: number,
  ): void {
    const ring = visual.ring;
    const track = visual.track;
    ring.position.set(structure.x, 0.05, structure.z);
    track.position.set(structure.x, 0.048, structure.z);

    const fraction = structure.kind === "crawlerTurret"
      ? clamp(structure.health / Math.max(1, structure.maxHealth), 0, 1)
      : structure.maxBuffer > 0 ? clamp(structure.buffer / structure.maxBuffer, 0, 1) : 1;
    const base = Math.max(1.1, getBlueprint(structure.kind).radius * 1.55);

    if (structure.state === "destroyed") {
      ring.visible = false;
      track.visible = false;
      return;
    }

    if (structure.state === "overloading") {
      // The arc is the fuse. Sweeping it down over the overload duration turns
      // Last Shot from "a machine tinted red" into a countdown the player can
      // act on — the whole point of the verb is deciding when to walk away.
      const total = Math.max(0.001, getStructureConfig(structure.kind).lastShotDuration);
      const remaining = clamp(structure.stateTimer / total, 0, 1);
      // Pulse frequency doubles as the fuse runs out.
      const urgency = 1 - remaining;
      visual.fusePhase = (visual.fusePhase + (10 + urgency * 22) * dt) % (Math.PI * 2);
      const beat = 0.5 + 0.5 * Math.sin(visual.fusePhase);
      ring.material = this.forge.materials.ringDecal(
        beat > 0.5 ? FEEDBACK.explosionCore : FEEDBACK.lastShot,
      );
      ring.scale.setScalar(base * (1.3 + urgency * 0.8 + beat * 0.18));
      ring.visible = true;
      track.visible = true;
      track.scale.setScalar(base * (1.3 + urgency * 0.8));
      this.setRingSweep(visual, remaining);
      return;
    }

    // A recovery in progress. Both rings used to be hidden outright for the
    // whole fold, which left the one hold the player stands still and exposed
    // for with no readout of any kind. The arc runs down as the machine closes
    // and the radius draws in toward it, so "this is being packed up, and how
    // much of it is left" is answerable without reading a number. Ranked below
    // the fuse: a machine lit as a Last Shot is not being recovered.
    if (visual.folded > 0) {
      const closing = base * lerp(1, 0.45, visual.folded);
      ring.visible = true;
      track.visible = true;
      ring.scale.setScalar(closing);
      track.scale.setScalar(closing);
      ring.material = this.forge.materials.ringDecal(FEEDBACK.network);
      this.setRingSweep(visual, 1 - visual.folded);
      return;
    }

    ring.visible = true;
    ring.scale.setScalar(base);
    if (structure.kind === "crawlerTurret") {
      track.visible = true;
      track.scale.setScalar(base);
      this.setRingSweep(visual, fraction);
      ring.material = this.forge.materials.ringDecal(
        fraction > 0.5 ? FEEDBACK.network : fraction > 0.25 ? FEEDBACK.unpowered : FEEDBACK.invalid,
      );
      return;
    }
    // The track only exists to make a partial arc legible as partial, so it is
    // hidden for structures that have no buffer to report.
    track.visible = structure.maxBuffer > 0;

    if (structure.maxBuffer <= 0) {
      ring.material = this.forge.materials.ringDecal(FEEDBACK.networkDim);
      this.setRingSweep(visual, 1);
      return;
    }

    // A powered machine shows a full ring: it is being served, so there is no
    // countdown to read. An unpowered one shows exactly what it has left.
    this.setRingSweep(visual, structure.powered ? 1 : fraction);
    ring.material = this.forge.materials.ringDecal(
      structure.powered
        ? FEEDBACK.network
        : fraction > 0.25
          ? FEEDBACK.unpowered
          : FEEDBACK.invalid,
    );
  }

  /**
   * Rewrites the arc's sweep. Quantised to 48 steps so the geometry is rebuilt
   * only when the reading actually changes, rather than every frame for every
   * structure.
   */
  private setRingSweep(visual: StructureVisual, fraction: number): void {
    const quantised = Math.round(clamp(fraction, 0, 1) * 48);
    if (quantised === visual.ringSweep) return;
    visual.ringSweep = quantised;

    const sweep = (quantised / 48) * Math.PI * 2;
    const radius = visual.ring.scale.x;
    visual.ring.geometry.dispose();
    // Starts at the top and sweeps clockwise, which is how a countdown reads.
    const geometry = new RingGeometry(0.94, 1.22, 44, 1, Math.PI * 0.5 - sweep, sweep);
    geometry.rotateX(-Math.PI / 2);
    visual.ring.geometry = geometry;
    visual.ring.scale.setScalar(radius);
  }

  // -------------------------------------------------------------------------
  // Enemies
  // -------------------------------------------------------------------------

  private syncEnemies(world: GameWorld, alpha: number, dt: number): void {
    for (const count of this.impostorCounts.keys()) this.impostorCounts.set(count, 0);

    const backing = world.enemies.backing;

    this.rebalanceTimer -= dt;
    const rebalance = this.rebalanceTimer <= 0;
    if (rebalance) this.rebalanceTimer = 0.4;

    // Release puppets whose enemy has gone or moved out of the detailed LOD.
    // Previously the first enemies seen owned the limited rigs forever.
    for (let i = 0; i < this.enemyVisuals.length; i++) {
      const visual = this.enemyVisuals[i];
      if (visual.slot < 0) continue;
      const enemy = backing[visual.slot];
      if (
        enemy.active &&
        enemy.id === visual.enemyId &&
        (!rebalance || enemy.lodTier === 0)
      ) continue;
      this.releaseVisual(i);
    }

    for (let slot = 0; slot < backing.length; slot++) {
      const enemy = backing[slot];
      if (!enemy.active) continue;

      const visualIndex = this.slotToVisual[slot];
      if (visualIndex >= 0) {
        this.syncEnemyPuppet(this.enemyVisuals[visualIndex], enemy, alpha, dt);
      } else if (enemy.lodTier === 0 && this.bindVisual(slot, enemy)) {
        this.syncEnemyPuppet(this.enemyVisuals[this.slotToVisual[slot]], enemy, alpha, dt);
      } else {
        this.pushImpostor(enemy, slot, alpha, dt);
      }

      if (enemy.state !== "DEAD") {
        this.pushContactShadow(
          lerp(enemy.prevX, enemy.x, alpha),
          lerp(enemy.prevZ, enemy.z, alpha),
          enemy.radius * 2.3,
        );
      }
    }

    this.pushContactShadow(
      lerp(world.player.prevX, world.player.x, alpha),
      lerp(world.player.prevZ, world.player.z, alpha),
      1.05,
    );

    for (const [archetype, mesh] of this.impostors) {
      const count = this.impostorCounts.get(archetype) ?? 0;
      mesh.count = count;
      if (count > 0) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private pushContactShadow(x: number, z: number, diameter: number): void {
    const mesh = this.contactShadows;
    if (!mesh || this.contactShadowCount >= CONTACT_SHADOW_CAPACITY) return;
    this.position.set(x, 0.035, z);
    this.quaternion.identity();
    this.scale.set(diameter, 1, diameter);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    mesh.setMatrixAt(this.contactShadowCount++, this.matrix);
  }

  /**
   * Binds a puppet to an enemy. The rig is never added to the scene: it exists
   * only as an animation hierarchy whose resolved matrices are pushed into the
   * horde batch.
   */
  private bindVisual(slot: number, enemy: Enemy): boolean {
    const batch = this.hordeBatch;
    if (!batch) return false;
    const index = this.freeVisuals.pop();
    if (index === undefined) return false;
    const visual = this.enemyVisuals[index];

    visual.rig = this.forge.createEnemy(enemy.archetype);
    captureRigRest(visual.rig);
    visual.rig.root.userData.archetype = enemy.archetype;
    this.stripShadows(visual.rig.root);

    if (!batch.acquire(visual.rig, visual.batchIds)) {
      visual.rig = null;
      this.freeVisuals.push(index);
      return false;
    }

    visual.enemyId = enemy.id;
    visual.slot = slot;
    visual.state = createPuppetState(enemy.phase);
    if (enemy.spawnedVisible) playAction(visual.state, "awaken", 1.1);
    this.slotToVisual[slot] = index;
    return true;
  }

  private releaseVisual(index: number): void {
    const visual = this.enemyVisuals[index];
    if (visual.slot >= 0) this.slotToVisual[visual.slot] = -1;
    visual.slot = -1;
    visual.enemyId = -1;
    this.hordeBatch?.release(visual.batchIds);
    visual.rig = null;
    this.freeVisuals.push(index);
  }

  private syncEnemyPuppet(visual: EnemyVisual, enemy: Enemy, alpha: number, dt: number): void {
    const rig = visual.rig;
    if (!rig) return;

    rig.root.position.set(lerp(enemy.prevX, enemy.x, alpha), 0, lerp(enemy.prevZ, enemy.z, alpha));
    rig.root.rotation.y = lerpAngle(enemy.prevHeading, enemy.heading, alpha);

    if (enemy.state === "ATTACKING" && visual.state.action === "none") {
      playAction(visual.state, "attack", getArchetype(enemy.archetype).attackInterval * 0.72);
    } else if (enemy.state === "STAGGERED" && visual.state.action === "none") {
      playAction(visual.state, "hit", 0.35);
    } else if (enemy.state === "DEAD" && visual.state.action !== "death") {
      playAction(visual.state, "death", 0.9);
    }

    // Distant enemies animate on a stride but with a proportionally larger step,
    // so they still move smoothly rather than stuttering. The transform is
    // pushed every frame regardless, or a strided enemy would visibly lag its
    // own position.
    const stride = enemy.lodTier === 0 ? 1 : enemy.lodTier === 1 ? 2 : 4;
    if (stride === 1 || (this.frameParity + visual.slot) % stride === 0) {
      const speed = Math.hypot(enemy.velocityX, enemy.velocityZ);
      const archetype = getArchetype(enemy.archetype);
      animateHumanoid(rig, visual.state, dt * stride, speed, archetype.speed, false);
    }
    // Reapplied every frame, because the transform write above zeroed it and the
    // pose that set it may only be refreshed every second or fourth frame.
    rig.root.position.y = visual.state.rootY;

    // A hit shoves the body back along the shot and washes it white for a
    // moment. Both are brief and both are essential: without them a skeleton
    // absorbing a burst looks exactly like one standing idle.
    if (enemy.hitFlash > 0) {
      const t = clamp(enemy.hitFlash / HIT_FLASH_SECONDS, 0, 1);
      rig.root.position.x += enemy.hitDirX * t * 0.22;
      rig.root.position.z += enemy.hitDirZ * t * 0.22;
      this.tempColor.setRGB(1 + t * 2.2, 1 + t * 2.2, 1 + t * 1.9);
      if (visual.tinted !== 1) {
        this.hordeBatch?.tint(visual.batchIds, this.tempColor);
        visual.tinted = 1;
      } else {
        this.hordeBatch?.tint(visual.batchIds, this.tempColor);
      }
    } else if (visual.tinted !== 0) {
      this.tempColor.setRGB(1, 1, 1);
      this.hordeBatch?.tint(visual.batchIds, this.tempColor);
      visual.tinted = 0;
    }

    this.hordeBatch?.update(rig, visual.batchIds, true);
  }

  private frameParity = 0;

  private pushImpostor(enemy: Enemy, slot: number, alpha: number, dt: number): void {
    const mesh = this.impostors.get(enemy.archetype);
    if (!mesh) return;
    const index = this.impostorCounts.get(enemy.archetype) ?? 0;
    if (index >= mesh.instanceMatrix.count) return;

    // An impostor is a frozen stride pose with no joints, so its bob and lean
    // are all it has - and both are driven by the enemy's own speed, not by a
    // wall clock. A skeleton that has stopped to swing at a barricade stands
    // still; one sprinting in Pursuit bobs hard and leans into it.
    animateImpostor(
      this.impostorStates[slot],
      this.impostorPose,
      dt,
      Math.hypot(enemy.velocityX, enemy.velocityZ),
      getArchetype(enemy.archetype).speed,
      enemy.phase * TAU,
    );

    this.position.set(lerp(enemy.prevX, enemy.x, alpha), 0, lerp(enemy.prevZ, enemy.z, alpha));
    this.quaternion.setFromAxisAngle(UP, lerpAngle(enemy.prevHeading, enemy.heading, alpha));
    // Applied after the yaw, so the lean is about the body's own right axis and
    // therefore always forward whichever way the enemy faces.
    this.leanQuaternion.setFromAxisAngle(RIGHT, this.impostorPose.lean);
    this.quaternion.multiply(this.leanQuaternion);
    this.scale.set(1, this.impostorPose.squash, 1);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    mesh.setMatrixAt(index, this.matrix);
    this.impostorCounts.set(enemy.archetype, index + 1);
  }

  // -------------------------------------------------------------------------
  // Projectiles, pickups, overlays
  // -------------------------------------------------------------------------

  private syncProjectiles(world: GameWorld, alpha: number): void {
    const mesh = this.projectileMesh;
    if (!mesh) return;
    const backing = world.projectiles.backing;
    const colors = mesh.instanceColor!.array as Float32Array;
    let count = 0;

    for (let i = 0; i < backing.length; i++) {
      const projectile = backing[i];
      if (!projectile.active) continue;
      const x = lerp(projectile.prevX, projectile.x, alpha);
      const z = lerp(projectile.prevZ, projectile.z, alpha);
      this.position.set(x, projectile.y, z);
      this.quaternion.setFromAxisAngle(
        UP,
        Math.atan2(projectile.velocityX, projectile.velocityZ),
      );

      // A spent round at the end of its flight was rendering as brightly as one
      // just leaving the barrel, which is why three reviewers read the same
      // pellets as "tracers detached from any shooter floating in empty
      // ground". They were not orphans; they simply had no age. Fading with
      // remaining lifetime keeps the bright end of the streak near its muzzle,
      // where the causal chain is legible.
      const life = clamp(projectile.lifetime / PROJECTILE_FADE_SECONDS, 0, 1);
      const bright = 0.25 + life * 0.75;
      this.scale.set(1.15 * bright, 1.15 * bright, 6.5 * (0.55 + life * 0.45));
      this.matrix.compose(this.position, this.quaternion, this.scale);
      mesh.setMatrixAt(count, this.matrix);
      colors[count * 3] = bright;
      colors[count * 3 + 1] = bright;
      colors[count * 3 + 2] = bright;
      count++;
    }

    mesh.count = count;
    if (count > 0) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    }
  }

  private syncPickups(world: GameWorld): void {
    for (const mesh of this.pickupMeshes.values()) mesh.count = 0;
    const counts = new Map<string, number>();
    const backing = world.pickups.backing;
    const glow = this.pickupGlow;
    const glowColors = glow ? (glow.instanceColor!.array as Float32Array) : null;
    let glowCount = 0;

    for (let i = 0; i < backing.length; i++) {
      const pickup = backing[i];
      if (!pickup.active) continue;
      const mesh = this.pickupMeshes.get(pickup.kind);
      if (!mesh) continue;
      const index = counts.get(pickup.kind) ?? 0;
      if (index >= mesh.instanceMatrix.count) continue;

      const bob = Math.sin(this.clock * 2.4 + pickup.phase * 6.283) * 0.08;
      this.position.set(pickup.x, 0.32 + bob, pickup.z);
      this.quaternion.setFromAxisAngle(UP, this.clock * 0.8 + pickup.phase * 6.283);
      const pop = pickup.attracted ? 1.18 : 1;
      // Consumables deliberately keep different profiles even at gameplay
      // camera height: low/wide plate, squat mine, tall parts, boxed kit.
      const profile = pickupProfile(pickup.kind);
      this.scale.set(profile[0] * pop, profile[1] * pop, profile[2] * pop);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      mesh.setMatrixAt(index, this.matrix);
      counts.set(pickup.kind, index + 1);

      if (glow && glowColors && glowCount < glow.instanceMatrix.count) {
        // Breathes gently, and brightens as it is drawn to the player, so the
        // magnet's pull is legible as well as felt.
        const breathe = 0.85 + Math.sin(this.clock * 3 + pickup.phase * 6.283) * 0.15;
        const size = (pickup.attracted ? 1.9 : 1.45) * breathe;
        this.position.set(pickup.x, 0.045, pickup.z);
        this.quaternion.identity();
        this.scale.set(size, 1, size);
        this.matrix.compose(this.position, this.quaternion, this.scale);
        glow.setMatrixAt(glowCount, this.matrix);
        this.tempColor.setHex(pickupGlowColor(pickup.kind));
        const gain = pickup.attracted ? 1.6 : 1;
        glowColors[glowCount * 3] = this.tempColor.r * gain;
        glowColors[glowCount * 3 + 1] = this.tempColor.g * gain;
        glowColors[glowCount * 3 + 2] = this.tempColor.b * gain;
        glowCount++;
      }
    }

    for (const [kind, mesh] of this.pickupMeshes) {
      const count = counts.get(kind) ?? 0;
      mesh.count = count;
      if (count > 0) mesh.instanceMatrix.needsUpdate = true;
    }

    if (glow) {
      glow.count = glowCount;
      if (glowCount > 0) {
        glow.instanceMatrix.needsUpdate = true;
        glow.instanceColor!.needsUpdate = true;
      }
    }
  }

  private syncOverlays(world: GameWorld): void {
    this.frameParity = (this.frameParity + 1) & 3;

    if (this.serviceRing) {
      const radius = world.spider.serviceRadius * world.modifiers.serviceRadius;
      this.serviceRing.position.set(world.spider.x, 0.06, world.spider.z);
      this.serviceRing.scale.setScalar(radius);
      const material = this.serviceRing.material as { opacity: number };
      // The ring brightens as the spider runs dry, because that is exactly when
      // the player needs to notice the network is about to go down.
      const fuelFraction = world.spider.fuel / world.spider.maxFuel;
      material.opacity = world.spider.fuel <= 0 ? 0.08 : lerp(0.42, 0.16, fuelFraction);
      this.serviceRing.visible = true;
    }

    this.syncRelayRings(world);
    this.syncGhost(world);
  }

  private syncRelayRings(world: GameWorld): void {
    let used = 0;
    for (let i = 0; i < world.structures.length; i++) {
      const structure = world.structures[i];
      if (structure.kind !== "relay" || !structure.powered) continue;
      let ring = this.relayRings[used];
      if (!ring) {
        const geometry = new RingGeometry(0.985, 1, 72);
        geometry.rotateX(-Math.PI / 2);
        ring = new Mesh(geometry, this.forge.materials.ringDecal(FEEDBACK.networkDim));
        ring.renderOrder = 3;
        ring.frustumCulled = false;
        this.relayRings.push(ring);
        this.root.add(ring);
      }
      ring.visible = true;
      ring.position.set(structure.x, 0.05, structure.z);
      ring.scale.setScalar(STRUCTURES.relay.range);
      used++;
    }
    for (let i = used; i < this.relayRings.length; i++) this.relayRings[i].visible = false;
  }

  private syncGhost(world: GameWorld): void {
    const build = world.build;
    if (!build.ghostActive || !build.ghostKind) {
      if (this.ghost) this.ghost.visible = false;
      if (this.ghostRing) this.ghostRing.visible = false;
      if (this.ghostCoverage) this.ghostCoverage.visible = false;
      return;
    }

    if (!this.ghost || this.ghost.userData.kind !== build.ghostKind) {
      if (this.ghost) this.ghost.removeFromParent();
      this.ghost = this.forge.createGhost(build.ghostKind);
      this.ghost.userData.kind = build.ghostKind;
      this.root.add(this.ghost);
    }

    const color =
      build.ghostValidity === "valid"
        ? FEEDBACK.valid
        : build.ghostValidity === "unpowered"
          ? FEEDBACK.unpowered
          : FEEDBACK.invalid;

    this.ghost.visible = true;
    this.ghost.position.set(build.ghostX, 0, build.ghostZ);
    this.ghost.rotation.y = build.ghostHeading;
    // Swap in the cached ghost material for this validity rather than recolour
    // it: the library shares materials by colour, so mutating one would repaint
    // every other ghost-coloured surface in the scene.
    setGhostMaterial(this.ghost, this.forge.materials.ghost(color));

    if (this.ghostRing) {
      this.ghostRing.visible = true;
      this.ghostRing.position.set(build.ghostX, 0.07, build.ghostZ);
      const pulse = 1 + Math.sin(this.clock * 6) * 0.04;
      this.ghostRing.scale.setScalar(1.3 * pulse);
      // The ring shares one additive material per colour with the VFX pool, so
      // the colour is chosen by swapping materials rather than by mutating one.
      this.ghostRing.material = this.forge.materials.ringDecal(color);
    }

    if (this.ghostCoverage) {
      const range = getStructureConfig(build.ghostKind).range;
      if (range > 0) {
        this.ghostCoverage.visible = true;
        this.ghostCoverage.position.set(build.ghostX, 0.055, build.ghostZ);
        this.ghostCoverage.scale.setScalar(range);
        this.ghostCoverageMaterial?.color.setHex(color);
      } else {
        // A barricade has no reach to preview; showing a zero-radius ring would
        // only claim something false.
        this.ghostCoverage.visible = false;
      }
    }
  }

  // -------------------------------------------------------------------------

  dispose(): void {
    this.terrain.dispose();
    this.root.removeFromParent();
    this.hordeBatch?.dispose();
    this.structureBatch?.dispose();
    this.deathMarks?.geometry.dispose();
    (this.deathMarks?.material as Material | undefined)?.dispose();
    this.deathMarks?.dispose();
    this.contactShadows?.geometry.dispose();
    (this.contactShadows?.material as Material | undefined)?.dispose();
    this.contactShadows?.dispose();
    for (const mesh of this.impostors.values()) mesh.dispose();
    for (const mesh of this.pickupMeshes.values()) mesh.dispose();
    this.pickupGlow?.geometry.dispose();
    (this.pickupGlow?.material as Material | undefined)?.dispose();
    this.pickupGlow?.dispose();
    this.projectileMesh?.dispose();
    for (const ring of this.relayRings) {
      ring.geometry.dispose();
    }
    this.serviceRing?.geometry.dispose();
    this.ghostRing?.geometry.dispose();
    this.ghostCoverage?.geometry.dispose();
  }
}

const UP = new Vector3(0, 1, 0);
/** Local right axis, about which a running impostor pitches forward. */
const RIGHT = new Vector3(1, 0, 0);

function lerpAngle(from: number, to: number, alpha: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * alpha;
}

/**
 * How far through recovery a machine is, 0..1.
 *
 * Two sources, because the simulation splits the verb across two owners. The
 * player holds the recover button for `PLAYER.foldDuration`, and only when that
 * hold completes does the structure enter `folding` - and `beginFold` currently
 * calls `completeFold` on the same tick, so that state lasts zero seconds and
 * the whole visible fold is the hold. The state is still read first, because it
 * is the authoritative source the moment the simulation gives it a duration,
 * and because `stateTimer` against the per-kind `foldTime` is what a recovery
 * driven by anything other than a button press would use.
 */
function foldProgress(world: GameWorld, structure: Structure): number {
  if (structure.state === "dropped") return 1;
  if (structure.state === "folding") {
    const total = Math.max(0.001, STRUCTURES[structure.kind].foldTime);
    return clamp(1 - structure.stateTimer / total, 0, 1);
  }
  // A machine that has been lit as a Last Shot is no longer being recovered,
  // however the button that was down when it happened is resolved: the fuse is
  // the only thing that may own its presentation from then on.
  if (structure.state === "overloading" || structure.state === "destroyed") return 0;

  const player = world.player;
  if (player.actionKind !== "fold" || player.actionTargetId !== structure.id) return 0;
  const hold = PLAYER.foldDuration / Math.max(0.001, world.modifiers.foldSpeed);
  return clamp(player.actionProgress / hold, 0, 1);
}

function easeOutBack(t: number): number {
  const c = 1.9;
  const inv = t - 1;
  return 1 + (c + 1) * inv * inv * inv + c * inv * inv;
}

/** Points every mesh in the ghost subtree at one shared translucent material. */
function setGhostMaterial(root: Object3D, material: Material): void {
  root.traverse((child) => {
    const holder = child as unknown as { material?: Material };
    if (holder.material) holder.material = material;
  });
}

/**
 * Applies a colour to a gauge wrapper's meshes. Gauges own private emissive
 * materials, so writing to them is safe; the wrapper itself is a plain
 * Object3D that exists only to give the render layer a scale pivot.
 */
function applyGaugeColor(gauge: Object3D, color: Color, brightness: number): void {
  for (let i = 0; i < gauge.children.length; i++) {
    const material = (gauge.children[i] as unknown as { material?: { color?: Color } }).material;
    if (!material?.color) continue;
    material.color.copy(color).multiplyScalar(brightness);
  }
}

function pickupProfile(kind: PickupKind): readonly [number, number, number] {
  switch (kind) {
    case "repairKit": return [1.25, 0.72, 0.9];
    case "pressureCanister": return [0.9, 1.35, 0.9];
    case "shockMine": return [1.4, 0.48, 1.4];
    case "armorPlate": return [1.45, 0.42, 0.78];
    case "weaponPart": return [0.7, 1.55, 0.7];
    default: return [1, 1, 1];
  }
}

function pickupGlowColor(kind: PickupKind): number {
  switch (kind) {
    case "fuel":
    case "pressureCanister": return FEEDBACK.fuel;
    case "repairKit": return 0x65e87b;
    case "shockMine": return 0x72cfff;
    case "armorPlate": return 0x8db4d8;
    case "weaponPart": return 0xd879ff;
    default: return FEEDBACK.scrap;
  }
}

/** Squared-distance helper kept here so the sort in rebalancing stays cheap. */
export function visualPriority(enemy: Enemy, focusX: number, focusZ: number): number {
  return distSq(enemy.x, enemy.z, focusX, focusZ);
}

export const SPIDER_BODY_HEIGHT = SPIDER.bodyHeight;
