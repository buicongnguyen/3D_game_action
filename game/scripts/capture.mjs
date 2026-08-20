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

import { spawn } from "node:child_process";
import { mkdir, rm, stat, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const CAPTURE_IDS = [
  "march",
  "houses",
  "flooded",
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
const HEAVY_CAPTURES = new Set(["houses", "flooded", "horde", "pursuit", "lastshot", "upgrade"]);

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
    port: 9222,
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
    else if (key === "port") args.port = requireNumber(key, value);
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

/**
 * Shoots one scene through an already-open protocol session.
 *
 * This used to launch a browser per capture with `--screenshot=<path>`, and
 * that flag silently stopped producing a file: every invocation exited 0, wrote
 * nothing, and printed nothing, so a full set failed as twelve identical
 * "no image produced" lines with no cause to chase. `record.mjs` and
 * `perf.mjs` already drive the browser over the DevTools protocol, and
 * `Page.captureScreenshot` returns the bytes rather than trusting the browser
 * to write them - so there is one mechanism here now instead of two, and the
 * one that remains is the one under test by two other harnesses.
 *
 * It is also far quicker: one browser for the whole set rather than one per
 * scene, and no virtual-time budget to guess at, because the page says when it
 * is ready.
 */
async function capture(session, args, id) {
  const file = path.resolve(args.out, `${id}-${args.width}x${args.height}.png`);
  await rm(file, { force: true });

  await session.send("Page.navigate", { url: sceneUrl(args, id) });
  await waitForScene(session, id, args.budget * (HEAVY_CAPTURES.has(id) ? 8 : 4));

  const shot = await session.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const buffer = Buffer.from(shot.data, "base64");

  const size = pngSize(buffer);
  if (!size) throw new Error(`"${id}" did not come back as a PNG`);
  if (size.width !== args.width || size.height !== args.height) {
    throw new Error(
      `"${id}" came back ${size.width}x${size.height}, not ${args.width}x${args.height}`,
    );
  }

  await writeFile(file, buffer);
  return { id, file, bytes: buffer.length };
}

function sceneUrl(args, id) {
  return `${args.url}?capture=${encodeURIComponent(id)}&seed=IRONMARCH`;
}

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

  const profile = await mkdtemp(path.join(os.tmpdir(), "marcha-capture-"));
  const child = spawn(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      `--window-size=${args.width},${args.height}`,
      `--remote-debugging-port=${args.port}`,
      `--user-data-dir=${profile}`,
      sceneUrl(args, ids[0]),
    ],
    { windowsHide: true, stdio: "ignore" },
  );

  const results = [];
  let session = null;
  try {
    const target = await waitForTarget(args.port, 30000, "capture=");
    session = await connect(target.webSocketDebuggerUrl);
    // The window size flag sets the OS window; the viewport is what renders.
    await session.send("Emulation.setDeviceMetricsOverride", {
      width: args.width,
      height: args.height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    for (const id of ids) {
      process.stdout.write(`  ${id} ... `);
      try {
        const result = await capture(session, args, id);
        results.push(result);
        console.log(`${(result.bytes / 1024).toFixed(0)} kB`);
      } catch (error) {
        console.log(`FAILED: ${error.message}`);
        results.push({ id, file: null, bytes: 0, error: error.message });
      }
    }
  } finally {
    session?.close();
    child.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }

  const failed = results.filter((r) => !r.file);
  console.log(`
${results.length - failed.length}/${results.length} captures written.`);
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for the browser to open its protocol port and hand over the game's page target. */
async function waitForTarget(port, timeoutMs, marker) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no page target";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find(
          (entry) =>
            entry.type === "page" && entry.webSocketDebuggerUrl && entry.url.includes(marker),
        );
        if (page) return page;
        lastError = `targets: ${targets.map((t) => `${t.type} ${t.url}`).join(", ") || "none"}`;
      }
    } catch (error) {
      lastError = error.message;
    }
    await delay(200);
  }
  throw new Error(`browser did not expose a page within ${timeoutMs} ms (${lastError})`);
}

/**
 * Waits for the scene to finish setting itself up.
 *
 * `main.ts` sets `__captureReady` after the scenario has run and been drawn.
 * The search string is checked as well, because the previous scene's page can
 * still be current for a moment after `Page.navigate` returns and it would
 * answer this question with a confident yes about the wrong scene.
 */
async function waitForScene(session, id, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const probe = `window.__captureReady === true && location.search.indexOf("capture=${id}") >= 0`;
  while (Date.now() < deadline) {
    if ((await evaluate(session, probe).catch(() => false)) === true) return;
    await delay(150);
  }
  const title = await evaluate(session, "document.title").catch(() => "unreadable");
  throw new Error(
    `scene "${id}" was not ready within ${Math.round(timeoutMs / 1000)} s (page title: "${title}"). ` +
      `Is the dev server serving ?capture=${id}?`,
  );
}

async function evaluate(session, expression) {
  const evaluated = await session.send("Runtime.evaluate", { expression, returnByValue: true });
  if (evaluated.exceptionDetails) {
    const details = evaluated.exceptionDetails;
    throw new Error(details.exception?.description ?? details.text ?? "evaluation failed");
  }
  return evaluated.result?.value;
}

/**
 * Width and height straight out of the PNG header.
 *
 * The image is the artefact, so the image is what gets asked. Trusting the flag
 * that was passed to the browser is how a set of stills came to be filed under
 * a resolution none of them had.
 */
function pngSize(buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length < 24) return null;
  for (let i = 0; i < signature.length; i++) if (buffer[i] !== signature[i]) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Minimal DevTools protocol client, the same shape `perf.mjs` uses. */
async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 0;
  let closed = null;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });
  const failAll = (error) => {
    closed = error;
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  socket.addEventListener("error", () => failAll(new Error("protocol socket error")));
  socket.addEventListener("close", () => failAll(new Error("protocol socket closed")));

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("could not open protocol socket")), {
      once: true,
    });
  });

  return {
    send: (method, params) =>
      new Promise((resolve, reject) => {
        if (closed) return reject(closed);
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      }),
    close: () => socket.close(),
  };
}
