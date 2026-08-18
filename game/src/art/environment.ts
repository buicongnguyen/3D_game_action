/**
 * Instanceable scatter props and the two authored landmarks.
 *
 * The scatter builders return raw geometry rather than meshes because the
 * render layer feeds them to InstancedMesh: a few thousand trees, rocks and
 * grass tufts have to cost a handful of draw calls, so nothing here may assume
 * it owns a Mesh or a transform.
 *
 * Silhouette discipline: every prop is either clearly taller than the engineer
 * or clearly shorter than his knee. Anything in between competes with enemies
 * for attention at the top-down read and gets misparsed as a threat.
 */

import { Group, Mesh, Object3D } from "three";
import type { BufferGeometry } from "three";
import type { Random } from "../core/Random.ts";
import { ENV, FEEDBACK, PLAYER_COLORS, SPIDER_COLORS } from "./palette.ts";
import type { MaterialLibrary } from "./materials.ts";
import {
  chamferedBox,
  coneish,
  cylinderish,
  jitter,
  merge,
  place,
  plate,
  rivetRing,
  sphereish,
  taperedBox,
  tint,
} from "./geometry.ts";

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

export function buildTreeGeometry(variant: number, random: Random): BufferGeometry {
  const kind = variant % 3;
  const parts: BufferGeometry[] = [];
  const lean = random.signed(0.05);

  if (kind === 0) {
    // Conifer: three stacked skirts. Reads as a triangle from every angle.
    const height = random.range(4.6, 6.4);
    const trunkH = height * 0.32;
    parts.push(place(taperedBox(0.46, 0.28, trunkH, 0.46, 0.28, 0.07, ENV.treeTrunk), 0, trunkH * 0.5, 0));
    parts.push(place(taperedBox(0.7, 0.5, 0.3, 0.7, 0.5, 0.08, ENV.treeTrunkDark), 0, 0.13, 0));
    const skirts = 3;
    for (let i = 0; i < skirts; i++) {
      const t = i / (skirts - 1);
      const wide = 2.35 - t * 1.35;
      const y = trunkH * 0.72 + t * height * 0.5;
      const tall = height * 0.3 - t * height * 0.05;
      const color = i === 0 ? ENV.foliageDeep : i === 1 ? ENV.foliageMid : ENV.foliageLight;
      parts.push(
        place(
          taperedBox(wide, wide * 0.42, tall, wide, wide * 0.42, 0.12, color),
          random.signed(0.08),
          y,
          random.signed(0.08),
          0,
          random.angle(),
          0,
        ),
      );
    }
    parts.push(place(coneish(0.34, 0.9, 5, ENV.foliageLight), 0, height * 0.94, 0));
  } else if (kind === 1) {
    // Broadleaf: a chunky three-lobe canopy on a leaning trunk.
    const height = random.range(3.8, 5.2);
    const trunkH = height * 0.52;
    parts.push(
      place(taperedBox(0.5, 0.32, trunkH, 0.5, 0.32, 0.08, ENV.treeTrunk), 0, trunkH * 0.5, 0, lean, 0, lean * 0.6),
    );
    parts.push(place(taperedBox(0.86, 0.54, 0.34, 0.86, 0.54, 0.1, ENV.treeTrunkDark), 0, 0.15, 0));
    parts.push(
      place(chamferedBox(0.24, 0.9, 0.22, 0.05, ENV.treeTrunk), 0.32, trunkH * 0.82, 0.1, 0.2, 0.4, -0.55),
    );
    const lobes = 3;
    for (let i = 0; i < lobes; i++) {
      const angle = (i / lobes) * Math.PI * 2 + random.range(0, 1);
      const spread = random.range(0.42, 0.72);
      const size = random.range(1.5, 2.1);
      const color = i === 0 ? ENV.foliageMid : i === 1 ? ENV.foliageDeep : ENV.foliageLight;
      parts.push(
        place(
          taperedBox(size, size * 0.78, size * 0.72, size * 0.92, size * 0.7, 0.16, color),
          Math.cos(angle) * spread,
          trunkH + size * 0.3 + random.range(-0.12, 0.3),
          Math.sin(angle) * spread,
          0,
          angle,
          0,
        ),
      );
    }
  } else {
    // Tall spindle, for breaking up the skyline over the corridor.
    const height = random.range(6.0, 7.6);
    const trunkH = height * 0.66;
    parts.push(place(taperedBox(0.4, 0.2, trunkH, 0.4, 0.2, 0.06, ENV.treeTrunk), 0, trunkH * 0.5, 0, lean, 0, lean));
    parts.push(place(taperedBox(0.62, 0.42, 0.28, 0.62, 0.42, 0.08, ENV.treeTrunkDark), 0, 0.12, 0));
    for (let i = 0; i < 2; i++) {
      const size = 1.5 - i * 0.42;
      parts.push(
        place(
          taperedBox(size, size * 0.6, size * 1.15, size, size * 0.6, 0.13, i === 0 ? ENV.foliageDeep : ENV.foliageMid),
          random.signed(0.1),
          trunkH * 0.86 + i * height * 0.19,
          random.signed(0.1),
          0,
          random.angle(),
          0,
        ),
      );
    }
  }

  return tint(merge(parts), 0.12, 200 + variant);
}

export function buildBareTreeGeometry(variant: number, random: Random): BufferGeometry {
  const height = random.range(4.2, 6.0);
  const trunkH = height * 0.58;
  const parts: BufferGeometry[] = [
    place(taperedBox(0.52, 0.24, trunkH, 0.52, 0.24, 0.07, ENV.treeTrunkDark), 0, trunkH * 0.5, 0),
    place(taperedBox(0.92, 0.58, 0.34, 0.92, 0.58, 0.1, ENV.treeTrunkDark), 0, 0.15, 0),
  ];
  const branches = 4 + (variant % 2);
  for (let i = 0; i < branches; i++) {
    const angle = (i / branches) * Math.PI * 2 + random.range(-0.3, 0.3);
    const length = random.range(1.1, 1.9);
    const y = trunkH * random.range(0.62, 1.0);
    const tilt = random.range(0.55, 1.0);
    parts.push(
      place(
        taperedBox(0.2, 0.08, length, 0.2, 0.08, 0.035, ENV.treeTrunk),
        Math.sin(angle) * length * 0.3,
        y + length * 0.32,
        Math.cos(angle) * length * 0.3,
        Math.cos(angle) * tilt,
        0,
        -Math.sin(angle) * tilt,
      ),
    );
    if (i % 2 === 0) {
      parts.push(
        place(
          taperedBox(0.62, 0.34, 0.4, 0.5, 0.3, 0.07, ENV.foliageCursed),
          Math.sin(angle) * length * 0.72,
          y + length * 0.6,
          Math.cos(angle) * length * 0.72,
          0,
          angle,
          0,
        ),
      );
    }
  }
  parts.push(place(taperedBox(0.22, 0.08, height * 0.3, 0.22, 0.08, 0.03, ENV.treeTrunk), 0, height * 0.72, 0));
  return tint(merge(parts), 0.14, 210 + variant);
}

// ---------------------------------------------------------------------------
// Rocks, bushes, grass
// ---------------------------------------------------------------------------

export function buildRockGeometry(variant: number, random: Random): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const count = 1 + (variant % 3);
  const baseSize = random.range(0.5, 1.05);
  for (let i = 0; i < count; i++) {
    const size = baseSize * (i === 0 ? 1 : random.range(0.34, 0.62));
    // The large mass takes the darker stone: a bright cold boulder competes
    // with the enemy lane for attention and reads as ice, not rock.
    const geometry = sphereish(size, 6, i === 0 ? ENV.rockDark : ENV.rock);
    jitter(geometry, size * 0.11, 300 + variant * 7 + i);
    parts.push(
      place(
        geometry,
        i === 0 ? 0 : random.signed(baseSize * 1.1),
        size * random.range(0.34, 0.5),
        i === 0 ? 0 : random.signed(baseSize * 1.1),
        random.signed(0.22),
        random.angle(),
        random.signed(0.22),
        1,
        random.range(0.48, 0.68),
        1,
      ),
    );
  }
  parts.push(place(plate(baseSize * 2.1, baseSize * 1.9, 0.14, 0.05, ENV.rockDark), 0, 0.07, 0, 0, random.angle(), 0));
  return tint(merge(parts), 0.11, 300 + variant);
}

export function buildBushGeometry(variant: number, random: Random): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const lobes = 3 + (variant % 2);
  const radius = random.range(0.5, 0.85);
  for (let i = 0; i < lobes; i++) {
    const angle = (i / lobes) * Math.PI * 2 + random.range(-0.4, 0.4);
    const size = radius * random.range(0.7, 1.05);
    parts.push(
      place(
        taperedBox(size * 1.5, size * 1.1, size * 1.2, size * 1.4, size, 0.09, i % 2 === 0 ? ENV.bush : ENV.foliageDeep),
        Math.cos(angle) * radius * 0.45,
        size * 0.56,
        Math.sin(angle) * radius * 0.45,
        0,
        angle,
        0,
      ),
    );
  }
  parts.push(place(taperedBox(radius * 1.2, radius * 0.9, 0.2, radius * 1.2, radius * 0.9, 0.05, ENV.treeTrunkDark), 0, 0.1, 0));
  return tint(merge(parts), 0.13, 320 + variant);
}

export function buildGrassTuftGeometry(variant: number, random: Random): BufferGeometry {
  // Three-sided tapering blades rather than crossed quads: solid from every
  // angle, no alpha, no double-sided draw, and only ten triangles each.
  const parts: BufferGeometry[] = [];
  const blades = 5 + (variant % 3);
  for (let i = 0; i < blades; i++) {
    const angle = random.angle();
    const height = random.range(0.4, 0.78);
    const lean = random.range(0.12, 0.42);
    const offset = random.range(0, 0.19);
    parts.push(
      place(
        cylinderish(0.06, 0.006, height, 3, i % 3 === 0 ? ENV.bush : ENV.grass),
        Math.cos(angle) * offset,
        height * 0.5,
        Math.sin(angle) * offset,
        Math.cos(angle) * lean,
        angle,
        -Math.sin(angle) * lean,
      ),
    );
  }
  return tint(merge(parts), 0.16, 340 + variant);
}

// ---------------------------------------------------------------------------
// Ruins and scrap
// ---------------------------------------------------------------------------

/**
 * Compact ruined workshop used by authored encounters. A missing roof corner,
 * dark doorway, chimney and side braces keep it readable from the game camera
 * without turning one building into a high-poly landmark.
 */
export function buildRuinedHouseGeometry(variant: number, random: Random): BufferGeometry {
  void variant;
  const parts: BufferGeometry[] = [
    place(chamferedBox(5.4, 0.35, 4.6, 0.1, ENV.ruinStoneDark), 0, 0.18, 0),
    place(chamferedBox(5.0, 2.8, 0.42, 0.08, ENV.ruinStone), 0, 1.62, -2.05),
    place(chamferedBox(1.25, 2.8, 0.42, 0.08, ENV.ruinStone), -1.88, 1.62, 2.05),
    place(chamferedBox(1.25, 2.8, 0.42, 0.08, ENV.ruinStone), 1.88, 1.62, 2.05),
    place(chamferedBox(0.42, 2.8, 4.2, 0.08, ENV.ruinStone), -2.3, 1.62, 0),
    place(chamferedBox(0.42, 2.25, 4.2, 0.08, ENV.ruinStone), 2.3, 1.35, 0, 0, 0, -0.08),
    // Deep doorway reads as the release point for an occupied building.
    place(chamferedBox(2.2, 2.45, 0.18, 0.04, ENV.ruinStoneDark), 0, 1.25, 2.1),
    // Broken roof slopes and deliberately leaves the front-right corner open.
    place(taperedBox(2.85, 2.55, 0.34, 2.85, 2.55, 0.1, ENV.rustMetalDark), -1.25, 3.25, -0.15, 0, 0, 0.28),
    place(taperedBox(2.35, 2.05, 0.3, 2.35, 2.05, 0.1, ENV.rustMetal), 1.35, 3.18, -0.35, 0, 0, -0.3),
    place(chamferedBox(0.72, 2.4, 0.72, 0.08, ENV.rustMetalDark), -1.45, 4.15, -0.9, 0, random.signed(0.04), 0.04),
    place(chamferedBox(0.22, 3.0, 0.22, 0.04, ENV.rustMetal), 2.38, 1.7, -1.8, 0, 0, -0.12),
  ];
  return tint(merge(parts), 0.055, 510);
}

/**
 * Repeating maze wall: one strong silhouette built from readable courses,
 * buttresses and a rusted diagonal brace. It is intentionally asymmetric so
 * alternating instances do not look like a copied grey box from above.
 */
export function buildMazeWallGeometry(variant: number, random: Random): BufferGeometry {
  void variant;
  const lean = random.signed(0.035);
  const parts: BufferGeometry[] = [
    place(chamferedBox(0.95, 0.28, 6.0, 0.08, ENV.ruinStoneDark), 0, 0.14, 0),
    place(taperedBox(0.78, 0.68, 1.05, 5.6, 5.35, 0.12, ENV.ruinStone), 0, 0.78, 0, 0, 0, lean),
    place(chamferedBox(0.9, 0.22, 5.75, 0.06, ENV.ruinStoneDark), 0, 1.42, 0),
    place(chamferedBox(0.18, 1.65, 0.42, 0.04, ENV.rustMetalDark), 0.47, 0.86, -1.95, 0, 0, 0.12),
    place(chamferedBox(0.18, 1.65, 0.42, 0.04, ENV.rustMetalDark), 0.47, 0.86, 1.95, 0, 0, -0.12),
    place(chamferedBox(0.22, 0.18, 4.5, 0.04, ENV.rustMetal), 0.5, 0.88, 0, 0, 0, 0.38),
  ];
  // Broken cap stones give the top edge a deliberate rhythm.
  for (let i = -2; i <= 2; i++) {
    if (i === 1) continue;
    parts.push(
      place(
        chamferedBox(0.88, 0.34 + (i & 1) * 0.1, 0.86, 0.07, i & 1 ? ENV.ruinStoneDark : ENV.ruinStone),
        random.signed(0.04),
        1.62 + (i & 1) * 0.04,
        i * 1.12,
        random.signed(0.04),
        random.signed(0.06),
        random.signed(0.04),
      ),
    );
  }
  return tint(merge(parts), 0.075, 430);
}

/** Corner/watch tower used as punctuation between runs of maze wall. */
export function buildMazeTowerGeometry(variant: number, random: Random): BufferGeometry {
  void variant;
  const parts: BufferGeometry[] = [
    place(taperedBox(2.8, 2.5, 0.45, 2.8, 2.5, 0.1, ENV.ruinStoneDark), 0, 0.22, 0),
    place(taperedBox(2.15, 1.9, 3.7, 1.72, 1.55, 0.16, ENV.ruinStone), 0, 2.05, 0),
    place(chamferedBox(2.45, 0.38, 2.25, 0.09, ENV.ruinStoneDark), 0, 3.78, 0),
    place(chamferedBox(0.34, 3.0, 0.34, 0.06, ENV.rustMetalDark), 1.02, 1.92, 0.88, 0, 0, -0.08),
    place(chamferedBox(1.35, 0.24, 0.22, 0.04, ENV.rustMetal), 0, 2.75, 1.03),
    place(chamferedBox(1.35, 0.24, 0.22, 0.04, ENV.rustMetal), 0, 1.35, 1.03),
  ];
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI * 0.5 + Math.PI * 0.25;
    parts.push(
      place(
        taperedBox(0.56, 0.5, 0.9, 0.48, 0.44, 0.06, ENV.ruinStone),
        Math.cos(angle) * 0.78,
        4.25 + random.signed(0.08),
        Math.sin(angle) * 0.78,
        0,
        -angle,
        random.signed(0.04),
      ),
    );
  }
  return tint(merge(parts), 0.075, 431);
}

export function buildRuinPillarGeometry(variant: number, random: Random): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const drums = 2 + (variant % 3);
  const radius = random.range(0.42, 0.62);
  parts.push(place(taperedBox(radius * 2.9, radius * 2.5, 0.3, radius * 2.9, radius * 2.5, 0.07, ENV.ruinStoneDark), 0, 0.15, 0));
  let y = 0.3;
  for (let i = 0; i < drums; i++) {
    const height = random.range(0.6, 1.0);
    const r = radius * (1 - i * 0.06);
    parts.push(
      place(
        cylinderish(r, r * 0.96, height, 8, i % 2 === 0 ? ENV.ruinStone : ENV.ruinStoneDark),
        random.signed(0.05),
        y + height * 0.5,
        random.signed(0.05),
        random.signed(0.03),
        random.angle(),
        random.signed(0.03),
      ),
    );
    y += height;
    parts.push(place(cylinderish(r * 1.12, r * 1.12, 0.08, 8, ENV.ruinStoneDark), 0, y, 0));
  }
  // Broken cap: the pillar reads as a ruin, not a bollard.
  const cap = jitter(sphereish(radius * 1.1, 6, ENV.ruinStone), radius * 0.22, 360 + variant);
  parts.push(place(cap, random.signed(0.08), y + radius * 0.28, random.signed(0.08), 0, random.angle(), 0, 1, 0.55, 1));
  if (variant % 2 === 1) {
    parts.push(
      place(chamferedBox(0.24, 0.9, 0.24, 0.05, ENV.rustMetal), radius * 1.3, 0.55, 0, random.signed(0.4), 0, 0.5),
    );
  }
  return tint(merge(parts), 0.12, 360 + variant);
}

export function buildScrapHeapGeometry(variant: number, random: Random): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const chunks = 5 + (variant % 3);
  const colors = [ENV.rustMetal, ENV.rustMetalDark, PLAYER_COLORS.steelDark, ENV.rock];
  for (let i = 0; i < chunks; i++) {
    const w = random.range(0.34, 0.9);
    const h = random.range(0.14, 0.4);
    const d = random.range(0.34, 0.8);
    parts.push(
      place(
        chamferedBox(w, h, d, 0.04, colors[i % colors.length]),
        random.signed(0.55),
        h * 0.5 + random.range(0, 0.34),
        random.signed(0.55),
        random.signed(0.5),
        random.angle(),
        random.signed(0.5),
      ),
    );
  }
  parts.push(
    place(cylinderish(0.3, 0.3, 0.62, 8, ENV.rustMetalDark), random.signed(0.4), 0.3, random.signed(0.4), random.signed(0.9), 0, random.signed(0.5)),
  );
  parts.push(place(rivetRing(0.24, 6, 0.045, PLAYER_COLORS.brassDark), 0.1, 0.62, -0.1, 0.4, 0, 0.2));
  return tint(merge(parts), 0.13, 380 + variant);
}

// ---------------------------------------------------------------------------
// Landmarks
// ---------------------------------------------------------------------------

/** The run-ending gate: the one silhouette the player steers toward for ten minutes. */
export function buildGateGeometry(materials: MaterialLibrary): Group {
  const root = new Group();
  root.name = "gate";

  const towerParts: BufferGeometry[] = [];
  for (let s = -1; s <= 1; s += 2) {
    const x = 7.4 * s;
    towerParts.push(place(taperedBox(4.4, 3.2, 9.4, 4.4, 3.2, 0.24, ENV.ruinStone), x, 4.7, 0));
    towerParts.push(place(taperedBox(5.2, 4.6, 0.9, 5.2, 4.6, 0.16, ENV.ruinStoneDark), x, 0.45, 0));
    towerParts.push(place(plate(4.6, 4.6, 0.5, 0.16, ENV.ruinStoneDark), x, 9.6, 0));
    towerParts.push(place(taperedBox(3.6, 2.4, 1.5, 3.6, 2.4, 0.18, ENV.ruinStone), x, 10.6, 0));
    towerParts.push(place(chamferedBox(0.7, 5.6, 0.7, 0.12, ENV.rustMetal), x + 2.4 * s, 5.4, 1.9, 0, 0, 0.16 * s));
    towerParts.push(place(chamferedBox(3.2, 0.6, 0.5, 0.1, ENV.rustMetalDark), x, 7.6, 1.75));
    towerParts.push(place(chamferedBox(3.2, 0.6, 0.5, 0.1, ENV.rustMetalDark), x, 3.4, 1.75));
  }
  // Lintel and hanging chains.
  towerParts.push(place(taperedBox(19.6, 18.4, 1.9, 3.4, 2.8, 0.22, ENV.ruinStone), 0, 10.6, 0));
  towerParts.push(place(plate(20.4, 4.0, 0.6, 0.16, ENV.ruinStoneDark), 0, 11.8, 0));
  towerParts.push(place(chamferedBox(18.0, 0.7, 0.6, 0.14, ENV.rustMetal), 0, 9.5, 1.5));
  for (let i = -3; i <= 3; i++) {
    towerParts.push(place(cylinderish(0.14, 0.14, 1.9, 6, ENV.rustMetalDark), i * 2.3, 8.6, 1.5));
    towerParts.push(place(sphereish(0.22, 5, ENV.rustMetal), i * 2.3, 7.6, 1.5));
  }
  // Gate leaves, folded open, so the destination reads as passable.
  for (let s = -1; s <= 1; s += 2) {
    const x = 4.9 * s;
    towerParts.push(place(chamferedBox(4.6, 7.4, 0.7, 0.14, ENV.rustMetal), x, 3.9, -0.9, 0, -0.55 * s, 0));
    towerParts.push(place(chamferedBox(4.2, 0.5, 0.8, 0.12, PLAYER_COLORS.brassDark), x, 6.6, -0.9, 0, -0.55 * s, 0));
    towerParts.push(place(chamferedBox(4.2, 0.5, 0.8, 0.12, PLAYER_COLORS.brassDark), x, 1.6, -0.9, 0, -0.55 * s, 0));
  }
  root.add(meshOfSurface(tint(merge(towerParts), 0.1, 401), materials));

  const lamps = merge([
    place(cylinderish(0.36, 0.3, 0.5, 8, FEEDBACK.network), -7.4, 9.9, 1.9),
    place(cylinderish(0.36, 0.3, 0.5, 8, FEEDBACK.network), 7.4, 9.9, 1.9),
    place(plate(17.4, 0.5, 0.22, 0.08, FEEDBACK.network), 0, 11.5, 1.6),
    place(cylinderish(0.5, 0.44, 0.3, 10, FEEDBACK.network), 0, 12.2, 0),
  ]);
  const lampMesh = new Mesh(lamps, materials.emissive(FEEDBACK.network, 1.3));
  lampMesh.name = "gateLights";
  root.add(lampMesh);

  return root;
}

/** Checkpoint marker: a bank stone plus a lit brazier that reads from far away. */
export function buildCheckpointGeometry(materials: MaterialLibrary): Group {
  const root = new Group();
  root.name = "checkpoint";

  const stone = merge([
    place(taperedBox(2.4, 2.0, 0.5, 2.0, 1.7, 0.12, ENV.ruinStoneDark), 0, 0.25, 0),
    place(taperedBox(1.5, 1.1, 2.6, 0.8, 0.6, 0.14, ENV.ruinStone), 0, 1.8, 0, 0, 0.18, 0.04),
    place(plate(1.4, 0.9, 0.26, 0.09, PLAYER_COLORS.brassDark), 0, 3.05, 0),
    place(chamferedBox(0.9, 0.9, 0.14, 0.04, PLAYER_COLORS.brass), 0, 2.1, 0.42, 0, 0.18, 0),
    place(cylinderish(0.5, 0.42, 0.8, 8, ENV.rustMetal), 1.9, 0.4, 0.3),
    place(cylinderish(0.62, 0.62, 0.16, 8, PLAYER_COLORS.brassDark), 1.9, 0.86, 0.3),
    place(chamferedBox(0.16, 1.0, 0.16, 0.04, ENV.rustMetalDark), 1.55, 0.5, -0.05, 0.2, 0, 0.24),
    place(chamferedBox(0.16, 1.0, 0.16, 0.04, ENV.rustMetalDark), 2.25, 0.5, 0.65, -0.2, 0, -0.24),
  ]);
  root.add(meshOfSurface(tint(stone, 0.1, 402), materials));

  const brazier = new Object3D();
  brazier.name = "brazier";
  brazier.position.set(1.9, 0.95, 0.3);
  const flame = new Mesh(
    merge([
      place(coneish(0.42, 0.9, 6, SPIDER_COLORS.furnace), 0, 0.4, 0),
      place(coneish(0.24, 0.5, 6, SPIDER_COLORS.furnaceHot), 0, 0.72, 0),
      place(cylinderish(0.48, 0.48, 0.12, 8, SPIDER_COLORS.furnace), 0, 0.02, 0),
    ]),
    materials.emissiveUnique(SPIDER_COLORS.furnace, 1.35),
  );
  flame.name = "flame";
  brazier.add(flame);
  root.add(brazier);

  // A ring, not a filled disc: a solid emissive circle on the ground reads as
  // spilled paint and swallows everything standing inside the checkpoint.
  const haloParts: BufferGeometry[] = [];
  const segments = 26;
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    haloParts.push(
      place(
        chamferedBox(0.9, 0.05, 0.22, 0.02, FEEDBACK.network),
        Math.cos(angle) * 3.5,
        0.04,
        Math.sin(angle) * 3.5,
        0,
        -angle,
        0,
      ),
    );
  }
  const halo = new Mesh(merge(haloParts), materials.emissiveUnique(FEEDBACK.network, 0.9));
  halo.name = "halo";
  root.add(halo);

  return root;
}

function meshOfSurface(geometry: BufferGeometry, materials: MaterialLibrary): Mesh {
  const mesh = new Mesh(geometry, materials.surface);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
