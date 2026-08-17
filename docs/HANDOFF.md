# Handoff — Marcha de Ferro (Iron March)

Vertical slice, per §13 of `fable_implementation_plan.md`. Every claim here is
traceable to a command in the repository or a file under `docs/`.

**One thing to read first:** the visual gate does not pass. Six of seven rubric
categories are at 4/5 and one — animation and motion — is at 3, because nobody
has yet watched this game move. Details in §3 and §7.

---

## 1. What is playable

A controller-first isometric roguelite about defending a walking fortress that
never stops walking.

You play an engineer on foot beside the Iron Spider, an eight-legged machine that
marches a route toward a gate. You cannot drive it and you cannot stop it. You
build turrets, relays, barricades and mines from a blueprint bar; you service
them under fire; and because the spider keeps moving, every machine you build is
one you will shortly have to recover, abandon, or detonate as a **Last Shot**.
That leapfrog is the game.

Pressure comes from the **Trail**, a noise meter that escalates
QUIET → PROBING → SWARM → HEAVY → PURSUIT. It rises with what you do and bleeds
off at safe stops, so a quiet run really is calmer.

A run is reachable end to end. Verified this session by driving the real build in
a browser: a full route including checkpoints, route forks, upgrade choices and a
final escape reaches **VICTORY** in about 7.5 simulated minutes, and the loss
path reaches **DEFEAT** when the core is destroyed. An undefended spider dies in
about 45 seconds; three turrets hold it at full integrity. That gap is the loop
working.

- Controller-first throughout, with a keyboard fallback that was exercised by
  driving the whole run from synthesised key events.
- Deterministic from a seed: `?seed=IRONMARCH` reproduces a run exactly.
- No console errors and no failed asset requests in a live run (checked against
  the running build, not asserted).

---

## 2. Commands

All from `game/`.

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run verify
```

`verify` runs asset validation, type-check, the full test suite and a production
build — the closest single command to "is this shippable". The full build with
blocking type-check is `npm run build`.

Assets: the game ships on procedural geometry (`src/art/MeshForge.ts`) and needs
no synced files. `npm run sync-assets` copies a real KayKit/Kenney library into
`public/assets/` when `ASSET_SOURCE_ROOT` points at one. **A usable library is
already in this checkout**, in a directory named `-` — see §6.

QA harnesses, each needing the dev server in another shell:

```bash
npm run capture
```

```bash
npm run perf
```

```bash
npx vitest run tests/performance.test.ts
```

Full controls, debug keys and project layout are in `game/README.md`.

---

## 3. Acceptance criteria

### Passing

| Criterion | Evidence |
|---|---|
| Production build and validation commands pass | `npm run build` clean; `npm run verify` clean |
| Test suite | **209 tests, 11 files, all passing** |
| Full flow start → victory or defeat | Both reached by driving the live build; §1 |
| Controller-first with keyboard fallback | Whole run driven from keyboard events |
| Leapfrog/abandon loop under horde pressure | `tests/integration.test.ts`; `lastshot` capture |
| No console errors or missing asset requests | Live run: zero errors, every request 200 |
| Draw calls under the 180 ceiling | **151** worst case, measured with structures on the field |
| Visible triangles in the 600–800k band | 655k worst case |
| 200-enemy stress with no pool exhaustion | 241 sustained, 0 exhaustions |
| Simulation cost ≤ 5 ms per frame | 0.187 ms median worst case — about 27× inside budget |
| Damage split between engineer and machines | 31.1% / 68.9% at the representative position, inside the §7.3 band |
| Performance documented honestly | `PERFORMANCE.md`, including three cases where the tooling itself was wrong |

### Not passing

| Criterion | Status |
|---|---|
| **Visual rubric ≥ 4/5 in every category** | **Six of seven at 4. Animation and motion is at 3.** |
| 60 FPS on the target laptop | **Not established.** No GPU-side frame time has been measured on any real GPU. The automated harness runs headless on SwiftShader, a CPU rasteriser. |
| Draw calls under the <120 *ideal* | 151. The 180 maximum passes; the ideal does not. |
| Dynamic shadow casters ≤ 20 | 54 as literally counted — but these are instanced layers, each one caster covering hundreds of props. Shadow-pass draw calls are 54 and constant. |

---

## 4. Screenshots

- `docs/captures/` — ten scenarios at 1920×1080
- `docs/captures-720/` — the same ten at 1280×720

Covering the §10 required set: normal march, turret placement with the pressure
network visible, dense horde, Last Shot abandonment, safe stop and route choice,
victory and defeat, plus Pursuit, upgrade and module screens.

Scenes are pure functions of a seed (`src/dev/captures.ts`), so a set taken
before and after a change is directly comparable.

---

## 5. Measured performance and test hardware

Windows 11 Pro 10.0.26200, Node 26.4.0, Edge headless, three 0.185.1, 1920×1080,
DPR cap 1.5, seed `IRONMARCH`. **GPU: none — SwiftShader software rasteriser.**

| Scenario | Enemies | Draw calls | Triangles | Sim/step | Pool exhaustions |
|---|---:|---:|---:|---:|---:|
| Quiet march | 0 | 128 | 372k | 0.044 ms | 0 |
| Normal combat | 99 | 143 | 578k | 0.108 ms | 0 |
| Stress test | 241 | 138 | 649k | 0.187 ms | 0 |
| Pursuit, everything active | 238 | 151 | 655k | 0.242 ms | 0 |

Draw calls, triangles, mesh and caster counts, pool usage and simulation cost are
hardware-independent. Frame times are in `PERFORMANCE.md` §6 and describe CPU
rasterisation only — they are **not** evidence about the frame-rate target.

The spec's target laptop was never available, and no claim is made about it.

---

## 6. Major decisions

Full records in `IMPLEMENTATION_STATUS.md` §2 and §2b.

- **Procedural geometry instead of an asset library.** Everything is built in
  code by `MeshForge`. The pipeline for real assets exists and is tested.
- **Simulation fully independent of three.js.** Fixed 60 Hz step with render
  interpolation; nothing in `src/game/` imports the renderer. This is what makes
  209 headless tests possible.
- **Rigid-segment procedural puppets** — no skinning, no clips, sine-driven
  joints — batched into one `BatchedMesh` draw call. This is what makes 240
  articulated enemies affordable, and it is also where three animation defects
  hid; see §7.
- **Flow-field horde navigation** with a spatial hash and steering. No per-agent
  pathfinding.
- **No external ECS and no physics engine**, per the plan's constraints.
- **The real assets are present and deliberately not synced.** `game/-/` holds 52
  files, exactly matching `public/assets/manifest.json`, almost certainly from a
  mistyped destination in an earlier command. It is inert — outside `public/`, so
  Vite neither serves nor bundles it, and nothing references it. Syncing it would
  work and would replace the procedural art across the whole build, invalidating
  every capture and the review that rests on them. That is a human's call, not a
  tidying task. The command and its cost are in `IMPLEMENTATION_STATUS.md` §4b.1.

---

## 7. Known defects and next actions

Priority order. Full list in `VISUAL_QA.md` §5 (O9–O15) and §7.

1. **Nobody has watched this game move.** The only thing between category 5 and a
   4, and the reason the gate fails. There is no motion tooling in the repository
   — no video, no screencast path. `scripts/perf.mjs` already drives the browser
   over the DevTools protocol, which exposes `Page.startScreencast`; the
   capability is one small script away.
2. **Most of the horde does not animate.** Past 64 enemies they become impostors:
   a frozen stride pose slid across the ground with a squash that does not stop
   when the enemy does. At 241 enemies that is about three quarters of them. The
   draw-call budget now has 29 calls spare, so raising the puppet budget is
   affordable.
3. **Structure fold is dead code.** Recovery is one of the four verbs and has no
   animation; `WorldView` passes a literal `0` for fold progress.
4. **The engineer's body is the lowest-contrast actor on screen**, at 1.45:1
   against the ground, so his ground ring does all the work of locating him.
5. **The settings screen is unreachable** — dead zone, vibration and volume
   cannot be changed in play, in a pad-only game.
6. **Frame time on a real GPU is unmeasured**, and with it the colour claim: this
   project asserts SwiftShader matches a GPU in everything but speed, and has
   never tested that.

### A note on how the defects above were found

Three independent review rounds ran against frozen capture sets. Each one found
something I had looked straight at and missed, and the pattern is consistent
enough to be worth passing on with the code: **I eyeballed, and they measured.**
Round three added a second lesson — animation had never been checked by any
means, because "stills cannot judge motion" was true and had quietly become a
reason to stop looking rather than a reason to read the code. Reading it produced
three defects in under an hour.

The tooling failed the same way. Four harness bugs to date, and every one of them
produced *misleading output rather than an error*: a capture set that silently
ignored the viewport it was given, a performance harness whose clock was frozen
by virtual time so every timing read exactly 0.000, and a Pursuit scenario timing
an early return after its core died mid-measurement. All are fixed and all now
fail loudly. It is the failure mode to expect from this codebase's tools.

---

## 8. The request for the human playtester

**Play the turret-leapfrog sequence and report where urgency becomes confusion,
and where maintenance becomes tedium.**

Concretely: build a turret ahead of the spider, let the spider walk past it,
and then decide — recover it, service it and leave it, or Last Shot it. Do that
four or five times in a row, ideally as the Trail climbs into SWARM or HEAVY.

Three things the code cannot answer:

1. **Is the recovery window right?** A turret placed ahead is passed within a few
   seconds and drifts out of the 22 m tether about thirteen seconds later. That
   window is what makes abandoning a machine a real alternative to recovering it.
   It could equally be too tight to act on.
2. **Is servicing consequential or fiddly?** One repair hold restores 22% of a
   structure's health and one cylinder restores a full 30-second cycle,
   deliberately large. Whether that reads as "I bought most of a stretch" or as
   "I pressed a button" is a feel question.
3. **Does the Trail change your decisions before Pursuit?** Escalation is driven
   by the noise you make, so a quiet run is genuinely calmer. Whether a player
   notices that and plays around it is unknown.

Per §13, **Stage 6 (full-run development) does not begin until you have played
this slice and explicitly authorised it.**
