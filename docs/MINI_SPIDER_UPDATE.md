# Mini Spider model reuse

The small Homeward spiders now derive from the original Iron Spider, not separately drawn sphere-and-stick creatures. Broodling, Jumper and Shellback reuse its exact eight-leg joint hierarchy, segment lengths, claw geometry and alternating planted-foot walking solver.

## Appearance

- Preserve the original keel, deck, prow, side armor, boiler, rails and three smokestacks.
- Scale the shared structure to 25% for Broodlings/Jumpers and 34% for Shellbacks.
- Apply only subtle warm/cool tints; do not replace the recognizable structure with new enemy geometry.
- Omit tiny rivets, pipework, sockets and some limb trim. Bake static stacks into the hull; do not allocate glowing furnace materials or individual lights per enemy.
- Keep the friendly hero's full-detail model. The Queen and humanoid Husks/Stitchers are unchanged by this mini-Spider update.

## Walking and performance

The same hero walking solver now accounts for uniform scale in stride cadence, swing duration, lift and claw height. Swing height is added to interpolated terrain height, fixing a raised-ground contact error. Jumpers clear stale planted contacts during flight and on landing, avoiding stretched legs.

Independent hidden rigs supply matrices to four instanced batches: hull, upper legs, lower legs and feet. Dead walkers are removed immediately and their rigs are reused; chapter changes reset identity/contact state. Geometry is shared and remains owned by the existing machine cache.

Tests enforce at least 35% fewer vertices than a full hero rig, original joint proportions, planted contacts on elevated sloping ground at 30/60/120 Hz, and bounded batches for 48 enemies.

## Verification

- Full verification: 455 tests in 39 files, asset validation, strict TypeScript and production build pass.
- Headless Edge story smoke checks pass at desktop, portrait and landscape sizes, including touch movement/release, action, pause, chapter transitions and checkpoint reload.
- 48 walkers: four batches; measured CPU joint/instance update p95 about 0.9 ms and maximum about 1.0 ms. This excludes full GPU rendering and is not a physical-phone FPS claim.
- Hill overview with ten minis: 60 total draw calls and 123,502 triangles. The richer mini models cost more triangles than the former simple blobs, but remain much cheaper than rendering 48 full hero rigs individually.
- [Walking pose A](mini-spider-review/mini-walk-0.png), [walking pose B](mini-spider-review/mini-walk-12.png), [raw browser report](mini-spider-review/report.json).

Reproduce: serve the production preview on port 4246, then run `node scripts/story-check.mjs --out=../docs/mini-spider-review --mini-review`.
