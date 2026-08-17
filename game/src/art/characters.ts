/**
 * Rigid-segment puppets.
 *
 * No skinning anywhere. A character is a small hierarchy of Object3D joints,
 * each carrying one merged, chamfered, vertex-coloured mesh authored directly
 * in that joint's local space. Rotating a joint therefore bends the limb
 * correctly with no bone matrices, no skin attribute and no per-frame CPU skin
 * update, which is what lets a hundred-plus enemies animate for almost nothing.
 *
 * Geometry is cached per character kind and shared across every instance; a new
 * puppet only allocates Object3Ds and Meshes.
 *
 * Reading order matters more than detail. These are framed by a 52 degree
 * orthographic camera from ~21 units of view height, so what the player
 * actually sees is the top of the shoulders, the top of the head and the
 * footprint. Every proportion below is chosen for that view:
 *
 *   Engineer   0.86 m shoulder span, light amber coat, round hat brim with two
 *              brass goggle rings on top. The brightest, widest, roundest thing
 *              on screen - light being the operative word, since the ground is
 *              warm too and only lightness separates him from it.
 *   Skeleton   0.40 m clavicle span, bone white, dark ragged cape, open ribcage.
 *              Half the width and none of the saturation.
 *   Golem      1.28 m shoulder span before its 1.62 archetype scale, sunken
 *              head, green core. Unmistakable at forty metres.
 */

import { Group, Mesh, Object3D } from "three";
import type { BufferGeometry, Material } from "three";
import { ENEMY_COLORS, ENV, PLAYER_COLORS, SPIDER_COLORS } from "./palette.ts";
import type { MaterialLibrary } from "./materials.ts";
import {
  chamferedBox,
  coneish,
  cylinderish,
  merge,
  place,
  plate,
  rivetRing,
  sphereish,
  taperedBox,
  tint,
  vertexCount,
} from "./geometry.ts";

export interface PuppetRig {
  root: Group;
  torso: Object3D;
  head: Object3D;
  pelvis: Object3D;
  armL: Object3D;
  armR: Object3D;
  forearmL: Object3D;
  forearmR: Object3D;
  legL: Object3D;
  legR: Object3D;
  shinL: Object3D;
  shinR: Object3D;
  /** Attachment sockets for tools and weapons. */
  handL: Object3D;
  handR: Object3D;
  /**
   * Authored height in metres, before `EnemyArchetype.scale` is applied by the
   * render layer. Used for camera framing and HUD anchors.
   */
  height: number;
}

/**
 * Geometry for one segment each. `hand` may be null, in which case the hand
 * geometry is baked into the forearm and the hand joints stay as empty
 * sockets. That saves two draw calls per enemy and only costs an independently
 * rotating wrist, which nothing but the engineer needs.
 */
interface RigParts {
  pelvis: BufferGeometry;
  torso: BufferGeometry;
  head: BufferGeometry;
  upperArm: BufferGeometry;
  forearm: BufferGeometry;
  hand: BufferGeometry | null;
  thigh: BufferGeometry;
  shin: BufferGeometry;
}

/** Joint offsets, each relative to its parent joint. Y is up, +Z is forward. */
interface RigMetrics {
  height: number;
  /** Pelvis above ground. */
  hipY: number;
  /** Torso above the pelvis. */
  spineY: number;
  /** Head above the torso origin. */
  neckY: number;
  shoulderX: number;
  shoulderY: number;
  /** Negative: elbow below the shoulder. */
  elbowY: number;
  /** Negative: wrist below the elbow. */
  wristY: number;
  hipX: number;
  /** Negative: knee below the hip. */
  kneeY: number;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function joint(parent: Object3D, name: string, x: number, y: number, z: number): Object3D {
  const node = new Object3D();
  node.name = name;
  node.position.set(x, y, z);
  parent.add(node);
  return node;
}

function attach(parent: Object3D, geometry: BufferGeometry, material: Material): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}

function assemble(name: string, parts: RigParts, m: RigMetrics, material: Material): PuppetRig {
  const root = new Group();
  root.name = name;

  const pelvis = joint(root, "pelvis", 0, m.hipY, 0);
  attach(pelvis, parts.pelvis, material);

  const torso = joint(pelvis, "torso", 0, m.spineY, 0);
  attach(torso, parts.torso, material);

  const head = joint(torso, "head", 0, m.neckY, 0);
  attach(head, parts.head, material);

  const armL = joint(torso, "armL", m.shoulderX, m.shoulderY, 0);
  const armR = joint(torso, "armR", -m.shoulderX, m.shoulderY, 0);
  attach(armL, parts.upperArm, material);
  attach(armR, parts.upperArm, material);

  const forearmL = joint(armL, "forearmL", 0, m.elbowY, 0);
  const forearmR = joint(armR, "forearmR", 0, m.elbowY, 0);
  attach(forearmL, parts.forearm, material);
  attach(forearmR, parts.forearm, material);

  const handL = joint(forearmL, "handL", 0, m.wristY, 0);
  const handR = joint(forearmR, "handR", 0, m.wristY, 0);
  if (parts.hand) {
    attach(handL, parts.hand, material);
    attach(handR, parts.hand, material);
  }

  const legL = joint(pelvis, "legL", m.hipX, 0, 0);
  const legR = joint(pelvis, "legR", -m.hipX, 0, 0);
  attach(legL, parts.thigh, material);
  attach(legR, parts.thigh, material);

  const shinL = joint(legL, "shinL", 0, m.kneeY, 0);
  const shinR = joint(legR, "shinR", 0, m.kneeY, 0);
  attach(shinL, parts.shin, material);
  attach(shinR, parts.shin, material);

  return {
    root,
    torso,
    head,
    pelvis,
    armL,
    armR,
    forearmL,
    forearmR,
    legL,
    legR,
    shinL,
    shinR,
    handL,
    handR,
    height: m.height,
  };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const partsCache = new Map<string, RigParts>();
const singleCache = new Map<string, BufferGeometry>();
const owned: BufferGeometry[] = [];

function own<T extends BufferGeometry>(geometry: T): T {
  owned.push(geometry);
  return geometry;
}

function cacheParts(key: string, build: () => RigParts): RigParts {
  let parts = partsCache.get(key);
  if (!parts) {
    parts = build();
    own(parts.pelvis);
    own(parts.torso);
    own(parts.head);
    own(parts.upperArm);
    own(parts.forearm);
    if (parts.hand) own(parts.hand);
    own(parts.thigh);
    own(parts.shin);
    partsCache.set(key, parts);
  }
  return parts;
}

function cacheSingle(key: string, build: () => BufferGeometry): BufferGeometry {
  let geometry = singleCache.get(key);
  if (!geometry) {
    geometry = own(build());
    singleCache.set(key, geometry);
  }
  return geometry;
}

/** Shared geometry owned by this module, for MeshForge stats and disposal. */
export const characterCache = {
  geometries(): readonly BufferGeometry[] {
    return owned;
  },
  vertices(): number {
    let total = 0;
    for (let i = 0; i < owned.length; i++) total += vertexCount(owned[i]);
    return total;
  },
  dispose(): void {
    for (let i = 0; i < owned.length; i++) owned[i].dispose();
    owned.length = 0;
    partsCache.clear();
    singleCache.clear();
  },
};

// ---------------------------------------------------------------------------
// Engineer
// ---------------------------------------------------------------------------

const ENGINEER_METRICS: RigMetrics = {
  height: 1.98,
  hipY: 1.0,
  spineY: 0.06,
  neckY: 0.46,
  shoulderX: 0.31,
  shoulderY: 0.4,
  elbowY: -0.3,
  wristY: -0.28,
  hipX: 0.135,
  kneeY: -0.44,
};

function engineerParts(): RigParts {
  const P = PLAYER_COLORS;

  const pelvis = tint(
    merge([
      place(chamferedBox(0.44, 0.26, 0.3, 0.05, P.coat), 0, 0, 0),
      place(plate(0.48, 0.34, 0.09, 0.03, P.brassDark), 0, 0.1, 0),
      place(chamferedBox(0.11, 0.1, 0.05, 0.02, P.brass), 0, 0.1, 0.17),
    ]),
    0.05,
    11,
  );

  const torso = tint(
    merge([
      place(taperedBox(0.5, 0.6, 0.44, 0.32, 0.36, 0.06, P.coat), 0, 0.22, 0),
      // Hem, hips and brim are all one garment and all take the coat value. The
      // shade is left to trim and to the breaks between masses - the yoke, the
      // cuffs, the sleeves, the crown - because it was the coat's own body
      // wearing the shadow tone that put him at 1.37:1 against the ground.
      // Measured on the march frame: 59% of his visible coat area was shade.
      place(taperedBox(0.52, 0.5, 0.2, 0.34, 0.32, 0.05, P.coat), 0, -0.08, 0),
      place(chamferedBox(0.1, 0.42, 0.06, 0.025, P.brassDark), 0.05, 0.22, 0.175, 0, 0, -0.2),
      place(chamferedBox(0.07, 0.07, 0.05, 0.02, P.brass), 0.11, 0.36, 0.185),
      // The shoulder yoke stays in the shade. It is the one band that separates
      // the hat from the body when both are lit, and it sits in the brim's own
      // shadow, so a darker value is also the honest one.
      place(taperedBox(0.44, 0.34, 0.12, 0.32, 0.24, 0.03, P.coatDark), 0, 0.45, 0),
      place(chamferedBox(0.34, 0.32, 0.18, 0.05, P.steelDark), 0, 0.26, -0.24),
      place(plate(0.3, 0.15, 0.045, 0.02, P.brass), 0, 0.4, -0.24),
      place(cylinderish(0.045, 0.045, 0.3, 6, P.steel), 0.11, 0.34, -0.35),
      place(cylinderish(0.045, 0.045, 0.3, 6, P.steel), -0.11, 0.34, -0.35),
      place(sphereish(0.05, 5, P.brass), 0, 0.5, -0.33),
      place(rivetRing(0.15, 6, 0.02, P.brassDark), 0, 0.42, -0.24, Math.PI * 0.5),
    ]),
    0.06,
    12,
  );

  const head = tint(
    merge([
      place(cylinderish(0.075, 0.075, 0.1, 6, P.skin), 0, 0.04, 0),
      place(chamferedBox(0.23, 0.25, 0.22, 0.05, P.skin), 0, 0.16, 0),
      place(chamferedBox(0.2, 0.11, 0.19, 0.035, P.steel), 0, 0.1, 0.03),
      // The brim is the whole top-down silhouette. Round, wide, and light: it is
      // the single largest surface this camera ever sees of him, and it was
      // authored in the shade, which is most of why he was the lowest-contrast
      // actor in the frame.
      place(cylinderish(0.247, 0.235, 0.05, 10, P.coat), 0, 0.295, 0),
      place(cylinderish(0.164, 0.164, 0.042, 10, P.brass), 0, 0.335, 0),
      place(cylinderish(0.156, 0.132, 0.15, 10, P.coat), 0, 0.395, 0),
      place(cylinderish(0.136, 0.13, 0.035, 10, P.coatDark), 0, 0.472, 0),
      place(chamferedBox(0.2, 0.04, 0.06, 0.015, P.boot), 0, 0.327, 0.08),
      place(cylinderish(0.063, 0.063, 0.05, 8, P.brass), 0.079, 0.328, 0.118),
      place(cylinderish(0.063, 0.063, 0.05, 8, P.brass), -0.079, 0.328, 0.118),
      place(cylinderish(0.042, 0.042, 0.058, 8, SPIDER_COLORS.glass), 0.079, 0.331, 0.118),
      place(cylinderish(0.042, 0.042, 0.058, 8, SPIDER_COLORS.glass), -0.079, 0.331, 0.118),
    ]),
    0.045,
    13,
  );

  // The pad tapers downward and outward so the shoulder reads as a rounded
  // mass flowing into the sleeve. A slab that is widest at the top reads as a
  // yoke bolted onto the figure, which is the single fastest way to make a
  // character look like programmer art from above.
  const upperArm = tint(
    merge([
      place(taperedBox(0.27, 0.21, 0.19, 0.31, 0.23, 0.065, P.coat), 0, -0.035, 0),
      place(taperedBox(0.21, 0.15, 0.07, 0.23, 0.17, 0.025, P.coatDark), 0, 0.085, 0),
      place(sphereish(0.045, 5, P.brass), 0, 0.05, 0.115),
      place(taperedBox(0.145, 0.19, 0.24, 0.15, 0.195, 0.04, P.coat), 0, -0.19, 0),
    ]),
    0.05,
    14,
  );

  const forearm = tint(
    merge([
      place(taperedBox(0.19, 0.185, 0.07, 0.19, 0.19, 0.025, P.brassDark), 0, -0.025, 0),
      place(taperedBox(0.135, 0.155, 0.24, 0.14, 0.16, 0.035, P.coatDark), 0, -0.15, 0),
    ]),
    0.05,
    15,
  );

  const hand = tint(
    merge([
      place(chamferedBox(0.15, 0.15, 0.13, 0.04, P.boot), 0, -0.065, 0),
      place(plate(0.15, 0.13, 0.035, 0.015, P.brassDark), 0, -0.128, 0),
    ]),
    0.05,
    16,
  );

  const thigh = tint(
    merge([
      place(taperedBox(0.165, 0.215, 0.44, 0.175, 0.225, 0.045, P.trouser), 0, -0.22, 0),
      place(chamferedBox(0.17, 0.08, 0.1, 0.025, P.boot), 0, -0.41, 0.08),
    ]),
    0.05,
    17,
  );

  const shin = tint(
    merge([
      place(taperedBox(0.145, 0.18, 0.34, 0.155, 0.19, 0.035, P.trouser), 0, -0.17, 0),
      place(taperedBox(0.23, 0.2, 0.08, 0.24, 0.21, 0.025, P.boot), 0, -0.335, 0.01),
      // Oversized boots. They anchor the figure and read as a solid dark base.
      place(chamferedBox(0.21, 0.21, 0.3, 0.05, P.boot), 0, -0.455, 0.035),
      place(plate(0.22, 0.33, 0.055, 0.02, P.steelDark), 0, -0.54, 0.045),
      place(plate(0.17, 0.1, 0.07, 0.025, P.brass), 0, -0.5, 0.175),
    ]),
    0.05,
    18,
  );

  return { pelvis, torso, head, upperArm, forearm, hand, thigh, shin };
}

export function buildEngineer(materials: MaterialLibrary): PuppetRig {
  const parts = cacheParts("engineer", engineerParts);
  const rig = assemble("engineer", parts, ENGINEER_METRICS, materials.surface);
  rig.root.traverse((node) => {
    if ((node as Mesh).isMesh) (node as Mesh).receiveShadow = true;
  });
  return rig;
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

const SKELETON_METRICS: RigMetrics = {
  height: 1.8,
  hipY: 0.94,
  spineY: 0.05,
  neckY: 0.48,
  shoulderX: 0.2,
  shoulderY: 0.42,
  elbowY: -0.3,
  wristY: -0.28,
  hipX: 0.105,
  kneeY: -0.44,
};

function skeletonPelvis(): BufferGeometry {
  const E = ENEMY_COLORS;
  return tint(
    merge([
      place(chamferedBox(0.26, 0.15, 0.17, 0.04, E.bone), 0, -0.02, 0),
      place(plate(0.09, 0.16, 0.06, 0.02, E.bone), 0.14, 0.03, 0, 0, 0, -0.38),
      place(plate(0.09, 0.16, 0.06, 0.02, E.bone), -0.14, 0.03, 0, 0, 0, 0.38),
      place(chamferedBox(0.08, 0.15, 0.08, 0.025, E.boneDark), 0, 0.06, -0.045),
      place(taperedBox(0.3, 0.25, 0.22, 0.22, 0.19, 0.03, E.rag), 0, -0.11, 0),
    ]),
    0.07,
    21,
  );
}

function skeletonTorso(): BufferGeometry {
  const E = ENEMY_COLORS;
  return tint(
    merge([
      place(chamferedBox(0.07, 0.46, 0.075, 0.02, E.boneDark), 0, 0.22, -0.055),
      // Three ribs with visible gaps: the open ribcage is the closest-range
      // tell that separates a skeleton from anything the player owns.
      place(chamferedBox(0.3, 0.045, 0.21, 0.018, E.bone), 0, 0.1, 0.005),
      place(chamferedBox(0.31, 0.045, 0.215, 0.018, E.bone), 0, 0.19, 0.005),
      place(chamferedBox(0.28, 0.045, 0.2, 0.018, E.bone), 0, 0.28, 0.005),
      place(chamferedBox(0.05, 0.26, 0.045, 0.015, E.bone), 0, 0.19, 0.1),
      place(chamferedBox(0.4, 0.06, 0.09, 0.02, E.bone), 0, 0.42, 0.01),
      place(sphereish(0.055, 5, E.boneDark), 0.185, 0.42, 0),
      place(sphereish(0.055, 5, E.boneDark), -0.185, 0.42, 0),
      place(taperedBox(0.34, 0.3, 0.24, 0.1, 0.17, 0.03, E.rag), 0, 0.33, -0.1),
      place(taperedBox(0.16, 0.13, 0.2, 0.08, 0.06, 0.02, E.ragDark), 0.13, 0.16, -0.14),
      place(taperedBox(0.14, 0.12, 0.24, 0.07, 0.055, 0.02, E.ragDark), -0.12, 0.14, -0.13),
    ]),
    0.08,
    22,
  );
}

function skeletonSkull(): BufferGeometry {
  const E = ENEMY_COLORS;
  return tint(
    merge([
      place(cylinderish(0.045, 0.045, 0.11, 6, E.boneDark), 0, 0.04, 0),
      place(chamferedBox(0.19, 0.21, 0.21, 0.05, E.bone), 0, 0.21, 0),
      place(plate(0.2, 0.07, 0.055, 0.02, E.boneDark), 0, 0.25, 0.09),
      place(taperedBox(0.16, 0.175, 0.075, 0.16, 0.175, 0.025, E.boneDark), 0, 0.125, 0.028),
      place(plate(0.17, 0.18, 0.04, 0.02, E.boneDark), 0, 0.315, -0.01),
      place(chamferedBox(0.065, 0.06, 0.03, 0.012, E.boneShadow), 0.046, 0.212, 0.09),
      place(chamferedBox(0.065, 0.06, 0.03, 0.012, E.boneShadow), -0.046, 0.212, 0.09),
      place(chamferedBox(0.045, 0.042, 0.028, 0.01, E.ember), 0.046, 0.212, 0.101),
      place(chamferedBox(0.045, 0.042, 0.028, 0.01, E.ember), -0.046, 0.212, 0.101),
    ]),
    0.05,
    23,
  );
}

function skeletonUpperArm(): BufferGeometry {
  const E = ENEMY_COLORS;
  return tint(
    merge([
      place(sphereish(0.058, 5, E.boneDark), 0, 0, 0),
      place(taperedBox(0.075, 0.095, 0.3, 0.075, 0.095, 0.025, E.bone), 0, -0.15, 0),
    ]),
    0.06,
    24,
  );
}

function skeletonForearm(): BufferGeometry {
  const E = ENEMY_COLORS;
  return tint(
    merge([
      place(sphereish(0.05, 5, E.boneDark), 0, 0, 0),
      place(taperedBox(0.045, 0.058, 0.24, 0.045, 0.058, 0.018, E.bone), 0.028, -0.14, 0),
      place(taperedBox(0.04, 0.05, 0.24, 0.04, 0.05, 0.015, E.bone), -0.028, -0.14, 0.014),
      place(chamferedBox(0.09, 0.075, 0.085, 0.025, E.bone), 0, -0.315, 0.005),
      place(chamferedBox(0.024, 0.08, 0.024, 0.008, E.boneDark), 0.028, -0.385, 0.02),
      place(chamferedBox(0.024, 0.085, 0.024, 0.008, E.boneDark), 0, -0.39, 0.03),
      place(chamferedBox(0.024, 0.08, 0.024, 0.008, E.boneDark), -0.028, -0.385, 0.02),
    ]),
    0.06,
    25,
  );
}

function skeletonThigh(): BufferGeometry {
  const E = ENEMY_COLORS;
  return tint(
    merge([
      place(sphereish(0.062, 5, E.boneDark), 0, 0, 0),
      place(taperedBox(0.085, 0.105, 0.42, 0.085, 0.105, 0.028, E.bone), 0, -0.21, 0),
    ]),
    0.06,
    26,
  );
}

function skeletonShin(): BufferGeometry {
  const E = ENEMY_COLORS;
  return tint(
    merge([
      place(sphereish(0.056, 5, E.boneDark), 0, 0, 0),
      place(taperedBox(0.062, 0.078, 0.38, 0.062, 0.078, 0.02, E.bone), 0.022, -0.2, 0),
      place(taperedBox(0.036, 0.044, 0.36, 0.036, 0.044, 0.015, E.bone), -0.032, -0.2, -0.012),
      place(sphereish(0.05, 5, E.boneDark), 0, -0.41, 0),
      place(plate(0.13, 0.26, 0.06, 0.02, E.bone), 0, -0.468, 0.055),
      place(chamferedBox(0.03, 0.04, 0.07, 0.012, E.boneDark), 0.036, -0.468, 0.2),
      place(chamferedBox(0.03, 0.04, 0.075, 0.012, E.boneDark), 0, -0.468, 0.205),
      place(chamferedBox(0.03, 0.04, 0.07, 0.012, E.boneDark), -0.036, -0.468, 0.2),
    ]),
    0.06,
    27,
  );
}

function minionParts(): RigParts {
  return {
    pelvis: skeletonPelvis(),
    torso: skeletonTorso(),
    head: skeletonSkull(),
    upperArm: skeletonUpperArm(),
    forearm: skeletonForearm(),
    hand: null,
    thigh: skeletonThigh(),
    shin: skeletonShin(),
  };
}

export function buildSkeletonMinion(materials: MaterialLibrary): PuppetRig {
  const parts = cacheParts("minion", minionParts);
  return assemble("minion", parts, SKELETON_METRICS, materials.surface);
}

function warriorParts(): RigParts {
  const E = ENEMY_COLORS;
  const torso = merge([
    skeletonTorso(),
    tint(
      merge([
        place(chamferedBox(0.34, 0.34, 0.11, 0.04, E.rustArmor), 0, 0.24, 0.085),
        place(plate(0.36, 0.1, 0.055, 0.02, E.rustArmorDark), 0, 0.4, 0.06),
        place(chamferedBox(0.3, 0.07, 0.1, 0.025, E.rustArmorDark), 0, 0.08, 0.08),
        place(rivetRing(0.12, 6, 0.018, E.boneDark), 0, 0.24, 0.145, Math.PI * 0.5),
        place(chamferedBox(0.26, 0.24, 0.09, 0.03, E.rustArmorDark), 0, 0.24, -0.12),
      ]),
      0.08,
      31,
    ),
  ]);

  const head = merge([
    skeletonSkull(),
    tint(
      merge([
        place(taperedBox(0.225, 0.185, 0.15, 0.235, 0.195, 0.04, E.rustArmor), 0, 0.3, -0.005),
        place(chamferedBox(0.045, 0.11, 0.1, 0.015, E.rustArmorDark), 0, 0.235, 0.1),
        // Horns. The one silhouette element that separates a warrior from a
        // minion when both are 30 m away and two pixels wide.
        place(coneish(0.038, 0.16, 5, E.boneDark), 0.115, 0.4, -0.01, 0, 0, -0.62),
        place(coneish(0.038, 0.16, 5, E.boneDark), -0.115, 0.4, -0.01, 0, 0, 0.62),
      ]),
      0.07,
      32,
    ),
  ]);

  const upperArm = merge([
    skeletonUpperArm(),
    tint(
      merge([
        place(taperedBox(0.24, 0.26, 0.13, 0.24, 0.26, 0.05, E.rustArmor), 0, 0.02, 0),
        place(rivetRing(0.09, 6, 0.018, E.boneDark), 0, 0.09, 0),
      ]),
      0.08,
      33,
    ),
  ]);

  const shin = merge([
    skeletonShin(),
    tint(place(plate(0.16, 0.17, 0.055, 0.02, E.rustArmor), 0, -0.13, 0.06, 0.2, 0, 0), 0.08, 34),
  ]);

  return {
    pelvis: merge([
      skeletonPelvis(),
      tint(place(chamferedBox(0.32, 0.09, 0.24, 0.03, E.rustArmorDark), 0, -0.03, 0), 0.07, 35),
    ]),
    torso,
    head,
    upperArm,
    forearm: skeletonForearm(),
    hand: null,
    thigh: skeletonThigh(),
    shin,
  };
}

export function buildSkeletonWarrior(materials: MaterialLibrary): PuppetRig {
  const parts = cacheParts("warrior", warriorParts);
  return assemble("warrior", parts, SKELETON_METRICS, materials.surface);
}

// ---------------------------------------------------------------------------
// Golem
// ---------------------------------------------------------------------------

const GOLEM_METRICS: RigMetrics = {
  height: 1.8,
  hipY: 0.82,
  spineY: 0.06,
  neckY: 0.56,
  shoulderX: 0.44,
  shoulderY: 0.46,
  elbowY: -0.36,
  wristY: -0.34,
  hipX: 0.2,
  kneeY: -0.4,
};

function golemParts(): RigParts {
  const E = ENEMY_COLORS;

  const pelvis = tint(
    merge([
      place(chamferedBox(0.52, 0.28, 0.36, 0.06, E.golemStone), 0, 0, 0),
      place(plate(0.56, 0.4, 0.09, 0.03, E.golemStoneDark), 0, 0.12, 0),
      place(chamferedBox(0.14, 0.1, 0.1, 0.03, E.golemStoneDark), 0.2, -0.06, 0.15),
      place(chamferedBox(0.14, 0.1, 0.1, 0.03, E.golemStoneDark), -0.2, -0.06, 0.15),
    ]),
    0.07,
    41,
  );

  const torso = tint(
    merge([
      place(taperedBox(0.6, 0.86, 0.62, 0.42, 0.5, 0.09, E.golemStone), 0, 0.3, 0),
      // Two separate shoulder slabs, not one lid: the gap between them is what
      // lets the head read as a head from directly above.
      place(taperedBox(0.38, 0.32, 0.17, 0.52, 0.46, 0.05, E.golemStoneDark), 0.34, 0.56, 0),
      place(taperedBox(0.38, 0.32, 0.17, 0.52, 0.46, 0.05, E.golemStoneDark), -0.34, 0.56, 0),
      place(chamferedBox(0.16, 0.13, 0.14, 0.03, E.golemStone), 0.4, 0.68, -0.06),
      place(chamferedBox(0.16, 0.13, 0.14, 0.03, E.golemStone), -0.4, 0.68, -0.06),
      place(chamferedBox(0.3, 0.34, 0.12, 0.035, E.golemStoneDark), 0, 0.32, 0.235),
      place(chamferedBox(0.055, 0.3, 0.05, 0.015, E.golemCore), 0.14, 0.3, 0.25),
      place(chamferedBox(0.055, 0.3, 0.05, 0.015, E.golemCore), -0.14, 0.3, 0.25),
      place(chamferedBox(0.34, 0.4, 0.14, 0.04, E.golemStoneDark), 0, 0.34, -0.24),
      place(chamferedBox(0.2, 0.16, 0.18, 0.04, E.golemStone), 0, 0.55, -0.2),
    ]),
    0.08,
    42,
  );

  // A crest that clears the shoulder slabs. Without it the golem is a crate.
  const head = tint(
    merge([
      place(chamferedBox(0.22, 0.16, 0.22, 0.04, E.golemStoneDark), 0, 0.02, 0),
      place(chamferedBox(0.28, 0.26, 0.29, 0.055, E.golemStone), 0, 0.18, 0.01),
      place(taperedBox(0.26, 0.11, 0.2, 0.28, 0.13, 0.035, E.golemStone), 0, 0.4, -0.01),
      place(chamferedBox(0.08, 0.14, 0.09, 0.02, E.golemStoneDark), 0.13, 0.42, 0.02, 0, 0, -0.4),
      place(chamferedBox(0.08, 0.14, 0.09, 0.02, E.golemStoneDark), -0.13, 0.42, 0.02, 0, 0, 0.4),
      place(chamferedBox(0.23, 0.07, 0.04, 0.014, E.boneShadow), 0, 0.19, 0.145),
      place(chamferedBox(0.06, 0.045, 0.03, 0.01, E.ember), 0.062, 0.19, 0.155),
      place(chamferedBox(0.06, 0.045, 0.03, 0.01, E.ember), -0.062, 0.19, 0.155),
      place(chamferedBox(0.21, 0.09, 0.14, 0.025, E.golemStoneDark), 0, 0.07, 0.07),
    ]),
    0.06,
    43,
  );

  const upperArm = tint(
    merge([
      place(taperedBox(0.34, 0.42, 0.22, 0.34, 0.42, 0.07, E.golemStone), 0, 0.04, 0),
      place(plate(0.4, 0.4, 0.06, 0.02, E.golemStoneDark), 0, 0.16, 0),
      place(taperedBox(0.24, 0.3, 0.34, 0.24, 0.3, 0.05, E.golemStone), 0, -0.19, 0),
    ]),
    0.07,
    44,
  );

  const forearm = tint(
    merge([
      place(taperedBox(0.3, 0.27, 0.3, 0.3, 0.27, 0.05, E.golemStone), 0, -0.18, 0),
      place(chamferedBox(0.34, 0.3, 0.32, 0.07, E.golemStone), 0, -0.46, 0.02),
      place(plate(0.3, 0.28, 0.07, 0.025, E.golemStoneDark), 0, -0.6, 0.02),
      place(chamferedBox(0.08, 0.08, 0.07, 0.02, E.golemStoneDark), 0, -0.44, 0.19),
    ]),
    0.07,
    45,
  );

  const thigh = tint(
    merge([
      place(taperedBox(0.26, 0.34, 0.4, 0.28, 0.36, 0.06, E.golemStone), 0, -0.2, 0),
      place(plate(0.36, 0.38, 0.07, 0.025, E.golemStoneDark), 0, 0.02, 0),
    ]),
    0.07,
    46,
  );

  const shin = tint(
    merge([
      place(taperedBox(0.24, 0.29, 0.28, 0.26, 0.31, 0.05, E.golemStone), 0, -0.16, 0),
      place(chamferedBox(0.32, 0.17, 0.44, 0.06, E.golemStone), 0, -0.335, 0.07),
      place(plate(0.34, 0.46, 0.06, 0.02, E.golemStoneDark), 0, -0.42, 0.07),
    ]),
    0.07,
    47,
  );

  return { pelvis, torso, head, upperArm, forearm, hand: null, thigh, shin };
}

export function buildSkeletonGolem(materials: MaterialLibrary): PuppetRig {
  const parts = cacheParts("golem", golemParts);
  const rig = assemble("golem", parts, GOLEM_METRICS, materials.surface);
  const core = cacheSingle("golemCore", () =>
    merge([
      // A vertical slit, never a cross: a plus sign reads as a health pickup.
      place(sphereish(0.07, 8, ENEMY_COLORS.golemCore), 0, 0, 0),
      place(chamferedBox(0.045, 0.28, 0.04, 0.012, ENEMY_COLORS.golemCore), 0, 0, 0.005),
    ]),
  );
  const coreMesh = new Mesh(core, materials.emissive(ENEMY_COLORS.golemCore, 1.35));
  coreMesh.name = "core";
  coreMesh.position.set(0, 0.32, 0.285);
  rig.torso.add(coreMesh);
  return rig;
}

// ---------------------------------------------------------------------------
// Held items. All authored with the grip at the origin, pointing along +Z.
// ---------------------------------------------------------------------------

export function buildWrench(materials: MaterialLibrary): Object3D {
  const P = PLAYER_COLORS;
  const geometry = cacheSingle("wrench", () =>
    tint(
      merge([
        place(taperedBox(0.05, 0.045, 0.36, 0.055, 0.05, 0.014, P.steelDark), 0, 0, 0.1, Math.PI * 0.5),
        place(cylinderish(0.042, 0.042, 0.05, 8, P.brass), 0, 0, 0.27, Math.PI * 0.5),
        place(chamferedBox(0.13, 0.065, 0.11, 0.022, P.brass), 0, 0, 0.35),
        place(chamferedBox(0.038, 0.06, 0.1, 0.014, P.brass), 0.048, 0, 0.44),
        place(chamferedBox(0.038, 0.06, 0.1, 0.014, P.brass), -0.048, 0, 0.44),
        place(chamferedBox(0.09, 0.045, 0.045, 0.014, P.brassDark), 0, 0, 0.32),
        place(sphereish(0.038, 5, P.brassDark), 0, 0, -0.09),
      ]),
      0.05,
      51,
    ),
  );
  const group = new Group();
  group.name = "wrench";
  const mesh = new Mesh(geometry, materials.surface);
  mesh.castShadow = true;
  group.add(mesh);
  return group;
}

export function buildScattergun(materials: MaterialLibrary): Object3D {
  const P = PLAYER_COLORS;
  const geometry = cacheSingle("scattergun", () =>
    tint(
      merge([
        place(taperedBox(0.13, 0.075, 0.28, 0.105, 0.075, 0.025, ENV.treeTrunk), 0, -0.02, -0.17, Math.PI * 0.5),
        place(chamferedBox(0.085, 0.115, 0.22, 0.02, P.steelDark), 0, 0.005, 0.02),
        place(plate(0.1, 0.17, 0.022, 0.008, P.brass), 0.046, 0.01, 0.02, 0, 0, Math.PI * 0.5),
        place(plate(0.1, 0.17, 0.022, 0.008, P.brass), -0.046, 0.01, 0.02, 0, 0, Math.PI * 0.5),
        place(chamferedBox(0.11, 0.075, 0.15, 0.02, P.steelDark), 0, 0.032, 0.185),
        place(cylinderish(0.03, 0.027, 0.42, 8, P.steel), 0.033, 0.032, 0.33, Math.PI * 0.5),
        place(cylinderish(0.03, 0.027, 0.42, 8, P.steel), -0.033, 0.032, 0.33, Math.PI * 0.5),
        place(cylinderish(0.052, 0.058, 0.06, 8, P.brass), 0, 0.032, 0.545, Math.PI * 0.5),
        place(taperedBox(0.075, 0.062, 0.15, 0.09, 0.075, 0.018, ENV.treeTrunkDark), 0, -0.095, -0.035, -0.28),
        place(chamferedBox(0.08, 0.065, 0.13, 0.02, ENV.treeTrunk), 0, -0.028, 0.27),
        place(chamferedBox(0.045, 0.05, 0.035, 0.012, P.brassDark), 0, -0.055, 0.055),
        place(sphereish(0.03, 5, P.brass), 0, 0.09, 0.11),
      ]),
      0.05,
      52,
    ),
  );
  const group = new Group();
  group.name = "scattergun";
  const mesh = new Mesh(geometry, materials.surface);
  mesh.castShadow = true;
  group.add(mesh);
  const muzzle = new Object3D();
  muzzle.name = "muzzle";
  muzzle.position.set(0, 0.032, 0.59);
  group.add(muzzle);
  return group;
}

export function buildSkeletonAxe(materials: MaterialLibrary): Object3D {
  const E = ENEMY_COLORS;
  const geometry = cacheSingle("skeletonAxe", () =>
    tint(
      merge([
        place(cylinderish(0.026, 0.022, 0.64, 6, ENV.treeTrunkDark), 0, 0, 0.16, Math.PI * 0.5),
        place(cylinderish(0.032, 0.032, 0.05, 6, E.ragDark), 0, 0, 0.3, Math.PI * 0.5),
        place(cylinderish(0.032, 0.032, 0.05, 6, E.ragDark), 0, 0, -0.02, Math.PI * 0.5),
        place(chamferedBox(0.052, 0.24, 0.14, 0.016, E.rustArmor), 0, 0.03, 0.42),
        place(chamferedBox(0.03, 0.21, 0.07, 0.011, E.rustArmorDark), 0, 0.03, 0.51),
        place(chamferedBox(0.016, 0.16, 0.04, 0.006, E.boneDark), 0, 0.03, 0.552),
        place(chamferedBox(0.032, 0.065, 0.11, 0.012, E.rustArmorDark), 0, 0.03, 0.335),
        place(sphereish(0.034, 5, E.rustArmorDark), 0, 0, -0.16),
      ]),
      0.06,
      53,
    ),
  );
  const group = new Group();
  group.name = "skeletonAxe";
  const mesh = new Mesh(geometry, materials.surface);
  mesh.castShadow = true;
  group.add(mesh);
  return group;
}

// ---------------------------------------------------------------------------
// Impostors
// ---------------------------------------------------------------------------

/**
 * Single merged low-detail mesh for distant enemies: one geometry, one draw
 * call when instanced, standing on the origin in a static stride so a frozen
 * silhouette still reads as a walking figure. Authored at the same 1.8 m as the
 * matching puppet so the LOD swap is invisible.
 */
export function buildEnemyImpostorGeometry(kind: string): BufferGeometry {
  const E = ENEMY_COLORS;
  return cacheSingle(`impostor_${kind}`, () => {
    if (kind === "golem") {
      return tint(
        merge([
          place(taperedBox(0.5, 0.86, 0.66, 0.4, 0.5, 0.09, E.golemStone), 0, 1.16, 0),
          place(plate(0.92, 0.54, 0.12, 0.04, E.golemStoneDark), 0, 1.44, 0),
          place(chamferedBox(0.26, 0.24, 0.26, 0.05, E.golemStone), 0, 1.56, 0.02),
          place(chamferedBox(0.2, 0.05, 0.05, 0.012, E.ember), 0, 1.55, 0.14),
          place(chamferedBox(0.24, 0.26, 0.12, 0.03, E.golemCore), 0, 1.2, 0.26),
          place(taperedBox(0.28, 0.4, 0.72, 0.28, 0.4, 0.06, E.golemStone), 0.56, 1.02, 0.03),
          place(taperedBox(0.28, 0.4, 0.72, 0.28, 0.4, 0.06, E.golemStone), -0.56, 1.02, -0.03),
          place(taperedBox(0.26, 0.34, 0.84, 0.3, 0.36, 0.06, E.golemStone), 0.22, 0.44, 0.08),
          place(taperedBox(0.26, 0.34, 0.84, 0.3, 0.36, 0.06, E.golemStone), -0.22, 0.44, -0.08),
          place(chamferedBox(0.34, 0.16, 0.46, 0.05, E.golemStoneDark), 0.22, 0.08, 0.16),
          place(chamferedBox(0.34, 0.16, 0.46, 0.05, E.golemStoneDark), -0.22, 0.08, -0.12),
        ]),
        0.07,
        61,
      );
    }
    const armored = kind === "warrior";
    const parts = [
      place(chamferedBox(0.26, 0.2, 0.19, 0.04, E.bone), 0, 0.92, 0),
      place(chamferedBox(0.3, 0.44, 0.21, 0.03, armored ? E.rustArmor : E.bone), 0, 1.22, 0.01),
      place(chamferedBox(0.38, 0.07, 0.1, 0.02, E.bone), 0, 1.42, 0.01),
      place(taperedBox(0.32, 0.3, 0.26, 0.1, 0.17, 0.03, E.rag), 0, 1.32, -0.1),
      place(chamferedBox(0.19, 0.22, 0.21, 0.05, E.bone), 0, 1.63, 0),
      place(chamferedBox(0.1, 0.05, 0.03, 0.012, E.ember), 0, 1.63, 0.1),
      place(taperedBox(0.09, 0.11, 0.56, 0.09, 0.11, 0.025, E.bone), 0.22, 1.12, 0.06),
      place(taperedBox(0.09, 0.11, 0.56, 0.09, 0.11, 0.025, E.bone), -0.22, 1.12, -0.06),
      place(taperedBox(0.1, 0.13, 0.86, 0.1, 0.13, 0.03, E.bone), 0.11, 0.5, 0.1),
      place(taperedBox(0.1, 0.13, 0.86, 0.1, 0.13, 0.03, E.bone), -0.11, 0.5, -0.1),
      place(plate(0.13, 0.26, 0.06, 0.02, E.bone), 0.11, 0.04, 0.16),
      place(plate(0.13, 0.26, 0.06, 0.02, E.bone), -0.11, 0.04, -0.04),
    ];
    if (armored) {
      parts.push(place(taperedBox(0.23, 0.19, 0.15, 0.24, 0.2, 0.04, E.rustArmor), 0, 1.75, 0));
      parts.push(place(coneish(0.036, 0.15, 5, E.boneDark), 0.115, 1.85, 0, 0, 0, -0.62));
      parts.push(place(coneish(0.036, 0.15, 5, E.boneDark), -0.115, 1.85, 0, 0, 0, 0.62));
    }
    return tint(merge(parts), 0.07, 62);
  });
}
