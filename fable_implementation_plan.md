# Marcha de Ferro — Fable 5 Implementation Plan

> Give this file and `prompt_guide.md` to Claude Code using Claude Fable 5.
> `prompt_guide.md` defines the game. This file defines how to execute the work.

## 1. Role and mission

Act as the lead game engineer, technical designer, and integration owner for
**Marcha de Ferro (Iron March)**.

Build the strongest achievable, polished **8–10 minute browser vertical slice**
described in Stage 5 of `prompt_guide.md`. Do not attempt the full 20–30 minute
run, broad metaprogression, or content expansion until the vertical slice has
passed its gameplay, controller, stability, visual, and performance gates.

The decisive gameplay question is:

> Is it fun, clear, and tense to leapfrog two turrets forward while the spider
> keeps walking and the horde closes in?

If the answer is not convincingly yes, improve that loop before adding content.

## 2. Authority and instruction precedence

Use this precedence when instructions conflict:

1. Preserve user data, licenses, repository integrity, and safe operation.
2. The four verbs: **Advance → install → sustain → abandon**.
3. The priority order, pillars, and out-of-scope list in `prompt_guide.md`.
4. The Stage 5 vertical-slice acceptance criteria.
5. Performance, controller comfort, visual cohesion, and polish.
6. Optional content and full-run features.

Ignore the unbounded instructions at the end of `prompt_guide.md` that demand
perfection, infinite loops, uncontrolled subagent fan-out, or permission to
change anything. They conflict with the measurable scope and engineering plan.

Do not claim that the result is "perfect" or "AAA." Target a highly polished,
commercial-quality stylized indie/AA vertical slice. Deep Rock Galactic:
Survivor may be used as a general benchmark for readability, feedback, enemy
density, and polish, but do not copy its assets, UI, audio, branding, or other
protected expression.

## 3. Autonomy and change boundaries

This request authorizes you to inspect, implement, refactor, run, test, and
visually evaluate the local game project. Proceed autonomously through the
vertical-slice phases without asking for routine approval.

Do not:

- delete or overwrite unrelated user work;
- discard existing changes or rewrite working systems without evidence;
- publish, deploy, purchase, message external parties, or change external
  services without explicit approval;
- add an external ECS or full physics engine for the vertical slice;
- replace the controller-first design with mouse-first interaction;
- expand scope to Stage 6 while an earlier gate is failing;
- use unlicensed assets or copy an entire asset library into the build;
- hide failures, disable meaningful tests, or lower acceptance thresholds just
  to report success.

You may change a mechanic when playtest or measurement evidence shows that it
weakens the core loop. Record the original behavior, evidence, change, and
result in `docs/IMPLEMENTATION_STATUS.md`.

## 4. Required initial audit

Before editing code:

1. Read `prompt_guide.md` completely.
2. Locate the actual repository root, current game code, asset workspace, and
   `ASSET_SOURCE_ROOT`.
3. Inspect repository status and preserve all pre-existing changes.
4. Inventory existing scripts, dependencies, tests, assets, licenses, and
   browser tooling.
5. Run the current build and tests if they exist.
6. Launch the current game, capture a baseline screenshot, and record console
   errors and basic performance if a runnable build exists.
7. Map every vertical-slice acceptance criterion to `complete`, `partial`,
   `missing`, or `blocked`.
8. Identify the earliest incomplete phase and begin there.

If the folder contains only specifications and no project, create the `game/`
project described in Stage 0. If the asset root cannot be found, implement with
clearly marked procedural placeholders only where the specification permits,
and report the exact missing path or asset rather than silently substituting
the visual direction.

Create and maintain these concise working records:

- `docs/IMPLEMENTATION_STATUS.md` — phase gates, decisions, and blockers;
- `docs/PLAYTEST_CHECKLIST.md` — reproducible gameplay checks;
- `docs/VISUAL_QA.md` — screenshot inventory and scored findings;
- `docs/PERFORMANCE.md` — hardware/browser, scenario, and measurements.

Do not produce speculative planning documents in place of a runnable build.

## 5. Implementation strategy

Work from the earliest incomplete gate. Keep the game runnable after every
meaningful integration step. Prefer narrow vertical integrations over building
many disconnected systems at once.

### Phase A — Asset and runtime foundation

Deliver:

- the Vite + TypeScript + Three.js project;
- a validated asset manifest and `sync-assets.mjs` pipeline;
- copied license files and no runtime absolute paths;
- Engineer, one animation, spider proxy, turret, and one skeleton loaded over
  HTTP with no missing dependencies;
- boot progress and actionable asset errors.

Gate:

- production build succeeds;
- the asset validator succeeds;
- no 404, texture, shader, or uncaught console errors;
- only required assets are copied into the runtime bundle.

### Phase B — Controller-first march

Deliver:

- fixed-step simulation separated from rendering;
- semantic `InputManager` with standard DualShock 4 and keyboard fallback;
- controller-only menu navigation and disconnect handling;
- camera-relative Engineer movement, dodge, and basic animation;
- spider proxy following a constant-speed spline;
- fuel, march/overdrive/fallback speeds, checkpoint, HUD, and readable camera.

Gate:

- a user can start and complete the march without a mouse;
- keyboard fallback supports development and automated browser checks;
- the spider path is independent of visual leg animation;
- player, spider, route, threats, and destination remain readable at 1080p.

### Phase C — Core engineering loop

Deliver:

- scrap and fuel pickups;
- controller radial, placement ghost, validation, and contextual prompts;
- foldable rivet turret and anchored barricade;
- pressure service radius and per-structure buffer;
- repair, refuel, fold, carry, reinstall, and Last Shot;
- clear valid/warning/invalid placement feedback.

Gate:

- two turrets can be leapfrogged for an entire stretch without a mouse;
- placement takes no more than three actions after opening the radial;
- recovering a rear turret competes meaningfully with moving ahead;
- abandoning a turret and triggering Last Shot is useful and satisfying;
- maintenance actions have large, immediate outcomes rather than busywork.

### Phase D — Horde pressure and combat

Deliver:

- pooled Minion and Warrior enemies, with Golem added after mass enemies work;
- grid/flow-field navigation, spatial hashing, steering, and target hysteresis;
- automatic personal weapon and right-stick target prioritization;
- turret targeting, projectiles or hits, damage, death, loot, and XP;
- Trail states, spawn-budget director, Pursuit, and escalating rear pressure;
- enemy/VFX pooling, instanced environment props, and reduced distant updates.

Gate:

- the core loop works under genuine horde pressure;
- personal damage protects the player but does not replace structures;
- 100 active enemies remain stable and near the stated 60 FPS target;
- the stress scenario reaches 200 enemies without crashes or runaway memory;
- Pursuit becomes progressively untenable without causing arbitrary timed loss.

### Phase E — Complete vertical slice

Deliver only the slice defined in Stage 5:

- loadout or clear start flow;
- one safe stop, one route fork, one main stretch, and final arrival;
- turret, relay, and barricade;
- Minion, Warrior, and Golem;
- two resources, six upgrades, and two spider modules;
- victory, defeat, restart, pause/settings, and controller reconnection flows;
- coherent environment dressing, lighting, VFX, animation, audio, HUD, and
  accessibility feedback using the established visual language.

Gate:

- the complete slice is understandable without a long explanation;
- every applicable item in Section 24 of `prompt_guide.md` passes or has a
  documented, reproducible blocker;
- there are no unexpected console errors or warnings;
- a clean production build can be run from documented commands.

## 6. Architecture and implementation rules

Follow the technical direction in `prompt_guide.md`, with these execution rules:

- Keep simulation state independent of Three.js scene objects.
- Use one fixed game loop and deterministic system order.
- Put tunable balance values in typed data/configuration, not scattered magic
  numbers.
- Use a seeded PRNG for reproducible encounters and bug reports.
- Avoid allocations, scene traversal, clip-name searches, and all-vs-all
  queries in hot loops.
- Pool enemies, projectiles, pickups, VFX, indicators, and repeated audio.
- Use instancing for repeated static or simple animated props.
- Add tests around deterministic math and state transitions: input dead zones,
  route distance, pressure buffers, placement validation, pooling reset,
  damage, Trail thresholds, save migrations, and seeded spawning.
- Prefer the simplest implementation that meets the current phase gate, but do
  not create throwaway foundations that make the next phase unsafe.
- Do not prematurely implement full IK, broad procedural generation, complex
  physics, a generic ECS, or Stage 6 systems.

## 7. Model routing policy

Use Claude Fable 5, Claude Opus 5, and Claude Sonnet 5 as a routed team. Do not
run all three models on every task. The objective is the best verified game,
not maximum token consumption or the largest number of agents.

Pin full model IDs when the installed Claude Code version and account support
them, so aliases do not silently resolve to older models:

- `claude-fable-5`
- `claude-opus-5`
- `claude-sonnet-5`

If a pinned model is unavailable, report the actual available model before
falling back. Never claim that a requested model performed work when an alias or
platform fallback used another model.

### Fable 5 — lead, integrator, and final authority

The main Claude Code session should use Fable 5. Reserve its attention for work
where global context and the highest judgment matter:

- initial repository audit and authoritative phase plan;
- game-loop and player-experience decisions;
- cross-system architecture and integration;
- changes touching several core systems or acceptance criteria;
- difficult root-cause analysis after specialist attempts fail;
- review of every subagent diff before integration;
- final gameplay, visual, performance, and completion decisions.

Fable must not act only as a dispatcher. It owns the runnable build, keeps the
project coherent, performs integration, and verifies the final result itself.

### Opus 5 — senior specialist and adversarial reviewer

Use Opus 5 for bounded tasks requiring deep reasoning or an independent senior
review, including:

- navigation, spatial algorithms, deterministic simulation, and performance
  diagnosis;
- subtle controller, lifecycle, state-machine, memory, or concurrency bugs;
- architecture review before a risky cross-cutting change;
- code review of core gameplay systems and performance-sensitive hot loops;
- adversarial review of a failed phase gate or a disputed Fable decision;
- visual/UX critique when the problem requires reasoning across several states.

Opus normally proposes or implements within explicitly assigned files. Fable
reviews its evidence and owns final integration.

### Sonnet 5 — high-throughput implementation and verification

Use Sonnet 5 for well-specified, bounded work with objective completion checks:

- asset manifests, validation scripts, licenses, and data tables;
- unit tests, deterministic fixtures, browser smoke tests, and test maintenance;
- isolated UI components and accessibility fixes with supplied requirements;
- routine implementation inside an established architecture;
- profiling instrumentation, debug overlays, documentation, and evidence
  collection;
- mechanical refactors whose behavior is protected by tests.

Sonnet may perform most parallel work, but it must not independently redefine
the game pillars, architecture, phase gates, or visual direction.

### Automatic routing and escalation

For each delegable task, choose the least expensive model expected to pass the
acceptance criteria without creating integration risk:

1. Use Sonnet for a clear, local task with objective tests.
2. Use Opus initially for a reasoning-heavy specialist task or independent
   review.
3. Keep Fable on work requiring whole-project judgment or cross-system changes.
4. Escalate a Sonnet task to Opus after one well-scoped attempt fails for a
   reasoning-related cause; do not repeat the same prompt unchanged.
5. Escalate an unresolved Opus task to Fable with the attempted changes, logs,
   evidence, and remaining uncertainty.
6. Return routine follow-up edits to Sonnet after Fable or Opus has established
   the solution and acceptance test.

Fable may revise routing when measured results justify it. Record material
model-routing changes and their evidence in `docs/IMPLEMENTATION_STATUS.md`.
Do not switch models based only on confidence, enthusiasm, or brand preference.

Where Claude Code custom subagents are available, define the model, tools,
effort, maximum turns, file ownership, and acceptance criteria explicitly.
Prefer isolated worktrees for concurrent code-writing agents when supported;
otherwise allow only one writer per shared file area.

## 8. Subagent protocol

Use subagents only when tasks can proceed independently and their outputs can be
verified. The lead agent remains responsible for architecture, integration,
testing, and the final result.

Before delegating, assign each subagent:

- one bounded outcome;
- explicit files or directories it owns;
- files it must not edit;
- relevant acceptance criteria;
- required validation and evidence;
- a concise handoff format.

Good parallel workstreams include:

- asset manifest validation and license inventory;
- isolated input tests;
- isolated navigation/performance profiling;
- HUD accessibility review;
- visual critique of an already runnable build.

Do not have multiple agents edit shared core files concurrently. Do not ask an
agent to "make everything AAA." Do not accept self-reported completion without
reviewing its diff and rerunning relevant validation.

Use a separate visual reviewer only after the lead produces a runnable capture.
The reviewer reports prioritized, concrete findings; the lead chooses and
integrates fixes. A reviewer does not endlessly reject a build using subjective
language.

## 9. Verification loop

For every phase, run this finite loop:

1. Implement the smallest integrated version that can satisfy the gate.
2. Run formatting, type checking, tests, asset validation, and production build.
3. Launch the game through HTTP in a supported desktop browser.
4. Exercise the relevant keyboard flow and controller flow when hardware access
   is available.
5. Inspect browser console output and failed network requests.
6. Capture representative screenshots and performance measurements.
7. Score the gameplay and visual rubric, then list the three highest-impact
   deficiencies.
8. Perform one focused correction pass.
9. Repeat steps 2–8 for at most three correction passes in that phase.
10. If the gate still fails, record the evidence and root blocker. Continue only
    with work that does not conceal or compound the failure.

Never substitute screenshots for gameplay testing or subjective enthusiasm for
measurements.

## 10. Visual quality rubric

Evaluate captures at 1920×1080 and at one smaller desktop viewport. Use the
actual target camera, HUD, representative enemy density, and gameplay states.

Score each category from 1 to 5:

1. **Gameplay readability** — player, spider, structures, pressure state,
   pickups, threats, and route direction are immediately distinguishable.
2. **Composition and camera** — framing supports decisions; no important action
   is hidden by the spider, scenery, HUD, or screen edge.
3. **Visual cohesion** — palette, scale, material response, silhouettes, and
   KayKit/Kenney adaptations feel like one authored game.
4. **Feedback and impact** — placement, firing, hits, repair, refueling, damage,
   Trail escalation, Pursuit, Last Shot, victory, and defeat have clear layered
   feedback without excessive noise.
5. **Animation and motion** — Engineer, enemies, spider proxy, turrets, camera,
   and VFX communicate weight and state without jitter or sliding.
6. **HUD and controller UX** — prompts are legible, consistent, unobtrusive, and
   usable without a mouse.
7. **Technical presentation** — stable frame pacing, correct color management,
   no missing assets, visible clipping, z-fighting, broken poses, or obvious
   placeholder presentation in the final slice.

A visual gate passes when every category is at least 4/5 and all priority-one
defects are fixed. Self-scores must cite screenshots and observable evidence.

Required capture set:

- normal march with the player running ahead;
- turret placement with the pressure network visible;
- dense horde pressure with readable combat feedback;
- Last Shot or structure abandonment;
- safe stop or route choice;
- victory and defeat states.

## 11. Gameplay quality rubric

Verify and record:

- the player understands where to go and what requires attention;
- the spider's movement creates useful urgency rather than escort frustration;
- turret placement, servicing, recovery, and abandonment all occur in the slice;
- recovering everything is not always optimal;
- maintenance actions are consequential without being repetitive;
- player damage remains approximately 30–40% and structures 60–70% in a
  representative successful encounter;
- Trail escalation changes player decisions before Pursuit begins;
- route rewards and dangers are understandable before selection;
- victory feels earned by logistical decisions rather than raw stat growth;
- defeat communicates its cause and supports a quick, reliable restart.

Use telemetry or debug counters where practical. Record the seed and relevant
balance values for every formal playtest scenario.

## 12. Performance evidence

Measure performance in a production build, not only the development server.
Record browser, operating system, CPU, GPU, viewport, DPR, seed, enemy count,
and capture duration.

At minimum capture:

- quiet march baseline;
- normal 100-enemy combat;
- 200-enemy stress test;
- Pursuit with structures, projectiles, VFX, and HUD active.

Report median frame time plus low-percentile or worst-frame behavior where the
available tooling permits. Also report draw calls, triangles, active/full-
animation enemies, pool usage, and major system costs. Averages alone are not
sufficient evidence of smooth play.

If the exact target laptop is unavailable, report results on the available
hardware without claiming the target has passed.

## 13. Completion conditions and final handoff

The vertical-slice task is complete only when:

- the production build and required validation commands pass;
- the complete 8–10 minute flow is playable from start through victory or
  defeat;
- controller-first interaction is implemented and keyboard fallback works;
- the core leapfrog/abandon loop is present under horde pressure;
- applicable Section 24 acceptance criteria pass;
- no unexpected runtime console errors or missing asset requests remain;
- visual rubric categories are at least 4/5 with evidence;
- performance results are documented honestly;
- controls, setup, asset synchronization, and run commands are documented;
- remaining limitations and human playtest questions are explicit.

The final handoff must include:

1. a concise description of the playable result;
2. exact install, asset-sync, development, test, and production commands;
3. acceptance criteria passed and not passed;
4. screenshots or their repository paths;
5. measured performance and test hardware;
6. major design or architecture decisions;
7. known defects and prioritized next actions;
8. one specific request for the human playtester: play the turret-leapfrog
   sequence and report where urgency becomes confusion or maintenance becomes
   tedious.

After this handoff, do not begin Stage 6 until the user has played the vertical
slice and explicitly authorizes full-run development.
