import type { Game } from "../core/Game.ts";
import type { GameWorld } from "../game/GameWorld.ts";
import { SPIDER, STRUCTURES, TRAIL } from "../data/balance.ts";

/**
 * Scripted scenes for visual QA.
 *
 * §10 of the implementation plan names six captures the visual rubric must be
 * scored against. Setting them up by hand in a live run is neither repeatable
 * nor reviewable, so each one is a deterministic function of a seed here. A
 * capture taken today and one taken after a fix show the same moment, which is
 * the only way a before/after comparison means anything.
 *
 * This module is only reachable through `?capture=`, so it never ships in a
 * normal run beyond its own bundled size.
 */

export interface CaptureScenario {
  id: string;
  label: string;
  /** Simulated seconds to run before the shot, after setup. */
  settle: number;
  setup: (game: Game, world: GameWorld) => void;
}

function placeTurret(game: Game, world: GameWorld, x: number, z: number, buffer: number): void {
  const construction = (game as unknown as { construction: ConstructionLike }).construction;
  const structure = construction.spawnStructure(world, "rivetTurret", x, z, Math.PI, 1, buffer);
  structure.state = "active";
  structure.stateTimer = 0;
}

interface ConstructionLike {
  spawnStructure: (
    world: GameWorld,
    kind: string,
    x: number,
    z: number,
    heading: number,
    healthFraction: number,
    buffer: number,
  ) => { state: string; stateTimer: number; id: number };
}

/**
 * Moves the engineer to a point ahead of the spider along the route.
 *
 * `aheadMetres` is measured from the spider's centre, and the hull is 9.5 m
 * long, so anything under about 8 m puts the engineer inside the machine's
 * footprint rather than ahead of it. The captures used to do exactly that and
 * produced frames in which the player could not be found at all - which read as
 * a rendering defect but was really a staging one.
 */
function stationPlayer(world: GameWorld, aheadMetres: number, lateral: number): void {
  const spline = world.route.spline;
  if (!spline) return;
  const point = { x: 0, z: 0 };
  const tangent = { x: 0, z: 0 };
  const distance = Math.min(spline.length, world.spider.distanceAlongRoute + aheadMetres);
  spline.positionAt(point, distance);
  spline.tangentAt(tangent, distance);
  world.player.x = point.x + -tangent.z * lateral;
  world.player.z = point.z + tangent.x * lateral;
  world.player.prevX = world.player.x;
  world.player.prevZ = world.player.z;
  world.player.heading = Math.atan2(tangent.x, tangent.z);
}

export const CAPTURES: CaptureScenario[] = [
  {
    id: "march",
    label: "Normal march, engineer running ahead",
    settle: 1.2,
    setup: (game, world) => {
      game.debugApi.teleportSpider(58);
      game.advance(0.05);
      stationPlayer(world, 11, 3);
      world.player.velocityX = 3.4;
      world.player.velocityZ = 3.4;
      world.trail = 14;
    },
  },
  {
    id: "houses",
    label: "Occupied workshop releasing a visible finite squad",
    settle: 1.65,
    setup: (game, world) => {
      game.debugApi.enterSegment("seg.mine");
      game.debugApi.teleportSpider(34);
      game.advance(0.05);
      stationPlayer(world, 9, -2);
      world.trail = 24;
    },
  },
  {
    id: "flooded",
    label: "Flooded Works bridge funnel with the Steam Flamer equipped",
    settle: 1.1,
    setup: (game, world) => {
      game.debugApi.enterSegment("seg.flooded");
      game.debugApi.teleportSpider(38);
      game.advance(0.05);
      stationPlayer(world, 7, 1.5);
      world.trail = 42;
      game.debugApi.forceSpawn("minion", 18);
      game.debugApi.forceSpawn("warrior", 3);
    },
  },
  {
    id: "gearshift",
    label: "Spider drops out of overdrive, then halts at the checkpoint",
    settle: 0.1,
    setup: (game, world) => {
      const spline = world.route.spline;
      if (!spline) return;

      // Two changes of gear inside a 1.5 s recording, because a constant-speed
      // scene cannot show the defect this scenario exists for: the gait solver
      // teleports on a change of speed, not while holding one.
      //
      // Both are timed by arithmetic on the balance constants rather than by a
      // hand-measured distance, so they stay put if the speeds are retuned. The
      // clock starts at the end of the pre-roll - the sync step below, plus the
      // settle pass and the five single frames `runCapture` draws after it.
      const preroll = 1 / 60 + 0.1 + 5 / 60;
      const gearChangeAt = 0.45;
      const haltAt = 1.05;

      world.spider.speedMode = "overdrive";
      // Fuel is the clock for the first change: overdrive burns a fixed rate,
      // so a tank sized to that instant runs dry there and the spider falls
      // from 2.0 m/s to the 0.45 m/s fallback crawl.
      world.spider.fuel =
        (SPIDER.fuelPerSecondOverdrive / world.modifiers.fuelEfficiency) * (preroll + gearChangeAt);
      // Distance left in the segment is the clock for the second, travelled at
      // the two speeds above. Arriving docks the spider, which takes speed to
      // zero on a single frame - the harder of the two cases for a leg solver.
      world.spider.distanceAlongRoute =
        spline.length -
        (SPIDER.speedOverdrive * (preroll + gearChangeAt) +
          SPIDER.speedFallback * (haltAt - gearChangeAt));
      world.trail = 46;

      // One step so the hull's world transform matches the new distance before
      // the camera snaps to it; this is the first tick of the pre-roll above.
      game.advance(1 / 60);
      // Beside the hull rather than ahead of it. Relative motion between the
      // engineer and a machine that changes speed under him is the whole tell,
      // and it is unreadable when one of them is off the far edge of the frame.
      stationPlayer(world, 0, 6);
    },
  },
  {
    id: "placement",
    label: "Turret placement with the pressure network visible",
    settle: 0.4,
    setup: (game, world) => {
      game.debugApi.teleportSpider(72);
      game.advance(0.05);
      stationPlayer(world, 8, 4);
      placeTurret(game, world, world.spider.x + 6, world.spider.z + 4, STRUCTURES.rivetTurret.maxBuffer);
      placeTurret(game, world, world.spider.x - 5, world.spider.z - 7, 9);
      world.build.ghostActive = true;
      world.build.ghostKind = "rivetTurret";
      world.build.ghostX = Math.round((world.player.x + 3) * 2) / 2;
      world.build.ghostZ = Math.round((world.player.z + 2) * 2) / 2;
      world.build.ghostValidity = "unpowered";
      world.build.ghostReason = "Outside the pressure network";
      world.resources.scrap = 96;
      world.trail = 33;
    },
  },
  {
    id: "horde",
    label: "Dense horde pressure with combat feedback",
    settle: 2.6,
    setup: (game, world) => {
      game.debugApi.teleportSpider(96);
      game.advance(0.05);
      stationPlayer(world, 13, 4);
      placeTurret(game, world, world.spider.x + 7, world.spider.z + 3, 24);
      placeTurret(game, world, world.spider.x - 6, world.spider.z + 5, 18);
      placeTurret(game, world, world.spider.x + 2, world.spider.z - 9, 27);
      world.trail = 82;
      game.debugApi.forceSpawn("minion", 74);
      game.debugApi.forceSpawn("warrior", 22);
      game.debugApi.forceSpawn("golem", 4);
    },
  },
  {
    id: "lastshot",
    label: "Last Shot on an abandoned turret",
    settle: 1.1,
    setup: (game, world) => {
      game.debugApi.teleportSpider(120);
      game.advance(0.05);
      stationPlayer(world, 7, 3);
      placeTurret(game, world, world.spider.x - 11, world.spider.z - 12, 3);
      placeTurret(game, world, world.spider.x + 6, world.spider.z + 2, 26);
      world.trail = 91;
      game.debugApi.forceSpawn("minion", 52);
      game.debugApi.forceSpawn("warrior", 14);
      const abandoned = world.structures[0];
      abandoned.state = "overloading";
      abandoned.stateTimer = STRUCTURES.rivetTurret.lastShotDuration * 0.6;
      abandoned.behindSpider = true;
    },
  },
  {
    id: "pursuit",
    label: "Pursuit with everything active",
    settle: 2.2,
    setup: (game, world) => {
      game.debugApi.teleportSpider(140);
      game.advance(0.05);
      stationPlayer(world, 12, 3);
      placeTurret(game, world, world.spider.x + 6, world.spider.z + 4, 30);
      placeTurret(game, world, world.spider.x - 7, world.spider.z + 6, 22);
      world.trail = TRAIL.max;
      world.spider.speedMode = "overdrive";
      game.debugApi.forceSpawn("minion", 96);
      game.debugApi.forceSpawn("warrior", 30);
      game.debugApi.forceSpawn("golem", 6);
    },
  },
  {
    id: "route",
    label: "Route choice at the safe stop",
    settle: 0.3,
    setup: (game, world) => {
      game.debugApi.teleportSpider(174);
      world.trail = 18;
      game.advance(0.2);
      stationPlayer(world, 3, 3);
      game.runStateForCapture().pendingRoutes = ["seg.mine", "seg.scrapyard"];
      game.showScreenForCapture("route");
    },
  },
  {
    id: "upgrade",
    label: "Level-up choice under pressure",
    settle: 0.6,
    setup: (game, world) => {
      game.debugApi.teleportSpider(100);
      game.advance(0.05);
      stationPlayer(world, 6, 3);
      world.trail = 71;
      game.debugApi.forceSpawn("minion", 44);
      game.debugApi.forceSpawn("warrior", 12);
      game.runStateForCapture().pendingOffers = [
        "structure.pressureTanks",
        "weapon.choke",
        "tool.hydraulics",
      ];
      world.progress.level = 4;
      game.showScreenForCapture("upgrade");
    },
  },
  {
    id: "module",
    label: "Spider module offer at the halt",
    settle: 0.3,
    setup: (game, world) => {
      game.debugApi.teleportSpider(172);
      world.trail = 16;
      game.advance(0.2);
      stationPlayer(world, 3, 2);
      game.runStateForCapture().pendingModules = ["module.crane", "module.dorsalTurret"];
      game.showScreenForCapture("module");
    },
  },
  {
    id: "victory",
    label: "Victory transition",
    settle: 0.3,
    setup: (game, world) => {
      game.debugApi.teleportSpider(120);
      game.advance(0.05);
      stationPlayer(world, 4, 2);
      world.stats.enemiesKilled = 214;
      world.stats.structuresPlaced = 9;
      world.stats.structuresRecovered = 5;
      world.stats.structuresAbandoned = 3;
      world.stats.lastShotsTriggered = 2;
      world.stats.damageByPlayer = 3120;
      world.stats.damageByStructures = 7010;
      world.stats.peakTrail = 100;
      world.stats.distanceTravelled = 486;
      world.stats.elapsedSeconds = 512;
      world.events.emit({ type: "run.ended", outcome: "victory", reason: "gate" });
      world.events.drain();
    },
  },
  {
    id: "defeat",
    label: "Defeat transition",
    settle: 0.3,
    setup: (game, world) => {
      game.debugApi.teleportSpider(104);
      game.advance(0.05);
      stationPlayer(world, 3, 2);
      world.spider.coreHealth = 0;
      world.stats.enemiesKilled = 138;
      world.stats.structuresPlaced = 6;
      world.stats.structuresRecovered = 2;
      world.stats.structuresAbandoned = 4;
      world.stats.lastShotsTriggered = 3;
      world.stats.damageByPlayer = 1980;
      world.stats.damageByStructures = 4240;
      world.stats.peakTrail = 100;
      world.stats.distanceTravelled = 302;
      world.stats.elapsedSeconds = 344;
      world.events.emit({ type: "run.ended", outcome: "defeat", reason: "core" });
      world.events.drain();
    },
  },
];

export function findCapture(id: string): CaptureScenario | undefined {
  return CAPTURES.find((capture) => capture.id === id);
}

/**
 * Runs a scenario and leaves the renderer showing it.
 *
 * The settle pass matters: turrets need a moment to acquire and fire, and the
 * horde needs a moment to form up, or every combat capture is a picture of
 * enemies standing in a spawn ring.
 */
export function runCapture(game: Game, scenario: CaptureScenario): void {
  scenario.setup(game, game.world);
  game.snapCamera();
  // One call, not a loop of single steps: `advance` renders once at the end, so
  // stepping frame by frame would draw the scene hundreds of times. Under the
  // software renderer used for headless capture that is the difference between
  // a second and a timeout.
  game.advance(scenario.settle);
  // Then a few real frames. The bulk advance ages every effect to death in one
  // step, so without this the combat captures would show a settled scene with
  // no muzzle flashes, tracers or impacts in it at all. Each of these is a full
  // render, which under software rasterisation is expensive, so the count is
  // the smallest that reliably catches a turret volley.
  for (let i = 0; i < 5; i++) game.advance(1 / 60);
}
