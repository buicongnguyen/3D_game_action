import { describe, expect, it } from "vitest";
import { Random } from "../src/core/Random.ts";
import { angleDelta } from "../src/core/math.ts";
import type { Vec2 } from "../src/core/math.ts";
import { DIRECTOR } from "../src/data/balance.ts";
import { CHECKPOINTS, FINAL_GATE_STORY, ROUTE_SEGMENTS } from "../src/data/routes.ts";
import { GameWorld } from "../src/game/GameWorld.ts";
import { RouteDirector } from "../src/game/route/RouteDirector.ts";
import { RouteGraph } from "../src/game/route/RouteGraph.ts";
import { RouteSpline } from "../src/game/route/RouteSpline.ts";

function v(): Vec2 {
  return { x: 0, z: 0 };
}

function worldDistance(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dz * dz);
}

describe("RouteSpline arc length", () => {
  it("measures a length close to the authored estimate for every segment", () => {
    const graph = new RouteGraph();
    for (const id of Object.keys(ROUTE_SEGMENTS)) {
      const spline = graph.getSpline(id);
      const authored = ROUTE_SEGMENTS[id].lengthMeters;
      expect(Math.abs(spline.length - authored) / authored).toBeLessThan(0.05);
    }
  });

  it("gives constant world speed for constant metres stepped, through the curviest segment", () => {
    const spline = new RouteGraph().getSpline("seg.scrapyard");
    const step = 0.5;
    const a = v();
    const b = v();
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let samples = 0;

    for (let i = 0; (i + 1) * step <= spline.length; i++) {
      spline.positionAt(a, i * step);
      spline.positionAt(b, (i + 1) * step);
      const moved = worldDistance(a, b);
      if (moved < min) min = moved;
      if (moved > max) max = moved;
      sum += moved;
      samples++;
    }

    expect(samples).toBeGreaterThan(300);
    // A naive uniform-u walk over these control points varies by tens of
    // percent; the arc-length table has to keep this under half a percent.
    expect(max - min).toBeLessThan(step * 0.005);
    expect(Math.abs(sum / samples - step)).toBeLessThan(step * 0.005);
  });

  it("holds constant speed on the tightest authored corner too", () => {
    const spline = new RouteGraph().getSpline("seg.mine");
    const step = 1;
    const a = v();
    const b = v();
    for (let d = 0; d + step <= spline.length; d += step) {
      spline.positionAt(a, d);
      spline.positionAt(b, d + step);
      expect(Math.abs(worldDistance(a, b) - step)).toBeLessThan(step * 0.005);
    }
  });

  it("clamps distances outside the route to its ends", () => {
    const spline = new RouteGraph().getSpline("seg.escape");
    const before = v();
    const start = v();
    const after = v();
    const end = v();
    spline.positionAt(before, -50);
    spline.positionAt(start, 0);
    spline.positionAt(after, spline.length + 50);
    spline.positionAt(end, spline.length);
    expect(worldDistance(before, start)).toBeLessThan(1e-9);
    expect(worldDistance(after, end)).toBeLessThan(1e-9);
  });
});

describe("RouteSpline continuity", () => {
  it("uses a simple, low-threat opening before escalating later stages", () => {
    const opening = ROUTE_SEGMENTS["seg.approach"];
    const xs = opening.points.map((point) => point[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(4);
    expect(opening.ambientThreatScale).toBeLessThan(ROUTE_SEGMENTS["seg.mine"].ambientThreatScale!);
    expect(ROUTE_SEGMENTS["seg.mine"].ambientThreatScale).toBeLessThan(
      ROUTE_SEGMENTS["seg.escape"].ambientThreatScale!,
    );
    expect(opening.encounters?.every((encounter) => encounter.occupants.length === 0)).toBe(true);
  });

  it("authors finite occupied sites only after the opening stage", () => {
    for (const id of ["seg.mine", "seg.scrapyard"]) {
      const encounters = ROUTE_SEGMENTS[id].encounters ?? [];
      expect(encounters.length).toBeGreaterThan(0);
      for (const encounter of encounters) {
        expect(encounter.warningSeconds).toBeGreaterThanOrEqual(1);
        expect(encounter.occupants.reduce((sum, group) => sum + group.count, 0)).toBeGreaterThan(0);
      }
    }
  });

  it("gives Rust Yard repeated maze-like switchbacks instead of one shallow bend", () => {
    const points = ROUTE_SEGMENTS["seg.scrapyard"].points;
    let directionChanges = 0;
    let previousSign = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i][0] - points[i - 1][0];
      const sign = Math.sign(dx);
      if (sign !== 0 && previousSign !== 0 && sign !== previousSign) directionChanges++;
      if (sign !== 0) previousSign = sign;
    }
    expect(directionChanges).toBeGreaterThanOrEqual(4);
    expect(ROUTE_SEGMENTS["seg.scrapyard"].corridorHalfWidth).toBeLessThanOrEqual(12);
  });

  it("moves and turns continuously along the whole route", () => {
    const spline = new RouteGraph().getSpline("seg.scrapyard");
    const a = v();
    const b = v();
    let previousHeading = spline.headingAt(0);
    spline.positionAt(a, 0);

    for (let d = 0.1; d <= spline.length; d += 0.1) {
      spline.positionAt(b, d);
      expect(worldDistance(a, b)).toBeLessThan(0.12);
      const heading = spline.headingAt(d);
      expect(Math.abs(angleDelta(previousHeading, heading))).toBeLessThan(0.05);
      previousHeading = heading;
      a.x = b.x;
      a.z = b.z;
    }
  });

  it("reports a heading that matches the direction of travel", () => {
    const spline = new RouteGraph().getSpline("seg.approach");
    const a = v();
    const b = v();
    for (let d = 5; d < spline.length - 5; d += 7) {
      spline.positionAt(a, d);
      spline.positionAt(b, d + 1);
      const measured = Math.atan2(b.x - a.x, b.z - a.z);
      expect(Math.abs(angleDelta(measured, spline.headingAt(d + 0.5)))).toBeLessThan(0.02);
    }
  });
});

describe("RouteSpline projection", () => {
  it("recovers a known distance from a point on the centreline", () => {
    const spline = new RouteGraph().getSpline("seg.scrapyard");
    const on = v();
    const found = v();
    for (const known of [0.5, 17.25, 57.3, 120, 190]) {
      spline.positionAt(on, known);
      const recovered = spline.projectPoint(found, on.x, on.z);
      expect(Math.abs(recovered - known)).toBeLessThan(0.05);
      expect(worldDistance(on, found)).toBeLessThan(0.02);
    }
  });

  it("recovers the distance from a point offset to the side", () => {
    const spline = new RouteGraph().getSpline("seg.approach");
    const centre = v();
    const tangent = v();
    const found = v();
    const known = 90;
    spline.positionAt(centre, known);
    spline.tangentAt(tangent, known);
    const offX = centre.x + tangent.z * 4;
    const offZ = centre.z - tangent.x * 4;
    const recovered = spline.projectPoint(found, offX, offZ);
    expect(Math.abs(recovered - known)).toBeLessThan(0.6);
    expect(worldDistance(centre, found)).toBeLessThan(0.6);
  });
});

describe("RouteSpline lateral offset", () => {
  it("is positive to the left of travel on a straight route", () => {
    const straight = new RouteSpline([
      [0, 0, 0],
      [0, 0, 10],
      [0, 0, 20],
      [0, 0, 30],
    ]);
    expect(straight.headingAt(15)).toBeCloseTo(0, 6);
    // Facing +Z with +Y up, left is +X.
    expect(straight.lateralOffset(3, 15)).toBeCloseTo(3, 5);
    expect(straight.lateralOffset(-3, 15)).toBeCloseTo(-3, 5);
    expect(straight.lateralOffset(0, 15)).toBeCloseTo(0, 6);
  });

  it("keeps the sign consistent along an authored curve", () => {
    const spline = new RouteGraph().getSpline("seg.scrapyard");
    const centre = v();
    const tangent = v();
    for (let d = 10; d < spline.length - 10; d += 13) {
      spline.positionAt(centre, d);
      spline.tangentAt(tangent, d);
      const left = spline.lateralOffset(centre.x + tangent.z * 5, centre.z - tangent.x * 5);
      const right = spline.lateralOffset(centre.x - tangent.z * 5, centre.z + tangent.x * 5);
      expect(left).toBeGreaterThan(0);
      expect(right).toBeLessThan(0);
      // At a hard maze bend, the globally closest point is slightly around the
      // corner rather than the exact authored normal. Preserve sign and stay
      // within the bend's local interpolation error of the requested offset.
      expect(Math.abs(Math.abs(left) - 5)).toBeLessThan(1.2);
      expect(Math.abs(Math.abs(right) - 5)).toBeLessThan(1.2);
    }
  });
});

describe("RouteDirector run structure", () => {
  it("gives every completed stage a distinct encouraging story", () => {
    const stories = Object.values(CHECKPOINTS)
      .map((checkpoint) => checkpoint.arrivalStory)
      .filter((story) => story !== undefined);

    expect(stories).toHaveLength(8);
    expect(new Set(stories.map((story) => story.text)).size).toBe(8);
    for (const story of stories) {
      expect(story.speaker.length).toBeGreaterThan(3);
      expect(story.text.length).toBeGreaterThan(80);
    }
    expect(FINAL_GATE_STORY).toContain("Thank you");
  });

  it("walks the authored checkpoint chain", () => {
    const director = new RouteDirector(new Random(4242));
    director.start();

    expect(director.segment).toBeNull();
    expect(director.spline).toBeNull();
    expect(director.checkpointIndex).toBe(0);
    expect(director.currentCheckpointId).toBe("checkpoint.start");
    expect(director.offeredSegments()).toEqual(["seg.approach"]);
    expect(director.history).toEqual([]);

    director.enterSegment("seg.approach");
    const approach = director.spline;
    expect(approach).not.toBeNull();
    expect(director.destinationCheckpointId()).toBe("checkpoint.foundry");
    expect(director.isFinalSegment).toBe(false);
    expect(director.isSegmentComplete(0)).toBe(false);
    expect(director.isSegmentComplete(approach!.length - 1)).toBe(false);
    expect(director.isSegmentComplete(approach!.length)).toBe(true);

    expect(director.history).toEqual(["seg.approach"]);
    expect(director.currentCheckpointId).toBe("checkpoint.foundry");
    expect(director.offeredSegments()).toEqual(["seg.mine"]);

    director.enterSegment("seg.mine");
    expect(director.checkpointIndex).toBe(1);
    expect(director.isSegmentComplete(0)).toBe(false);
    expect(director.isSegmentComplete(director.spline!.length + 5)).toBe(true);
    expect(director.currentCheckpointId).toBe("checkpoint.settlement");
    expect(director.offeredSegments()).toEqual(["seg.flooded", "seg.floodedShortcut"]);

    director.enterSegment("seg.flooded");
    expect(director.isSegmentComplete(director.spline!.length)).toBe(true);
    expect(director.currentCheckpointId).toBe("checkpoint.pump");
    expect(director.offeredSegments()).toEqual(["seg.badlands"]);

    const middleStages = [
      ["seg.badlands", "checkpoint.ridge", "seg.mountain"],
      ["seg.mountain", "checkpoint.summit", "seg.flower"],
      ["seg.flower", "checkpoint.garden", "seg.scrapyard"],
      ["seg.scrapyard", "checkpoint.gate", "seg.crystal"],
      ["seg.crystal", "checkpoint.crystal", "seg.escape"],
    ] as const;
    for (const [segmentId, checkpointId, nextSegmentId] of middleStages) {
      director.enterSegment(segmentId);
      expect(director.isSegmentComplete(director.spline!.length + 5)).toBe(true);
      expect(director.currentCheckpointId).toBe(checkpointId);
      expect(director.offeredSegments()).toEqual([nextSegmentId]);
    }

    director.enterSegment("seg.escape");
    expect(director.isFinalSegment).toBe(true);
    expect(director.destinationCheckpointId()).toBe("gate.final");
    expect(director.isSegmentComplete(director.spline!.length)).toBe(true);
    expect(director.history).toEqual([
      "seg.approach", "seg.mine", "seg.flooded", "seg.badlands", "seg.mountain",
      "seg.flower", "seg.scrapyard", "seg.crystal", "seg.escape",
    ]);
    // The gate is not a checkpoint, so the cursor stays on the last one.
    expect(director.currentCheckpointId).toBe("checkpoint.crystal");
  });

  it("reports progress and remaining metres against the measured arc length", () => {
    const director = new RouteDirector(new Random(1));
    director.start();
    director.enterSegment("seg.mine");
    const length = director.spline!.length;

    expect(director.progress(0)).toBe(0);
    expect(director.progress(length / 2)).toBeCloseTo(0.5, 6);
    expect(director.progress(length)).toBe(1);
    expect(director.progress(length * 2)).toBe(1);
    expect(director.remaining(0)).toBeCloseTo(length, 6);
    expect(director.remaining(length)).toBe(0);
    expect(director.remaining(length + 40)).toBe(0);
  });

  it("answers nothing useful before a segment is entered", () => {
    const director = new RouteDirector(new Random(9));
    director.start();
    expect(director.isSegmentComplete(1000)).toBe(false);
    expect(director.progress(50)).toBe(0);
    expect(director.remaining(50)).toBe(0);
    expect(director.destinationCheckpointId()).toBe("");
    expect(director.isFinalSegment).toBe(false);
    expect(director.isInsideCorridor(0, 0)).toBe(false);
    expect(director.generateResources(new Random(3))).toEqual([]);
    expect(director.pickSpawnPoint(v(), 10, 50, 0.7, new Random(3))).toBe(false);
  });
});

describe("RouteDirector corridor", () => {
  it("accepts the centreline and rejects points past the half width", () => {
    const director = new RouteDirector(new Random(77));
    director.start();
    director.enterSegment("seg.mine");
    const half = ROUTE_SEGMENTS["seg.mine"].corridorHalfWidth;
    const spline = director.spline!;
    const centre = v();
    const tangent = v();

    for (let d = 5; d < spline.length - 5; d += 17) {
      spline.positionAt(centre, d);
      spline.tangentAt(tangent, d);
      expect(director.isInsideCorridor(centre.x, centre.z)).toBe(true);
      const inX = centre.x + tangent.z * (half - 1.5);
      const inZ = centre.z - tangent.x * (half - 1.5);
      expect(director.isInsideCorridor(inX, inZ)).toBe(true);
      const outX = centre.x - tangent.z * (half + 6);
      const outZ = centre.z + tangent.x * (half + 6);
      expect(director.isInsideCorridor(outX, outZ)).toBe(false);
    }
  });

  it("rejects points far past either end of the segment", () => {
    const director = new RouteDirector(new Random(78));
    director.start();
    director.enterSegment("seg.escape");
    const spline = director.spline!;
    const end = v();
    spline.positionAt(end, spline.length);
    const tangent = v();
    spline.tangentAt(tangent, spline.length);
    const beyondX = end.x + tangent.x * 40;
    const beyondZ = end.z + tangent.z * 40;
    expect(director.isInsideCorridor(beyondX, beyondZ)).toBe(false);
  });
});

describe("RouteDirector spawn placement", () => {
  it("places spawns in the zone's lateral band at the director's range", () => {
    const director = new RouteDirector(new Random(5));
    director.start();
    // Use the ordinary corridor for this local-lateral contract. Rust Yard's
    // maze has adjacent lanes, so a point outside one lane may correctly be
    // nearest to the next lane and cannot be described by one global offset.
    director.enterSegment("seg.approach");
    const spline = director.spline!;
    const spawn = v();
    const spider = v();
    const random = new Random(0xbeef);
    const spiderDistance = 100;
    spline.positionAt(spider, spiderDistance);

    let behindCount = 0;
    const trials = 400;
    for (let i = 0; i < trials; i++) {
      expect(director.pickSpawnPoint(spawn, spiderDistance, 60, 0.86, random)).toBe(true);
      const lateral = Math.abs(spline.lateralOffset(spawn.x, spawn.z));
      expect(lateral).toBeGreaterThan(12);
      expect(lateral).toBeLessThan(40);
      const straight = worldDistance(spider, spawn);
      expect(straight).toBeGreaterThan(20);
      expect(straight).toBeLessThan(70);
      const found = v();
      if (spline.projectPoint(found, spawn.x, spawn.z) < spiderDistance) behindCount++;
    }
    // rearBias 0.86 must actually bias to the rear.
    expect(behindCount / trials).toBeGreaterThan(0.7);
  });

  it("honours rearBias 0 by placing everything ahead", () => {
    const director = new RouteDirector(new Random(6));
    director.start();
    director.enterSegment("seg.escape");
    const spline = director.spline!;
    const spawn = v();
    const found = v();
    const random = new Random(0xfeed);
    for (let i = 0; i < 100; i++) {
      expect(director.pickSpawnPoint(spawn, 40, 100, 0, random)).toBe(true);
      expect(spline.projectPoint(found, spawn.x, spawn.z)).toBeGreaterThan(40);
    }
  });

  it("mirrors the requested side when the segment boundary is in the way", () => {
    const director = new RouteDirector(new Random(7));
    director.start();
    director.enterSegment("seg.escape");
    const spline = director.spline!;
    const spawn = v();
    const found = v();
    const random = new Random(0xcafe);
    for (let i = 0; i < 100; i++) {
      expect(director.pickSpawnPoint(spawn, 2, 100, 1, random)).toBe(true);
      const along = spline.projectPoint(found, spawn.x, spawn.z);
      expect(along).toBeGreaterThanOrEqual(0);
      expect(along).toBeLessThanOrEqual(spline.length + 1);
    }
  });

  it("refuses when no zone qualifies for the trail level", () => {
    const director = new RouteDirector(new Random(8));
    director.start();
    director.enterSegment("seg.approach");
    const spawn = v();
    const random = new Random(11);
    // Both approach zones start at or before 176; well past the end nothing
    // is eligible, whatever the trail is.
    expect(director.pickSpawnPoint(spawn, 400, 100, 0.5, random)).toBe(false);
  });

  it("uses the director's authored spawn range", () => {
    expect(DIRECTOR.spawnMinDistance).toBeLessThan(DIRECTOR.spawnMaxDistance);
    const director = new RouteDirector(new Random(12));
    director.start();
    director.enterSegment("seg.approach");
    const spline = director.spline!;
    const spawn = v();
    const found = v();
    const random = new Random(0x1234);
    for (let i = 0; i < 200; i++) {
      expect(director.pickSpawnPoint(spawn, 88, 30, 0.5, random)).toBe(true);
      const along = spline.projectPoint(found, spawn.x, spawn.z);
      const gap = Math.abs(along - 88);
      // Re-projecting a laterally offset point does not return the distance it
      // was placed at: outside a bend the parallel arc is longer, inside it is
      // shorter, by up to lateral/radius. Hence the slack on both bounds.
      expect(gap).toBeGreaterThan(DIRECTOR.spawnMinDistance * 0.7);
      expect(gap).toBeLessThan(DIRECTOR.spawnMaxDistance * 1.3);
    }
  });
});

describe("RouteDirector resources", () => {
  it("emits every authored pickup inside its zone bounds", () => {
    const director = new RouteDirector(new Random(21));
    director.start();
    director.enterSegment("seg.mine");
    const spline = director.spline!;
    const zones = ROUTE_SEGMENTS["seg.mine"].resourceZones;
    const expected = zones.reduce((total, zone) => total + zone.count, 0);
    const placements = director.generateResources(new Random(31));

    expect(placements.length).toBe(expected);
    const found = v();
    for (const placement of placements) {
      expect([
        "scrap", "fuel", "repairKit", "pressureCanister", "shockMine", "armorPlate", "weaponPart",
      ]).toContain(placement.kind);
      expect(placement.amount).toBeGreaterThan(0);
      expect(Math.abs(spline.lateralOffset(placement.x, placement.z))).toBeLessThan(9);
      const along = spline.projectPoint(found, placement.x, placement.z);
      expect(along).toBeGreaterThan(5);
      expect(along).toBeLessThan(spline.length);
    }
  });

  it("maps the large variants onto the base pickup kinds with bigger amounts", () => {
    const director = new RouteDirector(new Random(22));
    director.start();
    director.enterSegment("seg.mine");
    const placements = director.generateResources(new Random(32));

    const fuelAmounts = new Set(placements.filter((p) => p.kind === "fuel").map((p) => p.amount));
    expect(fuelAmounts.size).toBe(2);
    expect(Math.max(...fuelAmounts)).toBe(30);
    expect(Math.min(...fuelAmounts)).toBe(15);
    expect(placements.filter((p) => p.amount === 30).length).toBe(3);

    director.enterSegment("seg.scrapyard");
    const yard = director.generateResources(new Random(33));
    expect(yard.filter((p) => p.kind === "scrap" && p.amount === 12).length).toBe(6);
    expect(yard.filter((p) => p.kind === "scrap" && p.amount === 3).length).toBe(26);
    expect(yard.filter((p) => p.kind === "armorPlate")).toHaveLength(2);
    expect(yard.filter((p) => p.kind === "weaponPart")).toHaveLength(3);
  });
});

describe("RouteDirector determinism", () => {
  it("produces identical resources and spawn points for the same seed", () => {
    const a = new RouteDirector(new Random(0x5eed));
    const b = new RouteDirector(new Random(0x5eed));
    a.start();
    b.start();
    a.enterSegment("seg.scrapyard");
    b.enterSegment("seg.scrapyard");

    expect(a.generateResources(new Random(1001))).toEqual(b.generateResources(new Random(1001)));

    const randomA = new Random(2002);
    const randomB = new Random(2002);
    const pointA = v();
    const pointB = v();
    for (let i = 0; i < 200; i++) {
      const distance = 10 + i * 0.9;
      const okA = a.pickSpawnPoint(pointA, distance, 55, 0.7, randomA);
      const okB = b.pickSpawnPoint(pointB, distance, 55, 0.7, randomB);
      expect(okA).toBe(okB);
      expect(pointA.x).toBe(pointB.x);
      expect(pointA.z).toBe(pointB.z);
    }
  });

  it("regenerates the same layout after re-entering a segment", () => {
    const director = new RouteDirector(new Random(0xd00d));
    director.start();
    director.enterSegment("seg.approach");
    const first = director.generateResources(new Random(7));
    director.enterSegment("seg.mine");
    director.enterSegment("seg.approach");
    const second = director.generateResources(new Random(7));
    expect(second).toEqual(first);
  });
});

describe("spawn and loot zones cover the whole road", () => {
  it("reaches the end of every segment", () => {
    // seg.scrapyard's control points were rewritten and its length went from
    // 330 m to 360 m, but its spawn zones still stopped at 330 - so the director
    // could not spawn anything in the last 30 m of the maze stage, and no loot
    // was authored there either. Nothing caught it because nothing compared the
    // authored zones against the measured spline.
    for (const id of Object.keys(ROUTE_SEGMENTS)) {
      const segment = ROUTE_SEGMENTS[id];
      const world = new GameWorld(4242);
      world.route.enterSegment(id);
      const length = world.route.spline!.length;

      const furthestSpawn = Math.max(...segment.spawnZones.map((z) => z.toDistance));
      expect(
        furthestSpawn,
        `${id}: spawn zones stop at ${furthestSpawn} m of a ${length.toFixed(0)} m segment`,
      ).toBeGreaterThanOrEqual(length - 12);

      for (const zone of segment.spawnZones) {
        expect(zone.fromDistance, `${id}: zone starts after it ends`).toBeLessThan(zone.toDistance);
      }
    }
  });
});
