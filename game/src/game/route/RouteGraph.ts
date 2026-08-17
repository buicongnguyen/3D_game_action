import type { RouteSegmentDefinition } from "../../core/types.ts";
import { getSegment } from "../../data/routes.ts";
import { RouteSpline } from "./RouteSpline.ts";

/**
 * Lookup and cache over the authored route table.
 *
 * Building a spline resamples the curve a few hundred times, so splines are
 * built lazily on first use and kept for the lifetime of the run - a segment
 * revisited by a replay or a debug jump must produce byte-identical geometry.
 */
export class RouteGraph {
  private readonly splines = new Map<string, RouteSpline>();

  getSegment(id: string): RouteSegmentDefinition {
    return getSegment(id);
  }

  getSpline(id: string): RouteSpline {
    const cached = this.splines.get(id);
    if (cached) return cached;
    const spline = new RouteSpline(getSegment(id).points);
    this.splines.set(id, spline);
    return spline;
  }

  /** True when a spline has already been built; used by preload heuristics. */
  hasSpline(id: string): boolean {
    return this.splines.has(id);
  }
}
