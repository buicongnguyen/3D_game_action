#!/usr/bin/env node
/**
 * Build-gate check, run by `npm run validate-assets`. Validates:
 *
 *   1. `public/assets/manifest.json` schema (required fields, `/assets/`-
 *      rooted runtime paths, relative source paths, unique runtime paths).
 *   2. No absolute local filesystem path anywhere in the manifest or in
 *      `src/**` — the acceptance criterion "no runtime links to local
 *      absolute paths".
 *   3. If assets have actually been synced to disk, that every manifest
 *      entry's runtime file is present and every `.gltf`'s dependencies were
 *      copied alongside it. If nothing has been synced, this is procedural
 *      mode, which is a pass, not a failure — the game is designed to run
 *      that way.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(GAME_ROOT, "public/assets/manifest.json");
const PUBLIC_DIR = path.join(GAME_ROOT, "public");
const SRC_DIR = path.join(GAME_ROOT, "src");

const DRIVE_LETTER_ANCHORED = /^[A-Za-z]:[\\/]/;
const FILE_URL_ANCHORED = /^file:\/\//;
/** Same intent, but for occurrences embedded inside source text rather than a discrete JSON value. */
const DRIVE_LETTER_EMBEDDED = /(^|[\s"'`(=,])[A-Za-z]:[\\/]/;
const FILE_URL_EMBEDDED = /(^|[\s"'`(=,])file:\/\//;

const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".css", ".html", ".md"]);

const violations = [];

function fail(message) {
  violations.push(message);
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function runtimeToAbsolute(runtimePath) {
  return path.join(PUBLIC_DIR, runtimePath);
}

// ---------------------------------------------------------------------------
// 1. Manifest schema
// ---------------------------------------------------------------------------

function validateSchema(manifest) {
  if (manifest.version !== 1) {
    fail(`manifest.json: expected version 1, found ${JSON.stringify(manifest.version)}`);
  }
  if (typeof manifest.sourceRootEnv !== "string" || manifest.sourceRootEnv.length === 0) {
    fail("manifest.json: sourceRootEnv must be a non-empty string");
  }
  if (!Array.isArray(manifest.licenses) || manifest.licenses.length === 0) {
    fail("manifest.json: licenses must be a non-empty array");
  }
  if (typeof manifest.assets !== "object" || manifest.assets === null) {
    fail("manifest.json: assets must be an object");
    return;
  }

  const seenRuntimePaths = new Map(); // runtime -> [ids]

  for (const [key, entry] of Object.entries(manifest.assets)) {
    const where = `manifest.json:assets["${key}"]`;

    if (entry.id !== key) {
      fail(`${where}: id field ("${entry.id}") does not match its manifest key`);
    }
    if (typeof entry.source !== "string" || entry.source.length === 0) {
      fail(`${where}: source must be a non-empty string`);
    } else if (path.win32.isAbsolute(entry.source) || path.posix.isAbsolute(entry.source)) {
      fail(`${where}: source ("${entry.source}") must be relative to ASSET_SOURCE_ROOT, not absolute`);
    }
    if (typeof entry.runtime !== "string" || !entry.runtime.startsWith("/assets/")) {
      fail(`${where}: runtime ("${entry.runtime}") must start with "/assets/"`);
    } else {
      const owners = seenRuntimePaths.get(entry.runtime) ?? [];
      owners.push(key);
      seenRuntimePaths.set(entry.runtime, owners);
    }
    if (typeof entry.scale !== "number" || !Number.isFinite(entry.scale) || entry.scale <= 0) {
      fail(`${where}: scale must be a positive finite number`);
    }
    if (typeof entry.rotationY !== "number" || !Number.isFinite(entry.rotationY)) {
      fail(`${where}: rotationY must be a finite number`);
    }
    if (typeof entry.castShadow !== "boolean") {
      fail(`${where}: castShadow must be a boolean`);
    }
    if (typeof entry.kind !== "string" || entry.kind.length === 0) {
      fail(`${where}: kind must be a non-empty string`);
    }
    if (entry.procedural !== true) {
      fail(`${where}: procedural must be true (every id must have a MeshForge fallback)`);
    }
  }

  for (const [runtime, owners] of seenRuntimePaths) {
    if (owners.length > 1) {
      fail(`manifest.json: duplicate runtime path "${runtime}" claimed by [${owners.join(", ")}]`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. No absolute local paths, anywhere
// ---------------------------------------------------------------------------

function scanJsonForAbsolutePaths(value, jsonPath, into) {
  if (typeof value === "string") {
    if (DRIVE_LETTER_ANCHORED.test(value) || FILE_URL_ANCHORED.test(value)) {
      into.push(`manifest.json:${jsonPath}: absolute local path "${value}"`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanJsonForAbsolutePaths(item, `${jsonPath}[${index}]`, into));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      scanJsonForAbsolutePaths(item, `${jsonPath}.${key}`, into);
    }
  }
}

async function walkFiles(dir, onFile) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(full, onFile);
    } else if (entry.isFile()) {
      await onFile(full);
    }
  }
}

async function scanSrcForAbsolutePaths() {
  await walkFiles(SRC_DIR, async (filePath) => {
    if (!TEXT_EXTENSIONS.has(path.extname(filePath))) return;
    const text = await fs.readFile(filePath, "utf8");
    const relPath = path.relative(GAME_ROOT, filePath);
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (DRIVE_LETTER_EMBEDDED.test(line) || FILE_URL_EMBEDDED.test(line)) {
        fail(`${relPath}:${index + 1}: absolute local path found: "${line.trim()}"`);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// 3. Synced-file consistency (or procedural-mode pass)
// ---------------------------------------------------------------------------

function decodeGltfUri(uri) {
  return decodeURIComponent(uri);
}

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

async function validateSyncedFiles(manifest) {
  const entries = Object.entries(manifest.assets);

  const presentEntries = [];
  for (const [id, entry] of entries) {
    if (await pathExists(runtimeToAbsolute(entry.runtime))) presentEntries.push(id);
  }

  if (presentEntries.length === 0) {
    console.log(`Asset validation: procedural mode: ${entries.length} assets will be generated at runtime.`);
    return;
  }

  console.log(
    `Asset validation: synced mode: ${presentEntries.length}/${entries.length} manifest entries have files on disk.`,
  );

  for (const [id, entry] of entries) {
    const runtimeAbs = runtimeToAbsolute(entry.runtime);
    if (!(await pathExists(runtimeAbs))) {
      fail(`synced assets present, but "${id}" is missing its runtime file at public${entry.runtime}`);
      continue;
    }

    if (entry.source.toLowerCase().endsWith(".gltf")) {
      let gltfJson;
      try {
        gltfJson = JSON.parse(await fs.readFile(runtimeAbs, "utf8"));
      } catch (error) {
        fail(`"${id}": public${entry.runtime} is not valid JSON (${error.message})`);
        continue;
      }
      const runtimeDir = path.dirname(runtimeAbs);
      for (const uri of collectGltfDependencyUris(gltfJson)) {
        if (uri.startsWith("data:")) continue;
        const depAbs = path.join(runtimeDir, decodeGltfUri(uri));
        if (!(await pathExists(depAbs))) {
          fail(`"${id}": dependency "${uri}" referenced by public${entry.runtime} was not copied (expected at ${depAbs})`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const manifestRaw = await fs.readFile(MANIFEST_PATH, "utf8");
  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (error) {
    console.error(`Asset validation failed: manifest.json is not valid JSON (${error.message})`);
    process.exitCode = 1;
    return;
  }

  validateSchema(manifest);
  scanJsonForAbsolutePaths(manifest, "$", violations);
  await scanSrcForAbsolutePaths();

  if (violations.length === 0) {
    await validateSyncedFiles(manifest);
  }

  if (violations.length > 0) {
    console.error(`Asset validation failed with ${violations.length} violation(s):`);
    for (const violation of violations) console.error(`  ! ${violation}`);
    process.exitCode = 1;
    return;
  }

  console.log("Asset validation passed.");
  process.exitCode = 0;
}

main().catch((error) => {
  console.error("Asset validation crashed with an unexpected error:");
  console.error(error);
  process.exitCode = 1;
});
