# Marcha de Ferro (Iron March)

A single-player, isometric, controller-first roguelite of logistical action
and defense on the move. You play an engineer escorting a walking
spider-fortress that never stops for long: run ahead, gather scrap and fuel,
place turrets and barricades, refuel and repair the spider, fold and carry
machines forward as the spider advances, and decide what to abandon before a
noise-drawn undead horde overruns it. Full design intent lives in
`../prompt_guide.md`; the execution plan and phase gates live in
`../fable_implementation_plan.md`; working status/QA records live in
`../docs/`.

This is a vertical slice in active development, not a finished game. See
`../docs/IMPLEMENTATION_STATUS.md` for what is actually done versus pending.

## Procedural-asset note

The original spec calls for a licensed KayKit/Kenney asset library, synced
from a local `ASSET_SOURCE_ROOT` into `public/assets/`. That asset root is
not available in this environment. As a result, **every mesh in this build
is generated procedurally in code**, in `src/art/MeshForge.ts`, using only
the colors defined in `src/art/palette.ts` — there are no third-party 3D
assets bundled, and no licence obligations from missing attribution. The
asset manifest, `scripts/sync-assets.mjs`, and `scripts/validate-assets.mjs`
are implemented and functional against the manifest schema and runtime IDs
described in `prompt_guide.md` §17, so that a real asset library can be
dropped in later (by setting `ASSET_SOURCE_ROOT` and running
`npm run sync-assets`) without changing any gameplay code. Full reasoning is
recorded in `../docs/IMPLEMENTATION_STATUS.md`.

## Controls

### DualShock 4 (primary)

| Control | Gameplay | Menus |
|---|---|---|
| Left stick | Movement | Navigate |
| Right stick | Prioritize target / move placement ghost / pick radial entry | Navigate where applicable |
| Cross | Interact, pick up, deliver, confirm placement | Confirm |
| Circle | Dodge / cancel build | Back |
| Square, hold | Repair or refuel by context | Secondary action |
| Triangle, hold | Fold/recover structure | Details |
| L1, hold | Open build radial (slows time to 20%) | Switch tab, if needed |
| L2, hold | Maintenance/network/resource overlay | — |
| R1 | Active engineering tool | — |
| R2 | Focus auto-fire in the right-stick direction | — |
| D-pad up | Toggle overdrive | Navigate |
| D-pad left/right | Previous/next blueprint | Navigate |
| Share | Map and objective | — |
| Options | Pause | Pause/close |
| R3 | Recenter camera | — |

DS4 support uses the W3C standard gamepad mapping via
`navigator.getGamepads()`. If the browser does not report
`gamepad.mapping === "standard"`, the game offers a fallback/calibration
profile rather than assuming button indices.

### Keyboard/mouse (development fallback)

| Key | Action |
|---|---|
| WASD | Movement |
| Mouse | Prioritized direction/ghost |
| E | Interact/confirm |
| Space | Dodge/cancel |
| R, hold | Repair/refuel |
| F, hold | Recover structure |
| Q, hold | Build radial |
| Tab | Overlay/map |
| Arrow keys | Menu navigation |
| Esc | Pause |

The entire game is playable without a mouse on both input methods; the
keyboard/mouse profile exists for development convenience and automated
browser checks, not as the primary target experience.

## Commands

Run all commands from this directory (`game/`).

```bash
npm install              # install dependencies
npm run sync-assets      # copy assets from ASSET_SOURCE_ROOT into public/assets/, if a real asset library is available
npm run dev               # start the Vite dev server
npm run test               # run the test suite (vitest)
npm run validate-assets   # validate the asset manifest against public/assets/
npm run build              # type-check then produce a production build
npm run preview            # serve the production build locally, for real performance/visual measurement
```

Two additional scripts exist for convenience:

- `npm run build:fast` — production build without the blocking type-check
  step (useful while iterating; `npm run build` is the one that must pass
  for a real gate).
- `npm run verify` — runs `validate-assets`, `typecheck`, `test`, and
  `build:fast` in sequence; the closest single command to "is this in a
  shippable state."

`npm run sync-assets` requires the `ASSET_SOURCE_ROOT` environment variable
to point at a local KayKit/Kenney asset library. Without it, the game runs
entirely on the procedural fallback described above — `sync-assets` is safe
to skip in that case.

**A usable source library is already present in this checkout**, in a directory
named `-` (`game/-/`), holding exactly the 52 files the manifest asks for. It is
left untouched and unsynced on purpose: syncing would swap authored art in for
the procedural geometry across the whole build and invalidate every capture and
review that rests on it. See IMPLEMENTATION_STATUS.md §4b.1 for the command and
what it costs.

### Verification and QA

Both of these need the dev server running in another shell.

```bash
npm run capture           # deterministic screenshot set -> ../docs/captures
npm run perf              # four performance scenarios -> ../docs/perf.json
```

`capture` drives headless Edge through `?capture=<id>`; the scenes are defined
in `src/dev/captures.ts` and are a pure function of a seed, so a set taken
before and after a change is directly comparable. Add `--width`/`--height` for
a second viewport, or `--only=march,horde` to shoot a subset.

`perf` drives the browser over the DevTools protocol on port 9223 (`--port` to
change it). It deliberately does **not** use `--virtual-time-budget`: virtual
time stops `performance.now()` advancing across synchronous work, which silently
turned every timing this harness produced into 0.000. See PERFORMANCE.md §4.

Simulation cost is also measured independently in Node, with real timers and no
browser involved, as a cross-check on the browser figures:

```bash
npx vitest run tests/performance.test.ts
```

### Debugging a live run

- `` ` `` or `F3` toggles the debug overlay: frame percentiles, draw calls,
  triangles, live pool occupancy, flow-field rebuild cost, Trail state and the
  run seed.
- `?seed=IRONMARCH` reproduces an exact run. The seed of any run is shown on
  the pause screen and in the end-of-run summary.
- `window.__ironMarch` exposes the debug API used by the harnesses:
  `advance(seconds)`, `forceSpawn(archetype, count)`, `setTrail`, `giveScrap`,
  `teleportSpider`, `placeStructures(kind, count, radius)`, `phase()`,
  `sustainCore()`, `frame()`, `sceneAudit()` and `stats()`.

## Project layout

```text
game/
├── public/
│   └── assets/            # populated by sync-assets.mjs when ASSET_SOURCE_ROOT is available; empty/procedural otherwise
├── scripts/
│   ├── sync-assets.mjs        # copies a licensed asset library into public/assets/ per the manifest
│   └── validate-assets.mjs    # validates the manifest against what is actually present on disk
├── src/
│   ├── art/
│   │   ├── palette.ts          # the one authored color palette used everywhere
│   │   └── MeshForge.ts        # procedural geometry generation (see the asset note above)
│   ├── assets/
│   │   └── AssetManifest.ts    # manifest schema/loading, runtime-ID resolution
│   ├── core/                   # engine-agnostic simulation primitives: fixed loop, math, PRNG, event bus, object pool, shared types
│   ├── data/                   # every tunable value and static data table: balance, enemies, structures, upgrades, modules, routes
│   ├── game/
│   │   ├── GameWorld.ts        # central simulation state container
│   │   └── systems/            # per-tick systems (player movement, spider movement, construction, pressure network, ...)
│   ├── input/                  # InputActions, DualShock/keyboard profiles, InputManager
│   ├── rendering/               # Three.js renderer, camera controller, render-sync, VFX
│   ├── ui/                      # HUD, focus manager, radial menu, modal screens
│   └── save/                    # localStorage save schema, manager, migrations
└── tests/                       # vitest suite
```

Simulation state is authoritative and independent of Three.js scene objects:
systems in `src/game/systems/` mutate plain data in `GameWorld`, and a
render-sync layer applies that state to `Object3D`s once per frame. The
simulation itself runs on a fixed 60 Hz step with render-time interpolation,
per `prompt_guide.md` §16.4.
