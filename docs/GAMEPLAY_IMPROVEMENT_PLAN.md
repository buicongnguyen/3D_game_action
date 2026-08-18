# Gameplay Improvement Plan

## Verdict

The earlier recommendation still matches the updated game: improve the existing escort-leapfrog mode before creating a separate game or alternate mode. The current identity is distinctive—an engineer advances beside a walking spider, deploys a small pressure network, then chooses whether to recover or sacrifice machines. The problem was not a shortage of systems; several of the best systems were unreachable or strategically optional.

An alternate **Salvage Rush** mode could be valuable later, after the main loop produces reliable tension. Building it now would split balancing and testing across two versions of a loop that still needs its intended decisions to work.

## Proposed Campaign Progression

The next major improvement should be a short sequence of stages rather than one run that exposes nearly every system immediately. Each stage should introduce one new decision, reuse everything already learned, and end with a clear reward. Enemy count alone should not define difficulty: later stages should combine stronger enemy types, tighter terrain, buildings that release squads, and resource pressure.

Keep **Salvage Rush** as a separate replayable mode. The staged campaign becomes the best first experience and the place where weapons, blueprints, modules, and upgrades are introduced.

### Stage 1 — Departure Road

**Purpose:** teach movement, aiming, the Spider escort, and collecting resources.

- Use a mostly straight left-to-right road lasting about 3–4 minutes.
- Start the engineer beside the Spider, with only the scattergun and one turret blueprint.
- Spawn small groups of weak minions from clearly visible edges, with long quiet gaps between attacks.
- Place scrap directly along the road so collection cannot be missed.
- Introduce one empty ruined house containing a resource cache, but no ambush.
- End with one simple defensive hold and a guaranteed first upgrade choice.
- Do not use warriors, golems, maze walls, water hazards, or continuous Pursuit.

**Target difficulty:** 12–20 enemies alive at peak; the player should finish on a first attempt even after making several mistakes.

### Stage 2 — Broken Settlement

**Purpose:** teach threats from structures and introduce meaningful weapon choice.

- Add ruined houses in three readable states: open/empty, resource cache, and occupied.
- An occupied house gives a visible warning—door movement, sound, dust, or lit windows—before 4–8 enemies run out.
- Introduce warriors in small numbers and one elite encounter near the exit.
- Unlock a second personal weapon archetype. Recommended first addition: a **Rivet Rifle**, accurate at medium range and strong against warriors but poor against swarms.
- Add the relay blueprint and teach a simple two-machine pressure network.
- End with a choice between a weapon upgrade and a construction upgrade.

**Target difficulty:** 25–40 enemies alive at peak; occupied houses create discrete fights rather than endlessly spawning enemies.

### Stage 3 — Flooded Works

**Purpose:** make positioning and route choice matter.

- Add shallow water that slows the engineer and normal enemies but does not impede the Spider.
- Use deep water as an obvious boundary, never as an invisible collision wall.
- Place bridges across channels as tactical funnels; attacks should visibly approach from both banks or nearby buildings.
- Introduce a short-range crowd weapon such as a **Steam Flamer**. It excels on bridge funnels but consumes fuel or builds heat, so it cannot replace turrets everywhere.
- Unlock barricades and fuel-related upgrades.
- Offer a route choice: a safer long bridge with fewer resources, or a flooded shortcut with more salvage and stronger enemies.

**Target difficulty:** 45–70 enemies alive at peak, with the terrain—not raw health inflation—creating most of the challenge.

### Stage 4 — Rust Maze

**Purpose:** test navigation, recovery, and multi-direction defense.

- Use the authored modular maze walls and towers, with corner pieces, arches, and ground markings that make the route readable.
- Place enemy nests or occupied workshops in side chambers. Destroying a nest stops its finite reinforcement group and awards salvage.
- Mix minions and warriors, then introduce a golem as the stage boss rather than as a routine spawn.
- Unlock a heavy weapon such as a **Magnetic Launcher**: slow explosive shots effective against armor and structures, weak when surrounded.
- Make recovered field machines bank automatically at the Spider so salvage collection does not block carrying and placement.
- Reward the player with a Spider module choice at the exit.

**Target difficulty:** 70–110 enemies alive at peak; danger comes from crossings, side rooms, and decisions about whether to explore or stay with the Spider.

### Stage 5 — The Last Gate

**Purpose:** combine the full game into a memorable climax.

- Begin with a short preparation area containing resources, repair opportunities, and the final upgrade choice.
- Combine water funnels, ruined houses, maze remnants, nests, and open firing lanes in a controlled sequence.
- Escalate from probing attacks to heavy waves and finally continuous Pursuit.
- Increase enemy power through new behaviors and compositions before increasing health: shielded warriors protecting minions, golems breaking barricades, and flank groups emerging from houses.
- Allow the player to use every unlocked weapon and blueprint, but require loadout selection so each run retains tradeoffs.
- End with a final gate hold followed by a brief escape, not simply another long survival timer.

**Target difficulty:** 110–160 enemies alive at peak on normal difficulty, with a bounded performance budget and adaptive wave pacing.

## Weapons, Powers, and Items

Progression should add sidegrades rather than replacing old equipment with strictly larger numbers.

| Unlock | Role | Strength | Limitation |
| --- | --- | --- | --- |
| Scattergun | Starting weapon | Mobile close defense and knockback | Weak range and sustained damage |
| Rivet Rifle | Stage 2 | Accurate anti-warrior fire | Poor swarm control |
| Steam Flamer | Stage 3 | Crowd control in corridors and bridges | Fuel/heat limited; short range |
| Magnetic Launcher | Stage 4 | Armor, nests, and clustered targets | Slow firing and dangerous when surrounded |

Add only a small number of item families:

- **Repair kit:** restores the engineer or a targeted machine; the player chooses which.
- **Pressure canister:** temporarily powers nearby machines after they leave the Spider network.
- **Shock mine:** a limited pickup, not a permanent blueprint, that creates emergency crowd control.
- **Spider armor plate:** carried back and banked at the Spider for temporary core armor.
- **Weapon part:** contributes to a guaranteed weapon unlock or upgrade at the next checkpoint.

Every pickup needs a distinct silhouette and color. Avoid filling the world with small interchangeable loot; one interesting cache inside a dangerous house is more valuable than ten scraps placed randomly.

## Upgrade Structure

- Give one guaranteed choice at the end of every stage and occasional level-up choices during longer stages.
- Separate **weapon**, **engineer**, **construction**, and **Spider** upgrades so offers are understandable.
- Prevent unlucky runs from missing essential mechanics: weapon and blueprint unlocks are stage rewards, while upgrades modify them.
- Limit most numerical upgrades to two stacks. Prefer behavior changes such as rifle piercing, flamer leaving burning ground, barricades reflecting knockback, or turrets prioritizing armored targets.
- Show the next stage's main threat before the player chooses an upgrade.

## Pacing and Scaling Rules

- Increase challenge in this order: encounter complexity, enemy composition, spawn directions, terrain pressure, then modest health/damage increases.
- Use authored encounter beats with quiet recovery intervals instead of a constant linear spawn-rate increase.
- Houses and nests must never spawn enemies invisibly. Their warning should last at least 1.0–1.5 seconds.
- Occupied structures have finite occupants or a visible cooldown; destroying a nest permanently matters.
- Measure peak active enemies and frame time per stage. When the performance budget is reached, replace additional bodies with stronger formations or tactical behaviors.
- Allow difficulty settings to modify wave budgets and enemy damage, but keep stage unlock order and tutorials consistent.

## Recommended Implementation Order

1. Build Stage 1 as the new onboarding route and validate that a new player understands following, shooting, collecting, and placing one turret.
2. Implement occupied-house encounters as reusable authored events, including warning, finite release, and completion state.
3. Add campaign unlock state and checkpoint reward selection.
4. Add the Rivet Rifle and loadout switching; balance it as a sidegrade to the scattergun.
5. Build shallow-water and bridge navigation, then author Stage 3 around those mechanics.
6. Refine maze corners and collision before promoting Rust Maze into Stage 4.
7. Add the remaining weapons/items only when their intended stage has an encounter that proves their value.
8. Assemble the finale from validated encounter patterns and add a dedicated performance benchmark for every stage.

## Implemented Staged-World Foundation

The first campaign pass now establishes the systems needed for the larger progression above:

- **Departure Road:** Ashfall Approach is now a nearly straight, deliberately low-pressure opening. Its ambient horde budget is 55% of the baseline and it contains one peaceful ruined cache house, so the building silhouette is introduced before it becomes a threat.
- **Stage escalation:** ambient pressure scales from 0.55 on the opening to 0.9 in Coal Mine Cut, 1.05 in Rust Yard, and 1.2 during The Last Gate. This changes actual spawn budget rather than merely changing spawn-zone weights.
- **Occupied houses:** Coal Mine Cut contains three finite, escalating squads. Each building warns for at least 1.4 seconds with a message and dust before enemies visibly emerge.
- **Workshop nests:** Rust Yard contains three larger authored encounters, culminating in a mixed squad with a golem. They remain finite and trigger once per segment entry.
- **Shared authored placement:** rendering, collision, warning effects, and squad release all use the same route encounter definition. Houses reserve their footprint before natural prop scattering, preventing trees and rocks from obscuring doors.
- **Performance discipline:** every house on a segment shares one instanced geometry and material, adding one draw call rather than one draw call per building.
- **Visual regression coverage:** the deterministic capture harness includes a `houses` scenario alongside the normal opening march.

The subsequent phases are now implemented. The campaign unlocks the Rivet Rifle, Steam Flamer, and Magnetic Launcher in the stages authored to demonstrate them. Flooded Works supplies water funnels and bridges; route caches now contain repair kits, pressure canisters, shock mines, armor plates, and weapon parts; and Rust Maze's nests are destructible reinforcement sources rather than scenery.

## Full Campaign Execution Status

- **Stage 1 — Departure Road:** straight readable route, low threat scale, minions only, starting scattergun/turret kit, guaranteed first checkpoint upgrade.
- **Stage 2 — Broken Settlement:** warned finite house releases, warriors, Rivet Rifle and relay unlocks, occupied/resource/empty building roles.
- **Stage 3 — Flooded Works:** two-route fork, shallow-water slowdown, bridge-safe movement, Steam Flamer and barricade unlocks, richer but harder spillway shortcut.
- **Stage 4 — Rust Maze:** switchback route, rectangular wall collision, corner towers and arch variants, three destructible finite nests, golem climax, Magnetic Launcher and mine unlocks, automatic field-machine banking.
- **Stage 5 — The Last Gate:** stationary opening defense, prepared resources and repairs, guaranteed final upgrade, three mutually exclusive weapon/blueprint loadout kits, water funnel, occupied house, nest, escalating Pursuit, and a short final escape.
- **Side mode:** Salvage Rush remains separately selectable and retains the full sandbox loadout.

### Completed combat and item progression

- Four switchable weapons have separate cadence, reach, crowd-control, heat, piercing, and explosive behavior. The HUD shows the equipped weapon and flamer heat state.
- Weapon upgrades now add behavior as well as modest numbers: Armor-Punch gives rifle rounds an additional pierce; Autoloader reduces Steam Flamer heat generation.
- Repair kits make a contextual engineer-versus-machine repair choice. Shock mines place an emergency device without scrap cost. Armor plates must be banked beside the Spider. Every three weapon parts grants a persistent run damage improvement.
- Consumables use distinct proportions and color-coded ground glows so their silhouettes remain readable from the gameplay camera.

### Performance and regression coverage

- The deterministic performance suite now contains a dedicated authored profile for each of the five campaign stages, plus 100- and 200-enemy synthetic stress profiles and a full Pursuit profile.
- Water and bridges are instanced by family; houses share one instanced draw; maze walls, towers, and arches are batched by type; distant enemies use impostors and the articulated-rig budget remains capped at 96.
- Headless coverage includes campaign topology, water/bridge movement, weapon unlocks and switching, flamer overheat, launcher area damage, destructible nests, finite reinforcements, field-item use, automatic salvage banking, and finale preparation gating.

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

- Automated tests: **273/273 passed** across 15 files after the completed campaign phases and review fixes.
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
