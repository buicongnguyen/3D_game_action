# Mobile and PC performance review

Date: 2026-09-20. Game: Iron March (Marching and Homeward Story modes).

## Conclusion

The simulation already has useful optimizations: shared navigation flow fields, spatial neighbor queries, bounded enemy update rates, pooled entities and batched rendering. Rewriting pathfinding was not justified by the available measurements.

There were avoidable graphics costs: phones inherited desktop shadows and antialiasing, up to 96 fully articulated enemies, dense flat Story terrain, and off-screen Story animation. These are credible contributors to lag, but the user's physical phone has not been profiled. This work reduces those costs without changing difficulty, movement, loot, collision or progression.

## Completed implementation

- [x] Introduce automatic touch-first/phone rendering profiles, with explicit URL overrides for testing.
- [x] Cap rendering pixels and slowly adapt resolution under sustained load.
- [x] Reduce decorative work while preserving gameplay geometry.
- [x] Reduce repeated transform work and temporary allocations.
- [x] Review mobile visuals, gameplay invariants and benchmark reliability.
- [x] Verify tests, production build and browser interactions.

### Rendering profiles

| Setting | Desktop | Phone/tablet |
| --- | --- | --- |
| Maximum drawing DPR | 1.5 | 1.25 |
| Maximum drawing pixels before adaptation | 3,000,000 | 700,000 |
| Marching shadows / MSAA | Retained | Disabled |
| Fully articulated Marching enemies | 64 | 32 |
| Small non-colliding Marching decoration | Full | One third |
| Story forest dressing | Full | One third |

The remaining Marching enemies are still drawn using the existing lightweight animated representations. The main spider and nearby gameplay objects keep their models. Enemy counts, hitboxes, steering rates and weapons are unchanged.

Only the 3D canvas resolution is reduced; HTML interface text remains at native display resolution. Sustained average frame time above 24 ms lowers drawing scale in 12.5% steps to a 75% floor. Recovery requires about ten healthy seconds per step. This does not lower the simulation or input rate. A 75% scale draws 56.25% as many pixels as a 100% scale.

Touch-device HUD panels no longer blur the animated canvas underneath them. PC panel styling is retained.

Use `?quality=low` to force the economical profile on an older PC, or `?quality=high` to test the desktop profile on a phone. Automatic detection remains the default; a touchscreen laptop with a mouse-primary pointer retains the desktop profile.

### Scenery and Story mode

Flat chapter floors now use small grids (16 × 16, or 16 × 24 for the escort route) instead of 100 × 100 / 100 × 140. The shaped hill keeps its original mesh so terrain and spider contacts remain consistent.

Story scenery is culled outside a conservative camera region. Off-screen mini-spiders stop solving presentation joints, but remain active in the simulation and resume their visuals on re-entry. Matrix/color uploads cover active instances rather than entire capacities.

Marching keeps every solid tree, rock, house and wall. Only non-blocking dressing is thinned; its random generation still runs identically so quality settings cannot alter subsequent obstacle placement. Story forest dressing has no colliders. An odd thinning stride preserves both sides of its alternating roadside tree pattern.

### CPU work

The shared spider leg solver no longer traverses all decorative children before solving joints or repeatedly walks ancestor transforms for each foot. Regression tests bound transform updates and retain the existing grounded-foot, turning, scale and jump checks.

Story render loops reuse scratch vectors, arrays, counters and ID sets rather than creating new ones for each bullet, beam and mini-spider update. Camera projection updates occur only when bounds or zoom change.

## Measurements

Headless Edge with SwiftShader, not a physical mobile GPU. Marching comparison used the same 1896 × 941 viewport and a deterministic seed. The low profile was forced at that viewport to compare rendering work; phone detection was tested separately with Android/touch emulation and DPR 3.

| Scene / metric | Before | Desktop after | Mobile profile after |
| --- | ---: | ---: | ---: |
| Marching stress: active enemies | 209 | 209 | 209 |
| Marching stress: triangles/frame | 485,086 | 400,646 | 262,886 |
| Marching stress: draw calls/frame | 137 | 132 | 79 |
| Story chapter 2 overview: triangles/frame | 70,418 | 50,930 | 33,878 |
| Story chapter 4 overview: triangles/frame | 78,430 | 51,198 | 34,146 |

For the stress scene, this is about **17% fewer triangles on desktop**, and **46% fewer triangles / 42% fewer draw calls in the mobile profile**. These are workload reductions, not promised FPS increases. Small differences in live warm-up timing mean not every benchmark scene has an identical final enemy/projectile count; the stress comparison above has the same enemy count.

A paired CPU-only comparison of the old and new IK solvers, alternating run order in one process, reduced mean solve-plus-matrix time for 48 mini rigs from about 0.91 ms to 0.56 ms (roughly 39%). This is a synthetic local microbenchmark, not whole-game frame time.

The separate headless browser mini-rig p95 increased from about 1.3 ms to 2.6 ms across runs. Overall simulation timing did not establish a repeatable improvement either. Software-renderer/system load and short sampling make these unsuitable for claiming faster real-device FPS. Both results are retained rather than reporting only the favorable microbenchmark.

## Validation

- Asset validation, TypeScript, all **474 tests**, and production build pass.
- New regression tests cover device selection, DPR/pixel budgets, adaptive-resolution bounds/recovery, identical mobile/desktop navigation and solid scenery, off-screen mini-spider restoration, and bounded IK transform work.
- Headless browser checks cover all four Story chapters in desktop, portrait and landscape sizes, automatic Android/touch profile detection at DPR 3, keyboard movement, touch joystick release, stone deployment, pause, checkpoint reload and campaign traversal.
- Marching phone-sized captures cover the normal march, horde and coin/gem pickups; the capture harness asserts the requested low profile was actually selected.
- Visual review checked the main spider/mini-spiders and phone scenery. Fixed the one-sided Story roadside thinning found during review.
- Fixed a benchmark harness issue that could read an old browser session: randomized debugger port, exact probe URL matching, browser shutdown, and quality parameters preserved in capture/performance URLs.

## Evidence and remaining checks

Reports are under `docs/mobile-performance/`: before/after Marching JSON, before/after Story reports, and the paired IK results. Selected phone and mini-spider screenshots are retained; not every intermediate capture is copied into the main repository.

Before claiming a target frame rate, test the deployed build on the actual phone: portrait and landscape, late-stage horde, rockets/flame, Story hill, and at least 5–10 minutes for thermal throttling. Compare automatic mode with `?quality=high`; inspect FPS/frame time, readability, device temperature and controls.

The implementation was originally delivered locally, preserving the earlier coin/diamond pickup changes. The user subsequently requested publication of both improvements using Git SSH and the existing GitHub Pages workflow. Git history and the workflow run record the release commit and deployment result.
