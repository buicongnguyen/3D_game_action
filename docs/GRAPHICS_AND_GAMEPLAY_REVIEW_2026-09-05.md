# Graphics and gameplay improvement plan — 5 September 2026

Baseline: canonical repository commit `fc23602`. This review uses current source, deterministic desktop captures (march, houses, horde), and web research. It preserves the existing escort, weapon shop, stage and checkpoint systems.

## Findings and recommendation

The Spider is a strong visual focal point and the white skeleton / purple heavy-enemy distinction works. The terrain has biome variety, but the road direction is weak at play-camera scale. Houses have no persistent indication of threat or destruction. The HUD gives resources and distance but little help choosing between defending the Spider and stopping a nest. Increasing enemy count or adding more weapons would amplify this ambiguity.

Confirmed logic issues: a nest destroyed during its warning still releases its queued first wave; explosive projectiles striking a nest do not perform their normal area explosion; nest damage is attributed to the player even when fired by a turret. These undermine the tactical value of destroying nests.

Recommendation: improve information and agency around the systems already present. Keep the action space open, make route direction visible, show local nest/boss status, and make nest destruction reliably stop future waves.

## Research informing the design

- [Riot: Clarity in League](https://www.leagueoflegends.com/en-us/news/dev/clarity-in-league/) — prioritize recognizable silhouettes and the relative importance of visual effects. Application: restrained road markers and a single relevant threat card, not labels over every skeleton.
- [Riot: VALORANT shaders and gameplay clarity](https://www.riotgames.com/en/news/valorant-shaders-and-gameplay-clarity) — lighting and contrast should help separate gameplay objects from scenery. Application: clear nest state colors and subdued destroyed houses using the current instanced renderer.
- [Enemy Attacks and Telegraphing](https://www.gamedeveloper.com/design/enemy-attacks-and-telegraphing) — cues should give players information they can respond to. Application: visible reinforcement countdown and progress toward shutting down a nest.
- [Deep Rock Galactic: Escort Duty](https://deeprockgalactic.wiki.gg/wiki/Escort_Duty) — escorting, protection and repair can form a coherent mission loop. Application is an inference: retain the Spider escort identity while making short tactical decisions along the route more legible; do not copy its content.

## Execution phases

1. **Logic and agency.** Cancel destroyed-nest releases, preserve bounded reinforcement counts, make explosive nest impacts behave consistently, correct damage attribution, and allow deliberate aim toward a nest to take priority over incidental enemies. Verify cancellation, damage/rewards and targeting with focused regression tests.
2. **Graphics.** Add sparse forward road chevrons, readable nest health/state rings, and a subdued destroyed-house appearance. Reuse instancing and shared geometry; add no textures, post-processing or per-skeleton UI. Verify before/after desktop and small-screen captures.
3. **Orientation and combat feedback.** Add stage name/progress and one nearby boss-or-nest status readout, including nest reinforcement countdown and shutdown reward. Keep UI within mobile layout boundaries. Verify relevant scenarios and run the complete validation suite.

## Acceptance criteria

- Destroying a nest before its first release prevents that release and all reinforcements; rewards cannot duplicate.
- Explosive impacts and source attribution are consistent on nest targets.
- Road arrows follow the authored spline; ruins remain collision-consistent scenery after shutdown.
- Nest feedback follows real health, active state and reinforcement timer; boss health excludes dead enemies.
- Desktop and small-screen screenshots remain readable; graphics use bounded instanced draws.
- Asset validation, TypeScript, tests and production build pass. Software-rendered capture timing is not claimed as real mobile FPS.

## Future options (outside this implementation)

After playtesting this pass, evaluate distinct boss wind-up attacks, optional rescue stops with risk/reward, and weapon sidegrades rather than more raw damage levels. These need separate balance and animation work; they are not promises of this plan.

## Results

All three execution phases implemented.

- Logic: destroyed nests cancel queued waves; normal reinforcements retain their full eight-second delay. Magnetic projectiles explode on nest impact and damage nearby enemies. Nest damage credits the correct player/structure source. A nest within an 18-degree aiming cone can be selected during a swarm; automatic fire retains enemy priority when no direction is supplied.
- Graphics: one instanced draw supplies forward route chevrons. One additional instanced draw supplies segmented nest health, with amber dormant, red active and green cleared states. Destroyed houses become subdued solid ruins, preserving their existing collision footprint. Nest GPU buffers update only when their state/health changes.
- HUD: stage name and route completion percentage; one nearby boss health or nest health/countdown/reward card. Dead bosses and destroyed nests disappear from that card. Landscape uses a compact center panel; portrait separates notifications and the construction bar from the status panels.
- Validation: 324 tests across 23 files pass; asset validation, TypeScript and production build pass. Regression cases cover first-wave cancellation, deliberate nest aiming, explosive nest impact, reward uniqueness, source attribution, and dead-boss-to-nest readout fallback.
- Visual QA: desktop 1280×720, landscape 844×390, portrait 390×844. The first concurrent desktop capture run timed out on two scenes; a complete sequential rerun passed. Small-screen captures prompted corrections for HUD overlap and terrain-hidden health rings.
- Performance: eight campaign/stress profiles, 127–158 draw calls, 16–209 active enemies, no pool saturation/exhaustions. The new geometry adds one road draw per segment and one health-ring draw on nest segments. See [performance report](review-performance.json). No before/after FPS speedup is claimed; these are software-rendered harness measurements, not real-device mobile benchmarks.

### Visual evidence

- [Before: ordinary march](review-before/march-1280x720.png)
- [After: route direction](review-after/march-1280x720.png)
- [Active nest: health and warning](review-after/nest-1280x720.png)
- [Cleared nest](review-after/nest-cleared-1280x720.png)
- [Boss feedback](review-after/horde-1280x720.png)
- [Phone landscape](review-mobile/nest-844x390.png)
- [Phone portrait](review-mobile/nest-390x844.png)

### Remaining review limits

This is a targeted graphics and combat-logic pass, not proof that every campaign branch or every input-device combination is defect-free. Phone captures validate layout, not physical touch controls or mobile GPU speed. Distinct boss attack telegraphs and broader asset/lighting polish remain future work. The implementation does not change checkpoint saves or campaign progression data.
