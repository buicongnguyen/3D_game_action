# Iron March: Homeward — complete campaign design

## Promise and boundaries

Bring the herd and its mechanical protector home. A new selectable four-chapter Story Campaign sits beside Expedition and Salvage Rush. Preserve the existing modes, controls and save keys. The campaign shares the engineer, animated Iron Spider, Blender scenery and weapon artwork; its authored terrain, objectives and enemy rules live in an isolated simulation rather than changing the expedition director.

This release delivers one complete, replayable campaign, not an open-ended farming simulator. No breeding economy, procedural infinite maze, multiplayer, unrestricted physics destruction or extra chapters are required. New creatures use reusable code-authored geometry; existing Blender assets remain the environment/art foundation. Story panels use lightweight original illustrated scenes, not a dependency on an external image service.

## Narrative rules

- The player is the engineer. The large brass/teal Spider is a friendly farm machine, not the mother of the enemies. It helps compress quarry stones and later carries rescued cows.
- Bellflower Farm has six cows in the inner pasture. Three cows were taken from an outer pasture before the opening defense. The opening explicitly establishes those missing animals.
- Enemy spiders follow the Silk Queen. Her silk parasites animate abandoned bodies as white Webbound Husks; she does not give birth to humans. A Stitcher is a spider parasite riding a husk, not an unexplained second species.
- Cow attacks entangle rather than graphically kill. A webbed cow can be freed before its capture timer expires. Captured cows join the rescue ledger; never remove successfully protected cows in a cutscene.
- At least one inner-pasture cow must remain to complete the defense. Losing every cow or the engineer/machine ends the attempt with a chapter retry, not a restart of the entire campaign.
- Safe cows remain at the farm. Missing cows are released from the maze holding pen and quarry cages. The ending accounts for all nine cows without inventing or duplicating animals.
- The machine skirts the maze while the engineer goes through it. They rendezvous at the quarry. The queen's attack damages the machine's cooling reserve; returning home requires escort, repair and supplies.

## Chapter 1 — Bellflower Hill

Teach movement, automatic fire and protecting cows before adding crafting. Six individually named cows stand in a fenced inner pasture on a raised hill. One non-overlapping spiral road rises from the forest to the pasture. Ordinary enemies follow the road; Jumpers may skip one turn once, with a wind-up, airborne arc and visible landing cue. No invisible teleport or repeated wall jumping.

Forty attackers in four waves of ten; short safe collection intervals separate waves. Wave two introduces the first Jumper; later waves mix in armored Shellbacks. Completion requires all forty defeated, no active attackers and at least one cow not captured. The HUD displays herd status, wave, kills and shell currency separately.

Defeated spiders leave small shell-part pickups. Walking close collects them automatically, with a named receipt. A marked quarry launcher converts five parts into a stone. It starts charged so the first demonstration is never blocked by loot luck. A visible guide shows the stone following the banked spiral downhill, damaging each enemy at most once. Stones have a short cooldown and a bounded active count. No friendly fire against cows or the engineer.

The engineer can free a nearby webbed cow using the single contextual action. At 10 and 20 defeats, salvaged shell armor grants +15 maximum/current health and +15% size for newly launched stones per armor level. Armor attachments rather than runaway model growth communicate progression. Maze crates can grant the third armor level. Damage upgrades are separate, bounded choices; nothing multiplies size every kill.

Transition: raiders carry the previously missing outer-pasture cows away. Text also acknowledges actual farm captures, if any. Nothing rewrites the player's saved-cow count.

## Chapter 2 — The Tanglewood Maze

Enter bottom-left; leave top-right. A deterministic, testable maze grid with authored objective locations contains loops, multiple junctions, a holding pen, supply crates and an exit beacon. Essential targets are reachable without shooting walls or obtaining a random item. Use objective markers and a compact map to prevent confusion.

The machine is parked outside the entrance. Enemies pursue the engineer, not the parked machine. Introduce Webbound Husks: slow white silhouettes with a visible green parasite, dangerous at narrow intersections. Spiders remain faster flankers. Do not add endless enemies to a cleared dead end.

One holding pen releases part of the missing herd to a safe off-screen rendezvous; the others remain in the quarry. Approach and use the contextual action. Crates offer one explicit choice, for example `Projectiles 1 -> 2` versus `Damage +20%`. Cap multishot at three and damage upgrades at three; never stack exponential multipliers. Essential weapon unlocks are guaranteed, not random. Crates cannot award twice, including after closing a modal.

Unlock the piercing laser before the exit and demonstrate it against aligned enemies. Walls block fire unless explicitly identified as destructible; the ordinary laser does not inherit the tank game's concrete-wall penetration rule.

## Chapter 3 — The Silk Quarry

Open arena with generous escape lanes. The friendly machine arrives by the perimeter road. Rescue the remaining cows by defeating the Silk Queen, then secure the cage beacon. Rocket and flamethrower are available before combat, with a short briefing explaining each role.

Queen cycle: telegraphed slam -> exposed core -> brood release -> select the next slam location. She anchors the nest rather than teleporting between positions. At lower health she adds marked web patches and Stitchers, with finite active-enemy caps. The core opening makes direct damage more effective; normal attacks still make progress. There is always an unlimited basic weapon, and heat-limited specials cool without needing a lucky ammunition drop.

- Rocket: slow, visible projectile; radial damage at impact; one hit per target per explosion.
- Laser: instant narrow piercing line; stops at solid walls; short-lived matching visual.
- Flame: short cone, wall occlusion, damage-over-time independent of rendered particles; bounded instanced flame effects. Adapt the mathematical/behavioral approach from `Tank_game_3D/src/three/flamethrower.ts`, not its entire game object.
- Rifle: reliable automatic baseline, always usable.

Egg clusters and all spawned creatures share caps. Killing the boss stops reinforcements, clears remaining threats for the rescue beat, and permits the cage interaction. No second invisible boss phase.

## Chapter 4 — The Homeward March

The rescued cows travel on the cargo deck of the existing Iron Spider model, protected by its health pool. The visible cargo count matches the rescued count. The player remains free to scout, with a distance/direction warning and no tether or distance damage. Reuse the escort pattern: advancing machine, scattered resources, nearby contextual E/touch repair, deployable turrets and timed ambushes.

A finite authored homeward road passes woodland, quarry ruins, a rest stop and the Bellflower gate. The rest stop restores supplies before the final ambush. The machine slows/stops for its announced repair stop; no unexplained idle state. Fuel has a slow emergency crawl when empty so the campaign cannot become permanently unwinnable. Repairs consume displayed shell parts, with guaranteed supply pockets.

Victory requires the machine reaching the gate alive with the rescued herd aboard. Do not require killing every distant straggler. Show the whole herd reunited and the machine resting at the farm. End text: `Every bell we brought home is another tomorrow. Rest now, old friend. You carried us all.`

## Enemy roster and readability

| Enemy | Readable silhouette | Role | First chapter |
| --- | --- | --- | --- |
| Broodling | Small charcoal spider, orange abdomen | Road swarm / chase | 1 |
| Jumper | Long legs, cyan abdomen, landing ring | One visible terrace jump | 1, wave 2 |
| Shellback | Broad rust shell, slower gait | Durable road blocker | 1, later waves |
| Webbound Husk | White humanoid, green parasite | Slow melee pressure | 2 |
| Stitcher | Pale husk with violet spider parasite | Stronger late pursuer | 3 |
| Silk Queen | Large violet spider, luminous core | Telegraph-and-opening boss | 3 |

Hostility is conveyed by shape, movement and markers as well as color. The friendly machine has brass armor, teal lamps and a friendly marker. No random zombie encounters in the peaceful opening.

## UI, controls, save and accessibility

- Always show chapter objective, engineer health, machine health when relevant, herd ledger, shell parts and weapon name. Boss health appears only in the quarry.
- WASD / left stick / touch stick move. Automatic fire prioritizes nearby visible enemies. B / weapon buttons cycle or select; E / contextual touch button / controller confirm performs the displayed action. Space / controller cancel dodges. No Q-then-E requirement.
- Pause, retry chapter and return to Expedition are available. Modals are keyboard-focusable and pause simulation; no hidden damage while choosing upgrades or reading story.
- Persist a versioned chapter-start checkpoint with campaign upgrades and herd counts, under a new story-only key. Reload and defeat retry the same chapter with the same resources, not a partially corrupted combat state. Existing save keys are untouched.
- Portrait and landscape layouts must not cover the movement stick or primary action. Short text, explicit units, visible action availability, reduced-motion support and no flashing warning required.

## Engineering and performance acceptance

- Simulation is independent of Three.js and tested with a fixed time step. Terrain height is one shared function for ground, actor feet, pickups and trajectory effects. No overlapping hill surface and no feet buried in terrain.
- Spiral enemies follow a sampled lane; maze enemies use grid pathfinding. Do not reuse straight-line pursuit through maze walls. Validate routes to pen, crates and exit.
- Spatial and time bounds: at most 48 normal enemies, 3 rolling stones, 120 transient effects and a bounded projectile/pickup count. Reuse rendering buffers and geometry; no lights or full physics body per projectile.
- Dead enemies are immediately removed from targeting/collision and do not award loot twice. Visual death effects are not living models.
- Validate every chapter transition, partial farm capture, all-cow failure, crate single use/caps, boss end, ending ledger, saves, pause, frame-rate-independent damage and touch actions.
- Completion means all four playable chapters, reachable ending, tests, production build, browser checks at desktop/portrait/landscape and measured local performance. Report actual evidence, not assumed phone FPS.

## Design references

Gradual teaching and readable units: [George Fan, GDC 2012](https://media.gdcvault.com/gdc2012/slides/Design%20Track/Fan_George_How%20I%20Got.pdf). Alternating combat and recovery beats: [Michael Booth, Valve](https://steamcdn-a.akamaihd.net/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf). These inform the authored pacing; they are not a claim that this release implements Valve's full director.
