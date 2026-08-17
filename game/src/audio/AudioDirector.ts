/**
 * Synthesises every sound in the game from the Web Audio API — there are no
 * audio assets. Two jobs: (1) play rate-limited, voice-capped one-shot cues
 * with distance falloff relative to a listener point, and (2) run a layered
 * adaptive music bed driven by the Trail state.
 *
 * No audio node is ever created outside a rate-limited `play()` call or the
 * fixed set of persistent drone/pulse nodes built once in the constructor,
 * so voice count stays bounded even under the 130-enemy / 3-turret stress
 * case the director must survive.
 */

import { clamp, clamp01, damp } from "../core/math.ts";
import { playNoiseBurst, playThump, playTone } from "./synth.ts";
import type { NoiseFilterType } from "./synth.ts";

export type AudioCue =
  | "shot.player"
  | "shot.turret"
  | "hit.flesh"
  | "hit.bone"
  | "hit.metal"
  | "enemy.death"
  | "enemy.spawn"
  | "explosion"
  | "lastShot.charge"
  | "build.place"
  | "build.invalid"
  | "build.fold"
  | "build.radialOpen"
  | "repair"
  | "refuel"
  | "pickup.scrap"
  | "pickup.fuel"
  | "player.hurt"
  | "player.dodge"
  | "player.down"
  | "spider.step"
  | "spider.overdrive"
  | "spider.damage"
  | "spider.lowFuel"
  | "ui.move"
  | "ui.confirm"
  | "ui.back"
  | "trail.escalate"
  | "levelUp"
  | "checkpoint"
  | "victory"
  | "defeat";

interface CueConfig {
  /** Minimum seconds between accepted attempts, regardless of voice availability. */
  minInterval: number;
  /** Max concurrent voices for this cue specifically. */
  maxVoices: number;
  /** Beyond this world-space distance from the listener the cue is dropped outright. */
  maxDistance: number;
  /** Rough seconds the synthesised voice takes to finish, for voice-slot bookkeeping. */
  estimateDuration: number;
  build: (ctx: AudioContext, dest: AudioNode, gain: number) => void;
}

function noiseHit(filterHz: number, filterQ: number, type: NoiseFilterType, duration: number, decay: number) {
  return (ctx: AudioContext, dest: AudioNode, gain: number): void =>
    playNoiseBurst(ctx, dest, { duration, attack: 0.001, decay, filterHz, filterQ, gain, type });
}

/** Small real-time scheduler for the handful of cues built from more than one delayed note. */
function scheduleDelayed(ctx: AudioContext, ms: number, fn: () => void): void {
  setTimeout(() => {
    if (ctx.state === "closed") return;
    try {
      fn();
    } catch {
      // The context may have been disposed between scheduling and firing.
    }
  }, ms);
}

const CUE_LIBRARY: Record<AudioCue, CueConfig> = {
  "shot.player": {
    minInterval: 0.04,
    maxVoices: 5,
    maxDistance: 40,
    estimateDuration: 0.2,
    build: (ctx, dest, gain) => {
      playNoiseBurst(ctx, dest, {
        duration: 0.05,
        attack: 0.001,
        decay: 0.09,
        filterHz: 2500 + Math.random() * 500,
        filterQ: 0.7,
        gain: 0.55 * gain,
        type: "bandpass",
      });
      playThump(ctx, dest, { freq: 140, endFreq: 60, duration: 0.07, gain: 0.35 * gain, decay: 0.1 });
    },
  },
  "shot.turret": {
    minInterval: 0.04,
    maxVoices: 6,
    maxDistance: 45,
    estimateDuration: 0.25,
    build: (ctx, dest, gain) => {
      playNoiseBurst(ctx, dest, {
        duration: 0.03,
        attack: 0.001,
        decay: 0.07,
        filterHz: 4200,
        filterQ: 3.2,
        gain: 0.4 * gain,
        type: "bandpass",
      });
      playTone(ctx, dest, {
        freq: 1800 + Math.random() * 400,
        endFreq: 900,
        duration: 0.05,
        attack: 0.001,
        decay: 0.06,
        gain: 0.25 * gain,
        type: "square",
      });
      playThump(ctx, dest, { freq: 110, endFreq: 55, duration: 0.08, gain: 0.3 * gain, decay: 0.12 });
    },
  },
  "hit.flesh": {
    minInterval: 0.03,
    maxVoices: 8,
    maxDistance: 35,
    estimateDuration: 0.15,
    build: (ctx, dest, gain) => {
      playNoiseBurst(ctx, dest, {
        duration: 0.06,
        attack: 0.002,
        decay: 0.08,
        filterHz: 450,
        filterQ: 0.9,
        gain: 0.5 * gain,
        type: "lowpass",
      });
      playThump(ctx, dest, { freq: 90, endFreq: 45, duration: 0.06, gain: 0.25 * gain, decay: 0.09 });
    },
  },
  "hit.bone": {
    minInterval: 0.03,
    maxVoices: 8,
    maxDistance: 35,
    estimateDuration: 0.08,
    build: noiseHit(1400, 4, "bandpass", 0.015, 0.03),
  },
  "hit.metal": {
    minInterval: 0.03,
    maxVoices: 6,
    maxDistance: 35,
    estimateDuration: 0.2,
    build: (ctx, dest, gain) => {
      playNoiseBurst(ctx, dest, {
        duration: 0.02,
        attack: 0.001,
        decay: 0.05,
        filterHz: 5200,
        filterQ: 2,
        gain: 0.4 * gain,
        type: "highpass",
      });
      playTone(ctx, dest, {
        freq: 2400 + Math.random() * 500,
        endFreq: 1600,
        duration: 0.14,
        attack: 0.001,
        decay: 0.15,
        gain: 0.22 * gain,
        type: "triangle",
      });
    },
  },
  "enemy.death": {
    minInterval: 0.04,
    maxVoices: 10,
    maxDistance: 45,
    estimateDuration: 0.3,
    build: (ctx, dest, gain) => {
      playNoiseBurst(ctx, dest, {
        duration: 0.12,
        attack: 0.005,
        decay: 0.15,
        filterHz: 900,
        filterQ: 0.8,
        gain: 0.35 * gain,
        type: "bandpass",
      });
      playTone(ctx, dest, {
        freq: 260 + Math.random() * 40,
        endFreq: 70,
        duration: 0.22,
        attack: 0.005,
        decay: 0.2,
        gain: 0.3 * gain,
        type: "sawtooth",
      });
    },
  },
  "enemy.spawn": {
    minInterval: 0.08,
    maxVoices: 6,
    maxDistance: 40,
    estimateDuration: 0.3,
    build: (ctx, dest, gain) => {
      playNoiseBurst(ctx, dest, {
        duration: 0.2,
        attack: 0.05,
        decay: 0.1,
        filterHz: 350,
        filterQ: 0.6,
        gain: 0.22 * gain,
        type: "lowpass",
      });
      playTone(ctx, dest, {
        freq: 90,
        endFreq: 160,
        duration: 0.22,
        attack: 0.04,
        decay: 0.08,
        gain: 0.15 * gain,
        type: "sine",
      });
    },
  },
  explosion: {
    minInterval: 0.1,
    maxVoices: 3,
    maxDistance: 70,
    estimateDuration: 0.9,
    build: (ctx, dest, gain) => {
      playNoiseBurst(ctx, dest, {
        duration: 0.5,
        attack: 0.005,
        decay: 0.5,
        filterHz: 1600,
        filterQ: 0.5,
        gain: 0.6 * gain,
        type: "lowpass",
      });
      playTone(ctx, dest, {
        freq: 130,
        endFreq: 35,
        duration: 0.6,
        attack: 0.005,
        decay: 0.5,
        gain: 0.5 * gain,
        type: "sine",
      });
      playThump(ctx, dest, { freq: 70, endFreq: 30, duration: 0.3, gain: 0.4 * gain, decay: 0.35 });
    },
  },
  "lastShot.charge": {
    minInterval: 0.5,
    maxVoices: 2,
    maxDistance: 50,
    estimateDuration: 1.1,
    build: (ctx, dest, gain) => {
      playTone(ctx, dest, {
        freq: 220,
        endFreq: 1400,
        duration: 1.0,
        attack: 0.05,
        decay: 0.15,
        gain: 0.3 * gain,
        type: "sawtooth",
      });
      playNoiseBurst(ctx, dest, {
        duration: 1.0,
        attack: 0.1,
        decay: 0.1,
        filterHz: 3000,
        filterQ: 1.2,
        gain: 0.15 * gain,
        type: "highpass",
      });
    },
  },
  "build.place": {
    minInterval: 0.05,
    maxVoices: 4,
    maxDistance: 30,
    estimateDuration: 0.22,
    build: (ctx, dest, gain) => {
      playThump(ctx, dest, { freq: 160, endFreq: 80, duration: 0.07, gain: 0.3 * gain, decay: 0.1 });
      playTone(ctx, dest, {
        freq: 400,
        endFreq: 700,
        duration: 0.12,
        attack: 0.005,
        decay: 0.1,
        gain: 0.25 * gain,
        type: "triangle",
      });
    },
  },
  "build.invalid": {
    minInterval: 0.12,
    maxVoices: 2,
    maxDistance: 30,
    estimateDuration: 0.2,
    build: (ctx, dest, gain) =>
      playTone(ctx, dest, {
        freq: 160,
        endFreq: 110,
        duration: 0.15,
        attack: 0.001,
        decay: 0.08,
        gain: 0.3 * gain,
        type: "square",
      }),
  },
  "build.fold": {
    minInterval: 0.08,
    maxVoices: 3,
    maxDistance: 30,
    estimateDuration: 0.28,
    build: (ctx, dest, gain) => {
      playNoiseBurst(ctx, dest, {
        duration: 0.1,
        attack: 0.005,
        decay: 0.12,
        filterHz: 800,
        filterQ: 1,
        gain: 0.25 * gain,
        type: "bandpass",
      });
      playTone(ctx, dest, {
        freq: 700,
        endFreq: 320,
        duration: 0.16,
        attack: 0.005,
        decay: 0.12,
        gain: 0.22 * gain,
        type: "triangle",
      });
    },
  },
  "build.radialOpen": {
    minInterval: 0.1,
    maxVoices: 2,
    maxDistance: 100,
    estimateDuration: 0.1,
    build: (ctx, dest, gain) =>
      playTone(ctx, dest, { freq: 900, duration: 0.06, attack: 0.001, decay: 0.05, gain: 0.2 * gain, type: "sine" }),
  },
  repair: {
    minInterval: 0.15,
    maxVoices: 2,
    maxDistance: 25,
    estimateDuration: 0.12,
    build: (ctx, dest, gain) => {
      playNoiseBurst(ctx, dest, {
        duration: 0.02,
        attack: 0.001,
        decay: 0.04,
        filterHz: 3200,
        filterQ: 2.5,
        gain: 0.3 * gain,
        type: "bandpass",
      });
      playThump(ctx, dest, { freq: 220, endFreq: 140, duration: 0.05, gain: 0.18 * gain, decay: 0.07 });
    },
  },
  refuel: {
    minInterval: 0.2,
    maxVoices: 2,
    maxDistance: 25,
    estimateDuration: 0.25,
    build: noiseHit(900, 1.4, "bandpass", 0.18, 0.08),
  },
  "pickup.scrap": {
    minInterval: 0.04,
    maxVoices: 5,
    maxDistance: 25,
    estimateDuration: 0.13,
    build: (ctx, dest, gain) =>
      playTone(ctx, dest, {
        freq: 700,
        endFreq: 1100,
        duration: 0.08,
        attack: 0.002,
        decay: 0.07,
        gain: 0.22 * gain,
        type: "square",
      }),
  },
  "pickup.fuel": {
    minInterval: 0.04,
    maxVoices: 5,
    maxDistance: 25,
    estimateDuration: 0.15,
    build: (ctx, dest, gain) =>
      playTone(ctx, dest, {
        freq: 520,
        endFreq: 780,
        duration: 0.1,
        attack: 0.004,
        decay: 0.09,
        gain: 0.22 * gain,
        type: "sine",
      }),
  },
  "player.hurt": {
    minInterval: 0.15,
    maxVoices: 2,
    maxDistance: 100,
    estimateDuration: 0.28,
    build: (ctx, dest, gain) => {
      playNoiseBurst(ctx, dest, {
        duration: 0.1,
        attack: 0.002,
        decay: 0.12,
        filterHz: 700,
        filterQ: 0.8,
        gain: 0.4 * gain,
        type: "bandpass",
      });
      playTone(ctx, dest, {
        freq: 300,
        endFreq: 140,
        duration: 0.18,
        attack: 0.002,
        decay: 0.15,
        gain: 0.3 * gain,
        type: "sawtooth",
      });
    },
  },
  "player.dodge": {
    minInterval: 0.2,
    maxVoices: 1,
    maxDistance: 100,
    estimateDuration: 0.2,
    build: noiseHit(1800, 0.7, "bandpass", 0.16, 0.08),
  },
  "player.down": {
    minInterval: 0.5,
    maxVoices: 1,
    maxDistance: 100,
    estimateDuration: 0.7,
    build: (ctx, dest, gain) => {
      playTone(ctx, dest, {
        freq: 220,
        endFreq: 60,
        duration: 0.5,
        attack: 0.01,
        decay: 0.3,
        gain: 0.4 * gain,
        type: "sawtooth",
      });
      playThump(ctx, dest, { freq: 90, endFreq: 40, duration: 0.3, gain: 0.35 * gain, decay: 0.3 });
    },
  },
  "spider.step": {
    minInterval: 0.12,
    maxVoices: 2,
    maxDistance: 45,
    estimateDuration: 0.1,
    build: (ctx, dest, gain) =>
      playThump(ctx, dest, {
        freq: 65 + Math.random() * 10,
        endFreq: 35,
        duration: 0.08,
        gain: 0.18 * gain,
        decay: 0.09,
      }),
  },
  "spider.overdrive": {
    minInterval: 0.6,
    maxVoices: 1,
    maxDistance: 60,
    estimateDuration: 0.6,
    build: (ctx, dest, gain) => {
      playTone(ctx, dest, {
        freq: 140,
        endFreq: 420,
        duration: 0.5,
        attack: 0.05,
        decay: 0.15,
        gain: 0.3 * gain,
        type: "sawtooth",
      });
      playNoiseBurst(ctx, dest, {
        duration: 0.4,
        attack: 0.05,
        decay: 0.15,
        filterHz: 2000,
        filterQ: 1,
        gain: 0.15 * gain,
        type: "highpass",
      });
    },
  },
  "spider.damage": {
    minInterval: 0.15,
    maxVoices: 3,
    maxDistance: 60,
    estimateDuration: 0.3,
    build: (ctx, dest, gain) => {
      playNoiseBurst(ctx, dest, {
        duration: 0.05,
        attack: 0.001,
        decay: 0.1,
        filterHz: 3600,
        filterQ: 2,
        gain: 0.35 * gain,
        type: "bandpass",
      });
      playThump(ctx, dest, { freq: 100, endFreq: 45, duration: 0.15, gain: 0.35 * gain, decay: 0.2 });
    },
  },
  "spider.lowFuel": {
    minInterval: 1.5,
    maxVoices: 1,
    maxDistance: 100,
    estimateDuration: 0.35,
    build: (ctx, dest, gain) =>
      playTone(ctx, dest, { freq: 220, duration: 0.18, attack: 0.01, decay: 0.15, gain: 0.25 * gain, type: "square" }),
  },
  "ui.move": {
    minInterval: 0.04,
    maxVoices: 2,
    maxDistance: 1e6,
    estimateDuration: 0.05,
    build: (ctx, dest, gain) =>
      playTone(ctx, dest, { freq: 650, duration: 0.03, attack: 0.001, decay: 0.03, gain: 0.15 * gain, type: "sine" }),
  },
  "ui.confirm": {
    minInterval: 0.06,
    maxVoices: 2,
    maxDistance: 1e6,
    estimateDuration: 0.09,
    build: (ctx, dest, gain) =>
      playTone(ctx, dest, {
        freq: 500,
        endFreq: 900,
        duration: 0.07,
        attack: 0.001,
        decay: 0.06,
        gain: 0.2 * gain,
        type: "sine",
      }),
  },
  "ui.back": {
    minInterval: 0.06,
    maxVoices: 2,
    maxDistance: 1e6,
    estimateDuration: 0.09,
    build: (ctx, dest, gain) =>
      playTone(ctx, dest, {
        freq: 500,
        endFreq: 300,
        duration: 0.07,
        attack: 0.001,
        decay: 0.06,
        gain: 0.2 * gain,
        type: "sine",
      }),
  },
  "trail.escalate": {
    minInterval: 1.0,
    maxVoices: 1,
    maxDistance: 1e6,
    estimateDuration: 1.0,
    build: (ctx, dest, gain) => {
      playTone(ctx, dest, {
        freq: 90,
        endFreq: 260,
        duration: 0.8,
        attack: 0.02,
        decay: 0.3,
        gain: 0.35 * gain,
        type: "sawtooth",
      });
      playNoiseBurst(ctx, dest, {
        duration: 0.6,
        attack: 0.05,
        decay: 0.3,
        filterHz: 1200,
        filterQ: 0.6,
        gain: 0.2 * gain,
        type: "bandpass",
      });
    },
  },
  levelUp: {
    minInterval: 0.3,
    maxVoices: 1,
    maxDistance: 1e6,
    estimateDuration: 0.6,
    build: (ctx, dest, gain) => {
      playTone(ctx, dest, { freq: 523, duration: 0.14, attack: 0.002, decay: 0.12, gain: 0.25 * gain, type: "triangle" });
      scheduleDelayed(ctx, 80, () =>
        playTone(ctx, dest, { freq: 659, duration: 0.14, attack: 0.002, decay: 0.12, gain: 0.25 * gain, type: "triangle" }),
      );
      scheduleDelayed(ctx, 160, () =>
        playTone(ctx, dest, { freq: 784, duration: 0.22, attack: 0.002, decay: 0.2, gain: 0.28 * gain, type: "triangle" }),
      );
    },
  },
  checkpoint: {
    minInterval: 1.0,
    maxVoices: 1,
    maxDistance: 1e6,
    estimateDuration: 0.5,
    build: (ctx, dest, gain) => {
      playTone(ctx, dest, { freq: 440, duration: 0.16, attack: 0.005, decay: 0.14, gain: 0.28 * gain, type: "sine" });
      scheduleDelayed(ctx, 120, () =>
        playTone(ctx, dest, { freq: 660, duration: 0.22, attack: 0.005, decay: 0.2, gain: 0.3 * gain, type: "sine" }),
      );
    },
  },
  victory: {
    minInterval: 2.0,
    maxVoices: 1,
    maxDistance: 1e6,
    estimateDuration: 1.8,
    build: (ctx, dest, gain) => {
      playNoiseBurst(ctx, dest, {
        duration: 0.6,
        attack: 0.05,
        decay: 0.4,
        filterHz: 2000,
        filterQ: 0.6,
        gain: 0.2 * gain,
        type: "highpass",
      });
      playTone(ctx, dest, { freq: 392, duration: 0.2, attack: 0.005, decay: 0.15, gain: 0.3 * gain, type: "triangle" });
      scheduleDelayed(ctx, 180, () =>
        playTone(ctx, dest, { freq: 523, duration: 0.2, attack: 0.005, decay: 0.15, gain: 0.3 * gain, type: "triangle" }),
      );
      scheduleDelayed(ctx, 360, () =>
        playTone(ctx, dest, { freq: 659, duration: 0.5, attack: 0.005, decay: 0.4, gain: 0.35 * gain, type: "triangle" }),
      );
    },
  },
  defeat: {
    minInterval: 2.0,
    maxVoices: 1,
    maxDistance: 1e6,
    estimateDuration: 1.4,
    build: (ctx, dest, gain) => {
      playTone(ctx, dest, {
        freq: 220,
        endFreq: 55,
        duration: 1.1,
        attack: 0.02,
        decay: 0.6,
        gain: 0.4 * gain,
        type: "sawtooth",
      });
      playNoiseBurst(ctx, dest, {
        duration: 0.8,
        attack: 0.05,
        decay: 0.5,
        filterHz: 500,
        filterQ: 0.5,
        gain: 0.25 * gain,
        type: "lowpass",
      });
    },
  },
};

interface TensionProfile {
  drone: number;
  filter: number;
  overtone: number;
  pulseInterval: number;
}

const TENSION_PROFILES: Record<string, TensionProfile> = {
  QUIET: { drone: 55, filter: 450, overtone: 0, pulseInterval: 0 },
  PROBING: { drone: 58, filter: 650, overtone: 0.15, pulseInterval: 0 },
  SWARM: { drone: 61, filter: 950, overtone: 0.35, pulseInterval: 1.1 },
  HEAVY: { drone: 65, filter: 1500, overtone: 0.6, pulseInterval: 0.7 },
  PURSUIT: { drone: 73, filter: 2200, overtone: 0.9, pulseInterval: 0.42 },
};

function pruneExpired(list: number[], now: number): number[] {
  let write = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] > now) list[write++] = list[i];
  }
  list.length = write;
  return list;
}

export class AudioDirector {
  private static readonly MAX_TOTAL_VOICES = 28;
  private static readonly PULSE_LOOKAHEAD = 0.15;
  private static readonly TENSION_HALF_LIFE = 0.7;

  private ctx: AudioContext | null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private effectsGain: GainNode | null = null;

  private droneOsc1: OscillatorNode | null = null;
  private droneOsc2: OscillatorNode | null = null;
  private droneGain2: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private pulseBus: GainNode | null = null;

  private listenerX = 0;
  private listenerZ = 0;
  private _ready = false;

  private readonly lastPlayTime = new Map<AudioCue, number>();
  private readonly voiceEndsByCue = new Map<AudioCue, number[]>();
  private globalVoiceEnds: number[] = [];

  private readonly tensionCurrent: TensionProfile = { ...TENSION_PROFILES.QUIET };
  private readonly tensionTarget: TensionProfile = { ...TENSION_PROFILES.QUIET };
  private pulseActive = false;
  private nextPulseTime = 0;

  constructor() {
    const ctor: typeof AudioContext | undefined =
      typeof AudioContext !== "undefined" ? AudioContext : undefined;
    this.ctx = ctor ? new ctor() : null;
    if (this.ctx) this.buildGraph(this.ctx);
  }

  private buildGraph(ctx: AudioContext): void {
    const masterGain = ctx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(ctx.destination);
    this.masterGain = masterGain;

    const musicGain = ctx.createGain();
    musicGain.gain.value = 0.8;
    musicGain.connect(masterGain);
    this.musicGain = musicGain;

    const effectsGain = ctx.createGain();
    effectsGain.gain.value = 1;
    effectsGain.connect(masterGain);
    this.effectsGain = effectsGain;

    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = this.tensionCurrent.filter;
    droneFilter.Q.value = 0.7;
    droneFilter.connect(musicGain);
    this.droneFilter = droneFilter;

    const droneGain1 = ctx.createGain();
    droneGain1.gain.value = 0.22;
    droneGain1.connect(droneFilter);

    const droneOsc1 = ctx.createOscillator();
    droneOsc1.type = "sine";
    droneOsc1.frequency.value = this.tensionCurrent.drone;
    droneOsc1.connect(droneGain1);
    droneOsc1.start();
    this.droneOsc1 = droneOsc1;

    const droneGain2 = ctx.createGain();
    droneGain2.gain.value = 0;
    droneGain2.connect(droneFilter);
    this.droneGain2 = droneGain2;

    const droneOsc2 = ctx.createOscillator();
    droneOsc2.type = "sawtooth";
    droneOsc2.frequency.value = this.tensionCurrent.drone * 2;
    droneOsc2.connect(droneGain2);
    droneOsc2.start();
    this.droneOsc2 = droneOsc2;

    const pulseBus = ctx.createGain();
    pulseBus.gain.value = 0.6;
    pulseBus.connect(musicGain);
    this.pulseBus = pulseBus;
  }

  /** Must be called from a user gesture (the Press-Cross splash) — browsers refuse to run a suspended context otherwise. */
  async resume(): Promise<void> {
    if (!this.ctx) return;
    try {
      await this.ctx.resume();
      this._ready = this.ctx.state === "running";
    } catch {
      this._ready = false;
    }
  }

  get ready(): boolean {
    return this._ready;
  }

  setMasterVolume(v: number): void {
    this.rampGain(this.masterGain, v);
  }

  setMusicVolume(v: number): void {
    this.rampGain(this.musicGain, v);
  }

  setEffectsVolume(v: number): void {
    this.rampGain(this.effectsGain, v);
  }

  private rampGain(node: GainNode | null, v: number): void {
    if (!node || !this.ctx) return;
    const now = this.ctx.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setTargetAtTime(clamp01(v), now, 0.05);
  }

  /** Positional falloff relative to the camera focus; pass world coords. */
  setListener(x: number, z: number): void {
    this.listenerX = x;
    this.listenerZ = z;
  }

  /**
   * Plays a named cue, rate-limited per cue (minimum interval + max
   * concurrent voices) and globally voice-capped. Distant or quiet instances
   * are dropped outright rather than queued, so a horde spamming this cue
   * degrades gracefully instead of building a backlog.
   */
  play(cue: AudioCue, x?: number, z?: number, intensity = 1): void {
    if (!this.ctx || !this._ready || !this.effectsGain) return;
    const config = CUE_LIBRARY[cue];
    const now = this.ctx.currentTime;

    const lastAttempt = this.lastPlayTime.get(cue) ?? -Infinity;
    if (now - lastAttempt < config.minInterval) return;

    let falloff = 1;
    let dx = 0;
    const hasPosition = x !== undefined && z !== undefined;
    if (hasPosition) {
      dx = x - this.listenerX;
      const dz = z - this.listenerZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > config.maxDistance) return;
      const linear = 1 - clamp01(dist / config.maxDistance);
      falloff = linear * linear;
    }

    const finalGain = falloff * clamp01(intensity);
    if (finalGain < 0.02) return;

    let cueVoices = this.voiceEndsByCue.get(cue);
    if (!cueVoices) {
      cueVoices = [];
      this.voiceEndsByCue.set(cue, cueVoices);
    }
    pruneExpired(cueVoices, now);
    if (cueVoices.length >= config.maxVoices) return;

    pruneExpired(this.globalVoiceEnds, now);
    if (this.globalVoiceEnds.length >= AudioDirector.MAX_TOTAL_VOICES) return;

    this.lastPlayTime.set(cue, now);

    let outputNode: AudioNode = this.effectsGain;
    let panner: StereoPannerNode | null = null;
    if (hasPosition) {
      panner = this.ctx.createStereoPanner();
      panner.pan.value = clamp(dx / 14, -1, 1);
      panner.connect(this.effectsGain);
      outputNode = panner;
    }

    config.build(this.ctx, outputNode, finalGain);

    const endTime = now + config.estimateDuration;
    cueVoices.push(endTime);
    this.globalVoiceEnds.push(endTime);

    if (panner) {
      const p = panner;
      setTimeout(() => p.disconnect(), (config.estimateDuration + 0.3) * 1000);
    }
  }

  /** Layered adaptive music bed driven by the Trail state: a rising drone plus, from HEAVY on, an insistent pulse. */
  setTension(trailState: string, pursuit: boolean): void {
    const profile = TENSION_PROFILES[trailState] ?? TENSION_PROFILES.QUIET;
    this.tensionTarget.drone = profile.drone;
    this.tensionTarget.filter = profile.filter;
    this.tensionTarget.overtone = profile.overtone;
    this.tensionTarget.pulseInterval = pursuit
      ? Math.min(profile.pulseInterval > 0 ? profile.pulseInterval : 0.42, 0.42)
      : profile.pulseInterval;
    this.pulseActive = this.tensionTarget.pulseInterval > 0;
  }

  update(dt: number): void {
    if (!this.ctx) return;
    const halfLife = AudioDirector.TENSION_HALF_LIFE;
    this.tensionCurrent.drone = damp(this.tensionCurrent.drone, this.tensionTarget.drone, halfLife, dt);
    this.tensionCurrent.filter = damp(this.tensionCurrent.filter, this.tensionTarget.filter, halfLife, dt);
    this.tensionCurrent.overtone = damp(this.tensionCurrent.overtone, this.tensionTarget.overtone, halfLife, dt);
    this.tensionCurrent.pulseInterval = damp(
      this.tensionCurrent.pulseInterval,
      this.tensionTarget.pulseInterval,
      halfLife,
      dt,
    );

    if (this.droneOsc1 && this.droneOsc2 && this.droneFilter && this.droneGain2) {
      const now = this.ctx.currentTime;
      this.droneOsc1.frequency.setTargetAtTime(this.tensionCurrent.drone, now, 0.3);
      this.droneOsc2.frequency.setTargetAtTime(this.tensionCurrent.drone * 2, now, 0.3);
      this.droneFilter.frequency.setTargetAtTime(this.tensionCurrent.filter, now, 0.3);
      this.droneGain2.gain.setTargetAtTime(this.tensionCurrent.overtone * 0.18, now, 0.3);
    }

    if (this._ready && this.pulseActive && this.pulseBus) {
      const now = this.ctx.currentTime;
      if (this.nextPulseTime < now) this.nextPulseTime = now;
      const interval = Math.max(0.12, this.tensionCurrent.pulseInterval);
      while (this.nextPulseTime < now + AudioDirector.PULSE_LOOKAHEAD) {
        this.schedulePulse(this.nextPulseTime);
        this.nextPulseTime += interval;
      }
    }

    pruneExpired(this.globalVoiceEnds, this.ctx.currentTime);
  }

  private schedulePulse(atTime: number): void {
    if (!this.ctx || !this.pulseBus) return;
    const ctx = this.ctx;
    const bus = this.pulseBus;
    const delayMs = Math.max(0, (atTime - ctx.currentTime) * 1000);
    setTimeout(() => {
      if (ctx.state === "closed") return;
      try {
        playThump(ctx, bus, { freq: 78, endFreq: 40, duration: 0.14, gain: 0.5, decay: 0.16 });
      } catch {
        // The context may have been disposed between scheduling and firing.
      }
    }, delayMs);
  }

  suspend(): void {
    if (!this.ctx) return;
    this._ready = false;
    void this.ctx.suspend().catch(() => {});
  }

  dispose(): void {
    if (!this.ctx) return;
    this._ready = false;
    try {
      this.droneOsc1?.stop();
    } catch {
      // Already stopped.
    }
    try {
      this.droneOsc2?.stop();
    } catch {
      // Already stopped.
    }
    this.droneOsc1?.disconnect();
    this.droneOsc2?.disconnect();
    this.droneGain2?.disconnect();
    this.droneFilter?.disconnect();
    this.pulseBus?.disconnect();
    this.musicGain?.disconnect();
    this.effectsGain?.disconnect();
    this.masterGain?.disconnect();
    const ctx = this.ctx;
    this.ctx = null;
    void ctx.close().catch(() => {});
  }
}
