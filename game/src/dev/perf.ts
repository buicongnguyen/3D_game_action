import type { Game } from "../core/Game.ts";
import { PERFORMANCE, SIM } from "../data/balance.ts";

/**
 * The four performance scenarios §12 of the implementation plan requires.
 *
 * Each one is measured by stepping the real fixed update and the real render at
 * a known enemy count, so the numbers describe the shipping code path rather
 * than a synthetic benchmark.
 */

/**
 * What one pool did during one scenario.
 *
 * `docs/PERFORMANCE.md` used to carry a pooling table with "Exhaustions 0" on
 * every row and a "-" under peak occupancy for three of the four pools. The
 * dashes were honest about being unmeasured; the zeros were not, because the
 * VFX pool has no exhaustion counter at all - when it is full, `spawn` drops
 * the newest effect and returns. Its zero was true by construction and could
 * never have been anything else, which makes it evidence of nothing.
 *
 * So both figures are reported here, and which is which is recorded with them.
 */
export interface PoolUsage {
  id: string;
  capacity: number;
  /** Occupancy at the moment the render counts were read. */
  active: number;
  /** Highest occupancy reached during the scenario. */
  peak: number;
  /**
   * True when `peak` is a once-per-frame sample rather than the pool's own
   * high-water mark. A sample cannot see a peak that rose and fell inside a
   * single step, so it is a lower bound where a counted peak is exact.
   */
  peakSampled: boolean;
  /** Times `acquire` found nothing free, or null for a pool that cannot count it. */
  exhaustions: number | null;
  /**
   * Measured frames on which the pool was sampled at capacity. For a pool that
   * drops silently this is the only signal that anything was lost, and it is
   * the number to read instead of `exhaustions`.
   */
  saturatedFrames: number;
}

export interface ScenarioResult {
  id: string;
  label: string;
  enemies: number;
  enemiesPeak: number;
  projectiles: number;
  pickups: number;
  structures: number;
  poolExhaustions: number;
  /** Per-pool occupancy, reset at the start of each scenario. */
  pools: PoolUsage[];
  drawCalls: number;
  triangles: number;
  meshes: number;
  shadowCasters: number;
  /** Milliseconds for one fixed update plus one render, in this browser. */
  frameMsP50: number;
  frameMsP95: number;
  frameMsWorst: number;
  /** Milliseconds for one fixed update alone: hardware-independent enough to compare. */
  simMsP50: number;
  simMsP95: number;
  /**
   * Batch-derived means, in milliseconds.
   *
   * The percentiles above are measured one sample at a time, and a browser
   * clamps `performance.now()` to protect against timing attacks - here to a
   * granularity coarser than a single step, which made every percentile read
   * exactly 0.000 and said nothing at all. Timing the whole run of samples with
   * one before/after pair and dividing by the count is immune to that: the
   * clamp applies once to a total that is hundreds of times larger.
   *
   * So these are the numbers to read. The percentiles are kept because they
   * would show spikes on a machine whose clock is finer, and reporting them as
   * zeros is more honest than deleting the evidence that they were unusable.
   */
  simMsMean: number;
  frameMsMean: number;
  renderMsMean: number;
  trail: number;
  trailState: string;
}

export interface PerformanceReport {
  seed: number;
  viewport: [number, number];
  devicePixelRatio: number;
  userAgent: string;
  /** True when the WebGL backend is a software rasteriser. */
  softwareRenderer: boolean;
  renderer: string;
  /**
   * Smallest non-zero step this browser's clock will report, in milliseconds.
   * Anything faster than this cannot be measured one sample at a time, which is
   * why the report carries batch means as well as percentiles.
   */
  clockResolutionMs: number;
  /** Frames measured per scenario, and so the denominator for `saturatedFrames`. */
  samples: number;
  results: ScenarioResult[];
}

interface Scenario {
  id: string;
  label: string;
  setup: (game: Game) => void;
}

const SCENARIOS: Scenario[] = [
  {
    id: "quiet-march",
    label: "Quiet march baseline",
    setup: (game) => {
      game.debugApi.teleportSpider(40);
      game.debugApi.setTrail(6);
    },
  },
  {
    id: "combat-100",
    label: "Normal combat, 100 enemies",
    setup: (game) => {
      game.debugApi.teleportSpider(90);
      game.debugApi.setTrail(78);
      game.debugApi.placeStructures("rivetTurret", 3);
      game.debugApi.forceSpawn("minion", 72);
      game.debugApi.forceSpawn("warrior", 24);
      game.debugApi.forceSpawn("golem", 4);
    },
  },
  {
    id: "stress-200",
    label: "Stress test, 200 enemies",
    setup: (game) => {
      game.debugApi.teleportSpider(110);
      game.debugApi.setTrail(100);
      game.debugApi.forceSpawn("minion", 150);
      game.debugApi.forceSpawn("warrior", 42);
      game.debugApi.forceSpawn("golem", 8);
    },
  },
  {
    id: "pursuit-full",
    label: "Pursuit with structures, projectiles, VFX and HUD",
    setup: (game) => {
      game.debugApi.teleportSpider(130);
      game.debugApi.setTrail(100);
      // A late-run defended posture: two racks plus four built in the field.
      game.debugApi.placeStructures("rivetTurret", 4, 7);
      game.debugApi.placeStructures("relay", 2, 11);
      game.debugApi.forceSpawn("minion", 110);
      game.debugApi.forceSpawn("warrior", 36);
      game.debugApi.forceSpawn("golem", 8);
    },
  },
];

const SAMPLES = 90;
/** Fixed updates per timed chunk in the simulation-only batch. */
const SIM_CHUNK = 10;

/**
 * A pool's own counters, for the pools that keep any.
 *
 * Structural rather than `ObjectPool<T>`, so the effect pool - which is a set
 * of flat parallel arrays in the renderer and not an `ObjectPool` at all - can
 * sit in the same list without being made to pretend it is one.
 */
interface PoolCounters {
  readonly capacity: number;
  readonly active: number;
  readonly peak: number;
  readonly exhaustions: number;
  resetStats(): void;
}

interface PoolProbe {
  id: string;
  capacity: number;
  read: () => number;
  counters: PoolCounters | null;
  peak: number;
  saturatedFrames: number;
}

/**
 * Every pool the report covers, wired so each can be read once per frame.
 *
 * The reach through `Game`'s private field for the effect pool is deliberate
 * and confined to this dev-only module. The alternative is a renderer counter
 * plumbed out through the debug API for the sake of one document, and the
 * effect pool sits on the presentation side precisely because the simulation
 * has no business knowing that it exists.
 */
function poolProbes(game: Game): PoolProbe[] {
  const world = game.world;
  const vfx = (game as unknown as { vfx: { activeEffects: number } }).vfx;
  return [
    countedProbe("enemies", world.enemies),
    countedProbe("projectiles", world.projectiles),
    countedProbe("pickups", world.pickups),
    {
      id: "vfx",
      capacity: PERFORMANCE.vfxPoolCapacity,
      read: () => vfx.activeEffects,
      counters: null,
      peak: 0,
      saturatedFrames: 0,
    },
  ];
}

function countedProbe(id: string, pool: PoolCounters): PoolProbe {
  return {
    id,
    capacity: pool.capacity,
    read: () => pool.active,
    counters: pool,
    peak: 0,
    saturatedFrames: 0,
  };
}

export function runPerformanceSuite(game: Game): PerformanceReport {
  const results: ScenarioResult[] = [];

  for (const scenario of SCENARIOS) {
    const world = game.world;
    scenario.setup(game);
    // Pool statistics accumulate from construction and all four scenarios share
    // one world, so without this reset every peak after the first would really
    // be the peak of everything that had run before it.
    const probes = poolProbes(game);
    for (const probe of probes) probe.counters?.resetStats();
    // Let the horde form up and the pools fill before measuring; a spawn ring
    // is not the load the scenario is meant to describe.
    game.advance(2.5);
    game.debugApi.resetFrameStats();

    const frameSamples: number[] = [];
    const simSamples: number[] = [];
    const frameBatchStart = performance.now();
    for (let i = 0; i < SAMPLES; i++) {
      // Between samples, never inside one: the refill must not be charged to
      // the simulation it exists to keep running.
      game.debugApi.sustainCore();
      const beforeSim = performance.now();
      game.advanceSimulationOnly(SIM.fixedStep);
      const afterSim = performance.now();
      // Sampled between the step and the draw. Everything the step raised has
      // landed by then and nothing has been recycled yet, so this is the high
      // point of the cycle for all of it. It stays a lower bound rather than an
      // exact peak because the draw emits a few effects of its own - the
      // overload vents come out of `WorldView.sync` - and those are only seen by
      // the following frame's sample. Four property reads, three orders of
      // magnitude under this browser's 0.1 ms clock resolution, so they cannot
      // move the frame figure they sit inside.
      for (let p = 0; p < probes.length; p++) {
        const probe = probes[p];
        const occupancy = probe.read();
        if (occupancy > probe.peak) probe.peak = occupancy;
        if (occupancy >= probe.capacity) probe.saturatedFrames++;
      }
      game.renderFrozen();
      const afterFrame = performance.now();
      simSamples.push(afterSim - beforeSim);
      frameSamples.push(afterFrame - beforeSim);
    }
    const frameMsMean = (performance.now() - frameBatchStart) / SAMPLES;
    frameSamples.sort((a, b) => a - b);
    simSamples.sort((a, b) => a - b);

    // Counts are read here, before the sim-only batch runs the world on another
    // 1.5 seconds. They then describe the same moment as the draw-call figure,
    // which comes from the last render of the loop above.
    const frame = game.debugApi.frame();
    const audit = game.debugApi.sceneAudit();
    const pools: PoolUsage[] = probes.map((probe) => ({
      id: probe.id,
      capacity: probe.capacity,
      active: probe.read(),
      // Where a pool counts its own high-water mark on acquire, that is the
      // figure to publish: it sees a peak that rose and fell inside one step,
      // which a once-per-frame sample cannot.
      peak: probe.counters ? probe.counters.peak : probe.peak,
      peakSampled: probe.counters === null,
      exhaustions: probe.counters ? probe.counters.exhaustions : null,
      saturatedFrames: probe.saturatedFrames,
    }));
    const counts = {
      enemies: world.enemies.active,
      enemiesPeak: world.enemies.peak,
      projectiles: world.projectiles.active,
      pickups: world.pickups.active,
      structures: world.structures.length,
      exhaustions:
        world.enemies.exhaustions + world.projectiles.exhaustions + world.pickups.exhaustions,
      trail: world.trail,
      trailState: world.trailState,
    };

    // The same count of fixed updates again, with no render between them, so
    // subtracting gives the render's share. Timed in chunks rather than as one
    // interval: the run has to be kept alive between chunks, and a chunk of ten
    // steps is still hundreds of times longer than the clock's resolution, so
    // nothing is lost by not timing all ninety at once.
    //
    // Pools are deliberately not sampled across this batch. Effects are only
    // recycled by a draw, so ninety steps without one fill the effect pool to
    // capacity every time - an artefact of how the render share is measured,
    // which would read as the game saturating it.
    let simTotalMs = 0;
    for (let done = 0; done < SAMPLES; done += SIM_CHUNK) {
      game.debugApi.sustainCore();
      const steps = Math.min(SIM_CHUNK, SAMPLES - done);
      const chunkStart = performance.now();
      for (let i = 0; i < steps; i++) game.advanceSimulationOnly(SIM.fixedStep);
      simTotalMs += performance.now() - chunkStart;
    }
    const simMsMean = simTotalMs / SAMPLES;

    // The sim batch cannot call sustainCore between steps without charging the
    // refill to the interval it is timing, so it is checked at the end instead.
    // If the run ended anyway, the batch measured an early return and the
    // number is worthless - say so rather than publish it.
    const endPhase = game.debugApi.phase();
    if (endPhase === "VICTORY" || endPhase === "DEFEAT") {
      throw new Error(
        `scenario "${scenario.id}" ended in ${endPhase} while being measured, so its ` +
          `simulation cost is the cost of an early return, not of the scenario. ` +
          `Raise the survivability of the setup or shorten SAMPLES.`,
      );
    }

    results.push({
      id: scenario.id,
      label: scenario.label,
      enemies: counts.enemies,
      enemiesPeak: counts.enemiesPeak,
      projectiles: counts.projectiles,
      pickups: counts.pickups,
      structures: counts.structures,
      poolExhaustions: counts.exhaustions,
      pools,
      drawCalls: frame.calls,
      triangles: frame.triangles,
      meshes: audit.meshes,
      shadowCasters: audit.casters,
      frameMsP50: percentile(frameSamples, 0.5),
      frameMsP95: percentile(frameSamples, 0.95),
      frameMsWorst: frameSamples[frameSamples.length - 1],
      simMsP50: percentile(simSamples, 0.5),
      simMsP95: percentile(simSamples, 0.95),
      simMsMean,
      frameMsMean,
      renderMsMean: Math.max(0, frameMsMean - simMsMean),
      trail: counts.trail,
      trailState: counts.trailState,
    });
  }

  const gl = describeRenderer();
  return {
    seed: game.world.stats.seed,
    viewport: [window.innerWidth, window.innerHeight],
    devicePixelRatio: window.devicePixelRatio,
    userAgent: navigator.userAgent,
    softwareRenderer: /swiftshader|llvmpipe|software/i.test(gl),
    renderer: gl,
    clockResolutionMs: measureClockResolution(),
    samples: SAMPLES,
    results,
  };
}

/**
 * Smallest non-zero interval `performance.now()` will report. Browsers coarsen
 * this deliberately, and knowing the figure is what separates "the step was too
 * fast to time" from "the step took no time", which are very different claims
 * to put in a performance document.
 */
function measureClockResolution(): number {
  let smallest = Infinity;
  for (let attempt = 0; attempt < 5; attempt++) {
    const start = performance.now();
    let now = start;
    // Bounded so a frozen clock cannot hang the report.
    for (let spin = 0; spin < 5_000_000 && now === start; spin++) now = performance.now();
    const delta = now - start;
    if (delta > 0 && delta < smallest) smallest = delta;
  }
  return Number.isFinite(smallest) ? smallest : 0;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

/** Reads the unmasked GL renderer string, which names the actual backend. */
function describeRenderer(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return "unavailable";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    if (!info) return gl.getParameter(gl.RENDERER) as string;
    return gl.getParameter(info.UNMASKED_RENDERER_WEBGL) as string;
  } catch {
    return "unavailable";
  }
}
