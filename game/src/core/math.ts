/**
 * XZ-plane math helpers. The whole simulation is 2D on the ground plane; Y is
 * only ever a render concern. Everything here is allocation-free: functions
 * either return scalars or write into a caller-supplied output object.
 */

export interface Vec2 {
  x: number;
  z: number;
}

export function vec2(x = 0, z = 0): Vec2 {
  return { x, z };
}

export function set(out: Vec2, x: number, z: number): Vec2 {
  out.x = x;
  out.z = z;
  return out;
}

export function copy(out: Vec2, a: Vec2): Vec2 {
  out.x = a.x;
  out.z = a.z;
  return out;
}

export function add(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out.x = a.x + b.x;
  out.z = a.z + b.z;
  return out;
}

export function sub(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out.x = a.x - b.x;
  out.z = a.z - b.z;
  return out;
}

export function scale(out: Vec2, a: Vec2, s: number): Vec2 {
  out.x = a.x * s;
  out.z = a.z * s;
  return out;
}

export function addScaled(out: Vec2, a: Vec2, b: Vec2, s: number): Vec2 {
  out.x = a.x + b.x * s;
  out.z = a.z + b.z * s;
  return out;
}

export function lengthSq(a: Vec2): number {
  return a.x * a.x + a.z * a.z;
}

export function length(a: Vec2): number {
  return Math.sqrt(a.x * a.x + a.z * a.z);
}

/** Squared distance. Prefer this in hot loops; never take the root to compare. */
export function distSq(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

export function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.sqrt(distSq(ax, az, bx, bz));
}

export function normalize(out: Vec2, a: Vec2): Vec2 {
  const len = Math.sqrt(a.x * a.x + a.z * a.z);
  if (len < 1e-8) {
    out.x = 0;
    out.z = 0;
  } else {
    out.x = a.x / len;
    out.z = a.z / len;
  }
  return out;
}

/** Clamps a vector's magnitude in place. Returns the vector for chaining. */
export function limit(out: Vec2, max: number): Vec2 {
  const lenSq = out.x * out.x + out.z * out.z;
  if (lenSq > max * max && lenSq > 1e-12) {
    const s = max / Math.sqrt(lenSq);
    out.x *= s;
    out.z *= s;
  }
  return out;
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.z * b.z;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, value: number): number {
  if (Math.abs(b - a) < 1e-9) return 0;
  return clamp01((value - a) / (b - a));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = inverseLerp(edge0, edge1, x);
  return t * t * (3 - 2 * t);
}

/**
 * Frame-rate independent exponential approach. `halfLife` is the time in
 * seconds for the remaining gap to halve.
 */
export function damp(current: number, target: number, halfLife: number, dt: number): number {
  if (halfLife <= 0) return target;
  return target + (current - target) * Math.pow(2, -dt / halfLife);
}

export function dampVec2(out: Vec2, target: Vec2, halfLife: number, dt: number): Vec2 {
  const factor = halfLife <= 0 ? 0 : Math.pow(2, -dt / halfLife);
  out.x = target.x + (out.x - target.x) * factor;
  out.z = target.z + (out.z - target.z) * factor;
  return out;
}

/** Shortest signed angular difference in radians, in (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Rotates `from` toward `to` by at most `maxStep` radians. */
export function rotateToward(from: number, to: number, maxStep: number): number {
  const d = angleDelta(from, to);
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}

export function dampAngle(current: number, target: number, halfLife: number, dt: number): number {
  const d = angleDelta(current, target);
  return current + d * (1 - Math.pow(2, -dt / halfLife));
}

/** Heading in radians for an XZ direction, matching Three.js `rotation.y`. */
export function headingFromDirection(x: number, z: number): number {
  return Math.atan2(x, z);
}

/**
 * Signed perpendicular distance from point P to the infinite line through A
 * with unit direction D. Positive is to the left of D.
 */
export function signedLateralOffset(
  px: number,
  pz: number,
  ax: number,
  az: number,
  dx: number,
  dz: number,
): number {
  return (px - ax) * dz - (pz - az) * dx;
}

/** True when point P lies inside a circle. Avoids a square root. */
export function pointInCircle(px: number, pz: number, cx: number, cz: number, r: number): boolean {
  return distSq(px, pz, cx, cz) <= r * r;
}

/** Closest point on segment AB to P, written into `out`. Returns the parameter t. */
export function closestPointOnSegment(
  out: Vec2,
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const abx = bx - ax;
  const abz = bz - az;
  const lenSq = abx * abx + abz * abz;
  if (lenSq < 1e-9) {
    out.x = ax;
    out.z = az;
    return 0;
  }
  const t = clamp01(((px - ax) * abx + (pz - az) * abz) / lenSq);
  out.x = ax + abx * t;
  out.z = az + abz * t;
  return t;
}

export const TAU = Math.PI * 2;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
