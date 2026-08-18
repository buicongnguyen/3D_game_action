/**
 * Physical gamepad layouts. Only this file and `InputManager` know what a
 * button index is; everything above the input layer speaks in actions.
 */

import type { GameplayAction, MenuAction } from "./InputActions.ts";
import { DUALSHOCK4_PROFILE } from "./DualShockProfile.ts";

/**
 * The subset of the `Gamepad` interface the input layer reads. A live
 * `Gamepad` satisfies this structurally, so readings never have to be copied.
 */
export interface RawGamepadReading {
  id: string;
  mapping: string;
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
  connected: boolean;
}

/**
 * Some stacks report the D-pad as a single 8-way hat axis instead of four
 * buttons. The hat drives the listed button indices so the rest of the layer
 * only ever deals with buttons.
 */
export interface DpadHat {
  readonly axis: number;
  /** Button indices for up, right, down, left. */
  readonly buttons: readonly [number, number, number, number];
}

export interface GamepadProfile {
  readonly id: string;
  matches(reading: RawGamepadReading): boolean;
  /** Maps physical indices to semantic actions. */
  readonly buttonMap: Readonly<Record<number, GameplayAction | MenuAction | null>>;
  readonly leftStickAxes: readonly [number, number];
  readonly rightStickAxes: readonly [number, number];
  /** Indices that are analog triggers and need hysteresis. */
  readonly analogButtons: readonly number[];
  readonly dpadHat?: DpadHat;
}

/**
 * W3C standard mapping. On a DualShock 4 this is Cross/Circle/Square/Triangle,
 * L1/R1, L2/R2, Share/Options, L3/R3, then the four D-pad buttons.
 */
export const STANDARD_PROFILE: GamepadProfile = {
  id: "standard",
  matches(reading: RawGamepadReading): boolean {
    return reading.mapping === "standard";
  },
  buttonMap: {
    0: "confirm",
    1: "cancel",
    2: "service",
    3: "fold",
    4: "buildRadial",
    5: "tool",
    6: "overlay",
    7: "focusFire",
    8: "map",
    9: "pause",
    10: null,
    11: "recenter",
    12: "overdrive",
    13: "weaponNext",
    14: "blueprintPrev",
    15: "blueprintNext",
    16: null,
  },
  leftStickAxes: [0, 1],
  rightStickAxes: [2, 3],
  analogButtons: [6, 7],
};

const KNOWN_PROFILES: readonly GamepadProfile[] = [STANDARD_PROFILE, DUALSHOCK4_PROFILE];

export function isStandardMapping(reading: RawGamepadReading): boolean {
  return reading.mapping === "standard";
}

/** The matching profile, or null when the pad needs a calibration pass. */
export function findProfile(reading: RawGamepadReading): GamepadProfile | null {
  for (let i = 0; i < KNOWN_PROFILES.length; i++) {
    const profile = KNOWN_PROFILES[i];
    if (profile.matches(reading)) return profile;
  }
  return null;
}

/**
 * Always yields a usable profile. An unrecognised pad falls back to the
 * standard layout, which is wrong often enough that callers should also check
 * `findProfile` and offer remapping.
 */
export function selectProfile(reading: RawGamepadReading): GamepadProfile {
  return findProfile(reading) ?? STANDARD_PROFILE;
}
