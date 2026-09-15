# Homeward delivery and verification

## What is delivered

A selectable, complete four-chapter story: Bellflower Hill defense, Tanglewood Maze rescue, Silk Queen encounter and the Homeward escort/ending. The original Expedition and Salvage Rush remain separate. Enter with the loading-screen link, Expedition pause menu or `?mode=story`.

The design and implementation ledger are adjacent to this document. This work does not include a commit, push or live deployment.

## Evidence

- `npm run verify`: **450 tests in 38 files passed**, strict TypeScript, asset validation and production build passed. Baseline had 414 tests; 36 additional checks cover the story and raised Spider foot contacts.
- Four deterministic combat-playthrough tests complete the four chapters with ordinary weapons, movement, dodging, crafting and repairs. These do not directly kill enemies or grant invulnerability.
- Separate browser traversal tests resolve combat programmatically to exercise every objective gate and the complete escort distance. This is intentionally not presented as a human difficulty/playability test.
- `node scripts/story-check.mjs`: headless Edge passed keyboard movement, native touch joystick movement/release, single-action stone deployment, pause freeze, crate selection, all chapter transitions, chapter-4 reload with earned multishot, and the original loading-screen Story link. No captured runtime/console errors.
- Captures: all four chapters at 1280×720, 390×844 and 844×390; normal gameplay at all three sizes; ending. Layout checks enforce viewport bounds for the primary action, no horizontal overflow and loaded Blender assets. Representative images inspected visually.
- Existing capture harness: Expedition `roam-far` and `pickups` both rendered at 1280×720 after the new entry point was installed.
- `npm audit --omit=dev`: zero production vulnerabilities. No dependency versions changed; development-only audit findings were not automatically upgraded.
- `git diff --check`: passed.

Raw browser results: [report.json](homeward-review/report.json). Screens: [normal desktop](homeward-review/desktop-gameplay.png), [portrait](homeward-review/portrait-gameplay.png), [landscape](homeward-review/landscape-gameplay.png), [ending](homeward-review/desktop-ending.png).

## Logic and code review fixes

1. Consistent nine-cow accounting: six initially protected, three already abducted; captures remain recoverable and the ending never invents cows.
2. Maze flow-field steering follows reachable cells, with wall-blocked fire and guaranteed pen/crate/exit access.
3. Jumpers skip exactly one complete spiral turn and move directly between its endpoints, not rapidly around the intervening road. One jump per enemy.
4. Death removes an enemy immediately; duplicate hits cannot award twice. Rocket splash, laser piercing and individual rolling-stone hits have regression tests.
5. Fixed-step simulation and time-based flame burn; bounded enemy/projectile/effect/pickup/stone/turret populations.
6. Queen death stops reinforcements; reaching home does not require chasing distant stragglers. Empty fuel still permits emergency movement.
7. Explicit armor milestones enlarge future stones and add bounded health. Failed-attempt upgrades reset to the chapter-start checkpoint.
8. Optional terrain sampling in the existing Spider foot solver preserves flat-ground behavior and plants all eight feet correctly on the raised farm plateau.
9. Terrain resources dispose on chapter changes; instance batches reuse geometry, with capped pixel ratio and no story shadow-map pass. Existing Blender flame, gun, scenery, engineer and machine assets are reused.
10. Clear action availability, named pickups, weapon roles/heat, modal focus, pause/visibility handling and touch release. No Q-before-E requirement or distance tether.
11. QA preview links ignore player checkpoints. Browser harnesses use isolated temporary profiles and close their own browser sessions.
12. Visible machine cargo includes every rescued cow, rather than silently limiting it to six.

## Performance measurements and limits

In the final headless Edge/SwiftShader sample, 600 simulation steps starting with 48 enemies had p95 about **0.10 ms**, maximum about **0.30 ms**. Median rounded to zero at the browser timer resolution. This measures simulation CPU only, not total rendered frame time or mobile FPS. Overview scenes used 24–57 draw calls and roughly 51,700–75,500 triangles.

Physical Android/iOS devices and a physical gamepad were not available for testing. Touch events and three viewport sizes were tested in the browser; controller support uses the existing tested InputManager. Real-device thermal behavior, GPU performance and subjective difficulty still need player feedback. No claim of guaranteed 60 FPS on every phone.

New creatures and cows use lightweight stylized geometry, not newly exported high-detail Blender character rigs. Combat retains the game's arcade ground-plane targeting convention. The story is a complete playable campaign, not a cinematic or physically simulated farming game.

## Repository handoff

Implementation was prepared in the isolated `story-campaign-review` clone from canonical commit `a75f0c42b2c6747bb27a238133a18e4510232f07`. The canonical checkout was verified at that commit and clean before transfer. All 43 changed/new source, test and documentation files were copied and hash-verified; `.git`, dependencies and build output were not copied. The canonical repository then independently passed `npm run verify`: 450 tests, asset validation, type checking and production build. The final completion documents were synchronized afterward. Changes remain uncommitted and have not been deployed.
