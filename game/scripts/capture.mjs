#!/usr/bin/env node
/**
 * Visual-QA capture harness.
 *
 * Drives headless Edge over the running dev/preview server and writes one PNG
 * per scenario from `src/dev/captures.ts`. The scenes are deterministic, so a
 * capture set taken before and after a change is directly comparable, which is
 * what §10 of the implementation plan asks for.
 *
 * Usage:
 *   node scripts/capture.mjs [--url http://localhost:4210] [--out docs/captures]
 *                            [--width 1920] [--height 1080] [--only march,horde]
 *
 * WebGL in headless Edge falls back to SwiftShader, so the images are correct
 * but slower to produce than an on-GPU run. Colour, layout and composition are
 * unaffected, which is all the visual rubric scores.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const run = promisify(execFile);

const CAPTURE_IDS = [
  "march",
  "houses",
  "placement",
  "horde",
  "lastshot",
  "pursuit",
  "route",
  "upgrade",
  "module",
  "victory",
  "defeat",
];

/**
 * Scenes heavy enough that SwiftShader needs longer to finish the first frame.
 * The budget is virtual time, so a generous value costs nothing on light scenes
 * but is the difference between an image and a timeout on a 130-enemy one.
 */
const HEAVY_CAPTURES = new Set(["houses", "horde", "pursuit", "lastshot", "upgrade"]);

const EDGE_CANDIDATES = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];

function parseArgs(argv) {
  const args = {
    url: "http://localhost:4210",
    out: path.resolve(process.cwd(), "../docs/captures"),
    width: 1920,
    height: 1080,
    only: null,
    budget: 9000,
  };
  // Both `--width=1280` and `--width 1280` are accepted, and anything else is a
  // hard error. The earlier version took only the `=` form and silently skipped
  // everything else, so `--width 1280 --height 720` produced a full set of
  // 1920x1080 images under a directory named for 720 - a capture set that lies
  // about what it is. A harness that quietly ignores its instructions is worse
  // than one that refuses them.
  const rest = [...argv];
  while (rest.length > 0) {
    const raw = rest.shift();
    if (!raw.startsWith("--")) {
      throw new Error(`unexpected argument "${raw}" (flags must start with --)`);
    }
    const eq = raw.indexOf("=");
    const key = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    let value = eq === -1 ? undefined : raw.slice(eq + 1);
    if (value === undefined) {
      if (rest.length === 0 || rest[0].startsWith("--")) {
        throw new Error(`flag --${key} needs a value`);
      }
      value = rest.shift();
    }

    if (key === "url") args.url = value;
    else if (key === "out") args.out = path.resolve(process.cwd(), value);
    else if (key === "width") args.width = requireNumber(key, value);
    else if (key === "height") args.height = requireNumber(key, value);
    else if (key === "budget") args.budget = requireNumber(key, value);
    else if (key === "only") args.only = value.split(",").map((s) => s.trim()).filter(Boolean);
    else throw new Error(`unknown flag --${key}`);
  }
  return args;
}

function requireNumber(key, value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`flag --${key} needs a positive number, got "${value}"`);
  }
  return parsed;
}

function findBrowser() {
  for (const candidate of EDGE_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function capture(browser, args, id) {
  // The screenshot path must be absolute; a relative one fails with an opaque
  // "Access is denied" on Windows.
  const file = path.resolve(args.out, `${id}-${args.width}x${args.height}.png`);
  await rm(file, { force: true });

  const url = `${args.url}?capture=${encodeURIComponent(id)}&seed=IRONMARCH`;
  const flags = [
    "--headless=new",
    "--disable-gpu",
    // SwiftShader is what makes WebGL work at all without a display.
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    `--window-size=${args.width},${args.height}`,
    `--screenshot=${file}`,
    // Virtual time lets the page finish its synchronous capture setup before
    // the shot, without guessing at a wall-clock sleep.
    `--virtual-time-budget=${HEAVY_CAPTURES.has(id) ? args.budget * 4 : args.budget}`,
    url,
  ];

  try {
    // Generous: the densest scenes rasterise ~200 enemies in software, which is
    // minutes of CPU work for one frame that a GPU would produce instantly.
    await run(browser, flags, { timeout: 900000, windowsHide: true });
  } catch (error) {
    // Edge exits non-zero on some benign teardown paths; the file is the truth.
    if (!existsSync(file)) throw error;
  }

  if (!existsSync(file)) {
    throw new Error(`no image produced for "${id}"`);
  }
  const info = await stat(file);
  return { id, file, bytes: info.size };
}

/**
 * Fails loudly unless the URL serves the game's own page. A 200 from something
 * that is not this app would be just as misleading as no server at all, so the
 * body is checked for the canvas the renderer attaches to.
 */
async function assertServing(url) {
  let response;
  try {
    response = await fetch(url, { redirect: "follow" });
  } catch (error) {
    throw new Error(
      `nothing is serving ${url} (${error.message}).\n` +
        `  Start the dev server first:  npx vite --port 4210`,
    );
  }
  if (!response.ok) {
    throw new Error(`${url} answered HTTP ${response.status}; expected the game's index.html`);
  }
  const body = await response.text();
  if (!body.includes("game-canvas")) {
    throw new Error(
      `${url} answered, but the page is not Marcha de Ferro - no #game-canvas in the markup.`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browser = findBrowser();
  if (!browser) {
    console.error("No Edge or Chrome executable found. Looked in:");
    for (const candidate of EDGE_CANDIDATES) console.error(`  ${candidate}`);
    process.exit(1);
  }

  const ids = args.only ?? CAPTURE_IDS;
  const unknown = ids.filter((id) => !CAPTURE_IDS.includes(id));
  if (unknown.length > 0) {
    console.error(`Unknown capture id(s): ${unknown.join(", ")}`);
    console.error(`Known: ${CAPTURE_IDS.join(", ")}`);
    process.exit(1);
  }

  // Confirm something is actually serving the game before shooting anything.
  //
  // Headless Chromium screenshots whatever is on screen, and "whatever is on
  // screen" for a dead server is the browser's own connection-error page. It
  // renders, it is the right size, and it gets written and counted as a
  // success - a whole capture set replaced by pictures of an error message,
  // reported as "10/10 captures written". This harness has now produced
  // misleading output five separate ways, every one of them silent, so the
  // cheapest possible check goes in front of the expensive work.
  await assertServing(args.url);

  await mkdir(args.out, { recursive: true });
  console.log(`browser: ${browser}`);
  console.log(`server:  ${args.url}`);
  console.log(`output:  ${args.out}`);
  console.log(`size:    ${args.width}x${args.height}`);

  const results = [];
  for (const id of ids) {
    process.stdout.write(`  ${id} ... `);
    try {
      const result = await capture(browser, args, id);
      results.push(result);
      console.log(`${(result.bytes / 1024).toFixed(0)} kB`);
    } catch (error) {
      console.log(`FAILED: ${error.message}`);
      results.push({ id, file: null, bytes: 0, error: error.message });
    }
  }

  const failed = results.filter((r) => !r.file);
  console.log(`\n${results.length - failed.length}/${results.length} captures written.`);
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
