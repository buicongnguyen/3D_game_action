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
import { clamp, smoothstep } from "../core/math.ts";
import { ENV } from "../art/palette.ts";
import { NAVIGATION } from "../data/balance.ts";
import type { MeshForge } from "../art/MeshForge.ts";
import type { GameWorld } from "../game/GameWorld.ts";
import type { RouteSegmentDefinition } from "../core/types.ts";

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
  { name: "treeConifer", count: 76, minLateral: 13, maxLateral: 46, scaleMin: 0.85, scaleMax: 1.35, blocks: 1.15 },
  { name: "treeBroadleaf", count: 64, minLateral: 13, maxLateral: 46, scaleMin: 0.9, scaleMax: 1.4, blocks: 1.2 },
  { name: "treeSpindle", count: 48, minLateral: 12, maxLateral: 44, scaleMin: 0.85, scaleMax: 1.25, blocks: 0.95 },
  { name: "treeConiferB", count: 44, minLateral: 14, maxLateral: 48, scaleMin: 0.9, scaleMax: 1.3, blocks: 1.1 },
  { name: "bareTree", count: 62, minLateral: 11, maxLateral: 44, scaleMin: 0.9, scaleMax: 1.45, blocks: 1.0 },
  { name: "bareTreeB", count: 40, minLateral: 11, maxLateral: 42, scaleMin: 0.85, scaleMax: 1.35, blocks: 0.95 },
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
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly scaleVector = new Vector3();

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

    this.buildBackdrop(world);

    this.ground = new Mesh(this.buildGroundGeometry(world, segment), this.forge.materials.surface);
    this.ground.receiveShadow = true;
    this.ground.castShadow = false;
    this.ground.frustumCulled = false;
    this.root.add(this.ground);

    this.scatterProps(world, segment, random);
    this.buildCorridorMarkers(world, segment, random);
  }

  /**
   * A single large plane under everything.
   *
   * The detailed strip follows the spline, so on the outside of a bend its edge
   * can enter frame as a hard diagonal line against the fog. One flat quad
   * beneath it, sitting a few centimetres lower and coloured to match what the
   * fog resolves to at that distance, removes the seam for one draw call.
   */
  private buildBackdrop(world: GameWorld): void {
    const spline = world.route.spline;
    if (!spline) return;

    const geometry = new PlaneGeometry(1, 1, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    const colors = new Float32Array(4 * 3);
    // Matched to the strip's own outer value, not to something darker. A
    // backdrop that contrasts with the strip removes the void but replaces it
    // with an equally visible seam; matching makes the transition disappear.
    const shade = new Color(ENV.groundBase);
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
    const pathColor = new Color(ENV.path);
    const pathEdge = new Color(ENV.pathEdge);
    const groundBase = new Color(ENV.groundBase);
    const groundDark = new Color(ENV.groundDark);
    const groundLight = new Color(ENV.groundLight);
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
        const relief = smoothstep(corridor * 0.85, corridor * 2.6, absLateral);
        const y =
          relief *
          (valueNoise(x * 0.055, z * 0.055) * 1.9 + valueNoise(x * 0.17, z * 0.17) * 0.55);

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
    const point = { x: 0, z: 0 };
    const tangent = { x: 0, z: 0 };

    world.navigation.clearStatic();

    const occupiedX: number[] = [];
    const occupiedZ: number[] = [];
    const occupiedR: number[] = [];

    for (let typeIndex = 0; typeIndex < PROP_TYPES.length; typeIndex++) {
      const type = PROP_TYPES[typeIndex];
      const geometry = this.tryPropGeometry(type.name);
      if (!geometry) continue;

      const mesh = new InstancedMesh(geometry, this.forge.materials.surface, type.count);
      // Only silhouette-scale props cast. A grass tuft's shadow is invisible at
      // this camera height but still costs a full extra pass over its instances.
      mesh.castShadow = type.blocks >= 1;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.name = `prop.${type.name}`;

      let placed = 0;
      let attempts = 0;
      const maxAttempts = type.count * 12;

      while (placed < type.count && attempts < maxAttempts) {
        attempts++;
        const distance = random.range(-8, length + 8);
        spline.positionAt(point, clamp(distance, 0, length));
        spline.tangentAt(tangent, clamp(distance, 0, length));

        const side = random.bool() ? 1 : -1;
        const lateral =
          side * random.range(Math.max(type.minLateral, segment.corridorHalfWidth * 0.9), type.maxLateral);
        const x = point.x + -tangent.z * lateral;
        const z = point.z + tangent.x * lateral;

        let rejected = false;
        for (let i = 0; i < occupiedX.length; i++) {
          const dx = occupiedX[i] - x;
          const dz = occupiedZ[i] - z;
          const minimum = occupiedR[i] + 0.8;
          if (dx * dx + dz * dz < minimum * minimum) {
            rejected = true;
            break;
          }
        }
        if (rejected) continue;

        const scale = random.range(type.scaleMin, type.scaleMax);
        this.position.set(x, 0, z);
        this.quaternion.setFromAxisAngle(UP, random.angle());
        // Slight non-uniform scale stops a forest of identical clones reading
        // as one repeated object.
        this.scaleVector.set(scale * random.range(0.92, 1.08), scale, scale * random.range(0.92, 1.08));
        this.matrix.compose(this.position, this.quaternion, this.scaleVector);
        mesh.setMatrixAt(placed, this.matrix);

        if (type.blocks > 0) {
          const radius = type.blocks * scale;
          world.navigation.setStatic(x, z, radius);
          occupiedX.push(x);
          occupiedZ.push(z);
          occupiedR.push(radius);
        } else {
          occupiedX.push(x);
          occupiedZ.push(z);
          occupiedR.push(0.35 * scale);
        }
        placed++;
      }

      mesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
      this.instanced.push(mesh);
      this.root.add(mesh);
    }
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
    const spacing = 14;
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
        this.scaleVector.setScalar(random.range(0.9, 1.1));
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
