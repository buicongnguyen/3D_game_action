#!/usr/bin/env node
/**
 * Motion capture harness.
 *
 * Records a deterministic frame sequence of the running game: one PNG per fixed
 * 60 Hz simulation step, numbered, alongside the simulation state that produced
 * each one. §7 of `docs/VISUAL_QA.md` names this as the root blocker for the
 * "Animation and motion" rubric category - nothing in the repository could show
 * the game moving, so that category was scored from source reading and stills.
 *
 * Usage:
 *   node scripts/record.mjs [--url http://localhost:4210] [--out ../docs/motion]
 *                           [--only march,horde] [--frames 90]
 *                           [--width 960] [--height 540] [--port 9224]
 *                           [--seed IRONMARCH] [--hold KeyW]
 *
 * Why a fixed step and not a screencast. `Page.startScreencast` delivers frames
 * whenever the compositor happens to produce them, so frame spacing is whatever
 * the software rasteriser managed that second - which is exactly the quantity
 * that must be known for the output to be measurable. Driving `advance(1/60)`
 * from here instead makes frame N precisely N/60 simulated seconds in, so foot
 * travel between two frames can be divided by 1/60 and compared against the
 * engineer's ground speed directly. A gait defect is then arithmetic rather
 * than an impression.
 *
 * A take is a continuous sequence, so it cannot survive the page reloading in
 * the middle of one. Against `npm run dev` that happens on every source save,
 * which makes a take unrecordable while the tree is being edited; build first
 * and point `--url` at `vite preview` when that is the case. The recorder
 * detects the reload and abandons the take rather than filing a sequence with a
 * discontinuity in it.
 *
 * `--virtual-time-budget` is deliberately absent, as it is in `perf.mjs`.
 * Virtual time replaces the clock, and every timing this project reported under
 * it was a stopped watch being read as a fast one. Nothing here needs it: the
 * page is held open by the protocol connection, not by a fake clock.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const EDGE_CANDIDATES = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];

/** Every scene `src/dev/captures.ts` defines, so `--only` can reach any of them. */
const CAPTURE_IDS = [
  "march",
  "gearshift",
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
 * What gets recorded by default, and what is held down while it records.
 *
 * The held keys are not decoration. The engineer moves only while the stick is
 * pushed, and `PLAYER.deceleration` is 70 m/s against a top speed of 5.5, so he
 * is standing still 0.08 s after input stops. Every capture scene runs a settle
 * pass before the recorder attaches, which means an unattended take is ninety
 * frames of a man standing still - and foot sliding is only visible against
 * sustained ground speed. The keys go in as real key events over the protocol,
 * so they travel the same `InputManager` path a player's keyboard does.
 */
const TAKES = [
  { id: "march", hold: ["KeyW"] },
  { id: "gearshift", hold: ["KeyW"] },
  // The horde and the fuse animate themselves; adding player input would only
  // put the engineer somewhere the scene was not staged for.
  { id: "horde", hold: [] },
  { id: "lastshot", hold: [] },
];

/** Codes the recorder knows how to press, with the fields Chrome needs to synthesise one. */
const KEYS = {
  KeyW: { key: "w", code: "KeyW", virtual: 87 },
  KeyA: { key: "a", code: "KeyA", virtual: 65 },
  KeyS: { key: "s", code: "KeyS", virtual: 83 },
  KeyD: { key: "d", code: "KeyD", virtual: 68 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", virtual: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", virtual: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", virtual: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", virtual: 39 },
};

const STEP = 1 / 60;

function parseArgs(argv) {
  const args = {
    url: "http://localhost:4210",
    out: path.resolve(process.cwd(), "../docs/motion"),
    only: null,
    frames: 90,
    // 960x540 rather than the capture harness's 1920x1080. A take is ninety
    // frames instead of one, and under SwiftShader the cost is per pixel: the
    // full set at 1080p measured about eight times longer for imagery that
    // answers the same questions, since a gait is read from where limbs are,
    // not from how many pixels they cover.
    width: 960,
    height: 540,
    port: 9224,
    seed: "IRONMARCH",
    hold: null,
    /** How long one scene may take to set itself up before the take is abandoned. */
    timeout: 300000,
  };
  // Both `--frames=90` and `--frames 90`, and an unknown flag is a hard error
  // rather than a shrug. `capture.mjs` carries the same parser and the same
  // note: a silently dropped `--width` once produced a whole set of 1920x1080
  // images filed under a directory named for 720. A harness that quietly
  // ignores its instructions is worse than one that refuses them.
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
    else if (key === "only") args.only = splitList(value);
    else if (key === "frames") args.frames = requireNumber(key, value);
    else if (key === "width") args.width = requireNumber(key, value);
    else if (key === "height") args.height = requireNumber(key, value);
    else if (key === "port") args.port = requireNumber(key, value);
    else if (key === "seed") args.seed = value;
    else if (key === "hold") args.hold = splitList(value);
    else if (key === "timeout") args.timeout = requireNumber(key, value);
    else throw new Error(`unknown flag --${key}`);
  }
  return args;
}

function splitList(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function requireNumber(key, value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`flag --${key} needs a positive number, got "${value}"`);
  }
  return parsed;
}

function sceneUrl(args, id) {
  return `${args.url}?capture=${encodeURIComponent(id)}&seed=${encodeURIComponent(args.seed)}`;
}

function findBrowser() {
  for (const candidate of EDGE_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let takes = TAKES;
  if (args.only) {
    // An empty `--only` would otherwise record nothing and exit reporting
    // success, which is the same lie as recording the wrong thing.
    if (args.only.length === 0) throw new Error("flag --only listed no scenes");
    const unknown = args.only.filter((id) => !CAPTURE_IDS.includes(id));
    if (unknown.length > 0) {
      throw new Error(`unknown capture id(s): ${unknown.join(", ")}. Known: ${CAPTURE_IDS.join(", ")}`);
    }
    takes = args.only.map((id) => TAKES.find((take) => take.id === id) ?? { id, hold: [] });
  }
  if (args.hold) {
    const unknown = args.hold.filter((code) => !(code in KEYS));
    if (unknown.length > 0) {
      throw new Error(`unknown key code(s): ${unknown.join(", ")}. Known: ${Object.keys(KEYS).join(", ")}`);
    }
    takes = takes.map((take) => ({ ...take, hold: args.hold }));
  }

  const browser = findBrowser();
  if (!browser) {
    console.error("No Edge or Chrome executable found. Looked in:");
    for (const candidate of EDGE_CANDIDATES) console.error(`  ${candidate}`);
    process.exit(1);
  }

  const profile = await mkdtemp(path.join(os.tmpdir(), "marcha-record-"));
  const flags = [
    "--headless=new",
    "--disable-gpu",
    // SwiftShader is what makes WebGL work at all without a display.
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    // A fresh profile is a first run, and a first run opens a sync promo on an
    // `edge://` page of its own. That page is also a protocol target, and it
    // sorted ahead of the game in `/json/list`, so the recorder attached to a
    // dialog and then waited fifteen minutes for it to become a capture scene.
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    // A headless page is a background tab as far as the throttlers are
    // concerned, and a throttled rAF would stall the hold loop each scene runs
    // before the recorder attaches.
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    `--window-size=${args.width},${args.height}`,
    `--remote-debugging-port=${args.port}`,
    `--user-data-dir=${profile}`,
    // Opened on the first scene rather than on a blank page, so the target the
    // recorder attaches to can be identified by its URL. `perf.mjs` picks its
    // page the same way and for the same reason.
    sceneUrl(args, takes[0].id),
  ];

  console.log(`browser: ${browser}`);
  console.log(`server:  ${args.url}`);
  console.log(`output:  ${args.out}`);
  console.log(`size:    ${args.width}x${args.height}`);
  console.log(`take:    ${args.frames} frames at 1/60 s = ${(args.frames / 60).toFixed(2)} s each`);
  console.log(`scenes:  ${takes.map((take) => take.id).join(", ")}\n`);

  const child = spawn(browser, flags, { windowsHide: true, stdio: "ignore" });
  const startedAt = Date.now();
  const summaries = [];
  let session = null;
  try {
    const target = await waitForTarget(args.port, 60000, "capture=");
    session = await connect(target.webSocketDebuggerUrl);
    await session.send("Page.enable", {});
    await session.send("Runtime.enable", {});
    // `--window-size` is not the viewport. Measured on Edge headless: a window
    // asked for at 640x360 gave the page 616x221, because the flag sizes the
    // window and the page gets what is left. The override sets the page's own
    // metrics, which is the number the renderer and the screenshot both use.
    await session.send("Emulation.setDeviceMetricsOverride", {
      width: args.width,
      height: args.height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    for (const take of takes) {
      summaries.push(await record(session, args, take));
    }
  } finally {
    session?.close();
    child.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }

  const elapsed = (Date.now() - startedAt) / 1000;
  console.log("\nscene       frames  size       still runs  distinct  seconds");
  for (const summary of summaries) {
    console.log(
      `${summary.id.padEnd(11)} ${String(summary.frames).padStart(6)}  ${`${summary.width}x${summary.height}`.padEnd(
        9,
      )}  ${String(summary.longestStillRun).padStart(10)}  ${String(summary.distinct).padStart(8)}  ${summary.seconds
        .toFixed(1)
        .padStart(7)}`,
    );
  }
  console.log(`\n${summaries.length} scene(s) recorded in ${elapsed.toFixed(1)} s.`);
  console.log(
    "'distinct' counts frames whose PNG bytes differ from every other frame in the take;",
  );
  console.log(
    "'still runs' is the longest stretch of consecutive identical frames. A take that is one",
  );
  console.log("long still run means the simulation did not advance and the sequence is worthless.");
}

/**
 * Records one scene.
 *
 * The order inside the loop is the contract that makes the output measurable:
 * the state is sampled and the frame is shot before the step that produces the
 * next one, so `frame-000N.png` and sample N are the same instant, and that
 * instant is N/60 seconds after the take began.
 */
async function record(session, args, take) {
  const directory = path.resolve(args.out, take.id);
  // Wiped rather than overwritten. A shorter take left behind the tail of a
  // longer one would read as a sequence that stops making sense at frame 60.
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });

  const url = sceneUrl(args, take.id);
  process.stdout.write(`  ${take.id} ... `);
  const startedAt = Date.now();

  // Via about:blank, so the readiness poll below cannot be answered by the
  // previous scene's page, and so its WebGL context is released first.
  await session.send("Page.navigate", { url: "about:blank" });
  await session.send("Page.navigate", { url });
  await waitForScene(session, take.id, args.timeout);

  // The page decides its own resolution from the window it was given, so this
  // is the only place the requested size can be confirmed against the delivered
  // one. A take filed at a size it is not is the failure this project has
  // already shipped once.
  const viewport = await evaluate(
    session,
    "JSON.stringify([window.innerWidth, window.innerHeight, window.devicePixelRatio])",
  );
  const [innerWidth, innerHeight, dpr] = JSON.parse(viewport);
  if (innerWidth !== args.width || innerHeight !== args.height) {
    throw new Error(
      `asked for a ${args.width}x${args.height} viewport and got ${innerWidth}x${innerHeight}`,
    );
  }

  for (const code of take.hold) await dispatchKey(session, code, "keyDown");

  const samples = [];
  const hashes = [];
  let width = 0;
  let height = 0;
  let bytes = 0;

  for (let index = 0; index < args.frames; index++) {
    // Frame 0 is the scene as the capture left it; every later frame is one
    // fixed step on from the one before.
    //
    // The guard on `__ironMarch` catches a page that reloaded underneath the
    // take. A dev server with hot reload does exactly that whenever a source
    // file is saved, and the old debug API goes with it: the recorder would
    // otherwise stop on a bare "cannot read properties of undefined" that says
    // nothing about what actually happened.
    const expression =
      index === 0
        ? SAMPLE_EXPRESSION
        : `(window.__ironMarch === undefined ? "" : (window.__ironMarch.advance(${STEP}), ${SAMPLE_EXPRESSION}))`;
    const sampled = await evaluate(session, expression);
    if (sampled === "") {
      throw new Error(
        `the page reloaded during "${take.id}" at frame ${index}, so the take is not one ` +
          `continuous sequence and has been abandoned. Record against a built bundle ` +
          `(vite build, then vite preview) when the source tree is being edited.`,
      );
    }
    samples.push(JSON.parse(sampled));

    const shot = await session.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    const buffer = Buffer.from(shot.data, "base64");
    const size = pngSize(buffer);
    if (!size) throw new Error(`frame ${index} of "${take.id}" is not a PNG`);
    if (size.width !== args.width || size.height !== args.height) {
      throw new Error(
        `frame ${index} of "${take.id}" came back ${size.width}x${size.height}, not ${args.width}x${args.height}`,
      );
    }
    width = size.width;
    height = size.height;
    bytes += buffer.length;
    hashes.push(createHash("sha1").update(buffer).digest("hex"));

    await writeFile(path.join(directory, `frame-${String(index).padStart(4, "0")}.png`), buffer);
  }

  for (const code of take.hold) await dispatchKey(session, code, "keyUp");

  const distinct = new Set(hashes).size;
  let longestStillRun = 1;
  let run = 1;
  for (let i = 1; i < hashes.length; i++) {
    run = hashes[i] === hashes[i - 1] ? run + 1 : 1;
    if (run > longestStillRun) longestStillRun = run;
  }
  // A take whose frames are all byte-identical is the silent failure this
  // harness exists to make loud: the page loaded, the shots were written, the
  // file sizes look right, and nothing moved.
  if (distinct === 1) {
    throw new Error(
      `every frame of "${take.id}" is identical, so the simulation did not advance. ` +
        `Check that window.__ironMarch.advance is reachable on the capture page.`,
    );
  }

  const seconds = (Date.now() - startedAt) / 1000;
  const manifest = {
    scene: take.id,
    seed: args.seed,
    frames: args.frames,
    stepSeconds: STEP,
    width,
    height,
    devicePixelRatio: dpr,
    heldKeys: take.hold,
    recordedAt: new Date().toISOString(),
    secondsToRecord: seconds,
    distinctFrames: distinct,
    longestStillRun,
    /**
     * The positions here are the ones actually drawn. `advance` renders at
     * interpolation alpha 0, which draws the previous step's transform, so a
     * sample taken from the live fields would sit one step ahead of the image
     * beside it and every velocity derived from the pair would be wrong by a
     * frame.
     */
    samples,
  };
  await writeFile(path.join(directory, "take.json"), JSON.stringify(manifest, null, 2), "utf8");

  console.log(
    `${args.frames} frames, ${(bytes / 1024 / 1024).toFixed(1)} MB, ${distinct} distinct, ${seconds.toFixed(1)} s`,
  );
  return { id: take.id, frames: args.frames, width, height, distinct, longestStillRun, seconds };
}

/**
 * One line of simulation state per frame, so the imagery has a ground truth to
 * be measured against rather than only looked at.
 *
 * `prev*` and not the live fields: see the note on `samples` above.
 */
const SAMPLE_EXPRESSION = `JSON.stringify((() => {
  const w = window.__ironMarch.world;
  return {
    tick: w.tick,
    playerX: w.player.prevX,
    playerZ: w.player.prevZ,
    playerHeading: w.player.prevHeading,
    playerSpeed: Math.hypot(w.player.velocityX, w.player.velocityZ),
    spiderX: w.spider.prevX,
    spiderZ: w.spider.prevZ,
    spiderSpeed: w.spider.speed,
    spiderMode: w.spider.speedMode,
    spiderDocked: w.spider.docked,
    enemies: w.enemies.active,
    trail: w.trail,
    trailState: w.trailState,
  };
})())`;

async function dispatchKey(session, code, type) {
  const key = KEYS[code];
  await session.send("Input.dispatchKeyEvent", {
    type,
    code: key.code,
    key: key.key,
    windowsVirtualKeyCode: key.virtual,
    nativeVirtualKeyCode: key.virtual,
  });
}

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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
