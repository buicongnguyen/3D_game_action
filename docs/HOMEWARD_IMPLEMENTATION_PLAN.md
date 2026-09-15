# Homeward implementation plan and completion ledger

Source of truth: [campaign design](HOMEWARD_STORY_DESIGN.md). Preserve Expedition and its saves. No commit, push or deployment is included unless subsequently requested.

## Phase 1 — Contracts and campaign foundation

- [x] Define finite chapter/enemy/weapon data, story text, herd ledger and bounded upgrades.
- [x] Implement deterministic chapter maps, hill height/spiral sampling, maze collision/pathfinding and route reachability tests.
- [x] Add isolated story state and versioned chapter checkpoints; corrupt/unavailable storage falls back safely.

## Phase 2 — Playable hill defense

- [x] Engineer movement/dodge, cow entanglement/rescue/capture and forty-enemy waves.
- [x] Ordinary spiders, one-jump Jumpers, Shellbacks and finite spawn/recovery pacing.
- [x] Named automatic shell collection, stone crafting/launching and deterministic downhill hits.
- [x] Tests for one-time awards/jumps/hits and meaningful win/fail conditions.

## Phase 3 — Maze rescue and upgrades

- [x] Reachable maze, entrance/exit, holding pen, enemy pathfinding and white Webbound Husks.
- [x] Explicit crate choices, capped multishot/power and guaranteed laser unlock.
- [x] Rescue ledger and transition gates; replay/closing a panel cannot duplicate rewards.

## Phase 4 — Queen, heavy weapons and rescue

- [x] Telegraph/slam/core/brood boss cycle, finite adds, Stitchers and web patches.
- [x] Rocket splash, wall-blocked piercing laser and flame cone/burn with bounded visuals.
- [x] Boss death stops attacks; secure remaining cows; tests for time-step-independent effects.

## Phase 5 — Homeward escort and ending

- [x] Animated existing Spider carries rescued herd along a finite return route.
- [x] Free scouting, warnings only, repair, fuel, turrets, supply pockets and recovery stop.
- [x] Final ambush, gate victory and correct nine-cow reunion accounting.
- [x] Chapter retry/reload preserves earned upgrades and chapter-start resources.

## Phase 6 — Presentation, access and controls

- [x] Shared Blender scenery and engineer/Spider models; instanced enemy/cow/effect visuals.
- [x] Illustrated story panels, chapter HUD, map, receipts, upgrade comparison and boss cues.
- [x] Story selection from the existing loading screen/pause; desktop, gamepad and touch controls.
- [x] Pause/visibility handling, responsive layout, accessible focus and clear return to existing modes.

## Phase 7 — Review, verification and delivery

- [x] Full unit/integration suite and production build pass.
- [x] Automated complete-campaign traversal, failure/retry and resource/ledger invariants.
- [x] Real browser smoke tests and desktop/portrait/landscape captures inspected.
- [x] Performance checks with bounded effects and maximum story enemy count; document results and limits.
- [x] Review final diff, preserve unrelated work, transfer verified changes to the canonical repository.

## Verification record

All seven phases and canonical handoff are complete. `npm run verify` passes 450 tests across 38 files, asset validation, strict TypeScript and the production build in both the isolated review clone and the canonical repository. Headless Edge checks cover all chapters, desktop/touch input, pause, upgrades, retry/reload and the original loading-screen entry. See [verification and limitations](HOMEWARD_VERIFICATION.md) and [raw browser report](homeward-review/report.json).

Final design refinements: the Queen anchors her nest and retargets a telegraphed slam; the maze is deterministic with authored objectives; shell-armor milestones at 10/20 defeats provide explicit early growth; repair uses a nearby contextual action. These decisions keep the campaign coherent and playable without introducing an untested physics or farming subsystem.
