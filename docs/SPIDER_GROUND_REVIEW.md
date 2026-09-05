# Spider feet and visible ground

## Confirmed cause

The old wide terrain ribbon folded over itself around route bends. A raycast
against the actual rendered mesh measured ground 0.666 m above the Spider's
zero-height contact plane on the scrapyard route (298 m). Correctly planted
feet could therefore be hidden under the terrain. This was separate from gait.

## Correction

- Replaced the swept ribbon with one non-overlapping world-space heightfield.
- Measure relief from the nearest route, with a cell-diagonal safety margin
  to prevent raised triangle vertices interpolating across the walking lane.
- Place scattered scenery using the actual ground triangle height.
- Retain biome colors, off-road relief, instancing and one ground draw call.
  Geometry is generated at stage entry, not each animation frame. Grid triangle
  counts differ from the old ribbon; this is a correctness fix, not an FPS claim.

## Regression checks

Raycast every stage's inner road at 8 m intervals, including lateral foot
positions; require the visible surface to remain within 2.5 cm of contact height.
Use front-face materials to catch inverted triangles. Compare scenery height
sampling with off-road raycasts, and bound each stage's grid to 30,000 vertices.
Existing gait tests cover planted contacts, turning, stops and stage transitions.

The Spider still uses a flat-road contact plane, not arbitrary off-road terrain IK.
These changes are local until explicitly committed and deployed.
