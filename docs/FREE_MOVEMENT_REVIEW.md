# Free movement and Spider-distance warning

Implemented against release `50657ab`, following the request to remove the Spider-distance lock.

## Player-facing changes

- No Spider-distance clamp, pull-back, distance damage or forced equipment drop. Walking, carrying and dodging remain available far from the convoy.
- A persistent amber warning begins at 32 m. It shows the actual distance in metres, a camera-relative return arrow, and “You can keep exploring.” At 64 m it becomes “Very far from Spider” with a stronger color.
- Returning to 28 m clears the warning. The small gap prevents flickering near the threshold. Screen-reader announcements happen only when severity changes, not every metre.
- Nearby camera framing is retained. Between 32 and 64 m the camera gradually prioritizes the engineer; farther away it follows the engineer with bounded zoom.
- The warning replaces the duplicate floating Spider indicator while visible, preventing the indicator from obscuring the distance on small landscape screens.

## Related logic checks

- Physical obstacles still block movement; the AI navigation window itself does not. Registered houses, rocks and machines are checked in world space when the player explores beyond that window.
- Rivet Turrets near either the player or Spider are retained. Old abandoned turrets still retire after both have moved away; the retention radius is independent of the advisory warning threshold.
- Enemy navigation still follows the Spider. The Spider continues its normal route while the player explores. Combat, stage boundaries/transitions, contextual-action range and terrain movement costs are unchanged.
- Removed obsolete tether damage settings, event and state names; updated integration tests to assert free movement instead of forced return.

## Verification

- All **411 tests across 35 files** pass, including 14 new free-roam tests.
- Asset validation, strict TypeScript and production build pass.
- Browser checks verify unchanged health/position while idle far away, retained carried equipment, keyboard movement beyond the old range, accurate distance/direction, camera framing, and warning removal on return.
- Eight desktop/phone-sized captures cover 40 m and 95 m separation plus existing horde and pickup scenes. These are layout/browser checks, not physical-phone performance measurements.
- New tests exercise stationary players as far as 1,000 m away without distance penalties, full-speed walking across the former limit, distant dodging, warning hysteresis, far-away obstacle collision and nearby turret retention.

Screenshots: [desktop](free-roam-review/desktop/roam-far-1280x720.png), [portrait](free-roam-review/mobile/roam-far-390x844.png), [landscape](free-roam-review/landscape/roam-far-844x390.png).

The user subsequently requested publication. Publication uses Git SSH and the existing `Deploy To GitHub Pages` workflow. Git history and the workflow run record the release commit and deployment result.
