/**
 * Build radial: hold L1, push the right stick, release.
 *
 * The stick-angle mapping is a pure exported function because it is the one
 * piece of this file with real behaviour worth testing; everything else is
 * element bookkeeping.
 */

import { wrapIndex } from "./FocusManager.ts";

export interface RadialEntry {
  icon: string;
  name: string;
  cost: number;
  accent: number;
  affordable: boolean;
}

/**
 * Selection dead zone. Larger than the movement dead zone on purpose: a
 * blueprint choice must never change because the stick drifted.
 */
export const RADIAL_DEAD_ZONE = 0.35;

/**
 * Maps a right-stick vector to a slice index.
 *
 * Stick coordinates use the raw gamepad convention where `y = -1` is up, so
 * up is slice 0 and the ring runs clockwise. Inside the dead zone the current
 * selection is returned unchanged.
 */
export function radialIndexFromStick(
  x: number,
  y: number,
  count: number,
  deadZone = RADIAL_DEAD_ZONE,
  current = 0,
): number {
  if (count <= 0) return -1;
  const magnitude = Math.hypot(x, y);
  if (magnitude <= deadZone) return current;
  const angle = Math.atan2(x, -y);
  const slice = (Math.PI * 2) / count;
  return wrapIndex(Math.round(angle / slice), count);
}

function hex(color: number): string {
  return `#${(color >>> 0).toString(16).padStart(6, "0")}`;
}

function element(tag: string, className: string, parent: HTMLElement | null): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

interface Slice {
  root: HTMLElement;
  icon: HTMLElement;
  name: HTMLElement;
  cost: HTMLElement;
}

export class RadialMenu {
  private readonly root: HTMLElement;
  private readonly dial: HTMLElement;
  private readonly wedge: HTMLElement;
  private readonly centerName: HTMLElement;
  private readonly centerHint: HTMLElement;
  private readonly slices: Slice[] = [];

  private open_ = false;
  private selected = 0;
  private count = 0;

  constructor(root: HTMLElement) {
    this.root = element("div", "radial", root);
    this.dial = element("div", "radial__dial", this.root);
    element("div", "radial__disc", this.dial);
    this.wedge = element("div", "radial__wedge", this.dial);
    element("div", "radial__spokes", this.dial);
    const center = element("div", "radial__center", this.dial);
    this.centerName = element("div", "radial__center-name", center);
    this.centerHint = element("div", "radial__center-hint", center);
    this.centerHint.textContent = "RELEASE TO PLACE";
  }

  get isOpen(): boolean {
    return this.open_;
  }

  get selectedIndex(): number {
    return this.selected;
  }

  /** Opens the radial on `entries`, keeping the previous slice if it still exists. */
  open(entries: readonly RadialEntry[]): void {
    this.count = entries.length;
    this.ensureSlices(entries.length);

    const span = entries.length > 0 ? 360 / entries.length : 360;
    this.wedge.style.setProperty("--wedge-span", `${span}deg`);

    for (let i = 0; i < this.slices.length; i++) {
      const slice = this.slices[i];
      if (i >= entries.length) {
        slice.root.style.display = "none";
        continue;
      }
      const entry = entries[i];
      slice.root.style.display = "";
      slice.root.style.setProperty("--slice-angle", `${i * span}deg`);
      slice.root.style.setProperty("--slice-accent", hex(entry.accent));
      slice.root.classList.toggle("is-poor", !entry.affordable);
      slice.icon.textContent = entry.icon;
      slice.name.textContent = entry.name;
      slice.cost.textContent = `${entry.cost}`;
    }

    if (this.selected >= entries.length) this.selected = 0;
    this.open_ = true;
    this.root.classList.add("is-open");
    this.applySelection(this.selected, entries);
  }

  /** Right-stick aim. Cheap enough to call every frame; only diffs touch DOM. */
  aim(x: number, y: number): number {
    if (!this.open_ || this.count === 0) return this.selected;
    const index = radialIndexFromStick(x, y, this.count, RADIAL_DEAD_ZONE, this.selected);
    if (index !== this.selected) this.applySelection(index, null);
    return this.selected;
  }

  /** Closes the radial and reports the slice the player settled on. */
  close(): number {
    this.open_ = false;
    this.root.classList.remove("is-open");
    return this.selected;
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle("is-open", visible && this.open_);
  }

  dispose(): void {
    this.slices.length = 0;
    this.root.remove();
  }

  private applySelection(index: number, entries: readonly RadialEntry[] | null): void {
    const previous = this.slices[this.selected];
    if (previous) previous.root.classList.remove("is-selected");
    this.selected = index;
    const slice = this.slices[index];
    if (!slice) return;
    slice.root.classList.add("is-selected");

    const span = this.count > 0 ? 360 / this.count : 360;
    this.wedge.style.setProperty("--wedge-angle", `${index * span}deg`);
    if (entries && entries[index]) {
      this.wedge.style.setProperty("--wedge-accent", hex(entries[index].accent));
    } else {
      const accent = slice.root.style.getPropertyValue("--slice-accent");
      if (accent) this.wedge.style.setProperty("--wedge-accent", accent);
    }
    this.centerName.textContent = slice.name.textContent;
  }

  private ensureSlices(needed: number): void {
    while (this.slices.length < needed) {
      const root = element("div", "radial__slice", this.dial);
      this.slices.push({
        root,
        icon: element("div", "radial__icon", root),
        name: element("div", "radial__name", root),
        cost: element("div", "radial__cost", root),
      });
    }
  }
}
