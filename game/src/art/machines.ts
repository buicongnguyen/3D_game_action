/**
 * The spider, the deployables and the pickups.
 *
 * The spider is the hero asset and the only object allowed a large draw-call
 * budget: one merged hull plus three moving meshes per leg. Everything a
 * gait solver or an animator needs to touch is an Object3D with the pivot at
 * the real joint; everything static is baked into the hull.
 *
 * Camera framing note: the camera sits at +X +Z looking down at 52 degrees, and
 * the spider yaws to follow the route spline. Every tall element (the boiler
 * drum and the three smokestacks) is therefore pushed behind the hull's midline
 * and the whole forward deck is kept below the deck rail, so the machine cannot
 * park itself on top of the player. Racks and module sockets are deliberately
 * low-profile cradles for the same reason.
 */

import { Group, Mesh, Object3D, TorusGeometry } from "three";
import type { BufferGeometry, Material } from "three";
import { ENV, FEEDBACK, PLAYER_COLORS, SPIDER_COLORS, STRUCTURE_COLORS } from "./palette.ts";
import type { MaterialLibrary } from "./materials.ts";
import {
  applyColor,
  chamferedBox,
  coneish,
  cylinderish,
  merge,
  normalizeGeometry,
  pipe,
  place,
  plate,
  rivetLine,
  rivetRing,
  sphereish,
  taperedBox,
  tint,
  vertexCount,
} from "./geometry.ts";

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const cache = new Map<string, BufferGeometry>();
const owned: BufferGeometry[] = [];

function cached(key: string, build: () => BufferGeometry): BufferGeometry {
  let geometry = cache.get(key);
  if (!geometry) {
    geometry = build();
    owned.push(geometry);
    cache.set(key, geometry);
  }
  return geometry;
}

export const machineCache = {
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
    cache.clear();
  },
};

function meshOf(geometry: BufferGeometry, material: Material, name: string): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Flat ring, used for relay halos and gauge collars. */
function ringGeometry(radius: number, tube: number, color: number): BufferGeometry {
  const geometry = new TorusGeometry(radius, tube, 4, 14);
  normalizeGeometry(geometry);
  applyColor(geometry, color);
  place(geometry, 0, 0, 0, Math.PI * 0.5);
  return geometry;
}

// ---------------------------------------------------------------------------
// Spider
// ---------------------------------------------------------------------------

export interface SpiderRig {
  root: Group;
  body: Object3D;
  /** 8 leg roots; each has .userData.restX/.restZ for the gait solver. */
  legs: Object3D[];
  /** Per-leg upper/lower segments the gait solver rotates. */
  legUpper: Object3D[];
  legLower: Object3D[];
  legFoot: Object3D[];
  furnace: Object3D;
  smokestacks: Object3D[];
  rackSockets: Object3D[];
  moduleSockets: Object3D[];
  dorsalMount: Object3D;
  /**
   * Integrated gait and furnace phases, in radians.
   *
   * Both must be integrated rather than computed as `clock * rate`. The spider's
   * speed is a step function - `speedMarch`, `speedOverdrive`, `speedFallback`
   * are assigned directly with no smoothing - so scaling a running clock by a
   * speed-derived rate makes every gear change jump the phase by
   * `elapsed * deltaRate`. Two minutes into a run that is ten complete gait
   * cycles in a single frame, and docking, which sets the rate to zero, snaps
   * the whole eight-leg set from wherever it was to zero at every checkpoint.
   */
  gaitPhase: number;
  furnacePhase: number;
  /** Smokestack sway (constant rate) and pump (steps with overdrive). */
  stackSwayPhase: number;
  stackPumpPhase: number;
}

const SPIDER_HIPS: readonly number[] = [1.65, 2.8, 1.72, 1.0, 1.72, -1.0, 1.65, -2.8];
const SPIDER_REACH: readonly number[] = [1.08, 0.86, 1.33, 0.44, 1.33, -0.44, 1.08, -0.86];
const SPIDER_HIP_Y = 2.4;
const FEMUR_LENGTH = 2.3;
const TIBIA_LENGTH = 3.6;
const FOOT_LENGTH = 0.45;
/**
 * Baked stance. The gait solver overwrites these every frame, but the numbers
 * are chosen so the femur clears the hull: the knee lands at roughly x 3.2,
 * y 4.2, a metre outside the deck edge and half a metre above it. A walker
 * whose femurs hide under its own deck reads as a table on posts.
 */
const REST_UPPER_X = -0.873;
const REST_LOWER_X = 2.48;
const REST_FOOT_X = -0.036;

function spiderHull(): BufferGeometry {
  const S = SPIDER_COLORS;
  const parts: BufferGeometry[] = [
    // Keel and lower chassis. The mass sits low so the machine reads heavy.
    place(taperedBox(2.6, 3.3, 0.7, 5.0, 6.0, 0.14, S.hullDark), 0, 1.2, -0.1),
    place(taperedBox(3.4, 4.3, 1.15, 6.2, 6.9, 0.16, S.hull), 0, 2.05, 0),
    place(taperedBox(4.5, 4.1, 1.0, 7.1, 6.5, 0.18, S.hullLight), 0, 3.05, 0),
    place(plate(4.3, 6.7, 0.2, 0.08, S.plate), 0, 3.62, 0),

    // Prow. From directly above the hull is a rectangle, so the nose has to
    // carry the whole "which way is forward" read on its own: a plan-view V of
    // brass, a raised cowl and a lamp housing that breaks the deck line.
    place(taperedBox(2.4, 3.0, 1.7, 2.3, 1.6, 0.16, S.plate), 0, 2.45, 3.7),
    place(taperedBox(1.9, 2.5, 0.55, 1.2, 0.8, 0.1, S.brassDark), 0, 1.72, 3.95),
    place(chamferedBox(1.5, 0.52, 0.3, 0.07, S.glass), 0, 3.12, 4.24),
    place(chamferedBox(1.5, 0.42, 0.6, 0.1, S.hullLight), 0, 3.55, 4.05),
    place(chamferedBox(1.9, 0.14, 0.26, 0.04, S.brass), -0.86, 3.73, 2.7, 0, -0.42, 0),
    place(chamferedBox(1.9, 0.14, 0.26, 0.04, S.brass), 0.86, 3.73, 2.7, 0, 0.42, 0),
    place(plate(1.5, 0.9, 0.18, 0.06, S.brass), 0, 3.72, 3.86),
    place(rivetLine(1.3, 7, 0.075, S.brass), 0, 3.82, 3.86),
    // Raised centre walkway and hatches, so the deck is not one dead plane.
    place(plate(1.0, 4.4, 0.13, 0.05, S.hullLight), 0, 3.76, 0.9),
    place(chamferedBox(0.13, 0.1, 4.4, 0.03, S.brassDark), 0.52, 3.83, 0.9),
    place(chamferedBox(0.13, 0.1, 4.4, 0.03, S.brassDark), -0.52, 3.83, 0.9),
    place(plate(0.8, 0.8, 0.11, 0.04, S.hullDark), 1.45, 3.76, -1.5),
    place(plate(0.8, 0.8, 0.11, 0.04, S.hullDark), -1.45, 3.76, -1.5),
    place(rivetRing(0.3, 8, 0.05, S.brass), 1.45, 3.83, -1.5),
    place(rivetRing(0.3, 8, 0.05, S.brass), -1.45, 3.83, -1.5),

    // Flank armour and rivet strips.
    place(chamferedBox(0.32, 1.55, 5.6, 0.09, S.plate), 2.18, 2.4, -0.25, 0, 0, 0.1),
    place(chamferedBox(0.32, 1.55, 5.6, 0.09, S.plate), -2.18, 2.4, -0.25, 0, 0, -0.1),
    // rx/rz pair turns the strip's run onto Z and its dome onto the outward
    // face; the sign of rx is what flips the dome to the correct flank.
    place(rivetLine(5.2, 13, 0.075, S.brass), 2.36, 3.02, -0.25, Math.PI * 0.5, 0, -Math.PI * 0.5),
    place(rivetLine(5.2, 13, 0.075, S.brass), -2.36, 3.02, -0.25, -Math.PI * 0.5, 0, Math.PI * 0.5),
    place(rivetLine(5.2, 13, 0.075, S.brassDark), 2.3, 1.85, -0.25, Math.PI * 0.5, 0, -Math.PI * 0.5),
    place(rivetLine(5.2, 13, 0.075, S.brassDark), -2.3, 1.85, -0.25, -Math.PI * 0.5, 0, Math.PI * 0.5),

    // Deck rail. A brass line around the whole silhouette, read from above.
    place(chamferedBox(4.34, 0.13, 0.13, 0.04, S.brass), 0, 3.76, 3.3),
    place(chamferedBox(4.34, 0.13, 0.13, 0.04, S.brass), 0, 3.76, -3.3),
    place(chamferedBox(0.13, 0.13, 6.7, 0.04, S.brass), 2.1, 3.76, 0),
    place(chamferedBox(0.13, 0.13, 6.7, 0.04, S.brass), -2.1, 3.76, 0),
    place(rivetRing(1.95, 16, 0.07, S.brass), 0, 3.73, -0.2),

    // Rear boiler drum. Tall, and pushed behind the midline on purpose.
    place(cylinderish(0.88, 0.88, 3.0, 10, S.plate), 0, 4.24, -1.4, Math.PI * 0.5),
    place(cylinderish(0.94, 0.94, 0.16, 10, S.brass), 0, 4.24, -0.2, Math.PI * 0.5),
    place(cylinderish(0.94, 0.94, 0.16, 10, S.brass), 0, 4.24, -1.4, Math.PI * 0.5),
    place(cylinderish(0.94, 0.94, 0.16, 10, S.brass), 0, 4.24, -2.6, Math.PI * 0.5),
    place(cylinderish(0.6, 0.7, 0.24, 10, S.brassDark), 0, 4.24, -2.94, Math.PI * 0.5),
    place(cylinderish(0.82, 0.72, 0.22, 10, S.brass), 0, 4.24, 0.06, Math.PI * 0.5),
    place(rivetRing(0.6, 10, 0.055, S.brassDark), 0, 4.24, 0.18, Math.PI * 0.5),
    place(sphereish(0.16, 6, S.brass), 0.55, 4.98, -1.9),
    place(pipe(0.1, 1.5, 6, S.pipe), 0.86, 4.24, -0.55, 0, 0, Math.PI * 0.5),

    // Flank pipe runs.
    place(pipe(0.11, 4.6, 6, S.pipe), 1.92, 3.74, -0.7, Math.PI * 0.5),
    place(pipe(0.11, 4.6, 6, S.pipe), -1.92, 3.74, -0.7, Math.PI * 0.5),
    place(cylinderish(0.16, 0.16, 0.3, 8, S.brassDark), 1.92, 3.74, 1.7, Math.PI * 0.5),
    place(cylinderish(0.16, 0.16, 0.3, 8, S.brassDark), -1.92, 3.74, 1.7, Math.PI * 0.5),

    // Forward deck: cradles only, nothing tall.
    place(plate(1.3, 1.3, 0.14, 0.05, S.hullDark), 1.45, 3.75, 1.45),
    place(plate(1.3, 1.3, 0.14, 0.05, S.hullDark), -1.45, 3.75, 1.45),
    place(chamferedBox(1.34, 0.2, 0.12, 0.04, S.brassDark), 1.45, 3.87, 2.05),
    place(chamferedBox(1.34, 0.2, 0.12, 0.04, S.brassDark), -1.45, 3.87, 2.05),
    place(chamferedBox(1.34, 0.2, 0.12, 0.04, S.brassDark), 1.45, 3.87, 0.85),
    place(chamferedBox(1.34, 0.2, 0.12, 0.04, S.brassDark), -1.45, 3.87, 0.85),

    // Module mounting pads, low on the flanks.
    place(plate(0.5, 0.9, 0.16, 0.05, S.hullDark), 2.24, 2.9, 1.3, 0, 0, 0.1),
    place(plate(0.5, 0.9, 0.16, 0.05, S.hullDark), -2.24, 2.9, 1.3, 0, 0, -0.1),
    place(plate(0.5, 0.9, 0.16, 0.05, S.hullDark), 2.24, 2.9, -1.5, 0, 0, 0.1),
    place(plate(0.5, 0.9, 0.16, 0.05, S.hullDark), -2.24, 2.9, -1.5, 0, 0, -0.1),

    // Dorsal turret ring.
    place(cylinderish(0.6, 0.54, 0.24, 10, S.brassDark), 0, 3.8, 0.35),
    place(rivetRing(0.48, 10, 0.055, S.brass), 0, 3.92, 0.35),

    // Rear firebox housing, headlamp cowl, exhaust manifold.
    place(taperedBox(3.0, 2.6, 1.3, 0.9, 0.7, 0.12, S.hullDark), 0, 2.25, -3.35),
    place(cylinderish(0.34, 0.38, 0.24, 10, S.brass), 0, 3.1, 4.06, Math.PI * 0.5),
    place(taperedBox(2.4, 1.9, 0.5, 1.0, 0.8, 0.1, S.plate), 0, 4.05, -3.1),
  ];

  // Coxa housings never move, so they belong to the hull, not to the legs.
  // Eight fewer meshes on the one object that can afford them least.
  for (let i = 0; i < 8; i++) {
    const pair = i >> 1;
    const side = i % 2 === 0 ? 1 : -1;
    const hipX = SPIDER_HIPS[pair * 2] * side;
    const hipZ = SPIDER_HIPS[pair * 2 + 1];
    const yaw = Math.atan2(SPIDER_REACH[pair * 2] * side, SPIDER_REACH[pair * 2 + 1]);
    parts.push(place(chamferedBox(0.7, 0.66, 0.62, 0.1, S.legJoint), hipX, SPIDER_HIP_Y, hipZ, 0, yaw, 0));
    parts.push(place(cylinderish(0.3, 0.3, 0.28, 8, S.brassDark), hipX, SPIDER_HIP_Y, hipZ, 0, 0, Math.PI * 0.5));
    parts.push(place(plate(0.62, 0.5, 0.1, 0.03, S.plate), hipX, SPIDER_HIP_Y + 0.36, hipZ, 0, yaw, 0));
  }

  return tint(merge(parts), 0.07, 101);
}

function spiderFemur(): BufferGeometry {
  const S = SPIDER_COLORS;
  return tint(
    merge([
      place(sphereish(0.32, 8, S.legJoint), 0, 0, 0),
      place(taperedBox(0.5, 0.42, FEMUR_LENGTH, 0.56, 0.46, 0.08, S.legShell), 0, 0, FEMUR_LENGTH * 0.5, Math.PI * 0.5),
      // A pale armour spine along the top edge. The femur is the one element
      // the eye uses to read the machine as a walker, so it needs contrast
      // against the hull it sits beside, not just a silhouette.
      place(plate(0.42, 1.8, 0.12, 0.04, S.hullLight), 0, 0.28, FEMUR_LENGTH * 0.5),
      place(rivetLine(1.5, 6, 0.055, S.brass), 0, 0.35, FEMUR_LENGTH * 0.5, 0, Math.PI * 0.5, 0),
      place(chamferedBox(0.1, 0.34, 1.5, 0.03, S.brassDark), 0.27, 0.06, FEMUR_LENGTH * 0.5),
      place(chamferedBox(0.1, 0.34, 1.5, 0.03, S.brassDark), -0.27, 0.06, FEMUR_LENGTH * 0.5),
      // Knee housing: the bright apex of the whole leg.
      place(cylinderish(0.34, 0.34, 0.52, 8, S.legJoint), 0, 0, FEMUR_LENGTH, 0, 0, Math.PI * 0.5),
      place(cylinderish(0.24, 0.24, 0.56, 8, S.brass), 0, 0, FEMUR_LENGTH, 0, 0, Math.PI * 0.5),
    ]),
    0.06,
    102,
  );
}

function spiderTibia(): BufferGeometry {
  const S = SPIDER_COLORS;
  return tint(
    merge([
      place(sphereish(0.27, 8, S.hullDark), 0, 0, 0),
      place(
        taperedBox(0.36, 0.22, TIBIA_LENGTH, 0.38, 0.24, 0.055, S.hullDark),
        0,
        0,
        TIBIA_LENGTH * 0.5,
        Math.PI * 0.5,
      ),
      place(cylinderish(0.24, 0.24, 0.14, 8, S.brassDark), 0, 0, TIBIA_LENGTH * 0.26, Math.PI * 0.5),
      place(cylinderish(0.19, 0.19, 0.12, 8, S.brassDark), 0, 0, TIBIA_LENGTH * 0.62, Math.PI * 0.5),
      place(chamferedBox(0.06, 0.2, 2.2, 0.02, S.legShell), 0, 0.16, TIBIA_LENGTH * 0.45),
      place(cylinderish(0.17, 0.17, 0.32, 8, S.legJoint), 0, 0, TIBIA_LENGTH, 0, 0, Math.PI * 0.5),
    ]),
    0.06,
    103,
  );
}

function spiderFoot(): BufferGeometry {
  const S = SPIDER_COLORS;
  return tint(
    merge([
      place(taperedBox(0.3, 0.22, FOOT_LENGTH, 0.32, 0.24, 0.05, S.legJoint), 0, 0, FOOT_LENGTH * 0.5, Math.PI * 0.5),
      // The leg's local +Z runs down the limb, so the sole plate and the claws
      // are rotated a quarter turn to face along it.
      place(plate(0.52, 0.62, 0.14, 0.05, S.hullDark), 0, 0, FOOT_LENGTH + 0.05, Math.PI * 0.5),
      place(coneish(0.09, 0.2, 5, S.brass), 0.17, 0, FOOT_LENGTH + 0.2, Math.PI * 0.5),
      place(coneish(0.09, 0.2, 5, S.brass), -0.17, 0, FOOT_LENGTH + 0.2, Math.PI * 0.5),
      place(coneish(0.09, 0.2, 5, S.brass), 0, 0.19, FOOT_LENGTH + 0.2, Math.PI * 0.5),
    ]),
    0.06,
    104,
  );
}

function spiderSmokestack(): BufferGeometry {
  const S = SPIDER_COLORS;
  return tint(
    merge([
      place(cylinderish(0.3, 0.22, 2.15, 8, S.pipe), 0, 1.08, 0),
      place(cylinderish(0.36, 0.36, 0.16, 8, S.brass), 0, 0.18, 0),
      place(cylinderish(0.27, 0.27, 0.1, 8, S.brassDark), 0, 1.3, 0),
      place(cylinderish(0.25, 0.4, 0.34, 8, S.brass), 0, 2.3, 0),
      place(cylinderish(0.42, 0.42, 0.08, 8, S.brassDark), 0, 2.5, 0),
      place(rivetRing(0.34, 8, 0.045, S.brassDark), 0, 0.26, 0),
    ]),
    0.06,
    105,
  );
}

function spiderFurnaceCore(): BufferGeometry {
  const S = SPIDER_COLORS;
  return merge([
    // Rear firebox door: the readable heat source when the camera trails.
    place(chamferedBox(1.6, 1.15, 0.22, 0.06, S.furnace), 0, 2.2, -3.94),
    // Deck vents. The furnace has to be visible from directly above too.
    place(plate(1.9, 0.2, 0.09, 0.03, S.furnace), 0, 3.71, -0.7),
    place(plate(1.9, 0.2, 0.09, 0.03, S.furnace), 0, 3.71, -1.2),
    place(plate(1.9, 0.2, 0.09, 0.03, S.furnace), 0, 3.71, -1.7),
    place(plate(1.9, 0.2, 0.09, 0.03, S.furnace), 0, 3.71, -2.2),
    // Belly and flank bleed.
    place(plate(2.2, 3.6, 0.14, 0.05, S.furnace), 0, 0.86, -0.4),
    place(chamferedBox(0.14, 0.22, 3.2, 0.05, S.furnace), 2.32, 2.32, -0.4),
    place(chamferedBox(0.14, 0.22, 3.2, 0.05, S.furnace), -2.32, 2.32, -0.4),
  ]);
}

export function buildSpider(materials: MaterialLibrary): SpiderRig {
  const S = SPIDER_COLORS;
  const root = new Group();
  root.name = "spider";

  const body = new Object3D();
  body.name = "body";
  root.add(body);
  body.add(meshOf(cached("spiderHull", spiderHull), materials.surface, "hull"));

  const headlamp = new Mesh(
    cached("spiderLamp", () => cylinderish(0.26, 0.26, 0.1, 10, S.furnaceHot)),
    materials.emissive(S.furnaceHot, 1.15),
  );
  headlamp.name = "headlamp";
  headlamp.position.set(0, 3.1, 4.17);
  headlamp.rotation.x = Math.PI * 0.5;
  body.add(headlamp);

  const furnace = new Object3D();
  furnace.name = "furnace";
  const furnaceMesh = new Mesh(
    cached("spiderFurnace", spiderFurnaceCore),
    materials.emissiveUnique(S.furnace, 1.0),
  );
  furnaceMesh.name = "furnaceGlow";
  furnace.add(furnaceMesh);
  const emberMesh = new Mesh(
    cached("spiderEmbers", () =>
      merge([
        place(chamferedBox(1.15, 0.7, 0.14, 0.04, S.furnaceHot), 0, 2.2, -4.0),
        place(plate(1.4, 2.6, 0.08, 0.03, S.furnaceHot), 0, 0.84, -0.4),
      ]),
    ),
    materials.emissiveUnique(S.furnaceHot, 1.0),
  );
  emberMesh.name = "furnaceEmbers";
  furnace.add(emberMesh);
  body.add(furnace);

  const stackGeometry = cached("spiderStack", spiderSmokestack);
  const smokestacks: Object3D[] = [];
  const stackPositions = [-1.15, 3.72, -2.35, 0, 3.72, -3.0, 1.15, 3.72, -2.35];
  for (let i = 0; i < 3; i++) {
    const stack = new Object3D();
    stack.name = `smokestack${i}`;
    stack.position.set(stackPositions[i * 3], stackPositions[i * 3 + 1], stackPositions[i * 3 + 2]);
    stack.add(meshOf(stackGeometry, materials.surface, "stack"));
    body.add(stack);
    smokestacks.push(stack);
  }

  const femurGeometry = cached("spiderFemur", spiderFemur);
  const tibiaGeometry = cached("spiderTibia", spiderTibia);
  const footGeometry = cached("spiderFoot", spiderFoot);

  const legs: Object3D[] = [];
  const legUpper: Object3D[] = [];
  const legLower: Object3D[] = [];
  const legFoot: Object3D[] = [];

  for (let i = 0; i < 8; i++) {
    const pair = i >> 1;
    const side = i % 2 === 0 ? 1 : -1;
    const hipX = SPIDER_HIPS[pair * 2] * side;
    const hipZ = SPIDER_HIPS[pair * 2 + 1];
    const outX = SPIDER_REACH[pair * 2] * side;
    const outZ = SPIDER_REACH[pair * 2 + 1];

    const leg = new Object3D();
    leg.name = `leg${i}`;
    leg.position.set(hipX, SPIDER_HIP_Y, hipZ);
    leg.rotation.y = Math.atan2(outX, outZ);
    leg.userData.restX = hipX + outX;
    leg.userData.restZ = hipZ + outZ;
    leg.userData.hipX = hipX;
    leg.userData.hipZ = hipZ;
    leg.userData.hipY = SPIDER_HIP_Y;
    leg.userData.femurLength = FEMUR_LENGTH;
    leg.userData.tibiaLength = TIBIA_LENGTH;
    leg.userData.footLength = FOOT_LENGTH;
    leg.userData.side = side;
    leg.userData.pair = pair;
    body.add(leg);

    const upper = new Object3D();
    upper.name = `legUpper${i}`;
    upper.rotation.x = REST_UPPER_X;
    upper.add(meshOf(femurGeometry, materials.surface, "femur"));
    leg.add(upper);

    const lower = new Object3D();
    lower.name = `legLower${i}`;
    lower.position.set(0, 0, FEMUR_LENGTH);
    lower.rotation.x = REST_LOWER_X;
    lower.add(meshOf(tibiaGeometry, materials.surface, "tibia"));
    upper.add(lower);

    const foot = new Object3D();
    foot.name = `legFoot${i}`;
    foot.position.set(0, 0, TIBIA_LENGTH);
    foot.rotation.x = REST_FOOT_X;
    foot.add(meshOf(footGeometry, materials.surface, "foot"));
    lower.add(foot);

    legs.push(leg);
    legUpper.push(upper);
    legLower.push(lower);
    legFoot.push(foot);
  }

  const rackSockets: Object3D[] = [];
  for (let i = 0; i < 2; i++) {
    const socket = new Object3D();
    socket.name = `rack${i}`;
    socket.position.set(i === 0 ? -1.45 : 1.45, 3.82, 1.45);
    body.add(socket);
    rackSockets.push(socket);
  }

  const moduleSockets: Object3D[] = [];
  const modulePositions = [2.34, 2.9, 1.3, -2.34, 2.9, 1.3, 2.34, 2.9, -1.5, -2.34, 2.9, -1.5];
  for (let i = 0; i < 4; i++) {
    const socket = new Object3D();
    socket.name = `module${i}`;
    socket.position.set(modulePositions[i * 3], modulePositions[i * 3 + 1], modulePositions[i * 3 + 2]);
    socket.rotation.z = modulePositions[i * 3] > 0 ? 0.1 : -0.1;
    body.add(socket);
    moduleSockets.push(socket);
  }

  const dorsalMount = new Object3D();
  dorsalMount.name = "dorsalMount";
  dorsalMount.position.set(0, 3.94, 0.35);
  body.add(dorsalMount);

  return {
    root,
    body,
    legs,
    legUpper,
    legLower,
    legFoot,
    furnace,
    smokestacks,
    rackSockets,
    moduleSockets,
    dorsalMount,
    gaitPhase: 0,
    furnacePhase: 0,
    stackSwayPhase: 0,
    stackPumpPhase: 0,
  };
}

// ---------------------------------------------------------------------------
// Rivet turret
// ---------------------------------------------------------------------------

export interface TurretRig {
  root: Group;
  /** Yaws to aim. */
  yoke: Object3D;
  /** Pitches slightly and recoils. */
  barrel: Object3D;
  /** World position source for the muzzle flash. */
  muzzle: Object3D;
  /** Folds down for the carry/folded state. */
  legs: Object3D[];
  /** Pressure buffer indicator; the render layer scales and colours it. */
  gauge: Object3D;
}

function turretBase(): BufferGeometry {
  const C = STRUCTURE_COLORS;
  return tint(
    merge([
      place(cylinderish(0.84, 0.74, 0.2, 8, C.footing), 0, 0.1, 0),
      place(rivetRing(0.62, 8, 0.045, PLAYER_COLORS.brass), 0, 0.21, 0),
      place(cylinderish(0.36, 0.3, 0.62, 8, C.footingDark), 0, 0.48, 0),
      place(cylinderish(0.4, 0.4, 0.08, 8, PLAYER_COLORS.brassDark), 0, 0.24, 0),
      place(cylinderish(0.4, 0.4, 0.08, 8, PLAYER_COLORS.brassDark), 0, 0.78, 0),
    ]),
    0.06,
    111,
  );
}

function turretLeg(): BufferGeometry {
  const C = STRUCTURE_COLORS;
  return tint(
    merge([
      place(taperedBox(0.14, 0.22, 0.54, 0.19, 0.26, 0.04, C.footingDark), 0, -0.08, 0.28, 1.25),
      place(plate(0.3, 0.3, 0.1, 0.03, C.footing), 0, -0.22, 0.52),
      place(rivetRing(0.1, 5, 0.026, PLAYER_COLORS.brass), 0, -0.16, 0.52),
      place(cylinderish(0.1, 0.1, 0.2, 6, PLAYER_COLORS.brassDark), 0, 0, 0.06, 0, 0, Math.PI * 0.5),
    ]),
    0.06,
    112,
  );
}

function turretYoke(): BufferGeometry {
  const C = STRUCTURE_COLORS;
  return tint(
    merge([
      place(chamferedBox(0.62, 0.44, 0.7, 0.1, C.turretBody), 0, 0.03, 0),
      place(chamferedBox(0.11, 0.36, 0.52, 0.04, C.turretBodyDark), 0.33, 0.03, -0.02),
      place(chamferedBox(0.11, 0.36, 0.52, 0.04, C.turretBodyDark), -0.33, 0.03, -0.02),
      place(plate(0.5, 0.56, 0.08, 0.03, C.turretBodyDark), 0, 0.25, -0.04),
      place(rivetRing(0.19, 8, 0.028, PLAYER_COLORS.brass), 0, 0.29, -0.04),
      place(cylinderish(0.2, 0.2, 0.28, 10, PLAYER_COLORS.brass), -0.44, 0.02, -0.16, 0, 0, Math.PI * 0.5),
      place(cylinderish(0.21, 0.21, 0.05, 10, PLAYER_COLORS.brassDark), -0.3, 0.02, -0.16, 0, 0, Math.PI * 0.5),
      place(chamferedBox(0.32, 0.28, 0.24, 0.05, C.footingDark), 0, 0.02, -0.4),
      place(cylinderish(0.16, 0.16, 0.72, 8, PLAYER_COLORS.steelDark), 0, 0.03, 0.1, 0, 0, Math.PI * 0.5),
    ]),
    0.06,
    113,
  );
}

function turretBarrel(): BufferGeometry {
  const C = STRUCTURE_COLORS;
  return tint(
    merge([
      place(chamferedBox(0.3, 0.27, 0.38, 0.05, C.turretBarrel), 0, 0, 0.08),
      place(cylinderish(0.064, 0.06, 0.72, 8, C.turretBarrel), 0.087, 0, 0.5, Math.PI * 0.5),
      place(cylinderish(0.064, 0.06, 0.72, 8, C.turretBarrel), -0.087, 0, 0.5, Math.PI * 0.5),
      place(plate(0.28, 0.06, 0.1, 0.02, C.turretBarrel), 0, 0.13, 0.34),
      place(plate(0.28, 0.06, 0.1, 0.02, C.turretBarrel), 0, 0.13, 0.5),
      place(cylinderish(0.1, 0.112, 0.1, 8, PLAYER_COLORS.brass), 0, 0, 0.87, Math.PI * 0.5),
      place(cylinderish(0.075, 0.075, 0.06, 8, PLAYER_COLORS.brassDark), 0, 0, 0.79, Math.PI * 0.5),
    ]),
    0.06,
    114,
  );
}

export function buildRivetTurret(materials: MaterialLibrary): TurretRig {
  const root = new Group();
  root.name = "rivetTurret";
  root.add(meshOf(cached("turretBase", turretBase), materials.surface, "base"));

  const legGeometry = cached("turretLeg", turretLeg);
  const legs: Object3D[] = [];
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + Math.PI;
    const leg = new Object3D();
    leg.name = `leg${i}`;
    leg.position.set(Math.sin(angle) * 0.5, 0.18, Math.cos(angle) * 0.5);
    leg.rotation.y = angle;
    leg.add(meshOf(legGeometry, materials.surface, "strut"));
    root.add(leg);
    legs.push(leg);
  }

  const gauge = new Object3D();
  gauge.name = "gauge";
  gauge.position.set(0, 0.66, 0);
  const gaugeMesh = new Mesh(
    cached("turretGauge", () => cylinderish(0.32, 0.32, 0.12, 12, FEEDBACK.network)),
    materials.emissiveUnique(FEEDBACK.network, 1.0),
  );
  gaugeMesh.name = "gaugeRing";
  gauge.add(gaugeMesh);
  root.add(gauge);

  const yoke = new Object3D();
  yoke.name = "yoke";
  yoke.position.set(0, 1.02, 0);
  yoke.add(meshOf(cached("turretYoke", turretYoke), materials.surface, "yoke"));
  root.add(yoke);

  const barrel = new Object3D();
  barrel.name = "barrel";
  barrel.position.set(0, 0.13, 0.16);
  barrel.add(meshOf(cached("turretBarrel", turretBarrel), materials.surface, "barrel"));
  yoke.add(barrel);

  const muzzle = new Object3D();
  muzzle.name = "muzzle";
  muzzle.position.set(0, 0, 0.94);
  barrel.add(muzzle);

  return { root, yoke, barrel, muzzle, legs, gauge };
}

// ---------------------------------------------------------------------------
// Relay
// ---------------------------------------------------------------------------

function relayBase(): BufferGeometry {
  const C = STRUCTURE_COLORS;
  return tint(
    merge([
      place(cylinderish(0.68, 0.6, 0.18, 8, C.footing), 0, 0.09, 0),
      place(rivetRing(0.5, 8, 0.04, PLAYER_COLORS.brass), 0, 0.19, 0),
      place(chamferedBox(0.42, 0.34, 0.4, 0.07, C.relayBody), 0, 0.36, 0),
      place(cylinderish(0.15, 0.12, 0.86, 8, C.relayBody), 0, 0.95, 0),
      place(cylinderish(0.19, 0.19, 0.07, 8, PLAYER_COLORS.brassDark), 0, 0.58, 0),
      place(chamferedBox(0.2, 0.16, 0.14, 0.03, PLAYER_COLORS.brass), 0.2, 0.4, 0.15),
    ]),
    0.06,
    121,
  );
}

function relayDish(): BufferGeometry {
  const C = STRUCTURE_COLORS;
  return tint(
    merge([
      // Kept narrow on purpose: a wide dish becomes an opaque lid from above
      // and hides the mast, the ring and anything standing behind the relay.
      place(cylinderish(0.12, 0.34, 0.2, 10, C.relayBody), 0, 0.1, 0),
      place(cylinderish(0.3, 0.3, 0.05, 10, PLAYER_COLORS.brassDark), 0, 0.21, 0),
      place(cylinderish(0.045, 0.045, 0.26, 6, PLAYER_COLORS.brass), 0, 0.3, 0),
      place(sphereish(0.075, 6, C.relayAccent), 0, 0.44, 0),
      place(chamferedBox(0.08, 0.05, 0.4, 0.018, PLAYER_COLORS.brassDark), 0.2, 0.14, 0),
      place(chamferedBox(0.08, 0.05, 0.4, 0.018, PLAYER_COLORS.brassDark), -0.2, 0.14, 0),
    ]),
    0.06,
    122,
  );
}

export function buildRelay(materials: MaterialLibrary): {
  root: Group;
  dish: Object3D;
  ring: Object3D;
  gauge: Object3D;
} {
  const C = STRUCTURE_COLORS;
  const root = new Group();
  root.name = "relay";
  root.add(meshOf(cached("relayBase", relayBase), materials.surface, "base"));

  const dish = new Object3D();
  dish.name = "dish";
  dish.position.set(0, 1.38, 0);
  dish.add(meshOf(cached("relayDish", relayDish), materials.surface, "dish"));
  root.add(dish);

  const ring = new Object3D();
  ring.name = "ring";
  ring.position.set(0, 1.16, 0);
  const ringMesh = new Mesh(
    cached("relayRing", () => ringGeometry(0.62, 0.05, C.relayAccent)),
    materials.emissiveUnique(C.relayAccent, 1.2),
  );
  ringMesh.name = "ringGlow";
  ring.add(ringMesh);
  root.add(ring);

  const gauge = new Object3D();
  gauge.name = "gauge";
  gauge.position.set(0, 0.58, 0);
  const gaugeMesh = new Mesh(
    cached("relayGauge", () => cylinderish(0.2, 0.2, 0.1, 10, FEEDBACK.network)),
    materials.emissiveUnique(FEEDBACK.network, 1.0),
  );
  gaugeMesh.name = "gaugeRing";
  gauge.add(gaugeMesh);
  root.add(gauge);

  return { root, dish, ring, gauge };
}

// ---------------------------------------------------------------------------
// Barricade and mine
// ---------------------------------------------------------------------------

/** Hand-picked plank cants. Deterministic, so every barricade matches. */
const PLANK_TILT: readonly number[] = [0.035, -0.028, 0.042, -0.018];

function barricadeGeometry(): BufferGeometry {
  const C = STRUCTURE_COLORS;
  const parts: BufferGeometry[] = [
    place(plate(2.3, 0.8, 0.14, 0.05, C.footing), 0, 0.07, 0),
    place(taperedBox(0.24, 0.19, 1.15, 0.26, 0.21, 0.04, C.barricadeWoodDark), 0.94, 0.6, 0, 0, 0, 0.06),
    place(taperedBox(0.24, 0.19, 1.15, 0.26, 0.21, 0.04, C.barricadeWoodDark), -0.94, 0.6, 0, 0, 0, -0.06),
  ];
  for (let i = 0; i < 4; i++) {
    parts.push(
      place(chamferedBox(1.95, 0.22, 0.15, 0.035, C.barricadeWood), 0, 0.3 + i * 0.28, 0.02, 0, 0, PLANK_TILT[i]),
    );
  }
  parts.push(place(chamferedBox(0.11, 1.2, 0.09, 0.025, C.barricadeMetal), 0.5, 0.65, 0.11, 0, 0, 0.5));
  parts.push(place(chamferedBox(0.11, 1.2, 0.09, 0.025, C.barricadeMetal), -0.5, 0.65, 0.11, 0, 0, -0.5));
  parts.push(place(rivetLine(1.7, 6, 0.045, PLAYER_COLORS.steelDark), 0, 0.86, 0.11));
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 0.6;
    parts.push(place(coneish(0.09, 0.42, 5, C.barricadeMetal), x, 1.32, 0.06, 0.32));
  }
  parts.push(place(chamferedBox(0.5, 0.34, 0.4, 0.08, ENV.rustMetal), 0.72, 0.24, 0.34, 0, 0.4, 0));
  parts.push(place(chamferedBox(0.44, 0.3, 0.36, 0.07, ENV.rustMetalDark), -0.78, 0.22, -0.3, 0, -0.3, 0));
  return tint(merge(parts), 0.08, 131);
}

export function buildBarricade(materials: MaterialLibrary): Group {
  const root = new Group();
  root.name = "barricade";
  root.add(meshOf(cached("barricade", barricadeGeometry), materials.surface, "barricade"));
  return root;
}

function mineShell(): BufferGeometry {
  const C = STRUCTURE_COLORS;
  return tint(
    merge([
      place(cylinderish(0.42, 0.36, 0.06, 10, C.footingDark), 0, 0.03, 0),
      place(cylinderish(0.34, 0.3, 0.17, 10, C.mineShell), 0, 0.14, 0),
      place(cylinderish(0.32, 0.32, 0.04, 10, PLAYER_COLORS.brassDark), 0, 0.23, 0),
      place(sphereish(0.22, 8, C.mineShell), 0, 0.24, 0, 0, 0, 0, 1, 0.55, 1),
      place(rivetRing(0.27, 8, 0.033, PLAYER_COLORS.brass), 0, 0.22, 0),
      place(cylinderish(0.05, 0.04, 0.16, 6, PLAYER_COLORS.steel), 0.19, 0.32, 0.1, 0.4, 0, 0.4),
      place(cylinderish(0.05, 0.04, 0.16, 6, PLAYER_COLORS.steel), -0.19, 0.32, 0.1, 0.4, 0, -0.4),
      place(cylinderish(0.05, 0.04, 0.16, 6, PLAYER_COLORS.steel), 0, 0.32, -0.21, -0.4, 0, 0),
    ]),
    0.06,
    141,
  );
}

export function buildMine(materials: MaterialLibrary): { root: Group; light: Object3D } {
  const C = STRUCTURE_COLORS;
  const root = new Group();
  root.name = "mine";
  root.add(meshOf(cached("mineShell", mineShell), materials.surface, "shell"));

  const light = new Object3D();
  light.name = "light";
  light.position.set(0, 0.35, 0);
  const lightMesh = new Mesh(
    cached("mineLight", () =>
      merge([
        place(cylinderish(0.1, 0.09, 0.06, 8, C.mineLight), 0, 0, 0),
        place(sphereish(0.05, 6, C.mineLight), 0.21, -0.02, 0.11),
        place(sphereish(0.05, 6, C.mineLight), -0.21, -0.02, 0.11),
        place(sphereish(0.05, 6, C.mineLight), 0, -0.02, -0.23),
      ]),
    ),
    materials.emissiveUnique(C.mineLight, 1.25),
  );
  lightMesh.name = "lightGlow";
  light.add(lightMesh);
  root.add(light);
  return { root, light };
}

// ---------------------------------------------------------------------------
// Folded / carried silhouettes
// ---------------------------------------------------------------------------

function foldedTurretGeometry(): BufferGeometry {
  const C = STRUCTURE_COLORS;
  return tint(
    merge([
      place(chamferedBox(0.78, 0.44, 0.68, 0.08, C.turretBody), 0, 0.24, 0),
      place(plate(0.84, 0.74, 0.09, 0.03, C.turretBodyDark), 0, 0.47, 0),
      place(plate(0.84, 0.74, 0.09, 0.03, C.footingDark), 0, 0.03, 0),
      place(chamferedBox(0.09, 0.5, 0.09, 0.025, PLAYER_COLORS.brass), 0.37, 0.24, 0.31),
      place(chamferedBox(0.09, 0.5, 0.09, 0.025, PLAYER_COLORS.brass), -0.37, 0.24, 0.31),
      place(chamferedBox(0.09, 0.5, 0.09, 0.025, PLAYER_COLORS.brass), 0.37, 0.24, -0.31),
      place(chamferedBox(0.09, 0.5, 0.09, 0.025, PLAYER_COLORS.brass), -0.37, 0.24, -0.31),
      place(cylinderish(0.06, 0.055, 0.66, 8, C.turretBarrel), 0.11, 0.54, 0, Math.PI * 0.5),
      place(cylinderish(0.06, 0.055, 0.66, 8, C.turretBarrel), -0.11, 0.54, 0, Math.PI * 0.5),
      place(cylinderish(0.16, 0.16, 0.2, 8, PLAYER_COLORS.brassDark), 0, 0.24, 0.36, Math.PI * 0.5),
      place(rivetLine(0.6, 4, 0.035, PLAYER_COLORS.brassDark), 0, 0.52, 0.26),
    ]),
    0.06,
    151,
  );
}

function foldedRelayGeometry(): BufferGeometry {
  const C = STRUCTURE_COLORS;
  return tint(
    merge([
      place(chamferedBox(0.7, 0.5, 0.6, 0.08, C.relayBody), 0, 0.27, 0),
      place(plate(0.76, 0.66, 0.09, 0.03, PLAYER_COLORS.steelDark), 0, 0.53, 0),
      place(plate(0.76, 0.66, 0.09, 0.03, C.footingDark), 0, 0.03, 0),
      place(cylinderish(0.24, 0.44, 0.14, 12, C.relayBody), 0, 0.62, 0),
      place(cylinderish(0.42, 0.42, 0.05, 12, C.relayAccent), 0, 0.7, 0),
      place(chamferedBox(0.08, 0.44, 0.08, 0.02, PLAYER_COLORS.brass), 0.33, 0.27, 0.27),
      place(chamferedBox(0.08, 0.44, 0.08, 0.02, PLAYER_COLORS.brass), -0.33, 0.27, 0.27),
      place(chamferedBox(0.08, 0.44, 0.08, 0.02, PLAYER_COLORS.brass), 0.33, 0.27, -0.27),
      place(chamferedBox(0.08, 0.44, 0.08, 0.02, PLAYER_COLORS.brass), -0.33, 0.27, -0.27),
    ]),
    0.06,
    152,
  );
}

function foldedBarricadeGeometry(): BufferGeometry {
  const C = STRUCTURE_COLORS;
  const parts: BufferGeometry[] = [
    place(plate(0.8, 0.66, 0.1, 0.03, C.footingDark), 0, 0.05, 0),
    place(chamferedBox(0.12, 0.34, 0.7, 0.03, C.barricadeMetal), 0, 0.28, 0, 0, 0, Math.PI * 0.5),
  ];
  for (let i = 0; i < 4; i++) {
    parts.push(
      place(chamferedBox(0.72, 0.14, 0.16, 0.03, C.barricadeWood), 0, 0.17 + i * 0.16, (i % 2) * 0.06 - 0.03),
    );
  }
  parts.push(place(rivetLine(0.5, 4, 0.035, PLAYER_COLORS.steelDark), 0, 0.5, 0.09));
  return tint(merge(parts), 0.07, 153);
}

function foldedMineGeometry(): BufferGeometry {
  const C = STRUCTURE_COLORS;
  return tint(
    merge([
      place(chamferedBox(0.56, 0.42, 0.5, 0.06, ENV.rustMetal), 0, 0.23, 0),
      place(plate(0.62, 0.56, 0.08, 0.025, C.footingDark), 0, 0.03, 0),
      place(plate(0.62, 0.56, 0.08, 0.025, ENV.rustMetalDark), 0, 0.45, 0),
      place(cylinderish(0.14, 0.13, 0.1, 8, C.mineShell), 0.14, 0.5, 0.12),
      place(cylinderish(0.14, 0.13, 0.1, 8, C.mineShell), -0.14, 0.5, -0.1),
      place(chamferedBox(0.08, 0.36, 0.08, 0.02, PLAYER_COLORS.brass), 0.26, 0.23, 0.22),
      place(chamferedBox(0.08, 0.36, 0.08, 0.02, PLAYER_COLORS.brass), -0.26, 0.23, -0.22),
    ]),
    0.07,
    154,
  );
}

/** The carried silhouette for any deployable. */
export function buildFoldedStructure(materials: MaterialLibrary, kind: string): Group {
  const root = new Group();
  root.name = `folded_${kind}`;
  let geometry: BufferGeometry;
  if (kind === "relay") geometry = cached("foldedRelay", foldedRelayGeometry);
  else if (kind === "barricade") geometry = cached("foldedBarricade", foldedBarricadeGeometry);
  else if (kind === "mine") geometry = cached("foldedMine", foldedMineGeometry);
  else geometry = cached("foldedTurret", foldedTurretGeometry);
  root.add(meshOf(geometry, materials.surface, "folded"));
  return root;
}

export function buildFoldedTurret(materials: MaterialLibrary): Group {
  return buildFoldedStructure(materials, "rivetTurret");
}

// ---------------------------------------------------------------------------
// Pickups
// ---------------------------------------------------------------------------

function cylinderPickup(): BufferGeometry {
  const P = PLAYER_COLORS;
  return tint(
    merge([
      place(cylinderish(0.17, 0.17, 0.46, 10, P.steel), 0, 0.25, 0),
      place(cylinderish(0.15, 0.05, 0.13, 10, P.steel), 0, 0.53, 0),
      place(cylinderish(0.18, 0.18, 0.05, 10, P.steelDark), 0, 0.03, 0),
      place(cylinderish(0.185, 0.185, 0.05, 10, FEEDBACK.fuel), 0, 0.36, 0),
      place(cylinderish(0.185, 0.185, 0.05, 10, FEEDBACK.fuel), 0, 0.14, 0),
      place(cylinderish(0.06, 0.06, 0.1, 8, P.brass), 0, 0.62, 0),
      place(cylinderish(0.11, 0.11, 0.035, 8, P.brass), 0, 0.67, 0),
      place(chamferedBox(0.06, 0.05, 0.14, 0.015, P.brassDark), 0, 0.64, 0.08),
    ]),
    0.06,
    161,
  );
}

function jerrycanPickup(large: boolean): BufferGeometry {
  const P = PLAYER_COLORS;
  if (large) {
    return tint(
      merge([
        place(cylinderish(0.32, 0.32, 0.72, 12, P.steelDark), 0, 0.38, 0),
        place(cylinderish(0.34, 0.34, 0.07, 12, FEEDBACK.fuel), 0, 0.22, 0),
        place(cylinderish(0.34, 0.34, 0.07, 12, FEEDBACK.fuel), 0, 0.54, 0),
        place(cylinderish(0.28, 0.28, 0.06, 12, P.steel), 0, 0.75, 0),
        place(cylinderish(0.09, 0.09, 0.08, 8, P.brass), 0.12, 0.79, 0),
        place(rivetRing(0.26, 8, 0.035, P.brassDark), 0, 0.77, 0),
      ]),
      0.06,
      162,
    );
  }
  return tint(
    merge([
      place(chamferedBox(0.24, 0.36, 0.16, 0.035, P.steelDark), 0, 0.2, 0),
      place(plate(0.18, 0.13, 0.04, 0.015, P.steel), 0.09, 0.2, 0, 0, 0, Math.PI * 0.5),
      place(plate(0.18, 0.13, 0.04, 0.015, P.steel), -0.09, 0.2, 0, 0, 0, Math.PI * 0.5),
      place(chamferedBox(0.16, 0.05, 0.05, 0.015, P.steel), 0, 0.4, -0.03),
      place(cylinderish(0.05, 0.05, 0.07, 8, FEEDBACK.fuel), 0.07, 0.41, 0.04),
      place(chamferedBox(0.14, 0.14, 0.04, 0.012, FEEDBACK.fuel), 0, 0.22, 0.085),
    ]),
    0.06,
    163,
  );
}

/** Offsets, rotations and sizes for scrap chunks. Fixed, so piles are stable. */
const SCRAP_CHUNKS: readonly number[] = [
  0.0, 0.09, 0.0, 0.4, 0.26, 0.22, 0.3,
  0.18, 0.07, 0.11, -0.7, 0.19, 0.16, 0.24,
  -0.16, 0.08, 0.14, 1.1, 0.21, 0.14, 0.18,
  0.09, 0.19, -0.12, 0.5, 0.18, 0.12, 0.2,
  -0.13, 0.16, -0.14, -1.3, 0.16, 0.13, 0.22,
  0.2, 0.2, 0.06, 2.0, 0.15, 0.11, 0.16,
  -0.05, 0.27, 0.03, 0.9, 0.14, 0.1, 0.15,
];

function scrapPileGeometry(large: boolean): BufferGeometry {
  const P = PLAYER_COLORS;
  const chunkColors = [P.steel, ENV.rustMetal, P.steelDark, ENV.rustMetalDark];
  const count = large ? 7 : 4;
  const scale = large ? 1.35 : 0.85;
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const o = i * 7;
    parts.push(
      place(
        chamferedBox(
          SCRAP_CHUNKS[o + 4] * scale,
          SCRAP_CHUNKS[o + 5] * scale,
          SCRAP_CHUNKS[o + 6] * scale,
          0.02,
          chunkColors[i % 4],
        ),
        SCRAP_CHUNKS[o] * scale,
        SCRAP_CHUNKS[o + 1] * scale,
        SCRAP_CHUNKS[o + 2] * scale,
        SCRAP_CHUNKS[o + 3] * 0.4,
        SCRAP_CHUNKS[o + 3],
        SCRAP_CHUNKS[o + 3] * 0.25,
      ),
    );
  }
  // One brass cog per pile, so scrap always carries the economy's accent hue.
  parts.push(
    place(cylinderish(0.14 * scale, 0.14 * scale, 0.05 * scale, 8, FEEDBACK.scrap), 0.06 * scale, 0.3 * scale, -0.05, 0.5, 0, 0.35),
  );
  parts.push(place(rivetRing(0.11 * scale, 6, 0.026 * scale, P.brassDark), 0.06 * scale, 0.32 * scale, -0.05, 0.5, 0, 0.35));
  return tint(merge(parts), 0.09, large ? 171 : 172);
}

export function buildCylinder(materials: MaterialLibrary): Group {
  const root = new Group();
  root.name = "cylinder";
  root.add(meshOf(cached("pickupCylinder", cylinderPickup), materials.surface, "cylinder"));
  return root;
}

export function buildJerrycan(materials: MaterialLibrary): Group {
  const root = new Group();
  root.name = "jerrycan";
  root.add(meshOf(cached("pickupJerrycan", () => jerrycanPickup(false)), materials.surface, "jerrycan"));
  return root;
}

export function buildFuelBarrel(materials: MaterialLibrary): Group {
  const root = new Group();
  root.name = "fuelBarrel";
  root.add(meshOf(cached("pickupBarrel", () => jerrycanPickup(true)), materials.surface, "barrel"));
  return root;
}

export function buildScrapPile(materials: MaterialLibrary, large: boolean): Group {
  const root = new Group();
  root.name = large ? "scrapLarge" : "scrap";
  root.add(
    meshOf(
      cached(large ? "scrapLarge" : "scrapSmall", () => scrapPileGeometry(large)),
      materials.surface,
      "scrap",
    ),
  );
  return root;
}

// ---------------------------------------------------------------------------
// Projectile
// ---------------------------------------------------------------------------

/** A rivet, authored pointing along +Z so it can be oriented to its velocity. */
export function buildProjectileGeometry(): BufferGeometry {
  const P = PLAYER_COLORS;
  return cached("projectile", () =>
    merge([
      place(cylinderish(0.05, 0.042, 0.18, 6, P.brass), 0, 0, -0.02, Math.PI * 0.5),
      place(coneish(0.042, 0.1, 6, P.brassDark), 0, 0, 0.12, -Math.PI * 0.5),
      place(cylinderish(0.062, 0.062, 0.035, 6, P.brassDark), 0, 0, -0.1, Math.PI * 0.5),
    ]),
  );
}
