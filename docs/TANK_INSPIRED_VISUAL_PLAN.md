# Tank-inspired scenery and combat presentation

## Comparison and suggestions

Inspected the local Tank_game_3D sources: `src/three/effects.ts`, `frontier-environment.ts`, `frontier-surfaces.ts`, `environment.ts`, and `route-scenery.ts`. The tank game combines flash, sparks, expanding dust and lingering smoke; its scenery uses distinct surface patterns and reserves travel corridors before placing props. Adopt those principles, not its whole renderer or its per-particle material allocation. The tank repository stays unchanged.

Iron March already has efficient instanced Blender effects and eight Marching terrain palettes. Story mode instead renders explosions as simple rings and uses nearly uniform terrain and the same cottage/tree dressing. Reuse the existing Iron March art and effect pools before adding new assets.

## Implementation phases

- [x] 1. Shared deterministic surface detail: low-contrast soil grain, sand ripples, quarry strata, concrete seams and crystal facets. Apply to Marching terrain and Story ground without changing terrain height or collision.
- [x] 2. Four coherent Story scenarios: green hill pasture with sparse flower clusters; cool mossy stone maze with wall caps; ash/stone quarry with foundry architecture and distant rock terraces; warm homeward valley with a boundary river and village backdrop. Maintain clear paths and objective colors.
- [x] 3. Connect Story muzzle, impact, death and explosion events to the existing pooled Blender VFX. Differentiate a small enemy death from an explosive weapon hit. Improve shared gunfire/explosions with restrained smoke and ballistic debris.
- [x] 4. Review logic and lifecycle: exact-once event emission, terrain-relative effects, pause, retry/chapter reset, bounded counts, no new damage from effects and no material/texture leaks.
- [x] 5. Tests, complete build, real-browser screenshots and gameplay smoke checks; inspect representative Story scenes and Marching firefights. Transfer only verified changes to the canonical repository. No commit or deployment unless requested.

## Logic review before implementation

1. Decoration must not alter navigation. New large silhouettes and water belong outside playable bounds; small flower/ground marks are explicitly non-blocking. Do not add fake lava, fire hazards or destructible structures without matching mechanics.
2. Surface textures modulate existing colors gently; they cannot recolor pickups or camouflage enemies. The Marching path remains brighter than its surrounding ground; protect its existing fog/danger feedback.
3. Gold/cyan objective markers and the Queen's warning stay readable. Cosmetic effects are separate from those persistent gameplay markers, so saturating VFX cannot remove warnings or web hazards.
4. Story presentation observes events once, using object identity, without mutating the simulation. Muzzle records include the weapon fired, so switching weapons cannot recolor an already-fired shot.
5. Story hill effects must sample the same ground height as feet. A fixed zero-height explosion would disappear inside the hill. Particles need terrain-relative ground contact too.
6. Pause freezes effect lifetime. Retry and chapter transitions clear effects and event identity; reused numeric enemy IDs must not inherit particles.
7. Reuse shared geometry and pooled instances. No dynamic lights per shot, full-screen flash, infinite debris or new network asset dependency. Generate small shared textures once and dispose on view destruction.
8. Preserve combat ranges, weapon damage, existing modes, saves, default Marching selection and original/mini Spider structures. Benchmarks must distinguish simulation/effect CPU from physical-device frame rate.

## Acceptance evidence

Implemented 2026-09-19. `npm run verify`: asset validation, TypeScript, 461 tests in 40 files, production build passed. Six new tests cover deterministic texture bounds, world UVs, texture ownership, exact-once weapon events, state replacement/hazard isolation, terrain-relative effects and pause/pool reuse. Existing campaign, damage, movement, asset and Spider tests remain green.

Real Edge checks: 12 chapter screenshots across 1280×720, 390×844 and 844×390; keyboard/touch input, stone deployment, pause, checkpoint reload and campaign objective traversal passed without browser errors. The campaign traversal uses scripted combat resolution, not a human difficulty evaluation. Four additional hill combat fixtures exercise rifle/rocket/laser/flame cosmetic events; these are explicitly injected visual fixtures, not evidence of weapon unlock progression. Marching captures cover normal travel, a horde and the Blender effects showcase. See `tank-inspired-review/report.json` and adjacent PNGs.

Visual review corrected a quarry/background color seam and matched texture scale at ground edges. Static Story overview costs are 30–62 draw calls and about 53k–129k triangles. Combat VFX retain the shared 180-effect / 900-particle hard limits; no per-shot lights, material allocations or new downloads. Simulation CPU p95 was approximately 0.1 ms in headless Edge/SwiftShader; this is NOT a phone GPU frame-rate claim. Physical-device playtesting remains advisable.

Scope: four existing chapters are redressed, not four new missions. Existing mechanical mini-Spider shapes and locomotion are unchanged. Water is decorative and outside player bounds; no swimming or fire damage is implied. Tank_game_3D was read only. Changes are local and not committed or deployed by this task.
