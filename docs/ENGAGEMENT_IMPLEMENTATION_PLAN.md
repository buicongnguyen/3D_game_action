# Engagement implementation checklist

Baseline: deployed commit 14135e7, 358 passing tests. Implement in an isolated
working copy; copy only reviewed changes back to the clean canonical repository.

## Phase 1 — readable HUD and purchasing
- [x] Device-aware weapon/build/menu hints; larger combat rack, hide locked slots.
- [x] Placement text names the item and preserves validation reasons.
- [x] Aggregated pickup receipt near resources.
- [x] Pure shop previews from actual formulas; disable unaffordable purchases.
- [x] Regression tests and TypeScript check.

## Phase 2 — narrative and durable run identity
- [x] Opening premise and recurring Mara/Nera/Ilya arrival dialogue.
- [x] Correct late-campaign route continuity.
- [x] One specialization choice at first checkpoint with explicit tradeoffs.
- [x] Persist campaign state in checkpoints with old-save fallback.
- [x] Test single-use selection and retry behavior.

## Phase 3 — optional operations and consequences
- [x] Data-driven missions for all non-final expedition segments.
- [x] Accept/decline radio screen and bounded stop/progress/timeout state machine.
- [x] Site marker, active objective and contextual progress display.
- [x] Service, nearby kills and local salvage operation types.
- [x] Success rewards, quieter recovery budget, remembered rescue and final aid.
- [x] Test success/failure/decline, proximity, exact-once rewards and mode isolation.

## Phase 4 — integration review and release
- [x] Review modal ordering, paused input, phase transitions and stage resets.
- [x] Review interaction with checkpoint retry, resource caps, pools and combat.
- [x] Full verification and deterministic mission/campaign simulations.
- [x] Desktop and portrait captures: normal play, radio, specialization, workshop.
- [x] Fix findings, record results and remaining limitations below.
- [x] Copy reviewed files, verify canonical repo, commit and push via SSH.
- [x] Verify GitHub Pages action and live asset bundle.

## Implementation record

Implemented 2026-09-10. All four phases completed, including review and deployment.

- Added nine optional operations (the two flooded routes are alternatives), three
  mutually exclusive roles, recurring dialogue, an opening briefing, rescue
  consequences and capped one-time final aid. Existing Salvage Rush is isolated.
- UI now has a bounded scrolling weapon rack, chapter counter, resource receipt,
  named placement action and tap/click Place button, price shortfalls and actual
  before/after stats. Mobile modals scroll and directional focus follows layout.
- Review fixes: cleared stale secondary placement prompts; normalized discrete
  pickup receipts; avoided gamepad hints when no controller is active; prevented
  specialization loss from the finale kit; kept Salvage Rush's ending separate.
- Verification: 383 tests in the final full run (including full progression
  through both campaign forks); asset validation, TypeScript and build checks.
- Browser harness verifies rescue acceptance and completion through the actual
  game loop, one role choice, refusal of unaffordable purchases, one valid
  purchase and a reachable scrolling workshop exit at 1280×720 and 390×844.
- Screenshots: engagement-review/desktop and engagement-review/mobile. Includes
  six-unlocked-weapon portrait layout. All captures inspected for representative
  mission, role, workshop and HUD states.
- Performance report: engagement-review/performance.json. Eight scenarios,
  124–158 draw calls; peak 209 enemies; no measured pool saturation. SwiftShader
  timing is not a hardware FPS benchmark.

### Deliberate limits and follow-up

Operations reuse an abstract beacon and existing enemies/scenery, not bespoke
animated rescue/pump/cable models. Only one specialization is chosen, not a new
skill tree. The rock/Spider art from the previous release is preserved. Touch
selection, Place and menu scrolling work; this release does not introduce a
complete touch movement/aiming control scheme. Human enjoyment/balance and real
mobile GPU performance still need playtesting.

npm audit reported two pre-existing moderate entries in the Vitest development
toolchain (Vitest and @vitest/mocker, GHSA-82fw-gwwq-j7x9); dependencies were not
changed in this feature release. These are not production game dependencies.

### Verified release

Feature commit: `fe64ff0` — pushed to main through the existing SSH remote.
[GitHub Pages build and deployment](https://github.com/buicongnguyen/3D_game_action/actions/runs/34471750497)
completed successfully. The live game returned HTTP 200 and served the verified
`assets/index-EuInflBw.js` bundle. The canonical repository also passed all 383
tests, asset validation, TypeScript and the production build before the commit.
This completion record is a subsequent documentation-only commit.
