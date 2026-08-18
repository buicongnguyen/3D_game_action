/**
 * Semantic input vocabulary.
 *
 * Nothing outside `src/input/` may touch a physical button index or a key
 * code. Systems read an `InputSnapshot`, which is a value object valid for
 * exactly one fixed step.
 */

export const GAMEPLAY_ACTIONS = [
  "confirm", // Cross - interact, pick up, deliver, confirm placement
  "cancel", // Circle - dodge / cancel build
  "service", // Square (hold) - repair or refuel by context
  "fold", // Triangle (hold) - fold/recover structure
  "buildRadial", // L1 (hold) - open build radial
  "overlay", // L2 (hold) - maintenance/network/resource overlay
  "tool", // R1 - active engineering tool
  "focusFire", // R2 - focus auto-fire in the right-stick direction
  "overdrive", // D-pad up - toggle overdrive
  "blueprintPrev", // D-pad left
  "blueprintNext", // D-pad right
  "map", // Share - map and objective
  "pause", // Options
  "recenter", // R3 - recenter camera
] as const;

export type GameplayAction = (typeof GAMEPLAY_ACTIONS)[number];

export const MENU_ACTIONS = [
  "menuUp",
  "menuDown",
  "menuLeft",
  "menuRight",
  "menuConfirm",
  "menuBack",
  "menuTabPrev",
  "menuTabNext",
] as const;

export type MenuAction = (typeof MENU_ACTIONS)[number];

export type InputAction = GameplayAction | MenuAction;

/** Per-action edge state for the current fixed step. */
export interface ButtonState {
  /** True on the step the action crossed the press threshold. */
  pressed: boolean;
  /** True for every step the action is down. */
  held: boolean;
  /** True on the step the action crossed the release threshold. */
  released: boolean;
  /** Seconds the action has been continuously held; 0 when not held. */
  heldFor: number;
  /** Analog value in [0,1] for triggers; 0 or 1 for digital buttons. */
  value: number;
}

export interface StickState {
  x: number;
  /** Raw gamepad Y, where -1 is up. Movement code negates this. */
  y: number;
  /** Post-dead-zone magnitude in [0,1]. */
  magnitude: number;
  /** True when magnitude exceeds the dead zone. */
  active: boolean;
}

export type InputDevice = "gamepad" | "keyboard" | "none";

export interface InputSnapshot {
  leftStick: StickState;
  rightStick: StickState;
  /** Indexed by action name; always present for every action. */
  buttons: Readonly<Record<InputAction, ButtonState>>;
  /** Drives which glyph set the HUD shows. */
  lastDevice: InputDevice;
  gamepadConnected: boolean;
  /** Direct number-row blueprint selection, or -1 when none is held. */
  blueprintSlot: number;
  /** Monotonic counter, for detecting a stale snapshot in tests. */
  frame: number;
}

export function createButtonState(): ButtonState {
  return { pressed: false, held: false, released: false, heldFor: 0, value: 0 };
}

export function resetButtonState(state: ButtonState): void {
  state.pressed = false;
  state.held = false;
  state.released = false;
  state.heldFor = 0;
  state.value = 0;
}

export function createStickState(): StickState {
  return { x: 0, y: 0, magnitude: 0, active: false };
}

export const ALL_ACTIONS: readonly InputAction[] = [...GAMEPLAY_ACTIONS, ...MENU_ACTIONS];

export function createEmptySnapshot(): InputSnapshot {
  const buttons = {} as Record<InputAction, ButtonState>;
  for (const action of ALL_ACTIONS) buttons[action] = createButtonState();
  return {
    leftStick: createStickState(),
    rightStick: createStickState(),
    buttons,
    lastDevice: "none",
    gamepadConnected: false,
    blueprintSlot: -1,
    frame: 0,
  };
}

/**
 * Radial dead zone with magnitude rescaling, exactly as specified in the game
 * document. Applying it radially rather than per-axis is what stops diagonal
 * input from feeling snappier than cardinal input.
 */
export function applyRadialDeadZone(
  x: number,
  y: number,
  deadZone: number,
  out: { x: number; y: number; magnitude: number },
): void {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= deadZone) {
    out.x = 0;
    out.y = 0;
    out.magnitude = 0;
    return;
  }
  const scaled = Math.min(1, (magnitude - deadZone) / (1 - deadZone));
  out.x = (x / magnitude) * scaled;
  out.y = (y / magnitude) * scaled;
  out.magnitude = scaled;
}

/**
 * Response curve applied to a post-dead-zone magnitude. `exponent` of 1 is
 * linear; higher values give finer control near the centre.
 */
export function applyResponseCurve(magnitude: number, exponent: number): number {
  if (exponent === 1) return magnitude;
  return Math.pow(magnitude, exponent);
}

/** Press/release hysteresis for analog triggers, per the input requirements. */
export const TRIGGER_PRESS_THRESHOLD = 0.5;
export const TRIGGER_RELEASE_THRESHOLD = 0.35;
