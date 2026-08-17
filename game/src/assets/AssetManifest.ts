/**
 * Typed view over `public/assets/manifest.json`.
 *
 * The manifest is authored by `scripts/sync-assets.mjs` and validated by
 * `scripts/validate-assets.mjs`; this module only reads it. Every entry
 * carries `procedural: true` because `MeshForge` can generate a stand-in for
 * every id in this file, which is what lets the game boot with zero synced
 * assets on disk.
 */
import manifestJson from "../../public/assets/manifest.json";

export interface AssetEntry {
  id: string;
  source: string;
  runtime: string;
  scale: number;
  rotationY: number;
  castShadow: boolean;
  kind: string;
  procedural: boolean;
}

export interface Manifest {
  version: number;
  sourceRootEnv: string;
  licenses: string[];
  assets: Record<string, AssetEntry>;
}

export const MANIFEST: Manifest = manifestJson as Manifest;

export function getEntry(id: string): AssetEntry {
  const entry = MANIFEST.assets[id];
  if (!entry) {
    throw new Error(
      `AssetManifest: unknown asset id "${id}". Check public/assets/manifest.json.`,
    );
  }
  return entry;
}

export function hasEntry(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(MANIFEST.assets, id);
}

export function assetIds(): readonly string[] {
  return Object.keys(MANIFEST.assets);
}
