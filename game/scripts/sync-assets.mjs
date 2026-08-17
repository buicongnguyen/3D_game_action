#!/usr/bin/env node
/**
 * Copies the assets listed in `public/assets/manifest.json` out of a local
 * KayKit + Kenney library and into `public/assets/`, preserving the relative
 * structure `.gltf` files need to resolve their `.bin`/image dependencies.
 *
 * This machine does not have that library, which is expected: the game ships
 * with procedural geometry (`src/art/MeshForge.ts`) so it runs with zero
 * synced files. This script exists so the pipeline is correct on a machine
 * that *does* have `ASSET_SOURCE_ROOT` set to a real library.
 *
 * Usage:
 *   node scripts/sync-assets.mjs [--root=<path>] [--dry-run] [--verbose]
 *   ASSET_SOURCE_ROOT=<path> node scripts/sync-assets.mjs
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(GAME_ROOT, "public/assets/manifest.json");
const PUBLIC_DIR = path.join(GAME_ROOT, "public");
const LICENSES_DIR = path.join(PUBLIC_DIR, "assets/licenses");

function parseArgs(argv) {
  const args = { dryRun: false, verbose: false, root: undefined };
  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--verbose") args.verbose = true;
    else if (arg.startsWith("--root=")) args.root = arg.slice("--root=".length);
  }
  return args;
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(target) {
  try {
    const stat = await fs.stat(target);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Maps a runtime path (e.g. "/assets/kaykit/characters/Engineer.glb") to its
 * absolute location under public/. Node's path.join treats a leading "/" in
 * a non-first argument as a plain segment, so this is safe on Windows too.
 */
function runtimeToAbsolute(runtimePath) {
  return path.join(PUBLIC_DIR, runtimePath);
}

function licenseNamespace(relativeLicensePath) {
  const segments = relativeLicensePath.split(/[\\/]/);
  if (segments[0] === "kay_assets") return "kaykit";
  if (segments[0] === "assets" && segments.length > 1) return segments[1];
  return "misc";
}

/** Extracts buffers[].uri and images[].uri from a parsed .gltf JSON document. */
function collectGltfDependencyUris(gltfJson) {
  const uris = [];
  for (const bucket of [gltfJson.buffers, gltfJson.images]) {
    if (!Array.isArray(bucket)) continue;
    for (const item of bucket) {
      if (item && typeof item.uri === "string") uris.push(item.uri);
    }
  }
  return uris;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root ?? process.env.ASSET_SOURCE_ROOT;

  const manifestRaw = await fs.readFile(MANIFEST_PATH, "utf8");
  const manifest = JSON.parse(manifestRaw);
  const entries = Object.values(manifest.assets);

  if (!root || !(await isDirectory(root))) {
    console.log("Asset sync: procedural mode.");
    console.log("");
    if (!root) {
      console.log(`  ASSET_SOURCE_ROOT is not set (env var "${manifest.sourceRootEnv}"), and no --root=<path> was given.`);
    } else {
      console.log(`  ASSET_SOURCE_ROOT is set to "${root}", but that directory does not exist.`);
    }
    console.log("");
    console.log("  The game runs fine without it: every id in manifest.json has a");
    console.log("  procedural fallback in src/art/MeshForge.ts. To sync the real");
    console.log("  KayKit + Kenney library instead, set ASSET_SOURCE_ROOT to a folder");
    console.log("  that directly contains these paths:");
    console.log("");
    for (const license of manifest.licenses) {
      console.log(`    <ASSET_SOURCE_ROOT>/${license}`);
    }
    console.log("");
    console.log("  then re-run:");
    console.log("");
    console.log("    ASSET_SOURCE_ROOT=/path/to/library node scripts/sync-assets.mjs");
    console.log("");
    console.log(`  (${entries.length} manifest entries would be synced; 0 copied this run.)`);
    process.exitCode = 0;
    return;
  }

  console.log(`Asset sync: root = ${root}`);
  if (args.dryRun) console.log("  (dry run: no files will be written)");

  const missing = [];
  const destinationOwners = new Map(); // destAbsolutePath -> sourceAbsolutePath, for collision detection
  let copiedCount = 0;
  let skippedCount = 0;
  let totalBytes = 0;

  async function copyFile(sourceAbs, destAbs) {
    const previousOwner = destinationOwners.get(destAbs);
    if (previousOwner && previousOwner !== sourceAbs) {
      throw new Error(
        `runtime path collision: both "${previousOwner}" and "${sourceAbs}" want to copy to "${destAbs}". ` +
          `Manifest runtime paths must be unique per namespace.`,
      );
    }
    destinationOwners.set(destAbs, sourceAbs);

    if (!(await pathExists(sourceAbs))) {
      missing.push(sourceAbs);
      return;
    }

    const stat = await fs.stat(sourceAbs);

    if (!args.dryRun) {
      await fs.mkdir(path.dirname(destAbs), { recursive: true });
      const sameContent = await filesAreIdentical(sourceAbs, destAbs);
      if (sameContent) {
        skippedCount += 1;
        if (args.verbose) console.log(`  = ${path.relative(GAME_ROOT, destAbs)} (unchanged)`);
        return;
      }
      await fs.copyFile(sourceAbs, destAbs);
    }

    copiedCount += 1;
    totalBytes += stat.size;
    if (args.verbose) console.log(`  + ${path.relative(GAME_ROOT, destAbs)} (${stat.size} bytes)`);
  }

  async function filesAreIdentical(a, b) {
    if (!(await pathExists(b))) return false;
    const [statA, statB] = await Promise.all([fs.stat(a), fs.stat(b)]);
    if (statA.size !== statB.size) return false;
    const [bufA, bufB] = await Promise.all([fs.readFile(a), fs.readFile(b)]);
    return hashOf(bufA) === hashOf(bufB);
  }

  function hashOf(buffer) {
    return createHash("sha1").update(buffer).digest("hex");
  }

  for (const entry of entries) {
    const sourceAbs = path.join(root, entry.source);
    const destAbs = runtimeToAbsolute(entry.runtime);

    if (!(await pathExists(sourceAbs))) {
      missing.push(sourceAbs);
      continue;
    }

    await copyFile(sourceAbs, destAbs);

    if (entry.source.toLowerCase().endsWith(".gltf")) {
      let gltfJson;
      try {
        gltfJson = JSON.parse(await fs.readFile(sourceAbs, "utf8"));
      } catch (error) {
        missing.push(`${sourceAbs} (unparseable JSON: ${error.message})`);
        continue;
      }

      const sourceDir = path.dirname(sourceAbs);
      const destDir = path.dirname(destAbs);

      for (const uri of collectGltfDependencyUris(gltfJson)) {
        if (uri.startsWith("data:")) continue; // embedded, nothing to copy
        const decoded = decodeURIComponent(uri);
        const depSourceAbs = path.join(sourceDir, decoded);
        const depDestAbs = path.join(destDir, decoded);
        await copyFile(depSourceAbs, depDestAbs);
      }
    }
  }

  for (const license of manifest.licenses) {
    const sourceAbs = path.join(root, license);
    const destAbs = path.join(LICENSES_DIR, `${licenseNamespace(license)}-License.txt`);
    await copyFile(sourceAbs, destAbs);
  }

  console.log("");
  if (missing.length > 0) {
    console.log(`Missing ${missing.length} source path(s):`);
    for (const entry of missing) console.log(`  ! ${entry}`);
    console.log("");
  }

  console.log("Summary:");
  console.log(`  copied:  ${copiedCount}`);
  console.log(`  skipped: ${skippedCount} (already up to date)`);
  console.log(`  missing: ${missing.length}`);
  console.log(`  bytes:   ${totalBytes}`);

  if (missing.length > 0) {
    console.log("");
    console.log("Sync failed: the source root exists but some manifest entries are missing.");
    process.exitCode = 1;
  } else {
    console.log("");
    console.log("Sync complete.");
    process.exitCode = 0;
  }
}

main().catch((error) => {
  console.error("Asset sync failed with an unexpected error:");
  console.error(error);
  process.exitCode = 1;
});
