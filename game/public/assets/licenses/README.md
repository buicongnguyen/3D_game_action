# Third-party asset licenses

This folder is populated by `scripts/sync-assets.mjs`. It copies the four
`License.txt` files named in `public/assets/manifest.json` (`licenses`) out of
the local KayKit + Kenney library, renamed to avoid collisions:

- `kaykit-License.txt` — from `kay_assets/The Complete KayKit Collection v6.1/License.txt`
- `kenney_factory-License.txt` — from `assets/kenney_factory/License.txt`
- `kenney_space-kit-License.txt` — from `assets/kenney_space-kit/License.txt`
- `kenney_nature-License.txt` — from `assets/kenney_nature/License.txt`

## Current build: procedural mode, no third-party assets bundled

This repository ships **without** those files present. The build does not
depend on them: every id in `public/assets/manifest.json` has a procedural
fallback generated at runtime by `src/art/MeshForge.ts`
(`AssetManager.usingProcedural` is `true` whenever nothing was actually
loaded from disk), so the game runs correctly with an empty
`public/assets/` tree.

If you see only this README and no `*-License.txt` files next to it, that is
expected — it means nobody has run the sync step on this machine, not that
something is broken.

## To sync the real library

1. Get a local copy of the KayKit + Kenney asset library referenced by
   `prompt_guide.md` §17. It must directly contain these four files:

   ```text
   <ASSET_SOURCE_ROOT>/kay_assets/The Complete KayKit Collection v6.1/License.txt
   <ASSET_SOURCE_ROOT>/assets/kenney_factory/License.txt
   <ASSET_SOURCE_ROOT>/assets/kenney_space-kit/License.txt
   <ASSET_SOURCE_ROOT>/assets/kenney_nature/License.txt
   ```

2. Set `ASSET_SOURCE_ROOT` to that directory and run the sync script:

   ```sh
   ASSET_SOURCE_ROOT=/path/to/your/3d_assets npm run sync-assets
   ```

   (or `node scripts/sync-assets.mjs --root=/path/to/your/3d_assets`).

3. Run `npm run validate-assets` to confirm every manifest entry's runtime
   file and `.gltf` dependencies (`.bin`, images) were copied correctly, and
   that nothing in the manifest or under `src/**` references an absolute
   local filesystem path.

The sync script never copies the whole library — only the exact files listed
in `public/assets/manifest.json`, plus these four licenses.
