# Rock geometry review

The original rocks combined very coarse flattened icosahedra with an extra
flattened stone underneath. Random vertical offsets were independent of the
rotated stone's actual bottom, so individual pieces were not reliably grounded.

Changes:
- Main boulders now have 80 facets; smaller chips retain 20.
- Three variants have different proportions and one, two or three stones.
- Remove the extra pedestal and normalize each transformed stone to a shallow
  0.08 m buried underside before instance scaling.
- Preserve muted stone colors, deterministic generation, cached geometries and
  instancing. Total model cost is 80/100/120 triangles versus 40/60/80 previously;
  draw-call count is unchanged. No hardware FPS improvement is claimed.
- Existing terrain-triangle sampling places the rock origin on the actual ground.
  These rigid props do not conform their entire footprint to steep slopes.

Validation: 358 tests pass, TypeScript and production build pass. Regression
checks exercise all three variants across 25 seeds for base height, finite
geometry and triangle budgets. Inspected asset-sheet and gameplay captures in
`graphics-review/docs/rock-review/` in the working workspace.

Local changes only; not committed or deployed.
