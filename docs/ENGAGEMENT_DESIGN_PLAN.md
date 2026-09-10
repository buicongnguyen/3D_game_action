# Iron March — engagement design

## Goal and scope

Make the existing nine-stage expedition easier to understand and more memorable.
Keep the engineer, walking Spider, pressure network, weapons, checkpoint retry,
biomes and Salvage Rush. Prioritize decisions and readable feedback over more
enemy models, currencies, stages or menus. This is an incremental release, not
a new game. No cinematics, voice acting, new raster art or complete touchscreen
movement redesign are required. Existing keyboard/controller gameplay remains.

## 1. Information hierarchy

The battlefield is primary. Spider integrity/fuel and stage progress stay at
the top; player health, weapons and construction stay at the bottom. Hide
locked weapon slots from the combat rack (the workshop still shows unlocks).
Use larger active controls, readable sentence-case instructions, and high
contrast. Preserve warning colors but never communicate through color alone.

The main objective becomes the active mission when one is underway; otherwise
show the existing stage objective. Mission wording includes the actual action,
progress and time limit. An accessible mission beacon identifies the site.
Menu navigation and weapon/build hints must match keyboard vs gamepad, and
touch-capable displays must not promise unavailable keyboard actions.

Pickup gains appear in a compact resource receipt near the counters, aggregating
same-kind gains instead of flooding the screen. A receipt reports collected
quantity, not an invented upgrade reward. Existing special-item explanations
remain available. Placement retains its ghost/range feedback and explicit
failure reasons; include the selected item's name in the placement action.

Workshop cards show current-to-next damage/fire-rate values using the actual
combat formulas, cost and shortfall. Unaffordable and maxed purchases cannot
activate. Leave/back remains available and clearly labelled, with a static
recommended state under reduced-motion preferences.

## 2. Story identity

Premise: the Spider carries a furnace-heart to restore the final city's defenses.
Mara maintains the machine, Nera scouts the road, and Ilya restores settlements.
Give each a recurring voice. Arrival dialogue explains what changed and what
comes next, rather than repeating generic praise. Correct Gate Watch's claim
that only one road remains before both crystal and escape stages.

Use short radio decisions during travel, pausing only for a meaningful choice.
Accepting help missions incurs a disclosed delay and attack risk; declining
continues the expedition without a hidden penalty. No mandatory mission can
soft-lock the march. Successful aid is remembered in subsequent dialogue and
grants a small, bounded final-escape supply benefit.

## 3. Signature stage moments

One optional mission per segment, with reusable mechanics and authored text:

| Stage | Moment | Action and consequence |
|---|---|---|
| Ashfall | Mara's first field calibration | Short nearby service hold; learn staying close |
| Settlement | Ilya trapped at a roadside workshop | Protect a short rescue; rescued engineer aids later stops |
| Flooded Works / spillway | Restart a pump | Hold near the marked pump under pressure; cooling/fuel reward |
| Badlands | Nera's salvage cache | Collect nearby salvage during a bounded stop; scrap reward |
| Mountains | Clear the passage | Protect a longer engineering operation; repair reward |
| Flower vale | Rest at the seed station | Short recovery and lower spawn pressure, not another horde peak |
| Factory / scrapyard | Sabotage a relay | Eliminate a small number of attackers near the operation; scrap reward |
| Crystal | Stabilize a risky beacon | Longer exposed hold for a larger fuel reward; declining is safe |
| Escape | Communities answer the radio | One-time supplies based on completed aid; no interrupting choice |

Mission sites sit on the navigable road and use one reusable marker. On accepting,
the Spider stops briefly but is not marked checkpoint-docked (combat stays active).
The engineer must remain near the site for service progress. Every operation has
a timeout, after which the Spider resumes. Existing houses/water/maze enemies
remain the scenery and opposition; no infinite mission spawners are added.
Factory kill credit requires nearby kills after acceptance; no remote historical
kills. Cache credit uses newly collected scrap and adds a small local cache so
success does not depend on random drops. Pausing never consumes mission time.

## 4. Run identity

At the first checkpoint choose one irreversible specialization for this run:
- Engineer: cheaper construction and better repairs; weaker personal damage.
- Convoy commander: early crawler access and better turret reach; higher build cost.
- Assault specialist: additional rifle piercing and stronger personal shots;
  weaker turret damage.

Show exact benefits/tradeoffs before selection. Keep normal level-up choices and
shop upgrades. Do not offer redundant selections or multiply the bonus twice on
retry. This release uses one specialization, not a new branching skill tree.

## 5. Pacing, saves and performance

Reduce future spawn-budget accrual briefly after a completed mission; existing
enemies stay alive. Flower land has a quieter operation. Keep pool caps, avoid
per-frame asset creation, and reuse the marker and HUD nodes. Campaign state
(specialization and aid outcomes) survives checkpoint retry; older v1 snapshots
default to neutral state. Salvage Rush does not receive expedition missions.

## Acceptance and playtest targets

- A new player can identify the current goal and placement failure from the HUD.
- Every optional operation can succeed, fail or be declined without trapping play.
- Story outcomes and final aid are awarded once and preserved by stage retry.
- Mobile portrait menus scroll; controls do not collide with the main objective.
- Typecheck, asset validation, full regression suite and production build pass.
- Capture desktop/portrait mission and workshop screens and normal gameplay.
- Run deterministic campaign simulations; real-player enjoyment and hardware FPS
  remain follow-up playtests, not claims derived from automated tests.

## Release

Implement the checklist in ENGAGEMENT_IMPLEMENTATION_PLAN.md, review the diff,
then commit to the existing repository, push through its SSH remote and verify
the GitHub Pages workflow and served bundle. Do not force-push or migrate hosting.
