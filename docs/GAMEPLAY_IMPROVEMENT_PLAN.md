# Gameplay Improvement Plan

## Verdict

The earlier recommendation still matches the updated game: improve the existing escort-leapfrog mode before creating a separate game or alternate mode. The current identity is distinctive—an engineer advances beside a walking spider, deploys a small pressure network, then chooses whether to recover or sacrifice machines. The problem was not a shortage of systems; several of the best systems were unreachable or strategically optional.

An alternate **Salvage Rush** mode could be valuable later, after the main loop produces reliable tension. Building it now would split balancing and testing across two versions of a loop that still needs its intended decisions to work.

## Current Evaluation

### What already works

- The moving spider gives every build a temporary lifespan and creates natural forward pressure.
- Folding, carrying, reinstalling, and Last Shot form a strong “save it or sacrifice it” decision.
- Pressure relays and limited turret buffers can make placement matter without requiring a complex factory UI.
- Seeded routes, upgrades, modules, and route forks provide a good foundation for replayability.
- Claude's input, visibility, pressure-network, animation, tether-feedback, and HUD fixes improve reliability and clarity.

### What was holding the game back

- Manual Last Shot was shadowed by Recover, so the signature sacrifice choice could not be selected through normal input.
- Spider modules were generated but never offered, and route choices waited through an unnecessary checkpoint timer.
- The scattergun was strong enough to let the engineer defend the spider without building, weakening the construction loop.
- Trail noise usually stayed too low until the final leg forced PURSUIT, so the middle of a run lacked escalation.
- Full enemy puppets were never released after leaving the closest LOD, while a large shadow map added GPU cost in heavy scenes.

## Executed Improvement Pass

### 1. Make the signature choice playable

- Last Shot is now the primary contextual action for a charged foldable machine.
- Recover remains available on its dedicated fold input, making this a real choice rather than removing an option.
- Overloading structures cannot be folded, repaired, or recharged.
- The integration test now triggers Last Shot through player input instead of an internal method.

### 2. Turn checkpoints into decisions

- On checkpoint arrival, show the salvaged spider-module choice immediately.
- After a module is installed, present the route fork immediately when one exists.
- Remove the forced thirty-second wait before the choices that define the next leg.

### 3. Make construction strategically necessary

- Reduce scattergun damage, range, firing speed, and piercing so it remains useful up close without replacing turret coverage.
- Preserve turret sustained damage, making a well-positioned network the main source of area control.
- Re-run deterministic encounters and tune toward an engineer contribution of roughly 25–35% with three turrets active.

### 4. Give the run an organic tension curve

- Increase Trail noise per automated shot from 0.04 to 0.07.
- Quiet or lightly defended play can still delay escalation, while a loud multi-turret defense now advances naturally through PROBING and HEAVY before the finale.
- Keep checkpoint Trail reset so each leg still has breathing room.

### 5. Recover frame-time headroom

- Reduce the full articulated enemy budget from 128 to 96; distant enemies retain animated impostors.
- Rebalance puppet ownership every 0.4 seconds and release detailed rigs that leave LOD0.
- Reduce the directional shadow map from 3072² to 2048², cutting its texel workload by about 56% while retaining the existing coverage.
- Compare the deterministic `quiet`, `combat100`, `stress200`, and `pursuit` profiles before and after the changes.

## Acceptance Gates

- All unit, integration, determinism, pressure-network, and performance tests pass.
- Production build succeeds with no TypeScript errors.
- Manual Last Shot is reachable through normal Confirm input while Recover remains available.
- Every checkpoint module offer is shown once, followed by a route choice when applicable.
- The deterministic encounter no longer supports “stand on the spider and ignore construction” as the dominant strategy.
- Stress and pursuit scenes use no more than 96 articulated enemy rigs, with distant enemies returning to impostors.
- No regression in escort movement, building, folding, pressure supply, or route departure.

## Verification Results

- Automated tests: **253/253 passed** across 12 files after all follow-up phases and review fixes.
- Production TypeScript/Vite build: **passed**.
- Representative 60-second hold: **26.4% engineer / 73.6% structures** with three turrets; adding turrets consistently reduces the personal damage share.
- Hardware-independent triangle count fell from **635,220 to 537,760** in `combat100` (-15.3%), **777,826 to 703,620** in `stress200` (-9.5%), and **787,838 to 693,874** in `pursuit` (-11.9%).
- SwiftShader mean render time improved from **1.72 ms to 1.50 ms** in `combat100` and **1.80 ms to 1.55 ms** in `stress200`. Pursuit measured 1.70 ms before and 1.75 ms after while also containing six more live enemies, so that small timing difference is treated as harness variance rather than a regression.
- These frame times come from a software renderer and do not predict a player's GPU FPS; the lower rig count, triangle count, and shadow-map workload are the reliable gains.

## Completed Follow-up Phases

1. **Recoverable tether drops:** a carried machine torn loose by the tether becomes a folded, inert world object. It preserves health and buffer, can be recovered normally, and is neither deleted nor silently redeployed.
2. **Exploit and lifetime controls:** recovery XP and Salvage score follow the physical machine and pay once across reinstall cycles. Reinstallation no longer pays new-build XP. Enemy loot expires after 45 seconds; authored route resources remain persistent.
3. **Route objectives:** Ashfall asks for a machine recovery, Coal Mine rewards sustained pressure coverage, Rust Yard rewards scrap collection, and the Last Gate rewards surviving Pursuit. Objective progress appears in the HUD and pays an immediate route-specific reward.
4. **Tactical horde roles:** minions hunt exposed engineers, warriors target relays, turrets and rear defenses, and golems remain core breakers. The director increases the saboteur share against a larger active machine network.
5. **Salvage Rush:** an optional 90-second Rust Yard mode with accelerated Trail, doubled resource pockets, eight recoverable field machines, one-time condition-sensitive salvage scoring, a dedicated timer/score HUD, and a separate result summary. Launch it from Pause or with `?mode=salvage`.

## Follow-up Review Fixes

- Keyboard number keys 1–4 now reach the construction system as direct blueprint selection.
- The controller-disconnect overlay now honors its “press any key” keyboard escape.
- Checkpoint Trail decay emits the same state-change event as combat escalation.
- Structure interaction range now actually includes the structure surface as documented.
- Dropped salvage is excluded from enemy target acquisition and from held-target resolution.
