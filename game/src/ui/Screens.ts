/**
 * Every modal surface in the game: splash, loadout, route fork, upgrade and
 * module offers, pause/settings, victory, defeat, run summary, and the
 * controller-disconnected overlay.
 *
 * One class drives them all. The screens differ only in layout and content, so
 * a per-screen class would be nine copies of the same focus wiring; the risk
 * worth avoiding is a screen that is navigable one way and not the other, and
 * a single code path is what prevents that.
 */

import type { RouteSegmentDefinition } from "../core/types.ts";
import type { InputSnapshot } from "../input/InputActions.ts";
import type { SaveSettings } from "../save/SaveSchema.ts";
import { FocusManager, acceptRepeat, createRepeatState, type RepeatState } from "./FocusManager.ts";
import { applyGlyph } from "./HudController.ts";

export type ScreenKind =
  | "none"
  | "title"
  | "loadout"
  | "route"
  | "upgrade"
  | "module"
  | "pause"
  | "settings"
  | "victory"
  | "defeat"
  | "summary";

export interface ScreenOption {
  id: string;
  label: string;
  /** Neutral description line. */
  detail?: string;
  /** Upside line, rendered in the positive lane (route reward, module gain). */
  reward?: string;
  /** Downside line, rendered in the hostile lane (route danger, tradeoff). */
  danger?: string;
  /** Small caps tag above the label, e.g. the upgrade category. */
  tag?: string;
  /** Large glyph for card layouts. */
  glyph?: string;
  /** Right-aligned value, e.g. a settings level. Enables left/right adjust. */
  value?: string;
  accent?: number;
  disabled?: boolean;
}

export interface ScreenStat {
  label: string;
  value: string;
}

export interface ScreenHint {
  /** Semantic button token, or "" for a hint with no glyph. */
  button: string;
  label: string;
}

export interface ScreenData {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  body?: string;
  options?: ScreenOption[];
  stats?: ScreenStat[];
  /** Overrides the per-kind default layout. */
  layout?: "list" | "cards";
  hints?: ScreenHint[];
}

export type ScreenChoiceHandler = (kind: ScreenKind, optionId: string, index: number) => void;
export type ScreenBackHandler = (kind: ScreenKind) => void;
export type ScreenAdjustHandler = (kind: ScreenKind, optionId: string, delta: number) => void;

const EMPTY_DATA: ScreenData = {};

const DEFAULT_TITLES: Record<ScreenKind, string> = {
  none: "",
  title: "Marcha de Ferro",
  loadout: "Loadout",
  route: "Choose the road",
  upgrade: "Level up",
  module: "Install a module",
  pause: "Paused",
  settings: "Settings",
  victory: "The gate holds",
  defeat: "The core is cold",
  summary: "Run summary",
};

const CARD_KINDS: Record<string, boolean> = {
  loadout: true,
  route: true,
  upgrade: true,
  module: true,
};

function el(tag: string, className: string, parent: HTMLElement | null): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

function hex(color: number): string {
  return `#${(color >>> 0).toString(16).padStart(6, "0")}`;
}

/** Convenience for the route fork: reward and danger come straight from data. */
export function routeOption(segment: RouteSegmentDefinition): ScreenOption {
  return {
    id: segment.id,
    label: segment.name,
    reward: segment.reward,
    danger: segment.danger,
    detail: `${Math.round(segment.lengthMeters)} m · ${segment.objective.label}`,
    tag: segment.modifiers.length > 0 ? segment.modifiers.join(" / ") : "standard",
  };
}

/**
 * How far a horizontal push moves an adjustable option this frame, gated by the
 * same repeat as focus movement so a held stick steps rather than races.
 *
 * Pure, and exported, for the same reason `nextFocusIndex` is: the suite has no
 * DOM, and "left and right actually change the value" is the one thing about
 * the settings screen worth pinning.
 */
export function adjustDelta(
  dx: number,
  adjustable: boolean,
  repeat: RepeatState,
  nowMs: number,
): number {
  // A centred stick rearms the gate, so releasing and pushing again always
  // steps once immediately.
  if (dx === 0) {
    acceptRepeat(repeat, 0, 0, nowMs);
    return 0;
  }
  if (!adjustable) return 0;
  return acceptRepeat(repeat, dx, 0, nowMs) ? Math.sign(dx) : 0;
}

interface StackEntry {
  kind: ScreenKind;
  data: ScreenData;
  index: number;
}

export class ScreenManager {
  private readonly container: HTMLElement;
  private readonly disconnectLayer: HTMLElement;
  private readonly focus: FocusManager;
  private readonly clock: () => number;
  private readonly adjustRepeat: RepeatState = createRepeatState();
  private readonly stack: StackEntry[] = [];
  private readonly options: HTMLElement[] = [];
  /** Parallel to `options`; null where an option carries no value. */
  private readonly values: (HTMLElement | null)[] = [];

  private kind_: ScreenKind = "none";
  private data: ScreenData = EMPTY_DATA;
  private device = "gamepad";
  private isCards = false;
  private hintsBar: HTMLElement | null = null;
  private disconnected = false;

  onChoose: ScreenChoiceHandler | null = null;
  onBack: ScreenBackHandler | null = null;
  onAdjust: ScreenAdjustHandler | null = null;

  constructor(root: HTMLElement) {
    this.container = el("div", "screens", root);
    this.focus = new FocusManager(this.container);
    this.clock =
      typeof performance !== "undefined" ? () => performance.now() : () => Date.now();

    this.disconnectLayer = el("div", "disconnect", root);
    const box = el("div", "disconnect__box", this.disconnectLayer);
    const icon = el("div", "disconnect__icon", box);
    icon.textContent = "⚠";
    const title = el("h2", "disconnect__title", box);
    title.textContent = "Controller disconnected";
    const text = el("p", "disconnect__text", box);
    text.textContent =
      "The march is paused. Reconnect the controller, or press any key to continue on the keyboard.";
  }

  get kind(): ScreenKind {
    return this.kind_;
  }

  get isOpen(): boolean {
    return this.kind_ !== "none";
  }

  get focusedIndex(): number {
    return this.focus.focusedIndex;
  }

  /** Replaces whatever is open. Clears the screen stack. */
  show(kind: ScreenKind, data: ScreenData = EMPTY_DATA): void {
    this.stack.length = 0;
    this.render(kind, data, 0);
  }

  /** Opens `kind` over the current screen; `back()` returns to it. */
  pushScreen(kind: ScreenKind, data: ScreenData = EMPTY_DATA): void {
    if (this.kind_ !== "none") {
      this.stack.push({ kind: this.kind_, data: this.data, index: this.focus.focusedIndex });
    }
    this.render(kind, data, 0);
  }

  /**
   * Rewrites one option's value text where it stands.
   *
   * Re-rendering the screen would rebuild the focus group under the player's
   * thumb, mid-adjust, several times a second. The stored model is updated too
   * so that returning to this screen shows what the player left behind.
   */
  setOptionValue(optionId: string, value: string): void {
    for (let i = 0; i < this.options.length; i++) {
      if (this.options[i].dataset.optionId !== optionId) continue;
      const node = this.values[i];
      if (node) node.textContent = value;
      const model = this.data.options?.[i];
      if (model) model.value = value;
      return;
    }
  }

  hide(): void {
    this.stack.length = 0;
    this.kind_ = "none";
    this.data = EMPTY_DATA;
    this.options.length = 0;
    this.values.length = 0;
    this.hintsBar = null;
    this.focus.clear();
    this.container.classList.remove("is-open");
    this.container.replaceChildren();
  }

  /** Blocks input and covers everything while the pad is gone. */
  setControllerDisconnected(visible: boolean): void {
    this.disconnected = visible;
    this.disconnectLayer.classList.toggle("is-on", visible);
  }

  get controllerDisconnected(): boolean {
    return this.disconnected;
  }

  setDevice(device: string): void {
    if (device === this.device || device === "none") return;
    this.device = device;
    this.renderHints();
  }

  moveFocus(dx: number, dy: number): void {
    if (this.kind_ === "none") return;
    if (this.isCards) {
      this.focus.move(dx, dy);
      return;
    }
    this.focus.move(0, dy);
    const focused = this.focus.focused;
    const adjustable = focused !== null && focused.dataset.adjustable === "true";
    const delta = adjustDelta(dx, adjustable, this.adjustRepeat, this.clock());
    if (delta !== 0 && focused && this.onAdjust) {
      this.onAdjust(this.kind_, focused.dataset.optionId ?? "", delta);
    }
  }

  confirm(): void {
    if (this.kind_ === "none") return;
    if (this.options.length === 0) {
      if (this.onChoose) this.onChoose(this.kind_, "", -1);
      return;
    }
    this.focus.activate();
  }

  back(): void {
    if (this.kind_ === "none") return;
    const previous = this.stack.pop();
    if (previous) {
      this.render(previous.kind, previous.data, previous.index);
      return;
    }
    if (this.onBack) this.onBack(this.kind_);
  }

  /** One-call wiring for the game loop; safe to call every frame. */
  handleInput(snapshot: InputSnapshot): void {
    if (this.disconnected || this.kind_ === "none") return;
    if (snapshot.lastDevice !== "none") this.setDevice(snapshot.lastDevice);

    const buttons = snapshot.buttons;
    let dx = 0;
    let dy = 0;
    if (buttons.menuLeft.held) dx -= 1;
    if (buttons.menuRight.held) dx += 1;
    if (buttons.menuUp.held) dy -= 1;
    if (buttons.menuDown.held || buttons.weaponNext.held) dy += 1;

    const stick = snapshot.leftStick;
    if (dx === 0 && dy === 0 && stick.active) {
      const ax = Math.abs(stick.x);
      const ay = Math.abs(stick.y);
      if (ax > ay + 0.12) dx = Math.sign(stick.x);
      else if (ay > ax + 0.12) dy = Math.sign(stick.y);
    }

    this.moveFocus(dx, dy);

    // The gameplay confirm and cancel also work here. A keyboard player reaches
    // a menu with a finger already on E, and a pad player with a thumb already
    // on Cross; refusing those because the menu wants its own binding is the
    // kind of friction that makes a controller-first game feel unfinished.
    if (buttons.menuConfirm.pressed || buttons.confirm.pressed) this.confirm();
    else if (buttons.menuBack.pressed || buttons.cancel.pressed) this.back();
  }

  dispose(): void {
    this.hide();
    this.container.remove();
    this.disconnectLayer.remove();
  }

  // -------------------------------------------------------------------------

  private render(kind: ScreenKind, data: ScreenData, focusIndex: number): void {
    this.kind_ = kind;
    this.data = data;
    this.options.length = 0;
    this.values.length = 0;
    this.focus.clear();
    this.container.replaceChildren();

    if (kind === "none") {
      this.container.classList.remove("is-open");
      return;
    }
    this.container.classList.add("is-open");

    const screen = el("div", `screen screen--${kind}`, this.container);
    const main = el("div", "screen__main", screen);

    const eyebrow = data.eyebrow ?? DEFAULT_EYEBROWS[kind];
    if (eyebrow) {
      const node = el("div", "screen__eyebrow", main);
      node.textContent = eyebrow;
    }

    const title = el("h1", "screen__title", main);
    title.textContent = data.title ?? DEFAULT_TITLES[kind];

    el("div", "screen__rule", main);

    if (data.subtitle) {
      const node = el("p", "screen__subtitle", main);
      node.textContent = data.subtitle;
    }

    if (data.stats && data.stats.length > 0) this.renderStats(main, data.stats);

    if (data.body) {
      const node = el("div", "screen__body", main);
      node.textContent = data.body;
    }

    const cards = data.layout ? data.layout === "cards" : CARD_KINDS[kind] === true;
    this.isCards = cards;

    const optionModels = data.options ?? EMPTY_OPTIONS;
    if (optionModels.length > 0) {
      this.renderOptions(main, optionModels, cards);
    } else if (kind === "title") {
      const press = el("div", "screen__press", main);
      const glyph = el("span", "glyph", press);
      applyGlyph(glyph, "confirm", this.device);
      const label = el("span", "", press);
      label.textContent = "Press to begin";
    }

    this.hintsBar = el("div", "screen__hints", screen);
    this.renderHints();

    const columns = cards ? Math.max(1, this.options.length) : 1;
    if (this.options.length > 0) this.focus.setGroup(this.options, focusIndex, columns);
  }

  private renderStats(parent: HTMLElement, stats: ScreenStat[]): void {
    const grid = el("div", "screen__stats", parent);
    for (let i = 0; i < stats.length; i++) {
      const cell = el("div", "stat", grid);
      const label = el("span", "stat__label", cell);
      label.textContent = stats[i].label;
      const value = el("span", "stat__value", cell);
      value.textContent = stats[i].value;
    }
  }

  private renderOptions(parent: HTMLElement, models: ScreenOption[], cards: boolean): void {
    const list = el("div", "screen__options", parent);
    list.dataset.layout = cards ? "cards" : "list";
    if (cards) list.style.setProperty("--cols", `${models.length}`);

    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      const button = el("button", "option", list);
      button.setAttribute("type", "button");
      button.dataset.optionId = model.id;
      if (model.disabled) button.dataset.disabled = "true";
      if (model.value !== undefined) button.dataset.adjustable = "true";
      if (model.accent !== undefined) {
        button.style.setProperty("--accent-color", hex(model.accent));
      }

      if (model.tag) {
        const tag = el("span", "option__tag", button);
        tag.textContent = model.tag;
      }
      if (cards && model.glyph) {
        const glyph = el("span", "option__glyph", button);
        glyph.textContent = model.glyph;
      }

      const row = el("div", "option__row", button);
      const label = el("span", "option__label", row);
      label.textContent = model.label;
      let valueNode: HTMLElement | null = null;
      if (model.value !== undefined) {
        valueNode = el("span", "option__value", row);
        valueNode.textContent = model.value;
      }
      this.values.push(valueNode);

      if (model.detail) {
        const detail = el("div", "option__detail", button);
        detail.textContent = model.detail;
      }
      if (model.reward) this.renderLine(button, "reward", "+", model.reward);
      if (model.danger) this.renderLine(button, "danger", "!", model.danger);

      const index = i;
      const id = model.id;
      button.addEventListener("click", () => {
        if (button.dataset.disabled === "true") return;
        this.focus.setIndex(index);
        if (this.onChoose) this.onChoose(this.kind_, id, index);
      });

      this.options.push(button);
    }
  }

  private renderLine(parent: HTMLElement, tone: string, icon: string, text: string): void {
    const line = el("div", `option__line option__line--${tone}`, parent);
    const iconEl = el("span", "option__line-icon", line);
    iconEl.textContent = icon;
    const textEl = el("span", "", line);
    textEl.textContent = text;
  }

  private renderHints(): void {
    const bar = this.hintsBar;
    if (!bar) return;
    bar.replaceChildren();
    const hints = this.data.hints ?? DEFAULT_HINTS[this.kind_] ?? EMPTY_HINTS;
    for (let i = 0; i < hints.length; i++) {
      const hint = el("span", "hint", bar);
      if (hints[i].button) {
        const glyph = el("span", "glyph", hint);
        applyGlyph(glyph, hints[i].button, this.device);
      }
      const label = el("span", "", hint);
      label.textContent = hints[i].label;
    }
  }
}

const EMPTY_OPTIONS: ScreenOption[] = [];
const EMPTY_HINTS: ScreenHint[] = [];

const DEFAULT_EYEBROWS: Record<ScreenKind, string> = {
  none: "",
  title: "Iron March",
  loadout: "Departure yard",
  route: "Checkpoint",
  upgrade: "Level up",
  module: "Spider workshop",
  pause: "",
  settings: "",
  victory: "Run complete",
  defeat: "Run ended",
  summary: "",
};

const NAVIGATE_HINT: ScreenHint = { button: "", label: "Stick / D-pad  Navigate" };
const SELECT_HINT: ScreenHint = { button: "confirm", label: "Select" };
const ADJUST_HINT: ScreenHint = { button: "", label: "Left / Right  Adjust" };
const BACK_HINT: ScreenHint = { button: "cancel", label: "Back" };
const RESUME_HINT: ScreenHint = { button: "pause", label: "Resume" };
const START_HINT: ScreenHint = { button: "confirm", label: "Start" };

const DEFAULT_HINTS: Record<ScreenKind, ScreenHint[]> = {
  none: [],
  title: [START_HINT],
  loadout: [NAVIGATE_HINT, SELECT_HINT],
  route: [NAVIGATE_HINT, SELECT_HINT],
  upgrade: [NAVIGATE_HINT, SELECT_HINT],
  module: [NAVIGATE_HINT, SELECT_HINT],
  pause: [NAVIGATE_HINT, SELECT_HINT, RESUME_HINT],
  // No Select here: every row on this screen is adjusted, not chosen, and a
  // footer that names a button which does nothing is how F52 happened.
  settings: [NAVIGATE_HINT, ADJUST_HINT, BACK_HINT],
  victory: [NAVIGATE_HINT, SELECT_HINT],
  defeat: [NAVIGATE_HINT, SELECT_HINT],
  summary: [NAVIGATE_HINT, SELECT_HINT],
};

// ---------------------------------------------------------------------------
// Settings
//
// One table describes every adjustable setting: where it lives in the save, how
// it steps, and how it reads. The screen is generated from it and the adjust
// handler resolves against it, so the two cannot drift - and each entry names a
// field `Game.applySettings` already applies, so nothing here is a knob wired to
// nothing. `tests/ui.test.ts` asserts that correspondence in both directions.
// ---------------------------------------------------------------------------

export interface SettingDefinition {
  /** Option id on the screen; also the save field it edits. */
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  read: (settings: SaveSettings) => number;
  write: (settings: SaveSettings, value: number) => void;
  format: (value: number) => string;
}

const percent = (value: number): string => `${Math.round(value * 100)}%`;

/** Volumes and camera shake are all 0..1 in tenths; only the label differs. */
function level(
  id: "masterVolume" | "musicVolume" | "effectsVolume" | "cameraShake",
  label: string,
): SettingDefinition {
  return {
    id,
    label,
    min: 0,
    max: 1,
    step: 0.1,
    read: (settings) => settings[id],
    write: (settings, value) => {
      settings[id] = value;
    },
    format: percent,
  };
}

export const SETTINGS: readonly SettingDefinition[] = [
  level("masterVolume", "Master volume"),
  level("musicVolume", "Music"),
  level("effectsVolume", "Effects"),
  {
    id: "vibration",
    label: "Vibration",
    min: 0,
    max: 1,
    step: 1,
    read: (settings) => (settings.vibration ? 1 : 0),
    write: (settings, value) => {
      settings.vibration = value >= 0.5;
    },
    format: (value) => (value >= 0.5 ? "On" : "Off"),
  },
  level("cameraShake", "Camera shake"),
  {
    id: "gamepadDeadZone",
    label: "Stick dead zone",
    // The save schema clamps this to 0.5; a wider dead zone than half the stick
    // would make the engineer unsteerable, so the screen stops where it stops.
    min: 0,
    max: 0.5,
    step: 0.02,
    read: (settings) => settings.gamepadDeadZone,
    write: (settings, value) => {
      settings.gamepadDeadZone = value;
    },
    format: (value) => value.toFixed(2),
  },
];

export function findSetting(id: string): SettingDefinition | null {
  for (let i = 0; i < SETTINGS.length; i++) {
    if (SETTINGS[i].id === id) return SETTINGS[i];
  }
  return null;
}

/** Current value of one setting as the screen would print it. */
export function formatSetting(settings: SaveSettings, id: string): string {
  const definition = findSetting(id);
  return definition ? definition.format(definition.read(settings)) : "";
}

/**
 * Steps one setting by one notch and writes it back.
 *
 * Returns whether anything actually moved, so a held direction at the end of a
 * range does not re-apply and re-save sixty times a second.
 */
export function adjustSetting(settings: SaveSettings, id: string, delta: number): boolean {
  const definition = findSetting(id);
  if (!definition || delta === 0) return false;

  const current = definition.read(settings);
  // Snap to the step grid on the way. A save written by an older build, or by
  // hand, can hold a value between two notches, and stepping from where it sits
  // would carry that offset forever.
  const notch = Math.round(current / definition.step) + Math.sign(delta);
  const raw = notch * definition.step;
  const clamped = raw < definition.min ? definition.min : raw > definition.max ? definition.max : raw;
  // Tenths and fiftieths do not survive binary floating point intact, and the
  // value is both displayed and compared.
  const next = Math.round(clamped * 1000) / 1000;
  if (next === current) return false;

  definition.write(settings, next);
  return true;
}

/** The settings screen, built from the live save. */
export function settingsScreenData(settings: SaveSettings): ScreenData {
  return {
    subtitle: "Left and right adjust. Changes apply at once and are saved.",
    options: SETTINGS.map((definition) => ({
      id: definition.id,
      label: definition.label,
      // A value is what marks the row adjustable; see `renderOptions`.
      value: definition.format(definition.read(settings)),
    })),
  };
}
