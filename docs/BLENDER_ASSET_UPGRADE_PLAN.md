# Blender asset upgrade

## Art direction and boundaries

Original, readable stylized industrial-fantasy art for Iron March. Improve silhouette, construction and material contrast at the actual overhead camera distance. Keep white ordinary skeletons, rust-armored warriors and a stone boss with its existing colored core. Preserve health, damage, collision footprints, door release points, animation pivots, stage progression and the pending pickup/UI work.

Use the portable Blender supplied in the sibling `3d_astra` repository as an executable only. Do not change that game or reuse its unrelated military models. Generate editable Blender source plus one self-contained GLB library, without paid assets, add-ons, texture downloads or runtime dependence on a local path.

## Phases

1. [x] Author a reproducible Blender script: three biome-matched houses, seven articulated parts for each of three enemy types, six player guns and four low-cost effect shapes.
2. [x] Integrate the library into MeshForge before world preparation. Preserve procedural fallback on load failure, shared geometry ownership, enemy joint hierarchy, gun sockets, instanced houses and batched enemies.
3. [x] Improve event visuals: directional weapon flashes, rising flamer fire, impact bursts, explosion fire/smoke and overload vents. Keep effects pooled; never add per-effect lights or simulated fluids.
4. [x] Validate exported geometry, units, colors, budgets, fallbacks, disposal and rig compatibility. Inspect runtime asset sheets and gameplay at desktop and phone-sized viewports (not physical-phone testing). Measure existing stress scenarios.
5. [x] Transfer verified changes into the canonical game repository without overwriting unrelated work. All 35 delivery files were hash-verified; canonical verification passed with 397 tests. Publication is handled by the follow-up release commit and the existing GitHub Pages workflow.

Implementation, screenshots, measured budgets and rebuild instructions: [Blender asset workflow and review](BLENDER_ASSET_WORKFLOW.md).

## Budget and acceptance

- One GLB, no external textures; target below 2.5 MB.
- At most 34 shared mesh assets; at most 18,500 unique enemy-part vertices and 66,000 indices, leaving room in the existing horde batch.
- Houses stay within the established roughly 5.4 × 4.6 metre visual footprint. Doorway faces +Z; floor starts at ground level.
- Guns retain their original grip and muzzle coordinates. Enemy limbs remain local to the existing joints.
- No per-house/per-enemy draw-call increase. Effect variants may add a small fixed number of instanced batches, not one per event.
- Existing tests/build, loader-failure checks and browser captures must pass. Software-rendered timing does not establish hardware or physical-phone FPS.

## Technical reference

The existing [Three.js instancing design](https://threejs.org/docs/pages/InstancedMesh.html) is retained: shared geometry/material with separate instance transforms. Blender exports vertex colors into the same single-material pipeline used by the game.
