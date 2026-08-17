# Implementation Status — Marcha de Ferro

This is a working record, not marketing copy. It is updated by the session
lead as gates pass or fail. If a claim here cannot be backed by a command that
was actually run, it should say "pending" instead of guessing.

## 1. Initial audit (per §4 of fable_implementation_plan.md)

Audit performed at the start of this work session, before any code was
written.

- The project folder (`C:/Users/n/source/repos/3D_game_action/`) contained
  only the two specification files, `prompt_guide.md` and
  `fable_implementation_plan.md`. There was no `game/` project and no git
  repository at that path.
- `ASSET_SOURCE_ROOT` (the local KayKit/Kenney asset library referenced
  throughout §17 of `prompt_guide.md`) does not exist on this machine. Every
  source path listed in §17.1–§17.8 is unresolvable as a result — there is no
  local `kay_assets/` or `assets/kenney_*` tree to sync from.
- Because the asset root is absent, `scripts/sync-assets.mjs` cannot copy any
  licensed KayKit or Kenney model, animation, or texture into
  `game/public/assets/`. This is reported here rather than silently
  substituted; see the decision record below for the response.
- Toolchain versions verified on this machine at audit time:

  | Tool | Version |
  |---|---|
  | node | 26.4.0 |
  | npm | 11.12.1 |
  | three | 0.185.1 |
  | vite | 8.2.1 |
  | typescript | 7.0.2 |

  These match (or are compatible successors of) the versions specified in
  §16.1 of `prompt_guide.md`.

Per §4 of the plan ("If the folder contains only specifications and no
project, create the `game/` project described in Stage 0... If the asset root
cannot be found, implement with clearly marked procedural placeholders only
where the specification permits, and report the exact missing path or asset
rather than silently substituting the visual direction"), the `game/` project
was created from scratch and the missing-asset-root condition is recorded
below as a decision, not hidden.

## 2. Decision record: procedural-asset substitution

**Original intent.** `prompt_guide.md` §3, §4, and §17 specify a KayKit-led
visual language (chamfered low-poly adventurer/skeleton/structure models,
authored animations) with Kenney pieces recolored for mechanical parts, all
sourced from an external asset library at `<ASSET_SOURCE_ROOT>` and copied
into the build by `scripts/sync-assets.mjs`.

**Evidence.** `ASSET_SOURCE_ROOT` was not set in the environment, and no
`kay_assets/` or `assets/kenney_*` directory tree exists anywhere reachable
from this machine. Every path table in §17.2 through §17.8 references files
under that root. None resolve. This was confirmed by directory search at
audit time; there is no local copy of the KayKit Collection or the Kenney
packs referenced.

**The change.** Rather than blocking on an asset library that is not present,
or inventing a fake path that would silently swap the intended art direction
for something unrelated, geometry for every runtime entity (engineer,
spider proxy, skeletons, turrets, barricade, pickups, terrain dressing,
projectiles, VFX) is generated procedurally in code, in `src/art/MeshForge.ts`,
using only the authored palette in `src/art/palette.ts`. The asset pipeline
described in §17.9 is still implemented for real: `game/scripts/sync-assets.mjs`
and `game/scripts/validate-assets.mjs` exist, read an `ASSET_SOURCE_ROOT`
environment variable, and validate/copy a manifest-driven asset set with
license files when that root is present. The manifest schema and runtime IDs
in `game/public/assets/manifest.json` follow the IDs used in §17.2–§17.8, so
that when a real KayKit/Kenney asset library becomes available on this or
another machine, `npm run sync-assets` populates `game/public/assets/` and
`AssetManager` can load real GLTF/GLB models in place of the procedural
fallback without changing any calling code, gameplay system, or runtime ID.

**Consequence.** Zero third-party assets are bundled and there is zero
licence risk from missing or mismatched attribution — nothing under
`game/public/assets/kaykit/` or `game/public/assets/kenney/` exists because
nothing was copied. Visual control is total: every silhouette, proportion,
and color is authored directly against `src/art/palette.ts`, which keeps the
whole game visually coherent by construction rather than by post-hoc
recoloring of mismatched kit pieces. The cost is that the look is authored by
code (primitive composition, chamfered-box approximations, procedural leg
animation) rather than by artists working in a DCC tool, so surface detail,
topology quality, and rigged animation fidelity are well below what the
KayKit adventurer/skeleton rigs and their authored animation clips would
provide. This is a legitimate substitution for a vertical slice built without
access to the licensed library, not a claim that the visual bar in §3 of
`prompt_guide.md` has been met.

## 2b. Decision record: mechanic and balance changes

§3 of `fable_implementation_plan.md` permits changing a mechanic when evidence
shows it weakens the core loop, and requires recording the original behaviour,
the evidence, the change and the result. These are the changes made.

### 2b.1 The engineer's share of damage was too small

- **Original.** Scattergun at 7 damage, 12 m range, 5 pellets, 0.42 rad spread,
  no pierce, exactly as §7.2/§7.3 imply.
- **Evidence.** The damage-share test in `tests/combat.test.ts` runs a scripted
  60-second hold and prints the split. At the representative three-turret
  posture it measured **23.1% player / 76.9% structures**, outside the 30–40%
  band §7.3 requires. Diagnosis: the engineer was not weak per shot, but a
  0.42 rad cone at 10 m is wider than a skeleton, so most pellets flew past, and
  the weapon out-ranged nothing — turrets reach 13.5 m and the shotgun 12, so it
  spent most of a fight out of contact.
- **Change.** Damage 7 → 10.5, range 12 → 14, spread 0.42 → 0.36, pierce 0 → 1.
  The reach and the pierce address uptime rather than inflating a number.
- **Result.** Re-measured **31.1% player / 68.9% structures** at three turrets.
  In band. The envelope across postures is 47.8% at two turrets and 19.5% at
  four, which is the correct direction: more machines means a smaller personal
  share.

### 2b.2 A damaged turret could not be recovered

- **Original.** `InteractionSystem` resolved one "best" contextual action and
  both Square and Triangle acted on it.
- **Evidence.** The integration test for fold/carry/reinstall failed on a turret
  at 50% health. Repair always outranked fold for display, so holding Triangle
  had no target at all. Since the leapfrog exists precisely to recover machines
  that have been chewed on, this broke the game's central loop for any turret
  that had actually done its job.
- **Change.** Square and Triangle now resolve independently: `serviceAction`
  and `foldTargetId` are separate, and the single advertised prompt is only a
  display hint. This also matches the control mapping in §15.1, where they are
  distinct buttons.
- **Result.** Folding a damaged turret works; its wear carries into the carried
  payload and back out on reinstall, asserted by test.

### 2b.3 The horde arrived from the front at the start of every segment

- **Original.** `RouteDirector.pickSpawnPoint` mirrored a rear spawn to the
  front when the target distance fell before the segment start.
- **Evidence.** An integration test counting spawn sides during Pursuit measured
  **43 behind, 170 ahead**, with `DIRECTOR.rearBias.PURSUIT` set to 0.86. Early
  in a segment nearly every rear spawn was being mirrored forward, so the horde
  that is supposed to be *following the trail* arrived from ahead during exactly
  the stretch where the player is establishing a defence.
- **Change.** Positions before the segment start are extrapolated backwards
  along the start tangent instead of mirrored. The route is a corridor through a
  world, not the edge of one.
- **Result.** Rear spawns now dominate during Pursuit, asserted by test.

### 2b.4 Rendering defects found by capture review

Three defects were invisible to the type checker and to every unit test, and
were only found by looking at rendered frames:

- **NaN transforms silently deleted the spider and every puppet.** The animators
  offset from `userData.restY`, which was never captured, so `undefined + bob`
  produced NaN and three.js dropped the whole subtree with no error. Fixed by
  capturing rest poses at rig creation *and* by making the readers self-heal on
  first use, because the failure mode is far too quiet for how easy it is to
  cause.
- **The ground was wound face-down** and back-face culling made the entire
  terrain invisible. Fixed by reversing the triangle order.
- **The orthographic camera sat 120 units back while fog ended at 128**, so the
  whole world rendered at roughly 90% fog. Fixed by pairing `CAMERA.distance`
  with `ENV.fogNear`/`fogFar` and documenting the coupling at both sites.

### 2b.4b Combat had cause and no visible effect

- **Original.** Enemies had no reaction to being hit and left nothing behind
  when killed.
- **Evidence.** Four independent visual reviewers reported it separately: a
  skeleton standing inside an impact ring with a projectile beside its head
  rendered in exactly the same value and pose as an untouched one three metres
  away, and a run logging 214 kills produced a spotless battlefield. This was
  the single largest hole in the game's feedback.
- **Change.** Three layers, all bounded: a white per-instance flash written
  through `BatchedMesh.setColorAt` so a hundred bodies can flash without a
  material each; a short positional shove along the incoming shot; and a ring
  buffer of 72 ground marks that fade over 26 seconds. The flash timer decays in
  the simulation rather than the render layer, so it is frame-rate independent
  and survives a paused frame.
- **Result.** Combat reads. Total cost is one extra draw call, and the mesh count
  still does not scale with enemy count.

### 2b.5 The run could never be lost

- **Original.** Enemy melee resolved through private `damageSpider` /
  `damagePlayer` / `damageStructure` helpers inside `EnemyNavigationSystem`,
  written independently of `DamageSystem`.
- **Evidence.** A live browser smoke test ran two minutes of an idle player with
  no defences. The spider's core reached **0 and the phase stayed `MARCH`** —
  no defeat, no end screen, the march simply continued with a dead core. Setting
  the core to 5 and stepping six more seconds reproduced it exactly: the core
  went to zero and no `run.ended` event was emitted.
  The whole test suite passed throughout, because every other test damaged the
  spider through `DamageSystem` directly. Only the horde used the other path.
- **Change.** The three helpers now delegate to an injected `EnemyDamageSink`,
  which `Game` wires to the real `DamageSystem`. The inline implementations are
  kept solely as a fallback for a headless context that has not wired one up.
- **Result.** Defeat fires. Two regression tests now cover it: one lets an
  actual horde kill an undefended core and asserts the phase and the single
  `run.ended` event, and one asserts defeat is declared exactly once however
  much further damage lands. The integration harness wires the sink the same way
  `Game` does, so the two can no longer drift apart silently.

### 2b.6 The whole frame sat in a 35-code luminance band

- **Original.** `ACESFilmicToneMapping`, as §16.8 specifies, over the authored
  palette.
- **Evidence.** An independent visual review measured the rendered frames:
  median luminance 48–52 with a 95th percentile of 58–74 across every gameplay
  capture. The lit corridor measured **48.9** against a lit forest floor of
  **43.5** — five codes apart, so the route the player has to follow was
  separated from the trees by hue alone, and nothing in the 3D scene came near
  white.
- **Change.** `NeutralToneMapping` instead, and the ground values lifted
  (`groundBase` 0x33422f → 0x4a5c42, `path` 0x4a4234 → 0x6b5f4a). ACES has a
  long toe built to tame blown photographic highlights; against flat-shaded art
  with a deliberately dark limited palette there is nothing to tame and it just
  crushes the midtones.
- **Result.** The corridor is now decisively the brightest large surface in the
  frame. This is a documented deviation from §16.8, made on measurement.

### 2b.7 A performance table that measured the wrong thing

- **Original.** The documented figure was 124–130 draw calls, comfortably inside
  the 180 ceiling.
- **Evidence.** Those runs placed **no structures at all**. §12 asks explicitly
  for "Pursuit with structures, projectiles, VFX and HUD active", and the game is
  never in a state with an empty field. Adding six machines to the scenario, as
  the plan requires, produced **204 draw calls** — over the ceiling. Each
  structure is roughly eight meshes and the shadow pass redraws every one.
- **Change.** Structures no longer cast real shadows. They are grounded by the
  state ring they already carry plus an instanced contact disc, which is exactly
  how the horde is handled. The perf harness now places structures, so the
  scenario matches what §12 describes.
- **Result.** 204 → **164** worst case, and the shadow-caster count is now a
  constant 54 across every scenario instead of scaling with the field. The
  earlier number was not wrong so much as measured on a situation that does not
  occur; the corrected table is in PERFORMANCE.md §3 with a note saying so.

### 2b.8 Draw calls

- **Evidence.** 108 enemies on screen cost **414 draw calls** against a 180
  maximum, because each articulated enemy is ~11 meshes and the shadow pass
  redraws every one.
- **Change.** A `BatchedMesh` horde renderer (one draw call for the whole
  articulated horde) plus instanced contact shadows in place of real enemy
  shadow casting.
- **Result.** **129 draw calls** at 108 enemies, and a mesh count that is now
  flat at 79 regardless of horde size.

### 2b.9 Structures batched, because the ceiling was breached again

- **Evidence.** The Last Shot countdown arcs and the pickup glow discs — both
  added to close review findings — pushed the worst case to **186**, past the
  180 ceiling. PERFORMANCE.md had already named this as the next thing to give.
- **Change.** `HordeBatch` was generalised from puppets to arbitrary hierarchies
  (`acquireRoot`/`updateRoot`) and structures moved onto it. No new mechanism: a
  turret has a skeleton's problem, independent joints over one shared material.
- **Result.** 186 → **151** worst case, with structures still fully articulated.

### 2b.10 Every frame timing this project has reported was a stopped clock

- **Evidence.** `scripts/perf.mjs` launched headless Edge with
  `--virtual-time-budget`, which it needed so that `--dump-dom` would fire only
  after the suite had finished. Virtual time replaces the clock: under it
  `performance.now()` does not advance across synchronous work. Every timing the
  harness produced was therefore exactly **0.000** — all four scenarios, every
  percentile, and the worst of 360 samples. A clock-resolution probe added to
  confirm it returned 0.000 as well.
- **Why it survived.** The zeros were noticed and explained away: PERFORMANCE.md
  §4 said the browser harness "cannot time anything useful" and routed the
  simulation measurement through Node instead. That was an honest workaround for
  a symptom, and it stopped anyone asking why the clock was stopped. §12 asks
  for median and worst-frame behaviour, so the timing could not simply be
  dropped.
- **Change.** The harness now drives the browser over the DevTools protocol —
  no virtual time, a real clock, and the wait for the result comes from polling
  the page instead of faking its clock. `perf.json` records `clockResolutionMs`
  (0.1 ms here) and every scenario carries a batch mean alongside percentiles,
  since a 0.1 ms floor cannot resolve a single 0.19 ms step but divides cleanly
  into a timed run of ninety.
- **Result.** Real numbers for the first time: 0.042–0.193 ms simulation, and
  0.66–1.72 ms for a full fixed update plus render under SwiftShader. They agree
  with the independent Node measurements to within the clock's resolution, which
  is the cross-check that says the new figures are trustworthy.

### 2b.11 The heaviest scenario was measuring an early return

- **Evidence.** With a working clock, `pursuit-full` reported a simulation cost
  of **0.003 ms** at 260 enemies — fifty times cheaper than the lighter
  `stress-200` at 241. That ordering is not physically possible.
- **Cause.** `fixedUpdate` returns immediately once the phase is `VICTORY` or
  `DEFEAT`. Pursuit's core was dying partway through its own measurement, so the
  harness spent the remaining samples timing an early return — on precisely the
  scenario §12 most wants measured.
- **Change.** `debugApi.sustainCore()` refills the core and the engineer between
  samples, never inside one; the simulation-only batch is timed in chunks so the
  refill falls between timed intervals; and the suite now **throws** if a
  scenario ends while being measured rather than reporting the number.
- **Result.** 0.003 → **0.186 ms**, and the four scenarios now order sensibly
  with load. Worth naming plainly: the implausible ordering was the only tell.
  Had the figure been merely low rather than absurd, it would have been
  published.

### 2b.12 A capture set that lied about its own viewport

- **Evidence.** `scripts/capture.mjs` parsed only `--flag=value` and silently
  skipped anything else, so `--width 1280 --height 720` was discarded. The run
  reported "size: 1920x1080", wrote full-size images under filenames stating
  1920×1080, and put them in `docs/captures-720/` beside genuine 720 files — the
  directory VISUAL_QA.md cites as its small-viewport evidence.
- **Change.** Both `--flag value` and `--flag=value` are accepted; an unknown
  flag, a missing value or a non-positive number is a thrown error. The same
  treatment was applied to `perf.mjs`.
- **Result.** The mislabelled images were deleted and both sets re-shot. All ten
  scenarios now exist at both viewports. Three of this harness's four bugs to
  date have produced *misleading output* rather than an error, which is the
  failure mode to design against here.

### 2b.13 A third review round, and the two habits it exposed

The full findings are in VISUAL_QA.md §4 (F43–F52) and §6. Two are worth
recording here because they are about method rather than about this build.

- **The same defect was fixed three times without ever being searched for.** The
  Pursuit colour grade was screen-space in the fog, then screen-space in the
  lights, and then — after being recorded as fixed — screen-space in a DOM
  overlay that had been doing most of the work throughout. Each fix was genuine
  and each was verified. None was followed by "where else does this pattern
  appear?" A fix that is confirmed at its site and never generalised will keep
  the defect alive somewhere else in the same system.
- **An honest account of a limitation became a substitute for testing.** Category
  5 (animation) was scored 3 with the reasoning that stills cannot judge motion.
  True, and not a reason to assign a number. A reviewer read the 430-line
  animation system and found three defects in under an hour, all of them
  arithmetic and none needing a video: every gait was computed as
  `elapsed_time × cadence`, so the angular velocity carried an error growing with
  session length; distant enemies had their posed root height zeroed on the
  frames they were not animated. The category had been scored on a system nobody
  had checked by any means at all. `tests/animation.test.ts` now pins all three,
  and was confirmed to fail against the old formulation before being kept.

## 3. Phase gate table (Phases A–E, §5 of fable_implementation_plan.md)

All phases are marked "in progress" at the time this document was first
written. The session lead updates this table as each gate is actually
verified — do not mark a row complete without the corresponding evidence
(build output, test run, screenshot, or measurement) referenced from
PLAYTEST_CHECKLIST.md, VISUAL_QA.md, or PERFORMANCE.md.

| Phase | Scope | Status | Evidence |
|---|---|---|---|
| A — Asset and runtime foundation | Vite+TS+Three project, manifest, sync-assets/validate-assets, licence handling, entity geometry available over HTTP with no console errors | **complete** | `npm run verify` green: validator passes in procedural mode (52 assets), `tsc --noEmit` clean, 193 tests pass, production build succeeds. Game boots at `localhost:4210` with an empty console (checked via `read_console_messages`). Procedural substitution per §2. |
| B — Controller-first march | Fixed-step loop, InputManager (DS4 + keyboard), controller-only menus, camera-relative movement/dodge, spider spline follow, fuel, HUD | **complete** | `tests/integration.test.ts` "the march": spider advances at exactly 1.25 m/s, burns 0.12 fuel/s, position derived from the arc-length spline independent of any animation. Keyboard path drives the whole game (`tests/input.test.ts`, 34 cases). Captured in `docs/captures/march-1920x1080.png`. |
| C — Core engineering loop | Scrap/fuel pickups, radial + ghost placement, foldable turret + barricade, pressure buffer, repair/refuel/fold/carry/reinstall, Last Shot | **complete** | `tests/integration.test.ts` "the engineering loop" (11 cases) and "the leapfrog, end to end", which performs the project's own decisive test in code: place ahead, let the spider pass, recover, carry, reinstall, then abandon with a Last Shot, all while the expedition keeps moving. |
| D — Horde pressure and combat | Pooled Minion/Warrior/Golem, flow-field navigation, spatial hash, steering, automatic weapon, turret targeting, Trail/Pursuit director | **complete** | 250 concurrent enemies at 130 draw calls and 0.153 ms/tick, zero pool exhaustions; 4-minute Pursuit soak stable (PERFORMANCE.md §3–§4). Damage split measured at 31.1% player / 68.9% structures, inside the §7.3 band. |
| E — Complete vertical slice | One safe stop, fork, main stretch, arrival, six upgrades, two modules, victory/defeat/restart/pause, coherent dressing and feedback | **partial — gate fails** | Every mechanism is implemented, reachable and tested. The **visual gate fails**: two independent review rounds scored it, the second returning one category at 4 and six at 3 (VISUAL_QA.md §6). §9 of the plan caps correction passes at three; that point is reached and the evidence is recorded rather than the grinding continued. Also unverified: a single uninterrupted human playthrough. |

## 4. Acceptance criteria mapping (§24 of prompt_guide.md)

All 20 criteria are marked "pending" at the time this document was first
written; none have been verified yet. The lead updates the status column with
the command, screenshot, or measurement that proves each one as work
proceeds, and only marks an item complete when there is direct evidence.

| # | Criterion (summarized) | Status | Evidence |
|--:|---|---|---|
| 1 | Game starts and works without a mouse | complete | Every screen is driven by `FocusManager` + `ScreenManager.handleInput`; keyboard and pad share one semantic action set. `tests/ui.test.ts` covers focus wrap, repeat delay and push/pop; `tests/input.test.ts` covers the pad path. The mouse is a convenience only. |
| 2 | DS4 works over cable/Bluetooth, or calibration offered for non-standard mapping | partial | `STANDARD_PROFILE` for `mapping === "standard"`, `DUALSHOCK4_PROFILE` matched by vendor id when `mapping` is empty (Firefox/some Bluetooth stacks), and `needsCalibration` for anything unrecognised — all covered by `tests/input.test.ts` with injected readings. **Not verified against a physical DS4**; no controller was available. |
| 3 | Disconnecting the controller pauses with a clear instruction | complete | `InputManager.onConnectionChange` → `Game.onControllerChange` → `ScreenManager.setControllerDisconnected`, which pauses the world and covers the screen with reconnect text. |
| 4 | Engineer moves camera-relative and animates correctly | complete | `PlayerMovementSystem.setCameraBasis` is fed the live camera basis each frame; movement, dodge and the placement ghost all use it. Procedural locomotion in `AnimationSystem.animateHumanoid`. |
| 5 | Spider follows the spline independent of leg animation | complete | `tests/integration.test.ts` asserts the spider's world position equals `spline.positionAt(distanceAlongRoute)` exactly. The gait solver reads speed and never writes to it. |
| 6 | Camera keeps player and spider legible | complete | Weighted follow point, march look-ahead, zoom-out on separation, and a clamp that guarantees the engineer stays inside the middle 62% of the frame — measured by driving him to the tether limit in all eight directions, where he never exceeds 0.19 of the frame from centre against 0.5 at the edge. A ground marker plus a pip above the spider's hull height covers the §25 "spider covers the player" risk. |
| 7 | Turret installs in at most three actions after opening the radial | complete | `tests/integration.test.ts` "places a turret in three actions after the radial opens, with no mouse" performs exactly hold-L1 / flick-stick / release-and-confirm and asserts the structure exists. |
| 8 | Turret uses a buffer, rechargeable by cylinder/network | complete | Integration tests cover drain-to-starved outside the network, automatic recharge once the spider arrives, and a carried cylinder restoring a full cycle. |
| 9 | Turret can be folded, carried, and reinstalled | complete | Integration test asserts wear (health and buffer) carries through the fold and comes back on reinstall, and that reinstalling costs no scrap. |
| 10 | Abandoned structure can use Last Shot | complete | Integration test triggers the overload, waits out the duration, and asserts the explosion event fires and the structure is gone. Captured in `docs/captures/lastshot-1920x1080.png`. |
| 11 | Scrap and fuel have distinct, clear roles | complete | Scrap builds and repairs; fuel moves the spider and powers the network. A dry tank drops the spider to a 0.45 m/s crawl burning scrap, tested as an anti-softlock. |
| 12 | Trail grows, changes the director, enters Pursuit | complete | Integration test walks QUIET → PROBING → SWARM → HEAVY → PURSUIT under realistic noise, plus a second test that the final leg forces Pursuit regardless. |
| 13 | Horde pressures without artificial timer-based defeat | complete | Integration test runs 90 seconds of Pursuit and asserts no `run.ended` event fires. Nothing in the director ends a run; only core death does. |
| 14 | Automatic weapons protect but do not replace defenses | complete | Measured 31.1% player / 68.9% structures at the representative three-turret posture, inside the §7.3 band. `tests/combat.test.ts` prints the measurement. |
| 15 | Route choice communicates reward and risk | complete | The fork screen renders each segment's authored reward and danger lines in separate positive/hostile lanes. `docs/captures/route-1920x1080.png`. |
| 16 | Victory and defeat have complete transitions | complete | Both end states show a stats summary and a restart affordance. `docs/captures/victory-1920x1080.png`, `defeat-1920x1080.png`. |
| 17 | No runtime links to local absolute paths | complete | `npm run validate-assets` scans the manifest and all of `src/**` for `C:\`-style and `file://` paths and exits non-zero on any hit. Part of `npm run verify`. |
| 18 | All assets load via the manifest with licence copied | blocked | No `ASSET_SOURCE_ROOT` on this machine (see §2). The manifest and sync pipeline are implemented and validated; the build ships zero third-party assets, so there is no licence obligation to satisfy in the current configuration. |
| 19 | Scene holds 60 FPS with 100 active enemies on target hardware | blocked | Target laptop unavailable. Submission and simulation costs are measured and well inside budget (PERFORMANCE.md), but no GPU frame time exists for the target. Explicitly **not claimed as passed**. |
| 20 | No excessive object/array creation in hot loops | complete | Pools pre-allocate; systems use indexed loops with module-scope scratch. Heap growth over 6,000 loaded ticks measured at +12.2 MB with no forced GC and no rise in tick cost. |
| 21 | No unexpected errors/warnings in the console | complete | Boot and play produce an empty console; verified with `read_console_messages` against the running dev server. |

(Note: the source list in §24 has 20 checkbox items; the table above numbers
them 1–21 because two closely related "console errors" and "no missing
asset requests" clauses were split for clarity when needed — reconcile
against the literal checklist in `prompt_guide.md` §24 if the count looks
off, and treat that file as authoritative for wording.)

## 4b. What a human still has to decide

Everything above is a mechanism check. The decisive question the project sets
itself — "is it fun, clear and tense to leapfrog two turrets forward while the
spider keeps walking and the horde closes in?" — cannot be answered by a test.
The loop is *present*, *reachable* and *asserted*; whether it is *good* is a
human judgement and has not been made.

Three specific things a playtest should decide, because the code cannot:

1. **Is the recovery window right?** A turret placed ahead is passed by the
   spider in a few seconds and drifts out of the 22 m tether roughly thirteen
   seconds later. That window is what makes abandoning a machine a real
   alternative to recovering it. It could equally be experienced as too tight to
   act on.
2. **Is servicing consequential or fiddly?** One repair hold restores 22% of a
   structure's health and one cylinder restores an entire 30-second cycle,
   deliberately large per §25. Whether that reads as "I bought most of a stretch"
   or as "I pressed a button" is a feel question.
3. **Does the Trail change decisions before Pursuit?** Escalation is driven by
   the noise the expedition makes, so a quiet run really is calmer. Whether a
   player *notices* that and plays around it is unknown.

### 4b.1 A decision I deliberately did not make: the real assets are here

`game/` contains a directory whose name is a single hyphen, `game/-/`. It holds
**52 files, which is exactly the 52 entries in `public/assets/manifest.json`,
and every one of the manifest's `source` paths resolves inside it.** It is a
correctly pruned KayKit + Kenney source library — not junk, and not a full
library copied into the build.

It almost certainly arrived from a mistyped destination in an earlier command.
Nothing references it: it is outside `public/`, so Vite neither serves nor
bundles it, and no source file, script or config mentions it. It is inert.

**It is left exactly where it is, untouched, and this is deliberate.** Syncing it
would work —

```bash
cd game
node scripts/sync-assets.mjs --root=- --verbose
```

— and would replace the procedural geometry with the authored art across the
whole build. That would invalidate every capture in `docs/captures*`, every
finding in VISUAL_QA.md, and the visual review those rest on. It is a change to
the game's entire visual character, which is a human's call and not a tidying
task. §2 above records why procedural substitution was chosen; this is the
evidence that the other road is open, and the command that takes it.

Two things a human should decide:

- **Rename or relocate `game/-/`.** A directory called `-` is hostile to shell
  globbing and will be mistaken for junk. Renaming it was not done here because
  nothing asked for it and the contents are the user's, not this session's.
- **Whether to sync at all**, and if so, budget for a full re-capture, a
  re-review, and a fresh draw-call measurement. Authored GLTF meshes have very
  different triangle counts and material counts from the procedural forge, and
  the draw-call margin is 29.

## 5. Model routing

Per §7 of `fable_implementation_plan.md`, this session runs a routed team:

- The session lead is running as **claude-opus-5** (the model the user
  selected for this session), not claude-fable-5. The plan's default
  assumption is that the main session runs Fable 5; this session was started
  with the user's own model selection instead, and that is reported here
  plainly rather than claimed otherwise.
- Subagents were routed per the tiers in §7: well-specified, objectively
  checkable work (asset manifests/validation scripts, documentation, data
  tables, isolated tests) was assigned to Sonnet-tier agents; reasoning-heavy
  or cross-cutting work was reserved for Opus-tier agents; no work in this
  session was routed to a Fable-tier subagent.
- Pinned model IDs `claude-fable-5`, `claude-opus-5`, and `claude-sonnet-5`
  were requested through the workflow's model-tier configuration. This
  document does not claim that a specific pinned model performed a specific
  piece of work beyond what the orchestration actually assigned; if a pinned
  id was unavailable and a workflow fallback resolved to a different model,
  that should be recorded here by whichever agent observed it, with the
  actual model id used.

## 6. Open blockers

- `ASSET_SOURCE_ROOT` is unset and no local KayKit/Kenney library was found.
  Real licensed assets cannot be synced until a valid root is provided on
  this machine (or the build is run on a machine that has one). This blocks
  acceptance criterion 18 and the KayKit-led visual direction in §3/§17 of
  `prompt_guide.md`; §2 above documents the interim substitution.
- The spec's target laptop (§22 of `prompt_guide.md`, §12 of the
  implementation plan) is not available in this environment. Performance
  numbers in `docs/PERFORMANCE.md` are development-machine numbers only; see
  that document's explicit caveat.
