/**
 * The shared material set.
 *
 * There are exactly two lit materials in the whole game and both are
 * vertex-coloured, because colour lives in the geometry. Everything else is an
 * unlit basic material for glow, VFX and placement ghosts, cached per colour so
 * a hundred muzzle flashes cost one material.
 *
 * `flatShading` is on deliberately: it lets the forge share vertices between the
 * faces of a chamfered box (24 vertices instead of 132) and still render every
 * facet crisply, which is where most of the vertex budget saving comes from.
 */

import {
  AdditiveBlending,
  DoubleSide,
  type Material,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
} from "three";

function cacheKey(color: number, intensity: number): number {
  return (color >>> 0) * 256 + Math.min(255, Math.max(0, Math.round(intensity * 24)));
}

export class MaterialLibrary {
  /** Vertex-coloured opaque surface. The workhorse. */
  readonly surface: MeshStandardMaterial;
  /** Same but cheaper shading, for distant instanced props. */
  readonly surfaceCheap: MeshLambertMaterial;

  private readonly emissiveCache = new Map<number, MeshBasicMaterial>();
  private readonly additiveCache = new Map<number, MeshBasicMaterial>();
  private readonly ringDecalCache = new Map<number, MeshBasicMaterial>();
  private readonly ghostCache = new Map<number, MeshBasicMaterial>();
  /** Per-instance materials handed out by `emissiveUnique`, tracked for dispose. */
  private readonly owned: Material[] = [];

  constructor() {
    this.surface = new MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.78,
      metalness: 0,
      flatShading: true,
    });
    this.surface.name = "surface";

    this.surfaceCheap = new MeshLambertMaterial({
      color: 0xffffff,
      vertexColors: true,
      flatShading: true,
    });
    this.surfaceCheap.name = "surfaceCheap";
  }

  /**
   * Emissive, unlit surface: furnace glow, eyes, network lines, ghosts.
   * Shared per colour, so callers must never mutate the returned material.
   */
  emissive(color: number, intensity = 1): MeshBasicMaterial {
    const key = cacheKey(color, intensity);
    let material = this.emissiveCache.get(key);
    if (!material) {
      material = new MeshBasicMaterial({ color, toneMapped: false });
      material.color.multiplyScalar(intensity);
      material.name = `emissive_${color.toString(16)}`;
      this.emissiveCache.set(key, material);
    }
    return material;
  }

  /**
   * A private emissive material for something the render layer animates per
   * instance (a turret's pressure gauge, a mine's arming light, the spider's
   * furnace). Still owned by the library, so `dispose` still cleans it up.
   */
  emissiveUnique(color: number, intensity = 1): MeshBasicMaterial {
    const material = new MeshBasicMaterial({ color, toneMapped: false });
    material.color.multiplyScalar(intensity);
    material.name = `emissiveUnique_${color.toString(16)}`;
    this.owned.push(material);
    return material;
  }

  /** Additive, depth-write-off sprite material for VFX. */
  additive(color: number): MeshBasicMaterial {
    let material = this.additiveCache.get(color >>> 0);
    if (!material) {
      material = new MeshBasicMaterial({
        color,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
      material.name = `additive_${color.toString(16)}`;
      this.additiveCache.set(color >>> 0, material);
    }
    return material;
  }

  /**
   * Opaque-hue ground ring, for state that must stay distinguishable by colour.
   *
   * Additive blending adds the ring's colour to the lit ground beneath it, and
   * the ground is bright enough that any warm colour saturates red and green to
   * 255 - so the player's marker, the placement ghost and an unpowered
   * structure's ring, declared as three different hues, all rendered as the same
   * yellow. Only the blue channel survived, which is not a cue anyone can read
   * at this size. Rings drawn with this keep the hue the palette declared.
   *
   * Genuine glows and impacts still want `additive`; this is for the flat ground
   * decals whose whole job is to mean one specific thing.
   */
  ringDecal(color: number): MeshBasicMaterial {
    let material = this.ringDecalCache.get(color >>> 0);
    if (!material) {
      material = new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
      material.name = `ringDecal_${color.toString(16)}`;
      this.ringDecalCache.set(color >>> 0, material);
    }
    return material;
  }

  /** Translucent placement ghost. */
  ghost(color: number): MeshBasicMaterial {
    let material = this.ghostCache.get(color >>> 0);
    if (!material) {
      material = new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      });
      material.name = `ghost_${color.toString(16)}`;
      this.ghostCache.set(color >>> 0, material);
    }
    return material;
  }

  /** Live material count, for the debug overlay. */
  get count(): number {
    return (
      2 +
      this.emissiveCache.size +
      this.additiveCache.size +
      this.ringDecalCache.size +
      this.ghostCache.size +
      this.owned.length
    );
  }

  dispose(): void {
    this.surface.dispose();
    this.surfaceCheap.dispose();
    for (const material of this.emissiveCache.values()) material.dispose();
    for (const material of this.additiveCache.values()) material.dispose();
    for (const material of this.ringDecalCache.values()) material.dispose();
    for (const material of this.ghostCache.values()) material.dispose();
    for (const material of this.owned) material.dispose();
    this.emissiveCache.clear();
    this.additiveCache.clear();
    this.ringDecalCache.clear();
    this.ghostCache.clear();
    this.owned.length = 0;
  }
}
