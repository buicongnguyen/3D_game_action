import { describe, expect, it } from "vitest";

import { InputManager } from "../src/input/InputManager.ts";
import {
  findProfile,
  isStandardMapping,
  selectProfile,
  STANDARD_PROFILE,
} from "../src/input/GamepadProfile.ts";
import type { RawGamepadReading } from "../src/input/GamepadProfile.ts";
import { DUALSHOCK4_PROFILE } from "../src/input/DualShockProfile.ts";
import { KEYBOARD_BINDINGS } from "../src/input/KeyboardProfile.ts";
import { GAMEPLAY_ACTIONS } from "../src/input/InputActions.ts";

const STEP = 1 / 60;

function makeButtons(count: number): { pressed: boolean; value: number }[] {
  const buttons: { pressed: boolean; value: number }[] = [];
  for (let i = 0; i < count; i++) buttons.push({ pressed: false, value: 0 });
  return buttons;
}

function makeReading(
  overrides?: Partial<Pick<RawGamepadReading, "id" | "mapping">>,
): RawGamepadReading {
  return {
    id: overrides?.id ?? "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)",
    mapping: overrides?.mapping ?? "standard",
    axes: [0, 0, 0, 0],
    buttons: makeButtons(17),
    connected: true,
  };
}

function setAxis(reading: RawGamepadReading, index: number, value: number): void {
  (reading.axes as number[])[index] = value;
}

function setButton(reading: RawGamepadReading, index: number, value: number): void {
  const button = reading.buttons[index] as { pressed: boolean; value: number };
  button.value = value;
  button.pressed = value >= 0.5;
}

function bootManager(reading: RawGamepadReading | null): InputManager {
  const manager = new InputManager();
  manager.injectGamepadForTest(reading);
  return manager;
}

describe("dead zone", () => {
  it("rejects input below the threshold", () => {
    const reading = makeReading();
    const manager = bootManager(reading);
    setAxis(reading, 0, 0.17);
    manager.poll(STEP);
    const stick = manager.snapshot().leftStick;
    expect(stick.active).toBe(false);
    expect(stick.magnitude).toBe(0);
    expect(stick.x).toBe(0);
  });

  it("rescales magnitude above the threshold", () => {
    const reading = makeReading();
    const manager = bootManager(reading);
    setAxis(reading, 0, 0.59);
    manager.poll(STEP);
    const stick = manager.snapshot().leftStick;
    expect(stick.active).toBe(true);
    expect(stick.magnitude).toBeCloseTo(0.5, 5);
    expect(stick.x).toBeCloseTo(0.5, 5);
  });

  it("is configurable at runtime", () => {
    const reading = makeReading();
    const manager = bootManager(reading);
    setAxis(reading, 0, 0.3);
    manager.poll(STEP);
    expect(manager.snapshot().leftStick.active).toBe(true);
    manager.setDeadZone(0.5);
    manager.poll(STEP);
    expect(manager.snapshot().leftStick.active).toBe(false);
  });

  it("keeps diagonal magnitude at or below one", () => {
    const reading = makeReading();
    const manager = bootManager(reading);
    for (const value of [0.4, 0.7, 1]) {
      setAxis(reading, 0, value);
      setAxis(reading, 1, value);
      manager.poll(STEP);
      const stick = manager.snapshot().leftStick;
      expect(stick.magnitude).toBeLessThanOrEqual(1);
      expect(Math.hypot(stick.x, stick.y)).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it("treats cardinal and diagonal input at full deflection alike", () => {
    const reading = makeReading();
    const manager = bootManager(reading);
    setAxis(reading, 0, 1);
    manager.poll(STEP);
    const cardinal = manager.snapshot().leftStick.magnitude;
    setAxis(reading, 1, 1);
    manager.poll(STEP);
    expect(manager.snapshot().leftStick.magnitude).toBeCloseTo(cardinal, 6);
  });
});

describe("response curve", () => {
  it("is monotonic and preserves the endpoints", () => {
    const reading = makeReading();
    const manager = bootManager(reading);
    manager.setResponseCurve(2);
    let previous = -1;
    for (const value of [0.19, 0.3, 0.45, 0.6, 0.75, 0.9, 1]) {
      setAxis(reading, 0, value);
      manager.poll(STEP);
      const magnitude = manager.snapshot().leftStick.magnitude;
      expect(magnitude).toBeGreaterThan(previous);
      expect(magnitude).toBeLessThanOrEqual(1);
      previous = magnitude;
    }
    expect(previous).toBeCloseTo(1, 6);
  });

  it("squares the post-dead-zone magnitude at exponent two", () => {
    const reading = makeReading();
    const manager = bootManager(reading);
    manager.setResponseCurve(2);
    setAxis(reading, 0, 0.59);
    manager.poll(STEP);
    const stick = manager.snapshot().leftStick;
    expect(stick.magnitude).toBeCloseTo(0.25, 5);
    expect(stick.x).toBeCloseTo(0.25, 5);
  });
});

describe("button edges", () => {
  it("fires pressed exactly once, on the step that consumes it", () => {
    const reading = makeReading();
    const manager = bootManager(reading);
    manager.poll(STEP);
    expect(manager.snapshot().buttons.confirm.pressed).toBe(false);
    manager.endStep();

    setButton(reading, 0, 1);
    manager.poll(STEP);
    expect(manager.snapshot().buttons.confirm.pressed).toBe(true);
    expect(manager.snapshot().buttons.confirm.held).toBe(true);
    manager.endStep();

    manager.poll(STEP);
    expect(manager.snapshot().buttons.confirm.pressed).toBe(false);
    expect(manager.snapshot().buttons.confirm.held).toBe(true);
  });

  it("holds a press across frames that run no fixed step", () => {
    // The edge used to be recomputed on every poll, so a press landing on a
    // frame whose accumulator never reached a full step was erased by the next
    // poll before any system read it. At 144 Hz that is 58% of frames, which
    // silently swallowed half of every confirm, dodge and pause in the game.
    const reading = makeReading();
    const manager = bootManager(reading);
    manager.poll(STEP);
    manager.endStep();

    setButton(reading, 0, 1);
    manager.poll(STEP); // the frame the button went down - no step runs
    manager.poll(STEP); // still no step, button still held
    manager.poll(STEP);

    expect(manager.snapshot().buttons.confirm.pressed).toBe(true);
    manager.endStep();
    expect(manager.snapshot().buttons.confirm.pressed).toBe(false);
  });

  it("never hands the same press to two steps", () => {
    // The mirror failure: a frame running two or more steps replayed the edge,
    // so pause opened and closed within one frame and overdrive toggled off again.
    const reading = makeReading();
    const manager = bootManager(reading);
    setButton(reading, 0, 1);
    manager.poll(STEP);

    expect(manager.snapshot().buttons.confirm.pressed).toBe(true);
    manager.endStep();
    expect(manager.snapshot().buttons.confirm.pressed).toBe(false);
    manager.endStep();
    expect(manager.snapshot().buttons.confirm.pressed).toBe(false);
  });

  it("keeps a tap that goes down and up between two steps", () => {
    // A quick tap can begin and end inside one rendered frame. Both edges have
    // to survive to the next step or the input is lost entirely.
    const reading = makeReading();
    const manager = bootManager(reading);
    manager.poll(STEP);
    manager.endStep();

    setButton(reading, 0, 1);
    manager.poll(STEP);
    setButton(reading, 0, 0);
    manager.poll(STEP);

    const state = manager.snapshot().buttons.confirm;
    expect(state.pressed).toBe(true);
    expect(state.released).toBe(true);
  });

  it("fires released exactly once, on the step that consumes it", () => {
    const reading = makeReading();
    const manager = bootManager(reading);
    setButton(reading, 0, 1);
    manager.poll(STEP);
    manager.endStep();
    setButton(reading, 0, 0);
    manager.poll(STEP);
    expect(manager.snapshot().buttons.confirm.released).toBe(true);
    expect(manager.snapshot().buttons.confirm.held).toBe(false);
    manager.endStep();
    manager.poll(STEP);
    expect(manager.snapshot().buttons.confirm.released).toBe(false);
  });

  it("accumulates heldFor and resets it on release", () => {
    const reading = makeReading();
    const manager = bootManager(reading);
    setButton(reading, 2, 1);
    manager.poll(0.1);
    expect(manager.snapshot().buttons.service.heldFor).toBeCloseTo(0, 6);
    manager.poll(0.1);
    expect(manager.snapshot().buttons.service.heldFor).toBeCloseTo(0.1, 6);
    manager.poll(0.1);
    expect(manager.snapshot().buttons.service.heldFor).toBeCloseTo(0.2, 6);
    setButton(reading, 2, 0);
    manager.poll(0.1);
    expect(manager.snapshot().buttons.service.heldFor).toBe(0);
  });

  it("mirrors gameplay buttons onto their menu counterparts", () => {
    const reading = makeReading();
    const manager = bootManager(reading);
    setButton(reading, 0, 1);
    manager.poll(STEP);
    expect(manager.snapshot().buttons.menuConfirm.pressed).toBe(true);
    setButton(reading, 0, 0);
    setButton(reading, 1, 1);
    manager.poll(STEP);
    expect(manager.snapshot().buttons.menuBack.pressed).toBe(true);
  });

  it("routes the D-pad to both blueprint and menu actions", () => {
    const reading = makeReading();
    const manager = bootManager(reading);
    setButton(reading, 14, 1);
    setButton(reading, 13, 1);
    manager.poll(STEP);
    const buttons = manager.snapshot().buttons;
    expect(buttons.blueprintPrev.pressed).toBe(true);
    expect(buttons.menuLeft.pressed).toBe(true);
    expect(buttons.menuDown.pressed).toBe(true);
  });
});

describe("analog trigger hysteresis", () => {
  it("does not chatter between the release and press thresholds", () => {
    const reading = makeReading();
    const manager = bootManager(reading);

    setButton(reading, 7, 0.49);
    manager.poll(STEP);
    expect(manager.snapshot().buttons.focusFire.held).toBe(false);

    setButton(reading, 7, 0.8);
    manager.poll(STEP);
    expect(manager.snapshot().buttons.focusFire.pressed).toBe(true);

    manager.endStep();

    for (const value of [0.36, 0.49, 0.36, 0.49, 0.4]) {
      setButton(reading, 7, value);
      manager.poll(STEP);
      const state = manager.snapshot().buttons.focusFire;
      expect(state.held).toBe(true);
      expect(state.pressed).toBe(false);
      expect(state.released).toBe(false);
      expect(state.value).toBeCloseTo(value, 6);
      manager.endStep();
    }

    setButton(reading, 7, 0.2);
    manager.poll(STEP);
    expect(manager.snapshot().buttons.focusFire.released).toBe(true);
    expect(manager.snapshot().buttons.focusFire.held).toBe(false);
  });
});

describe("profile selection", () => {
  it("uses the standard profile for standard mapping", () => {
    const reading = makeReading();
    expect(isStandardMapping(reading)).toBe(true);
    expect(selectProfile(reading)).toBe(STANDARD_PROFILE);
    const manager = bootManager(reading);
    manager.poll(STEP);
    expect(manager.profileId).toBe("standard");
    expect(manager.needsCalibration).toBe(false);
  });

  it("falls back to the DualShock profile for an empty mapping with a Sony id", () => {
    const reading = makeReading({ mapping: "", id: "054c-09cc-Wireless Controller" });
    expect(isStandardMapping(reading)).toBe(false);
    expect(selectProfile(reading)).toBe(DUALSHOCK4_PROFILE);
    const manager = bootManager(reading);
    manager.poll(STEP);
    expect(manager.profileId).toBe("dualshock4");
    expect(manager.needsCalibration).toBe(false);
  });

  it("maps the DualShock face buttons through the fallback layout", () => {
    const reading = makeReading({ mapping: "", id: "DualShock 4 Wireless Controller" });
    const manager = bootManager(reading);
    setButton(reading, 1, 1);
    manager.poll(STEP);
    expect(manager.snapshot().buttons.confirm.pressed).toBe(true);
    expect(manager.snapshot().buttons.service.pressed).toBe(false);
  });

  it("reads the D-pad hat axis on the fallback layout", () => {
    const reading: RawGamepadReading = {
      id: "054c Wireless Controller",
      mapping: "",
      axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857],
      buttons: makeButtons(14),
      connected: true,
    };
    const manager = bootManager(reading);
    manager.poll(STEP);
    expect(manager.snapshot().buttons.overdrive.held).toBe(false);
    setAxis(reading, 9, -1);
    manager.poll(STEP);
    expect(manager.snapshot().buttons.overdrive.pressed).toBe(true);
  });

  it("reports needsCalibration for an unknown pad", () => {
    const reading = makeReading({ mapping: "", id: "Frobnicator Arcade Stick" });
    expect(findProfile(reading)).toBeNull();
    expect(selectProfile(reading)).toBe(STANDARD_PROFILE);
    const manager = bootManager(reading);
    manager.poll(STEP);
    expect(manager.needsCalibration).toBe(true);
  });
});

describe("connection and device tracking", () => {
  it("notifies listeners once per transition", () => {
    const reading = makeReading();
    const manager = new InputManager();
    const events: boolean[] = [];
    const unsubscribe = manager.onConnectionChange((connected) => events.push(connected));

    manager.injectGamepadForTest(null);
    manager.poll(STEP);
    expect(manager.connected).toBe(false);

    manager.injectGamepadForTest(reading);
    manager.poll(STEP);
    manager.poll(STEP);
    expect(manager.connected).toBe(true);
    expect(events).toEqual([true]);

    manager.injectGamepadForTest(null);
    manager.poll(STEP);
    manager.poll(STEP);
    expect(manager.connected).toBe(false);
    expect(events).toEqual([true, false]);

    unsubscribe();
    manager.injectGamepadForTest(reading);
    manager.poll(STEP);
    expect(events).toEqual([true, false]);
  });

  it("switches lastDevice to gamepad on activity above the dead zone", () => {
    const reading = makeReading();
    const manager = bootManager(reading);
    manager.poll(STEP);
    setAxis(reading, 0, 0.9);
    manager.poll(STEP);
    expect(manager.snapshot().lastDevice).toBe("gamepad");
  });

  it("requires an explicit gesture before it reports acquired", () => {
    const manager = bootManager(makeReading());
    manager.poll(STEP);
    expect(manager.acquired).toBe(false);
    manager.markAcquired();
    expect(manager.acquired).toBe(true);
  });

  it("reuses the same snapshot object between frames", () => {
    const manager = bootManager(makeReading());
    manager.poll(STEP);
    const first = manager.snapshot();
    const firstStick = first.leftStick;
    manager.poll(STEP);
    expect(manager.snapshot()).toBe(first);
    expect(manager.snapshot().leftStick).toBe(firstStick);
    expect(manager.snapshot().frame).toBe(2);
  });

  it("clears the sticks when the pad vanishes", () => {
    const reading = makeReading();
    const manager = bootManager(reading);
    setAxis(reading, 0, 1);
    setButton(reading, 0, 1);
    manager.poll(STEP);
    expect(manager.snapshot().leftStick.active).toBe(true);
    manager.injectGamepadForTest(null);
    manager.poll(STEP);
    expect(manager.snapshot().leftStick.active).toBe(false);
    expect(manager.snapshot().buttons.confirm.released).toBe(true);
    expect(manager.snapshot().gamepadConnected).toBe(false);
  });

  it("never throws when rumble is unsupported", () => {
    const manager = bootManager(makeReading());
    manager.poll(STEP);
    expect(() => manager.rumble(1, 0.5, 120)).not.toThrow();
    manager.setVibrationEnabled(false);
    expect(() => manager.rumble(1, 0.5, 120)).not.toThrow();
  });
});

describe("keyboard fallback", () => {
  it("binds every gameplay action", () => {
    const bound = new Set(Object.values(KEYBOARD_BINDINGS));
    for (const action of GAMEPLAY_ACTIONS) {
      expect(bound.has(action), `missing keyboard binding for ${action}`).toBe(true);
    }
  });

  it("binds menu navigation to both the arrow keys and WASD", () => {
    expect(KEYBOARD_BINDINGS.ArrowUp).toBe("menuUp");
    expect(KEYBOARD_BINDINGS.KeyW).toBe("menuUp");
    expect(KEYBOARD_BINDINGS.ArrowDown).toBe("menuDown");
    expect(KEYBOARD_BINDINGS.KeyS).toBe("menuDown");
    expect(KEYBOARD_BINDINGS.ArrowLeft).toBe("menuLeft");
    expect(KEYBOARD_BINDINGS.KeyA).toBe("menuLeft");
    expect(KEYBOARD_BINDINGS.ArrowRight).toBe("menuRight");
    expect(KEYBOARD_BINDINGS.KeyD).toBe("menuRight");
    expect(KEYBOARD_BINDINGS.Enter).toBe("menuConfirm");
    expect(KEYBOARD_BINDINGS.Backspace).toBe("menuBack");
  });

  it("stays idle when no window is attached", () => {
    const manager = bootManager(null);
    manager.poll(STEP);
    const snapshot = manager.snapshot();
    expect(snapshot.lastDevice).toBe("none");
    expect(snapshot.leftStick.active).toBe(false);
    expect(snapshot.buttons.confirm.held).toBe(false);
  });
});
