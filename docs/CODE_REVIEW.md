# Code review — Marcha de Ferro

A six-lens adversarial review of the vertical slice: simulation correctness,
navigation/horde/combat, rendering/animation, UI/input/controller UX, test
quality, and a live gameplay evaluation that drove ~50 seeded runs headless
through the DevTools protocol.

**63 findings. This document records all of them and what happened to each**,
because a finding that is neither fixed nor written down has been lost, and the
value of a review is mostly in the part nobody wants to act on yet.

## A caveat about the verification pass, stated up front

The review was designed so every finding faced three independent skeptics, each
told to refute it and to default to refuted when uncertain. That pass did not
finish: **48 of 189 verifier agents completed before the session hit its usage
limit; 141 errored.** Of the 42 verdicts that did return, 39 upheld the finding
and 3 refuted it.

So the adjudication is partial, and the shape of the gap matters:

- The findings acted on below were **verified by hand against the source**, and
  the three P1s were additionally reproduced — two of them in the running game.
- Findings with no returned verdict are recorded as **unverified**, not as
  rejected. My survival rule treated "no votes" as "did not survive", which
  would have silently discarded them on an infrastructure failure rather than on
  evidence. That is the same class of mistake this project has hit five times in
  its own tooling, and it is called out here rather than left to be inferred.

---

## Fixed

| Severity | Where | Defect | Verification |
|---|---|---|---|
| **P1** | `InputManager.ts` / `Game.ts` | Input edges were computed per rendered frame and consumed per fixed step. At 144 Hz **58.4% of frames run no fixed step**, so the majority of confirms, dodges, pause presses and overdrive toggles were erased by the next poll before any system read them. At 30 fps every frame runs 2+ steps, so the same edge fired twice: pause opened and closed inside one frame, overdrive toggled straight back off, and a menu confirm leaked into gameplay. | Refresh-rate table computed from the real accumulator; fixed live — on a two-step frame pause now opens and stays open, and overdrive toggles once. Six input tests rewritten to the real contract. |
| **P1** | `main.ts` / `Game.ts` | `visibilitychange` called `game.start()`, which unconditionally calls `beginRun()` — alt-tabbing away and back restarted the route, teleported the spider and engineer to the start, respawned pickups, and hid any open screen while leaving `modalOpen` set. | Added `Game.resume()`; read the code path end to end. |
| **P1** | `PressureNetworkSystem.ts` | A relay was `powered` whenever its buffer was non-zero, and anything powered recharged — so a relay topped itself up forever and never drained. Directly contradicts the design note four lines above it about not letting players build a permanent base. | Split "supplied" from "serving"; one-hop chaining now sources from a snapshot of the directly-fed set. |
| **P2** | `AnimationSystem.ts` | **The feet skated.** Cadence and hip amplitude were tuned independently, so foot arc never matched ground travel: 24% slip at a sprint, 106% at a walk, measured against the recorded march take. | Cadence is now `2π·speed / STRIDE_LENGTH` with the stride derived from the pose. Pinned by a test asserting ground-per-cycle equals foot-arc-per-cycle to 1% at four speeds. |
| **P2** | `PlayerMovementSystem.ts` / `HudController.ts` | `player.tethered` fired **every fixed step** past the leash — 60 toasts a second, each evicting the four-slot stack, a Last Shot warning included. Found in frame 0 of the recorded march take. | Event now fires on the edge; the toast layer refreshes a duplicate rather than stacking it. |
| **P3** | `hud.css` | "BARRICADE" truncated to "BARRIC…" in the blueprint chip at 1280 wide. | Chip sized to the longest name at the smallest type; confirmed in the re-shot 720 capture. |

---

## Reviewing the fixes themselves

The changes above were then reviewed as their own diff, on the principle that a
fix is a change like any other and this project's failures are quiet. Three
things came out of it, and the first was mine.

**A regression I introduced with the input fix.** Clearing the input edges at the
end of every fixed step is correct for the simulation, but it is not the only
consumer: `CameraController.update` reads `recenter.pressed`, and the camera
updates during *render*, which runs after the frame's steps. So the edge was
already spent by the time the camera looked at it and **R3 / C recentre did
nothing at all** — a fix for dropped inputs that dropped an input. Found by
grepping every reader of `snapshot()` rather than by assuming the one I had
changed was the only one. The camera now takes a resolved `recenter: boolean`
that the step latches and render consumes, which also removes the camera's
dependence on edge timing entirely. Verified live: the engineer moves from
screen (0.564, 0.420) to exactly (0.5, 0.5).

**A comment of mine that was wrong.** The foot-planting fix documented its
residual slip as "only under about 0.55 m/s". That was the cadence floor, but
the *amplitude* blend (`MOVING_SPEED`) also scales the hip, and a hip swinging
short of what `STRIDE_LENGTH` assumes puts the slip straight back. At the 0.9
value I had chosen, a character crowded to 0.7 m/s skated 23% and one at 0.5 m/s
skated 50%. The slowest enemy walks at 1.1 m/s, so the threshold is now 0.4:
slip is exactly zero from 0.6 m/s upward. The test only sampled speeds ≥ 1.0,
which is precisely why it passed — it now covers 0.6 and the real archetype
speeds, and was confirmed to fail against the old value.

**A latent bug my change made easier to hit.** The toast dedupe added a map from
node to pending timer. Toasts evicted for capacity were being pushed back into
the pool with their timers still armed, so the timer would later fire on a
detached node and push it into the pool a *second* time — one element handed out
for two live toasts. Now cancelled on eviction.

Two of those three were mistakes in this session's own work, caught by reading
the diff against the rest of the system rather than against its own intent.

---

## Open — recorded, not yet acted on

Grouped by how much they cost a player. None has been dismissed; none except
where noted has been independently verified.

### Reachability — a mechanic exists and cannot be reached

1. **The manual Last Shot prompt is unreachable while empty-handed.** With no
   carry, any foldable in range sets the fold target and the action resolver
   returns fold, so the game's signature verb has no reachable player-facing
   trigger in the common case. *Both* integration tests for it call
   `interaction.triggerLastShot()` directly, which is why the suite is green —
   the tests certify a mechanic whose only production trigger is shadowed.
2. **The spider module offer is never presented.** `arriveAtCheckpoint` fills
   `pendingModules`, but nothing ever opens the module screen in play.
3. **The settings screen route** was wired this session, but the disconnect
   overlay still promises "press any key to continue on the keyboard" and no
   keyboard path clears it.
4. **Keyboard blueprint keys 1–4** are captured and `preventDefault`-ed but
   never consumed by any system.

### Correctness

5. A structure in `overloading` can still be folded, repaired and recharged.
6. Pickups are never expired, culled, or cleared on segment change —
   `Pickup.lifetime` is set to 0 and never advanced.
7. Fold + reinstall is free and repeatable: ~8 XP per 1.5 s with no scrap cost.
8. Checkpoint code rewrites `world.trailState` directly without emitting
   `trail.stateChanged`, so the HUD misses the transition.

### Balance — from ~50 seeded headless runs

9. **A player who stands on the spider and builds nothing wins every seed**, core
   never damaged, on the strength of the always-on shotgun alone. That is the
   single most important gameplay finding in the review: the leapfrog loop the
   whole game is built around is not currently *required*.
10. On the authored route the Trail never reaches HEAVY organically; PURSUIT only
    occurs when forced on the final segment.
11. The tether destroys — not drops — a carried folded machine on the first step
    past 22 m, with no grace, while the fold hold roots the player.

### Rendering

12. After one dodge the engineer somersaults forever: `player.animState` is a
    sticky flag the simulation never resets.
13. Batched structures and enemies draw every mesh with the batch's single
    surface material, so emissive gauges, relay glow, mine lights and golem cores
    render unlit — and every gauge colour write goes to a material never drawn.
14. The held-service pose ramps out and back in every 0.6 s during any repair.
15. Puppets are never released when an enemy leaves LOD tier 0; the rebalance
    timer is computed and unused.
16. `TerrainBuilder.scatterProps` is the only place static navigation obstacles
    are created — the render layer writing simulation state, against the
    architecture's central rule.

### Tests

17. The 180-second "long, busy run" pooling test measures a world that is dead
    for 147 of its 180 seconds, has no structures, and asserts tautologies plus a
    counter the director can never increment.
18. `expect(world.enemies.exhaustions).toBe(0)` is asserted in six places as
    evidence of no exhaustion, but the director checks capacity *before* calling
    `acquire`, so that counter can never increment by any path.
19. No test drives the engineer with the stick or triggers a dodge through input.
    Overdrive — a core control — has zero tests. Victory, checkpoint arrival by
    marching, and the route offer have none either: the suite can only ever end a
    run in defeat.
20. `npm run verify` never boots the game; `Game.ts` and `main.ts` are not
    executed by any test.

---

## What this review says about the project

Three of the four highest-severity findings were **invisible to a 236-test green
suite**, and in two cases the tests actively encoded the bug as the intended
contract: the integration harness cleared input edges per step "as the real
InputManager guarantees" — which it did not, and that assumption is exactly what
hid the defect. `GameLoop.ts` carries a comment describing the guarantee the code
fails to provide.

The pattern is consistent with what the visual QA record already found: **this
codebase's failures are quiet.** They pass tests, render plausible frames, and
write confident comments about properties that do not hold. The countermeasure
that keeps working is the same one every time — measure the thing rather than
read what it claims, and prefer a test that asserts a physical invariant over one
that restates a formula.

---

## Follow-up implementation review

The gameplay-plan execution resolved open findings **1, 2, 3, 4, 5, 6, 7, 8,
9, 10, 11, 12 and 15**. In addition to the planned fixes, the follow-up diff
review found and corrected three adjacent defects:

- The interaction-range code added a structure's radius to the allowed reach,
  then initialized its nearest-distance sentinel to the smaller player-only
  range. The second comparison canceled the promised surface reach.
- Dropped salvage was excluded from new target scoring but not from resolution
  of an already-held target. Both paths now reject it.
- Reinstalling a recovered machine emitted the same placement event as a new
  purchase, so fixing the explicit recovery award alone would still leave a
  repeatable new-build XP source. Placement events now carry build provenance.

The remaining rendering-architecture and test-harness findings (13, 14, 16–20)
are not required by the gameplay plan and remain recorded for a later rendering
and infrastructure pass. The current publication gate validates assets,
TypeScript, deterministic tests, production bundling, browser boot, performance
scenarios, and the deployed GitHub Pages build.
