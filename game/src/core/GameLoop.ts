import { SIM } from "../data/balance.ts";

/**
 * Fixed-step loop with render interpolation.
 *
 * The simulation runs at exactly 60 Hz regardless of display refresh; the
 * renderer is handed an alpha in [0,1) and interpolates between the previous
 * and current simulation state. This is what makes the game behave identically
 * on a 60 Hz laptop panel and a 144 Hz monitor, and it is what lets the tests
 * step the simulation without a browser.
 *
 * The accumulator is clamped twice: once on frame time (a long stall must not
 * become a hundred catch-up steps) and once on step count per frame. Without
 * both, alt-tabbing back into the tab produces the classic spiral of death.
 */
export class GameLoop {
  private running = false;
  private rafHandle = 0;
  private previousNow = 0;
  private accumulator = 0;

  /** Rolling frame-time statistics for the debug overlay. */
  private readonly frameSamples = new Float32Array(120);
  private sampleIndex = 0;
  private sampleCount = 0;

  /** Steps executed on the most recent frame. */
  stepsLastFrame = 0;
  /** True when the loop had to discard time to avoid a spiral. */
  droppedTime = false;

  constructor(
    private readonly onPoll: (dt: number) => void,
    private readonly onFixedUpdate: (dt: number) => void,
    private readonly onRender: (alpha: number, dt: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.previousNow = performance.now();
    this.accumulator = 0;
    this.rafHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = 0;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Discards accumulated time. Call after a long modal pause or a tab return,
   * so the simulation does not try to catch up on wall-clock time that the
   * player did not experience.
   */
  resetAccumulator(): void {
    this.previousNow = performance.now();
    this.accumulator = 0;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this.frame);

    const rawFrameTime = (now - this.previousNow) / 1000;
    this.previousNow = now;

    this.droppedTime = rawFrameTime > SIM.maxFrameTime;
    const frameTime = Math.min(rawFrameTime, SIM.maxFrameTime);

    this.frameSamples[this.sampleIndex] = rawFrameTime * 1000;
    this.sampleIndex = (this.sampleIndex + 1) % this.frameSamples.length;
    if (this.sampleCount < this.frameSamples.length) this.sampleCount++;

    // Input is polled once per rendered frame, not once per fixed step, so a
    // frame that runs three steps does not read the same pad state three times
    // and triple-count an edge.
    this.onPoll(frameTime);

    this.accumulator += frameTime;

    let steps = 0;
    while (this.accumulator >= SIM.fixedStep && steps < SIM.maxStepsPerFrame) {
      this.onFixedUpdate(SIM.fixedStep);
      this.accumulator -= SIM.fixedStep;
      steps++;
    }
    if (steps >= SIM.maxStepsPerFrame) {
      // Give up on the remainder rather than compounding the backlog.
      this.accumulator = 0;
      this.droppedTime = true;
    }
    this.stepsLastFrame = steps;

    this.onRender(this.accumulator / SIM.fixedStep, frameTime);
  };

  /** Median frame time in ms. Medians survive a single hitch; means do not. */
  medianFrameMs(): number {
    if (this.sampleCount === 0) return 0;
    const values = Array.from(this.frameSamples.subarray(0, this.sampleCount));
    values.sort((a, b) => a - b);
    return values[values.length >> 1];
  }

  /** 95th-percentile frame time in ms: the number that reflects felt smoothness. */
  percentileFrameMs(percentile: number): number {
    if (this.sampleCount === 0) return 0;
    const values = Array.from(this.frameSamples.subarray(0, this.sampleCount));
    values.sort((a, b) => a - b);
    const index = Math.min(values.length - 1, Math.floor(values.length * percentile));
    return values[index];
  }

  worstFrameMs(): number {
    let worst = 0;
    for (let i = 0; i < this.sampleCount; i++) {
      if (this.frameSamples[i] > worst) worst = this.frameSamples[i];
    }
    return worst;
  }

  resetStats(): void {
    this.sampleCount = 0;
    this.sampleIndex = 0;
  }
}
