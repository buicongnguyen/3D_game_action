import { describe, expect, it } from "vitest";

import {
  FOCUS_REPEAT_DELAY_MS,
  FOCUS_REPEAT_RATE_MS,
  FocusManager,
  acceptRepeat,
  createRepeatState,
  nextFocusIndex,
  wrapIndex,
} from "../src/ui/FocusManager.ts";
import { RADIAL_DEAD_ZONE, radialIndexFromStick } from "../src/ui/RadialMenu.ts";
import { glyphFor } from "../src/ui/HudController.ts";
import {
  SETTINGS,
  adjustDelta,
  adjustSetting,
  findSetting,
  formatSetting,
  settingsScreenData,
} from "../src/ui/Screens.ts";
import { KEYBOARD_BINDINGS } from "../src/input/KeyboardProfile.ts";
import { createDefaultSave } from "../src/save/SaveSchema.ts";

/**
 * The suite runs in the node environment, so there is no DOM. FocusManager is
 * written against the small element surface stubbed here (classList, dataset,
 * focus, click) precisely so its behaviour can be tested headlessly.
 */
function makeElement() {
  const classes = new Set<string>();
  const counters = { clicks: 0, focuses: 0 };
  return {
    classes,
    counters,
    dataset: {} as Record<string, string>,
    classList: {
      add: (name: string) => {
        classes.add(name);
      },
      remove: (name: string) => {
        classes.delete(name);
      },
      contains: (name: string) => classes.has(name),
      toggle: (name: string, force?: boolean) => {
        const on = force === undefined ? !classes.has(name) : force;
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
    },
    click: () => {
      counters.clicks += 1;
    },
    focus: () => {
      counters.focuses += 1;
    },
  };
}

type StubElement = ReturnType<typeof makeElement>;

function asElement(stub: StubElement): HTMLElement {
  return stub as unknown as HTMLElement;
}

function makeGroup(count: number): StubElement[] {
  const items: StubElement[] = [];
  for (let i = 0; i < count; i++) items.push(makeElement());
  return items;
}

describe("wrapIndex", () => {
  it("wraps in both directions", () => {
    expect(wrapIndex(0, 4)).toBe(0);
    expect(wrapIndex(4, 4)).toBe(0);
    expect(wrapIndex(-1, 4)).toBe(3);
    expect(wrapIndex(-5, 4)).toBe(3);
    expect(wrapIndex(0, 0)).toBe(-1);
  });
});

describe("nextFocusIndex", () => {
  it("wraps a single-column list vertically", () => {
    expect(nextFocusIndex(0, 4, 0, 1, 1)).toBe(1);
    expect(nextFocusIndex(3, 4, 0, 1, 1)).toBe(0);
    expect(nextFocusIndex(0, 4, 0, -1, 1)).toBe(3);
  });

  it("treats horizontal input on a single-column list as a linear step", () => {
    expect(nextFocusIndex(0, 4, 1, 0, 1)).toBe(1);
    expect(nextFocusIndex(3, 4, 1, 0, 1)).toBe(0);
  });

  it("wraps a single-row card group horizontally", () => {
    expect(nextFocusIndex(0, 3, 1, 0, 3)).toBe(1);
    expect(nextFocusIndex(2, 3, 1, 0, 3)).toBe(0);
    expect(nextFocusIndex(0, 3, -1, 0, 3)).toBe(2);
  });

  it("treats vertical input on a single-row group as a linear step", () => {
    expect(nextFocusIndex(0, 3, 0, 1, 3)).toBe(1);
    expect(nextFocusIndex(2, 3, 0, 1, 3)).toBe(0);
  });

  it("moves by rows in a grid and skips absent cells", () => {
    // 5 items in 3 columns: row 0 = [0,1,2], row 1 = [3,4].
    expect(nextFocusIndex(0, 5, 0, 1, 3)).toBe(3);
    expect(nextFocusIndex(3, 5, 0, 1, 3)).toBe(0);
    // Column 2 has no cell in row 1, so the move finds no legal target.
    expect(nextFocusIndex(2, 5, 0, 1, 3)).toBe(2);
  });

  it("returns -1 for an empty group and clamps a stale index", () => {
    expect(nextFocusIndex(0, 0, 0, 1, 1)).toBe(-1);
    expect(nextFocusIndex(9, 3, 0, 0, 1)).toBe(0);
  });
});

describe("acceptRepeat", () => {
  it("accepts the first push, then waits out the initial delay", () => {
    const state = createRepeatState();
    expect(acceptRepeat(state, 0, 1, 0, 300, 100)).toBe(true);
    expect(acceptRepeat(state, 0, 1, 1, 300, 100)).toBe(false);
    expect(acceptRepeat(state, 0, 1, 299, 300, 100)).toBe(false);
    expect(acceptRepeat(state, 0, 1, 300, 300, 100)).toBe(true);
  });

  it("repeats at the repeat rate once repeating", () => {
    const state = createRepeatState();
    acceptRepeat(state, 0, 1, 0, 300, 100);
    acceptRepeat(state, 0, 1, 300, 300, 100);
    expect(acceptRepeat(state, 0, 1, 399, 300, 100)).toBe(false);
    expect(acceptRepeat(state, 0, 1, 400, 300, 100)).toBe(true);
    expect(acceptRepeat(state, 0, 1, 401, 300, 100)).toBe(false);
    expect(acceptRepeat(state, 0, 1, 500, 300, 100)).toBe(true);
  });

  it("rearms immediately on a direction change or a release", () => {
    const state = createRepeatState();
    expect(acceptRepeat(state, 0, 1, 0, 300, 100)).toBe(true);
    expect(acceptRepeat(state, 0, -1, 1, 300, 100)).toBe(true);
    expect(acceptRepeat(state, 0, -1, 2, 300, 100)).toBe(false);
    expect(acceptRepeat(state, 0, 0, 3, 300, 100)).toBe(false);
    expect(acceptRepeat(state, 0, -1, 3, 300, 100)).toBe(true);
  });

  it("ships a delay longer than its repeat rate", () => {
    expect(FOCUS_REPEAT_DELAY_MS).toBeGreaterThan(FOCUS_REPEAT_RATE_MS);
  });
});

describe("FocusManager", () => {
  function setup(count: number) {
    const clock = { now: 0 };
    const root = makeElement();
    const manager = new FocusManager(asElement(root), () => clock.now);
    const items = makeGroup(count);
    manager.setGroup(items.map(asElement));
    return { clock, root, manager, items };
  }

  it("focuses the first item and marks it", () => {
    const { manager, items } = setup(4);
    expect(manager.focusedIndex).toBe(0);
    expect(items[0].classes.has("is-focused")).toBe(true);
    expect(items[0].counters.focuses).toBe(1);
  });

  it("wraps past both ends of the list", () => {
    const { clock, manager } = setup(4);
    manager.move(0, -1);
    expect(manager.focusedIndex).toBe(3);
    clock.now += FOCUS_REPEAT_DELAY_MS + 1;
    manager.move(0, -1);
    expect(manager.focusedIndex).toBe(2);

    manager.setIndex(3);
    manager.move(0, 1);
    expect(manager.focusedIndex).toBe(0);
  });

  it("respects the repeat delay while a direction is held", () => {
    const { clock, manager } = setup(4);
    manager.move(0, 1);
    expect(manager.focusedIndex).toBe(1);

    clock.now += FOCUS_REPEAT_DELAY_MS - 1;
    manager.move(0, 1);
    expect(manager.focusedIndex).toBe(1);

    clock.now += 1;
    manager.move(0, 1);
    expect(manager.focusedIndex).toBe(2);

    clock.now += FOCUS_REPEAT_RATE_MS;
    manager.move(0, 1);
    expect(manager.focusedIndex).toBe(3);
  });

  it("rearms after the stick is released", () => {
    const { manager } = setup(4);
    manager.move(0, 1);
    expect(manager.focusedIndex).toBe(1);
    manager.move(0, 0);
    manager.move(0, 1);
    expect(manager.focusedIndex).toBe(2);
  });

  it("skips disabled entries", () => {
    const { manager, items } = setup(4);
    items[1].dataset.disabled = "true";
    items[2].dataset.disabled = "true";
    manager.move(0, 1);
    expect(manager.focusedIndex).toBe(3);
  });

  it("activates the focused item exactly once", () => {
    const { manager, items } = setup(3);
    manager.move(0, 1);
    manager.activate();
    expect(items[1].counters.clicks).toBe(1);
    expect(items[0].counters.clicks).toBe(0);
  });

  it("does not activate a disabled item", () => {
    const { manager, items } = setup(3);
    items[0].dataset.disabled = "true";
    manager.setGroup(items.map(asElement), 0);
    expect(manager.focusedIndex).toBe(1);
    manager.activate();
    expect(items[0].counters.clicks).toBe(0);
    expect(items[1].counters.clicks).toBe(1);
  });

  it("restores the previous group and index across push/pop", () => {
    const { manager, items } = setup(4);
    manager.move(0, 1);
    expect(manager.focusedIndex).toBe(1);

    manager.push();
    expect(manager.focused).toBe(null);
    expect(manager.focusedIndex).toBe(-1);
    expect(items[1].classes.has("is-focused")).toBe(false);

    const nested = makeGroup(2);
    manager.setGroup(nested.map(asElement));
    expect(manager.focusedIndex).toBe(0);

    manager.pop();
    expect(manager.focusedIndex).toBe(1);
    expect(manager.focused).toBe(asElement(items[1]));
    expect(items[1].classes.has("is-focused")).toBe(true);
    expect(nested[0].classes.has("is-focused")).toBe(false);
  });

  it("clear() empties the group", () => {
    const { manager, items } = setup(3);
    manager.clear();
    expect(manager.focusedIndex).toBe(-1);
    expect(manager.focused).toBe(null);
    expect(items[0].classes.has("is-focused")).toBe(false);
    manager.move(0, 1);
    expect(manager.focusedIndex).toBe(-1);
  });
});

describe("radialIndexFromStick", () => {
  const count = 4;

  it("maps the four cardinal directions clockwise from the top", () => {
    expect(radialIndexFromStick(0, -1, count, RADIAL_DEAD_ZONE, 0)).toBe(0);
    expect(radialIndexFromStick(1, 0, count, RADIAL_DEAD_ZONE, 0)).toBe(1);
    expect(radialIndexFromStick(0, 1, count, RADIAL_DEAD_ZONE, 0)).toBe(2);
    expect(radialIndexFromStick(-1, 0, count, RADIAL_DEAD_ZONE, 0)).toBe(3);
  });

  it("resolves every quadrant to the nearer slice", () => {
    // Upper right quadrant.
    expect(radialIndexFromStick(0.4, -0.9, count, RADIAL_DEAD_ZONE, 0)).toBe(0);
    expect(radialIndexFromStick(0.9, -0.4, count, RADIAL_DEAD_ZONE, 0)).toBe(1);
    // Lower right quadrant.
    expect(radialIndexFromStick(0.9, 0.4, count, RADIAL_DEAD_ZONE, 0)).toBe(1);
    expect(radialIndexFromStick(0.4, 0.9, count, RADIAL_DEAD_ZONE, 0)).toBe(2);
    // Lower left quadrant.
    expect(radialIndexFromStick(-0.4, 0.9, count, RADIAL_DEAD_ZONE, 0)).toBe(2);
    expect(radialIndexFromStick(-0.9, 0.4, count, RADIAL_DEAD_ZONE, 0)).toBe(3);
    // Upper left quadrant.
    expect(radialIndexFromStick(-0.9, -0.4, count, RADIAL_DEAD_ZONE, 0)).toBe(3);
    expect(radialIndexFromStick(-0.4, -0.9, count, RADIAL_DEAD_ZONE, 0)).toBe(0);
  });

  it("keeps the current selection inside the dead zone", () => {
    expect(radialIndexFromStick(0, 0, count, RADIAL_DEAD_ZONE, 2)).toBe(2);
    expect(radialIndexFromStick(0.2, -0.2, count, RADIAL_DEAD_ZONE, 2)).toBe(2);
    expect(radialIndexFromStick(0.34, 0, count, RADIAL_DEAD_ZONE, 3)).toBe(3);
    // Just outside the dead zone the mapping takes over again.
    expect(radialIndexFromStick(0.36, 0, count, RADIAL_DEAD_ZONE, 3)).toBe(1);
  });

  it("handles slice counts other than four", () => {
    expect(radialIndexFromStick(0, -1, 8, RADIAL_DEAD_ZONE, 0)).toBe(0);
    expect(radialIndexFromStick(1, -1, 8, RADIAL_DEAD_ZONE, 0)).toBe(1);
    expect(radialIndexFromStick(1, 0, 8, RADIAL_DEAD_ZONE, 0)).toBe(2);
    expect(radialIndexFromStick(-1, -1, 8, RADIAL_DEAD_ZONE, 0)).toBe(7);
    expect(radialIndexFromStick(0, -1, 3, RADIAL_DEAD_ZONE, 0)).toBe(0);
    expect(radialIndexFromStick(0, 1, 3, RADIAL_DEAD_ZONE, 0)).toBe(2);
    expect(radialIndexFromStick(0, -1, 0, RADIAL_DEAD_ZONE, 0)).toBe(-1);
  });
});

/**
 * Keyboard prompts must name the key that actually does the thing.
 *
 * An independent review found four that did not: tool and recenter were
 * transposed, focus fire advertised Shift (which is overdrive), and overdrive
 * advertised "1" (which is bound to nothing at all). A prompt that lies is
 * worse than no prompt — the player presses what they are told and the wrong
 * verb fires. Nothing was checking, so nothing caught it.
 */
describe("keyboard glyphs match the real bindings", () => {
  /** The key label the profile actually binds to an action. */
  function keysFor(action: string): string[] {
    const keys: string[] = [];
    for (const code in KEYBOARD_BINDINGS) {
      if (KEYBOARD_BINDINGS[code] === action) keys.push(code);
    }
    return keys;
  }

  const CASES: Array<{ token: string; action: string; codes: string[] }> = [
    { token: "service", action: "service", codes: ["KeyR"] },
    { token: "fold", action: "fold", codes: ["KeyF"] },
    { token: "buildRadial", action: "buildRadial", codes: ["KeyQ"] },
    { token: "overlay", action: "overlay", codes: ["Tab"] },
    { token: "tool", action: "tool", codes: ["KeyV"] },
    { token: "focusFire", action: "focusFire", codes: ["Mouse0"] },
    { token: "recenter", action: "recenter", codes: ["KeyC"] },
    { token: "overdrive", action: "overdrive", codes: ["ShiftLeft"] },
    { token: "pause", action: "pause", codes: ["Escape"] },
    { token: "map", action: "map", codes: ["KeyM"] },
  ];

  it("binds every prompted action to the key the prompt claims", () => {
    for (const testCase of CASES) {
      expect(keysFor(testCase.action)).toEqual(expect.arrayContaining(testCase.codes));
    }
  });

  it("shows a glyph whose text corresponds to that key", () => {
    // "KeyV" -> "V", "ShiftLeft" -> "SHIFT", "Mouse0" -> "LMB", "Escape" -> "ESC".
    const expected: Record<string, string> = {
      service: "R",
      fold: "F",
      buildRadial: "Q",
      overlay: "TAB",
      tool: "V",
      focusFire: "LMB",
      recenter: "C",
      overdrive: "SHIFT",
      pause: "ESC",
      map: "M",
    };
    for (const token in expected) {
      expect(glyphFor(token, "keyboard").text).toBe(expected[token]);
    }
  });

  it("has a glyph for every token the game actually asks for", () => {
    // The fallback renders the token itself, which produced a chip reading
    // "OPTIONS" on the pause screen. Any token in use must be in the table.
    const TOKENS_IN_USE = [
      "confirm", "cancel", "cross", "circle", "square", "triangle",
      "service", "fold", "buildRadial", "overlay", "tool", "focusFire",
      "recenter", "overdrive", "pause", "map", "blueprintPrev", "blueprintNext",
    ];
    for (const device of ["keyboard", "gamepad"]) {
      for (const token of TOKENS_IN_USE) {
        const glyph = glyphFor(token, device);
        expect(
          glyph.text,
          `token "${token}" has no glyph on ${device} and fell through to the fallback`,
        ).not.toBe(token.toUpperCase());
      }
    }
  });
});

/**
 * The settings screen, which for a long time could not be reached at all:
 * `ScreenManager.onAdjust` was declared and invoked but never assigned, and
 * nothing opened the screen, so dead zone, vibration and volume were applied
 * from the save and then frozen for the rest of the run. In a game with no
 * mouse and no menu bar that is a hole, not a rough edge.
 *
 * The DOM half of the path cannot be exercised here - the suite is node-only -
 * so the two halves that decide the behaviour are pure and are pinned instead:
 * the gate that turns a held stick into discrete steps, and the table that
 * turns a step into a saved value.
 */
describe("adjustDelta", () => {
  it("steps once on the first push, then waits out the repeat delay", () => {
    const repeat = createRepeatState();
    expect(adjustDelta(1, true, repeat, 0)).toBe(1);
    expect(adjustDelta(1, true, repeat, 1)).toBe(0);
    expect(adjustDelta(1, true, repeat, FOCUS_REPEAT_DELAY_MS - 1)).toBe(0);
    expect(adjustDelta(1, true, repeat, FOCUS_REPEAT_DELAY_MS)).toBe(1);
    expect(adjustDelta(1, true, repeat, FOCUS_REPEAT_DELAY_MS + FOCUS_REPEAT_RATE_MS)).toBe(1);
  });

  it("reverses immediately when the direction changes", () => {
    const repeat = createRepeatState();
    expect(adjustDelta(1, true, repeat, 0)).toBe(1);
    expect(adjustDelta(-1, true, repeat, 1)).toBe(-1);
    expect(adjustDelta(-1, true, repeat, 2)).toBe(0);
  });

  it("rearms on release, so tapping steps every time", () => {
    const repeat = createRepeatState();
    expect(adjustDelta(1, true, repeat, 0)).toBe(1);
    expect(adjustDelta(0, true, repeat, 1)).toBe(0);
    expect(adjustDelta(1, true, repeat, 2)).toBe(1);
  });

  it("ignores horizontal input on a row that carries no value", () => {
    const repeat = createRepeatState();
    expect(adjustDelta(1, false, repeat, 0)).toBe(0);
    expect(adjustDelta(-1, false, repeat, 400)).toBe(0);
    // And it left the gate armed, so the next adjustable row still steps at once.
    expect(adjustDelta(1, true, repeat, 401)).toBe(1);
  });
});

describe("adjustSetting", () => {
  it("steps a level by a tenth in both directions", () => {
    const settings = createDefaultSave().settings;
    settings.masterVolume = 0.5;
    expect(adjustSetting(settings, "masterVolume", -1)).toBe(true);
    expect(settings.masterVolume).toBe(0.4);
    expect(adjustSetting(settings, "masterVolume", 1)).toBe(true);
    expect(settings.masterVolume).toBe(0.5);
  });

  it("stops at both ends and reports that nothing moved", () => {
    const settings = createDefaultSave().settings;
    settings.masterVolume = 0;
    expect(adjustSetting(settings, "masterVolume", -1)).toBe(false);
    expect(settings.masterVolume).toBe(0);
    settings.masterVolume = 1;
    expect(adjustSetting(settings, "masterVolume", 1)).toBe(false);
    expect(settings.masterVolume).toBe(1);
  });

  it("snaps a value that sits between two notches onto the grid", () => {
    const settings = createDefaultSave().settings;
    settings.musicVolume = 0.83;
    expect(adjustSetting(settings, "musicVolume", 1)).toBe(true);
    expect(settings.musicVolume).toBe(0.9);

    settings.musicVolume = 0.83;
    expect(adjustSetting(settings, "musicVolume", -1)).toBe(true);
    expect(settings.musicVolume).toBe(0.7);
  });

  it("toggles vibration as a boolean, not as a number", () => {
    const settings = createDefaultSave().settings;
    settings.vibration = true;
    expect(adjustSetting(settings, "vibration", -1)).toBe(true);
    expect(settings.vibration).toBe(false);
    expect(adjustSetting(settings, "vibration", -1)).toBe(false);
    expect(adjustSetting(settings, "vibration", 1)).toBe(true);
    expect(settings.vibration).toBe(true);
  });

  it("steps the dead zone in fiftieths and stops at the schema's ceiling", () => {
    const settings = createDefaultSave().settings;
    expect(settings.gamepadDeadZone).toBe(0.18);
    expect(adjustSetting(settings, "gamepadDeadZone", 1)).toBe(true);
    expect(settings.gamepadDeadZone).toBe(0.2);
    settings.gamepadDeadZone = 0.5;
    expect(adjustSetting(settings, "gamepadDeadZone", 1)).toBe(false);
    expect(settings.gamepadDeadZone).toBe(0.5);
  });

  it("refuses an unknown option and a zero delta", () => {
    const settings = createDefaultSave().settings;
    expect(adjustSetting(settings, "notASetting", 1)).toBe(false);
    expect(adjustSetting(settings, "masterVolume", 0)).toBe(false);
    expect(settings).toEqual(createDefaultSave().settings);
  });

  it("drives the value when the gate opens and not when it is shut", () => {
    const settings = createDefaultSave().settings;
    settings.masterVolume = 1;
    const repeat = createRepeatState();
    const push = (dx: number, nowMs: number) => {
      const delta = adjustDelta(dx, true, repeat, nowMs);
      if (delta !== 0) adjustSetting(settings, "masterVolume", delta);
    };
    push(-1, 0);
    push(-1, 1);
    push(-1, FOCUS_REPEAT_DELAY_MS);
    expect(settings.masterVolume).toBe(0.8);
  });
});

describe("the settings screen model", () => {
  it("exposes exactly the fields the game applies, and no others", () => {
    // Game.applySettings() reads every field of SaveSettings; a knob wired to
    // nothing, or a setting with no knob, is the failure this pins.
    const fields = Object.keys(createDefaultSave().settings).sort();
    expect(SETTINGS.map((definition) => definition.id).sort()).toEqual(fields);
  });

  it("gives every row a value, which is what makes the row adjustable", () => {
    const settings = createDefaultSave().settings;
    const data = settingsScreenData(settings);
    expect(data.options).toHaveLength(SETTINGS.length);
    for (const option of data.options ?? []) {
      expect(option.value, `option "${option.id}" would render as a plain button`).toBeDefined();
      expect(option.label.length).toBeGreaterThan(0);
    }
  });

  it("each entry reads and writes its own save field and no other", () => {
    for (const definition of SETTINGS) {
      const settings = createDefaultSave().settings;
      const before = { ...settings };
      definition.write(settings, definition.min);
      expect(definition.read(settings)).toBe(definition.min);
      for (const key of Object.keys(settings) as Array<keyof typeof settings>) {
        if (key === definition.id) continue;
        expect(settings[key], `"${definition.id}" also wrote "${key}"`).toBe(before[key]);
      }
    }
  });

  it("prints levels as percentages, vibration as a state and the dead zone as a figure", () => {
    const settings = createDefaultSave().settings;
    settings.masterVolume = 1;
    settings.effectsVolume = 0.7;
    expect(formatSetting(settings, "masterVolume")).toBe("100%");
    expect(formatSetting(settings, "effectsVolume")).toBe("70%");
    settings.vibration = true;
    expect(formatSetting(settings, "vibration")).toBe("On");
    settings.vibration = false;
    expect(formatSetting(settings, "vibration")).toBe("Off");
    expect(formatSetting(settings, "gamepadDeadZone")).toBe("0.18");
    expect(formatSetting(settings, "notASetting")).toBe("");
  });

  it("keeps every step inside the range the save schema will accept", () => {
    for (const definition of SETTINGS) {
      expect(findSetting(definition.id)).toBe(definition);
      const settings = createDefaultSave().settings;
      // Walk the whole range from both ends; nothing may leave the bounds, and
      // the walk has to terminate, which a rounding error would prevent.
      for (const direction of [1, -1]) {
        let steps = 0;
        while (adjustSetting(settings, definition.id, direction)) {
          const value = definition.read(settings);
          expect(value).toBeGreaterThanOrEqual(definition.min);
          expect(value).toBeLessThanOrEqual(definition.max);
          expect(++steps).toBeLessThan(200);
        }
      }
      expect(definition.read(settings)).toBe(definition.min);
    }
  });
});
