/**
 * Fallback layout for a DualShock 4 that is not reported under the W3C
 * standard mapping. Firefox and several Bluetooth stacks hand back
 * `mapping === ""` and the raw HID ordering, which puts Square first and the
 * triggers on their own axes.
 */

import type { GamepadProfile, RawGamepadReading } from "./GamepadProfile.ts";

/** Vendor id, marketing names, and the generic name Sony pads advertise. */
const SONY_ID_HINTS: readonly string[] = [
  "054c",
  "dualshock",
  "dualsense",
  "wireless controller",
];

function looksLikeSony(id: string): boolean {
  const lower = id.toLowerCase();
  for (let i = 0; i < SONY_ID_HINTS.length; i++) {
    if (lower.includes(SONY_ID_HINTS[i])) return true;
  }
  return false;
}

export const DUALSHOCK4_PROFILE: GamepadProfile = {
  id: "dualshock4",
  matches(reading: RawGamepadReading): boolean {
    return reading.mapping !== "standard" && looksLikeSony(reading.id);
  },
  buttonMap: {
    0: "service", // Square
    1: "confirm", // Cross
    2: "cancel", // Circle
    3: "fold", // Triangle
    4: "buildRadial", // L1
    5: "tool", // R1
    6: "overlay", // L2
    7: "focusFire", // R2
    8: "map", // Share
    9: "pause", // Options
    10: null, // L3
    11: "recenter", // R3
    12: null, // PS
    13: null, // Touchpad click
    14: "overdrive", // D-pad up
    15: "menuDown", // D-pad down
    16: "blueprintPrev", // D-pad left
    17: "blueprintNext", // D-pad right
  },
  leftStickAxes: [0, 1],
  /** Axes 3 and 4 carry L2/R2 on this layout, so the right stick is 2 and 5. */
  rightStickAxes: [2, 5],
  analogButtons: [6, 7],
  dpadHat: { axis: 9, buttons: [14, 17, 15, 16] },
};
