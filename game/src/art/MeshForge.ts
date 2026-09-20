/**
 * The mesh forge: the single façade the rest of the game asks for visuals.
 *
 * Shared Blender geometry upgrades houses, enemies, guns and effects. Native
 * procedural models supply the other objects, distant enemies and a complete
 * fallback. Both paths keep chamfered low-poly forms, readable proportions,
 * flat-ish shading and vertex-colored palettes.
 *
 * `build` runs once at load and fills every geometry cache. After that the
 * create* methods only allocate Object3Ds and Meshes, because geometry and
 * materials are shared by every instance. That is what keeps a hundred and
 * thirty enemies, a dozen structures and a few thousand scatter props inside
 * the draw-call budget.
 */

import { Group, Mesh, RingGeometry } from "three";
import type { BufferGeometry, Object3D } from "three";
import { Random } from "../core/Random.ts";
import { BlenderLibrary, BLENDER_IDS } from "./BlenderLibrary.ts";
import { MaterialLibrary } from "./materials.ts";
import { buildRewardGeometry } from "./rewards.ts";
import { merge, place, vertexCount } from "./geometry.ts";
import {
  buildEngineer,
  buildEnemyImpostorGeometry,
  buildScattergun,
  buildGearburstCarbine,
  buildRivetRifle,
  buildSteamFlamer,
  buildArcProjector,
  buildMagneticLauncher,
  buildSkeletonAxe,
  buildSkeletonGolem,
  buildSkeletonMinion,
  buildSkeletonWarrior,
  buildWrench,
  characterCache,
  type PuppetRig,
} from "./characters.ts";
import {
  buildBarricade,
  buildCylinder,
  buildFoldedStructure,
  buildFuelBarrel,
  buildJerrycan,
  buildMine,
  buildProjectileGeometry,
  buildRelay,
  buildRivetTurret,
  buildCrawlerTurret,
  buildScrapPile,
  buildSpecialPickup,
  buildSpider,
  machineCache,
  type SpiderRig,
  type TurretRig,
} from "./machines.ts";
import {
  buildBareTreeGeometry,
  buildBushGeometry,
  buildCheckpointGeometry,
  buildGateGeometry,
  buildGrassTuftGeometry,
  buildMazeTowerGeometry,
  buildMazeArchGeometry,
  buildMazeWallGeometry,
  buildRuinedHouseGeometry,
  buildBridgeGeometry,
  buildRockGeometry,
  buildRuinPillarGeometry,
  buildScrapHeapGeometry,
  buildTreeGeometry,
} from "./environment.ts";

export type RelayRig = {
  root: Group;
  dish: Object3D;
  ring: Object3D;
  gauge: Object3D;
};

export type MineRig = {
  root: Group;
  light: Object3D;
};

type PropBuilder = (variant: number, random: Random) => BufferGeometry;

/**
 * Scatter prop catalogue. Names are stable and the render layer keys its
 * InstancedMesh pool off them, so entries may be added but never renamed.
 */
const PROP_TABLE: ReadonlyArray<{ name: string; build: PropBuilder; variant: number }> = [
  { name: "treeConifer", build: buildTreeGeometry, variant: 0 },
  { name: "treeBroadleaf", build: buildTreeGeometry, variant: 1 },
  { name: "treeSpindle", build: buildTreeGeometry, variant: 2 },
  { name: "treeConiferB", build: buildTreeGeometry, variant: 3 },
  { name: "treeBroadleafB", build: buildTreeGeometry, variant: 4 },
  { name: "bareTree", build: buildBareTreeGeometry, variant: 0 },
  { name: "bareTreeB", build: buildBareTreeGeometry, variant: 1 },
  { name: "rock", build: buildRockGeometry, variant: 0 },
  { name: "rockB", build: buildRockGeometry, variant: 1 },
  { name: "rockC", build: buildRockGeometry, variant: 2 },
  { name: "bush", build: buildBushGeometry, variant: 0 },
  { name: "bushB", build: buildBushGeometry, variant: 1 },
  { name: "grass", build: buildGrassTuftGeometry, variant: 0 },
  { name: "grassB", build: buildGrassTuftGeometry, variant: 1 },
  { name: "grassC", build: buildGrassTuftGeometry, variant: 2 },
  { name: "mazeWall", build: buildMazeWallGeometry, variant: 0 },
  { name: "mazeTower", build: buildMazeTowerGeometry, variant: 0 },
  { name: "mazeArch", build: buildMazeArchGeometry, variant: 0 },
  { name: "ruinedHouse", build: buildRuinedHouseGeometry, variant: 0 },
  { name: "bridge", build: buildBridgeGeometry, variant: 0 },
  { name: "ruinPillar", build: buildRuinPillarGeometry, variant: 0 },
  { name: "ruinPillarB", build: buildRuinPillarGeometry, variant: 1 },
  { name: "ruinPillarC", build: buildRuinPillarGeometry, variant: 2 },
  { name: "scrapHeap", build: buildScrapHeapGeometry, variant: 0 },
  { name: "scrapHeapB", build: buildScrapHeapGeometry, variant: 1 },
];

/** Fixed seed: the prop set must be identical for every player and every run. */
const FORGE_SEED = 0x5cade7;

export class MeshForge {
  readonly materials = new MaterialLibrary();
  readonly propNames: readonly string[] = PROP_TABLE.map((entry) => entry.name);
  readonly stats = { geometries: 0, vertices: 0, materials: 0 };

  private readonly props = new Map<string, BufferGeometry>();
  /** Geometries merged on demand for instanced rendering; owned and disposed here. */
  private readonly mergedCache = new Map<string, BufferGeometry>();
  private gatePrototype: Group | null = null;
  private checkpointPrototype: Group | null = null;
  private built = false;
  private blender: BlenderLibrary | null = null;
  get blenderAssetCount(): number { return this.blender?.size ?? 0; }

  /** Install once before any render-layer geometry is bound to a batch. */
  installBlenderLibrary(library: BlenderLibrary): void {
    if (this.blender) throw new Error("Blender library already installed");
    this.blender = library;
    this.refreshStats();
  }

  async loadBlenderLibrary(): Promise<void> {
    const library = await BlenderLibrary.load();
    if (library) this.installBlenderLibrary(library);
  }

  effectGeometry(name: string): BufferGeometry | undefined {
    return this.blender?.get(`fx_${name}`);
  }

  /** Builds every shared geometry. Call once; progress is reported per stage. */
  build(onProgress?: (fraction: number, label: string) => void): void {
    if (this.built) return;
    this.built = true;

    const stages: Array<[string, () => void]> = [
      ["Forging the engineer", () => void buildEngineer(this.materials)],
      [
        "Forging tools",
        () => {
          buildWrench(this.materials);
          buildScattergun(this.materials);
          buildGearburstCarbine(this.materials);
          buildRivetRifle(this.materials);
          buildSteamFlamer(this.materials);
          buildArcProjector(this.materials);
          buildMagneticLauncher(this.materials);
          buildSkeletonAxe(this.materials);
        },
      ],
      [
        "Raising the dead",
        () => {
          buildSkeletonMinion(this.materials);
          buildSkeletonWarrior(this.materials);
          buildSkeletonGolem(this.materials);
          buildEnemyImpostorGeometry("minion");
          buildEnemyImpostorGeometry("warrior");
          buildEnemyImpostorGeometry("golem");
        },
      ],
      ["Assembling the spider", () => void buildSpider(this.materials)],
      [
        "Machining deployables",
        () => {
          buildRivetTurret(this.materials);
          buildCrawlerTurret(this.materials);
          buildRelay(this.materials);
          buildBarricade(this.materials);
          buildMine(this.materials);
          buildFoldedStructure(this.materials, "rivetTurret");
          buildFoldedStructure(this.materials, "relay");
          buildFoldedStructure(this.materials, "barricade");
          buildFoldedStructure(this.materials, "mine");
        },
      ],
      [
        "Stamping cargo",
        () => {
          buildCylinder(this.materials);
          buildJerrycan(this.materials);
          buildFuelBarrel(this.materials);
          buildScrapPile(this.materials, false);
          buildScrapPile(this.materials, true);
          buildProjectileGeometry();
        },
      ],
      ["Growing the corridor", () => this.buildProps()],
      [
        "Setting the landmarks",
        () => {
          this.gatePrototype = buildGateGeometry(this.materials);
          this.checkpointPrototype = buildCheckpointGeometry(this.materials);
        },
      ],
    ];

    for (let i = 0; i < stages.length; i++) {
      const [label, run] = stages[i];
      onProgress?.(i / stages.length, label);
      run();
    }

    this.refreshStats();
    onProgress?.(1, "Ready");
  }

  private buildProps(): void {
    const random = new Random(FORGE_SEED);
    for (let i = 0; i < PROP_TABLE.length; i++) {
      const entry = PROP_TABLE[i];
      this.props.set(entry.name, entry.build(entry.variant, random.fork(i * 7919)));
    }
  }

  private refreshStats(): void {
    let geometries = characterCache.geometries().length + machineCache.geometries().length;
    let vertices = characterCache.vertices() + machineCache.vertices();
    for (const id of BLENDER_IDS) {
      const geometry = this.blender?.get(id);
      if (geometry) { geometries++; vertices += vertexCount(geometry); }
    }
    for (const geometry of this.props.values()) {
      geometries++;
      vertices += vertexCount(geometry);
    }
    for (const prototype of [this.gatePrototype, this.checkpointPrototype]) {
      prototype?.traverse((node) => {
        const mesh = node as Mesh;
        if (!mesh.isMesh) return;
        geometries++;
        vertices += vertexCount(mesh.geometry as BufferGeometry);
      });
    }
    this.stats.geometries = geometries;
    this.stats.vertices = vertices;
    this.stats.materials = this.materials.count;
  }

  // -------------------------------------------------------------------------
  // Characters
  // -------------------------------------------------------------------------

  createEngineer(): PuppetRig {
    return buildEngineer(this.materials);
  }

  createEnemy(archetype: string): PuppetRig {
    const kind = archetype === "golem" ? "golem" : archetype === "warrior" || archetype === "necromancer" ? "warrior" : "minion";
    const rig = kind === "golem" ? buildSkeletonGolem(this.materials)
      : kind === "warrior" ? buildSkeletonWarrior(this.materials) : buildSkeletonMinion(this.materials);
    const joints: Array<[Object3D, string]> = [
      [rig.pelvis, "pelvis"], [rig.torso, "torso"], [rig.head, "head"],
      [rig.armL, "upperArm"], [rig.armR, "upperArm"],
      [rig.forearmL, "forearm"], [rig.forearmR, "forearm"],
      [rig.legL, "thigh"], [rig.legR, "thigh"], [rig.shinL, "shin"], [rig.shinR, "shin"],
    ];
    for (const [joint, part] of joints) {
      const geometry = this.blender?.get(`${kind}_${part}`);
      const mesh = joint.children.find((child) => (child as Mesh).isMesh) as Mesh | undefined;
      if (geometry && mesh) mesh.geometry = geometry;
    }
    return rig;
  }

  /** Single merged low-detail mesh geometry for distant enemies. */
  impostorGeometry(archetype: string): BufferGeometry {
    if (archetype === "golem") return buildEnemyImpostorGeometry("golem");
    if (archetype === "warrior" || archetype === "necromancer") return buildEnemyImpostorGeometry("warrior");
    return buildEnemyImpostorGeometry("minion");
  }

  createWrench(): Object3D {
    return buildWrench(this.materials);
  }

  createScattergun(): Object3D {
    return this.replaceGun(buildScattergun(this.materials), "shotgun");
  }

  createGearburstCarbine(): Object3D {
    return this.replaceGun(buildGearburstCarbine(this.materials), "carbine");
  }

  createRivetRifle(): Object3D {
    return this.replaceGun(buildRivetRifle(this.materials), "rifle");
  }

  createSteamFlamer(): Object3D {
    return this.replaceGun(buildSteamFlamer(this.materials), "flamer");
  }

  createArcProjector(): Object3D {
    return this.replaceGun(buildArcProjector(this.materials), "arc");
  }

  createMagneticLauncher(): Object3D {
    return this.replaceGun(buildMagneticLauncher(this.materials), "launcher");
  }

  private replaceGun(root: Object3D, kind: string): Object3D {
    const geometry = this.blender?.get(`gun_${kind}`);
    if (geometry) root.traverse((node) => { if ((node as Mesh).isMesh) (node as Mesh).geometry = geometry; });
    return root;
  }

  createSkeletonAxe(): Object3D {
    return buildSkeletonAxe(this.materials);
  }

  // -------------------------------------------------------------------------
  // Machines
  // -------------------------------------------------------------------------

  createSpider(): SpiderRig {
    return buildSpider(this.materials);
  }

  createTurret(): TurretRig {
    return buildRivetTurret(this.materials);
  }

  createCrawlerTurret(): TurretRig {
    return buildCrawlerTurret(this.materials);
  }

  createRelay(): RelayRig {
    return buildRelay(this.materials);
  }

  createBarricade(): Group {
    return buildBarricade(this.materials);
  }

  createMine(): MineRig {
    return buildMine(this.materials);
  }

  createFoldedStructure(kind: string): Group {
    return buildFoldedStructure(this.materials, kind);
  }

  /** `kind` accepts the PickupKind union plus "scrapLarge" and "fuelBarrel". */
  createPickup(kind: string, large: boolean): Group {
    if (["repairKit", "armorPlate", "shockMine", "weaponPart"].includes(kind)) {
      return buildSpecialPickup(this.materials, kind);
    }
    if (kind === "cylinder" || kind === "pressureCanister") return buildCylinder(this.materials);
    if (kind === "fuel" || kind === "fuelBarrel") {
      return large || kind === "fuelBarrel" ? buildFuelBarrel(this.materials) : buildJerrycan(this.materials);
    }
    return buildScrapPile(
      this.materials,
      large || kind === "scrapLarge" || kind === "armorPlate" || kind === "shockMine",
    );
  }

  // -------------------------------------------------------------------------
  // Environment
  // -------------------------------------------------------------------------

  /** Shared geometry for InstancedMesh use. */
  propGeometry(name: string): BufferGeometry {
    const authored = this.blender?.get(name === "ruinedHouse" ? "house_cottage" : name);
    if (authored) return authored;
    if (name.startsWith("house_")) name = "ruinedHouse";
    const geometry = this.props.get(name);
    if (!geometry) throw new Error(`Unknown prop geometry: ${name}`);
    return geometry;
  }

  createGate(): Group {
    if (!this.gatePrototype) throw new Error("MeshForge.build() must run before createGate()");
    return this.gatePrototype.clone(true);
  }

  createCheckpoint(): Group {
    if (!this.checkpointPrototype) throw new Error("MeshForge.build() must run before createCheckpoint()");
    return this.checkpointPrototype.clone(true);
  }

  projectileGeometry(): BufferGeometry {
    return buildProjectileGeometry();
  }

  // -------------------------------------------------------------------------
  // Render-layer conveniences
  // -------------------------------------------------------------------------

  /**
   * Pickups are drawn as instanced meshes rather than as individual Groups, so
   * the render layer needs one merged geometry per kind instead of a prototype
   * hierarchy. Geometry is built once and cached; a field of eighty gold coins
   * then costs one draw call.
   */
  pickupGeometry(kind: string): BufferGeometry {
    const cached = this.mergedCache.get(`pickup:${kind}`);
    if (cached) return cached;
    const merged = ["scrap", "fuel", "cylinder", "pressureCanister", "repairKit", "shockMine", "armorPlate", "weaponPart"].includes(kind)
      ? buildRewardGeometry(kind) : flattenToGeometry(this.createPickup(kind, false));
    this.mergedCache.set(`pickup:${kind}`, merged);
    return merged;
  }

  /**
   * A translucent copy of a structure, used as the placement preview. Every
   * mesh in it is repointed at one shared ghost material by the render layer,
   * so the geometry here is the only thing that matters.
   */
  createGhost(kind: string): Group {
    switch (kind) {
      case "rivetTurret":
        return this.createTurret().root;
      case "crawlerTurret":
        return this.createCrawlerTurret().root;
      case "relay":
        return this.createRelay().root;
      case "mine":
        return this.createMine().root;
      default:
        return this.createBarricade();
    }
  }

  /** Flat ground ring used by the VFX layer for shockwaves and dust rings. */
  ringGeometry(): BufferGeometry {
    const cached = this.mergedCache.get("vfxRing");
    if (cached) return cached;
    const ring: BufferGeometry = new RingGeometry(0.82, 1, 48);
    ring.rotateX(-Math.PI / 2);
    this.mergedCache.set("vfxRing", ring);
    return ring;
  }

  dispose(): void {
    this.blender?.dispose();
    this.blender = null;
    characterCache.dispose();
    machineCache.dispose();
    for (const geometry of this.props.values()) geometry.dispose();
    this.props.clear();
    for (const geometry of this.mergedCache.values()) geometry.dispose();
    this.mergedCache.clear();
    for (const prototype of [this.gatePrototype, this.checkpointPrototype]) {
      prototype?.traverse((node) => {
        const mesh = node as Mesh;
        if (mesh.isMesh) (mesh.geometry as BufferGeometry).dispose();
      });
    }
    this.gatePrototype = null;
    this.checkpointPrototype = null;
    this.materials.dispose();
    this.stats.geometries = 0;
    this.stats.vertices = 0;
    this.stats.materials = 0;
    this.built = false;
  }
}

/**
 * Bakes a built hierarchy down to a single geometry in the root's local space.
 *
 * Instanced rendering can only draw one geometry, so anything the forge builds
 * as a Group has to be flattened before it can be a pickup instance. The world
 * matrices are baked in, which is why this is only safe for a prototype that
 * has never been added to a live scene.
 */
function flattenToGeometry(group: Group): BufferGeometry {
  group.updateMatrixWorld(true);
  const parts: BufferGeometry[] = [];
  group.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    const baked = (mesh.geometry as BufferGeometry).clone();
    baked.applyMatrix4(mesh.matrixWorld);
    parts.push(baked);
  });
  if (parts.length === 0) return place(merge([]), 0, 0, 0);
  const merged = merge(parts);
  // merge([geometry]) returns that same geometry. Only dispose intermediates,
  // never the result that the forge is about to cache and hand to the renderer.
  for (const part of parts) if (part !== merged) part.dispose();
  return merged;
}
