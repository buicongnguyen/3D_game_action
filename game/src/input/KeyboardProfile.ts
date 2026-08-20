/**
 * Keyboard and mouse fallback. The game is designed for a DualShock 4; this
 * exists so development, automated browser checks, and anyone without a pad
 * can still reach every action.
 *
 * Key state is accumulated by event, never polled, so `applyTo` is a flat
 * array copy with no allocation.
 */

import { ALL_ACTIONS } from "./InputActions.ts";
import type { InputAction } from "./InputActions.ts";

/**
 * Keyed by `KeyboardEvent.code`, plus the synthetic codes `Mouse0`..`Mouse4`
 * for mouse buttons. Several codes may share one action.
 */
export const KEYBOARD_BINDINGS: Readonly<Record<string, InputAction>> = {
  KeyW: "menuUp",
  KeyA: "menuLeft",
  KeyS: "menuDown",
  KeyD: "menuRight",
  ArrowUp: "menuUp",
  ArrowDown: "menuDown",
  ArrowLeft: "menuLeft",
  ArrowRight: "menuRight",

  KeyE: "confirm",
  Enter: "menuConfirm",
  NumpadEnter: "menuConfirm",
  Space: "cancel",
  Backspace: "menuBack",

  KeyR: "service",
  KeyF: "fold",
  KeyQ: "buildRadial",
  Tab: "overlay",
  KeyM: "map",

  KeyV: "tool",
  Mouse2: "tool",
  KeyB: "weaponNext",
  Mouse0: "focusFire",

  ShiftLeft: "overdrive",
  ShiftRight: "overdrive",
  KeyC: "recenter",
  Escape: "pause",

  KeyZ: "blueprintPrev",
  KeyX: "blueprintNext",
  BracketLeft: "blueprintPrev",
  BracketRight: "blueprintNext",
};

/** Direct blueprint selection, which has no equivalent gamepad action. */
export const KEYBOARD_BLUEPRINT_SLOTS: Readonly<Partial<Record<string, number>>> = {
  Digit1: 0,
  Digit2: 1,
  Digit3: 2,
  Digit4: 3,
  Digit5: 4,
};

const MOVE_UP = "KeyW";
const MOVE_DOWN = "KeyS";
const MOVE_LEFT = "KeyA";
const MOVE_RIGHT = "KeyD";

const MOUSE_CODES: readonly string[] = ["Mouse0", "Mouse1", "Mouse2", "Mouse3", "Mouse4"];

const TEXT_ENTRY_TAGS: readonly string[] = ["INPUT", "TEXTAREA", "SELECT"];

function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!element || typeof element.tagName !== "string") return false;
  if (element.isContentEditable === true) return true;
  return TEXT_ENTRY_TAGS.includes(element.tagName);
}

export class KeyboardProfile {
  private readonly values = new Float32Array(ALL_ACTIONS.length);
  private readonly localIndex: Record<string, number> = {};
  private readonly codeToLocal = new Map<string, number>();
  private readonly codesForAction: string[][] = [];
  private readonly down = new Set<string>();

  private remap = new Int16Array(0);
  private remapSource: Readonly<Record<string, number>> | null = null;

  private target: Window | null = null;
  private pointerActivity = false;
  private keyActivity = false;

  private moveUp = false;
  private moveDown = false;
  private moveLeft = false;
  private moveRight = false;

  private slot = -1;

  private pointerXValue = 0;
  private pointerYValue = 0;
  private pointerActiveValue = false;

  constructor() {
    for (let i = 0; i < ALL_ACTIONS.length; i++) {
      this.localIndex[ALL_ACTIONS[i]] = i;
      this.codesForAction.push([]);
    }
    for (const code in KEYBOARD_BINDINGS) {
      const index = this.localIndex[KEYBOARD_BINDINGS[code]];
      this.codeToLocal.set(code, index);
      this.codesForAction[index].push(code);
    }
  }

  attach(target: Window): void {
    if (this.target) this.detach();
    this.target = target;
    target.addEventListener("keydown", this.handleKeyDown);
    target.addEventListener("keyup", this.handleKeyUp);
    target.addEventListener("mousemove", this.handleMouseMove);
    target.addEventListener("mousedown", this.handleMouseDown);
    target.addEventListener("mouseup", this.handleMouseUp);
    target.addEventListener("contextmenu", this.handleContextMenu);
    target.addEventListener("blur", this.handleBlur);
  }

  detach(): void {
    const target = this.target;
    if (!target) return;
    target.removeEventListener("keydown", this.handleKeyDown);
    target.removeEventListener("keyup", this.handleKeyUp);
    target.removeEventListener("mousemove", this.handleMouseMove);
    target.removeEventListener("mousedown", this.handleMouseDown);
    target.removeEventListener("mouseup", this.handleMouseUp);
    target.removeEventListener("contextmenu", this.handleContextMenu);
    target.removeEventListener("blur", this.handleBlur);
    this.target = null;
    this.clear();
  }

  /** Writes current key state into the snapshot's raw button values. */
  applyTo(raw: Float32Array, actionIndex: Readonly<Record<string, number>>): void {
    if (actionIndex !== this.remapSource) this.rebuildRemap(actionIndex);
    const remap = this.remap;
    for (let i = 0; i < remap.length; i++) {
      const destination = remap[i];
      if (destination < 0) continue;
      const value = this.values[i];
      if (value > raw[destination]) raw[destination] = value;
    }
  }

  /** True while any key is down or the mouse moved since the last frame end. */
  get anyActivity(): boolean {
    return this.keyActivity || this.pointerActivity || this.down.size > 0;
  }

  /** Clears the one-frame pointer/key activity edge. Called once per poll. */
  endFrame(): void {
    this.pointerActivity = false;
    this.keyActivity = false;
  }

  /** Pointer direction in NDC, used as the keyboard aim/ghost stick. */
  get pointerX(): number {
    return this.pointerXValue;
  }

  get pointerY(): number {
    return this.pointerYValue;
  }

  get pointerActive(): boolean {
    return this.pointerActiveValue;
  }

  /** WASD movement in gamepad axis convention, where -1 on Y is forward. */
  get moveX(): number {
    return (this.moveRight ? 1 : 0) - (this.moveLeft ? 1 : 0);
  }

  get moveY(): number {
    return (this.moveDown ? 1 : 0) - (this.moveUp ? 1 : 0);
  }

  /** Blueprint slot held on the number row, or -1. */
  get blueprintSlot(): number {
    return this.slot;
  }

  /** Drops all held state, so an alt-tab cannot leave a key stuck down. */
  clear(): void {
    this.down.clear();
    this.values.fill(0);
    this.moveUp = false;
    this.moveDown = false;
    this.moveLeft = false;
    this.moveRight = false;
    this.slot = -1;
  }

  private rebuildRemap(actionIndex: Readonly<Record<string, number>>): void {
    if (this.remap.length !== ALL_ACTIONS.length) {
      this.remap = new Int16Array(ALL_ACTIONS.length);
    }
    for (let i = 0; i < ALL_ACTIONS.length; i++) {
      const destination = actionIndex[ALL_ACTIONS[i]] as number | undefined;
      this.remap[i] = destination === undefined ? -1 : destination;
    }
    this.remapSource = actionIndex;
  }

  private press(code: string): void {
    if (this.down.has(code)) return;
    this.down.add(code);
    const index = this.codeToLocal.get(code);
    if (index !== undefined) this.values[index] = 1;
    const slot = KEYBOARD_BLUEPRINT_SLOTS[code];
    if (slot !== undefined) this.slot = slot;
    this.setMoveFlag(code, true);
    this.keyActivity = true;
  }

  private release(code: string): void {
    if (!this.down.delete(code)) return;
    const index = this.codeToLocal.get(code);
    if (index !== undefined) {
      const codes = this.codesForAction[index];
      let value = 0;
      for (let i = 0; i < codes.length; i++) {
        if (this.down.has(codes[i])) {
          value = 1;
          break;
        }
      }
      this.values[index] = value;
    }
    const slot = KEYBOARD_BLUEPRINT_SLOTS[code];
    if (slot !== undefined && this.slot === slot) this.slot = -1;
    this.setMoveFlag(code, false);
  }

  private setMoveFlag(code: string, value: boolean): void {
    if (code === MOVE_UP) this.moveUp = value;
    else if (code === MOVE_DOWN) this.moveDown = value;
    else if (code === MOVE_LEFT) this.moveLeft = value;
    else if (code === MOVE_RIGHT) this.moveRight = value;
  }

  private isBound(code: string): boolean {
    return this.codeToLocal.has(code) || KEYBOARD_BLUEPRINT_SLOTS[code] !== undefined;
  }

  private readonly handleKeyDown = (event: Event): void => {
    const keyEvent = event as KeyboardEvent;
    if (isTextEntryTarget(keyEvent.target)) return;
    const code = keyEvent.code;
    if (!this.isBound(code)) return;
    keyEvent.preventDefault();
    if (keyEvent.repeat) return;
    this.press(code);
  };

  private readonly handleKeyUp = (event: Event): void => {
    const keyEvent = event as KeyboardEvent;
    const code = keyEvent.code;
    if (!this.isBound(code)) return;
    keyEvent.preventDefault();
    this.release(code);
  };

  private readonly handleMouseMove = (event: Event): void => {
    const mouseEvent = event as MouseEvent;
    const target = this.target;
    if (!target) return;
    const width = target.innerWidth || 1;
    const height = target.innerHeight || 1;
    this.pointerXValue = (mouseEvent.clientX / width) * 2 - 1;
    this.pointerYValue = 1 - (mouseEvent.clientY / height) * 2;
    this.pointerActiveValue = true;
    this.pointerActivity = true;
  };

  private readonly handleMouseDown = (event: Event): void => {
    const mouseEvent = event as MouseEvent;
    if (isTextEntryTarget(mouseEvent.target)) return;
    const code = MOUSE_CODES[mouseEvent.button] as string | undefined;
    if (code === undefined || !this.isBound(code)) return;
    mouseEvent.preventDefault();
    this.pointerActivity = true;
    this.press(code);
  };

  private readonly handleMouseUp = (event: Event): void => {
    const mouseEvent = event as MouseEvent;
    const code = MOUSE_CODES[mouseEvent.button] as string | undefined;
    if (code === undefined || !this.isBound(code)) return;
    this.release(code);
  };

  private readonly handleContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private readonly handleBlur = (): void => {
    this.clear();
  };
}
