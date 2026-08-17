/**
 * The one place that touches `navigator.getGamepads()`, key codes, and mouse
 * events. Everything above reads the `InputSnapshot`, which is mutated in
 * place once per rendered frame and stays valid until the next `poll`.
 */

import {
  ALL_ACTIONS,
  applyRadialDeadZone,
  applyResponseCurve,
  createEmptySnapshot,
  TRIGGER_PRESS_THRESHOLD,
  TRIGGER_RELEASE_THRESHOLD,
} from "./InputActions.ts";
import type {
  ButtonState,
  InputAction,
  InputDevice,
  InputSnapshot,
  MenuAction,
  StickState,
} from "./InputActions.ts";
import { findProfile, STANDARD_PROFILE } from "./GamepadProfile.ts";
import type { GamepadProfile, RawGamepadReading } from "./GamepadProfile.ts";
import { KeyboardProfile } from "./KeyboardProfile.ts";
import { PLAYER } from "../data/balance.ts";

export interface InputManagerOptions {
  deadZone?: number;
  responseCurve?: number;
}

export type ConnectionListener = (connected: boolean, id: string) => void;

const ACTION_COUNT = ALL_ACTIONS.length;

const ACTION_INDEX: Readonly<Record<string, number>> = (() => {
  const table: Record<string, number> = {};
  for (let i = 0; i < ACTION_COUNT; i++) table[ALL_ACTIONS[i]] = i;
  return table;
})();

/**
 * A button bound to a gameplay action also drives its menu counterpart, so a
 * single physical layout serves both contexts without a mode switch.
 */
const MENU_ALIASES: readonly (readonly [InputAction, MenuAction])[] = [
  ["confirm", "menuConfirm"],
  ["cancel", "menuBack"],
  ["buildRadial", "menuTabPrev"],
  ["tool", "menuTabNext"],
  ["overdrive", "menuUp"],
  ["blueprintPrev", "menuLeft"],
  ["blueprintNext", "menuRight"],
];

const ALIAS_PAIRS = (() => {
  const flat = new Int16Array(MENU_ALIASES.length * 2);
  for (let i = 0; i < MENU_ALIASES.length; i++) {
    flat[i * 2] = ACTION_INDEX[MENU_ALIASES[i][0]];
    flat[i * 2 + 1] = ACTION_INDEX[MENU_ALIASES[i][1]];
  }
  return flat;
})();

const MENU_UP = ACTION_INDEX.menuUp;
const MENU_DOWN = ACTION_INDEX.menuDown;
const MENU_LEFT = ACTION_INDEX.menuLeft;
const MENU_RIGHT = ACTION_INDEX.menuRight;

const DIGITAL_THRESHOLD = 0.5;
const MAX_STEP = 0.25;
const HAT_NEUTRAL = 1.05;
/** Hat axis directions, clockwise from up, as pairs of hat-button slots. */
const HAT_SLOTS: readonly (readonly number[])[] = [
  [0],
  [0, 1],
  [1],
  [1, 2],
  [2],
  [2, 3],
  [3],
  [3, 0],
];

const stickScratch = { x: 0, y: 0, magnitude: 0 };

interface HapticsCapableGamepad {
  vibrationActuator?: {
    playEffect?: (type: string, params: Record<string, number>) => Promise<string>;
  } | null;
}

function axisAt(axes: readonly number[], index: number): number {
  if (index < 0 || index >= axes.length) return 0;
  const value = axes[index];
  return Number.isFinite(value) ? value : 0;
}

export class InputManager {
  private readonly snap: InputSnapshot = createEmptySnapshot();
  private readonly states: ButtonState[] = [];
  private readonly raw = new Float32Array(ACTION_COUNT);
  private readonly analogAction = new Uint8Array(ACTION_COUNT);
  private readonly keyboard = new KeyboardProfile();
  private readonly connectionListeners: ConnectionListener[] = [];

  private profile: GamepadProfile = STANDARD_PROFILE;
  private buttonAction = new Int16Array(0);
  private buttonAnalog = new Uint8Array(0);

  private deadZone: number = PLAYER.deadZone;
  private curve: number = 1;

  private window: Window | null = null;
  private padIndex = -1;
  private profiledSignature = "";
  private liveGamepad: unknown = null;
  private injecting = false;
  private injected: RawGamepadReading | null = null;

  private connectedValue = false;
  private acquiredValue = false;
  private needsCalibrationValue = false;
  private gamepadIdValue = "";
  private vibrationEnabled = true;

  private padWasActive = false;
  private keyboardWasActive = false;
  private lastDeviceValue: InputDevice = "none";

  constructor(options?: InputManagerOptions) {
    for (let i = 0; i < ACTION_COUNT; i++) {
      this.states.push(this.snap.buttons[ALL_ACTIONS[i]]);
    }
    if (options?.deadZone !== undefined) this.setDeadZone(options.deadZone);
    if (options?.responseCurve !== undefined) this.setResponseCurve(options.responseCurve);
    this.compileProfile(STANDARD_PROFILE);
  }

  /** Attach window/document listeners. Call once at boot. */
  attach(target?: Window): void {
    const win = target ?? (typeof window !== "undefined" ? window : null);
    if (!win) return;
    if (this.window) this.detach();
    this.window = win;
    win.addEventListener("gamepadconnected", this.handleGamepadConnected);
    win.addEventListener("gamepaddisconnected", this.handleGamepadDisconnected);
    this.keyboard.attach(win);
  }

  detach(): void {
    const win = this.window;
    if (win) {
      win.removeEventListener("gamepadconnected", this.handleGamepadConnected);
      win.removeEventListener("gamepaddisconnected", this.handleGamepadDisconnected);
      this.window = null;
    }
    this.keyboard.detach();
  }

  /** Poll gamepads. Call ONCE per rendered frame, before the fixed-step loop. */
  poll(dtSeconds: number): void {
    const dt = dtSeconds > 0 ? Math.min(dtSeconds, MAX_STEP) : 0;
    const raw = this.raw;
    raw.fill(0);

    const reading = this.readGamepad();
    let padActive = false;

    if (reading !== null && reading.connected) {
      this.ensureProfile(reading);
      padActive = this.readButtons(reading, raw);
      padActive = this.readSticks(reading) || padActive;
      this.setConnected(true, reading.id);
    } else {
      this.resetStick(this.snap.leftStick);
      this.resetStick(this.snap.rightStick);
      this.setConnected(false, "");
    }

    this.keyboard.applyTo(raw, ACTION_INDEX);
    this.applyKeyboardSticks();
    this.applyStickMenuNavigation();

    for (let i = 0; i < ALIAS_PAIRS.length; i += 2) {
      const source = ALIAS_PAIRS[i];
      const destination = ALIAS_PAIRS[i + 1];
      if (raw[source] > raw[destination]) raw[destination] = raw[source];
    }

    this.resolveButtons(dt);

    const keyboardActive = this.keyboard.anyActivity;
    if (padActive && !this.padWasActive) this.lastDeviceValue = "gamepad";
    else if (keyboardActive && !this.keyboardWasActive) this.lastDeviceValue = "keyboard";
    else if (padActive) this.lastDeviceValue = "gamepad";
    else if (keyboardActive) this.lastDeviceValue = "keyboard";
    this.padWasActive = padActive;
    this.keyboardWasActive = keyboardActive;
    this.keyboard.endFrame();

    this.snap.lastDevice = this.lastDeviceValue;
    this.snap.gamepadConnected = this.connectedValue;
    this.snap.frame++;
  }

  /** The snapshot for the current frame. Valid until the next poll(). */
  snapshot(): InputSnapshot {
    return this.snap;
  }

  /** True when a gamepad is present and reporting. */
  get connected(): boolean {
    return this.connectedValue;
  }

  /** Set by the "Press Cross" splash once a user gesture has occurred. */
  get acquired(): boolean {
    return this.acquiredValue;
  }

  markAcquired(): void {
    this.acquiredValue = true;
  }

  /** Fires when a pad connects/disconnects, so the game can pause. */
  onConnectionChange(listener: ConnectionListener): () => void {
    this.connectionListeners.push(listener);
    let live = true;
    return () => {
      if (!live) return;
      live = false;
      const index = this.connectionListeners.indexOf(listener);
      if (index >= 0) this.connectionListeners.splice(index, 1);
    };
  }

  /** Non-standard mapping detected -> the game should offer calibration. */
  get needsCalibration(): boolean {
    return this.needsCalibrationValue;
  }

  get gamepadId(): string {
    return this.gamepadIdValue;
  }

  /** Active layout id, for the calibration screen and prompt glyphs. */
  get profileId(): string {
    return this.profile.id;
  }

  /** Blueprint slot requested on the number row, or -1. Keyboard only. */
  get blueprintSlot(): number {
    return this.keyboard.blueprintSlot;
  }

  setDeadZone(value: number): void {
    this.deadZone = Math.min(0.9, Math.max(0, value));
  }

  setResponseCurve(value: number): void {
    this.curve = Math.min(4, Math.max(0.2, value));
  }

  /** Feature-detected rumble. Silently no-ops when unsupported. */
  rumble(strong: number, weak: number, durationMs: number): void {
    if (!this.vibrationEnabled || !this.connectedValue) return;
    const pad = this.liveGamepad as HapticsCapableGamepad | null;
    const actuator = pad?.vibrationActuator;
    if (!actuator || typeof actuator.playEffect !== "function") return;
    try {
      const effect = actuator.playEffect("dual-rumble", {
        startDelay: 0,
        duration: Math.max(0, durationMs),
        strongMagnitude: Math.min(1, Math.max(0, strong)),
        weakMagnitude: Math.min(1, Math.max(0, weak)),
      });
      if (effect && typeof effect.catch === "function") effect.catch(noop);
    } catch {
      this.vibrationEnabled = false;
    }
  }

  setVibrationEnabled(enabled: boolean): void {
    this.vibrationEnabled = enabled;
  }

  /** Test seam: inject a synthetic gamepad reading. */
  injectGamepadForTest(reading: RawGamepadReading | null): void {
    this.injecting = true;
    this.injected = reading;
    this.liveGamepad = null;
  }

  private readGamepad(): RawGamepadReading | null {
    if (this.injecting) return this.injected;
    const nav = typeof navigator !== "undefined" ? navigator : null;
    if (!nav || typeof nav.getGamepads !== "function") return null;
    const pads = nav.getGamepads();
    if (!pads) return null;

    let chosen: Gamepad | null = null;
    if (this.padIndex >= 0 && this.padIndex < pads.length) {
      const preferred = pads[this.padIndex];
      if (preferred && preferred.connected) chosen = preferred;
    }
    if (!chosen) {
      for (let i = 0; i < pads.length; i++) {
        const pad = pads[i];
        if (pad && pad.connected) {
          chosen = pad;
          this.padIndex = i;
          break;
        }
      }
    }
    if (!chosen) {
      this.padIndex = -1;
      this.liveGamepad = null;
      return null;
    }
    this.liveGamepad = chosen;
    return chosen as unknown as RawGamepadReading;
  }

  private ensureProfile(reading: RawGamepadReading): void {
    const signature = reading.mapping + " " + reading.id;
    if (signature === this.profiledSignature) return;
    this.profiledSignature = signature;
    const found = findProfile(reading);
    this.needsCalibrationValue = found === null;
    const next = found ?? STANDARD_PROFILE;
    if (next !== this.profile) this.compileProfile(next);
  }

  private compileProfile(profile: GamepadProfile): void {
    this.profile = profile;
    const map = profile.buttonMap;
    let highest = -1;
    for (const key in map) {
      const index = Number(key);
      if (index > highest) highest = index;
    }
    const hat = profile.dpadHat;
    if (hat) {
      for (let i = 0; i < hat.buttons.length; i++) {
        if (hat.buttons[i] > highest) highest = hat.buttons[i];
      }
    }
    const size = highest + 1;
    this.buttonAction = new Int16Array(size).fill(-1);
    this.buttonAnalog = new Uint8Array(size);
    for (const key in map) {
      const index = Number(key);
      if (index < 0 || index >= size) continue;
      const action = map[index];
      if (action) this.buttonAction[index] = ACTION_INDEX[action];
    }
    for (let i = 0; i < profile.analogButtons.length; i++) {
      const index = profile.analogButtons[i];
      if (index >= 0 && index < size) this.buttonAnalog[index] = 1;
    }
    this.analogAction.fill(0);
    for (let i = 0; i < size; i++) {
      const action = this.buttonAction[i];
      if (action >= 0 && this.buttonAnalog[i]) this.analogAction[action] = 1;
    }
    for (let i = 0; i < ALIAS_PAIRS.length; i += 2) {
      if (this.analogAction[ALIAS_PAIRS[i]]) this.analogAction[ALIAS_PAIRS[i + 1]] = 1;
    }
    this.analogAction[MENU_UP] = 1;
    this.analogAction[MENU_DOWN] = 1;
    this.analogAction[MENU_LEFT] = 1;
    this.analogAction[MENU_RIGHT] = 1;
  }

  private readButtons(reading: RawGamepadReading, raw: Float32Array): boolean {
    const buttons = reading.buttons;
    const actions = this.buttonAction;
    const analog = this.buttonAnalog;
    const count = Math.min(buttons.length, actions.length);
    let active = false;
    for (let i = 0; i < count; i++) {
      const action = actions[i];
      if (action < 0) continue;
      const button = buttons[i];
      if (!button) continue;
      let value = analog[i]
        ? button.value
        : button.pressed || button.value >= DIGITAL_THRESHOLD
          ? 1
          : 0;
      if (!Number.isFinite(value)) value = 0;
      if (value > 1) value = 1;
      else if (value < 0) value = 0;
      if (value >= DIGITAL_THRESHOLD) active = true;
      if (value > raw[action]) raw[action] = value;
    }

    const hat = this.profile.dpadHat;
    if (hat) {
      const value = axisAt(reading.axes, hat.axis);
      if (value >= -HAT_NEUTRAL && value <= HAT_NEUTRAL) {
        const slot = Math.round((value + 1) * 3.5);
        const directions = HAT_SLOTS[slot];
        if (directions) {
          for (let i = 0; i < directions.length; i++) {
            const button = hat.buttons[directions[i]];
            const action = button < actions.length ? actions[button] : -1;
            if (action >= 0) {
              raw[action] = 1;
              active = true;
            }
          }
        }
      }
    }
    return active;
  }

  private readSticks(reading: RawGamepadReading): boolean {
    const profile = this.profile;
    const left = this.writeStick(
      this.snap.leftStick,
      axisAt(reading.axes, profile.leftStickAxes[0]),
      axisAt(reading.axes, profile.leftStickAxes[1]),
    );
    const right = this.writeStick(
      this.snap.rightStick,
      axisAt(reading.axes, profile.rightStickAxes[0]),
      axisAt(reading.axes, profile.rightStickAxes[1]),
    );
    return left || right;
  }

  private writeStick(stick: StickState, x: number, y: number): boolean {
    applyRadialDeadZone(x, y, this.deadZone, stickScratch);
    const magnitude = stickScratch.magnitude;
    if (magnitude <= 0) {
      this.resetStick(stick);
      return false;
    }
    const curved = applyResponseCurve(magnitude, this.curve);
    const scale = curved / magnitude;
    stick.x = stickScratch.x * scale;
    stick.y = stickScratch.y * scale;
    stick.magnitude = curved > 1 ? 1 : curved;
    stick.active = true;
    return true;
  }

  private resetStick(stick: StickState): void {
    stick.x = 0;
    stick.y = 0;
    stick.magnitude = 0;
    stick.active = false;
  }

  private applyKeyboardSticks(): void {
    if (!this.snap.leftStick.active) {
      const moveX = this.keyboard.moveX;
      const moveY = this.keyboard.moveY;
      if (moveX !== 0 || moveY !== 0) {
        const length = Math.hypot(moveX, moveY);
        this.writeStick(this.snap.leftStick, moveX / length, moveY / length);
      }
    }
    if (!this.snap.rightStick.active && this.keyboard.pointerActive) {
      let x = this.keyboard.pointerX;
      let y = -this.keyboard.pointerY;
      const length = Math.hypot(x, y);
      if (length > 1) {
        x /= length;
        y /= length;
      }
      this.writeStick(this.snap.rightStick, x, y);
    }
  }

  /** The left stick navigates menus, with the same hysteresis as a trigger. */
  private applyStickMenuNavigation(): void {
    const raw = this.raw;
    const stick = this.snap.leftStick;
    if (!stick.active) return;
    const up = -stick.y;
    const right = stick.x;
    if (up > raw[MENU_UP]) raw[MENU_UP] = up;
    if (-up > raw[MENU_DOWN]) raw[MENU_DOWN] = -up;
    if (right > raw[MENU_RIGHT]) raw[MENU_RIGHT] = right;
    if (-right > raw[MENU_LEFT]) raw[MENU_LEFT] = -right;
  }

  private resolveButtons(dt: number): void {
    const raw = this.raw;
    const states = this.states;
    for (let i = 0; i < ACTION_COUNT; i++) {
      const state = states[i];
      const value = raw[i];
      const wasDown = state.held;
      const threshold = wasDown
        ? this.analogAction[i]
          ? TRIGGER_RELEASE_THRESHOLD
          : DIGITAL_THRESHOLD
        : this.analogAction[i]
          ? TRIGGER_PRESS_THRESHOLD
          : DIGITAL_THRESHOLD;
      const down = value >= threshold;
      state.pressed = down && !wasDown;
      state.released = !down && wasDown;
      state.held = down;
      state.heldFor = down ? (wasDown ? state.heldFor + dt : 0) : 0;
      state.value = this.analogAction[i] ? value : down ? 1 : 0;
    }
  }

  private setConnected(connected: boolean, id: string): void {
    if (connected) this.gamepadIdValue = id;
    if (connected === this.connectedValue) return;
    this.connectedValue = connected;
    if (!connected) {
      this.needsCalibrationValue = false;
      this.padWasActive = false;
      this.padIndex = -1;
      this.profiledSignature = "";
      this.liveGamepad = null;
    } else if (this.lastDeviceValue === "none") {
      this.lastDeviceValue = "gamepad";
    }
    const listeners = this.connectionListeners;
    for (let i = 0; i < listeners.length; i++) listeners[i](connected, this.gamepadIdValue);
  }

  private readonly handleGamepadConnected = (event: Event): void => {
    const pad = (event as GamepadEvent).gamepad;
    if (pad) this.padIndex = pad.index;
  };

  private readonly handleGamepadDisconnected = (event: Event): void => {
    const pad = (event as GamepadEvent).gamepad;
    if (pad && pad.index === this.padIndex) this.padIndex = -1;
  };
}

function noop(): void {
  /* rumble failures are never fatal */
}
