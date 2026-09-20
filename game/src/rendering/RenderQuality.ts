export interface RenderQuality {
  readonly name: "mobile" | "desktop";
  readonly maxDpr: number;
  readonly pixelBudget: number;
  readonly shadows: boolean;
  readonly antialias: boolean;
  readonly maxAnimatedEnemies: number;
  readonly decorationStride: number;
}
export const DESKTOP_QUALITY: RenderQuality = Object.freeze({ name: "desktop", maxDpr: 1.5, pixelBudget: 3_000_000, shadows: true, antialias: true, maxAnimatedEnemies: 64, decorationStride: 1 });
export const MOBILE_QUALITY: RenderQuality = Object.freeze({ name: "mobile", maxDpr: 1.25, pixelBudget: 700_000, shadows: false, antialias: false, maxAnimatedEnemies: 32, decorationStride: 3 });
export function chooseQuality(coarsePointer: boolean, touchPoints: number, userAgent: string, override = ""): RenderQuality {
  if (override === "low") return MOBILE_QUALITY;
  if (override === "high") return DESKTOP_QUALITY;
  return coarsePointer && touchPoints > 0 || /Android|iPhone|iPad|iPod/i.test(userAgent) ? MOBILE_QUALITY : DESKTOP_QUALITY;
}
export function detectQuality(): RenderQuality {
  if (typeof window === "undefined") return DESKTOP_QUALITY;
  return chooseQuality(window.matchMedia?.("(pointer: coarse)").matches ?? false, navigator.maxTouchPoints ?? 0, navigator.userAgent, new URLSearchParams(location.search).get("quality") ?? "");
}
export function drawingRatio(width: number, height: number, nativeDpr: number, quality: RenderQuality, scale = 1): number {
  return Math.min(Math.max(0.1, nativeDpr || 1), quality.maxDpr, Math.sqrt(quality.pixelBudget / Math.max(1, width * height))) * scale;
}
/** Slow, bounded resolution changes only. No simulation or input throttling. */
export class AdaptiveResolution {
  scale = 1;
  private elapsed = 0;
  private frames = 0;
  private healthy = 0;
  sample(dt: number): boolean {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1) { this.elapsed = this.frames = this.healthy = 0; return false; }
    this.elapsed += dt; this.frames++;
    if (this.elapsed < 2.5) return false;
    const mean = this.elapsed / this.frames;
    this.elapsed = this.frames = 0;
    const previous = this.scale;
    if (mean > 0.024) { this.scale = Math.max(0.75, this.scale - 0.125); this.healthy = 0; }
    else if (mean < 0.018) { if (++this.healthy >= 4) { this.scale = Math.min(1, this.scale + 0.125); this.healthy = 0; } }
    else this.healthy = 0;
    return previous !== this.scale;
  }
}
