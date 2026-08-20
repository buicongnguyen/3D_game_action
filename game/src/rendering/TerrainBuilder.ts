import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three";
import { Random } from "../core/Random.ts";
import { angleDelta, clamp, smoothstep } from "../core/math.ts";
import { ENV } from "../art/palette.ts";
import { NAVIGATION } from "../data/balance.ts";
import type { MeshForge } from "../art/MeshForge.ts";
import type { GameWorld } from "../game/GameWorld.ts";
import type { RouteSegmentDefinition, TerrainStyle } from "../core/types.ts";

/**
 * Builds the ground and its dressing for one route segment.
 *
 * The terrain is a single vertex-coloured mesh generated along the spline
 * rather than a tile grid. That buys three things at once: the corridor reads
 * as a trodden path because the vertex colour blends from path to undergrowth
 * with lateral distance, there are no tile seams to spot, and the whole ground
 * is one draw call.
 *
 * Everything on top of it is instanced. A forest of 900 trees, rocks and grass
 * tufts costs one draw call per prop type, which is what leaves room in the
 * budget for a horde.
 */

/**
 * Names must match `MeshForge.propNames`. Each entry becomes one InstancedMesh,
 * so the list length is a direct draw-call cost - roughly a dozen calls buys the
 * whole forest.
 *
 * `blocks` is the nav-obstacle radius; 0 means the prop is pure decoration that
 * the horde walks through. Only silhouette-scale things block, because a horde
 * that catches on every grass tuft looks broken rather than dense.
 */
const PROP_TYPES = [
  { name: "treeConifer", count: 54, minLateral: 14, maxLateral: 46, scaleMin: 0.85, scaleMax: 1.35, blocks: 1.15 },
  { name: "treeBroadleaf", count: 46, minLateral: 14, maxLateral: 46, scaleMin: 0.9, scaleMax: 1.4, blocks: 1.2 },
  { name: "treeSpindle", count: 34, minLateral: 13, maxLateral: 44, scaleMin: 0.85, scaleMax: 1.25, blocks: 0.95 },
  { name: "treeConiferB", count: 32, minLateral: 15, maxLateral: 48, scaleMin: 0.9, scaleMax: 1.3, blocks: 1.1 },
  { name: "bareTree", count: 44, minLateral: 12, maxLateral: 44, scaleMin: 0.9, scaleMax: 1.45, blocks: 1.0 },
  { name: "bareTreeB", count: 28, minLateral: 12, maxLateral: 42, scaleMin: 0.85, scaleMax: 1.35, blocks: 0.95 },
  { name: "rock", count: 58, minLateral: 6, maxLateral: 40, scaleMin: 0.7, scaleMax: 1.6, blocks: 1.1 },
  { name: "rockB", count: 46, minLateral: 6, maxLateral: 40, scaleMin: 0.7, scaleMax: 1.5, blocks: 1.0 },
  { name: "rockC", count: 38, minLateral: 5, maxLateral: 36, scaleMin: 0.6, scaleMax: 1.2, blocks: 0.8 },
  { name: "bush", count: 120, minLateral: 4, maxLateral: 34, scaleMin: 0.8, scaleMax: 1.3, blocks: 0 },
  { name: "bushB", count: 96, minLateral: 4, maxLateral: 34, scaleMin: 0.8, scaleMax: 1.25, blocks: 0 },
  { name: "grass", count: 240, minLateral: 1.5, maxLateral: 30, scaleMin: 0.7, scaleMax: 1.4, blocks: 0 },
  { name: "grassB", count: 200, minLateral: 1.5, maxLateral: 30, scaleMin: 0.7, scaleMax: 1.35, blocks: 0 },
  { name: "grassC", count: 170, minLateral: 1.5, maxLateral: 28, scaleMin: 0.65, scaleMax: 1.3, blocks: 0 },
  { name: "ruinPillar", count: 22, minLateral: 8, maxLateral: 30, scaleMin: 0.9, scaleMax: 1.5, blocks: 1.3 },
  { name: "ruinPillarB", count: 18, minLateral: 8, maxLateral: 30, scaleMin: 0.9, scaleMax: 1.4, blocks: 1.2 },
  { name: "scrapHeap", count: 20, minLateral: 6, maxLateral: 24, scaleMin: 0.8, scaleMax: 1.3, blocks: 0.9 },
  { name: "scrapHeapB", count: 16, minLateral: 6, maxLateral: 24, scaleMin: 0.8, scaleMax: 1.25, blocks: 0.85 },
] as const;

type PropName = (typeof PROP_TYPES)[number]["name"];

export interface TerrainPalette {
  groundBase: number;
  groundDark: number;
  groundLight: number;
  path: number;
  pathEdge: number;
  propTint: number;
  houseColors: readonly number[];
  reliefScale: number;
}

/** Eight deliberately separated palettes; no stage should read as a recolour of the last. */
export const TERRAIN_PALETTES: Readonly<Record<TerrainStyle, TerrainPalette>> = {
  yellow: {
    groundBase: 0xa88b3d, groundDark: 0x79632f, groundLight: 0xd2b85b,
    path: 0xc7a35a, pathEdge: 0x75552d, propTint: 0xe4ce79,
    houseColors: [0xd59a48, 0xb96f3f, 0xe0b85f], reliefScale: 0.7,
  },
  brown: {
    groundBase: 0x76513a, groundDark: 0x4b3329, groundLight: 0xa27550,
    path: 0x936646, pathEdge: 0x4d3529, propTint: 0xb88a67,
    houseColors: [0x9e6548, 0x74483b, 0xb47a52], reliefScale: 1.15,
  },
  factory: {
    groundBase: 0x4d514f, groundDark: 0x303433, groundLight: 0x747973,
    path: 0x62635d, pathEdge: 0x282b2b, propTint: 0xa6aaa2,
    houseColors: [0x6d7a80, 0x8e603e, 0x59686f], reliefScale: 0.35,
  },
  civil: {
    groundBase: 0x777263, groundDark: 0x504d45, groundLight: 0x9d9786,
    path: 0x8b8272, pathEdge: 0x4a4742, propTint: 0xc0b8a6,
    houseColors: [0xc65f4a, 0xd0a455, 0x63859a, 0x8f6cac], reliefScale: 0.25,
  },
  mountain: {
    groundBase: 0x59605b, groundDark: 0x363d3b, groundLight: 0x818982,
    path: 0x77786d, pathEdge: 0x3c403d, propTint: 0xb6c0b8,
    houseColors: [0x7d6c5b, 0x586d73, 0x8a765d], reliefScale: 3.3,
  },
  valley: {
    groundBase: 0x476c47, groundDark: 0x2d4c35, groundLight: 0x78a35c,
    path: 0x88765a, pathEdge: 0x3e563b, propTint: 0xb4d394,
    houseColors: [0xb36d42, 0x8f4937, 0xc8944d], reliefScale: 1.8,
  },
  flower: {
    groundBase: 0x5f8a4e, groundDark: 0x3e633d, groundLight: 0x96bd68,
    path: 0xb19a69, pathEdge: 0x536b42, propTint: 0xd9efac,
    houseColors: [0xe0906f, 0xe4bc62, 0x83a6c9, 0xbb83b7], reliefScale: 0.75,
  },
  crystal: {
    groundBase: 0x343b58, groundDark: 0x22243d, groundLight: 0x596287,
    path: 0x555b79, pathEdge: 0x242841, propTint: 0xa8c8e8,
    houseColors: [0x718ac7, 0x8d69b8, 0x4fa5a5], reliefScale: 1.45,
  },
};

export function terrainPaletteFor(style: TerrainStyle): TerrainPalette {
  return TERRAIN_PALETTES[style];
}

function propDensity(style: TerrainStyle, name: PropName): number {
  const tree = name.startsWith("tree") || name.startsWith("bareTree");
  const rock = name.startsWith("rock");
  const soft = name.startsWith("grass") || name.startsWith("bush");
  const industrial = name.startsWith("ruin") || name.startsWith("scrap");
  switch (style) {
    case "yellow": return tree ? 0.18 : soft ? 0.75 : industrial ? 0.25 : 0.55;
    case "brown": return tree ? 0.12 : rock ? 1.15 : soft ? 0.16 : industrial ? 0.8 : 0.5;
    case "factory": return industrial ? 1.65 : rock ? 0.28 : soft ? 0.08 : 0.04;
    case "civil": return industrial ? 1.2 : tree ? 0.35 : soft ? 0.28 : 0.22;
    case "mountain": return rock ? 1.7 : name.startsWith("treeConifer") ? 0.72 : soft ? 0.12 : 0.18;
    case "valley": return tree ? 1.05 : soft ? 1.15 : rock ? 0.55 : 0.25;
    case "flower": return soft ? 1.55 : tree ? 0.35 : rock ? 0.18 : 0.15;
    case "crystal": return rock ? 1.75 : industrial ? 0.22 : soft ? 0.12 : 0.04;
  }
}

function propInstanceColor(style: TerrainStyle, name: PropName, index: number): number {
  if (style === "flower" && (name.startsWith("grass") || name.startsWith("bush"))) {
    return [0xffd34f, 0xf48fb1, 0xc59cff, 0xf7eee0][index % 4];
  }
  if (style === "crystal" && name.startsWith("rock")) {
    return [0x6ee7ff, 0x9f8cff, 0x65ffc7, 0xd486ff][index % 4];
  }
  return TERRAIN_PALETTES[style].propTint;
}

/** Surface-to-surface gap wide enough for the largest regular enemy. */
export const SOLID_PROP_GAP = 2.2;
const DECORATIVE_PROP_GAP = 0.8;

/** Pure spacing rule shared by generation and deterministic tests. */
export function propsHaveClearance(
  existingX: number,
  existingZ: number,
  existingRadius: number,
  existingSolid: boolean,
  candidateX: number,
  candidateZ: number,
  candidateRadius: number,
  candidateSolid: boolean,
): boolean {
  const gap = existingSolid && candidateSolid ? SOLID_PROP_GAP : DECORATIVE_PROP_GAP;
  const minimum = existingRadius + candidateRadius + gap;
  const dx = existingX - candidateX;
  const dz = existingZ - candidateZ;
  return dx * dx + dz * dz >= minimum * minimum;
}

/** Prop used for the low posts that mark the drivable corridor. */
const MARKER_PROP = "ruinPillarC";

/** Longitudinal and lateral tessellation of the ground strip. */
const STEP_ALONG = 3.6;
const LATERAL_SEGMENTS = 30;
/**
 * The strip must cover the visible ground, not just the corridor.
 *
 * At maximum zoom-out the camera's cull radius reaches roughly 70 m, and because
 * the route curves, the strip has to exceed that by a wide margin or its own
 * edge enters frame as a straight diagonal against the backdrop. Three reviewers
 * measured that line before this was widened. Widening costs no vertices — the
 * same lateral segment count simply spreads further — and everything past the
 * corridor is low-detail ground anyway.
 */
const HALF_WIDTH = 155;

/** Metres of ground carried past each end of the segment, to clear the view. */
const END_MARGIN = 120;

export class TerrainBuilder {
  readonly root = new Group();

  private ground: Mesh | null = null;
  private backdrop: Mesh | null = null;
  private readonly instanced: InstancedMesh[] = [];
  private readonly ownedGeometries: BufferGeometry[] = [];
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly scaleVector = new Vector3();
  private readonly instanceColor = new Color();

  constructor(
    private readonly forge: MeshForge,
    parent: Object3D,
  ) {
    this.root.name = "terrain";
    parent.add(this.root);
  }

  /** Rebuilds the terrain for the world's current segment. */
  build(world: GameWorld): void {
    this.clear();
    const segment = world.route.segment;
    const spline = world.route.spline;
    if (!segment || !spline) return;

    const random = world.random.fork(hashString(segment.id));

    this.buildBackdrop(world, segment);

    this.ground = new Mesh(this.buildGroundGeometry(world, segment), this.forge.materials.surface);
    this.ground.receiveShadow = true;
    this.ground.castShadow = false;
    this.ground.frustumCulled = false;
    this.root.add(this.ground);

    this.scatterProps(world, segment, random);
    this.buildWaterAndBridges(world, segment);
    this.buildEncounterSites(world, segment);
    if (segment.modifiers.includes("maze")) this.buildMazePattern(world, segment, random);
    else this.buildCorridorMarkers(world, segment, random);
  }

  /**
   * A single large plane under everything.
   *
   * The detailed strip follows the spline, so on the outside of a bend its edge
   * can enter frame as a hard diagonal line against the fog. One flat quad
   * beneath it, sitting a few centimetres lower and coloured to match what the
   * fog resolves to at that distance, removes the seam for one draw call.
   */
  private buildBackdrop(world: GameWorld, segment: RouteSegmentDefinition): void {
    const spline = world.route.spline;
    if (!spline) return;

    const geometry = new PlaneGeometry(1, 1, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    const colors = new Float32Array(4 * 3);
    // Matched to the strip's own outer value, not to something darker. A
    // backdrop that contrasts with the strip removes the void but replaces it
    // with an equally visible seam; matching makes the transition disappear.
    const shade = new Color(terrainPaletteFor(segment.terrainStyle).groundBase);
    for (let i = 0; i < 4; i++) {
      colors[i * 3] = shade.r;
      colors[i * 3 + 1] = shade.g;
      colors[i * 3 + 2] = shade.b;
    }
    geometry.setAttribute("color", new BufferAttribute(colors, 3));

    this.backdrop = new Mesh(geometry, this.forge.materials.surface);
    this.backdrop.receiveShadow = false;
    this.backdrop.castShadow = false;
    this.backdrop.frustumCulled = false;
    this.backdrop.name = "backdrop";

    // Centred on the segment, not on the world origin. A fixed quad at the
    // origin runs out before the route does — the later segments reach Z≈480 —
    // and its own edge then crosses the frame as a dead-straight diagonal.
    // That line survived two separate misdiagnoses (the strip's edge, then the
    // shadow frustum) before being traced here. One quad costs nothing, so it
    // is sized to swallow the whole route several times over.
    const mid = { x: 0, z: 0 };
    spline.positionAt(mid, spline.length * 0.5);
    this.backdrop.position.set(mid.x, -0.06, mid.z);
    this.backdrop.scale.set(2400, 1, 2400);
    this.root.add(this.backdrop);
  }

  /**
   * Ground mesh: a strip swept along the spline. Height is a low-amplitude
   * noise that flattens to zero across the corridor, so the drivable surface
   * stays flat (the simulation is strictly 2D) while the surrounding ground
   * still has enough relief to catch the raking key light.
   */
  private buildGroundGeometry(world: GameWorld, segment: RouteSegmentDefinition): BufferGeometry {
    const spline = world.route.spline!;
    const length = spline.length;
    // Run the strip well past both ends of the segment. The camera sees ~70 m
    // in every direction, so a strip that stops exactly where the route does
    // puts its own end in frame as a dead-straight line whenever the spider is
    // near either end — which in the Pursuit scene it always is. Positions
    // outside [0, length] are extrapolated along the end tangent.
    const rows = Math.ceil((length + END_MARGIN * 2) / STEP_ALONG) + 1;
    const cols = LATERAL_SEGMENTS + 1;
    const vertexCount = rows * cols;

    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const indices = new Uint32Array((rows - 1) * LATERAL_SEGMENTS * 6);

    const point = { x: 0, z: 0 };
    const tangent = { x: 0, z: 0 };
    const corridor = segment.corridorHalfWidth;
    const palette = terrainPaletteFor(segment.terrainStyle);
    const pathColor = new Color(palette.path);
    const pathEdge = new Color(palette.pathEdge);
    const groundBase = new Color(palette.groundBase);
    const groundDark = new Color(palette.groundDark);
    const groundLight = new Color(palette.groundLight);
    const blend = new Color();

    let vertex = 0;
    for (let row = 0; row < rows; row++) {
      const along = row * STEP_ALONG - END_MARGIN;
      const distance = clamp(along, 0, length);
      spline.positionAt(point, distance);
      spline.tangentAt(tangent, distance);
      // Beyond either end, carry straight on along the end tangent.
      const overshoot = along - distance;
      const baseX = point.x + tangent.x * overshoot;
      const baseZ = point.z + tangent.z * overshoot;
      // Left normal of the tangent on the XZ plane.
      const nx = -tangent.z;
      const nz = tangent.x;

      for (let col = 0; col < cols; col++) {
        const t = col / LATERAL_SEGMENTS;
        const lateral = (t * 2 - 1) * HALF_WIDTH;
        const absLateral = Math.abs(lateral);

        const x = baseX + nx * lateral;
        const z = baseZ + nz * lateral;

        // Relief rises only outside the corridor; the path itself is flat.
        const y = groundHeightAt(x, z, absLateral, corridor, palette.reliefScale);

        positions[vertex * 3] = x;
        positions[vertex * 3 + 1] = y;
        positions[vertex * 3 + 2] = z;

        // Colour tells the player where the corridor is without a painted line.
        const pathFactor = 1 - smoothstep(corridor * 0.42, corridor * 0.95, absLateral);
        const edgeFactor = smoothstep(corridor * 0.5, corridor * 1.05, absLateral) *
          (1 - smoothstep(corridor * 1.0, corridor * 1.5, absLateral));
        const shade = valueNoise(x * 0.12 + 31.7, z * 0.12 - 12.3);

        blend.copy(groundBase).lerp(shade > 0.5 ? groundLight : groundDark, Math.abs(shade - 0.5) * 1.6);
        blend.lerp(pathColor, pathFactor * 0.92);
        blend.lerp(pathEdge, edgeFactor * 0.5);
        // Settle the outermost rim onto the backdrop's exact colour, so if the
        // strip's edge ever does enter frame there is no value step to see.
        const rim = smoothstep(HALF_WIDTH * 0.72, HALF_WIDTH, absLateral);
        if (rim > 0) blend.lerp(groundBase, rim);

        colors[vertex * 3] = blend.r;
        colors[vertex * 3 + 1] = blend.g;
        colors[vertex * 3 + 2] = blend.b;

        normals[vertex * 3] = 0;
        normals[vertex * 3 + 1] = 1;
        normals[vertex * 3 + 2] = 0;

        vertex++;
      }
    }

    let index = 0;
    for (let row = 0; row < rows - 1; row++) {
      for (let col = 0; col < LATERAL_SEGMENTS; col++) {
        const a = row * cols + col;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        // Counter-clockwise seen from above. The lateral axis is the LEFT normal
        // of the tangent, so the naive a-c-b order winds the strip face-down and
        // back-face culling makes the whole ground invisible.
        indices[index++] = a;
        indices[index++] = b;
        indices[index++] = c;
        indices[index++] = b;
        indices[index++] = d;
        indices[index++] = c;
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
    geometry.setAttribute("normal", new BufferAttribute(normals, 3));
    geometry.setIndex(new BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  /**
   * Scatters instanced props, rejecting anything that would land in the
   * corridor or on top of an existing prop, and registering the solid ones as
   * static nav obstacles so the horde flows around the same trees the player
   * has to run around.
   */
  private scatterProps(world: GameWorld, segment: RouteSegmentDefinition, random: Random): void {
    const spline = world.route.spline!;
    const length = spline.length;
    const maze = segment.modifiers.includes("maze");
    const point = { x: 0, z: 0 };
    const tangent = { x: 0, z: 0 };

    world.navigation.clearStatic();

    const occupiedX: number[] = [];
    const occupiedZ: number[] = [];
    const occupiedR: number[] = [];
    const occupiedSolid: boolean[] = [];

    // Reserve authored building footprints before scattering decorative props.
    // Otherwise a deterministic but unlucky tree can grow through a doorway
    // and hide the warning/release beat the building exists to communicate.
    const encounters = segment.encounters ?? [];
    for (let i = 0; i < encounters.length; i++) {
      const encounter = encounters[i];
      spline.positionAt(point, encounter.distance);
      spline.tangentAt(tangent, encounter.distance);
      occupiedX.push(point.x - tangent.z * encounter.lateral);
      occupiedZ.push(point.z + tangent.x * encounter.lateral);
      occupiedR.push(encounter.kind === "workshopNest" ? 5.4 : 4.8);
      occupiedSolid.push(true);
    }

    for (let typeIndex = 0; typeIndex < PROP_TYPES.length; typeIndex++) {
      const type = PROP_TYPES[typeIndex];
      const geometry = this.tryPropGeometry(type.name);
      if (!geometry) continue;

      // Rust Yard is architecture-led. Keep some distant natural dressing, but
      // do not let hundreds of unrelated trees and boulders overwhelm the two
      // modular shapes that define the maze.
      const heavyNatural =
        type.name.startsWith("tree") ||
        type.name.startsWith("bareTree") ||
        type.name.startsWith("rock") ||
        type.name.startsWith("ruinPillar");
      const styledCount = Math.ceil(type.count * propDensity(segment.terrainStyle, type.name));
      const targetCount = maze && heavyNatural ? Math.ceil(styledCount * 0.22) : styledCount;
      if (targetCount <= 0) continue;

      const mesh = new InstancedMesh(geometry, this.forge.materials.surface, targetCount);
      // Only silhouette-scale props cast. A grass tuft's shadow is invisible at
      // this camera height but still costs a full extra pass over its instances.
      mesh.castShadow = type.blocks >= 1;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.name = `prop.${type.name}`;

      let placed = 0;
      let attempts = 0;
      const maxAttempts = targetCount * 12;

      while (placed < targetCount && attempts < maxAttempts) {
        attempts++;
        const distance = random.range(-8, length + 8);
        spline.positionAt(point, clamp(distance, 0, length));
        spline.tangentAt(tangent, clamp(distance, 0, length));

        const side = random.bool() ? 1 : -1;
        const lateral =
          side * random.range(Math.max(type.minLateral, segment.corridorHalfWidth * 0.9), type.maxLateral);
        const x = point.x + -tangent.z * lateral;
        const z = point.z + tangent.x * lateral;
        const scale = random.range(type.scaleMin, type.scaleMax);
        const candidateSolid = type.blocks > 0;
        const candidateRadius = candidateSolid ? type.blocks * scale : 0.35 * scale;

        // A prop generated outside one switchback can still land inside the
        // neighbouring lane. Clear against the globally nearest lane so the
        // maze remains navigable and its repeated path is visually legible.
        if (
          maze &&
          Math.abs(spline.lateralOffset(x, z)) <
            segment.corridorHalfWidth + Math.max(1, type.blocks)
        ) continue;

        let rejected = false;
        for (let i = 0; i < occupiedX.length; i++) {
          if (!propsHaveClearance(
            occupiedX[i], occupiedZ[i], occupiedR[i], occupiedSolid[i],
            x, z, candidateRadius, candidateSolid,
          )) {
            rejected = true;
            break;
          }
        }
        if (rejected) continue;

        // Stand it on the ground rather than at y = 0, which on the
        // high-relief biomes is under it. Same expression the mesh uses.
        this.position.set(
          x,
          groundHeightAt(
            x, z,
            Math.abs(spline.lateralOffset(x, z)),
            segment.corridorHalfWidth,
            terrainPaletteFor(segment.terrainStyle).reliefScale,
          ),
          z,
        );
        this.quaternion.setFromAxisAngle(UP, random.angle());
        // Slight non-uniform scale stops a forest of identical clones reading
        // as one repeated object.
        let widthScale = 1;
        let heightScale = 1;
        if (segment.terrainStyle === "crystal" && type.name.startsWith("rock")) {
          widthScale = 0.48;
          heightScale = random.range(1.9, 3.2);
        } else if (segment.terrainStyle === "mountain" && type.name.startsWith("rock")) {
          widthScale = 1.15;
          heightScale = random.range(1.35, 2.1);
        }
        this.scaleVector.set(
          scale * widthScale * random.range(0.92, 1.08),
          scale * heightScale,
          scale * widthScale * random.range(0.92, 1.08),
        );
        this.matrix.compose(this.position, this.quaternion, this.scaleVector);
        mesh.setMatrixAt(placed, this.matrix);
        this.instanceColor.setHex(propInstanceColor(segment.terrainStyle, type.name, placed));
        mesh.setColorAt(placed, this.instanceColor);

        if (type.blocks > 0) {
          const radius = type.blocks * scale;
          world.navigation.setStatic(x, z, radius);
          occupiedX.push(x);
          occupiedZ.push(z);
          occupiedR.push(radius);
          occupiedSolid.push(true);
        } else {
          occupiedX.push(x);
          occupiedZ.push(z);
          occupiedR.push(candidateRadius);
          occupiedSolid.push(false);
        }
        placed++;
      }

      mesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.instanced.push(mesh);
      this.root.add(mesh);
    }
  }

  private buildWaterAndBridges(world: GameWorld, segment: RouteSegmentDefinition): void {
    const zones = segment.waterZones ?? [];
    if (zones.length === 0) return;
    const spline = world.route.spline!;
    const waterGeometry = new PlaneGeometry(1, 1, 1, 1);
    waterGeometry.rotateX(-Math.PI / 2);
    const waterColor = new Color(ENV.shallowWater);
    const colors = new Float32Array(12);
    for (let i = 0; i < 4; i++) {
      colors[i * 3] = waterColor.r;
      colors[i * 3 + 1] = waterColor.g;
      colors[i * 3 + 2] = waterColor.b;
    }
    waterGeometry.setAttribute("color", new BufferAttribute(colors, 3));
    this.ownedGeometries.push(waterGeometry);
    const water = new InstancedMesh(waterGeometry, this.forge.materials.surface, zones.length);
    const bridgeGeometry = this.tryPropGeometry("bridge");
    const bridges = bridgeGeometry
      ? new InstancedMesh(bridgeGeometry, this.forge.materials.surface, zones.length)
      : null;
    water.name = "terrain.shallowWater";
    water.receiveShadow = true;
    water.frustumCulled = false;
    if (bridges) {
      bridges.name = "prop.bridge";
      bridges.castShadow = true;
      bridges.receiveShadow = true;
      bridges.frustumCulled = false;
    }
    const point = { x: 0, z: 0 };
    const tangent = { x: 0, z: 1 };
    for (let i = 0; i < zones.length; i++) {
      const zone = zones[i];
      const middle = (zone.fromDistance + zone.toDistance) * 0.5;
      spline.positionAt(point, middle);
      spline.tangentAt(tangent, middle);
      const heading = Math.atan2(tangent.x, tangent.z);
      this.position.set(point.x, 0.025, point.z);
      this.quaternion.setFromAxisAngle(UP, heading);
      this.scaleVector.set(zone.channelHalfWidth * 2, 1, zone.toDistance - zone.fromDistance);
      this.matrix.compose(this.position, this.quaternion, this.scaleVector);
      water.setMatrixAt(i, this.matrix);
      if (bridges) {
        this.position.y = 0.035;
        this.scaleVector.set(zone.bridgeHalfWidth / 3.2, 1, (zone.toDistance - zone.fromDistance) / 12);
        this.matrix.compose(this.position, this.quaternion, this.scaleVector);
        bridges.setMatrixAt(i, this.matrix);
      }
    }
    water.instanceMatrix.needsUpdate = true;
    this.instanced.push(water);
    this.root.add(water);
    if (bridges) {
      bridges.instanceMatrix.needsUpdate = true;
      this.instanced.push(bridges);
      this.root.add(bridges);
    }
  }

  /** Builds every authored house from the same data that drives its squad. */
  private buildEncounterSites(world: GameWorld, segment: RouteSegmentDefinition): void {
    const encounters = segment.encounters ?? [];
    if (encounters.length === 0) return;
    const geometry = this.tryPropGeometry("ruinedHouse");
    if (!geometry) return;
    const spline = world.route.spline!;
    const mesh = new InstancedMesh(geometry, this.forge.materials.surface, encounters.length);
    mesh.name = "prop.ruinedHouse";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const point = { x: 0, z: 0 };
    const tangent = { x: 0, z: 1 };
    const houseColors = terrainPaletteFor(segment.terrainStyle).houseColors;
    for (let i = 0; i < encounters.length; i++) {
      const encounter = encounters[i];
      spline.positionAt(point, encounter.distance);
      spline.tangentAt(tangent, encounter.distance);
      const x = point.x - tangent.z * encounter.lateral;
      const z = point.z + tangent.x * encounter.lateral;
      // The front doorway faces the route centreline.
      const towardRoute = encounter.lateral > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
      const heading = Math.atan2(tangent.x, tangent.z) + towardRoute;
      this.position.set(x, 0, z);
      this.quaternion.setFromAxisAngle(UP, heading);
      const scale = encounter.kind === "workshopNest" ? 1.12 : 1;
      this.scaleVector.setScalar(scale);
      this.matrix.compose(this.position, this.quaternion, this.scaleVector);
      mesh.setMatrixAt(i, this.matrix);
      this.instanceColor.setHex(houseColors[i % houseColors.length]);
      mesh.setColorAt(i, this.instanceColor);
      world.navigation.setStaticBox(x, z, 2.5 * scale, 2.2 * scale, heading);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.instanced.push(mesh);
    this.root.add(mesh);
  }

  /**
   * Authored wall-gap-tower rhythm for Rust Yard. Two reusable geometries make
   * the maze read as one designed place while remaining two instanced draws.
   */
  private buildMazePattern(
    world: GameWorld,
    segment: RouteSegmentDefinition,
    random: Random,
  ): void {
    const wallGeometry = this.tryPropGeometry("mazeWall");
    const towerGeometry = this.tryPropGeometry("mazeTower");
    const archGeometry = this.tryPropGeometry("mazeArch");
    if (!wallGeometry || !towerGeometry || !archGeometry) return;

    const spline = world.route.spline!;
    const spacing = 6.4;
    const stations = Math.floor(spline.length / spacing);
    // Every station emits exactly one prop per side, so `stations * 2` is the
    // only capacity any of the three can need. The tower mesh used to be sized
    // for `station % 8` alone while the loop also raises a tower at every
    // corner, which on the one maze stage in the game meant 36 towers written
    // into 14 slots - 22 matrices past the end of the buffer, silently.
    const perSideCapacity = stations * 2;
    const wallCapacity = perSideCapacity;
    const towerCapacity = perSideCapacity;
    const walls = new InstancedMesh(wallGeometry, this.forge.materials.surface, wallCapacity);
    const towers = new InstancedMesh(towerGeometry, this.forge.materials.surface, towerCapacity);
    const arches = new InstancedMesh(archGeometry, this.forge.materials.surface, perSideCapacity);
    walls.name = "prop.mazeWall";
    towers.name = "prop.mazeTower";
    arches.name = "prop.mazeArch";
    walls.castShadow = towers.castShadow = true;
    arches.castShadow = true;
    walls.receiveShadow = towers.receiveShadow = true;
    arches.receiveShadow = true;
    walls.frustumCulled = towers.frustumCulled = false;
    arches.frustumCulled = false;

    const point = { x: 0, z: 0 };
    const tangent = { x: 0, z: 0 };
    let wallCount = 0;
    let towerCount = 0;
    let archCount = 0;
    for (let station = 0; station < stations; station++) {
      const distance = station * spacing + spacing * 0.5;
      spline.positionAt(point, distance);
      spline.tangentAt(tangent, distance);
      const heading = Math.atan2(tangent.x, tangent.z);
      const nextHeading = spline.headingAt(Math.min(spline.length, distance + spacing));
      const corner = Math.abs(angleDelta(heading, nextHeading)) > 0.22;

      for (const side of SIDES) {
        const lateral = side * (segment.corridorHalfWidth + 1.1);
        this.position.set(point.x + -tangent.z * lateral, 0, point.z + tangent.x * lateral);
        this.quaternion.setFromAxisAngle(UP, heading + (side < 0 ? Math.PI : 0));

        // Every eighth station is a tower; every fourth leaves a deliberate
        // breach where enemies and the engineer can cross the wall line.
        if (corner || station % 8 === 0) {
          this.scaleVector.setScalar(random.range(0.94, 1.07));
          this.matrix.compose(this.position, this.quaternion, this.scaleVector);
          if (towerCount >= towerCapacity) continue;
          towers.setMatrixAt(towerCount++, this.matrix);
          world.navigation.setStatic(this.position.x, this.position.z, 1.35);
        } else if (station % 4 === 0) {
          this.scaleVector.setScalar(1);
          this.matrix.compose(this.position, this.quaternion, this.scaleVector);
          arches.setMatrixAt(archCount++, this.matrix);
          world.navigation.setStatic(
            this.position.x + tangent.x * 2.15,
            this.position.z + tangent.z * 2.15,
            0.72,
          );
          world.navigation.setStatic(
            this.position.x - tangent.x * 2.15,
            this.position.z - tangent.z * 2.15,
            0.72,
          );
        } else {
          this.scaleVector.set(1, random.range(0.94, 1.08), 1);
          this.matrix.compose(this.position, this.quaternion, this.scaleVector);
          walls.setMatrixAt(wallCount++, this.matrix);
          world.navigation.setStaticBox(this.position.x, this.position.z, 0.58, 2.85, heading);
        }
      }
    }

    walls.count = wallCount;
    towers.count = towerCount;
    arches.count = archCount;
    walls.instanceMatrix.needsUpdate = true;
    towers.instanceMatrix.needsUpdate = true;
    arches.instanceMatrix.needsUpdate = true;
    this.instanced.push(walls, towers, arches);
    this.root.add(walls, towers, arches);
  }

  /**
   * Low posts along the corridor edge. They are the one piece of explicit
   * wayfinding in the environment: at a glance they answer "which way is
   * forward" without a minimap.
   */
  private buildCorridorMarkers(
    world: GameWorld,
    segment: RouteSegmentDefinition,
    random: Random,
  ): void {
    const geometry = this.tryPropGeometry(MARKER_PROP);
    if (!geometry) return;
    const spline = world.route.spline!;
    const maze = segment.modifiers.includes("maze");
    const spacing = maze ? 8 : 14;
    const count = Math.floor(spline.length / spacing) * 2;
    if (count <= 0) return;

    const mesh = new InstancedMesh(geometry, this.forge.materials.surface, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.name = "prop.marker";

    const point = { x: 0, z: 0 };
    const tangent = { x: 0, z: 0 };
    let placed = 0;
    for (let i = 0; i < count / 2; i++) {
      const distance = i * spacing + 6;
      if (distance > spline.length) break;
      spline.positionAt(point, distance);
      spline.tangentAt(tangent, distance);
      for (const side of SIDES) {
        const lateral = side * (segment.corridorHalfWidth + 0.8);
        this.position.set(point.x + -tangent.z * lateral, 0, point.z + tangent.x * lateral);
        this.quaternion.setFromAxisAngle(UP, random.range(-0.2, 0.2));
        this.scaleVector.setScalar(random.range(maze ? 1.05 : 0.9, maze ? 1.25 : 1.1));
        this.matrix.compose(this.position, this.quaternion, this.scaleVector);
        mesh.setMatrixAt(placed++, this.matrix);
      }
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    this.instanced.push(mesh);
    this.root.add(mesh);
  }

  /**
   * The forge throws on an unknown prop name so a typo is loud at the source.
   * Dressing is cosmetic, though, so a missing prop must not take the run down
   * with it - it is reported once and skipped.
   */
  private tryPropGeometry(name: string): BufferGeometry | null {
    try {
      return this.forge.propGeometry(name);
    } catch {
      if (!this.reportedMissing.has(name)) {
        this.reportedMissing.add(name);
        console.warn(`[terrain] missing prop geometry "${name}"; skipping that scatter layer`);
      }
      return null;
    }
  }

  private readonly reportedMissing = new Set<string>();

  clear(): void {
    if (this.backdrop) {
      this.backdrop.geometry.dispose();
      this.root.remove(this.backdrop);
      this.backdrop = null;
    }
    if (this.ground) {
      this.ground.geometry.dispose();
      this.root.remove(this.ground);
      this.ground = null;
    }
    for (const mesh of this.instanced) {
      this.root.remove(mesh);
      mesh.dispose();
    }
    this.instanced.length = 0;
    for (const geometry of this.ownedGeometries) geometry.dispose();
    this.ownedGeometries.length = 0;
  }

  dispose(): void {
    this.clear();
    this.root.removeFromParent();
  }

  get drawCallEstimate(): number {
    return this.instanced.length + (this.ground ? 1 : 0);
  }
}

const UP = new Vector3(0, 1, 0);
const SIDES = [-1, 1] as const;

/**
 * Cheap deterministic value noise. Good enough for ground relief and colour
 * variation, and far cheaper than importing a simplex implementation for two
 * call sites.
 */
/**
 * Ground height at a point, in metres.
 *
 * Shared by the terrain mesh and by anything placed on it. The biome pass gave
 * each palette a `reliefScale` of up to 3.3 but left every scattered prop
 * pinned at y = 0, so on the high-relief biomes the dressing stood underneath
 * the ground it was supposed to be standing on. One expression, used by both,
 * is the only way those two stay in agreement.
 */
function groundHeightAt(
  x: number,
  z: number,
  absLateral: number,
  corridor: number,
  reliefScale: number,
): number {
  const relief = smoothstep(corridor * 0.85, corridor * 2.6, absLateral);
  return (
    relief * reliefScale *
    (valueNoise(x * 0.055, z * 0.055) * 1.9 + valueNoise(x * 0.17, z * 0.17) * 0.55)
  );
}

function valueNoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);

  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);

  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function hash2(x: number, z: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export const TERRAIN_CELL_HINT = NAVIGATION.cellSize;
