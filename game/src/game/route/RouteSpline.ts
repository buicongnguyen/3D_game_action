import { CatmullRomCurve3, Vector3 } from "three";
import type { Vec2 } from "../../core/math.ts";
import {
  closestPointOnSegment,
  headingFromDirection,
  signedLateralOffset,
} from "../../core/math.ts";

/**
 * Arc-length parameterised route curve.
 *
 * The spider's canonical state is `distanceAlongRoute` in metres, so every
 * query here is keyed on metres rather than the curve parameter `u`. A
 * CatmullRom's `u` is not proportional to arc length - stepping `u` at a
 * constant rate speeds up through curves and slows down on straights - so the
 * curve is densely resampled once at construction and a prefix-sum table of
 * chord lengths is built. Distance queries binary-search that table and
 * interpolate between adjacent samples, which makes constant metres per second
 * actually constant on the ground.
 *
 * Sample spacing is roughly 0.2 m, so the linear interpolation error against
 * the true curve is well under a millimetre at the route's curvature.
 */

const scratchProjection: Vec2 = { x: 0, z: 0 };
const scratchTangent: Vec2 = { x: 0, z: 0 };
const scratchSegment: Vec2 = { x: 0, z: 0 };

export class RouteSpline {
  /** Total arc length in metres. */
  readonly length: number;

  private readonly sampleX: Float64Array;
  private readonly sampleZ: Float64Array;
  private readonly tangentX: Float64Array;
  private readonly tangentZ: Float64Array;
  /** Arc length from the start to each sample; strictly non-decreasing. */
  private readonly cumulative: Float64Array;

  constructor(points: ReadonlyArray<readonly [number, number, number]>, samples = 0) {
    if (points.length < 2) {
      throw new Error(`RouteSpline needs at least 2 control points, got ${points.length}`);
    }

    const controls: Vector3[] = new Array(points.length);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      controls[i] = new Vector3(p[0], p[1], p[2]);
    }
    // Centripetal parameterisation is what keeps the authored points free of
    // cusps and overshoot where the corridor doubles back.
    const curve = new CatmullRomCurve3(controls, false, "centripetal");

    const spans = samples > 0 ? Math.max(2, Math.floor(samples)) : Math.max(128, (points.length - 1) * 128);
    const count = spans + 1;

    const sx = new Float64Array(count);
    const sz = new Float64Array(count);
    const cum = new Float64Array(count);
    const tx = new Float64Array(count);
    const tz = new Float64Array(count);

    const probe = new Vector3();
    for (let i = 0; i < count; i++) {
      curve.getPoint(i / spans, probe);
      sx[i] = probe.x;
      sz[i] = probe.z;
    }

    cum[0] = 0;
    for (let i = 1; i < count; i++) {
      const dx = sx[i] - sx[i - 1];
      const dz = sz[i] - sz[i - 1];
      cum[i] = cum[i - 1] + Math.sqrt(dx * dx + dz * dz);
    }

    for (let i = 0; i < count; i++) {
      const back = i > 0 ? i - 1 : 0;
      const forward = i < count - 1 ? i + 1 : count - 1;
      let dx = sx[forward] - sx[back];
      let dz = sz[forward] - sz[back];
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 1e-9) {
        dx = 0;
        dz = 1;
      } else {
        dx /= len;
        dz /= len;
      }
      tx[i] = dx;
      tz[i] = dz;
    }

    this.sampleX = sx;
    this.sampleZ = sz;
    this.cumulative = cum;
    this.tangentX = tx;
    this.tangentZ = tz;
    this.length = cum[count - 1];
  }

  /** Position at a distance in metres. Writes into `out`; no allocation. */
  positionAt(out: Vec2, distance: number): void {
    const d = distance < 0 ? 0 : distance > this.length ? this.length : distance;
    const i = this.locate(d);
    const cum = this.cumulative;
    const span = cum[i + 1] - cum[i];
    const t = span > 1e-9 ? (d - cum[i]) / span : 0;
    out.x = this.sampleX[i] + (this.sampleX[i + 1] - this.sampleX[i]) * t;
    out.z = this.sampleZ[i] + (this.sampleZ[i + 1] - this.sampleZ[i]) * t;
  }

  /** Unit tangent at a distance in metres. Writes into `out`; no allocation. */
  tangentAt(out: Vec2, distance: number): void {
    const d = distance < 0 ? 0 : distance > this.length ? this.length : distance;
    const i = this.locate(d);
    const cum = this.cumulative;
    const span = cum[i + 1] - cum[i];
    const t = span > 1e-9 ? (d - cum[i]) / span : 0;
    let x = this.tangentX[i] + (this.tangentX[i + 1] - this.tangentX[i]) * t;
    let z = this.tangentZ[i] + (this.tangentZ[i + 1] - this.tangentZ[i]) * t;
    const len = Math.sqrt(x * x + z * z);
    if (len < 1e-9) {
      x = 0;
      z = 1;
    } else {
      x /= len;
      z /= len;
    }
    out.x = x;
    out.z = z;
  }

  /** Heading in radians at a distance, matching Three.js `rotation.y`. */
  headingAt(distance: number): number {
    this.tangentAt(scratchTangent, distance);
    return headingFromDirection(scratchTangent.x, scratchTangent.z);
  }

  /**
   * Nearest point on the spline to a world position. Returns the distance
   * along the route in metres and writes the closest point into `out`.
   */
  projectPoint(out: Vec2, worldX: number, worldZ: number): number {
    const sx = this.sampleX;
    const sz = this.sampleZ;
    const cum = this.cumulative;
    const count = sx.length;

    let best = 0;
    let bestSq = Infinity;
    for (let i = 0; i < count; i++) {
      const dx = worldX - sx[i];
      const dz = worldZ - sz[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < bestSq) {
        bestSq = d2;
        best = i;
      }
    }

    out.x = sx[best];
    out.z = sz[best];
    let distance = cum[best];
    let refinedSq = bestSq;

    const first = best > 0 ? best - 1 : 0;
    const last = best < count - 1 ? best : count - 2;
    for (let i = first; i <= last; i++) {
      const t = closestPointOnSegment(scratchSegment, worldX, worldZ, sx[i], sz[i], sx[i + 1], sz[i + 1]);
      const dx = worldX - scratchSegment.x;
      const dz = worldZ - scratchSegment.z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= refinedSq) {
        refinedSq = d2;
        out.x = scratchSegment.x;
        out.z = scratchSegment.z;
        distance = cum[i] + (cum[i + 1] - cum[i]) * t;
      }
    }

    return distance;
  }

  /** Signed lateral offset from the centreline; positive is left of travel. */
  lateralOffset(worldX: number, worldZ: number): number {
    const distance = this.projectPoint(scratchProjection, worldX, worldZ);
    this.tangentAt(scratchTangent, distance);
    return signedLateralOffset(
      worldX,
      worldZ,
      scratchProjection.x,
      scratchProjection.z,
      scratchTangent.x,
      scratchTangent.z,
    );
  }

  /** Index `i` such that `cumulative[i] <= distance <= cumulative[i + 1]`. */
  private locate(distance: number): number {
    const cum = this.cumulative;
    const top = cum.length - 2;
    if (distance <= 0) return 0;
    if (distance >= this.length) return top;
    let lo = 0;
    let hi = top;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= distance) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}
