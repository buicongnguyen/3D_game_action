# Category-by-category review and fixes

Date: 2026-09-05. Baseline: main `92f1348`, plus the three pending combat/rendering corrections from the preceding review. This executes the requested eleven-category checklist; it is a targeted correctness and presentation pass, not a new art direction or a claim that every possible run is bug-free.

## Checklist and evidence

| Order | Category | Checks and result |
| --- | --- | --- |
| 1 | Player appearance and animation | Reviewed WorldView/AnimationSystem. Fixed the downed engineer remaining upright and blinking: now collapses, stays visible, and resets the death pose on revival. Real renderer-method regression test covers both states. Sampled recorded march frames at 0, 30 and 59. |
| 2 | Player movement | Reviewed walking, dodge, forced tether movement and rescue. Fixed tether pull bypassing terrain collision; axis-separated pull now respects the player footprint. Fixed revive health ignoring maximum-health upgrades. Wall and 1x/1.5x/2x revive tests pass. |
| 3 | Spider movement and animation | Reviewed movement/route and procedural gait. Fixed stepping/bobbing while stopped during departure hold. Existing route continuity, tight corners, docking and gear-change tests pass. Recorded march and overdrive-to-fallback sequences. |
| 4 | Enemies | Reviewed death/release and authored house/nest spawning, plus navigation tests. Existing dead-enemy inertness, wall routing, house exit clearance, finite squads, boss announcements and nest cancellation checks pass. No additional enemy-system correction identified in this pass. |
| 5 | Background and navigation | Inspected march, houses and horde screenshots. Re-ran spacing, house exit and eight-terrain-style coverage tests. Fixed crawler movement through scenery using convoy flow and full-footprint collision checks. Building-detour regression verifies all 900 steps stay passable and the crawler reaches the far side. |
| 6 | Weapons and projectiles | Included pending fixes: weapon swaps no longer clear shared cooldown/overheat; swept projectiles resolve the nearest enemy/nest surface rather than preferring enemies or array order. Existing launcher splash, death and shop tests pass. |
| 7 | Turrets and crawlers | Included pending fix for retirement track scaling accumulating per rendered frame; tested at 30 and 120 FPS and on return to range. Reviewed crawler health, service interruption, formation and firing. Fixed terrain traversal as above; stationary turret invulnerability is preserved. |
| 8 | Pickups and resources | Reviewed magnet/consumption and repair interactions. Re-ran quantity tests for blue/special drops, finite field items, remote claims, auto-repair cost/range/unlock and no repeatable passive-repair XP. No new confirmed defect in this sample. |
| 9 | Stages, progression and checkpoints | Reviewed run-state ordering, checkpoint restoration and progression tests. Fixed terminal run-state changes allowing combat later in the same tick to overwrite victory. Regression calls the actual Game fixed-update entry, verifies terminal phase, presentation handling and input-edge cleanup. |
| 10 | HUD and mobile presentation | Captured desktop 1280x720, portrait 390x844 and landscape 844x390. Fixed portrait camera cropping the Spider: retain gameplay width, with matching projection, culling and HUD coordinates. Fixed overlapping placement/build hints and portrait toasts. Camera tests cover three aspect ratios; final portrait and landscape captures were inspected. |
| 11 | Performance and stability | Full validation, typecheck, tests and production build pass. Browser performance suite covers eight campaign/stress scenarios, with 127-159 draw calls, up to 209 enemies and no pool exhaustion/saturation. Crawler obstacle look-ahead is capped at 24 metres to bound per-tick work. |

## Confirmed corrections delivered

1. Shared firing cooldown/overheat survives weapon switching.
2. Projectile collision selects the nearest swept enemy/nest surface.
3. Retirement track scaling resets every frame.
4. Revive health uses upgraded maximum health.
5. Stationary Spider stops its locomotion gait.
6. Tether pull respects blocked terrain.
7. Downed player has a held collapse pose and recovers correctly.
8. Crawlers avoid traversing solid scenery.
9. Victory/defeat ends simulation work for that tick.
10. Portrait camera preserves convoy visibility and consistent projected coordinates.
11. Contextual placement messages no longer overlap the generic build hint; portrait toasts have a separate vertical slot.

## Verification

- `npm run verify`: asset validation, TypeScript, **342 tests across 25 files**, and production bundle.
- New/extended tests: `combat.test.ts`, `structure_ring.test.ts`, `animation.test.ts`, `crawler_turret.test.ts`, `review_safety.test.ts`.
- Final portrait evidence: [march](category-review/final-portrait/march-390x844.png), [placement](category-review/final-portrait/placement-390x844.png).
- Final compact landscape evidence: [horde](category-review/landscape/horde-844x390.png), [placement](category-review/landscape/placement-844x390.png).
- Browser performance evidence: [JSON report](category-review/performance.json). This is SwiftShader, not a physical GPU benchmark; do not convert these timings into a real-device FPS promise. The sample is short (12 samples per scenario).
- Local motion evidence: `graphics-review/docs/category-review/motion/`; two 60-frame takes at fixed 1/60-second steps, all frames distinct. March ticks 80-139 at Spider speed 1.25; gearshift ticks 12-71 spans overdrive/fallback (2.0 to 0.45). Large motion PNG sequences are retained locally rather than added to Git.

## Limits and follow-up testing

- Viewport emulation checks layout, not actual Android/iOS touch controls, safe areas, thermal throttling or browser-specific multitouch behavior. The capture scenes show controller glyphs until an input device is used. Physical-device playtesting remains necessary.
- This pass does not certify every scenery seed or sealed topology. A fully enclosed crawler must remain blocked rather than phase through geometry; building-detour and shared navigation tests cover reachable examples.
- Portrait retains more world area at the cost of smaller characters. Assess readability and target selection on a real phone before further zoom tuning.
- The visuals retain the existing procedural style. Trees/houses were inspected for spacing and readability; no new art assets were commissioned.
- Short deterministic motion takes and long phase-continuity unit tests are not a substitute for a full campaign animation/play-feel session.

## Publication

Publish this reviewed set together with the preceding pending fixes using the canonical repository's existing SSH remote and GitHub Pages workflow. Confirm build/deploy success and that the live HTML serves the new hashed bundle before reporting deployment complete.
