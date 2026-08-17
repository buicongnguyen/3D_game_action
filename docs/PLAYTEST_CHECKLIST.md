# Playtest Checklist — Marcha de Ferro

Reproducible gameplay checks, derived from the Stage 5 vertical-slice
acceptance criteria in §24 of `prompt_guide.md` and the gameplay quality
rubric in §11 of `fable_implementation_plan.md`. Each check states exactly
how to run it and what would count as a failure. Run these from a production
build (`npm run build && npm run preview`) whenever a phase gate is being
formally evaluated; the dev server is fine for quick iteration checks.

Use seed `12345` for every check unless a check says otherwise, so results
are directly comparable across runs and across playtesters. Record the actual
seed used if you deviate.

For every formal run, record: date, build commit/state, seed, input device
(DS4 or keyboard), and outcome (pass / fail / blocked) next to the checklist
item, plus a one-line note on what was observed.

---

## What is already automated

Much of this list no longer needs a human. `tests/integration.test.ts` drives
the real system stack headlessly, in the real §16.4 order, and asserts the
behaviour rather than the implementation. Run it with:

```bash
cd game && npx vitest run tests/integration.test.ts
```

| Checklist area | Automated coverage |
|---|---|
| March speed, fuel burn, spline independence | "the march" — asserts 1.25 m/s, 0.12 fuel/s, and that the spider's world position equals the arc-length spline sample exactly |
| Fuel exhaustion is not a softlock | asserts the fallback crawl and that scrap burns instead |
| Tether pulls back rather than kills | asserts the pull, survival, and the event |
| Three-action placement, no mouse | performs hold-L1 / flick-stick / release-and-confirm as input edges |
| Unpowered-ahead then powered-on-arrival | asserts the leapfrog's central promise |
| Buffer drain and starvation | asserts the countdown and the single `bufferEmpty` event |
| Fold / carry / reinstall with wear | asserts health and buffer carry through, and that reinstalling is free |
| One carried object at a time | asserts the second turret stays standing |
| Cylinder recharge, repair | asserts a whole cycle restored, and a large single-hold repair |
| Last Shot | asserts overload, detonation and removal |
| Left-behind warning | asserts the flag and the event |
| **The full leapfrog, end to end** | the project's own decisive test, run as code |
| Trail escalation through all five states | asserts each transition and PURSUIT |
| Forced Pursuit on the final leg | asserts it regardless of how quiet the run was |
| Rear-biased spawning | asserts behind > ahead during Pursuit |
| No timed loss | asserts no `run.ended` across 90 s of Pursuit |
| Defeat actually fires | lets a real horde kill an undefended core |
| Determinism | same seed gives an identical run; different seeds differ |
| Pooling | 180 s busy run with zero exhaustions |
| Damage split (§7.3) | measured and printed; currently 31.1% player / 68.9% structures |

What a human still has to judge, and why: **whether it is fun.** No test can
tell you whether the urgency reads as tension or as harassment, whether the
recovery window feels tight or unfair, or whether maintenance feels
consequential or fiddly. Those are §11's real questions and they are why the
handoff asks for a specific playtest rather than a general one.

## Phase A — Asset and runtime foundation

1. **Clean load, no console errors.**
   How to run: `npm run build && npm run preview`, open the served URL in a
   desktop browser, open devtools console, let the boot/load screen finish.
   Look for: zero uncaught errors, zero 404s in the network tab, zero
   "THREE.GLTFLoader" or texture-decode warnings.
   Failure: any uncaught error, any 404, any missing-texture warning.

2. **Asset validation passes.**
   How to run: `npm run validate-assets`.
   Look for: the script exits 0 and reports the manifest as internally
   consistent (every runtime ID resolvable, no orphaned files).
   Failure: nonzero exit code, or a reported missing/unreferenced entry that
   was not already flagged as a known blocker in IMPLEMENTATION_STATUS.md.

3. **No local absolute paths at runtime.**
   How to run: with devtools network tab open during a full playthrough,
   inspect every requested resource URL.
   Look for: every asset request is a relative or same-origin URL under
   `/assets/...`.
   Failure: any request referencing a `file://`, `C:\`, or other local
   filesystem path, or any hardcoded `ASSET_SOURCE_ROOT` value baked into a
   bundle.

## Phase B — Controller-first march

4. **Full mouseless boot and menu navigation.**
   How to run: unplug/disconnect the mouse (or simply do not touch it), boot
   the game with DS4 connected, and navigate from the title screen through
   loadout selection into the march using only the D-pad/stick and
   face buttons.
   Look for: every menu item is reachable and confirmable; focus is always
   visible.
   Failure: any menu state that requires a pointer, or a focus trap where no
   D-pad/stick input changes the highlighted item.

5. **Keyboard fallback parity.**
   How to run: repeat check 4 with the DS4 disconnected, using WASD / E /
   Space / R / F / Q / Tab / arrow keys / Esc per the §15.3 mapping.
   Look for: identical reachability to check 4.
   Failure: any action possible on DS4 but not on keyboard, or vice versa.

6. **Controller disconnect handling.**
   How to run: during the march, physically disconnect the DS4 (unplug USB
   or power off over Bluetooth).
   Look for: the game pauses immediately and shows an explicit
   reconnect/instruction message; simulation does not keep running in the
   background.
   Failure: the game continues simulating with a frozen or unresponsive
   character, or shows no message.

7. **Camera-relative movement and animation correctness.**
   How to run: during the march, rotate the camera reference (if R3 recenter
   or any camera movement exists) and push the left stick in each of the
   four cardinal directions relative to the screen.
   Look for: the engineer moves in the screen-relative direction the stick
   points, and the run/idle/dodge animation matches the actual movement
   state with no obvious foot sliding.
   Failure: movement direction does not match stick direction relative to
   camera, or the character animates "run" while stationary or "idle" while
   moving.

8. **Spider path independent of leg animation.**
   How to run: watch the spider's `distanceAlongRoute` (debug overlay or
   console log) over a fixed time window; separately watch the leg animation
   cycle.
   Look for: `distanceAlongRoute` advances at the configured march speed
   (1.25 m/s) regardless of whether leg animation is stuttering, paused, or
   desynced.
   Failure: spider position visibly hitches or pauses in sync with an
   animation frame drop.

9. **Player/spider/route legibility at 1080p.**
   How to run: play a full march segment at a 1920x1080 viewport.
   Look for: the player, the spider, the route direction, and any visible
   threat are each identifiable within roughly one second of looking at the
   screen, without needing to pause.
   Failure: the spider or player is occluded, off-screen without an
   indicator, or visually indistinguishable from the environment for a
   sustained period.

## Phase C — Core engineering loop

10. **Turret placement in three actions or fewer.**
    How to run: from neutral gameplay, hold L1 to open the radial, select the
    rivet turret with the right stick, release L1, position the ghost, press
    Cross to confirm. Count discrete actions from radial-open to confirm.
    Look for: hold L1 (1) + confirm blueprint selection or release (2) +
    Cross to confirm placement (3) is sufficient; no extra menu, no forced
    rotation step, no extra confirmation dialog.
    Failure: placing a turret requires a fourth distinct action beyond
    opening the radial, choosing the blueprint, and confirming placement.

11. **Placement ghost feedback colors.**
    How to run: open the radial, select the turret, move the ghost onto (a)
    open ground inside the pressure network, (b) open ground outside the
    pressure network but otherwise legal, (c) a colliding/invalid location
    (on top of terrain obstacle, out of build range, or over the spider
    corridor).
    Look for: green in case (a), yellow in case (b), red in case (c), using
    exactly the colors defined in `src/art/palette.ts` FEEDBACK tokens.
    Failure: any case shows the wrong color, or the ghost does not change
    color at all.

12. **Pressure buffer behavior.**
    How to run: install a turret inside the spider's service radius, let it
    fire, then walk the spider far enough away that the turret leaves the
    service radius. Time how long it keeps firing on its stored buffer.
    Look for: the turret continues operating for roughly the configured
    buffer duration (30 s base, see `src/data/balance.ts` STRUCTURES) after
    leaving the service radius, then stops.
    Failure: the turret stops immediately on leaving the radius, or never
    stops (buffer never depletes).

13. **Fold, carry, and reinstall a turret (the leapfrog).**
    How to run: install turret A ahead of the spider; let the spider
    approach and pass it; hold Triangle on turret A to fold it; carry it
    forward past the spider while turret B (already installed further
    ahead) is still firing; install turret A again ahead of turret B.
    Repeat this cycle across an entire route segment.
    Look for: the whole cycle is achievable without a mouse, without ever
    both turrets being down (or without an unreasonable gap), and the folded
    turret genuinely returns to inventory/carry state (not deleted and
    recreated).
    Failure: folding loses the turret's persistent state (e.g., resets
    upgrades or accumulated damage), the carry slot conflicts incorrectly
    with a cylinder, or the cycle cannot be sustained for a full stretch.

14. **Recovery vs. abandonment is a real tradeoff.**
    How to run: leave a turret behind deliberately (do not fold it) until
    the spider is far enough that recovering it costs meaningful time versus
    keeping pace with the spider.
    Look for: recovering it is possible but costs noticeable travel time
    against the spider's advance; abandoning it and triggering Last Shot
    (Square or the designated action) is a viable, sometimes-better
    alternative.
    Failure: recovery is always trivially free (no time cost), or recovery
    is never worth attempting regardless of situation (no real choice).

15. **Last Shot on an abandoned structure.**
    How to run: leave a turret behind until its buffer empties, or manually
    trigger overload.
    Look for: a visibly increased rate of fire/damage window (3-5 s per
    §8.3), the structure becomes unrecoverable, and it explodes at the end
    with damage/CC in its immediate area.
    Failure: no visible escalation before the explosion, the structure
    remains recoverable after overload starts, or no explosion occurs.

16. **Repair and refuel have large, immediate outcomes.**
    How to run: damage the spider core or a structure to roughly half
    health, then perform a repair action; drain fuel partway, then refuel
    with a jerrycan or depot.
    Look for: a single repair/refuel action produces a clearly visible jump
    in the health/fuel bar, not a slow trickle requiring many repeated
    actions.
    Failure: repair/refuel requires holding the action for several seconds
    per small increment, producing a "maintenance chore" feel called out as
    a risk in §25 of `prompt_guide.md`.

## Phase D — Horde pressure and combat

17. **Trail state progression and Pursuit trigger.**
    How to run: with seed 12345, let the Trail value rise passively (no
    special suppression) and log it every 10 s (debug overlay or console).
    Look for: state transitions at the boundaries in §10 of
    `prompt_guide.md` (QUIET 0-24, PROBING 25-49, SWARM 50-74, HEAVY 75-99,
    PURSUIT at 100), with a visible HUD/lighting/music change at each
    boundary, and PURSUIT specifically triggering continuous rear spawns and
    a growing spawn budget.
    Failure: no state change is visible at a boundary, or Pursuit does not
    trigger at Trail 100.

18. **Pursuit does not cause instant or timer-based defeat.**
    How to run: enter Pursuit deliberately (push Trail to 100), then survive
    as long as possible without reaching a shelter.
    Look for: the situation becomes progressively harder (more spawns,
    faster enemies) but the player is never killed by a hidden countdown;
    defeat only occurs via the core-health-zero or no-rescue-charges
    condition in §13.
    Failure: a fixed timer forces defeat regardless of player state once
    Pursuit begins.

19. **Player damage share 30-40%, structure damage share 60-70%.**
    How to run: play a representative successful encounter (a full march
    segment through at least SWARM state) with turret(s) actively
    installed, using a damage-attribution debug counter (sum of damage dealt
    by the player's personal weapon vs. sum of damage dealt by all
    structures, tracked via `GameEvent`s such as damage-dealt with a source
    tag). Do this for at least 3 independent seeds/runs.
    Look for: personal weapon damage totals approximately 30-40% of all
    enemy damage dealt in the encounter; structure (turret/mine/etc.)
    damage totals approximately 60-70%.
    Failure: personal damage share exceeds roughly 45% (player build
    dominates and structures become optional) or falls under roughly 25%
    (structures are mandatory to the point that personal combat feels
    irrelevant). Record the actual measured percentages, not just pass/fail.

20. **Automatic weapon protects without replacing structures.**
    How to run: attempt to clear a SWARM-state encounter using only the
    personal weapon, placing zero structures.
    Look for: the player can survive briefly but takes meaningfully more
    damage / falls behind more than with structures deployed; the personal
    weapon should not trivially clear the encounter alone.
    Failure: the encounter is fully clearable with the personal weapon alone
    at the same difficulty as with structures deployed.

21. **100-enemy stability.**
    How to run: force-spawn or naturally reach 100 concurrently active
    enemies (debug spawn command or extended SWARM/HEAVY play), observe for
    at least 60 continuous seconds.
    Look for: no crash, no unbounded memory growth (check via devtools
    memory/heap over the window), enemies path and attack correctly, frame
    time stays close to the 16.7 ms target (see PERFORMANCE.md for formal
    measurement).
    Failure: crash, enemies frozen/stuck, or frame time degrading
    progressively over the 60 s window (indicates a leak, not just load).

22. **200-enemy stress test survives.**
    How to run: force-spawn 200 concurrently active enemies via debug
    command, observe for at least 30 continuous seconds.
    Look for: no crash and no runaway memory growth; frame rate may degrade
    below 60 FPS but should remain playable/responsive.
    Failure: crash, tab freeze, or browser out-of-memory.

## Phase E — Complete vertical slice

23. **Full 8-10 minute slice, start to finish.**
    How to run: play from the loadout screen through one safe stop, one
    route fork, the main stretch, and the final arrival/gate, to either
    victory or defeat, using seed 12345 and a stopwatch.
    Look for: total elapsed time in the 8-10 minute band; every phase
    transition (loadout -> checkpoint prep -> march -> route choice ->
    checkpoint prep -> final escape -> result) occurs without a stuck state.
    Failure: a phase transition never fires, or total time is wildly outside
    8-10 minutes (under ~5 or over ~15) without an explicit balance note
    explaining why.

24. **Route choice communicates reward and risk before selection.**
    How to run: reach the route-choice screen at a checkpoint and read the
    two options without selecting either.
    Look for: each route shows a legible reward (e.g. "abundant fuel") and a
    legible danger/modifier (e.g. "narrow corridor") per the table in §11 of
    `prompt_guide.md`, before commitment.
    Failure: routes are unlabeled, identical-looking, or the danger/reward
    is only discoverable after committing.

25. **Victory transition.**
    How to run: complete a full run to the final gate with the spider's
    core above zero.
    Look for: a complete victory screen with reward/unlock/statistics
    summary; the player is auto-collected if nearby per §13.
    Failure: the game hangs at the gate, or victory silently returns to the
    title/menu with no summary.

26. **Defeat transition and quick restart.**
    How to run: deliberately let the spider's core reach zero (e.g. abandon
    all defenses in HEAVY/PURSUIT state).
    Look for: a defeat screen communicating the cause (core destroyed), and
    a restart path reachable without a mouse in two or fewer confirmations.
    Failure: no indication of why the run ended, or restart requires more
    than a couple of clear button presses.

27. **No unexpected console errors/warnings across a full run.**
    How to run: keep devtools console open for the entirety of check 23.
    Look for: zero uncaught errors or warnings across loadout, march,
    combat, checkpoint, and result screens.
    Failure: any uncaught error/warning appears at any point in the run.
