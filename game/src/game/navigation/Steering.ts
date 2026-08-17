import type { Vec2 } from "../../core/math.ts";
import { limit } from "../../core/math.ts";
import { NAVIGATION } from "../../data/balance.ts";
import type { FlowField } from "./FlowField.ts";
import type { NavigationGrid } from "./NavigationGrid.ts";

/**
 * Allocation-free steering primitives for the horde.
 *
 * Every function writes into a caller-supplied `Vec2` and reads only numbers,
 * flat arrays and index lists. Nothing here creates an object, a closure or an
 * array literal, because these run once per active enemy per tick — 260 times
 * at 60 Hz in the stress scenario.
 *
 * Behaviours are produced in "desired velocity" form (already scaled to the
 * agent's max speed) and mixed by `combine`, which applies the weights from
 * `NAVIGATION` and clamps the result.
 */

/** The minimum an agent must expose to participate in steering. */
export interface SteeringAgent {
  x: number;
  z: number;
  radius: number;
}

/** Per-caller scratch, allocated once and reused every tick. */
export interface SteeringScratch {
  seek: Vec2;
  separation: Vec2;
  avoid: Vec2;
}

export function createSteeringScratch(): SteeringScratch {
  return {
    seek: { x: 0, z: 0 },
    separation: { x: 0, z: 0 },
    avoid: { x: 0, z: 0 },
  };
}

/** Golden angle, used to break ties between exactly coincident agents. */
const GOLDEN_ANGLE = 2.399963229728653;

/** Extra clearance added to the pair radius when agents are larger than usual. */
const PAIR_CLEARANCE = 0.15;

/** Lateral whisker weight relative to the local blocked-cell repulsion. */
const WHISKER_WEIGHT = 2;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Desired velocity straight at a point, at full speed. Zero when coincident. */
export function seek(
  out: Vec2,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  maxSpeed: number,
): void {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length < 1e-6) {
    out.x = 0;
    out.z = 0;
    return;
  }
  const scale = maxSpeed / length;
  out.x = dx * scale;
  out.z = dz * scale;
}

/**
 * Seek that eases off inside `slowRadius`, so an enemy settling onto its attack
 * position does not oscillate around it.
 */
export function arrive(
  out: Vec2,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  maxSpeed: number,
  slowRadius: number,
): void {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length < 1e-6) {
    out.x = 0;
    out.z = 0;
    return;
  }
  const speed = slowRadius > 0 && length < slowRadius ? (maxSpeed * length) / slowRadius : maxSpeed;
  const scale = speed / length;
  out.x = dx * scale;
  out.z = dz * scale;
}

/** Desired velocity directly away from a point. */
export function flee(
  out: Vec2,
  fromX: number,
  fromZ: number,
  awayX: number,
  awayZ: number,
  maxSpeed: number,
): void {
  seek(out, awayX, awayZ, fromX, fromZ, maxSpeed);
}

/**
 * Crowd repulsion from a neighbour list.
 *
 * `neighbours` holds indices into `agents` — normally pool slots pushed into a
 * `SpatialHash` and read back by `query`, which is why this takes indices
 * rather than entity ids. The self entry is skipped by identity, so the caller
 * does not have to filter the query result.
 *
 * The accumulated push is clamped to unit magnitude before being scaled, which
 * makes a single grazing neighbour produce a gentle nudge while a packed cluster
 * produces a full-strength shove. Returns the number of contributing neighbours.
 */
export function separation(
  out: Vec2,
  self: SteeringAgent,
  neighbours: readonly number[],
  count: number,
  agents: readonly SteeringAgent[],
  radius: number,
  maxSpeed: number,
): number {
  let ax = 0;
  let az = 0;
  let contributors = 0;

  for (let i = 0; i < count; i++) {
    const index = neighbours[i];
    if (index < 0 || index >= agents.length) continue;
    const other = agents[index];
    if (other === self) continue;

    let dx = self.x - other.x;
    let dz = self.z - other.z;
    const influence = Math.max(radius, self.radius + other.radius + PAIR_CLEARANCE);
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq > influence * influence) continue;

    let weight: number;
    if (distanceSq < 1e-8) {
      // Exactly coincident agents have no natural push direction; fan them out
      // deterministically by neighbour index so the horde still unpacks.
      const angle = index * GOLDEN_ANGLE;
      dx = Math.cos(angle);
      dz = Math.sin(angle);
      weight = 1;
    } else {
      const distance = Math.sqrt(distanceSq);
      dx /= distance;
      dz /= distance;
      weight = 1 - distance / influence;
    }

    ax += dx * weight;
    az += dz * weight;
    contributors++;
  }

  if (contributors === 0) {
    out.x = 0;
    out.z = 0;
    return 0;
  }

  const magnitude = Math.sqrt(ax * ax + az * az);
  if (magnitude < 1e-6) {
    out.x = 0;
    out.z = 0;
    return contributors;
  }
  const scale = ((magnitude > 1 ? 1 : magnitude) * maxSpeed) / magnitude;
  out.x = ax * scale;
  out.z = az * scale;
  return contributors;
}

/**
 * Local obstacle avoidance against the navigation grid.
 *
 * Two contributions: repulsion from any blocked cell in the eight-cell ring
 * around the agent, and a lateral whisker that slides the agent along a wall it
 * is about to walk into. Returns false when nothing is in the way, in which
 * case `out` is zeroed and `combine` sees no avoidance term.
 */
export function avoidObstacles(
  out: Vec2,
  grid: NavigationGrid,
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  probeDistance: number,
  maxSpeed: number,
): boolean {
  out.x = 0;
  out.z = 0;

  const cellSize = grid.cellSize;
  let ax = 0;
  let az = 0;
  let hits = 0;

  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const index = grid.worldToCell(x + dx * cellSize, z + dz * cellSize);
      if (index < 0 || !grid.isBlocked(index)) continue;
      const ox = x - grid.cellToWorldX(index);
      const oz = z - grid.cellToWorldZ(index);
      const distance = Math.sqrt(ox * ox + oz * oz);
      if (distance < 1e-4) continue;
      const strength = cellSize / distance;
      ax += (ox / distance) * strength;
      az += (oz / distance) * strength;
      hits++;
    }
  }

  const headingLength = Math.sqrt(dirX * dirX + dirZ * dirZ);
  if (probeDistance > 0 && headingLength > 1e-6) {
    const ux = dirX / headingLength;
    const uz = dirZ / headingLength;
    const ahead = grid.worldToCell(x + ux * probeDistance, z + uz * probeDistance);
    if (ahead >= 0 && grid.isBlocked(ahead)) {
      const perpX = -uz;
      const perpZ = ux;
      const side = probeDistance * 0.8;
      const forward = probeDistance * 0.55;
      const leftIndex = grid.worldToCell(x + ux * forward + perpX * side, z + uz * forward + perpZ * side);
      const rightIndex = grid.worldToCell(x + ux * forward - perpX * side, z + uz * forward - perpZ * side);
      const leftFree = leftIndex >= 0 && !grid.isBlocked(leftIndex);
      const rightFree = rightIndex >= 0 && !grid.isBlocked(rightIndex);

      let sign: number;
      if (leftFree !== rightFree) {
        sign = leftFree ? 1 : -1;
      } else {
        // Both sides look alike: slide along the face the agent already favours.
        const ox = x - grid.cellToWorldX(ahead);
        const oz = z - grid.cellToWorldZ(ahead);
        sign = ux * oz - uz * ox >= 0 ? 1 : -1;
      }

      ax += perpX * sign * WHISKER_WEIGHT;
      az += perpZ * sign * WHISKER_WEIGHT;
      // Bleed off forward momentum into the wall as well.
      ax -= ux * WHISKER_WEIGHT * 0.5;
      az -= uz * WHISKER_WEIGHT * 0.5;
      hits++;
    }
  }

  if (hits === 0) return false;

  const magnitude = Math.sqrt(ax * ax + az * az);
  if (magnitude < 1e-6) return false;
  const scale = maxSpeed / magnitude;
  out.x = ax * scale;
  out.z = az * scale;
  return true;
}

/**
 * Mixes the three behaviours with the weights from `NAVIGATION` and clamps the
 * result to `maxSpeed`. Inputs are desired velocities, not accelerations.
 */
export function combine(
  out: Vec2,
  seekVelocity: Vec2,
  separationVelocity: Vec2,
  avoidVelocity: Vec2,
  maxSpeed: number,
): Vec2 {
  out.x =
    seekVelocity.x * NAVIGATION.seekWeight +
    separationVelocity.x * NAVIGATION.separationWeight +
    avoidVelocity.x * NAVIGATION.avoidWeight;
  out.z =
    seekVelocity.z * NAVIGATION.seekWeight +
    separationVelocity.z * NAVIGATION.separationWeight +
    avoidVelocity.z * NAVIGATION.avoidWeight;
  return limit(out, maxSpeed);
}

/**
 * Writes the flow-field direction at a point as a desired velocity, falling
 * back to a straight seek wherever the field has no answer (outside the window,
 * or inside a pocket the sweep never reached). Returns true when the field
 * supplied the direction.
 */
export function followFlow(
  out: Vec2,
  flow: FlowField,
  x: number,
  z: number,
  goalX: number,
  goalZ: number,
  maxSpeed: number,
): boolean {
  if (flow.sample(out, x, z)) {
    const length = Math.sqrt(out.x * out.x + out.z * out.z);
    if (length > 1e-6) {
      out.x = (out.x / length) * maxSpeed;
      out.z = (out.z / length) * maxSpeed;
      return true;
    }
    // On the goal cell itself: stop pushing, let arrival logic take over.
    out.x = 0;
    out.z = 0;
    return true;
  }
  seek(out, x, z, goalX, goalZ, maxSpeed);
  return false;
}

/**
 * The whole horde behaviour in one call: follow the flow field toward the goal,
 * push out of the crowd, slide around walls, mix and clamp.
 *
 * `neighbours`/`count` come straight from `SpatialHash.query` and index into
 * `agents`. Pass `grid` as null to skip obstacle avoidance for a far-LOD agent.
 */
export function steerHorde(
  out: Vec2,
  self: SteeringAgent,
  goalX: number,
  goalZ: number,
  maxSpeed: number,
  flow: FlowField,
  grid: NavigationGrid | null,
  neighbours: readonly number[],
  count: number,
  agents: readonly SteeringAgent[],
  scratch: SteeringScratch,
): Vec2 {
  followFlow(scratch.seek, flow, self.x, self.z, goalX, goalZ, maxSpeed);
  separation(
    scratch.separation,
    self,
    neighbours,
    count,
    agents,
    NAVIGATION.separationRadius,
    maxSpeed,
  );
  if (grid === null) {
    scratch.avoid.x = 0;
    scratch.avoid.z = 0;
  } else {
    avoidObstacles(
      scratch.avoid,
      grid,
      self.x,
      self.z,
      scratch.seek.x,
      scratch.seek.z,
      self.radius + grid.cellSize,
      maxSpeed,
    );
  }
  return combine(out, scratch.seek, scratch.separation, scratch.avoid, maxSpeed);
}
