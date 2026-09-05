# New asset code and integration review

Reviewed the pending realism/performance changes on top of `fb133ad`.

## Finding fixed

The pickup flattening helper disposed every intermediate geometry, but `merge` returns its input unchanged when there is only one mesh. Consequently the returned, cached geometry was itself disposed before use. This is a resource-ownership defect; it does not by itself prove that an initial render would be blank, since Three.js can upload the geometry later. Cleanup now excludes the returned geometry. A regression test confirms it is disposed exactly once, when the forge is disposed.

## Performance correction

Projectile color and pickup-halo matrix/color buffers change each frame but still used the default static usage hint. They now use dynamic usage alongside the already implemented active upload ranges. No frame-rate improvement is claimed from the hint alone.

## Actual gameplay integration verified

- Scenery builders supply the new tree, bush, rock and house geometry to TerrainBuilder's instanced meshes.
- Minion/warrior builders use the revised skull geometry; boss identity and existing machine models are preserved.
- WorldView uses the shared projectile geometry, including the corrected forward-pointing tip.
- Normal WorldView pickup construction uses all eight runtime pickup models. Repair kits, armor, mines and weapon parts now use distinct cached geometry instead of scrap. The contact sheet is only another view of these same factories, not the sole consumer.
- Added a renderer-level test that constructs all eight pickup batches, populates real GameWorld pickup entities, checks geometry identity, instance positions, finite transforms and bounded uploads, and verifies that expired pickups leave no visible instances.
- Reviewed scenery culling ownership, preserved transforms/colors, geometry-size margins, segment cleanup, and exclusion of dynamically colored encounter houses. Existing restoration/zoom/empty-view tests remain green.

## Validation

`npm run verify` passed: asset validation, TypeScript, **351 tests in 27 files**, and production build. No additional confirmed release-blocking defect was identified in this targeted review. Physical-device FPS and touch playtesting remain unverified.

Changes are local and pending commit/deployment. The public GitHub Pages site will continue to show the previous deployed build until publication.
