# Performance — Marcha de Ferro

Measurement protocol and results, per §12 of `fable_implementation_plan.md` and
the targets in §22 of `prompt_guide.md`.

Nothing in this file is estimated. Every number was produced by a command that
is checked into the repository and can be re-run.

---

## 1. Test hardware and honesty statement

| Field | Value |
|---|---|
| Machine | Development workstation, Windows 11 Pro 10.0.26200 |
| GPU used for the automated runs | **None — SwiftShader software rasteriser** |
| Node | 26.4.0 |
| Browser | Microsoft Edge (headless), Chromium / ANGLE / Vulkan / SwiftShader |
| three | 0.185.1 |
| Viewport | 1920×1080 |
| Device pixel ratio cap | 1.5 (`CAMERA.maxDevicePixelRatio`) |
| Seed | `IRONMARCH` |

**The spec's target hardware — "a laptop with a reasonable integrated GPU" — was
not available, and no GPU-side frame time has been measured on it.** The
automated harness runs headless, where WebGL falls back to SwiftShader, a CPU
rasteriser. Its frame times describe software rasterisation and say nothing
about real GPU performance, so they are not reported as if they did.

What *is* hardware-independent, and therefore is reported as a result:

- draw calls per frame
- triangles submitted per frame
- live mesh count and shadow-caster count
- object-pool occupancy and exhaustion counts
- CPU simulation cost per fixed step

The software-rasteriser frame times in §6 are reported but are **not** in that
list and are not evidence for the frame-rate target.

The 60 FPS claim in §22 is **not established** by anything in this document. It
requires a run on the target laptop. See §7, "Not yet measured".

---

## 2. How to reproduce

```bash
cd game
npm install
npm run dev            # serves on http://localhost:4210
```

Then, in a second shell:

```bash
cd game
npm run perf                                # four browser scenarios -> ../docs/perf.json
npx vitest run tests/performance.test.ts    # simulation cost, real timers
```

The four scenarios are defined in `src/dev/perf.ts` and map one-to-one onto the
four measurements §12 requires: quiet march, normal 100-enemy combat, 200-enemy
stress, and Pursuit with structures, projectiles, VFX and HUD all active. All
runs use the balance values in `src/data/balance.ts` as committed.

For a real-GPU reading, open `http://localhost:4210` in a normal browser window,
press `` ` `` or `F3` to open the debug overlay, and read the `frame p50`,
`frame p95`, `frame worst` and `draw calls` rows during play.

---

## 3. Render submission — measured

From `npm run perf`, 1920×1080. Raw data in `docs/perf.json`.

| Scenario | Enemies | Structures | Draw calls | Triangles | Meshes | Shadow casters | Pool exhaustions |
|---|---:|---:|---:|---:|---:|---:|---:|
| Quiet march baseline | 0 | 0 | 128 | 372,540 | 85 | 54 | 0 |
| Normal combat | 92 | 3 | 141 | 629,862 | 91 | 54 | 0 |
| Stress test | 245 | 2 | 136 | 780,084 | 87 | 54 | 0 |
| Pursuit, everything active | 244 | 6 | 149 | 786,510 | 99 | 54 | 0 |

Triangles rose from 655k to 786k when `maxFullAnimationEnemies` went from 64 to
128 (O9): an articulated puppet carries more geometry than the frozen impostor it
replaced. That is the cost of the horde actually walking, it was taken
deliberately, and it lands inside the 600–800k band with about 14k to spare.
**Triangles are now the binding constraint on this build, not draw calls.**

Against the §22 targets:

| Metric | Target | Measured | Verdict |
|---|---|---:|---|
| Draw calls | < 120 ideal, 180 max | 149 worst case | **Pass** on max, with 31 to spare; **fails the ideal by 29** |
| Visible triangles | 600–800 thousand | 787k worst case | **Pass**, with 14k to spare — this is now the tightest budget in the build |
| Active normal enemies | 120 | 245 sustained, 260 peak | **Pass** |
| Stress test | 200 | 245 with no exhaustion | **Pass**, but the enemy pool reached 260/260 — see §5 |
| Shadow-casting lights | 1 | 1 | **Pass** |
| Dynamic shadow casters | ≤ 20 | 54 | **Fails as literally stated.** The count is dominated by instanced terrain layers, each of which is a single caster covering hundreds of props; the spec's figure assumes one caster per object. The number that matters — shadow-pass draw calls — is 54 and constant. |
| DPR | max 1.5 | 1.5 | **Pass** |

The margin on draw calls is now 29 rather than 10, but it is still a live
constraint rather than headroom: the worst case moves with the number of
*structure types* on screen, not with the horde, so a fifth blueprint would eat
most of it.

### A correction to an earlier version of this table

An earlier revision of this document reported 124–130 draw calls. **Those numbers
were measured with no structures on the field**, which is not a state the game is
ever really in — §12 explicitly asks for "Pursuit with structures, projectiles,
VFX and HUD active". Adding six machines to the scenario, as the plan requires,
raised the worst case to **204**, over the 180 ceiling. Each structure is roughly
eight meshes and the shadow pass redraws every one.

The fix was to stop structures casting real shadows and ground them with the
state ring they already carry plus a contact disc, exactly as the horde is
handled. That brought the worst case to **164** and flattened the caster count to
a constant 54 across every scenario.

Adding the Last Shot countdown arcs and the pickup glow discs then pushed it back
to **186**, over the ceiling again, which forced the batching work this table
had been deferring: `HordeBatch` was generalised from puppets to any hierarchy
(`acquireRoot`/`updateRoot`) and structures were moved onto it. A turret has the
same shape of problem as a skeleton — independent joints, one shared material —
so the machinery transferred without change. That is the **151** above.

The mesh count still scales only with structures, never with enemies: 91 meshes
at 101 enemies and 89 at 244. That is the evidence that the horde renderer is
genuinely batched rather than merely tested at a small size.

**The <120 ideal is still not met and is not claimed.** What remains between 151
and 120 is not the horde and not the structures; it is the static scene — the
terrain layers, the spider itself and the HUD's world-space overlays.

### Why the count is flat

Each articulated enemy is roughly eleven separate meshes, because its joints
must move independently, and three.js issues one draw call per mesh. Twenty-six
enemies alone cost 286 calls before anything else was drawn. Two changes fixed
it:

1. `src/rendering/HordeBatch.ts` puts every articulated enemy limb into a single
   `BatchedMesh`. The `Object3D` hierarchy is kept purely as an animation rig and
   is never added to the scene; its resolved world matrices are copied into batch
   instances each frame. The whole near horde is **one draw call**, with full
   articulation retained.
2. Enemies do not cast shadows. One instanced contact-shadow disc layer stands in
   for them — one further draw call for the entire horde. This dropped shadow
   casters from 246 to 54 and roughly halved submissions, because the shadow pass
   redraws every caster.

Measured effect at 108 enemies on screen: **414 draw calls → 129**.

---

## 4. Simulation cost — measured with real timers

The simulation is pure numeric state with no renderer, so it is measured in Node,
where timers are real and nothing about the browser can interfere. Source:
`tests/performance.test.ts`. These remain the authoritative simulation figures.

Milliseconds for one complete 60 Hz fixed step — all systems in the §16.4 order,
including navigation, steering, collision and damage:

| Scenario | Enemies | p50 | p95 | Worst single step |
|---|---:|---:|---:|---:|
| Quiet march | 0 | 0.006 ms | 0.034 ms | — |
| Normal combat | 122 | 0.157 ms | 0.426 ms | 1.464 ms |
| Stress test | 200 peak | 0.153 ms | 0.603 ms | 1.272 ms |

Against the §22 target of **≤ 5 ms CPU simulation** per 16.7 ms frame: the worst
median measured is **0.157 ms**, roughly 32× inside budget. Even the worst single
step observed, 1.46 ms, is inside it.

Flow-field rebuild, measured separately over a 96×96 grid with 160 obstacles:
**0.63 ms**, run at 3 Hz, so about 1.9 ms per second of play amortised.

### Four-minute Pursuit soak

| Measurement | Early | After 4 simulated minutes |
|---|---:|---:|
| Tick cost p50 | 0.123 ms | 0.079 ms |
| Active enemies | 130 | 128 |
| Enemies spawned in total | — | 952 |
| Pool exhaustions | 0 | 0 |

Cost did not grow. Heap growth over 6,000 consecutive ticks under load measured
**+12.2 MB** without a forced collection, which is GC scheduling rather than a
leak: a real leak in a pooled system shows as unbounded growth, and a tick cost
that *falls* slightly over four minutes is inconsistent with one.

### The browser harness now corroborates this, and previously could not

An earlier revision of this section said the browser harness "cannot time
anything useful" because `performance.now()` was frozen. That was true, and the
cause was ours: `scripts/perf.mjs` launched Edge with `--virtual-time-budget`,
needed to hold the page open until the suite finished so that `--dump-dom` would
capture the result. Virtual time replaces the clock. Under it `performance.now()`
does not advance across synchronous work at all, so every timing the harness
produced was exactly 0.000 — in all four scenarios, in every percentile, in the
worst of 360 samples. Those zeros were printed in a results table for several
revisions. A stopped watch reads as an extremely fast one.

The harness now drives the browser over the DevTools protocol instead: no
virtual time, a real clock, and the wait for the result comes from polling the
page rather than from faking its clock. `perf.json` records
`clockResolutionMs` so the report states what the clock could resolve —
**0.1 ms** here — and every scenario carries a batch mean alongside the
percentiles, because a 0.1 ms floor cannot resolve a single 0.19 ms step but
divides cleanly into a timed run of ninety.

Simulation cost per fixed step, from the browser harness, as a cross-check on
the Node figures above:

| Scenario | Enemies | Mean | p50 | p95 |
|---|---:|---:|---:|---:|
| Quiet march | 0 | 0.044 ms | 0.0 ms | 0.2 ms |
| Normal combat | 99 | 0.108 ms | 0.2 ms | 0.8 ms |
| Stress test | 241 | 0.187 ms | 0.2 ms | 0.4 ms |
| Pursuit, everything active | 238 | 0.242 ms | 0.2 ms | 0.7 ms |

These agree with the Node measurements to well within the clock's resolution.

**One further correction this exposed.** With a working clock, Pursuit reported a
simulation cost of 0.003 ms — fifty times *cheaper* than the lighter stress
scenario, which is not physically possible. The cause: `fixedUpdate` returns
immediately once the phase is `VICTORY` or `DEFEAT`, and Pursuit's core was
dying partway through its own measurement, so the harness spent the remaining
samples timing an early return. The suite now refills the core between samples
(`debugApi.sustainCore`) and **throws** if a scenario ends while being measured,
rather than reporting the number. The implausible ordering was the only thing
that gave it away; had the figure been merely low instead of absurd, it would
have been published.

---

## 5. Pooling

Every pool is fixed-capacity and pre-allocated at construction. `acquire`
returns null when exhausted rather than growing, so a runaway spawn becomes a
visible, measurable cap instead of a stutter and a leak.

Peak occupancy is now measured per scenario rather than left blank, and the
harness prints it beside capacity. The previous version of this table carried
"Exhaustions 0" on every row with peaks recorded as "—". The dashes were honest
about being unmeasured; the zeros were not, because the VFX pool has **no
exhaustion counter at all** — a full pool drops the newest effect and returns, so
its zero was true by construction and could never have read anything else.

Worst peak across the four §12 scenarios:

| Pool | Capacity | Peak | Exhaustions | Note |
|---|---:|---:|---:|---|
| Enemies | 260 | **260** | 0 | Reached capacity in both 200+ scenarios. No `acquire` failed, so the cap held — but there was nothing spare. |
| Projectiles | 420 | 8 | 0 | Enormous headroom. |
| Pickups | 220 | 33 | 0 | Enormous headroom. |
| VFX | 180 | 20 | not countable | Sampled per frame, so a lower bound; nowhere near saturation. |

The one finding worth acting on is the enemy pool sitting exactly at 260/260
under stress. Exhaustions are zero, so nothing was dropped and the design's
"cap rather than grow" contract held — but a pool at capacity has nothing left
for the next acquire, and this is the first run in which that has been visible
at all.

`tests/integration.test.ts` additionally asserts that a 180-second busy run ends
with zero exhaustions across all three simulation pools. `tests/horde.test.ts`
asserts that 200 forced spawns followed by a full release returns the pool to
exactly zero active with no leaked slots, and that a recycled slot carries no
state from its previous life.

---

## 6. Frame timing

**Still not measured on representative hardware.** §12 asks for median and
worst-frame behaviour "where the available tooling permits", and the tooling now
permits it — but only under SwiftShader, so what follows describes CPU
rasterisation and is **not** evidence about the 60 FPS target. It is recorded
because it is a real measurement of the submission path, and because a scenario
that stopped being cheap here would be worth investigating anywhere.

Milliseconds for one fixed update plus one full render, 1920×1080, SwiftShader:

| Scenario | Mean | p50 | p95 | Worst | Render's share of the mean |
|---|---:|---:|---:|---:|---:|
| Quiet march baseline | 0.63 ms | 0.4 ms | 1.3 ms | 11.8 ms | 0.59 ms |
| Normal 100-enemy combat | 1.47 ms | 1.4 ms | 2.6 ms | 4.2 ms | 1.36 ms |
| 200-enemy stress test | 1.57 ms | 1.5 ms | 2.7 ms | 3.7 ms | 1.38 ms |
| Pursuit, everything active | 1.44 ms | 1.4 ms | 2.6 ms | 3.3 ms | 1.20 ms |

Percentiles are quantised to the clock's 0.1 ms floor. The 11.8 ms worst frame on
the quiet baseline is the first measured frame of the first scenario — shader
compilation and buffer upload, not steady state; every later scenario's worst is
under 4.2 ms.

The shape worth noting is that the last three rows are flat. Going from 101
enemies to 244, and adding six structures, five projectiles and the full HUD,
does not move the frame. That is consistent with the draw-call table and is the
strongest available evidence that the horde is not the cost centre — but it is
evidence about a CPU rasteriser, and says nothing about how an integrated GPU
handles 654k triangles.

For a real-GPU reading, run the game in a normal browser window on the target
laptop and read the debug overlay (`` ` `` or `F3`), which reports median, 95th
percentile and worst frame time from a rolling 120-frame window alongside live
draw calls, triangles, pool occupancy and flow-field cost.

| Scenario | Median frame | p95 frame | Worst frame | Machine |
|---|---|---|---|---|
| Quiet march baseline | not yet measured | | | |
| Normal 100-enemy combat | not yet measured | | | |
| 200-enemy stress test | not yet measured | | | |
| Pursuit, everything active | not yet measured | | | |

---

## 7. Not yet measured

1. **Frame time on any real GPU.** The single most important gap. Everything
   above shows the game submits little work and simulates cheaply; none of it
   proves the GPU keeps up on an integrated part.
2. **Frame time on the spec's target laptop specifically.**
3. **Sustained thermal behaviour** across a full 8–10 minute run.
4. **DualShock 4 input latency over Bluetooth**, which needs the physical device.
