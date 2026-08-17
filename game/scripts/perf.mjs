#!/usr/bin/env node
/**
 * Performance harness.
 *
 * Runs the four scenarios §12 of the implementation plan requires and prints a
 * table of frame timings, draw calls and pool usage. It drives the real game
 * through its debug API in a real browser, so the numbers come from the same
 * code path a player runs.
 *
 * Usage:
 *   node scripts/perf.mjs [--url http://localhost:4212] [--out ../docs/perf.json]
 *
 * The headless run uses SwiftShader, whose absolute frame times are far slower
 * than any real GPU. Draw calls, triangle counts, pool usage and the simulation
 * cost are hardware-independent and are the numbers to read; the frame times
 * are only meaningful from a windowed run on a real GPU. Both are reported, and
 * the report says which is which.
 *
 * Why this drives the browser over the DevTools protocol rather than scraping
 * `--dump-dom`: the dump-dom form needs `--virtual-time-budget` to hold the page
 * open until the suite finishes, and virtual time replaces the clock. Under it
 * `performance.now()` does not advance across synchronous work at all, so every
 * timing this harness produced was exactly 0.000 - not a fast frame, a stopped
 * watch - while still being printed and filed as a measurement. §12 asks for
 * median and worst-frame behaviour, so the timing cannot simply be dropped; it
 * needs a real clock, which means no virtual time, which means waiting for the
 * result some other way. That is what the protocol connection buys.
 */

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const EDGE_CANDIDATES = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
];

function findBrowser() {
  for (const candidate of EDGE_CANDIDATES) if (existsSync(candidate)) return candidate;
  return null;
}

async function main() {
  const args = {
    url: "http://localhost:4210",
    out: path.resolve(process.cwd(), "../docs/perf.json"),
    port: 9223,
    timeout: 900000,
  };
  // Both `--out=x` and `--out x`, and an unknown flag is an error rather than a
  // shrug. Silently ignoring an argument is how a harness ends up reporting
  // something other than what it was asked to measure.
  const rest = process.argv.slice(2);
  while (rest.length > 0) {
    const raw = rest.shift();
    if (!raw.startsWith("--")) throw new Error(`unexpected argument "${raw}"`);
    const eq = raw.indexOf("=");
    const key = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    let value = eq === -1 ? undefined : raw.slice(eq + 1);
    if (value === undefined) {
      if (rest.length === 0 || rest[0].startsWith("--")) throw new Error(`flag --${key} needs a value`);
      value = rest.shift();
    }
    if (key === "url") args.url = value;
    else if (key === "out") args.out = path.resolve(process.cwd(), value);
    else if (key === "port") args.port = Number(value);
    else if (key === "timeout") args.timeout = Number(value);
    else throw new Error(`unknown flag --${key}`);
  }

  const browser = findBrowser();
  if (!browser) {
    console.error("No Edge or Chrome executable found.");
    process.exit(1);
  }

  const probeUrl = `${args.url}?perf=1`;
  const port = args.port;
  const profile = await mkdtemp(path.join(os.tmpdir(), "marcha-perf-"));
  const flags = [
    "--headless=new",
    "--disable-gpu",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--window-size=1920,1080",
    // Nothing here may fake the clock; that is the whole point of this harness.
    // These three only stop a headless page being treated as a background tab.
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    probeUrl,
  ];

  console.log(`browser: ${browser}`);
  console.log(`server:  ${args.url}`);
  console.log("running four scenarios under SwiftShader; this takes a few minutes\n");

  const child = spawn(browser, flags, { windowsHide: true, stdio: "ignore" });
  let payload;
  try {
    const target = await waitForTarget(port, 30000);
    payload = await readReport(target.webSocketDebuggerUrl, args.timeout);
  } finally {
    child.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }

  const rows = payload.results;
  const pad = (value, width) => String(value).padStart(width);
  console.log(`renderer: ${payload.renderer}${payload.softwareRenderer ? "  (SOFTWARE)" : ""}`);
  console.log(
    "\nscenario              enemies  draw   triangles  meshes  casters  sim ms  render ms  frame ms  pools",
  );
  for (const row of rows) {
    console.log(
      `${row.id.padEnd(20)} ${pad(row.enemies, 7)} ${pad(row.drawCalls, 5)} ${pad(
        row.triangles.toLocaleString("en-US"),
        11,
      )} ${pad(row.meshes, 7)} ${pad(row.shadowCasters, 8)} ${pad(
        row.simMsMean.toFixed(3),
        7,
      )} ${pad(row.renderMsMean.toFixed(2), 10)} ${pad(row.frameMsMean.toFixed(2), 9)} ${pad(
        row.poolExhaustions,
        6,
      )}`,
    );
  }
  printPoolTable(rows, payload.samples ?? 0);

  // The columns above are batch means. Per-sample percentiles are in the JSON,
  // but this browser clamps its clock, so they are reported and not printed -
  // a table of zeros invites the reader to conclude the work was free.
  const clock = payload.clockResolutionMs ?? 0;
  const unusable = rows.every((row) => row.frameMsWorst === 0);
  if (unusable) {
    console.log(
      `\nNOTE: performance.now() resolves to ${clock.toFixed(3)} ms here, which is coarser than one`,
    );
    console.log(
      "      step, so every per-sample percentile in the JSON is 0 and means nothing. The",
    );
    console.log("      columns above divide one timed batch of 90 steps and are unaffected.");
  }
  if (payload.softwareRenderer) {
    console.log(
      "\nNOTE: frame times are from a software rasteriser and say nothing about GPU performance.",
    );
    console.log(
      "      Draw calls, triangles, meshes, pools and sim times are hardware-independent.",
    );
  }

  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(payload, null, 2), "utf8");
  console.log(`\nwritten to ${args.out}`);
}

/**
 * Peak occupancy per pool, and whether any of them ran out of room.
 *
 * The pooling table in `docs/PERFORMANCE.md` carried "Exhaustions 0" on every
 * row and a "-" under peak occupancy for three of the four pools. The dashes
 * were at least honest about being unmeasured. The zeros were worse than that:
 * the effect pool has no exhaustion counter, because a full pool drops the
 * newest effect and returns, so its zero was true by construction and could
 * never have read anything else. Peak against capacity is the figure that can
 * actually fail, which is why it is printed here rather than left in the JSON.
 */
function printPoolTable(rows, samples) {
  const ids = rows[0]?.pools?.map((pool) => pool.id);
  if (!ids || ids.length === 0) return;

  console.log("\npool peak occupancy against capacity, per scenario\n");
  console.log(`scenario             ${ids.map((id) => id.padEnd(14)).join("")}exhaustions`);
  const full = [];
  for (const row of rows) {
    const cells = ids.map((id) => {
      const pool = row.pools.find((entry) => entry.id === id);
      const atCapacity = pool.peak >= pool.capacity || pool.saturatedFrames > 0;
      if (atCapacity) full.push({ scenario: row.id, pool });
      // A sampled peak is a lower bound, so it is marked rather than passed off
      // as the counted kind.
      return `${pool.peak}/${pool.capacity}${pool.peakSampled ? "~" : ""}${atCapacity ? " FULL" : ""}`.padEnd(
        14,
      );
    });
    console.log(`${row.id.padEnd(20)} ${cells.join("")}${row.poolExhaustions}`);
  }
  console.log(
    "\n~ sampled once per frame rather than counted on acquire, so it is a lower bound.",
  );

  if (full.length === 0) {
    console.log("No pool reached its capacity in any scenario.");
    return;
  }
  // Peak *equal to* capacity counts, not only a peak sustained across frames.
  // An earlier version of this warning fired on the per-frame samples alone and
  // printed "no pool reached capacity" directly beneath a row reading 260/260,
  // because the peak had been reached during the scenario's settle and had
  // fallen back before the first measured frame. A summary that contradicts the
  // table above it is worse than no summary.
  console.log("\nWARNING: a pool reached its capacity.");
  for (const entry of full) {
    const held =
      entry.pool.saturatedFrames > 0
        ? `, and was still full on ${entry.pool.saturatedFrames} of ${samples} measured frames`
        : ", during the scenario but not on a measured frame";
    console.log(
      `  ${entry.scenario}: ${entry.pool.id} peaked at ${entry.pool.peak}/${entry.pool.capacity}${held}`,
    );
  }
  console.log(
    "      A pool at capacity has nothing left for the next acquire. Where the pool counts",
  );
  console.log(
    "      exhaustions, the zero above means the cap was respected rather than hit. Where it",
  );
  console.log(
    "      does not - the effect pool drops the newest and returns - nothing would be recorded",
  );
  console.log("      at all, and this line is the only evidence that would ever exist.");
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for the browser to open its protocol port and load the probe page. */
async function waitForTarget(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no page target";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find(
          (entry) => entry.type === "page" && entry.webSocketDebuggerUrl && entry.url.includes("perf=1"),
        );
        if (page) return page;
        lastError = `targets: ${targets.map((t) => `${t.type} ${t.url}`).join(", ") || "none"}`;
      }
    } catch (error) {
      lastError = error.message;
    }
    await delay(200);
  }
  throw new Error(`browser did not expose the probe page within ${timeoutMs} ms (${lastError})`);
}

/**
 * Polls the page for the finished report.
 *
 * The suite runs as one long synchronous block, so an evaluate issued while it
 * is working simply does not answer until it is done. That is the wait: no
 * individual request is given a deadline, only the run as a whole.
 */
async function readReport(wsUrl, timeoutMs) {
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

  const send = (method, params) =>
    new Promise((resolve, reject) => {
      if (closed) return reject(closed);
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const evaluated = await send("Runtime.evaluate", {
        expression: "document.getElementById('perf-report')?.textContent ?? null",
        returnByValue: true,
      });
      const value = evaluated?.result?.value;
      if (typeof value === "string" && value.length > 0) return JSON.parse(value);
      await delay(500);
    }
  } finally {
    socket.close();
  }
  throw new Error(
    `the page never produced #perf-report within ${Math.round(timeoutMs / 1000)} s. Is ?perf=1 handled by main.ts?`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
