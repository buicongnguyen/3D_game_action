import { Game } from "./core/Game.ts";
import { seedFromString } from "./core/Random.ts";
import { peekQueuedCheckpoint } from "./core/CheckpointState.ts";

/**
 * Entry point: boot screen, gamepad acquisition gesture, then the run.
 *
 * The "Press Cross" splash is not decoration. The Gamepad API will not report
 * a pad until a user gesture has occurred, and AudioContext will not start
 * without one either, so a single gesture gate is the only correct way in.
 */

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
const uiRoot = document.querySelector<HTMLElement>("#ui-root");

if (!canvas || !uiRoot) {
  throw new Error("Missing #game-canvas or #ui-root in index.html");
}

const params = new URLSearchParams(window.location.search);
const queuedCheckpoint = peekQueuedCheckpoint();
const seedParam = params.get("seed");
const seed = queuedCheckpoint?.seed ?? (seedParam ? seedFromString(seedParam) : undefined);
const mode = queuedCheckpoint?.mode ?? (params.get("mode") === "salvage" ? "salvageRush" : "expedition");

const boot = document.createElement("div");
boot.className = "boot-screen";
boot.innerHTML = `
  <div class="boot-panel">
    <h1 class="boot-title">MARCHA DE FERRO</h1>
    <p class="boot-subtitle">Iron March &mdash; vertical slice</p>
    <div class="boot-bar"><div class="boot-bar-fill"></div></div>
    <p class="boot-label">Starting</p>
    <p class="boot-error" hidden></p>
  </div>
`;
uiRoot.appendChild(boot);

const bootFill = boot.querySelector<HTMLElement>(".boot-bar-fill")!;
const bootLabel = boot.querySelector<HTMLElement>(".boot-label")!;
const bootError = boot.querySelector<HTMLElement>(".boot-error")!;

function setProgress(fraction: number, label: string): void {
  bootFill.style.width = `${Math.round(fraction * 100)}%`;
  bootLabel.textContent = label;
}

function showBootError(message: string): void {
  bootError.hidden = false;
  bootError.textContent = message;
  bootLabel.textContent = "Boot failed";
}

const isCapture = params.has("capture");
const game = new Game(canvas, uiRoot, seed, { preserveDrawingBuffer: isCapture, mode });
// Display what the player actually typed, not the 32-bit canonical form.
game.setSeedLabel(seedParam);

// Exposed for automated browser verification and for reproducing bug reports.
(window as unknown as { __ironMarch: unknown }).__ironMarch = game.debugApi;

async function main(): Promise<void> {
  try {
    await game.boot(setProgress);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showBootError(message);
    throw error;
  }

  // Visual-QA mode: set up a scripted scene and hold it, so an external
  // screenshot always frames the same moment. Never reached in normal play.
  const captureId = params.get("capture");
  if (captureId) {
    const { findCapture, runCapture } = await import("./dev/captures.ts");
    const scenario = findCapture(captureId);
    if (!scenario) {
      showBootError(`Unknown capture "${captureId}"`);
      return;
    }
    boot.remove();
    game.startForCapture();
    runCapture(game, scenario);
    // Redraw a bounded number of times, then stop.
    //
    // An unbounded rAF hold looks harmless but is not: the headless runner
    // advances virtual time as fast as the page allows, so the loop redraws
    // continuously and a scene costing thirty seconds a frame under software
    // rasterisation never finishes — one capture took twenty minutes. A few
    // frames clear the first-frame buffer uploads and `preserveDrawingBuffer`
    // keeps the result readable afterwards. The resize hook covers the other
    // half of the problem: a late layout pass reallocates the drawing buffer,
    // which clears it, and would otherwise be read back as an empty image.
    game.redrawOnResize(3);
    let holdFrames = 5;
    const hold = (): void => {
      game.renderFrozen();
      if (--holdFrames > 0) requestAnimationFrame(hold);
    };
    hold();
    (window as unknown as { __captureReady: boolean }).__captureReady = true;
    document.title = `Marcha de Ferro - ${scenario.label}`;
    return;
  }

  // Performance harness: run the four §12 scenarios and publish the numbers
  // into the DOM, where the headless runner can scrape them.
  if (params.has("perf")) {
    boot.remove();
    game.startForCapture();
    const { runPerformanceSuite } = await import("./dev/perf.ts");
    const report = runPerformanceSuite(game);
    const pre = document.createElement("pre");
    pre.id = "perf-report";
    pre.textContent = JSON.stringify(report);
    document.body.appendChild(pre);
    return;
  }

  bootLabel.textContent = "Press Cross, or any key, to begin";
  boot.classList.add("boot-ready");

  const begin = (): void => {
    window.removeEventListener("keydown", begin);
    window.removeEventListener("pointerdown", begin);
    window.removeEventListener("gamepadconnected", begin);
    cancelAnimationFrame(waitHandle);
    boot.remove();
    game.start();
  };

  // A gamepad button press is not a DOM event, so the splash also polls for one.
  let waitHandle = 0;
  const waitForGamepad = (): void => {
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad) continue;
      for (const button of pad.buttons) {
        if (button.pressed) {
          begin();
          return;
        }
      }
    }
    waitHandle = requestAnimationFrame(waitForGamepad);
  };
  waitHandle = requestAnimationFrame(waitForGamepad);

  window.addEventListener("keydown", begin);
  window.addEventListener("pointerdown", begin);
  window.addEventListener("gamepadconnected", begin);
}

window.addEventListener("keydown", (event) => {
  if (event.key === "F3" || (event.key === "`" && !event.repeat)) {
    event.preventDefault();
    game.toggleDebug();
  }
});

// A hidden tab must not accumulate simulation time or burn GPU. Coming back
// resumes the loop and nothing else - `start()` would begin the run over.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) game.stop();
  else if (!document.querySelector(".boot-screen")) game.resume();
});

void main();
