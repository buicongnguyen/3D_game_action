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

---

## Round 2 - reviewing the Codex campaign expansion

Five lenses over roughly 7,200 new lines: the campaign and its biomes, the
encounter/field-item/crawler systems, the shops, structure retirement, and the
tests for all of it. **40 findings.**

**Verification completed: 51 agents, zero errors.** The 23 P1/P2 findings each
faced two independent skeptics, surviving only on a unanimous verdict:
**11 confirmed, 12 refuted.** That refutation rate is the point - it is what
makes the surviving eleven worth acting on. The 17 P3s were recorded as reported
without adjudication.

Eight of the eleven confirmed findings are now fixed, each pinned by a test that
was checked against the old code first. The list below is the raw reported set;
see IMPLEMENTATION_STATUS.md 2b.18-2b.24 for what was done and what was left.

Worth stating plainly: the expansion is good work. Every fix from the previous
review survived it, four of that review's open findings were closed, and the
balance hole that let a player win by standing still is gone - an idle run now
dies in 30 seconds. Most of what follows is the ordinary cost of adding a
campaign to a vertical slice: things the new content outgrew.


### P1 - 6

- `game/src/game/systems/SpiderMovementSystem.ts:39` - The new `departureHoldSeconds` gate keys off `world.phaseTime`, which `GameWorld.setPhase` zeroes on every phase change — so any level-up during the final escape re-freezes the Spider for another full 18 seconds, anywhere on the route.
- `game/tests/integration.test.ts:42` - The integration harness's comment "The full system stack, wired in the §16.4 order" is no longer true — it omits EncounterSystem, FieldItemSystem and MobileStructureSystem — and since no test constructs Game, all three of Codex's new player
- `RunStateSystem.ts:136` **[FIXED]** - The one-way "final escape" loadout lock is still hard-coded to `checkpoint.gate`, which since the biome expansion is no longer the checkpoint before the escape — so the player is permanently stripped down to two blueprints one whole stage e
- `TerrainBuilder.ts:671` - `buildMazePattern` sizes the watchtower InstancedMesh for only the `station % 8 === 0` towers, but corner stations also emit towers, so on the one maze stage in the game it writes 22 instance matrices past the end of the buffer and then tel
- `structureRetirement.ts:19` - The state guard excludes only `destroyed` and `overloading`, so `dropped` field salvage retires too — which silently deletes the collectibles Salvage Rush is entirely built around.
- `structureRetirement.ts:25` - Retirement measures how far a turret is behind the Spider in arc length along the spline, while the recovery window it claims to respect (the player tether) is a straight-line radius, so on any segment that doubles back a turret is deleted 

### P2 - 17

- `game/src/game/systems/CollisionSystem.ts:229` - Destroying a workshop nest deactivates the simulation site but leaves the building drawn and still blocking navigation, and nothing anywhere renders a nest's health — so the route objective "Destroy all three workshop nests" completes with 
- `game/src/game/systems/DamageSystem.ts:359` - `crawler_turret.test.ts` encodes Codex's new unconditional `if (structure.kind === "rivetTurret") return;` as the intended contract, and no test anywhere asserts that any structure takes damage from an enemy — so the whole structure-damage 
- `game/src/game/systems/FieldItemSystem.ts:19` - R1 resolves field items by a fixed priority with no player choice, so shock mines and armor plates are unreachable for as long as the player holds any repair kit and is not at full health (or stands near any damaged machine) — while the HUD
- `game/tests/checkpoint_state.test.ts:53` - The checkpoint-restore test names eight fields and leaves the rest of the snapshot unchecked — including every piece of durable state the new work added.
- `game/tests/encounters.test.ts:55` - The test named "resets authored encounter state on a new route segment" pins one of the four lines in the reset block; the other three — the started set, the completed set, and the encounter-site list — can each be deleted with the suite gr
- `game/tests/encounters.test.ts:80` - The test titled "bounds nest reinforcements and stops them permanently after destruction" disables the site immediately after the first wave, so it never reaches the bound it names — reinforcement waves 2 and 3 are entirely untested.
- `game/tests/field_items.test.ts:10` - Every R1 field-item test builds a snapshot with both `pressed` and `held` set and calls `update` exactly once, so the suite cannot tell an edge-triggered R1 from a held-triggered one — the exact latched-edge contract the project's own P1 in
- `game/tests/field_items.test.ts:141` - Three tests set up a damaged rivet turret by assignment, but rivet-turret invulnerability makes that state unreachable in the shipped game — so the repair verb they certify is dead for the game's primary structure and the suite is green abo
- `game/tests/hazards.test.ts:23` - The Flooded Works hazard is tested only as a pure function; nothing asserts that standing in water actually slows anything, and the alternate branch segment that shares the mechanic is never entered by any test.
- `game/tests/turret_shop.test.ts:22` - Three of the four turret upgrade tracks have no behavioural test, two have no test of their effect at all, and the test that claims to cover "independent power, volley, range and autoloader tracks" only echoes the literal order of the TURRE
- `game/tests/weapon_shop.test.ts:51` - The weapon shop's five upgrade marks — the game's main scrap sink — are pinned only by asserting that a pure formula is monotone; nothing checks that a Mk5 weapon actually hits harder or faster than a Mk1.
- `FieldItemSystem.ts:71` - `nearestDamagedStructure` accepts any non-destroyed structure below full health within 4.5 m, so it both shadows the only engineer-healing path in the game and happily spends a finite kit on a machine that is already detonating.
- `SpiderMovementSystem.ts:38` **[FIXED]** - `departureHoldSeconds` is gated on `world.phaseTime`, which is "time since the last phase change", not "time since entering the segment" — so any mid-segment phase transition re-arms the 18-second hold and freezes the Spider dead in the mid
- `TerrainBuilder.ts:507` - The biome pass multiplied ground relief by a per-palette `reliefScale` of up to 3.3 but left every scattered prop pinned at y = 0, so most of the dressing on the high-relief biomes is rendered underneath the ground it is standing on — and e
- `TerrainBuilder.ts:513` - The crystal and mountain biomes apply a non-uniform `widthScale` to rock instances but leave the navigation radius at the unscaled `type.blocks * scale`, so a crystal spire blocks a circle roughly three times wider than the shape the player
- `WorldView.ts:1042` - The Crawler Tank is the only entity in the game that moves during simulation and is drawn straight from its raw fixed-step position, because `Structure` has no previous pose and `syncStructures` is never handed the interpolation alpha.
- `routes.ts:345` - seg.scrapyard's control points were rewritten and its length raised from 330 m to 360 m, but both spawn zones still stop at `toDistance: 330`, so the horde director cannot spawn anything for the last 30 m — and no authored loot exists there

### P3 - 17

- `game/src/game/systems/CollisionSystem.ts:206` - Explosions damage encounter sites that have not been triggered yet (unlike the direct-hit path, which requires `site.triggered`), and destroying a site does not stop `EncounterSystem` from releasing its authored squad — so a nest can be "de
- `game/src/game/systems/CollisionSystem.ts:227` - `damageEncounterSite` adds every point of nest damage to `world.stats.damageByPlayer` regardless of the projectile's source, so turret fire is credited to the engineer and the §7.3 damage-share instrument stops being a measurement.
- `game/src/game/systems/FieldItemSystem.ts:54` - The field-item shock mine is spawned through the default `spawnStructure` options, so it emits `structure.placed` with `source: "build"` and increments `stats.structuresPlaced` — re-opening the free-XP hole that build provenance was added t
- `game/src/game/systems/HordeDirector.ts:113` - Killed enemies now linger as `active` pool slots for `ENEMY_LIFECYCLE.deathDuration` (0.9 s), and the director still compares `world.enemies.active` against `DIRECTOR.maxActiveEnemies`, so corpses silently consume the live-horde budget.
- `game/src/rendering/WorldView.ts:682` - `syncStructures` is the only sync pass that does not take the render `alpha`, because structures were static when it was written — the new `crawlerTurret` moves at up to 5.2 m/s and therefore renders un-interpolated, stepping once per fixed
- `game/tests/crawler_turret.test.ts:51` - The crawler formation test's tolerance admits every failure it is meant to catch, and the two-crawler slot logic — the only configuration the game allows — is never exercised.
- `game/tests/field_items.test.ts:112` - The weapon-part item's only payoff is never triggered: the test collects exactly two parts and asserts the HUD reads "(2/3)", one short of the threshold.
- `game/tests/object_pool.test.ts:1` - The new ObjectPool test file (24 lines, one test) covers `releaseAll` and leaves both guarantees the architecture actually rests on unasserted: that `acquire()` returns null at capacity, and that the free list stays consistent — `release()`
- `game/tests/terrain_spacing.test.ts:26` - `propsHaveClearance` is unit-tested at its exact boundary but its only call site is not, so nothing asserts the property the test is named for — that a generated segment contains no connected wall of solid props.
- `EncounterSystem.ts:89` - A workshop nest destroyed during its own telegraph still releases its full squad, and splash damage can destroy a nest that direct fire is forbidden from touching — the two damage paths disagree on whether `triggered` is required.
- `FieldItemSystem.ts:28` - `modifiers.playerMaxHealth` is applied twice — `player.maxHealth` already carries it — so the repair kit's ceiling and the HUD's health bar are both wrong the moment any content sets that modifier.
- `InteractionSystem.ts:116` - `RouteSpline.projectPoint` is an O(samples) linear scan over ~1025 samples, and the retirement pass makes the simulation run it twice per structure per tick on data it already has, plus a third time per structure per rendered frame.
- `MobileStructureSystem.ts:39` - `structure.behindSpider = false` is a dead write: the flag is owned by `InteractionSystem.updateLeftBehindFlags`, which runs later in the same fixed step and unconditionally recomputes it.
- `WorldView.ts:961` - The render path recomputes a spline projection per structure per frame that the fixed step already computed for the same structure in the same tick.
- `materials.ts:83` - `MaterialLibrary.emissiveUnique` appends to an `owned` array that is only emptied by a full `dispose()`, so every placement ghost rebuild and every structure visual permanently retains one or two materials for the rest of the session.
- `perf.json:1` - The committed performance record was never regenerated for the expansion: `docs/perf.json` at HEAD still holds the four pre-expansion scenarios, which the committed harness no longer even defines, so every budget claim in PERFORMANCE.md is 
- `routes.ts:278` - Ironspine Pass's objective label says "Keep a defense powered for 35 seconds" (singular) but the pressure objective is hard-coded to require two simultaneously powered machines, so a player who does exactly what the label says watches the b
