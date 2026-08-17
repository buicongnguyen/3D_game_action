/**
 * Runtime asset loading. Section 20 of the spec.
 *
 * The manifest lists assets that a licensed KayKit/Kenney library would
 * provide, but that library is not guaranteed to be present (see
 * `scripts/sync-assets.mjs`). Every id also has a procedural fallback drawn
 * by `MeshForge`, so `load()` never rejects: a missing file degrades to
 * procedural geometry, not a broken boot.
 *
 * Loading strategy per id:
 *   1. HEAD-probe the runtime URL. A 404/network failure is the expected,
 *      silent "not synced" case — never call GLTFLoader on a URL that is not
 *      already known to exist, because that is how a stray 404 becomes an
 *      uncaught console error.
 *   2. If the probe succeeds, load and cache the GLTF. A parse failure past
 *      that point is a real, reportable failure (the file is present but
 *      broken), recorded in `failures` with an actionable message.
 */
import type { AnimationClip, Material, Mesh, Object3D } from "three";
import { Texture } from "three";
import { LoadingManager } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { assetIds, getEntry } from "./AssetManifest.ts";

export interface AssetFailure {
  id: string;
  reason: string;
}

interface CachedAsset {
  scene: Object3D;
  animations: AnimationClip[];
}

const SYNC_COMMAND = "npm run sync-assets";

export class AssetManager {
  private readonly manager = new LoadingManager();
  private readonly loader: GLTFLoader;
  private readonly cache = new Map<string, CachedAsset>();

  private _usingProcedural = true;
  private _failures: AssetFailure[] = [];

  constructor() {
    this.loader = new GLTFLoader(this.manager);
  }

  get usingProcedural(): boolean {
    return this._usingProcedural;
  }

  get failures(): ReadonlyArray<AssetFailure> {
    return this._failures;
  }

  /**
   * Loads only the requested ids. Unknown ids and ids with no synced file on
   * disk are reported through `onProgress` and left absent from the cache;
   * callers must check `has(id)` and fall back to `MeshForge` for those.
   */
  async load(
    ids: readonly string[],
    onProgress: (fraction: number, label: string) => void,
  ): Promise<void> {
    this._failures = [];
    const total = ids.length;
    if (total === 0) {
      onProgress(1, "no assets requested");
      return;
    }

    let completed = 0;
    let loadedFromDisk = 0;
    const report = (label: string) => {
      completed += 1;
      onProgress(completed / total, label);
    };

    for (const id of ids) {
      if (!assetIds().includes(id)) {
        this._failures.push({
          id,
          reason: `"${id}" is not present in public/assets/manifest.json.`,
        });
        report(`${id}: unknown id`);
        continue;
      }

      const entry = getEntry(id);

      if (this.cache.has(id)) {
        loadedFromDisk += 1;
        report(`${id}: already loaded`);
        continue;
      }

      const available = await this.probe(entry.runtime);
      if (!available) {
        report(`${id}: procedural fallback`);
        continue;
      }

      try {
        const gltf = await this.loadGltf(entry.runtime);
        this.cache.set(id, { scene: gltf.scene, animations: gltf.animations });
        loadedFromDisk += 1;
        report(`${id}: loaded`);
      } catch (error) {
        this._failures.push({
          id,
          reason:
            `expected a synced model at "${entry.runtime}" but it failed to load ` +
            `(${describeError(error)}). Re-run "${SYNC_COMMAND}" with ASSET_SOURCE_ROOT ` +
            `set, or delete the stray file at public${entry.runtime} to use the ` +
            `procedural fallback instead.`,
        });
        report(`${id}: load failed, using procedural fallback`);
      }
    }

    if (loadedFromDisk > 0) this._usingProcedural = false;
  }

  private probe(url: string): Promise<boolean> {
    return fetch(url, { method: "HEAD" })
      .then((response) => response.ok)
      .catch(() => false);
  }

  private loadGltf(url: string): Promise<GLTF> {
    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => resolve(gltf),
        undefined,
        (error) => reject(error),
      );
    });
  }

  /** Returns a correctly-cloned scene for a rigged asset, or null. */
  instantiate(id: string): Object3D | null {
    const cached = this.cache.get(id);
    if (!cached) return null;

    const instance = cloneSkeleton(cached.scene);
    instance.animations = cached.animations;

    const entry = getEntry(id);
    instance.scale.setScalar(entry.scale);
    instance.rotation.y = entry.rotationY;
    instance.traverse((node) => {
      const mesh = node as Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = entry.castShadow;
        mesh.receiveShadow = true;
      }
    });

    return instance;
  }

  has(id: string): boolean {
    return this.cache.has(id);
  }

  /** Explicit disposal of geometries/materials/textures for cached originals. */
  dispose(): void {
    for (const asset of this.cache.values()) {
      asset.scene.traverse((node) => {
        const mesh = node as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) {
          for (const entry of material) disposeMaterial(entry);
        } else {
          disposeMaterial(material);
        }
      });
    }
    this.cache.clear();
    this._failures = [];
    this._usingProcedural = true;
  }
}

function disposeMaterial(material: Material): void {
  const record = material as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (value instanceof Texture) value.dispose();
  }
  material.dispose();
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}
