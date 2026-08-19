import type { Random } from "../../core/Random.ts";
import type { Vec2 } from "../../core/math.ts";
import { clamp, clamp01 } from "../../core/math.ts";
import type {
  PickupKind,
  ResourceZoneDefinition,
  RouteSegmentDefinition,
  SpawnZoneDefinition,
} from "../../core/types.ts";
import { DIRECTOR, ECONOMY } from "../../data/balance.ts";
import { CHECKPOINTS, SLICE_CHECKPOINT_ORDER } from "../../data/routes.ts";
import { RouteGraph } from "./RouteGraph.ts";
import type { RouteSpline } from "./RouteSpline.ts";

/**
 * Run structure: which segment the expedition is on, which checkpoint it just
 * reached, what the fork offers next, and where the world's contents go.
 *
 * `distanceAlongRoute` is per-segment and resets to zero on `enterSegment`;
 * the spider system owns that value, this class only answers questions about
 * it. Segment length comes from the spline's measured arc length rather than
 * the authored `lengthMeters` (which is a design estimate, off by ~1%), so the
 * spider always physically reaches the last control point.
 */

export interface ResourcePlacement {
  kind: PickupKind;
  x: number;
  z: number;
  amount: number;
}

/** Metres of lead-in during which a spawn zone is already eligible. */
const ZONE_LOOKAHEAD = 20;
const COMPLETION_EPSILON = 1e-4;

const RESOURCE_KIND: Record<ResourceZoneDefinition["kind"], PickupKind> = {
  scrap: "scrap",
  scrapLarge: "scrap",
  fuel: "fuel",
  fuelBarrel: "fuel",
  cylinder: "cylinder",
  repairKit: "repairKit",
  pressureCanister: "pressureCanister",
  shockMine: "shockMine",
  armorPlate: "armorPlate",
  weaponPart: "weaponPart",
};

const RESOURCE_AMOUNT: Record<ResourceZoneDefinition["kind"], number> = {
  scrap: ECONOMY.scrapSmall,
  scrapLarge: ECONOMY.scrapLarge,
  fuel: ECONOMY.jerrycanFuel,
  fuelBarrel: ECONOMY.fuelBarrel,
  cylinder: 1,
  repairKit: 1,
  pressureCanister: 1,
  shockMine: 1,
  armorPlate: 1,
  weaponPart: 1,
};

const scratchPoint: Vec2 = { x: 0, z: 0 };
const scratchTangent: Vec2 = { x: 0, z: 0 };

function isZoneEligible(zone: SpawnZoneDefinition, spiderDistance: number, trail: number): boolean {
  if (zone.weight <= 0) return false;
  if (trail < zone.minTrail) return false;
  if (spiderDistance < zone.fromDistance - ZONE_LOOKAHEAD) return false;
  if (spiderDistance > zone.toDistance) return false;
  return true;
}

/** Index of the checkpoint that offers `segmentId`, or -1. */
function checkpointOffering(segmentId: string): number {
  for (let i = 0; i < SLICE_CHECKPOINT_ORDER.length; i++) {
    const checkpoint = CHECKPOINTS[SLICE_CHECKPOINT_ORDER[i]];
    if (!checkpoint) continue;
    if (checkpoint.nextSegments.indexOf(segmentId) >= 0) return i;
  }
  return -1;
}

export class RouteDirector {
  readonly graph = new RouteGraph();

  private readonly random: Random;
  private currentSegment: RouteSegmentDefinition | null = null;
  private currentSpline: RouteSpline | null = null;
  private index = 0;
  private readonly completed: string[] = [];
  private readonly offers: string[] = [];
  private completionRecorded = false;

  constructor(random: Random) {
    this.random = random;
    this.refreshOffers();
  }

  get segment(): RouteSegmentDefinition | null {
    return this.currentSegment;
  }

  get spline(): RouteSpline | null {
    return this.currentSpline;
  }

  /** Index into SLICE_CHECKPOINT_ORDER of the checkpoint most recently reached. */
  get checkpointIndex(): number {
    return this.index;
  }

  get currentCheckpointId(): string {
    return SLICE_CHECKPOINT_ORDER[this.index] ?? SLICE_CHECKPOINT_ORDER[SLICE_CHECKPOINT_ORDER.length - 1];
  }

  get history(): readonly string[] {
    return this.completed;
  }

  /** The escape leg ends at the shelter gate, not at another checkpoint. */
  get isFinalSegment(): boolean {
    const segment = this.currentSegment;
    if (!segment) return false;
    return CHECKPOINTS[segment.destinationId] === undefined;
  }

  start(): void {
    this.currentSegment = null;
    this.currentSpline = null;
    this.index = 0;
    this.completed.length = 0;
    this.completionRecorded = false;
    this.refreshOffers();
  }

  enterSegment(id: string): void {
    const segment = this.graph.getSegment(id);
    const offering = checkpointOffering(id);
    if (offering >= 0) this.index = offering;
    this.currentSegment = segment;
    this.currentSpline = this.graph.getSpline(id);
    this.completionRecorded = false;
    this.refreshOffers();
  }

  offeredSegments(): readonly string[] {
    return this.offers;
  }

  /**
   * Completion is also where arrival is booked: the first true advances the
   * checkpoint cursor so the fork screen can read `offeredSegments` while the
   * spider is still docked, before the next `enterSegment` call.
   */
  isSegmentComplete(distanceAlongRoute: number): boolean {
    const segment = this.currentSegment;
    const spline = this.currentSpline;
    if (!segment || !spline) return false;
    const complete = distanceAlongRoute >= spline.length - COMPLETION_EPSILON;
    if (complete && !this.completionRecorded) {
      this.completionRecorded = true;
      this.completed.push(segment.id);
      const arrival = SLICE_CHECKPOINT_ORDER.indexOf(segment.destinationId);
      if (arrival >= 0) this.index = arrival;
      this.refreshOffers();
    }
    return complete;
  }

  destinationCheckpointId(): string {
    return this.currentSegment ? this.currentSegment.destinationId : "";
  }

  progress(distanceAlongRoute: number): number {
    const spline = this.currentSpline;
    if (!spline || spline.length <= 0) return 0;
    return clamp01(distanceAlongRoute / spline.length);
  }

  remaining(distanceAlongRoute: number): number {
    const spline = this.currentSpline;
    if (!spline) return 0;
    const left = spline.length - distanceAlongRoute;
    return left > 0 ? left : 0;
  }

  pickSpawnPoint(
    out: Vec2,
    spiderDistance: number,
    trail: number,
    rearBias: number,
    random: Random,
  ): boolean {
    const segment = this.currentSegment;
    const spline = this.currentSpline;
    if (!segment || !spline) return false;

    const zones = segment.spawnZones;
    let total = 0;
    let fallback = -1;
    for (let i = 0; i < zones.length; i++) {
      if (!isZoneEligible(zones[i], spiderDistance, trail)) continue;
      total += zones[i].weight;
      fallback = i;
    }
    if (fallback < 0 || total <= 0) return false;

    let roll = random.next() * total;
    let chosen = fallback;
    for (let i = 0; i < zones.length; i++) {
      if (!isZoneEligible(zones[i], spiderDistance, trail)) continue;
      roll -= zones[i].weight;
      if (roll <= 0) {
        chosen = i;
        break;
      }
    }
    const zone = zones[chosen];

    const offset = random.range(DIRECTOR.spawnMinDistance, DIRECTOR.spawnMaxDistance);
    const behind = random.next() < rearBias;
    const target = behind ? spiderDistance - offset : spiderDistance + offset;

    const lateral = random.range(zone.minLateral, zone.maxLateral) * (random.bool() ? 1 : -1);

    // The route is a corridor through a world, not the edge of one. A rear
    // spawn early in a segment lands *before* the start, so the position is
    // extrapolated backwards along the start tangent rather than mirrored to
    // the front. Mirroring is what made the whole horde arrive from ahead
    // during the first half-minute of every segment, which is exactly backwards
    // from the design: the horde follows the trail, so it comes from behind.
    const clamped = clamp(target, 0, spline.length);
    spline.positionAt(scratchPoint, clamped);
    spline.tangentAt(scratchTangent, clamped);
    const overshoot = target - clamped;

    out.x = scratchPoint.x + scratchTangent.x * overshoot + scratchTangent.z * lateral;
    out.z = scratchPoint.z + scratchTangent.z * overshoot - scratchTangent.x * lateral;
    return true;
  }

  generateResources(random: Random): ResourcePlacement[] {
    const results: ResourcePlacement[] = [];
    const segment = this.currentSegment;
    const spline = this.currentSpline;
    if (!segment || !spline) return results;

    for (let z = 0; z < segment.resourceZones.length; z++) {
      const zone = segment.resourceZones[z];
      if (zone.count <= 0) continue;
      const kind = RESOURCE_KIND[zone.kind];
      const amount = RESOURCE_AMOUNT[zone.kind];
      const from = clamp(zone.fromDistance, 0, spline.length);
      const to = clamp(zone.toDistance, 0, spline.length);
      for (let i = 0; i < zone.count; i++) {
        // Stratified so a zone reads as a scattered field rather than clumps.
        const t = (i + random.next()) / zone.count;
        const distance = from + (to - from) * t;
        const lateral = random.signed(zone.maxLateral);
        spline.positionAt(scratchPoint, distance);
        spline.tangentAt(scratchTangent, distance);
        results.push({
          kind,
          x: scratchPoint.x + scratchTangent.z * lateral,
          z: scratchPoint.z - scratchTangent.x * lateral,
          amount,
        });
      }
    }
    return results;
  }

  isInsideCorridor(x: number, z: number): boolean {
    const segment = this.currentSegment;
    const spline = this.currentSpline;
    if (!segment || !spline) return false;
    spline.projectPoint(scratchPoint, x, z);
    const dx = x - scratchPoint.x;
    const dz = z - scratchPoint.z;
    const half = segment.corridorHalfWidth;
    return dx * dx + dz * dz <= half * half;
  }

  private refreshOffers(): void {
    this.offers.length = 0;
    const checkpoint = CHECKPOINTS[this.currentCheckpointId];
    if (!checkpoint) return;
    const next = checkpoint.nextSegments;
    if (next.length <= 2) {
      for (let i = 0; i < next.length; i++) this.offers.push(next[i]);
      return;
    }
    // A checkpoint may author more than two legs; the fork screen shows two.
    const pool = next.slice();
    this.random.shuffle(pool);
    this.offers.push(pool[0], pool[1]);
  }
}
