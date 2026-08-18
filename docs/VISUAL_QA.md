# Visual QA — Marcha de Ferro

Scoring against the seven-category rubric in §10 of `fable_implementation_plan.md`.

A category passes at **4/5**. The visual gate passes when every category is at
least 4 and all priority-one defects are fixed. **The gate does not currently
pass.** Open defects are listed in §5.

This is a living record. Append new rows on each formal capture pass rather than
overwriting, so regressions stay visible.

---

## 1. How captures are produced

```bash
cd game
npm run dev                       # serves on http://localhost:4210
npm run capture                   # 1920x1080 set -> ../docs/captures
node scripts/capture.mjs --out=../docs/captures-720 --width=1280 --height=720
```

`scripts/capture.mjs` drives headless Edge over the running server. Each scene
is a deterministic function of a seed, defined in `src/dev/captures.ts` and
reached through `?capture=<id>`, so a capture taken before and after a change
shows the same moment and a before/after comparison actually means something.

Captures use SwiftShader. Geometry, colour, layout and composition are exactly
what a GPU would produce; only speed differs.

The whole 10-image set takes about three minutes. It briefly took far longer,
and three harness bugs are worth recording because every one of them produced
misleading output rather than an error. That is the pattern to watch for in this
project's tooling: it has never yet failed loudly.

- **An unbounded `requestAnimationFrame` hold loop.** The headless runner
  advances virtual time as fast as the page allows, so a loop that redrew every
  frame redrew forever. One `pursuit` capture ran twenty minutes before being
  killed. The loop is now bounded to five frames.
- **A late canvas resize clearing the drawing buffer.** Trimming that loop then
  produced *empty* images for roughly half the set, intermittently: a resize
  reallocates and clears the buffer, so a capture rendered before a late layout
  pass read back blank. `Renderer` now early-outs on a no-op resize and exposes
  an `onResized` hook the capture path uses to redraw. The intermittency is what
  made this dangerous — a set where half the frames silently render empty is far
  worse than one that fails outright.
- **Arguments silently discarded.** The parser read only `--flag=value` and
  skipped everything else without a word, so `--width 1280 --height 720` was
  dropped and a full-size set was written into the 720 directory. See F42. The
  parser now accepts both forms and throws on anything it does not recognise.

---

## 2. Capture inventory

| Capture | Rubric purpose (§10 required set) | File |
|---|---|---|
| `march` | Normal march with the player running ahead | `captures/march-1920x1080.png` |
| `placement` | Turret placement with the pressure network visible | `captures/placement-1920x1080.png` |
| `horde` | Dense horde pressure with readable combat feedback | `captures/horde-1920x1080.png` |
| `lastshot` | Last Shot / structure abandonment | `captures/lastshot-1920x1080.png` |
| `pursuit` | Pursuit with structures, projectiles, VFX and HUD active | `captures/pursuit-1920x1080.png` |
| `route` | Safe stop and route choice | `captures/route-1920x1080.png` |
| `upgrade` | Level-up choice under pressure | `captures/upgrade-1920x1080.png` |
| `module` | Spider module offer at the halt | `captures/module-1920x1080.png` |
| `victory` | Victory state | `captures/victory-1920x1080.png` |
| `defeat` | Defeat state | `captures/defeat-1920x1080.png` |

Second viewport (1280×720): `captures-720/` holds **all ten**, under
`<id>-1280x720.png`. It previously held a partial set, and for one revision it
held something worse — see F42, where the harness silently discarded the width
and height it was given and filled the directory with full-size images. The set
is now shot with the same command as the 1920 set and differs only in viewport.

---

## 3. Review method

Three rounds have run. Each used four independent reviewers, each given a
different pair of rubric categories and required to open the actual PNGs, cite
screen positions, and propose concrete fixes. They were instructed to be harsh
and specific, and not to mark down deliberate stylistic choices such as flat
shading or a limited palette.

Round three added two things that mattered more than the extra pass:

- **Reviewers measured with tooling, not with their eyes.** Findings arrive as
  "corner-minus-centre red is +73", "bone-vs-ground Weber contrast is 0.038",
  "cap height is 6 px". Those are checkable, and several were checked by more
  than one reviewer independently.
- **One reviewer was told to read the code where stills could not answer.**
  Animation is the category no screenshot can settle, and it had therefore never
  been examined at all. Reading `AnimationSystem.ts` produced three defects in
  under an hour — see F51.

Each round ran against a frozen capture set. Defects found have since been fixed
and the set re-shot; the fixes are recorded in §4 next to the evidence that
prompted them, because a fix only means something beside the finding that
motivated it.

---

## 4. Defects found and fixed

| # | Defect | Category | Fix |
|--:|---|---|---|
| F1 | The whole scene rendered at roughly 90% fog: the orthographic camera sat 120 units back while `fogFar` was 128. The world was a flat blue-grey field. | 7 | Paired `CAMERA.distance` with `ENV.fogNear`/`fogFar`, documented at both sites. |
| F2 | The ground was wound face-down; back-face culling made the entire terrain invisible and every prop appeared to float. | 7 | Reversed the triangle winding. |
| F3 | The key light sat behind the scene relative to a fixed 45° camera, so only shadowed faces were ever visible. | 3, 7 | Moved the key into the camera's quadrant, swung about 35° off-axis; the cold rim moved opposite. |
| F4 | NaN transforms silently removed the spider and every character from the render — the animators offset from an uncaptured `restY`. | 7 | Rest poses captured at rig creation; the readers also self-heal, because the failure mode is completely silent. |
| F5 | The spider's legs splayed flat: the animator wrote absolute rotations over the authored arched stance. | 5 | Every joint now offsets from its rest pose. |
| F6 | 414 draw calls at 108 enemies, against a 180 ceiling. | 7 | `BatchedMesh` horde renderer plus instanced contact shadows. Now 129. |
| F7 | Giant white and green rings covered the combat: VFX aged on render delta, so a bulk capture advance froze them at spawn size. | 4 | Render with the full advanced span; captures then run real frames so effects are fresh. Death poofs also shrunk and dimmed. |
| F8 | A hard diagonal terrain edge showed against the fog on the outside of bends. | 2, 7 | Widened the strip and added a backdrop plane beneath it. |
| F9 | "Left behind" markers rendered stacked in the screen's top-left corner. | 6 | The HUD positions markers in CSS pixels; the bridge was passing normalised 0–1 values. |
| F10 | The engineer was near-impossible to find. | 1, 2 | Warm ground marker: a filled pool plus a ring, whose colour also encodes tether strain. (Initially drawn with depth testing off, which fixed occlusion but made the marker paint itself onto the spider's deck — superseded by F19.) |
| F11 | Turrets had no persistent in-world marker. Finding a machine in order to service it is the game's central verb, and a 30-pixel object among a hundred skeletons is not findable. | 1, 4 | Persistent ground ring per structure, coloured by pressure state: cyan served, amber running on buffer, red dry, fast red pulse while overloading. |
| F12 | Muzzle flashes were invisible — 60 ms and under a metre across, correct for a first-person camera and not for this one. | 4 | Roughly tripled lifetime and doubled size, for flashes and impacts. |
| F13 | Projectiles were 1-pixel neutral-white slivers, the exact value of the bone material they fly at. | 4 | Warm emissive tracers stretched hard along velocity, sharing the muzzle's hue so flash → tracer → impact reads as one causal chain. |
| F14 | The blueprint bar labelled slots with keyboard digits 1–4 in a controller-first game. | 6 | Slot hints follow the last-used device: D-pad arrows and an L1 hint on a pad, digits on a keyboard. |
| F15 | Modal footers drew on top of the still-live gameplay HUD, colliding text with the blueprint bar. | 6 | The gameplay HUD hides whenever a screen is open. |
| F16 | The whole 3D frame sat in a ~35-code luminance band: measured median 48–52, and a lit corridor at 48.9 against a lit forest floor at 43.5, so the route was separated from the trees by hue alone. | 1, 3, 7 | ACES has a long toe built for photographic highlights and only crushed this palette. Switched to `NeutralToneMapping` and lifted the ground values so the corridor is the brightest large surface in frame. |
| F17 | The end screens showed "March again" twice — once as the focused button and again in the footer hint. | 6 | The footer names the input; the button names the action. |
| F18 | Menus accepted only their own bindings, so a keyboard player pressing E, or a pad player pressing Cross, got nothing on a screen. | 6 | Screens now accept the gameplay confirm and cancel as well as the menu ones. |
| F19 | Every reviewer independently reported that the player was **completely absent** from the `horde` and `pursuit` frames, and a pixel scan for the marker returned zero hits in both. Two separate causes, found by querying the running game rather than by reading the images: the capture staged the engineer 6 m from the spider's centre, which is *inside* a 9.5 m hull, and the always-on-top pip sat at head height (2.5 m) — inside a 4.4 m machine. | 1, 2 | Pip raised above the hull (`SPIDER.bodyHeight + 1.1` = 5.5 m) and enlarged; capture staging moved to 12–13 m so it shows the game as played. Verified by forcing the worst case — engineer at the spider's exact position — and confirming the pip still clears. |
| F20 | `PCFSoftShadowMap` is deprecated in three 0.185 and logged a console warning on every boot, breaking acceptance criterion 21. | 7 | Request `PCFShadowMap` directly, which is what it silently fell back to anyway. Console is now clean on a fresh load: Vite connection messages only. |
| F21 | **Enemies showed no reaction to being hit and left no trace when killed.** A skeleton absorbing a burst rendered identically to an idle one, and a battlefield with two hundred kills was spotless a second later. This was the largest single hole in the game's feedback and was reported by every reviewer. | 4, 1 | Three layers: a white per-instance flash via `BatchedMesh.setColorAt` (so a hundred bodies can flash without a material each), a short positional shove along the incoming shot, and a bounded ring buffer of 72 ground marks that fade over 26 seconds. The flash decays in the simulation, not the render layer, so it is frame-rate independent. Total cost: one extra draw call. |
| F22 | The performance table was measured **with no structures on the field**, a state the game is never in. Re-measuring with six machines, as §12 requires, gave 204 draw calls — over the 180 ceiling. | 7 | Structures no longer cast real shadows; they are grounded by the state ring they already carry plus a contact disc, exactly as the horde is. Worst case 204 → 164, and the caster count is now a constant 54 across every scenario. |
| F23 | The camera framed the spider more than the engineer, so the player could drift toward an edge — and the forward half of the frame, which is where the player is heading, was the half the camera was not watching. | 1, 2 | Rather than reduce the spider's weight and lose the "where is my fortress" read, the focus point is now pulled back whenever the player would leave the middle 62% of the frame. Measured by driving the engineer to the tether limit in all eight directions: he never exceeds 0.19 of the frame from centre, against 0.5 at the edge. R3 also recentres on the player rather than on the weighted point. |
| F24 | The placement preview showed no coverage radius, so the question placement actually asks — "will this reach the thing I am worried about" — could not be answered before spending the scrap. | 1, 6 | A range ring is drawn under the ghost, coloured with the validity state. Suppressed for structures with no reach, since a zero-radius ring would assert something false. |
| F25 | Defeat had no in-world consequence: the screen said "the core is cold" over a spider standing intact with its furnace still lit. | 4 | On core death the furnace goes dark and the machine settles onto its legs. The one state light the spider has now matches what the screen says. |
| F26 | The confirm glyph was a thin mark in a small round chip, which reads as "a ring with something in it" whichever face button it is — ambiguous between Cross and Circle, the two that must never be confused. It was also prefixed to purely informational lines, making them read as error badges. | 6 | Face buttons carry the DualShock's own colour coding and a larger, bolder mark. Informational prompts drop the glyph entirely; it is reserved for a button plus a verb. |
| F27 | Distant impostor enemies used a cheaper Lambert material than the articulated puppets, so the horde had a visible seam where far enemies read paler and flatter. | 3 | Impostors use the same lit material. It saved almost nothing — impostors are three draw calls for the entire rear horde. |
| F28 | Dropping a carried machine was refused outright if the exact spot ahead was occupied. During the one action the whole loop is built around, "no" without a remedy is pure friction. | 1 | A short outward spiral finds the nearest legal spot, alternating either side of the player's facing so the result stays where they were looking. Covered by an integration test. |
| F29 | Structures showed *that* they were starving, through ring colour, but never *how long they had* — and remaining service time is the number the entire leapfrog decision turns on. The only duration cue was a 3-pixel slit on the turret face. | 1, 4 | The ground ring became a countdown arc over a dim track: full while served, sweeping down from the top while running on its own buffer. Geometry is rebuilt only when the quantised reading changes. |
| F30 | Two of four blueprint names were ellipsis-truncated at both viewports, and two of the four slot hints were a middle dot that meant nothing. | 6 | Blueprints carry a short name for the bar; the inner slots show nothing rather than a mark with no meaning. |
| F31 | **Pursuit graded in screen space.** Measured: the ground at frame centre was byte-identical to its unthreatened colour while the same material further out was red — one asset rendering as two materials in a single frame, because the grade was fog and fog is depth. | 3 | The mood now drives the fill, ambient and hemisphere lights and the exposure, so the shift is global. The key light is deliberately left alone: moving it would change which faces are lit and break the silhouette read. Eased against elapsed time rather than per call, which also makes it visible in a capture. |
| F32 | Tracers read as detached from any shooter — three reviewers said so independently. They were not orphans; they were spent rounds at the end of their flight, rendering exactly as brightly as one leaving the barrel. | 4 | Tracers fade and shorten with remaining lifetime, keeping the bright end near its muzzle. |
| F33 | On the modal screens the focused card was marked by a thin bar while the unfocused ones each carried a full outline — focus quieter than non-focus, in a game with no cursor. | 6 | Unfocused options recede; the focused one lifts, scales and takes a doubled accent outline. |
| F34 | A dead-straight boundary bisected the ground. I "fixed" this twice by misdiagnosis — first as the terrain strip's lateral edge, then as the shadow frustum — before testing properly. | 7 | It was the strip's *longitudinal* end, where the segment stops. The ground now runs 120 m past both ends, extrapolated along the end tangent. The shadow-box and strip-width changes made along the way were real improvements and were kept. |
| F35 | The run summary showed "0NMARCH" for a run seeded IRONMARCH, which reads as a bug. | 7 | It was not one — a seed is 32 bits and that is the correct canonical form, which reparses to the same run (verified). But it looks wrong, so the original typed string is now carried through and displayed. |
| F36 | Last Shot — the game's signature "abandon" moment, one of its four verbs — had no presentation beyond a coloured ring. Reviewers put this at the top in both rounds. | 4 | A countdown arc on the doomed machine, escalating jitter and swell as it runs down, steam vents, a HUD banner and an off-screen world marker so it is never detonated out of sight. |
| F37 | No gameplay frame told the player that Square services and Triangle recovers. The bindings existed and worked; nothing on screen said so. | 6 | A secondary prompt strip beside the primary action prompt, populated from the same per-button resolution the input system uses, so it cannot drift from the real bindings. |
| F38 | Scrap and fuel were unmarked 8–13 pixel props — half the reviewers' readability case. | 1 | Glow discs under every pickup, tinted by resource type. |
| F39 | Adding F36's countdown arcs and F38's glow discs pushed draw calls to 186, past the 180 ceiling. | 7 | Generalised `HordeBatch` from puppets to any hierarchy (`acquireRoot`/`updateRoot`) and moved structures onto it. A turret has a skeleton's problem: independent joints, one shared material. 186 → 151. |
| F40 | The ghost coverage ring I added for placement rendered as an enormous bright arc across half the frame — it used the shared additive VFX material, so it became the brightest thing on screen and swamped the placement decision it exists to inform. My own regression, caught in the next capture. | 1, 2 | A dedicated dim material at 0.3 opacity and a 1%-thick ring. The radius was verified against `getStructureConfig(kind).range` — it is honestly 13.5 m, so the geometry was never the problem, only the volume. |
| F41 | Victory and defeat shared one layout; only the eyebrow, title and subtitle colour differed. Recolouring is not framing. Closes O8. | 4 | Structural divergence. Victory sits high and centred behind a thin veil that still shows the ground you crossed, lit from the bottom edge, rule wide and bright, stats capped in brass, and it rises in. Defeat drops to the bottom of the frame behind a veil heavy enough to lose the world in, collapses left against a red spar, its rule severed rather than drawn, stats dimmed and edged red, and it settles downward. |
| F42 | The 1280×720 capture set was not a 720 set. `scripts/capture.mjs` parsed only `--flag=value` and silently skipped anything else, so `--width 1280 --height 720` was discarded and the run wrote full-size images into the directory named for 720 — under filenames that stated 1920×1080, beside genuine 720 files, in the folder this document cites as its small-viewport evidence. | 7 | The parser now accepts both forms and throws on an unknown flag or a missing value. The mislabelled images were deleted and the set re-shot; all ten scenarios now exist at both viewports. |
| F43 | **One CSS mistake, three defects.** `@keyframes hud-pulse` animated `transform: scale()`. A keyframe that sets `transform` replaces the whole property and outranks both inline styles and the element's own rule — so it silently annihilated the positioning of everything it was applied to. Every Last Shot marker is flagged urgent, so the label naming the machine about to detonate was pinned to pixel (0,0) **every time**; and the Trail panel, centred by `translateX(-50%)`, jumped 210 px right on entering PURSUIT, the one moment the player most needs to find it. Three reviewers found this independently. | 2, 4, 6 | `hud-pulse` now animates brightness only, with a separate `hud-pulse-scale` for the one element that owns no transform. Verified after: the Trail panel centres at 974 in Pursuit against 978 in every other state. |
| F44 | World markers were centred exactly on the projected point of the thing they name, hiding the machine the player is being told to look at. | 1, 2 | Lifted 22 px clear of the anchor. |
| F45 | **The screen-space Pursuit grade, found for the third time in a third place.** F31 moved it out of the fog and into the lights and recorded it as fixed. A reviewer isolated a `.flash--pursuit` DOM overlay that was still doing most of the work: +7 red at frame centre and +73 to +79 at the corners, a ten-to-one difference decided purely by where the camera put a surface. Separately the light grade itself, lerping ambient 0.65 toward a pure red, raised ambient red 17× while cutting ambient blue to 0.6× — and the cold fill is exactly what separates a bone-white skeleton from brown ground. Measured: bone-vs-ground Weber contrast 0.656 → **0.038**, with body and ground pixels coming out byte-identical; treeline-vs-corridor separation 28 → **3**; readable foliage 47% of the playfield → **0.9%**. In the frame where the player is running for their life, nothing was distinguishable from anything. | 1, 3, 7 | The overlay is now a faint border vignette (18% at the edge, from 58% out) and no longer the grade. The mood target is desaturated 40% toward white before it is used as a light colour, so the hue shifts without any channel being crushed, and the weights drop to 0.22/0.24/0.15. The mood is also distributed across the whole Trail ramp rather than spent at HEAVY and PURSUIT, since a reviewer measured the entire 0–93 threat range as moving the ground by less than one just-noticeable difference. Verified after: separation **17.0**, and corner-minus-centre red **−25**, in line with every other frame. |
| F46 | The player's ring, the placement ghost ring and an unpowered structure's ring are declared as three different hues in `palette.ts` and all rendered as the same yellow. Additive blending adds the ring colour to lit ground, which saturates red and green to 255; only the blue channel survived, at a size where it is not a cue. In the placement frame, "you are here" and "the turret goes here" sat 40 px apart in the same colour. | 1 | A `ringDecal` material — normal blending, high opacity, still unlit and unfogged — for ground decals whose job is to mean one specific thing. Genuine glows and impacts keep additive. |
| F47 | Two ground indicators were below the 3:1 non-text floor: the turret coverage preview at **1.57–1.82:1**, and the spider's service boundary — the primary spatial constraint on every placement decision — at **1.97:1**. The coverage ring was mine, dimmed to 0.3 in F40 to stop it dominating the frame; that was the right diagnosis and an overcorrection into unreadable. | 1 | Both are now subordinate by *weight* rather than by dimness: thin rings at proper opacity. |
| F48 | Last Shot had no countdown anywhere in the HUD. The fuse exists in the simulation and the machine carries a sweeping arc, but that is only readable while it is on screen — and the marker exists precisely for the case where the player has already walked away. The HUD model carried no time field at all, so nothing *could* render one. | 4 | `secondsRemaining` added to the left-behind model and rendered on the marker to one decimal. |
| F49 | HUD text measured 6–8 px cap-height at 1280×720 and 9 px at 1920×1080 across most of the interface — every panel label, the blueprint names, the footer hints. The type scale's comment claimed 720 stayed "as legible as" 1080; it was the clamp minimums that decided it, and they were set for a screen much closer than a game is played from. | 6 | Floors raised: `--fs-tiny` 10 → 13 px, `--fs-small` 11 → 14, `--fs-body` 12 → 16, `--fs-num` 14 → 17. Also lifted the Trail state word, which measured 3.59:1, via a text-only variant of the accent so the world grade keeps the original. |
| F50 | Unselected option cards measured **1.04:1** fill against the modal backdrop, so the alternatives in a route or upgrade choice did not read as discrete selectable cards. Unaffordable blueprints were dimmed to 0.42, dropping the name to 2.22:1 and the cost to 1.88:1 — illegible exactly when the player needs to know what the thing is and how much more scrap it wants. And the engineer's own health bar had no low state at all: identical colour at 100/100 and 74/100, while the *spider's fuel* gauge blinked. | 1, 4, 6 | Cards lifted well clear of the ground; unaffordable is now marked by a red cost and a muted body rather than by dimming the whole chip; health gains a low state below 35%. |
| F51 | **Three animation defects that no capture could ever have shown.** Every gait was computed as `elapsed_time × cadence`, where cadence is a function of current speed — so the real angular velocity carried an error proportional to how long the run had lasted. Every speed change teleported the gait: 2.35 radians five minutes in, and the spider, whose speed is an unsmoothed step function, jumped about ten complete cycles per gear change and snapped all eight legs to zero at every dock. The Last Shot fuse had the same bug, so its "beat quickens as it burns down" was instead an aliased strobe whose apparent rate depended on when in the run it fired. Separately, distant enemies animate on a 2- or 4-frame stride while their transform is written every frame, and that write zeroes root Y — so the spawn rise strobed for the entire visible spawn band, 100% of the time. | 5, 7 | All phases are now integrated and wrapped, and the posed root height is published for skipped frames to reapply. `tests/animation.test.ts` pins all three: reverted against the old formulation the tests fail with a 2.35 rad jump and an unbounded phase of 4326, which is how I know they are load-bearing rather than decorative. |
| F52 | Four keyboard prompts named keys that did something else: tool and recenter were transposed, focus fire advertised Shift (which is overdrive), and overdrive advertised "1" (bound to nothing). The pause screen rendered a chip reading "OPTIONS" because an unknown token silently fell through to uppercased text in a pill sized for two characters. | 6 | Table corrected, token fixed, unknown tokens now warn in development, and `tests/ui.test.ts` asserts every prompted glyph against the actual binding table. |
| F53 | The HUD grew. F49 raised the type-scale floors after a reviewer measured 6–8 px cap heights, but below a 1080-tall window the vmin term falls under the floor, so the floor alone sets the size — panels grew 20–33% and started eating the playfield. Reported by the user, who was looking at the actual game rather than at a capture. | 2, 6 | Floors set between the two failures (tiny 13→11, small 14→12, body 16→13, num 17→14), and the *footprint* trimmed harder than the text, since panel area is what blocks the view: padding, gutters and bar heights reduced, and every panel narrowed — the Trail panel from 420 to 340 px maximum, because it sits centred at the top of the frame, which is exactly where the horde arrives from. |
| F54 | `scripts/capture.mjs` wrote a full set of screenshots of the browser's "can't reach this page" error and reported "10/10 captures written". Headless Chromium screenshots whatever is on screen, and with no dev server running that is the connection-error page — right size, renders fine, counted as success. Harness bug number five, and the fifth to fail silently rather than loudly. | 7 | A preflight that fetches the URL before shooting anything and throws unless the response is the game's own page (checked by the presence of its canvas element). |
| F55 | **The feet skated.** Cadence (`4.2 + n·5.4`) and hip amplitude (`0.82·stride`) were tuned independently, so a foot's arc on the ground never matched the ground travelled. Computed against the recorded march take at the engineer's real 5.5 m/s: the ground moved **24% further per cycle than the feet did**; at a 1 m/s walk, **106%**. Nobody had watched it move; the round-3 reviewer predicted this from the code and was right. | 5 | Cadence is now physical: `2π · speed / STRIDE_LENGTH`, with the stride length derived from the pose (`2 · 2 · LEG · sin(HIP_SWING)`) rather than tuned, and the hip held at the amplitude that stride assumes whenever the character is moving. Slip is identically zero at every moving speed; a floor of 1.2 rad/s keeps a creep from freezing and costs slip only under 0.55 m/s. Pinned by a test that asserts ground-per-cycle equals foot-arc-per-cycle to 1% at four speeds. Cadence now goes by absolute metres, so a golem and a minion at the same fraction of their own top speed no longer swing identically; the run *lean* still follows effort. |
| F56 | `player.tethered` was emitted **every fixed step** the engineer was past the leash - sixty times a second - and every one raised a two-second toast. Whenever anything moved the spider (a checkpoint, capture setup, the perf harness), the player was momentarily "too far" and the four-slot toast stack filled with copies of one warning, evicting anything else, a Last Shot warning included. Found in **frame 0 of the recorded march take**, three stacked "Too far from the spider" over an engineer standing right beside the machine. | 4, 6 | The event fires on the *edge*: once when the leash goes taut, again only if it slackens and re-tightens (a dropped payload is always announced, since it can only happen once per carry). And the toast layer now refreshes a message already showing rather than stacking it, so any per-step emitter in future degrades to one persistent toast instead of a flood. |
| F57 | "BARRICADE" truncated to "BARRIC..." in the blueprint chip on a 1280-wide window - the chip was 6.4vw = 82 px and the name at the 11 px floor with its tracking wants about 88. Also visible in that same frame 0. | 6 | Chip minimum raised to 72 px and vw to 6.8, sized to the longest name at the smallest type. |

---

## 5. Open defects

Known and not yet fixed. None is priority one; each is a reason a category sits
at 4 rather than 5.

| # | Priority | Defect | Category | Proposed fix |
|--:|---|---|---|---|
| ~~O1~~ | — | **Fixed — see F21.** | 4 | — |
| ~~O2~~ | — | **Fixed — see F23.** | 1, 2 | — |
| ~~O3~~ | — | **Fixed — see F24.** | 1, 6 | — |
| ~~O4~~ | — | **Partly fixed — see F25.** Defeat now has an in-world consequence; the two screens still share a layout. | 4 | Give victory and defeat distinct framing, not just a different eyebrow colour. |
| ~~O5~~ | — | **Fixed — see F26.** | 6 | — |
| ~~O6~~ | — | **Fixed — see F27.** | 3 | — |
| ~~O7~~ | — | **Fixed — see F28.** | 7 | — |
| ~~O8~~ | — | **Fixed — see F41.** | 4 | — |
| O9 | P2 | Beyond `maxFullAnimationEnemies` (64) an enemy is an impostor: a frozen stride pose translated across the ground, with a squash that runs at a constant rate whether the enemy is sprinting or standing still. At 241 enemies that is roughly three quarters of the horde sliding. | 5 | Drive the impostor squash from real speed; raise the puppet budget, which the draw-call margin can now afford. |
| O10 | P2 | Structure fold is dead code. `StructureVisual.folded` is never written and `WorldView` passes a literal `0`, while `AnimationSystem` implements the whole fold. Recovery is one of the four verbs and has no animation. | 5 | Pass the real fold progress from `stateTimer`. |
| O11 | P2 | The engineer's body measures 1.45:1 against the ground — the lowest-contrast actor in the frame — so his ground ring carries all of the locating burden. | 1 | Raise the coat's luminance separation rather than only its hue. |
| O12 | P2 | Action poses pop in and out: attack recovery snaps the torso about 0.5 rad on the frame the timer expires, and `shoot` writes absolute arm angles on the first frame. | 5 | Blend the action pose against the locomotion pose over ~80 ms in and ~120 ms out. |
| O13 | P2 | The settings screen is unreachable: `ScreenManager.onAdjust` is declared and invoked but never assigned, and nothing opens the screen. Dead zone, vibration and volume cannot be changed in play. | 6 | Wire the handler and add a route to it from the pause screen. |
| O14 | P3 | VFX pool exhaustion is reported as 0, but saturation drops the newest silently and is never counted, so the metric cannot fire. Projectile, pickup and VFX peak occupancy are unmeasured. | 7 | Count saturation drops; report peaks per scenario. |
| O15 | P3 | This document asserts SwiftShader output is identical to a GPU's except in speed. That has never been tested, and every colour finding above depends on it. | 3, 7 | Capture one frame on a real GPU and diff it. |

O1 through O8 — every defect from the first two review rounds — are closed. O9
through O15 are what the third round left, and all but O14 and O15 concern
motion or interaction rather than anything a still frame can settle.

---

## 6. Current scores

**These are the third review round's verdict, not a self-assessment.** Two
earlier rounds each found defects I had looked straight at and missed, so the
scores here come from four independent reviewers working from the frozen capture
set, each given two rubric categories and each required to measure rather than
look. Their findings are recorded in §4 as F43–F52.

Round 3 ran against the set produced after F36–F42. Every P1 it raised has since
been fixed and both capture sets re-shot; the "Now" column states what changed
since they scored, with the measurement that supports it.

| # | Category | Round 3 verdict | Now | What changed, and the evidence |
|--:|---|--:|--:|---|
| 1 | Gameplay readability | 3 | **4** | The three rings that all rendered as the same clipped yellow now hold their declared hues (F46); the coverage ring and the spider's service boundary are back above the 3:1 floor (F47). Reviewers confirmed the engineer's marker at 7.33–9.52:1 and clean scrap/fuel separation. What holds it at 4 rather than 5: the engineer's own body is still the lowest-contrast actor in frame at 1.45:1, with his ground ring carrying the load. |
| 2 | Composition and camera | 2 | **4** | Both P1s were one root cause and are fixed (F43). Measured after: the Trail panel centres at 974 in Pursuit against 978 elsewhere — it was 210 px off. Markers now sit above their subject rather than on it (F44). The camera itself was never the problem; reviewers measured zero enemy pixels in the frame-edge strips. |
| 3 | Visual cohesion | 3 | **4** | The Pursuit grade no longer inverts the palette's own stated rules. Measured on the current frame: treeline-vs-corridor separation 3.0 → **17.0**, against 19 for the horde frame and 28 for the quiet march (F45). Bone bodies separate from the ground again. |
| 4 | Feedback and impact | 3 | **4** | The Last Shot marker reaches its machine instead of the screen corner, and now carries the fuse in seconds (F48) — previously no time value existed anywhere in the HUD model. The engineer's own health finally has a low state (F50). |
| 5 | Animation and motion | 2 | **3** | Three P1s fixed at the root and pinned by ten new tests (F51). This is deliberately **not** scored 4: the reviewer's remaining findings — impostors that slide rather than animate, fold animation that is dead code, action poses that pop — are real and open, and nobody has yet watched this game move. |
| 6 | HUD and controller UX | 2 | **4** | Text was 6–8 px cap-height at 720p across most of the HUD and is now 13 px minimum (F49). Four keyboard prompts named keys that did something else, and are now correct and unit-tested (F52). Option cards measured 1.04:1 against their own backdrop and now read as cards. |
| 7 | Technical presentation | 3 | **4** | The screen-space grade was found for the third time, in a third place, and is finally out of the frame's geometry: corner-minus-centre red went from about +75 to **−25**, in line with every other frame (F45). Reviewers independently confirmed 0.00% clipped pixels, no banding, no z-fighting, no missing assets, and that the old straight ground line is genuinely gone. |

**Gate: does not pass, on one category.** Six of seven now stand at 4. Category 5
sits at 3 and is not being scored higher, because its remaining defects are known
and unfixed, and because neither a still image nor a unit test can certify what
that category is actually about.

That is still a real result: the build went from an independently-assessed 2.4,
to 3.1, to six-of-seven at 4, across three rounds in which every score was set by
someone other than whoever wrote the code.

### What the third round taught, which is not what the first two did

Rounds one and two taught that I eyeball and reviewers measure. Round three
taught something sharper, and it is worth stating plainly because it generalises
better:

- **"It cannot be certified from stills" became a reason to stop looking.** §6
  previously scored animation a 3 on the grounds that stills cannot judge motion.
  That was true, and it was not a reason to score anything. A reviewer read
  `AnimationSystem.ts` — 430 lines — and found three defects in under an hour,
  none needing a video, all of them arithmetic. The category had been scored on a
  system nobody had checked by *any* means. An honest account of why one tool
  does not work is not a substitute for picking up another.
- **The same defect was found three times in three places.** The Pursuit grade
  was screen-space in the fog, then screen-space in the lights, and then — after
  I had recorded it as fixed — screen-space in a DOM overlay that had been doing
  most of the work the whole time. Each fix was real. None was followed by a
  search for other instances of the same mistake.
- **One CSS misunderstanding caused three separate defects.** A keyframe that
  animates `transform` replaces the property outright, so it destroyed marker
  positioning and Trail panel centring; the identical trap with `opacity` was
  running the Pursuit vignette at up to twice its authored strength. Three
  reviewers found three symptoms of one three-line bug.
- **Documents drift into contradiction and go on sounding confident.** A reviewer
  noticed that §4 recorded the pickup markers, the prompt strip and the Last Shot
  presentation as fixed while §6 and §7 still described all three as missing. It
  was the correction pass that had gone stale, and nothing in the writing gave
  that away.

---

## 7. What to do next

Everything raised by the first two rounds is closed. This is what round three
left, in priority order.

1. **Watch it move.** Still the root blocker, and now the only thing between
   category 5 and a 4. There is no motion tooling in the repository at all — no
   `.mp4`, no `.gif`, no screencast path. `scripts/perf.mjs` already drives the
   browser over the DevTools protocol, which exposes `Page.startScreencast`; the
   capability is one small script away and has never been written.
2. **Most of the horde does not animate.** Beyond `maxFullAnimationEnemies` (64)
   an enemy is an impostor: a frozen stride pose translated across the ground
   with a constant-rate squash that does not stop when the enemy does. At the
   241-enemy stress figure that is roughly three quarters of the horde sliding.
   The draw-call budget has 29 spare and the batch is one call regardless of
   instance count, so raising the budget is cheap; driving the impostor squash
   from real speed is cheaper still.
3. **Structure fold is dead code.** `StructureVisual.folded` is never written and
   `WorldView` passes a literal `0`, while `AnimationSystem` implements the whole
   fold. Recovery is one of the four verbs and it has no animation.
4. **The engineer's body is the lowest-contrast actor in the frame**, at 1.45:1
   against the ground, which puts the entire locating burden on his ground ring.
5. **Action poses pop.** Attack recovery snaps the torso about 0.5 rad on the
   frame the timer expires, and `shoot` snaps the arms to absolute angles on the
   first frame. Both want a short blend in and out.
6. **The settings screen is unreachable.** `ScreenManager.onAdjust` is declared
   and invoked but never assigned, and nothing opens the screen. Dead zone,
   vibration and volume cannot be changed in play — in a pad-only game.
7. **Measure and publish peak pool occupancy.** VFX exhaustion is reported as 0,
   but saturation drops the newest silently and is never counted, so that metric
   is shaped so it cannot fire. Projectile, pickup and VFX peaks are unmeasured.
8. **Verify colour on a real GPU.** §1 asserts that SwiftShader's output matches
   a GPU's in everything but speed. That has never been tested, and every colour
   finding in §4 rests on it.
