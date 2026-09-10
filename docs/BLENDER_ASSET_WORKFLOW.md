# Blender artwork integration — 2026-09-10

## Delivered artwork

The portable Blender 4.5.3 LTS executable in the sibling `3d_astra` repository generated original models for this game. That repository and its assets were not changed. This is a stylized low-poly upgrade, not a photorealistic or fluid-simulation conversion.

| Runtime assets | Visible change | Integration |
| --- | --- | --- |
| 3 houses | Cottage, town house and foundry; open recessed doorways, framed windows, layered roofs, chimneys and architectural details | One instanced house batch per stage, selected by biome; existing collision/spawn data retained |
| 21 enemy parts | Ivory skeleton, rust-armored warrior and broad stone golem with articulated limbs, rib cages, skull sockets, fingers and feet | Seven shared part geometries per type on the existing animation joints; cheap distant impostors retained |
| 6 guns | Distinct scattergun, carbine, rifle, steam flamer, arc projector and magnetic launcher | Existing hand/grip transforms and weapon mechanics retained |
| 4 effect meshes | Directional flash, bent flame tongues, radial impact and smoke/steam puffs | Five bounded effect batches including the existing ground ring; no per-effect lights |

Flamer shots, arc discharge, explosions, impacts and overload vents use the new effects. Existing pickup, repair and death feedback remains connected. House health/shutdown signals and the boss's existing glowing core remain intact. Trees, rocks, the engineer, Spider, turrets and pickups remain the previously improved native models; this pass does not claim to replace every object or invent new stage events.

## Files and rebuilding

- Generator: `game/tools/blender/build_iron_march.py` — the repeatable source of truth.
- Editable assembled previews and mesh-local originals: `game/assets/source/iron-march-library.blend`.
- Shipped library: `game/public/assets/blender/iron-march.glb`.
- Export inventory: `game/public/assets/blender/catalog.json`.
- Runtime import/validation: `game/src/art/BlenderLibrary.ts`.

From the canonical repository's `game` directory:

```powershell
npm run build-art
npm run verify
```

The default executable location is the sibling `3d_astra/.tools/blender-4.5.3-windows-x64/blender.exe`. Elsewhere, use:

```powershell
npm run build-art -- --blender C:/Users/n/source/repos/3d_astra/.tools/blender-4.5.3-windows-x64/blender.exe
```

`BLENDER_BIN` also overrides the executable. Blender is a build-time tool only: players and GitHub Pages do not need it. Ordinary builds use the checked-in GLB and catalog without regenerating art.

Rebuilding overwrites the generated `.blend`, GLB and catalog. Put lasting design changes in the generator. For manual Blender edits, save a separate working copy; exporting the entire preview scene would duplicate models and break their names/origins. The hidden “Runtime meshes - local origins” collection contains the importable originals; “Assembled previews” is for inspection. Keep their names, transforms, indexed triangles and vertex colors intact, and update the catalog when exporting a changed pack.

Helpers use metres, +Y up and +Z forward; they convert to Blender coordinates and export back to glTF's Y-up coordinates. Limbs use the existing joint-local origins. The loader discards imported materials and shares immutable RGB geometry with the game's existing materials. No third-party artwork, textures, paid add-ons or external asset URLs are required.

## Review fixes and safeguards

- Corrected an ankle joint that would otherwise put the golem's foot 4.5 cm below the floor.
- Removed coincident reversed faces from thin cloth/surfaces and gave those surfaces real thickness before export.
- Preserved roofs/walls as visibly different materials under biome/nest tints.
- Replaced square flashes with directional geometry; reduced flame saturation and added curved/tapered tongues.
- Smoke uses per-instance alpha fade rather than fading its color to black.
- Geometry is disposed by its owning library; VFX disposes only its own geometry/materials. Shared assets are not freed when one effect disappears.
- Imports reject missing meshes, incompatible attributes, invalid indices/bounds and enemy geometry over budget. An eight-second fetch timeout or failed download falls back to procedural art.
- Capture tests now detect JavaScript/console rendering errors, assert the loaded model count and can deliberately block the new GLB with `--art procedural`.

## Verification

`npm run verify`: **397 tests in 34 files passed**, asset validation, strict TypeScript and production build passed. Seven new Blender tests cover actual GLB contents, ground contact, joint/weapon compatibility, sharing/batch capacity, fallback/base paths/timeouts, and VFX expiration/disposal/saturation recovery.

Final library: **34 meshes, 1,196,756 bytes**, with 13,556 unique enemy-part vertices and 18,948 indices. Houses contain 824–896 triangles, guns 424–564, and effects 8–144. The compressed editable Blender source is 254,342 bytes and is not included in the web download.

**12 browser captures passed:** five desktop (1600×1200), three narrow portrait (390×844), two small landscape (844×390), and two deliberately blocked-download fallback scenes (1280×720). The model/effect sheets and gameplay were visually inspected. These are viewport checks, not a claim of physical-device or touch-controller testing.

- [Model contact sheet](blender-review/desktop/blender-models-1600x1200.png)
- [Effect contact sheet](blender-review/desktop/blender-effects-1600x1200.png)
- [Houses in gameplay](blender-review/desktop/houses-1600x1200.png)
- [Portrait horde](blender-review/mobile/horde-390x844.png)
- [Fallback horde](blender-review/fallback/horde-1280x720.png)

## Rendering comparison

The same eight scenario definitions ran against the previous pickup/UI build and the final Blender build. Reports are [before](blender-review/performance-before.json) and [after](blender-review/performance-after.json). Dynamic combat and effect sampling can vary between runs; these are workload comparisons, not identical-frame microbenchmarks.

| Scenario | Draw calls before → after | Triangles before → after |
| --- | --- | --- |
| Departure | 127 → 124 | 155,830 → 160,614 |
| Settlement | 146 → 146 | 251,874 → 263,408 |
| Flooded | 140 → 140 | 408,188 → 420,104 |
| Maze | 150 → 149 | 417,468 → 431,990 |
| Gate | 158 → 160 | 440,094 → 465,892 |
| Combat 100 | 150 → 150 | 405,894 → 407,432 |
| Stress 200 | 135 → 131 | 462,230 → 480,368 |
| Full pursuit | 152 → 148 | 446,638 → 465,828 |

Triangle increases range from about 0.4% to 5.9%; maximum sampled draw calls increased from 158 to 160. The stress scenario reached **209 enemies**. No counted pool exhaustion or sampled saturation occurred; VFX peak was 14/180. Shared near-enemy batching, distant impostors, unchanged shadow-caster counts and fixed effect pools keep the additional detail bounded.

Both runs used headless Edge/SwiftShader. Do not convert their timings into promised GPU or phone FPS, or claim the new art improved performance from these timings. Real-device profiling remains necessary. Narrow screens still have dense HUD/toast presentation from the existing UI; this art pass does not redesign that layout.

## Delivery status

All 35 delivery files were transferred and hash-verified in the canonical `3D_game_action` repository, preserving the earlier pickup/UI work. Canonical asset validation, TypeScript, all 397 tests and the production build passed after transfer and again before release. The user subsequently requested publication of both improvements. Release history and deployment results are recorded by Git and the existing `Deploy To GitHub Pages` workflow.
