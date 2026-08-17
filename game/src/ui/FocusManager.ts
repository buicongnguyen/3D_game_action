/**
 * Controller-first focus handling for every menu in the game.
 *
 * The index arithmetic and the repeat gate are exported as pure functions so
 * they can be unit-tested without a DOM; the class is a thin binding of that
 * logic to elements.
 */

/** Milliseconds before a held direction starts to repeat. */
export const FOCUS_REPEAT_DELAY_MS = 340;
/** Milliseconds between repeats once repeating has started. */
export const FOCUS_REPEAT_RATE_MS = 125;

export interface RepeatState {
  dirX: number;
  dirY: number;
  /** Timestamp at which the next repeat becomes legal. */
  nextTimeMs: number;
}

export function createRepeatState(): RepeatState {
  return { dirX: 0, dirY: 0, nextTimeMs: 0 };
}

export function resetRepeatState(state: RepeatState): void {
  state.dirX = 0;
  state.dirY = 0;
  state.nextTimeMs = 0;
}

export function wrapIndex(index: number, count: number): number {
  if (count <= 0) return -1;
  return ((index % count) + count) % count;
}

/**
 * Grid-aware directional step with wrapping.
 *
 * A group with one column treats horizontal input as a linear step, and a
 * group with one row treats vertical input the same way. That forgiveness is
 * deliberate: on a gamepad the player pushes roughly, not exactly, and a menu
 * that ignores a near-diagonal push feels broken.
 */
export function nextFocusIndex(
  current: number,
  count: number,
  dx: number,
  dy: number,
  columns = 1,
): number {
  if (count <= 0) return -1;
  const cols = Math.max(1, Math.min(Math.floor(columns), count));
  const rows = Math.ceil(count / cols);
  let index = current < 0 || current >= count ? 0 : current;

  const stepX = Math.sign(dx);
  if (stepX !== 0) {
    if (cols === 1) {
      index = wrapIndex(index + stepX, count);
    } else {
      const rowStart = Math.floor(index / cols) * cols;
      const rowCount = Math.min(cols, count - rowStart);
      index = rowStart + wrapIndex((index - rowStart) + stepX, rowCount);
    }
  }

  const stepY = Math.sign(dy);
  if (stepY !== 0) {
    if (rows === 1) {
      index = wrapIndex(index + stepY, count);
    } else {
      const col = index % cols;
      let row = Math.floor(index / cols);
      for (let attempt = 0; attempt < rows; attempt++) {
        row = wrapIndex(row + stepY, rows);
        const candidate = row * cols + col;
        if (candidate < count) {
          index = candidate;
          break;
        }
      }
    }
  }

  return index;
}

/**
 * Gate for held directional input: the first push is always accepted, then
 * nothing until `delayMs`, then one step every `rateMs`. Releasing or changing
 * direction rearms the gate immediately.
 */
export function acceptRepeat(
  state: RepeatState,
  dx: number,
  dy: number,
  nowMs: number,
  delayMs = FOCUS_REPEAT_DELAY_MS,
  rateMs = FOCUS_REPEAT_RATE_MS,
): boolean {
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);

  if (stepX === 0 && stepY === 0) {
    resetRepeatState(state);
    return false;
  }

  if (stepX !== state.dirX || stepY !== state.dirY) {
    state.dirX = stepX;
    state.dirY = stepY;
    state.nextTimeMs = nowMs + delayMs;
    return true;
  }

  if (nowMs >= state.nextTimeMs) {
    state.nextTimeMs = nowMs + rateMs;
    return true;
  }

  return false;
}

function defaultClock(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

interface SavedGroup {
  items: HTMLElement[];
  index: number;
  columns: number;
}

/**
 * Owns "which element is focused" for one modal surface. Elements are focused
 * in DOM order; `data-disabled="true"` entries are skipped rather than being
 * focusable dead ends.
 */
export class FocusManager {
  private readonly root: HTMLElement;
  private readonly clock: () => number;
  private readonly repeat: RepeatState = createRepeatState();
  private readonly stack: SavedGroup[] = [];

  private items: HTMLElement[] = [];
  private columns = 1;
  private index = -1;

  constructor(root: HTMLElement, clock: () => number = defaultClock) {
    this.root = root;
    this.clock = clock;
  }

  get focusedIndex(): number {
    return this.index;
  }

  get focused(): HTMLElement | null {
    if (this.index < 0 || this.index >= this.items.length) return null;
    return this.items[this.index];
  }

  get count(): number {
    return this.items.length;
  }

  /** Registers a navigable group. `columns` > 1 turns it into a grid. */
  setGroup(items: HTMLElement[], initialIndex = 0, columns = 1): void {
    this.clearMarks();
    this.items = items;
    this.columns = Math.max(1, Math.floor(columns));
    this.index = -1;
    resetRepeatState(this.repeat);
    this.root.classList.toggle("has-focus", items.length > 0);
    if (items.length === 0) return;
    const start = initialIndex < 0 || initialIndex >= items.length ? 0 : initialIndex;
    this.applyIndex(this.firstEnabledFrom(start, 1));
  }

  /** Directional move with controlled repeat. Call every frame; (0,0) rearms. */
  move(dx: number, dy: number): void {
    if (this.items.length === 0) return;
    if (!acceptRepeat(this.repeat, dx, dy, this.clock())) return;

    const count = this.items.length;
    let candidate = this.index;
    for (let attempt = 0; attempt < count; attempt++) {
      candidate = nextFocusIndex(candidate, count, dx, dy, this.columns);
      if (candidate === this.index) break;
      if (!this.isDisabled(candidate)) {
        this.applyIndex(candidate);
        return;
      }
    }
  }

  /** Focuses an explicit index, skipping forward past disabled entries. */
  setIndex(index: number): void {
    if (this.items.length === 0) return;
    this.applyIndex(this.firstEnabledFrom(index, 1));
  }

  /** Fires a click on the focused item, which is the single activation path. */
  activate(): void {
    const element = this.focused;
    if (!element) return;
    if (this.isDisabled(this.index)) return;
    element.click();
  }

  /** Saves the current group so a nested modal can take over the input. */
  push(): void {
    this.stack.push({ items: this.items, index: this.index, columns: this.columns });
    this.clearMarks();
    this.items = [];
    this.index = -1;
    resetRepeatState(this.repeat);
  }

  /** Restores the group saved by the matching `push`. */
  pop(): void {
    const saved = this.stack.pop();
    if (!saved) return;
    this.clearMarks();
    this.items = saved.items;
    this.columns = saved.columns;
    this.index = -1;
    resetRepeatState(this.repeat);
    this.root.classList.toggle("has-focus", saved.items.length > 0);
    if (saved.items.length === 0) return;
    this.applyIndex(saved.index < 0 ? 0 : saved.index);
  }

  clear(): void {
    this.clearMarks();
    this.items = [];
    this.index = -1;
    this.columns = 1;
    resetRepeatState(this.repeat);
    this.root.classList.toggle("has-focus", false);
  }

  private isDisabled(index: number): boolean {
    const element = this.items[index];
    if (!element) return true;
    return element.dataset.disabled === "true";
  }

  private firstEnabledFrom(start: number, direction: number): number {
    const count = this.items.length;
    let index = start < 0 || start >= count ? 0 : start;
    for (let attempt = 0; attempt < count; attempt++) {
      if (!this.isDisabled(index)) return index;
      index = wrapIndex(index + direction, count);
    }
    return start < 0 || start >= count ? 0 : start;
  }

  private applyIndex(index: number): void {
    if (index === this.index) return;
    const previous = this.items[this.index];
    if (previous) {
      previous.classList.remove("is-focused");
      previous.dataset.focused = "false";
    }
    this.index = index;
    const element = this.items[index];
    if (!element) return;
    element.classList.add("is-focused");
    element.dataset.focused = "true";
    if (typeof element.focus === "function") element.focus();
  }

  private clearMarks(): void {
    for (let i = 0; i < this.items.length; i++) {
      this.items[i].classList.remove("is-focused");
      this.items[i].dataset.focused = "false";
    }
  }
}
