/**
 * Procedural geometry kit.
 *
 * Every builder returns a `BufferGeometry` carrying `position`, `normal` and a
 * per-vertex `color`, so any number of differently coloured parts can be merged
 * into a single buffer and drawn with one shared vertex-colour material. That
 * merge is the whole performance strategy: a character, a turret or a tree is
 * one draw call, not twenty.
 *
 * The chamfer is not decoration. A hard-edged box has no highlight variation
 * under a single key light and reads as untextured programmer art; a 2-4 cm
 * bevel gives every silhouette edge a bright rim and is what makes the low-poly
 * style hold together.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";

// Build-time scratch. Nothing here runs per frame, but reusing them keeps the
// forge allocation-free while it churns through a few thousand primitives.
const _matrix = new Matrix4();
const _quat = new Quaternion();
const _euler = new Euler();
const _position = new Vector3();
const _scale = new Vector3();
const _color = new Color();
const _edgeA = new Vector3();
const _edgeB = new Vector3();
const _normal = new Vector3();
const _centroid = new Vector3();

// ---------------------------------------------------------------------------
// Attribute plumbing
// ---------------------------------------------------------------------------

/**
 * Strips attributes the merged buffer does not carry and guarantees the three
 * that it does. `merge` refuses to interleave buffers with mismatched layouts,
 * so every primitive passes through here first.
 */
export function normalizeGeometry(geometry: BufferGeometry): BufferGeometry {
  geometry.deleteAttribute("uv");
  geometry.deleteAttribute("uv1");
  geometry.deleteAttribute("uv2");
  geometry.deleteAttribute("tangent");
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  if (!geometry.getAttribute("color")) applyColor(geometry, 0xffffff);
  return geometry;
}

/** Writes a flat vertex colour over every vertex, converting sRGB to working space. */
export function applyColor(geometry: BufferGeometry, hex: number): BufferGeometry {
  const count = geometry.attributes.position.count;
  const existing = geometry.getAttribute("color");
  const array = existing ? (existing.array as Float32Array) : new Float32Array(count * 3);
  _color.setHex(hex);
  for (let i = 0; i < count; i++) {
    array[i * 3] = _color.r;
    array[i * 3 + 1] = _color.g;
    array[i * 3 + 2] = _color.b;
  }
  if (!existing) geometry.setAttribute("color", new BufferAttribute(array, 3));
  else existing.needsUpdate = true;
  return geometry;
}

// ---------------------------------------------------------------------------
// Chamfered boxes
// ---------------------------------------------------------------------------

/**
 * Vertex slot for corner (sxi, syi, szi). Each corner is split into three
 * vertices, one pulled to each axis extreme, which is what opens the bevel.
 * axis: 0 = X extreme, 1 = Y extreme, 2 = Z extreme.
 */
function vid(sxi: number, syi: number, szi: number, axis: number): number {
  return (sxi * 4 + syi * 2 + szi) * 3 + axis;
}

/**
 * Emits one triangle with outward winding. Every shape built here is convex and
 * contains the origin, so the sign of `faceNormal . faceCentroid` is an exact
 * outward test and no face ordering has to be derived by hand.
 */
function pushTri(pos: Float32Array, idx: number[], a: number, b: number, c: number): void {
  const ax = pos[a * 3];
  const ay = pos[a * 3 + 1];
  const az = pos[a * 3 + 2];
  const bx = pos[b * 3];
  const by = pos[b * 3 + 1];
  const bz = pos[b * 3 + 2];
  const cx = pos[c * 3];
  const cy = pos[c * 3 + 1];
  const cz = pos[c * 3 + 2];
  _edgeA.set(bx - ax, by - ay, bz - az);
  _edgeB.set(cx - ax, cy - ay, cz - az);
  _normal.crossVectors(_edgeA, _edgeB);
  _centroid.set((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3);
  if (_normal.dot(_centroid) < 0) {
    idx.push(a, c, b);
  } else {
    idx.push(a, b, c);
  }
}

function pushQuad(pos: Float32Array, idx: number[], a: number, b: number, c: number, d: number): void {
  pushTri(pos, idx, a, b, c);
  pushTri(pos, idx, a, c, d);
}

function buildChamfered(
  widthBottom: number,
  widthTop: number,
  height: number,
  depthBottom: number,
  depthTop: number,
  chamfer: number,
  color: number,
): BufferGeometry {
  const halfH = Math.max(height, 1e-4) * 0.5;
  const hwB = Math.max(widthBottom, 1e-3) * 0.5;
  const hwT = Math.max(widthTop, 1e-3) * 0.5;
  const hdB = Math.max(depthBottom, 1e-3) * 0.5;
  const hdT = Math.max(depthTop, 1e-3) * 0.5;
  const c = Math.max(
    0.0008,
    Math.min(chamfer, Math.min(hwB, hwT) * 0.48, Math.min(hdB, hdT) * 0.48, halfH * 0.48),
  );

  const pos = new Float32Array(72);
  for (let sxi = 0; sxi < 2; sxi++) {
    for (let syi = 0; syi < 2; syi++) {
      for (let szi = 0; szi < 2; szi++) {
        const sx = sxi ? 1 : -1;
        const sy = syi ? 1 : -1;
        const sz = szi ? 1 : -1;
        const yExtreme = sy * halfH;
        const yInset = sy * (halfH - c);
        // Half extents are sampled at the vertex height so a tapered box keeps
        // its silhouette straight instead of stepping at each bevel.
        const tE = yExtreme / (halfH * 2) + 0.5;
        const tI = yInset / (halfH * 2) + 0.5;
        const hwE = hwB + (hwT - hwB) * tE;
        const hdE = hdB + (hdT - hdB) * tE;
        const hwI = hwB + (hwT - hwB) * tI;
        const hdI = hdB + (hdT - hdB) * tI;
        const base = vid(sxi, syi, szi, 0) * 3;
        pos[base] = sx * hwI;
        pos[base + 1] = yInset;
        pos[base + 2] = sz * (hdI - c);
        pos[base + 3] = sx * (hwE - c);
        pos[base + 4] = yExtreme;
        pos[base + 5] = sz * (hdE - c);
        pos[base + 6] = sx * (hwI - c);
        pos[base + 7] = yInset;
        pos[base + 8] = sz * hdI;
      }
    }
  }

  const idx: number[] = [];
  for (let s = 0; s < 2; s++) {
    pushQuad(pos, idx, vid(s, 0, 0, 0), vid(s, 0, 1, 0), vid(s, 1, 1, 0), vid(s, 1, 0, 0));
    pushQuad(pos, idx, vid(0, s, 0, 1), vid(0, s, 1, 1), vid(1, s, 1, 1), vid(1, s, 0, 1));
    pushQuad(pos, idx, vid(0, 0, s, 2), vid(0, 1, s, 2), vid(1, 1, s, 2), vid(1, 0, s, 2));
  }
  for (let a = 0; a < 2; a++) {
    for (let b = 0; b < 2; b++) {
      pushQuad(pos, idx, vid(0, a, b, 1), vid(0, a, b, 2), vid(1, a, b, 2), vid(1, a, b, 1));
      pushQuad(pos, idx, vid(a, 0, b, 0), vid(a, 0, b, 2), vid(a, 1, b, 2), vid(a, 1, b, 0));
      pushQuad(pos, idx, vid(a, b, 0, 0), vid(a, b, 0, 1), vid(a, b, 1, 1), vid(a, b, 1, 0));
    }
  }
  for (let sxi = 0; sxi < 2; sxi++) {
    for (let syi = 0; syi < 2; syi++) {
      for (let szi = 0; szi < 2; szi++) {
        pushTri(pos, idx, vid(sxi, syi, szi, 0), vid(sxi, syi, szi, 1), vid(sxi, syi, szi, 2));
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(pos, 3));
  geometry.setIndex(idx);
  geometry.computeVertexNormals();
  applyColor(geometry, color);
  return geometry;
}

/** 24 vertices, 44 triangles, every edge bevelled. The base unit of everything. */
export function chamferedBox(
  width: number,
  height: number,
  depth: number,
  chamfer: number,
  color: number,
): BufferGeometry {
  return buildChamfered(width, width, height, depth, depth, chamfer, color);
}

/** Same topology, but the cross-section interpolates from bottom to top. */
export function taperedBox(
  widthBottom: number,
  widthTop: number,
  height: number,
  depthBottom: number,
  depthTop: number,
  chamfer: number,
  color: number,
): BufferGeometry {
  return buildChamfered(widthBottom, widthTop, height, depthBottom, depthTop, chamfer, color);
}

/** A thin chamfered slab. Deck plates, brims, footings, armour panels. */
export function plate(
  width: number,
  depth: number,
  thickness: number,
  chamfer: number,
  color: number,
): BufferGeometry {
  return buildChamfered(width, width, thickness, depth, depth, Math.min(chamfer, thickness * 0.42), color);
}

// ---------------------------------------------------------------------------
// Round primitives
// ---------------------------------------------------------------------------

/** Y-axis cylinder or truncated cone, centred on the origin. */
export function cylinderish(
  radiusBottom: number,
  radiusTop: number,
  height: number,
  segments: number,
  color: number,
): BufferGeometry {
  const geometry = new CylinderGeometry(
    Math.max(radiusTop, 1e-4),
    Math.max(radiusBottom, 1e-4),
    Math.max(height, 1e-4),
    Math.max(3, segments | 0),
    1,
    false,
  );
  normalizeGeometry(geometry);
  applyColor(geometry, color);
  return geometry;
}

/**
 * Icosahedral ball. Even triangle distribution beats a UV sphere at these
 * segment counts and has no pole pinch.
 */
export function sphereish(radius: number, segments: number, color: number): BufferGeometry {
  const detail = segments <= 6 ? 0 : segments <= 11 ? 1 : 2;
  const geometry = new IcosahedronGeometry(Math.max(radius, 1e-4), detail);
  normalizeGeometry(geometry);
  applyColor(geometry, color);
  return geometry;
}

/** Y-axis cone, apex up, centred on the origin. */
export function coneish(radius: number, height: number, segments: number, color: number): BufferGeometry {
  const geometry = new ConeGeometry(
    Math.max(radius, 1e-4),
    Math.max(height, 1e-4),
    Math.max(3, segments | 0),
    1,
    false,
  );
  normalizeGeometry(geometry);
  applyColor(geometry, color);
  return geometry;
}

/** Y-axis tube with a collar at each end, centred on the origin. */
export function pipe(radius: number, length: number, segments: number, color: number): BufferGeometry {
  const seg = Math.max(3, segments | 0);
  const collar = Math.max(0.012, length * 0.07);
  return merge([
    cylinderish(radius, radius, length, seg, color),
    place(cylinderish(radius * 1.24, radius * 1.24, collar, seg, color), 0, length * 0.5 - collar * 0.6, 0),
    place(cylinderish(radius * 1.24, radius * 1.24, collar, seg, color), 0, -length * 0.5 + collar * 0.6, 0),
  ]);
}

/**
 * A ring of squashed rivet heads on the XZ plane. Rivets are the single
 * cheapest detail that sells the KayKit read on a large flat panel.
 */
export function rivetRing(radius: number, count: number, rivetRadius: number, color: number): BufferGeometry {
  const n = Math.max(3, count | 0);
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2;
    parts.push(
      place(
        sphereish(rivetRadius, 5, color),
        Math.cos(angle) * radius,
        0,
        Math.sin(angle) * radius,
        0,
        0,
        0,
        1,
        0.55,
        1,
      ),
    );
  }
  return merge(parts);
}

/** A straight run of rivet heads along the X axis, centred on the origin. */
export function rivetLine(length: number, count: number, rivetRadius: number, color: number): BufferGeometry {
  const n = Math.max(2, count | 0);
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    parts.push(place(sphereish(rivetRadius, 5, color), (t - 0.5) * length, 0, 0, 0, 0, 0, 1, 0.55, 1));
  }
  return merge(parts);
}

// ---------------------------------------------------------------------------
// Kitbashing
// ---------------------------------------------------------------------------

/** Transforms a geometry in place and returns it, for kitbashing. */
export function place(
  geometry: BufferGeometry,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
): BufferGeometry {
  _euler.set(rx, ry, rz);
  _quat.setFromEuler(_euler);
  _position.set(x, y, z);
  _scale.set(sx, sy, sz);
  _matrix.compose(_position, _quat, _scale);
  geometry.applyMatrix4(_matrix);
  return geometry;
}

/** Merges many coloured geometries into one. This is how you get 1 draw call. */
export function merge(geometries: BufferGeometry[]): BufferGeometry {
  if (geometries.length === 0) return new BufferGeometry();
  if (geometries.length === 1) return normalizeGeometry(geometries[0]);

  let vertexTotal = 0;
  let indexTotal = 0;
  for (let i = 0; i < geometries.length; i++) {
    const g = normalizeGeometry(geometries[i]);
    const count = g.attributes.position.count;
    vertexTotal += count;
    indexTotal += g.index ? g.index.count : count;
  }

  const position = new Float32Array(vertexTotal * 3);
  const normal = new Float32Array(vertexTotal * 3);
  const color = new Float32Array(vertexTotal * 3);
  const index = vertexTotal > 65534 ? new Uint32Array(indexTotal) : new Uint16Array(indexTotal);

  let vertexOffset = 0;
  let indexOffset = 0;
  for (let i = 0; i < geometries.length; i++) {
    const g = geometries[i];
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const c = g.attributes.color;
    const count = p.count;
    for (let v = 0; v < count; v++) {
      const o = (vertexOffset + v) * 3;
      position[o] = p.getX(v);
      position[o + 1] = p.getY(v);
      position[o + 2] = p.getZ(v);
      normal[o] = n.getX(v);
      normal[o + 1] = n.getY(v);
      normal[o + 2] = n.getZ(v);
      color[o] = c.getX(v);
      color[o + 1] = c.getY(v);
      color[o + 2] = c.getZ(v);
    }
    if (g.index) {
      const src = g.index;
      for (let k = 0; k < src.count; k++) index[indexOffset + k] = src.getX(k) + vertexOffset;
      indexOffset += src.count;
    } else {
      for (let k = 0; k < count; k++) index[indexOffset + k] = vertexOffset + k;
      indexOffset += count;
    }
    vertexOffset += count;
  }

  const merged = new BufferGeometry();
  merged.setAttribute("position", new BufferAttribute(position, 3));
  merged.setAttribute("normal", new BufferAttribute(normal, 3));
  merged.setAttribute("color", new BufferAttribute(color, 3));
  merged.setIndex(new BufferAttribute(index, 1));
  merged.computeBoundingSphere();
  return merged;
}

// ---------------------------------------------------------------------------
// Value noise
// ---------------------------------------------------------------------------

function latticeHash(xi: number, yi: number, zi: number, seed: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (xi + 0x9e37), 0x27d4eb2d);
  h = Math.imul(h ^ (yi + 0x85eb), 0x165667b1);
  h = Math.imul(h ^ (zi + 0xc2b2), 0x1b873593);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Trilinear value noise in [0, 1). Smooth, so it produces patches not confetti. */
function valueNoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const u = fade(x - xi);
  const v = fade(y - yi);
  const w = fade(z - zi);
  const c000 = latticeHash(xi, yi, zi, seed);
  const c100 = latticeHash(xi + 1, yi, zi, seed);
  const c010 = latticeHash(xi, yi + 1, zi, seed);
  const c110 = latticeHash(xi + 1, yi + 1, zi, seed);
  const c001 = latticeHash(xi, yi, zi + 1, seed);
  const c101 = latticeHash(xi + 1, yi, zi + 1, seed);
  const c011 = latticeHash(xi, yi + 1, zi + 1, seed);
  const c111 = latticeHash(xi + 1, yi + 1, zi + 1, seed);
  const x00 = c000 + (c100 - c000) * u;
  const x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u;
  const x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v;
  const y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

/**
 * Applies a per-vertex value noise tint, so large flats are not dead flat.
 * `amount` is the peak relative swing, so 0.07 means +/-7% brightness.
 */
export function tint(geometry: BufferGeometry, amount: number, seed: number): BufferGeometry {
  const colorAttr = geometry.getAttribute("color");
  const positionAttr = geometry.getAttribute("position");
  if (!colorAttr || !positionAttr) return geometry;
  const array = colorAttr.array as Float32Array;
  const frequency = 1.7;
  for (let i = 0; i < positionAttr.count; i++) {
    const n = valueNoise(
      positionAttr.getX(i) * frequency,
      positionAttr.getY(i) * frequency,
      positionAttr.getZ(i) * frequency,
      seed,
    );
    const factor = 1 + (n - 0.5) * 2 * amount;
    const o = i * 3;
    array[o] = Math.min(1, Math.max(0, array[o] * factor));
    array[o + 1] = Math.min(1, Math.max(0, array[o + 1] * factor));
    array[o + 2] = Math.min(1, Math.max(0, array[o + 2] * factor));
  }
  colorAttr.needsUpdate = true;
  return geometry;
}

/**
 * Displaces vertices by lattice-sampled noise. Positions are quantised before
 * hashing so coincident vertices move together and the shell stays watertight.
 */
export function jitter(geometry: BufferGeometry, amount: number, seed: number): BufferGeometry {
  const positionAttr = geometry.getAttribute("position");
  if (!positionAttr) return geometry;
  const array = positionAttr.array as Float32Array;
  for (let i = 0; i < positionAttr.count; i++) {
    const o = i * 3;
    const qx = Math.round(array[o] * 64);
    const qy = Math.round(array[o + 1] * 64);
    const qz = Math.round(array[o + 2] * 64);
    array[o] += (latticeHash(qx, qy, qz, seed) - 0.5) * 2 * amount;
    array[o + 1] += (latticeHash(qx, qy, qz, seed ^ 0x5bf03635) - 0.5) * 2 * amount;
    array[o + 2] += (latticeHash(qx, qy, qz, seed ^ 0x2f5b7c31) - 0.5) * 2 * amount;
  }
  positionAttr.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Total vertices across a geometry list, for the build-time budget report. */
export function vertexCount(geometry: BufferGeometry): number {
  const p = geometry.getAttribute("position");
  return p ? p.count : 0;
}
