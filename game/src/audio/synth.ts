/**
 * Pure Web Audio synthesis primitives. No game state, no cue vocabulary here —
 * `AudioDirector` composes these into named cues. Every function schedules
 * its own nodes and tears them down via `onended`, so callers never need to
 * hold a reference or clean up manually.
 */

/** One shared noise buffer per AudioContext; regenerating per-call would allocate on every cue. */
const noiseBufferCache = new WeakMap<AudioContext, AudioBuffer>();
const SHARED_NOISE_SECONDS = 2;

export function createNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function getSharedNoiseBuffer(ctx: AudioContext): AudioBuffer {
  let buffer = noiseBufferCache.get(ctx);
  if (!buffer) {
    buffer = createNoiseBuffer(ctx, SHARED_NOISE_SECONDS);
    noiseBufferCache.set(ctx, buffer);
  }
  return buffer;
}

export type NoiseFilterType = "lowpass" | "highpass" | "bandpass" | "notch";

export interface NoiseBurstOptions {
  duration: number;
  attack: number;
  decay: number;
  filterHz: number;
  filterQ?: number;
  gain: number;
  type: NoiseFilterType;
}

/** A filtered slice of the shared noise buffer with an attack/decay envelope. */
export function playNoiseBurst(ctx: AudioContext, dest: AudioNode, opts: NoiseBurstOptions): void {
  if (opts.gain <= 0) return;
  const buffer = getSharedNoiseBuffer(ctx);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.loopStart = 0;
  source.loopEnd = buffer.duration;

  const filter = ctx.createBiquadFilter();
  filter.type = opts.type;
  filter.frequency.value = opts.filterHz;
  filter.Q.value = opts.filterQ ?? 1;

  const env = ctx.createGain();
  const now = ctx.currentTime;
  const attack = Math.max(0.001, opts.attack);
  const decay = Math.max(0.001, opts.decay);
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(opts.gain, now + attack);
  env.gain.setTargetAtTime(0, now + attack, decay / 3);

  source.connect(filter);
  filter.connect(env);
  env.connect(dest);

  const maxOffset = Math.max(0, buffer.duration - opts.duration - 0.02);
  const offset = maxOffset > 0 ? Math.random() * maxOffset : 0;
  const stopAt = now + attack + opts.duration + decay + 0.05;
  source.start(now, offset);
  source.stop(stopAt);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    env.disconnect();
  };
}

export interface ToneOptions {
  freq: number;
  endFreq?: number;
  duration: number;
  attack: number;
  decay: number;
  gain: number;
  type: OscillatorType;
}

/** A single oscillator with an optional pitch glide and an attack/decay envelope. */
export function playTone(ctx: AudioContext, dest: AudioNode, opts: ToneOptions): void {
  if (opts.gain <= 0) return;
  const osc = ctx.createOscillator();
  osc.type = opts.type;
  const now = ctx.currentTime;
  const startFreq = Math.max(1, opts.freq);
  osc.frequency.setValueAtTime(startFreq, now);
  if (opts.endFreq !== undefined && opts.endFreq !== opts.freq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.endFreq), now + opts.duration);
  }

  const env = ctx.createGain();
  const attack = Math.max(0.001, opts.attack);
  const decay = Math.max(0.001, opts.decay);
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(opts.gain, now + attack);
  env.gain.setTargetAtTime(0, now + attack, decay / 3);

  osc.connect(env);
  env.connect(dest);

  const stopAt = now + attack + opts.duration + decay + 0.05;
  osc.start(now);
  osc.stop(stopAt);
  osc.onended = () => {
    osc.disconnect();
    env.disconnect();
  };
}

export interface ThumpOptions {
  freq: number;
  endFreq?: number;
  duration: number;
  gain: number;
  decay?: number;
}

/** A punchy low-frequency impact: a sine that drops pitch fast under a snappy decay. */
export function playThump(ctx: AudioContext, dest: AudioNode, opts: ThumpOptions): void {
  if (opts.gain <= 0) return;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  const now = ctx.currentTime;
  const startFreq = Math.max(1, opts.freq);
  const endFreq = Math.max(1, opts.endFreq ?? opts.freq * 0.4);
  osc.frequency.setValueAtTime(startFreq, now);
  osc.frequency.exponentialRampToValueAtTime(endFreq, now + opts.duration);

  const decay = Math.max(0.001, opts.decay ?? opts.duration);
  const env = ctx.createGain();
  env.gain.setValueAtTime(opts.gain, now);
  env.gain.setTargetAtTime(0, now, decay / 3);

  osc.connect(env);
  env.connect(dest);

  const stopAt = now + opts.duration + decay + 0.05;
  osc.start(now);
  osc.stop(stopAt);
  osc.onended = () => {
    osc.disconnect();
    env.disconnect();
  };
}
