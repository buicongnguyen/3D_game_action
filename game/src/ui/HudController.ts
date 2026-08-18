/**
 * The permanent HUD.
 *
 * `HudController` never sees `GameWorld`: the game builds a plain `HudModel`
 * each frame and hands it over. Everything here diffs against the last model
 * and touches only the nodes that actually changed, because `update` runs at
 * frame rate and a naive rewrite of the whole panel set is a measurable cost.
 */

export interface HudBlueprintModel {
  icon: string;
  name: string;
  cost: number;
  accent: number;
  affordable: boolean;
  selected: boolean;
}

export interface HudPromptModel {
  text: string;
  /** Semantic token ("confirm", "service", "fold", "l1", ...) or a raw glyph. */
  button: string;
  /** Hold progress in [0,1]; 0 for a tap prompt. */
  progress: number;
}

export interface HudLeftBehindModel {
  label: string;
  screenX: number;
  screenY: number;
  /** 0 = just passed, 1 = about to be out of reach. */
  urgency: number;
  /** Seconds left on a Last Shot fuse; omitted for ordinary left-behind marks. */
  secondsRemaining?: number;
}

export interface HudModel {
  playerHealth: number;
  playerMaxHealth: number;
  coreHealth: number;
  maxCoreHealth: number;
  shield: number;
  maxShield: number;
  fuel: number;
  maxFuel: number;
  scrap: number;
  trail: number;
  trailState: string;
  level: number;
  xp: number;
  xpToNext: number;
  carried: string | null;
  currentWeapon: string;
  weaponHeat: number;
  fieldItems: string;
  distanceToCheckpoint: number;
  etaSeconds: number;
  objectiveLabel: string | null;
  objectiveProgress: number;
  objectiveTarget: number;
  objectiveComplete: boolean;
  salvageMode: boolean;
  salvageSeconds: number;
  salvageScore: number;
  speedMode: string;
  blueprints: HudBlueprintModel[];
  prompt: HudPromptModel | null;
  /**
   * The other verb available at the same moment. Square services and Triangle
   * recovers, and they resolve independently, so a player standing at a damaged
   * turret has two real choices — showing only one of them left the second
   * binding unadvertised anywhere on screen.
   */
  promptSecondary: HudPromptModel | null;
  spiderOffScreen: boolean;
  /** Radians, 0 = straight up on screen, increasing clockwise. */
  spiderScreenAngle: number;
  leftBehind: HudLeftBehindModel[];
  lastDevice: string;
  emergencyBurn: boolean;
  cylinders: number;
}

export type ToastTone = "info" | "good" | "warn" | "bad" | "scrap" | "xp";
export type FlashKind = "damage" | "heal" | "levelup" | "pursuit" | "lastshot";

// ---------------------------------------------------------------------------
// Device glyphs
// ---------------------------------------------------------------------------

export interface GlyphSpec {
  text: string;
  shape: "round" | "cap" | "shoulder";
  /**
   * Face-button identity. A small round chip containing a thin glyph reads as
   * "a ring with a mark in it" whichever mark it is, so shape alone does not
   * separate Cross from Circle at HUD size. The DualShock's own colour coding
   * does, and players already know it.
   */
  tone?: "cross" | "circle" | "square" | "triangle";
}

const GAMEPAD_GLYPHS: Record<string, GlyphSpec> = {
  confirm: { text: "✕", shape: "round", tone: "cross" },
  cross: { text: "✕", shape: "round", tone: "cross" },
  cancel: { text: "○", shape: "round", tone: "circle" },
  circle: { text: "○", shape: "round", tone: "circle" },
  service: { text: "□", shape: "round", tone: "square" },
  square: { text: "□", shape: "round", tone: "square" },
  fold: { text: "△", shape: "round", tone: "triangle" },
  triangle: { text: "△", shape: "round", tone: "triangle" },
  buildradial: { text: "L1", shape: "shoulder" },
  l1: { text: "L1", shape: "shoulder" },
  overlay: { text: "L2", shape: "shoulder" },
  l2: { text: "L2", shape: "shoulder" },
  tool: { text: "R1", shape: "shoulder" },
  r1: { text: "R1", shape: "shoulder" },
  focusfire: { text: "R2", shape: "shoulder" },
  r2: { text: "R2", shape: "shoulder" },
  recenter: { text: "R3", shape: "shoulder" },
  overdrive: { text: "↑", shape: "cap" },
  blueprintprev: { text: "←", shape: "cap" },
  blueprintnext: { text: "→", shape: "cap" },
  pause: { text: "OPT", shape: "cap" },
  map: { text: "SHR", shape: "cap" },
};

const KEYBOARD_GLYPHS: Record<string, GlyphSpec> = {
  confirm: { text: "E", shape: "cap" },
  cross: { text: "E", shape: "cap" },
  cancel: { text: "SPACE", shape: "cap" },
  circle: { text: "SPACE", shape: "cap" },
  service: { text: "R", shape: "cap" },
  square: { text: "R", shape: "cap" },
  fold: { text: "F", shape: "cap" },
  triangle: { text: "F", shape: "cap" },
  buildradial: { text: "Q", shape: "cap" },
  l1: { text: "Q", shape: "cap" },
  overlay: { text: "TAB", shape: "cap" },
  l2: { text: "TAB", shape: "cap" },
  // These four were wrong and each told the player to press a key that did
  // something else: tool and recenter were transposed, focus fire named Shift
  // (which is overdrive), and overdrive named "1" (which is bound to nothing).
  // `tests/ui.test.ts` now asserts every one of these against KEYBOARD_BINDINGS,
  // because a prompt that lies is worse than no prompt.
  tool: { text: "V", shape: "cap" },
  r1: { text: "V", shape: "cap" },
  focusfire: { text: "LMB", shape: "cap" },
  r2: { text: "LMB", shape: "cap" },
  recenter: { text: "C", shape: "cap" },
  overdrive: { text: "SHIFT", shape: "cap" },
  blueprintprev: { text: "[", shape: "cap" },
  blueprintnext: { text: "]", shape: "cap" },
  pause: { text: "ESC", shape: "cap" },
  map: { text: "M", shape: "cap" },
};

const FALLBACK_GLYPH: GlyphSpec = { text: "", shape: "cap" };

/**
 * Resolves a semantic button token to the glyph for the last-used device.
 * The returned object is shared and must be read immediately, not retained.
 */
export function glyphFor(token: string, device: string): GlyphSpec {
  const table = device === "keyboard" ? KEYBOARD_GLYPHS : GAMEPAD_GLYPHS;
  const found = table[token.toLowerCase()];
  if (found) return found;
  // The fallback exists so an unknown token cannot blank a prompt, but it is
  // never the right answer: it renders the token itself in a chip sized for one
  // or two characters. A stray "options" token produced a pill reading
  // "OPTIONS" on the pause screen for exactly this reason. Complain in
  // development so the next one is found by whoever introduces it.
  if (import.meta.env?.DEV && !warnedTokens.has(token)) {
    warnedTokens.add(token);
    console.warn(`[hud] no glyph for button token "${token}" on device "${device}"`);
  }
  FALLBACK_GLYPH.text = token.toUpperCase();
  return FALLBACK_GLYPH;
}

const warnedTokens = new Set<string>();

export function applyGlyph(element: HTMLElement, token: string, device: string): void {
  const glyph = glyphFor(token, device);
  element.textContent = glyph.text;
  element.dataset.shape = glyph.shape;
  if (glyph.tone) element.dataset.tone = glyph.tone;
  else delete element.dataset.tone;
}

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

function el(tag: string, className: string, parent: HTMLElement | null): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

/** Builds the two-element riveted frame and returns the body to fill. */
function panel(parent: HTMLElement, className: string): HTMLElement {
  const frame = el("div", `panel ${className}`, parent);
  return el("div", "panel__body", frame);
}

function hex(color: number): string {
  return `#${(color >>> 0).toString(16).padStart(6, "0")}`;
}

function formatClock(seconds: number): string {
  const total = seconds < 0 || !Number.isFinite(seconds) ? 0 : Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest < 10 ? "0" : ""}${rest}`;
}

const TEXT_VALUE_OF_MAX = 0;
const TEXT_VALUE_ONLY = 1;

/**
 * One bar. `fill` is the truth and snaps; `chip` lags behind on loss so a hit
 * reads as a visible bite out of the bar, and snaps on gain so healing never
 * looks delayed.
 */
class Bar {
  readonly root: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly chip: HTMLElement;
  private readonly valueEl: HTMLElement;
  private readonly shieldEl: HTMLElement | null;

  private quantised = -1;
  private shieldQuantised = -1;
  private shownValue = Number.NaN;
  private shownMax = Number.NaN;

  constructor(parent: HTMLElement, modifier: string, name: string, withShield = false) {
    this.root = el("div", `bar bar--${modifier}`, parent);
    const head = el("div", "bar__head", this.root);
    const nameEl = el("span", "bar__name", head);
    nameEl.textContent = name;
    this.valueEl = el("span", "bar__value", head);
    const track = el("div", "bar__track", this.root);
    this.chip = el("div", "bar__chip", track);
    this.fill = el("div", "bar__fill", track);
    this.shieldEl = withShield ? el("div", "bar__shield", track) : null;
  }

  update(value: number, max: number, mode: number): void {
    const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
    const quantised = Math.round(ratio * 1000);
    if (quantised !== this.quantised) {
      const width = `${quantised / 10}%`;
      this.fill.style.width = width;
      if (quantised > this.quantised) {
        this.chip.style.transition = "none";
        this.chip.style.width = width;
        void this.chip.offsetWidth;
        this.chip.style.transition = "";
      } else {
        this.chip.style.width = width;
      }
      this.quantised = quantised;
    }

    const shownValue = Math.round(value);
    const shownMax = Math.round(max);
    if (shownValue !== this.shownValue || shownMax !== this.shownMax) {
      this.shownValue = shownValue;
      this.shownMax = shownMax;
      this.valueEl.textContent =
        mode === TEXT_VALUE_ONLY ? `${shownValue}` : `${shownValue} / ${shownMax}`;
    }
  }

  updateShield(value: number, max: number): void {
    if (!this.shieldEl) return;
    const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
    const quantised = Math.round(ratio * 1000);
    if (quantised === this.shieldQuantised) return;
    this.shieldQuantised = quantised;
    this.shieldEl.style.width = `${quantised / 10}%`;
  }

  setLow(low: boolean): void {
    this.root.classList.toggle("is-low", low);
  }
}

interface BlueprintChip {
  root: HTMLElement;
  key: HTMLElement;
  icon: HTMLElement;
  name: HTMLElement;
  cost: HTMLElement;
  prevKey: string;
  prevIcon: string;
  prevName: string;
  prevCost: number;
  prevAccent: number;
  prevAffordable: boolean;
  prevSelected: boolean;
}

/**
 * Slot hints for a controller. D-pad left/right cycle the selection, so the
 * outer slots advertise the direction that reaches them and the inner ones show
 * nothing at all. They previously showed a middle dot, which reviewers read —
 * correctly — as a broken glyph: a mark that means nothing is worse than blank.
 */
const PAD_SLOT_HINTS: readonly string[] = ["◀", "", "", "▶"];

interface MarkerSlot {
  root: HTMLElement;
  label: HTMLElement;
  /** Last Shot fuse readout; empty and hidden for ordinary markers. */
  clock: HTMLElement;
  prevLabel: string;
  prevClock: string;
  prevUrgent: boolean;
  visible: boolean;
}

const MARKER_CAPACITY = 6;
const TOAST_CAPACITY = 4;
const TOAST_EXIT_MS = 300;

export class HudController {
  private readonly root: HTMLElement;
  private readonly hud: HTMLElement;

  private readonly healthBar: Bar;
  private readonly coreBar: Bar;
  private readonly fuelBar: Bar;
  private readonly trailBar: Bar;
  private readonly xpBar: Bar;

  private readonly speedBadge: HTMLElement;
  private readonly burn: HTMLElement;
  private readonly carry: HTMLElement;
  private readonly carryText: HTMLElement;
  private readonly weapon: HTMLElement;
  private readonly fieldItems: HTMLElement;
  private readonly trailPanel: HTMLElement;
  private readonly trailState: HTMLElement;
  private readonly distanceValue: HTMLElement;
  private readonly etaValue: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly objectiveLabel: HTMLElement;
  private readonly objectiveValue: HTMLElement;
  private readonly salvage: HTMLElement;
  private readonly salvageTime: HTMLElement;
  private readonly salvageScore: HTMLElement;
  private readonly scrapValue: HTMLElement;
  private readonly cylinderValue: HTMLElement;
  private readonly levelValue: HTMLElement;

  private readonly blueprintRow: HTMLElement;
  private readonly chips: BlueprintChip[] = [];

  private readonly prompt: HTMLElement;
  private readonly promptRing: HTMLElement;
  private readonly promptGlyph: HTMLElement;
  private readonly promptText: HTMLElement;
  private readonly promptAlt: HTMLElement;
  private readonly promptAltGlyph: HTMLElement;
  private readonly promptAltText: HTMLElement;
  private prevAltOn = false;
  private prevAltText = "";
  private prevAltButton = "";
  private prevAltDevice = "";

  private readonly arrow: HTMLElement;
  private readonly arrowLabel: HTMLElement;
  private readonly markerLayer: HTMLElement;
  private readonly markers: MarkerSlot[] = [];

  private readonly toastLayer: HTMLElement;
  private readonly toastPool: HTMLElement[] = [];
  private readonly toastTimers = new Set<number>();
  /** The pending hold timer per visible toast, so a repeat can extend it. */
  private readonly toastTimerByNode = new Map<HTMLElement, number>();

  private readonly flashes: Record<FlashKind, HTMLElement>;

  private prevTrailState = "";
  private prevSpeedMode = "";
  private prevCarried: string | null = "";
  private prevWeapon = "";
  private prevWeaponHeat = -1;
  private prevFieldItems = "";
  private prevDistance = Number.NaN;
  private prevEta = Number.NaN;
  private prevScrap = Number.NaN;
  private prevCylinders = Number.NaN;
  private prevLevel = Number.NaN;
  private prevBurn = false;
  private prevPromptText = "";
  private prevPromptButton = "";
  private prevPromptDevice = "";
  private prevPromptRing = -1;
  private prevPromptOn = false;
  private prevArrowOn = false;
  private prevArrowDeg = Number.NaN;
  private prevPursuit = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.hud = el("div", "hud", root);

    this.flashes = {
      damage: el("div", "flash flash--damage", this.hud),
      heal: el("div", "flash flash--heal", this.hud),
      levelup: el("div", "flash flash--levelup", this.hud),
      lastshot: el("div", "flash flash--lastshot", this.hud),
      pursuit: el("div", "flash flash--pursuit", this.hud),
    };

    // --- spider, top left -------------------------------------------------
    const spider = panel(this.hud, "hud__spider");
    const spiderHead = el("div", "hud__head", spider);
    const spiderTitle = el("span", "hud__title", spiderHead);
    spiderTitle.textContent = "Iron Spider";
    this.speedBadge = el("span", "badge", spiderHead);
    this.speedBadge.textContent = "MARCH";
    this.coreBar = new Bar(spider, "core", "Integrity", true);
    this.fuelBar = new Bar(spider, "fuel", "Fuel", false);
    this.burn = el("div", "hud__burn", spider);
    this.burn.textContent = "Burning scrap - no fuel";

    // --- engineer, bottom left --------------------------------------------
    const player = panel(this.hud, "hud__player");
    const playerHead = el("div", "hud__head", player);
    const playerTitle = el("span", "hud__title", playerHead);
    playerTitle.textContent = "Engineer";
    this.healthBar = new Bar(player, "health", "Health", false);
    this.weapon = el("div", "hud__weapon", player);
    this.fieldItems = el("div", "hud__field-items", player);
    this.carry = el("div", "hud__carry", player);
    const carryIcon = el("span", "hud__carry-icon", this.carry);
    carryIcon.textContent = "✦";
    this.carryText = el("span", "hud__carry-text", this.carry);

    // --- trail, top centre --------------------------------------------------
    const trail = panel(this.hud, "hud__trail");
    this.trailPanel = trail.parentElement as HTMLElement;
    this.trailPanel.dataset.state = "QUIET";
    const trailHead = el("div", "hud__trail-head", trail);
    const trailLabel = el("span", "hud__title", trailHead);
    trailLabel.textContent = "Trail";
    this.trailState = el("span", "hud__trail-state", trailHead);
    this.trailState.textContent = "QUIET";
    this.trailBar = new Bar(trail, "trail", "Threat", false);
    const checkpoint = el("div", "hud__checkpoint", trail);
    const checkpointLabel = el("span", "hud__checkpoint-label", checkpoint);
    checkpointLabel.textContent = "Next halt";
    this.distanceValue = el("span", "hud__checkpoint-value", checkpoint);
    this.etaValue = el("span", "hud__checkpoint-value", checkpoint);
    this.objective = el("div", "hud__objective", trail);
    this.objectiveLabel = el("span", "hud__objective-label", this.objective);
    this.objectiveValue = el("span", "hud__objective-value", this.objective);
    this.salvage = el("div", "hud__salvage", trail);
    this.salvageTime = el("span", "hud__salvage-time", this.salvage);
    this.salvageScore = el("span", "hud__salvage-score", this.salvage);

    // --- resources, top right ----------------------------------------------
    const resources = panel(this.hud, "hud__resources panel--right");
    const scrapRow = el("div", "hud__res-row hud__res-row--scrap", resources);
    const scrapIcon = el("span", "hud__res-icon", scrapRow);
    scrapIcon.textContent = "⚙";
    this.scrapValue = el("span", "value", scrapRow);
    const cylinderRow = el("div", "hud__res-row hud__res-row--cyl", resources);
    const cylinderIcon = el("span", "hud__res-icon", cylinderRow);
    cylinderIcon.textContent = "◎";
    this.cylinderValue = el("span", "value", cylinderRow);

    // --- level, bottom right ------------------------------------------------
    const xpPanel = panel(this.hud, "hud__xp panel--right");
    const levelRow = el("div", "hud__level", xpPanel);
    const levelLabel = el("span", "hud__title", levelRow);
    levelLabel.textContent = "Level";
    this.levelValue = el("span", "hud__level-num", levelRow);
    this.xpBar = new Bar(xpPanel, "xp", "XP", false);

    // --- blueprints, bottom centre -----------------------------------------
    this.blueprintRow = el("div", "hud__blueprints", this.hud);

    // --- contextual prompt ---------------------------------------------------
    this.prompt = el("div", "hud__prompt", this.hud);
    this.promptRing = el("div", "ring", this.prompt);
    this.promptGlyph = el("span", "glyph", this.promptRing);
    this.promptText = el("span", "hud__prompt-text", this.prompt);

    this.promptAlt = el("div", "hud__prompt hud__prompt--alt", this.hud);
    this.promptAltGlyph = el("span", "glyph", this.promptAlt);
    this.promptAltText = el("span", "hud__prompt-text", this.promptAlt);

    // --- off-screen spider arrow ---------------------------------------------
    this.arrow = el("div", "hud__arrow", this.hud);
    const arrowInner = el("div", "hud__arrow-inner", this.arrow);
    const arrowHead = el("div", "hud__arrow-head", arrowInner);
    arrowHead.textContent = "▲";
    this.arrowLabel = el("div", "hud__arrow-label", arrowInner);
    this.arrowLabel.textContent = "Spider";

    // --- left-behind markers --------------------------------------------------
    this.markerLayer = el("div", "hud__markers", this.hud);
    for (let i = 0; i < MARKER_CAPACITY; i++) {
      const markerRoot = el("div", "marker", this.markerLayer);
      const icon = el("span", "marker__icon", markerRoot);
      icon.textContent = "⚠";
      this.markers.push({
        root: markerRoot,
        label: el("span", "marker__label", markerRoot),
        clock: el("span", "marker__clock", markerRoot),
        prevLabel: "",
        prevClock: "",
        prevUrgent: false,
        visible: false,
      });
    }

    this.toastLayer = el("div", "hud__toasts", this.hud);
  }

  update(model: HudModel): void {
    this.healthBar.update(model.playerHealth, model.playerMaxHealth, TEXT_VALUE_OF_MAX);
    const heat = Math.round(model.weaponHeat * 100);
    if (model.currentWeapon !== this.prevWeapon || heat !== this.prevWeaponHeat) {
      this.prevWeapon = model.currentWeapon;
      this.prevWeaponHeat = heat;
      this.weapon.textContent = heat > 0 ? `${model.currentWeapon} · HEAT ${heat}%` : `${model.currentWeapon} · ↓ / B`;
      this.weapon.classList.toggle("is-hot", heat >= 75);
    }
    if (model.fieldItems !== this.prevFieldItems) {
      this.prevFieldItems = model.fieldItems;
      this.fieldItems.textContent = model.fieldItems;
      this.fieldItems.classList.toggle("is-on", model.fieldItems.length > 0);
    }
    // The engineer's own health had no low state at all, so a full bar and a
    // nearly-empty one were the same colour: the spider's fuel gauge warned the
    // player about the machine more loudly than anything warned them about
    // themselves.
    this.healthBar.setLow(
      model.playerMaxHealth > 0 && model.playerHealth / model.playerMaxHealth < 0.35,
    );
    this.coreBar.update(model.coreHealth, model.maxCoreHealth, TEXT_VALUE_OF_MAX);
    this.coreBar.updateShield(model.shield, model.maxShield);
    this.fuelBar.update(model.fuel, model.maxFuel, TEXT_VALUE_OF_MAX);
    this.fuelBar.setLow(model.maxFuel > 0 && model.fuel / model.maxFuel < 0.2);
    this.trailBar.update(model.trail, 100, TEXT_VALUE_ONLY);
    this.xpBar.update(model.xp, model.xpToNext, TEXT_VALUE_OF_MAX);

    if (model.trailState !== this.prevTrailState) {
      this.prevTrailState = model.trailState;
      this.trailPanel.dataset.state = model.trailState;
      this.trailState.textContent = model.trailState;
    }

    const pursuit = model.trailState === "PURSUIT";
    if (pursuit !== this.prevPursuit) {
      this.prevPursuit = pursuit;
      this.flashes.pursuit.classList.toggle("is-sustained", pursuit);
    }

    if (model.speedMode !== this.prevSpeedMode) {
      this.prevSpeedMode = model.speedMode;
      this.speedBadge.textContent = model.speedMode.toUpperCase();
      this.speedBadge.classList.toggle("badge--overdrive", model.speedMode === "overdrive");
      this.speedBadge.classList.toggle("badge--fallback", model.speedMode === "fallback");
    }

    if (model.emergencyBurn !== this.prevBurn) {
      this.prevBurn = model.emergencyBurn;
      this.burn.classList.toggle("is-on", model.emergencyBurn);
    }

    if (model.carried !== this.prevCarried) {
      this.prevCarried = model.carried;
      this.carry.classList.toggle("is-on", model.carried !== null);
      if (model.carried !== null) this.carryText.textContent = model.carried;
    }

    const distance = Math.max(0, Math.round(model.distanceToCheckpoint));
    if (distance !== this.prevDistance) {
      this.prevDistance = distance;
      this.distanceValue.textContent = `${distance} m`;
    }
    const eta = Math.max(0, Math.round(model.etaSeconds));
    if (eta !== this.prevEta) {
      this.prevEta = eta;
      this.etaValue.textContent = formatClock(eta);
    }

    const hasObjective = model.objectiveLabel !== null;
    this.objective.classList.toggle("is-on", hasObjective);
    if (hasObjective) {
      this.objectiveLabel.textContent = model.objectiveLabel ?? "";
      this.objectiveValue.textContent = model.objectiveComplete
        ? "COMPLETE"
        : `${Math.floor(model.objectiveProgress)} / ${Math.floor(model.objectiveTarget)}`;
      this.objective.classList.toggle("is-complete", model.objectiveComplete);
    }
    this.salvage.classList.toggle("is-on", model.salvageMode);
    if (model.salvageMode) {
      this.salvageTime.textContent = `SHIFT ${formatClock(Math.ceil(model.salvageSeconds))}`;
      this.salvageScore.textContent = `SCORE ${Math.floor(model.salvageScore)}`;
    }

    const scrap = Math.floor(model.scrap);
    if (scrap !== this.prevScrap) {
      this.prevScrap = scrap;
      this.scrapValue.textContent = `${scrap}`;
    }
    const cylinders = Math.floor(model.cylinders);
    if (cylinders !== this.prevCylinders) {
      this.prevCylinders = cylinders;
      this.cylinderValue.textContent = `${cylinders}`;
    }
    if (model.level !== this.prevLevel) {
      this.prevLevel = model.level;
      this.levelValue.textContent = `${model.level}`;
    }

    this.updateBlueprints(model.blueprints, model.lastDevice);
    this.updatePrompt(model.prompt, model.lastDevice);
    this.updateSecondaryPrompt(model.promptSecondary, model.lastDevice);
    this.updateArrow(model.spiderOffScreen, model.spiderScreenAngle);
    this.updateMarkers(model.leftBehind);
  }

  setVisible(visible: boolean): void {
    this.hud.classList.toggle("is-hidden", !visible);
  }

  showToast(message: string, tone: string, duration: number): void {
    // A message already on the stack is refreshed, not stacked. Sources that
    // announce a continuing condition rather than a discrete event will call
    // this every step, and four copies of one warning say less than one while
    // pushing off everything else. Refreshing keeps it visible for as long as
    // the condition lasts, which is what a repeat was trying to achieve.
    for (const existing of this.toastLayer.children) {
      const node = existing as HTMLElement;
      if (node.textContent === message && !node.classList.contains("is-out")) {
        this.restartToastTimers(node, duration);
        return;
      }
    }

    const toast = this.toastPool.pop() ?? el("div", "toast", null);
    toast.className = `toast toast--${tone}`;
    toast.textContent = message;
    this.toastLayer.appendChild(toast);
    while (this.toastLayer.childElementCount > TOAST_CAPACITY) {
      const oldest = this.toastLayer.firstElementChild as HTMLElement | null;
      if (!oldest) break;
      // Cancel the evicted toast's own timers before recycling it. They were
      // left armed: the hold timer would later fire on a node that is already
      // detached and pooled, mark it exiting, and push it into the pool a
      // second time - so one element could be handed out for two live toasts,
      // and whichever wrote to it last would win.
      this.cancelToastTimers(oldest);
      oldest.remove();
      this.toastPool.push(oldest);
    }

    this.restartToastTimers(toast, duration);
  }

  /** Drops any pending hold timer for a toast, so it cannot fire once recycled. */
  private cancelToastTimers(toast: HTMLElement): void {
    const previous = this.toastTimerByNode.get(toast);
    if (previous === undefined) return;
    window.clearTimeout(previous);
    this.toastTimers.delete(previous);
    this.toastTimerByNode.delete(toast);
  }

  /** (Re)arms a toast's hold-then-exit timers, cancelling any it already had. */
  private restartToastTimers(toast: HTMLElement, duration: number): void {
    this.cancelToastTimers(toast);

    const holdMs = Math.max(200, duration * 1000);
    const exitTimer = window.setTimeout(() => {
      this.toastTimers.delete(exitTimer);
      this.toastTimerByNode.delete(toast);
      toast.classList.add("is-out");
      const removeTimer = window.setTimeout(() => {
        this.toastTimers.delete(removeTimer);
        toast.remove();
        this.toastPool.push(toast);
      }, TOAST_EXIT_MS);
      this.toastTimers.add(removeTimer);
    }, holdMs);
    this.toastTimers.add(exitTimer);
    this.toastTimerByNode.set(toast, exitTimer);
  }

  /** One-shot full-screen flash. Pursuit also has a sustained state via update. */
  flash(kind: FlashKind, intensity: number): void {
    const element = this.flashes[kind];
    if (!element) return;
    const clamped = Math.min(1, Math.max(0, intensity));
    element.style.setProperty("--flash-intensity", `${clamped}`);
    element.classList.remove("is-firing");
    void element.offsetWidth;
    element.classList.add("is-firing");
  }

  dispose(): void {
    for (const timer of this.toastTimers) window.clearTimeout(timer);
    this.toastTimers.clear();
    this.toastTimerByNode.clear();
    this.toastPool.length = 0;
    this.chips.length = 0;
    this.markers.length = 0;
    this.hud.remove();
    this.root.classList.remove("has-focus");
  }

  private updateBlueprints(blueprints: HudBlueprintModel[], device: string): void {
    while (this.chips.length < blueprints.length) {
      const chipRoot = el("div", "bp", this.blueprintRow);
      this.chips.push({
        root: chipRoot,
        key: el("span", "bp__key", chipRoot),
        icon: el("div", "bp__icon", chipRoot),
        name: el("span", "bp__name", chipRoot),
        cost: el("span", "bp__cost", chipRoot),
        prevKey: "",
        prevIcon: "",
        prevName: "",
        prevCost: Number.NaN,
        prevAccent: Number.NaN,
        prevAffordable: false,
        prevSelected: false,
      });
    }

    const gamepad = device !== "keyboard";
    for (let i = 0; i < this.chips.length; i++) {
      const chip = this.chips[i];
      if (i >= blueprints.length) {
        chip.root.style.display = "none";
        continue;
      }
      const model = blueprints[i];
      chip.root.style.display = "";

      // A pad player has no number row. On a controller the slot hint is the
      // D-pad direction that cycles to it, and the selected slot shows L1,
      // which is what actually opens the radial.
      const keyLabel = gamepad ? (model.selected ? "L1" : (PAD_SLOT_HINTS[i] ?? "")) : `${i + 1}`;
      if (keyLabel !== chip.prevKey) {
        chip.prevKey = keyLabel;
        chip.key.textContent = keyLabel;
      }
      if (model.icon !== chip.prevIcon) {
        chip.prevIcon = model.icon;
        chip.icon.textContent = model.icon;
      }
      if (model.name !== chip.prevName) {
        chip.prevName = model.name;
        chip.name.textContent = model.name;
      }
      if (model.cost !== chip.prevCost) {
        chip.prevCost = model.cost;
        chip.cost.textContent = `${model.cost}`;
      }
      if (model.accent !== chip.prevAccent) {
        chip.prevAccent = model.accent;
        chip.root.style.setProperty("--bp-accent", hex(model.accent));
      }
      if (model.affordable !== chip.prevAffordable) {
        chip.prevAffordable = model.affordable;
        chip.root.classList.toggle("is-poor", !model.affordable);
      }
      if (model.selected !== chip.prevSelected) {
        chip.prevSelected = model.selected;
        chip.root.classList.toggle("is-selected", model.selected);
      }
    }
  }

  private updatePrompt(prompt: HudPromptModel | null, device: string): void {
    const on = prompt !== null;
    if (on !== this.prevPromptOn) {
      this.prevPromptOn = on;
      this.prompt.classList.toggle("is-on", on);
    }
    if (!prompt) return;

    if (prompt.text !== this.prevPromptText) {
      this.prevPromptText = prompt.text;
      this.promptText.textContent = prompt.text;
    }
    if (prompt.button !== this.prevPromptButton || device !== this.prevPromptDevice) {
      this.prevPromptButton = prompt.button;
      this.prevPromptDevice = device;
      applyGlyph(this.promptGlyph, prompt.button, device);
    }
    const ring = Math.round(Math.min(1, Math.max(0, prompt.progress)) * 360);
    if (ring !== this.prevPromptRing) {
      this.prevPromptRing = ring;
      this.promptRing.style.setProperty("--ring", `${ring}`);
      this.promptRing.classList.toggle("is-holding", ring > 0);
    }
  }

  /**
   * The second available verb, rendered under the primary prompt as a quieter
   * glyph-plus-label pair. No hold ring: it exists to say the binding is there,
   * and the moment the player commits to it, it becomes the primary.
   */
  private updateSecondaryPrompt(prompt: HudPromptModel | null, device: string): void {
    if (!this.promptAlt) return;
    const on = prompt !== null;
    if (on !== this.prevAltOn) {
      this.prevAltOn = on;
      this.promptAlt.classList.toggle("is-on", on);
    }
    if (!prompt) return;

    if (prompt.text !== this.prevAltText) {
      this.prevAltText = prompt.text;
      this.promptAltText.textContent = prompt.text;
    }
    if (prompt.button !== this.prevAltButton || device !== this.prevAltDevice) {
      this.prevAltButton = prompt.button;
      this.prevAltDevice = device;
      applyGlyph(this.promptAltGlyph, prompt.button, device);
    }
  }

  private updateArrow(offScreen: boolean, angle: number): void {
    if (offScreen !== this.prevArrowOn) {
      this.prevArrowOn = offScreen;
      this.arrow.classList.toggle("is-on", offScreen);
    }
    if (!offScreen) return;
    const degrees = Math.round((angle * 180) / Math.PI);
    if (degrees === this.prevArrowDeg) return;
    this.prevArrowDeg = degrees;
    this.arrow.style.transform = `rotate(${degrees}deg)`;
    this.arrowLabel.style.transform = `rotate(${-degrees}deg)`;
  }

  private updateMarkers(entries: HudLeftBehindModel[]): void {
    const count = Math.min(entries.length, MARKER_CAPACITY);
    for (let i = 0; i < MARKER_CAPACITY; i++) {
      const slot = this.markers[i];
      if (i >= count) {
        if (slot.visible) {
          slot.visible = false;
          slot.root.classList.remove("is-on");
        }
        continue;
      }
      const entry = entries[i];
      if (!slot.visible) {
        slot.visible = true;
        slot.root.classList.add("is-on");
      }
      if (entry.label !== slot.prevLabel) {
        slot.prevLabel = entry.label;
        slot.label.textContent = entry.label;
      }
      // One decimal: at a four-second fuse, whole seconds would sit still for a
      // quarter of the window and read as frozen.
      const clock =
        entry.secondsRemaining === undefined ? "" : `${entry.secondsRemaining.toFixed(1)}s`;
      if (clock !== slot.prevClock) {
        slot.prevClock = clock;
        slot.clock.textContent = clock;
        slot.clock.classList.toggle("is-on", clock !== "");
      }
      const urgent = entry.urgency >= 0.6;
      if (urgent !== slot.prevUrgent) {
        slot.prevUrgent = urgent;
        slot.root.classList.toggle("is-urgent", urgent);
      }
      // Lifted clear of the projected point rather than centred on it. A label
      // sitting exactly on its subject hides the machine it is naming, which is
      // the one thing the player needs to look at.
      slot.root.style.transform = `translate(${Math.round(entry.screenX)}px, ${Math.round(
        entry.screenY,
      )}px) translate(-50%, calc(-50% - 22px))`;
    }
  }
}
