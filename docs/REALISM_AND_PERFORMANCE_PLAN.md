# Believable procedural visuals and rendering performance

Baseline: `fb133ad`, 2026-09-05. Target: readable, believable low-poly machinery and scenery, not photorealism. Preserve gameplay, collision footprints, enemy identities, resource colors and stage progression. No downloaded assets, new lights, post-processing or texture dependencies.

## Execution order

1. Audit every asset family. Trees currently use block canopies; house roofs resemble open boxes; skeleton skulls are squared off; repair kits, weapon parts, armor and mines reuse scrap geometry. Projectiles use one oversized streak profile. Keep the already detailed Spider, turrets, guns, cylinders and fuel containers unless inspection shows a concrete problem.
2. Improve silhouettes: tapered cylindrical trunks, layered conical needles, asymmetric rounded broadleaf/bush clusters, more natural rock bases; recognizable pitched house roofs, structural trim, windows and chimney; rounded skulls with sockets and jaw; bespoke special-item silhouettes.
3. Improve object presentation: smaller ground-level pickup halos, subtle bob/rotation, directional projectile tips and shorter speed-related streaks. Keep small objects visible and retain resource colors.
4. Reduce rendering work: compact static scenery to a conservative camera neighborhood with shadow/size margin, preserving original instance transforms/colors and all collision data. Recompute only after camera movement/zoom changes. Remove per-frame pickup-map allocation and restrict dynamic GPU uploads to active instances. Do not lower enemy counts or change simulation speed.
5. Verify: deterministic geometry/budget tests, culling return/zoom/color tests, full existing suite, before/after gameplay captures and eight-scenario rendering metrics. Document any visual/performance tradeoff; SwiftShader measurements do not establish real-device FPS.

## Acceptance criteria

- Each consumable has a recognizable model, not just a differently scaled scrap pile.
- Organic shapes are less box-like; houses read as buildings at gameplay distance.
- No extra per-instance draw calls for new art. Cached merged geometry and instancing remain in use.
- Off-screen scenery is not rendered unnecessarily, but approaching scenery and shadows do not visibly pop into the viewport. Returning and zooming restore original instances and colors.
- Tests and production build pass; no resource-pool exhaustion in the existing stress suite.
- Aim for smooth 60 FPS on suitable hardware, but make no guaranteed frame-rate claim without physical-device measurements.

## References

- [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html): preserve batching to limit draw calls.
- [Three.js BufferAttribute](https://threejs.org/docs/pages/BufferAttribute.html): dynamic usage and bounded upload ranges.
- [Three.js responsive rendering](https://threejs.org/manual/en/responsive.html): resolution has a substantial rendering cost; retain the existing DPR cap rather than increasing it with visual detail.

## Results

All five phases implemented and verified locally. No gameplay balance, collision footprints, stage layouts or enemy-count limits changed.

### Visual changes

- Conifers have layered cone foliage; broadleaf/spindle trees and bushes use rounded, asymmetric clusters and tapered cylindrical trunks. Rocks no longer sit on square plinths.
- Houses have pitched, partly damaged roofs, ridge trim, a chimney cap, window recesses, mullions and a door lintel, merged into the existing instanced house geometry.
- Minion/warrior skulls have rounded craniums, jaw and nose recess detail. Existing skeleton/boss color distinction is retained. Boss, Spider, turret/crawler and weapon models were inspected and retained rather than adding unseen geometry.
- Repair kits are handled service boxes, armor is stacked riveted plating, mines are round pressure devices, and weapon parts are spare receiver/barrel assemblies. Fuel cans and cylinders retain their already distinct geometry. Pickups are closer to the ground, rotate more slowly and use thin halos so their physical shapes are visible.
- Projectile tips point forward; tracer length now follows speed within a bounded range instead of stretching every round by 6.5x. Weapon hit logic is unchanged.
- [Runtime asset contact sheet](realism-review/details/asset-review-1600x1000.png), [gameplay comparison before](realism-review/before/houses-1280x720.png), [after](realism-review/after/houses-1280x720.png), [portrait check](realism-review/mobile/houses-390x844.png).

### Optimizations

- Static scenery, maze walls, towers and arches are compacted to a conservative camera neighborhood. Geometry extent and an 18-metre shadow/motion margin are included. The original matrices/colors are preserved for revisits; collision data is never culled.
- Culling work is skipped until the camera moves 3 metres or its culling radius changes 1 metre. No additional per-object scene nodes or draw calls were introduced for scenery.
- Removed per-frame pickup count maps and per-pickup scale-array allocations. Active instance ranges, not entire pool capacity, are uploaded for projectiles and pickup transforms/colors.
- Kept the existing DPR cap, batched horde, pooled combat entities, shared geometry/material caches and limited lighting. No expensive post-processing was added.

### Observed rendering counts

Baseline is the previous verified `fb133ad` build's [eight-scenario report](category-review/performance.json). Final measurements: [JSON](realism-review/performance-final.json).

| Scenario | Before triangles | After triangles | Reduction |
| --- | ---: | ---: | ---: |
| Departure | 195,700 | 152,408 | 22.1% |
| Settlement | 287,668 | 250,612 | 12.9% |
| Flooded | 477,600 | 408,064 | 14.6% |
| Maze | 432,512 | 391,902 | 9.4% |
| Gate | 442,492 | 435,942 | 1.5% |
| Combat | 447,862 | 409,460 | 8.6% |
| Stress | 496,616 | 457,886 | 7.8% |
| Pursuit | 475,270 | 442,534 | 6.9% |

These are observed whole-scene counts, not isolated microbenchmarks: live shots, pickups and enemy counts can vary slightly between browser runs. Draw calls remained 127-158 (baseline 127-159); stress handled 209 enemies with zero counted pool exhaustion and no sampled saturation. VFX peak occupancy is sampled rather than exhaustively counted.

Absolute timing did not improve consistently in every SwiftShader scenario. This pass demonstrably reduces submitted geometry and upload/allocation work; it does **not** prove a specific physical-device frame-rate increase. Real GPU/phone playtests are still required before claiming stable 60 FPS, particularly for thermal throttling and high-DPR displays.

### Verification and limits

- `npm run verify`: asset validation, TypeScript, **349 tests / 26 files**, production build.
- Added deterministic finite-geometry/budget checks, distinct cached-item geometry checks, culling restoration/color/zoom/empty-view tests and oversized-prop coverage.
- Inspected four gameplay captures, the labelled asset sheet, and two portrait captures. Procedural models stay deliberately low-poly; this is not a photorealistic asset replacement.
- Static scenery batching adds an immutable CPU copy of instance matrices/colors. Dynamic house health coloring is excluded from compaction so encounter indexing remains stable.
- The contact-sheet capture is development-only (`?capture=asset-review`), uses real cached models, and intentionally freezes its camera/hides gameplay UI for that capture page. Normal gameplay does not invoke it.
- Further work should prioritize real-device profiling and readability feedback, rather than adding more polygons indiscriminately.
