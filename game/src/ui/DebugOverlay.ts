/**
 * Developer stats panel. Hidden by default; the game toggles it from a debug
 * key. Rows are cached by key so a per-frame update writes text only where the
 * value actually changed.
 */

interface DebugRow {
  root: HTMLElement;
  value: HTMLElement;
  text: string;
  /** Cleared each update; a row not seen this pass is hidden. */
  seen: boolean;
}

export class DebugOverlay {
  private readonly root: HTMLElement;
  private readonly rows = new Map<string, DebugRow>();
  private visible_ = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "debug";
    parent.appendChild(this.root);
  }

  get visible(): boolean {
    return this.visible_;
  }

  setVisible(v: boolean): void {
    if (v === this.visible_) return;
    this.visible_ = v;
    this.root.classList.toggle("is-on", v);
  }

  toggle(): void {
    this.setVisible(!this.visible_);
  }

  update(stats: Record<string, string | number>): void {
    if (!this.visible_) return;

    for (const row of this.rows.values()) row.seen = false;

    for (const key in stats) {
      const raw = stats[key];
      const text = typeof raw === "number" ? formatNumber(raw) : raw;
      let row = this.rows.get(key);
      if (!row) {
        row = this.createRow(key);
        this.rows.set(key, row);
      }
      row.seen = true;
      if (row.root.style.display === "none") row.root.style.display = "";
      if (row.text !== text) {
        row.text = text;
        row.value.textContent = text;
      }
    }

    for (const row of this.rows.values()) {
      if (!row.seen && row.root.style.display !== "none") row.root.style.display = "none";
    }
  }

  dispose(): void {
    this.rows.clear();
    this.root.remove();
  }

  private createRow(key: string): DebugRow {
    const rowRoot = document.createElement("div");
    rowRoot.className = "debug__row";
    const keyEl = document.createElement("span");
    keyEl.className = "debug__key";
    keyEl.textContent = key;
    const valueEl = document.createElement("span");
    valueEl.className = "debug__val";
    rowRoot.appendChild(keyEl);
    rowRoot.appendChild(valueEl);
    this.root.appendChild(rowRoot);
    return { root: rowRoot, value: valueEl, text: "", seen: true };
  }
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return `${value}`;
  return value.toFixed(2);
}
