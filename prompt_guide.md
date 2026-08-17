> Original prompt that opened the project, preserved as written, including the
> image references that came with it. Everything in this repository descends
> from this text.
>
> `docs/SPEC.md` is its reorganization into a working specification; when the
> two diverge, **this file is what the author asked for**.
>
> Session of August 8, 2026.
>
> _Note: this is a sanitized English copy of the original Portuguese document.
> Local absolute paths were replaced with the `<ASSET_SOURCE_ROOT>` placeholder,
> and the concept-art images are referenced by description only._

---

# Marcha de Ferro (Iron March) — game and implementation specification

> Source document for implementation by an agent.
> Initial platform: desktop browser.
> Engine/rendering: Three.js + TypeScript + Vite.
> Primary controller: DualShock 4 (PS4) via the Gamepad API.

## 1. Executive summary

**Marcha de Ferro** is a single-player, isometric, controller-first roguelite of logistical action and defense on the move.

The player directly controls an engineer escorting a huge steampunk spider-fortress. The spider follows a route automatically and cannot stay still for long. Its engine, its mining and its defenses produce a **Trail** of noise that attracts growing hordes of undead.

The player should not spend most of the time aiming. Personal weapons fire automatically and serve to clear space. The main activity is:

1. run ahead of the spider;
2. collect scrap and fuel;
3. install defenses;
4. refuel and repair machines;
5. pick up foldable structures before they are left behind;
6. decide what to abandon;
7. reach the next shelter before the pursuing horde makes the situation untenable.

**Short pitch:**

> A tower defense in which the base never stops, and the player has to move the defensive line by hand.

**Core test of the project:**

> Is it fun to leapfrog two turrets forward while the spider keeps walking and the horde closes in?

If the answer is not clearly "yes", do not expand content or metaprogression; fix the core loop of placing, refueling, recovering and abandoning first.

## 2. Priorities and decision rules

When there is ambiguity, use this order of priority:

1. the defense-on-the-move loop;
2. comfort and legibility on the DualShock 4;
3. spatial and logistical decisions;
4. performance with hordes;
5. progression;
6. visual fidelity.

The four verbs that define the game are:

**Advance → install → sustain → abandon.**

A new mechanic should only be added if it strengthens at least one of those verbs without weakening the others.

### Pillars

1. **Defense on the move:** buildings are placed for the next 30–45 seconds, not to form a permanent base.
2. **Engineering under pressure:** refueling, repairing, repositioning and sacrificing are decisions, not consequence-free maintenance chores.
3. **Visible growth:** the character, the machines and the spider itself change over the course of the run.

### Out of initial scope

- multiplayer;
- manual steering of the spider;
- rail building;
- open world;
- production chains;
- grid inventory;
- unit commands;
- full physics for the eight legs;
- complex manual combat;
- more than four blueprints in the radial;
- multiple ammo types;
- a large tech tree during the match;
- a walkable platform on top of the spider;
- indiscriminate mixing of the KayKit and Kenney styles.

## 3. Visual references

The images below are references for framing, legibility and fantasy. They are not screenshots of an existing implementation and do not require reproducing every HUD detail.

### 3.1 March and mobile defense

_(Concept image: the spider walking along the route while the engineer runs ahead placing defenses.)_

### 3.2 Safe stop, preparation and route choice

_(Concept image: the spider crouched at a shelter, the player preparing machines and picking a route.)_

### 3.3 Refueling and turret leapfrogging

_(Concept image: the engineer carrying a folded turret forward while the rear one still fires.)_

### 3.4 Overrun horde and Last Shot

_(Concept image: a continuous horde pressing the expedition while an abandoned structure overloads.)_

### 3.5 Spider growth over the run

_(Concept image: the upgraded spider with visible modules late in the route.)_

## 4. Fantasy, world and visual language

The first biome is a **cursed forest** crossed by ruins, fuel depots and scrapyards. The spider's noise wakes buried undead and draws a horde that follows its trail.

The dominant style should be **KayKit**: chamfered low-poly forms, legible volumes, compact characters and a controlled palette. Kenney assets may be used in the prototype for internal mechanical parts, spider legs and terrain placeholders. Kenney pieces visible in the final product must be recolored and adjusted in scale/material so they do not look like they came from another game.

The spider is the main authored asset. In the first prototype it will be a kitbash of existing pieces with eight simple legs and procedural animation.

## 5. Structure of a run

A full run should last **20–30 minutes**, targeting roughly 25 minutes.

| Phase | Count | Target duration | Purpose |
|---|---:|---:|---|
| Loadout | 1 | 30–60 s | Pick weapon, four blueprints and a spider trait |
| Safe stop | 3–4 | 20–30 s | Pick route and module, prepare machines |
| March | 4 | 4–5 min | Main loop of collecting, building and logistics |
| Final pursuit | 1 | 3–4 min | Mobile climax up to the final gate |
| Result | 1 | 30–60 s | Reward, unlocks and statistics |

Flow:

```text
LOADOUT
  ↓
CHECKPOINT_PREP
  ↓
MARCH → PURSUIT (if the Trail reaches maximum)
  ↓
ROUTE_CHOICE
  ↓
CHECKPOINT_PREP → repeat 3–4 times
  ↓
FINAL_ESCAPE
  ↓
VICTORY or DEFEAT
  ↓
RUN_SUMMARY
```

### 5.1 Safe stop

On reaching a shelter, the spider lowers its body, reduces noise and enters a temporarily protected area.

The player may:

- pick one of two routes;
- install a received module;
- craft structures with scrap;
- recover pressure cylinders;
- load up to two foldable machines onto the transport racks;
- position the first defensive line;
- leave before the timer ends.

When the timer ends, the spider departs automatically.

### 5.2 March

The spider automatically follows a spline. The player controls only the engineer.

The geography must be easy to read:

- **ahead:** resources, unknown terrain and future defensive positions;
- **to the sides:** nests, detours and flank attacks;
- **behind:** the horde and the structures that can still be recovered.

The route is a relatively compact corridor with short side pockets. Do not create huge areas that encourage the player to abandon the spider.

### 5.3 Pursuit

When the Trail reaches 100:

- the game enters `PURSUIT`;
- the spawn budget grows continuously;
- spawns concentrate in the rear;
- enemies receive a gradual speed increase;
- music, HUD and lighting signal maximum danger;
- the situation does not end on a timer: it becomes progressively untenable.

The player can still survive and reach the shelter. Do not cause instant defeat.

### 5.4 End of the run

The last stretch stays mobile. An inexhaustible horde or a colossal pursuer catches up with the expedition. Defenses delay the threat, but victory happens when the spider crosses the final gate.

## 6. Base spider

### 6.1 Movement

- Follows a per-segment authored `CatmullRomCurve3`.
- Canonical state uses `distanceAlongRoute` in meters, not just `u` from 0 to 1.
- Use an arc-length table for constant speed through curves.
- Initial normal speed: **1.25 m/s**.
- Overdrive: **2.0 m/s**.
- Out of fuel: **0.45 m/s**, burning scrap as an emergency measure.
- The spider does not stop on a normal command. An emergency stop may exist later, at a high cost.
- Entity movement does not depend on the visual leg animation.

### 6.2 Legs in the prototype

- Eight legs composed of cloned robotic arms.
- Hide existing wheels in the mobile-base assets.
- Animate the legs in two alternating groups with phase-shifted sine waves.
- Apply light oscillation to the body.
- A simple foot-to-ground raycast is optional in the prototype; terrain should be nearly flat.
- Do not implement full IK before validating the loop.

### 6.3 State and damage

Minimum state:

```ts
interface SpiderState {
  coreHealth: number;
  maxCoreHealth: number;
  fuel: number;
  maxFuel: number;
  speedMode: "fallback" | "march" | "overdrive";
  distanceAlongRoute: number;
  serviceRadius: number;
  carriedStructures: Array<string | null>;
  installedModules: string[];
}
```

Suggested initial values:

| Parameter | Initial value |
|---|---:|
| Core integrity | 500 |
| Max fuel | 100 |
| Normal consumption | 0.12/s |
| Overdrive consumption | 0.60/s |
| Service radius | 10 m |
| Machine racks | 2 |
| Module slots | 4 |

Damage should be gradual and recoverable: shield, armor and modules can fail before the core. For the vertical slice, core + one optional regenerating shield is enough.

### 6.4 Overdrive

Overdrive:

- increases speed;
- increases fuel consumption;
- adds Trail;
- increases furnace glow, steam and vibration;
- is an escape decision, not a free bonus.

## 7. Character

The player controls the KayKit Engineer on the XZ plane.

### 7.1 Capabilities

- camera-relative movement;
- short dodge;
- contextual interaction;
- automatic pickup of nearby scrap;
- carrying a single physical object: a cylinder **or** a folded machine;
- repairing;
- refueling;
- installing and recovering structures;
- automatic weapons;
- target prioritization with the right stick;
- a safety tether when straying too far.

### 7.2 Initial values

| Parameter | Value |
|---|---:|
| Health | 100 |
| Normal speed | 5.5 m/s |
| Speed while carrying | 3.8 m/s |
| Max comfortable distance from the spider | 18 m |
| Tether recall distance | 22 m |
| Interaction range | 2.2 m |
| Build range | 5 m |
| Stick dead zone | 0.18 |

When the player exceeds the tether limit, pull them back, apply light damage and make them drop the carried object. Do not instantly kill by distance.

### 7.3 Personal combat

- Weapons fire automatically.
- With no right-stick input: select the nearest valid target.
- With input: prioritize a target inside a cone in the indicated direction.
- Consider distance, angle, line of sight and threat class.
- The player should produce roughly **30–40%** of total damage.
- Buildings should produce **60–70%**.

If a personal build can completely ignore structures, reduce personal power or strengthen logistical synergies.

## 8. Building and logistics

### 8.1 Categories

1. **Anchored:** cheap, strong and disposable. Not transported.
2. **Foldable:** expensive, recoverable and carried one at a time.
3. **Spider modules:** persist until the end of the run and occupy limited slots.

### 8.2 Pressure network

- The spider produces pressure while it has fuel.
- Buildings inside the service radius refill their buffer automatically.
- Outside the radius, they stay active until the buffer empties.
- Base turret buffer: **30 seconds**.
- A carryable cylinder recharges one machine or relay.
- A relay extends the service area.
- Ground structures stay in world coordinates; they are never children of the spider.

This rule should produce the "leapfrog":

1. place a turret ahead;
2. it starts working when the spider gets close;
3. recover the rear turret;
4. carry it and install it further ahead;
5. abandon a defense when recovering it would cost too much time.

### 8.3 Last Shot

An abandoned structure can go into overload when the player triggers the action or when its buffer runs out:

- increases rate of fire/damage for 3–5 s;
- can no longer be recovered;
- explodes at the end;
- deals damage and crowd control;
- turns a loss into a satisfying tactical choice.

### 8.4 Starting blueprints

| Structure | Category | Cost | Purpose |
|---|---|---:|---|
| Rivet turret | Foldable | 25 scrap | Sustained damage; 30 s buffer |
| Depot/relay | Foldable | 18 scrap | Distributes pressure over a small area |
| Decoy barricade | Anchored | 8 scrap | Blocks and attracts enemies |
| Fragmentation mine | Anchored | 6 scrap | Single explosion; may use a procedural mesh |

For the first prototype, implement only the turret and the barricade. For the vertical slice, add the depot/relay.

### 8.5 Controller-first placement

1. Holding L1 opens the radial and slows time scale to 20%.
2. The right stick selects one of the four blueprints.
3. Releasing L1 closes the radial and creates the ghost.
4. The right stick moves the ghost around the player.
5. Cross confirms.
6. Circle cancels.

The ghost should be:

- green: valid;
- yellow: valid, but outside the pressure network;
- red: invalid.

Validate range, slope, collisions, the spider corridor, navigation and cost. Use an optional 0.5 m grid and automatic rotation; do not require fine manual rotation.

## 9. Resources and economy

Only two field currencies:

- **Scrap:** building and repairing.
- **Fuel:** moving the spider and using overdrive/modules.

XP is progression, not a build currency. Cylinders are physical objects produced by the boiler, not a persistent third currency.

Suggested starting values:

| Item | Value |
|---|---:|
| Starting scrap | 40 |
| Starting fuel | 70 |
| Small scrap pickup | 3 |
| Large scrap deposit | 10–15 |
| Jerrycan | 15 fuel |
| Repairing 10% health | 4 scrap |

If fuel hits zero, the spider burns scrap and slows down. This avoids a softlock but rapidly increases the risk.

## 10. Trail and horde director

The Trail unifies time, noise and horde proximity.

| Range | State | Behavior |
|---:|---|---|
| 0–24 | `QUIET` | Few enemies, exploration |
| 25–49 | `PROBING` | Small groups and flank attacks |
| 50–74 | `SWARM` | Regular waves and the first Warriors |
| 75–99 | `HEAVY` | High pressure, elites possible |
| 100 | `PURSUIT` | Continuous overrun horde |

Initial configuration:

- passive increase: 0.30/s;
- mining and noisy actions emit `noiseGenerated` events;
- overdrive adds noise per second;
- heavy shots add small pulses;
- a checkpoint reduces the Trail to roughly 15–20, not necessarily zero.

The director uses a spawn budget:

```ts
interface EnemyArchetype {
  id: string;
  spawnCost: number;
  minimumThreat: number;
  weight: number;
}
```

Initial values:

| Enemy | Health | Speed | Spawn cost | Min threat | Role |
|---|---:|---:|---:|---:|---|
| Skeleton Minion | 20 | 2.3 m/s | 1 | 0 | Horde mass |
| Skeleton Warrior | 80 | 1.7 m/s | 4 | 40 | Pressures structures |
| Skeleton Golem | 400 | 1.1 m/s | 15 | 70 | Elite that attacks the spider |
| Necromancer | 120 | 1.4 m/s | 10 | 65 | Support; post-slice content |

Spawns should happen behind or to the sides, outside the frustum, except when an awakening animation makes the appearance explicit.

## 11. Branching routes

Each checkpoint offers two routes with enough information to make a decision:

| Route | Reward | Danger/modifier |
|---|---|---|
| Coal mine | Abundant fuel | Narrow corridor |
| Scrapyard | Lots of scrap | More swarms |
| Abandoned workshop | Guaranteed module | Few common resources |
| Armory | Weapon upgrade | Armored enemies |
| Swamp | Shortcut | Reduces spider speed |
| Necropolis | Rare blueprint | High undead density |

Each stretch should be an authored, configurable chunk, not unconstrained procedural terrain. Vary spline, obstacles, spawn zones, resource pockets and modifiers. Use a seeded PRNG for selection and distribution so bugs can be reproduced.

```ts
interface RouteSegmentDefinition {
  id: string;
  points: Array<[number, number, number]>;
  lengthMeters: number;
  recommendedDuration: number;
  pursuitStartSeconds: number;
  spawnZones: SpawnZoneDefinition[];
  resourceZones: ResourceZoneDefinition[];
  modifiers: string[];
  rewardTable: string;
  destinationId: string;
}
```

## 12. Progression

### 12.1 During the run

Enemies, collection and engineering actions grant XP. Leveling up pauses the simulation and offers three options.

Categories:

- personal weapon;
- tool/engineering;
- structures;
- spider synergy.

A run should offer about eight level choices. Checkpoints offer three or four modules in total.

Possible starting modules:

- crane: recovers machines faster;
- extra compartment: +1 rack;
- efficient boiler: faster cylinders;
- magnetic collector: attracts scrap;
- reactive armor: periodic shield;
- fabricator: cheaper anchored structures;
- dorsal turret: permanent defense, but more Trail.

### 12.2 Between runs

Mostly horizontal metaprogression:

- new blueprints;
- new starting weapons;
- new modules;
- chassis and boilers with trade-offs;
- more information about routes;
- difficulty modifiers;
- cosmetics.

Avoid large permanent damage/health bonuses. Even a defeat grants schematics based on distance reached.

## 13. Victory and defeat

### Victory

- The spider crosses the final gate.
- The player is picked up automatically if nearby.
- Integrity, fuel and recovered machines influence the reward.

### Defeat

- The spider's core reaches zero; or
- the player goes down with no rescue-automaton charges left.

In the vertical slice, simplify: defeat only when the core reaches zero; a downed player respawns next to the spider once, with a scrap/core-health penalty.

## 14. HUD and UX

Implement the HUD in HTML/CSS over the Three.js canvas.

Permanent elements:

- player health;
- spider integrity;
- fuel;
- scrap;
- carried object;
- Trail;
- distance/time to the checkpoint;
- XP and level;
- four blueprints;
- contextual prompt;
- arrow to the spider when off screen;
- alert for a structure being left behind.

Modal interfaces:

- build radial: slows to 20%;
- upgrade choice: full pause;
- route choice: full pause;
- pause/settings: full pause.

Menus must work without a mouse. Build a custom `FocusManager` with D-pad/stick navigation, controlled repeat and restoration of previous focus.

## 15. Controls — DualShock 4

Use `navigator.getGamepads()` every frame plus the `gamepadconnected`/`gamepaddisconnected` events. Never access physical indices outside the `InputManager` layer.

If `gamepad.mapping === "standard"`, use the W3C layout:

| Standard input | DualShock 4 |
|---|---|
| axes 0/1 | Left stick X/Y |
| axes 2/3 | Right stick X/Y |
| button 0 | Cross |
| button 1 | Circle |
| button 2 | Square |
| button 3 | Triangle |
| button 4/5 | L1/R1 |
| button 6/7 | L2/R2 |
| button 8/9 | Share/Options |
| button 10/11 | L3/R3 |
| button 12/13/14/15 | D-pad up/down/left/right |
| button 16 | PS |

Do not depend on the touchpad, gyroscope, lightbar or PS button.

### 15.1 Action mapping

| Control | Gameplay | Menus |
|---|---|---|
| Left stick | Movement | Navigate |
| Right stick | Prioritize target / move ghost / pick radial entry | Navigate where applicable |
| Cross | Interact, pick up, deliver, confirm placement | Confirm |
| Circle | Dodge / cancel build | Back |
| Square, hold | Repair or refuel by context | Secondary action |
| Triangle, hold | Fold/recover structure | Details |
| L1, hold | Open build radial | Switch tab, if needed |
| L2, hold | Maintenance/network/resource overlay | — |
| R1 | Active engineering tool | — |
| R2 | Focus auto-fire in the right-stick direction | — |
| D-pad up | Toggle overdrive | Navigate |
| D-pad left/right | Previous/next blueprint | Navigate |
| Share | Map and objective | — |
| Options | Pause | Pause/close |
| R3 | Recenter camera | — |

### 15.2 Input requirements

- initial radial dead zone 0.18, configurable;
- rescale magnitude after the dead zone;
- configurable response curve;
- `pressed`, `held` and `released` states;
- suggested hysteresis: pressed at 0.5, released below 0.35;
- pause and show a warning when the controller disconnects;
- a "Press Cross" splash screen to acquire the gamepad after a user gesture;
- prompts change according to the last active device;
- fallback profile by `gamepad.id` when `mapping` is empty;
- calibration/remapping screen for non-standard profiles;
- vibration only via feature detection; never a requirement;
- the whole game usable without a mouse.

Radial dead zone:

```ts
function applyRadialDeadZone(x: number, y: number, dz = 0.18) {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= dz) return { x: 0, y: 0 };
  const scaled = Math.min(1, (magnitude - dz) / (1 - dz));
  return { x: (x / magnitude) * scaled, y: (y / magnitude) * scaled };
}
```

### 15.3 Keyboard/mouse fallback for development

| Keyboard/mouse | Action |
|---|---|
| WASD | Movement |
| Mouse | Prioritized direction/ghost |
| E | Interact/confirm |
| Space | Dodge/cancel |
| R, hold | Repair/refuel |
| F, hold | Recover structure |
| Q, hold | Build radial |
| Tab | Overlay/map |
| Arrow keys | Menu navigation |
| Esc | Pause |

## 16. Three.js architecture

### 16.1 Initial stack and versions

Create a `game/` project separate from the existing viewer, as a sibling of `viewer/` in the asset workspace.

Initially use the versions already present in the repository:

```json
{
  "dependencies": {
    "three": "0.185.1"
  },
  "devDependencies": {
    "@types/three": "0.185.3",
    "typescript": "7.0.2",
    "vite": "8.2.0"
  }
}
```

Do not add a physics engine or an external ECS in the vertical slice.

### 16.2 Suggested structure

```text
game/
├── public/
│   └── assets/
│       ├── manifest.json
│       ├── kaykit/
│       ├── kenney/
│       ├── game/spider/
│       └── licenses/
├── scripts/
│   ├── sync-assets.mjs
│   └── validate-assets.mjs
├── src/
│   ├── main.ts
│   ├── core/
│   │   ├── Game.ts
│   │   ├── GameLoop.ts
│   │   ├── GameState.ts
│   │   ├── EventBus.ts
│   │   ├── ObjectPool.ts
│   │   └── Random.ts
│   ├── assets/
│   │   ├── AssetManager.ts
│   │   ├── AssetManifest.ts
│   │   ├── AnimationLibrary.ts
│   │   └── PrefabFactory.ts
│   ├── input/
│   │   ├── InputManager.ts
│   │   ├── InputActions.ts
│   │   ├── GamepadProfile.ts
│   │   ├── DualShockProfile.ts
│   │   └── KeyboardProfile.ts
│   ├── rendering/
│   │   ├── Renderer.ts
│   │   ├── CameraController.ts
│   │   ├── RenderSyncSystem.ts
│   │   ├── AnimationSystem.ts
│   │   ├── OcclusionSystem.ts
│   │   └── VfxSystem.ts
│   ├── game/
│   │   ├── GameWorld.ts
│   │   ├── RunState.ts
│   │   ├── entities/
│   │   │   ├── Player.ts
│   │   │   ├── Spider.ts
│   │   │   ├── Enemy.ts
│   │   │   ├── Structure.ts
│   │   │   ├── Projectile.ts
│   │   │   └── Pickup.ts
│   │   ├── systems/
│   │   │   ├── PlayerMovementSystem.ts
│   │   │   ├── InteractionSystem.ts
│   │   │   ├── SpiderMovementSystem.ts
│   │   │   ├── ConstructionSystem.ts
│   │   │   ├── PressureNetworkSystem.ts
│   │   │   ├── HordeDirector.ts
│   │   │   ├── EnemyNavigationSystem.ts
│   │   │   ├── WeaponSystem.ts
│   │   │   ├── CollisionSystem.ts
│   │   │   ├── DamageSystem.ts
│   │   │   └── ExperienceSystem.ts
│   │   ├── navigation/
│   │   │   ├── NavigationGrid.ts
│   │   │   ├── FlowField.ts
│   │   │   ├── SpatialHash.ts
│   │   │   └── Steering.ts
│   │   └── route/
│   │       ├── RouteGraph.ts
│   │       ├── RouteSpline.ts
│   │       └── RouteDirector.ts
│   ├── data/
│   │   ├── assets.ts
│   │   ├── enemies.ts
│   │   ├── structures.ts
│   │   ├── weapons.ts
│   │   ├── modules.ts
│   │   ├── upgrades.ts
│   │   └── routes.ts
│   ├── ui/
│   │   ├── HudController.ts
│   │   ├── FocusManager.ts
│   │   ├── RadialMenu.ts
│   │   ├── RouteChoiceScreen.ts
│   │   └── UpgradeScreen.ts
│   └── save/
│       ├── SaveManager.ts
│       ├── SaveSchema.ts
│       └── migrations.ts
└── tests/
```

### 16.3 Entity organization

Use simple systems and explicit data, without a generic ECS:

```ts
class GameWorld {
  player: Player;
  spider: Spider;
  enemies = new Map<number, Enemy>();
  structures = new Map<number, Structure>();
  projectiles = new Map<number, Projectile>();
  pickups = new Map<number, Pickup>();
  events: EventBus<GameEvent>;
  spatialHash: SpatialHash;
}
```

- Three.js objects are not the source of truth for the simulation.
- Numeric state lives in the entities.
- `RenderSyncSystem` applies position/rotation to the `Object3D`s.
- No entity creates its own `requestAnimationFrame`.
- Events are typed and drained in a deterministic order.

### 16.4 Fixed loop

Use a fixed 60 Hz simulation with interpolation at render time:

```ts
const FIXED_STEP = 1 / 60;
const MAX_FRAME_TIME = 0.1;

function frame(now: number) {
  const frameTime = Math.min((now - previousNow) / 1000, MAX_FRAME_TIME);
  previousNow = now;
  accumulator += frameTime;
  input.pollGamepads();

  while (accumulator >= FIXED_STEP) {
    game.fixedUpdate(FIXED_STEP, input.snapshot());
    accumulator -= FIXED_STEP;
  }

  game.render(accumulator / FIXED_STEP);
  requestAnimationFrame(frame);
}
```

System order per tick:

1. input snapshot;
2. run state and Trail;
3. spider movement;
4. player movement;
5. interaction/building/collection;
6. pressure network;
7. director and spawning;
8. enemy navigation;
9. weapons/projectiles;
10. collisions and damage;
11. deaths, loot and XP;
12. checkpoints/upgrades;
13. return to pools;
14. animations;
15. camera and HUD.

Rendering does not alter the simulation.

### 16.5 Camera

- `OrthographicCamera`;
- yaw of about 45°;
- pitch of 50–55°;
- fixed orientation in the slice;
- follows a weighted point between the player and the spider;
- look-ahead in the direction of march;
- smooth zoom-out when the player moves away;
- `devicePixelRatio` capped at 1.5;
- `ResizeObserver` for resizing;
- occluder fade via raycast at 10 Hz.

Camera-relative movement:

```ts
move = cameraRightXZ * leftStick.x + cameraForwardXZ * -leftStick.y;
```

### 16.6 Horde navigation

Do not run individual A* per enemy.

Use:

1. a 2D XZ grid with 1–1.5 m cells;
2. a flow field to the strategic target, updated 2–4 times/s;
3. local steering with separation and avoidance;
4. a `SpatialHash` for neighbors and collisions.

Minimum states:

```text
SPAWNING → APPROACHING → ATTACKING → STAGGERED → DEAD
```

The target is chosen by score and has a cooldown before being reevaluated. Possible targets: the core, a noisy structure, a nearby player or a decoy.

### 16.7 Pooling and instancing

Mandatory pools:

- enemies;
- projectiles;
- pickups;
- VFX;
- health indicators;
- damage numbers;
- repeated sounds.

Use `InstancedMesh` for vegetation, rocks, pickups and repeated props. Use `SkeletonUtils.clone()` for rigged characters. Limit enemies with full skinned animation and reduce animation frequency for distant enemies.

### 16.8 Initial render setup

- `WebGLRenderer({ antialias: true })`;
- `outputColorSpace = SRGBColorSpace`;
- `ACESFilmicToneMapping`;
- one `DirectionalLight` with shadow;
- one `HemisphereLight`;
- fog;
- emissives/sprites instead of many point lights;
- shadow casters only for the spider, the player, structures and nearby enemies;
- pause/reduce updates when the tab is hidden.

## 17. Assets and exact paths

### 17.1 Source root

All paths in this section were validated on disk and are relative to a local asset library root:

```text
<ASSET_SOURCE_ROOT>/
```

Define during development:

```text
ASSET_SOURCE_ROOT=/path/to/your/3d_assets
```

The browser **cannot** load those paths directly. Create `scripts/sync-assets.mjs` to copy only the selected set into `game/public/assets/`. Do not use `file://` and do not depend on symlinks in the distributed build.

For `.gltf`, also copy the `.bin` and the images referenced in the JSON, preserving the relative structure. `.glb` files are self-contained. Also copy the licenses:

```text
kay_assets/The Complete KayKit Collection v6.1/License.txt
assets/kenney_factory/License.txt
assets/kenney_space-kit/License.txt
assets/kenney_nature/License.txt
```

### 17.2 Character, equipment and animations

| Runtime ID | Role | Relative source path |
|---|---|---|
| `player.engineer` | Character | `kay_assets/The Complete KayKit Collection v6.1/KayKit Adventurers 2.0/Characters/gltf/Engineer.glb` |
| `player.wrench` | Tool | `kay_assets/The Complete KayKit Collection v6.1/KayKit Adventurers 2.0/Assets/gltf/engineer_Wrench.gltf` |
| `player.shotgun` | Starting automatic weapon | `kay_assets/The Complete KayKit Collection v6.1/KayKit Adventurers 2.0/Assets/gltf/shotgun.gltf` |
| `anim.medium.general` | Idle, pickup, interact, hit, death | `kay_assets/The Complete KayKit Collection v6.1/KayKit Character Animations 1.1/Animations/gltf/Rig_Medium/Rig_Medium_General.glb` |
| `anim.medium.move` | Run, walk and jump | `kay_assets/The Complete KayKit Collection v6.1/KayKit Character Animations 1.1/Animations/gltf/Rig_Medium/Rig_Medium_MovementBasic.glb` |
| `anim.medium.moveAdvanced` | Dodge and strafe | `kay_assets/The Complete KayKit Collection v6.1/KayKit Character Animations 1.1/Animations/gltf/Rig_Medium/Rig_Medium_MovementAdvanced.glb` |
| `anim.medium.ranged` | Aim, shoot, reload | `kay_assets/The Complete KayKit Collection v6.1/KayKit Character Animations 1.1/Animations/gltf/Rig_Medium/Rig_Medium_CombatRanged.glb` |
| `anim.medium.tools` | Hammer, pickaxe, work, holding | `kay_assets/The Complete KayKit Collection v6.1/KayKit Character Animations 1.1/Animations/gltf/Rig_Medium/Rig_Medium_Tools.glb` |

Initial semantic clips:

```text
idle       -> Idle_A
run        -> Running_A
interact   -> Interact
pickup     -> PickUp
carry      -> Holding_A
repair     -> Hammering or Working_A
mine       -> Pickaxing
dodge      -> Dodge_Forward
shoot      -> Ranged_2H_Shoot
reload     -> Ranged_2H_Reload
hit        -> Hit_A
death      -> Death_A
```

Attach the wrench/shotgun to `handslot.r` or `handslot.l`. Load the animation GLBs only to extract `gltf.animations`; do not add the mannequins to the scene. The Engineer uses `Rig_Medium` and the bone names are compatible.

### 17.3 Spider proxy

| Runtime ID | Use | Relative source path |
|---|---|---|
| `spider.frame` | Chassis | `kay_assets/The Complete KayKit Collection v6.1/KayKit Space Base Bits 1.0/Assets/gltf/mobile_base_frame.gltf` |
| `spider.command` | Body/cabin | `kay_assets/The Complete KayKit Collection v6.1/KayKit Space Base Bits 1.0/Assets/gltf/mobile_base_command.gltf` |
| `spider.carriage` | Optional module | `kay_assets/The Complete KayKit Collection v6.1/KayKit Space Base Bits 1.0/Assets/gltf/mobile_base_carriage.gltf` |
| `spider.cargo` | Racks/cargo | `kay_assets/The Complete KayKit Collection v6.1/KayKit Space Base Bits 1.0/Assets/gltf/mobile_base_cargo.gltf` |
| `spider.legA` | Procedural leg, clone 8× | `assets/kenney_factory/Models/GLB format/robot-arm-a.glb` |
| `spider.legB` | Rear variant | `assets/kenney_factory/Models/GLB format/robot-arm-b.glb` |
| `spider.module.machine` | Visible module | `assets/kenney_factory/Models/GLB format/machine.glb` |
| `spider.module.valve` | Boiler/decoration | `assets/kenney_factory/Models/GLB format/pipe-large-valve.glb` |

Hide proxy nodes whose name contains `_wheel_`. Create sockets in code in the prototype; in the final asset, use `Socket_Module_01` through `Socket_Module_04`, `Socket_Carry_01` and `Socket_Carry_02`.

### 17.4 Buildings

| Runtime ID | Use | Relative source path |
|---|---|---|
| `structure.rivetTurret` | Foldable turret | `kay_assets/The Complete KayKit Collection v6.1/KayKit Adventurers 2.0/Assets/gltf/turret_base.gltf` |
| `structure.supplyCrate` | Depot/resupply | `kay_assets/The Complete KayKit Collection v6.1/KayKit Adventurers 2.0/Assets/gltf/ammo_crate_withLid.gltf` |
| `structure.barricade` | Anchored barricade | `kay_assets/The Complete KayKit Collection v6.1/KayKit Dungeon Pack 1.1/Assets/gltf/barrier.gltf` |
| `structure.relay` | Relay placeholder | `assets/kenney_space-kit/Models/GLTF format/machine_wireless.glb` |
| `structure.generator` | Workshop/generator placeholder | `assets/kenney_space-kit/Models/GLTF format/machine_generator.glb` |

In `turret_base.gltf`, rotate the `turret_gun` node; the feet are `turret_footA/B/C`. The folded state may initially use procedural scale/rotation or a placeholder box; produce a dedicated asset later.

### 17.5 Resources

| Runtime ID | Use | Relative source path |
|---|---|---|
| `resource.fuelCan` | Carryable fuel | `kay_assets/The Complete KayKit Collection v6.1/KayKit Resource Bits 1.0/Assets/gltf/Fuel_A_Jerrycan.gltf` |
| `resource.fuelBarrel` | Fuel depot | `kay_assets/The Complete KayKit Collection v6.1/KayKit Resource Bits 1.0/Assets/gltf/Fuel_A_Barrel.gltf` |
| `resource.scrapSmall` | Scrap pickup | `kay_assets/The Complete KayKit Collection v6.1/KayKit Resource Bits 1.0/Assets/gltf/Parts_Pile_Small.gltf` |
| `resource.scrapLarge` | Mineable deposit | `kay_assets/The Complete KayKit Collection v6.1/KayKit Resource Bits 1.0/Assets/gltf/Parts_Pile_Large.gltf` |
| `resource.scrapAuthored` | Authored variant | `generated/sucata-metal.glb` |

### 17.6 Forest and terrain

| Runtime ID | Role | Relative source path |
|---|---|---|
| `forest.tree1` | Tree | `kay_assets/The Complete KayKit Collection v6.1/KayKit Forest Nature Pack 1.0/Assets/gltf/Color1/Tree_1_A_Color1.gltf` |
| `forest.tree2` | Tree | `kay_assets/The Complete KayKit Collection v6.1/KayKit Forest Nature Pack 1.0/Assets/gltf/Color1/Tree_2_B_Color1.gltf` |
| `forest.treeBare` | Cursed tree | `kay_assets/The Complete KayKit Collection v6.1/KayKit Forest Nature Pack 1.0/Assets/gltf/Color1/Tree_Bare_1_A_Color1.gltf` |
| `forest.bush` | Bush | `kay_assets/The Complete KayKit Collection v6.1/KayKit Forest Nature Pack 1.0/Assets/gltf/Color1/Bush_2_C_Color1.gltf` |
| `forest.rock` | Rock | `kay_assets/The Complete KayKit Collection v6.1/KayKit Forest Nature Pack 1.0/Assets/gltf/Color1/Rock_1_A_Color1.gltf` |
| `forest.grass` | Grass | `kay_assets/The Complete KayKit Collection v6.1/KayKit Forest Nature Pack 1.0/Assets/gltf/Color1/Grass_1_B_Color1.gltf` |
| `terrain.grassTile` | Placeholder tile | `assets/kenney_nature/Models/GLTF format/ground_grass.glb` |
| `terrain.pathStraight` | Placeholder path | `assets/kenney_nature/Models/GLTF format/ground_pathStraight.glb` |
| `terrain.pathBend` | Placeholder curve | `assets/kenney_nature/Models/GLTF format/ground_pathBend.glb` |
| `terrain.pathSplit` | Placeholder fork | `assets/kenney_nature/Models/GLTF format/ground_pathSplit.glb` |

Preference for the slice: continuous terrain generated in Three.js with instanced KayKit props. Kenney tiles are only for graybox/forks.

### 17.7 Enemies, weapons and animations

| Runtime ID | Role | Relative source path |
|---|---|---|
| `enemy.minion` | Horde mass | `kay_assets/The Complete KayKit Collection v6.1/KayKit Skeletons 1.1/characters/gltf/Skeleton_Minion.glb` |
| `enemy.warrior` | Strong attacker | `kay_assets/The Complete KayKit Collection v6.1/KayKit Skeletons 1.1/characters/gltf/Skeleton_Warrior.glb` |
| `enemy.golem` | Elite | `kay_assets/The Complete KayKit Collection v6.1/KayKit Skeletons 1.1/characters/gltf/Skeleton_Golem.glb` |
| `enemy.necromancer` | Post-slice support | `kay_assets/The Complete KayKit Collection v6.1/KayKit Skeletons 1.1/characters/gltf/Necromancer.glb` |
| `enemy.weapon.axe` | Minion/Warrior | `kay_assets/The Complete KayKit Collection v6.1/KayKit Skeletons 1.1/assets/gltf/Skeleton_Axe.gltf` |
| `enemy.weapon.golemAxe` | Golem | `kay_assets/The Complete KayKit Collection v6.1/KayKit Skeletons 1.1/assets/gltf/Skeleton_Golem_Axe_Large.gltf` |
| `enemy.weapon.staff` | Necromancer | `kay_assets/The Complete KayKit Collection v6.1/KayKit Skeletons 1.1/assets/gltf/Skeleton_Staff.gltf` |
| `anim.medium.melee` | Minion/Warrior attacks | `kay_assets/The Complete KayKit Collection v6.1/KayKit Character Animations 1.1/Animations/gltf/Rig_Medium/Rig_Medium_CombatMelee.glb` |
| `anim.medium.skeleton` | Awaken/walk/death | `kay_assets/The Complete KayKit Collection v6.1/KayKit Character Animations 1.1/Animations/gltf/Rig_Medium/Rig_Medium_Special.glb` |
| `anim.large.general` | Golem general state | `kay_assets/The Complete KayKit Collection v6.1/KayKit Character Animations 1.1/Animations/gltf/Rig_Large/Rig_Large_General.glb` |
| `anim.large.move` | Golem movement | `kay_assets/The Complete KayKit Collection v6.1/KayKit Character Animations 1.1/Animations/gltf/Rig_Large/Rig_Large_MovementBasic.glb` |
| `anim.large.melee` | Golem attack | `kay_assets/The Complete KayKit Collection v6.1/KayKit Character Animations 1.1/Animations/gltf/Rig_Large/Rig_Large_CombatMelee.glb` |

Confirmed special clips: `Skeletons_Walking`, `Skeletons_Idle`, `Skeletons_Awaken_Floor`, `Skeletons_Death`. Minion, Warrior and Necromancer use Rig Medium; the Golem uses Rig Large.

### 17.8 Provisional VFX

| Runtime ID | Use | Relative source path |
|---|---|---|
| `vfx.muzzle` | Gunshot | `kay_assets/The Complete KayKit Collection v6.1/KayKit Mystery Monthly Series 4 (1.1)/6 - December 2023 - Action Figure/assets/gltf/Muzzleflash.gltf` |
| `vfx.muzzleLong` | Heavy shot | `kay_assets/The Complete KayKit Collection v6.1/KayKit Mystery Monthly Series 4 (1.1)/6 - December 2023 - Action Figure/assets/gltf/Muzzleflash_Long.gltf` |
| `vfx.impact` | Impact/Last Shot | `kay_assets/The Complete KayKit Collection v6.1/KayKit Mystery Monthly Series 5 (1.1)/2 - August 2024 - Superhero/assets/gltf/LandingImpact.gltf` |
| `projectile.bullet` | Visible projectile | `kay_assets/The Complete KayKit Collection v6.1/KayKit Prototype Bits 1.1/Assets/gltf/Bullet.gltf` |

Pool the VFX. Do not create a real point light per shot; use emissives, sprites and particles.

### 17.9 Manifest and synchronization

Example entry:

```json
{
  "player.engineer": {
    "source": "kay_assets/The Complete KayKit Collection v6.1/KayKit Adventurers 2.0/Characters/gltf/Engineer.glb",
    "runtime": "/assets/kaykit/characters/Engineer.glb",
    "scale": 1,
    "rotationY": 0,
    "castShadow": true
  }
}
```

`sync-assets.mjs` must:

1. take `ASSET_SOURCE_ROOT`;
2. validate every source;
3. copy GLB files directly;
4. for GLTF, read `buffers[].uri` and `images[].uri` and copy the dependencies;
5. keep names unique per namespace;
6. copy the licenses;
7. fail with a clear message if any file is missing;
8. never copy the full 3.7 GB library into the bundle.

## 18. Animation in Three.js

- Load with `GLTFLoader`.
- Rigged characters: `SkeletonUtils.clone()`.
- One `AnimationMixer` per nearby instance.
- Cache clips by semantic name.
- Crossfade between idle/run/carry/repair/attack/hit/death.
- Reduce animation updates for distant enemies to 10–15 Hz.
- When returning an enemy to the pool: stop the mixer, clear actions, hide it and reset state.

Do not look up clip strings repeatedly in the hot loop.

## 19. Collision, navigation and AI

All simulation happens on the XZ plane. Do not add full physics in the slice.

### Collision

- circles for the player, enemies and structures;
- an approximate capsule/rectangle for the spider;
- a spatial hash for local queries;
- squared distance in hot loops;
- no all-vs-all comparisons.

### Navigation

- 2D grid of 1–1.5 m;
- static obstacles marked when the chunk loads;
- barricades update the grid dynamically;
- flow field recomputed 2–4 times/s;
- local steering: field direction + separation + obstacle avoidance;
- target by score, with a cooldown to avoid oscillation.

Minimum states:

```text
SPAWNING → APPROACHING → ATTACKING → STAGGERED → DEAD
```

## 20. Runtime assets and memory management

`AssetManager` must:

- use `LoadingManager` and `GLTFLoader`;
- cache originals;
- clone scenes correctly;
- share geometries, materials and textures;
- allow per-manifest scale, rotation, offset and shadows;
- show progress/errors at boot;
- preload only the current route and the next checkpoint;
- explicitly dispose of resources that will not be reused.

Use `InstancedMesh` for vegetation, rocks, pickups and decoration. Nearby skinned enemies use clones; distant enemies may use a simplified version or reduced updates.

## 21. Save data and metaprogression

Use `localStorage` with a versioned schema. IndexedDB is not needed initially.

```ts
interface SaveDataV1 {
  version: 1;
  settings: {
    masterVolume: number;
    musicVolume: number;
    effectsVolume: number;
    vibration: boolean;
    cameraShake: number;
    gamepadDeadZone: number;
  };
  unlocks: {
    structures: string[];
    weapons: string[];
    modules: string[];
    chassis: string[];
  };
  progression: {
    currency: number;
    runsPlayed: number;
    wins: number;
    highestDifficulty: number;
  };
  records: {
    bestDistance: number;
    bestScore: number;
    discoveredRoutes: string[];
  };
  lastLoadout: string[];
}
```

Save after an unlock, a settings change and the end of a run. Validate defaults, keep a backup and run sequential migrations.

## 22. Performance targets

Target: **60 FPS at 1080p** on a laptop with a reasonable integrated GPU.

| Metric | Target |
|---|---:|
| Total frame | 16.7 ms |
| CPU simulation | ≤ 5 ms |
| CPU/GPU render | ≤ 9 ms |
| Draw calls | ideally < 120; max 180 |
| Visible triangles | 600–800 thousand |
| Active normal enemies | 120 |
| Stress test | 200 |
| Skinned with full animation | ≤ 60 |
| Shadow-casting lights | 1 |
| Dynamic shadow casters | ≤ 20 |
| DPR | max 1.5 |
| Flow field | 2–4 updates/s |

Create a debug overlay with FPS, draw calls, triangles, enemies, pools, flow-field cost and per-system cost.

## 23. Implementation order

### Stage 0 — Asset pipeline

- create `game/`;
- create the manifest;
- implement `sync-assets.mjs` and validation;
- copy the licenses;
- confirm the Engineer, one animation, the turret, a skeleton and the spider proxy in Three.js.

**Acceptance:** everything loads over HTTP URLs, no `file://`, no 404s and no texture errors.

### Stage 1 — Controller-first foundation

- fixed loop;
- state machine;
- semantic `InputManager`;
- standard DualShock + keyboard fallback;
- orthographic camera;
- minimal HUD.

**Acceptance:** start the game, navigate the menu and move a placeholder using only the DS4.

### Stage 2 — March

- animated Engineer;
- spider proxy;
- five-minute spline;
- fuel;
- camera following both;
- start/end checkpoint.

**Acceptance:** follow the spider from A to B without losing legibility.

### Stage 3 — Engineering

- scrap;
- radial;
- ghost;
- foldable turret;
- barricade;
- pressure/buffer;
- repair, refuel and recovery.

**Acceptance:** leapfrog two turrets across the whole stretch without a mouse.

### Stage 4 — Horde

- Minion and Warrior;
- grid, flow field, steering and spatial hash;
- pooling;
- automatic weapons;
- damage/XP;
- Trail and Pursuit.

**Acceptance:** 100 active enemies, a working overrun horde and performance near 60 FPS.

### Stage 5 — 8–10 minute vertical slice

- one safe stop;
- one fork;
- one main stretch;
- two resources;
- turret, relay and barricade;
- Minion, Warrior and Golem;
- six upgrades;
- two spider modules;
- victory and defeat.

**Acceptance:** a complete, understandable experience without a long explanation.

### Stage 6 — Full run

- four legs of the journey;
- varied routes;
- three or four structures;
- metaprogression;
- saving;
- final pursuit;
- audio, vibration, accessibility and graphics options.

**Acceptance:** a 20–30 minute run with a beginning, decisions, escalation, climax and conclusion.

## 24. Vertical slice acceptance criteria

- [ ] The game starts and works without a mouse.
- [ ] The DualShock 4 works over cable and Bluetooth, or the game offers calibration when the browser does not report standard mapping.
- [ ] Disconnecting the controller pauses and shows a clear instruction.
- [ ] The engineer moves camera-relative and animates correctly.
- [ ] The spider follows the spline independently of the leg animation.
- [ ] The camera keeps the player and the spider legible.
- [ ] The player installs a turret in at most three actions after opening the radial.
- [ ] The turret uses a buffer and can be recharged by a cylinder/the network.
- [ ] It is possible to fold, carry and reinstall a turret.
- [ ] A structure left behind can use Last Shot.
- [ ] Scrap and fuel have distinct, clear roles.
- [ ] The Trail grows, changes the director and enters Pursuit.
- [ ] The horde applies pressure without causing artificial defeat when a clock runs out.
- [ ] Automatic weapons protect the player but do not replace defenses.
- [ ] Route choice communicates reward and risk.
- [ ] Victory and defeat have complete transitions.
- [ ] There are no runtime links to local absolute paths.
- [ ] All assets load via the manifest and have their license copied.
- [ ] The scene holds 60 FPS with 100 active enemies on the target hardware.
- [ ] There is no excessive object/array creation in hot loops.
- [ ] There are no unexpected errors or warnings in the console.

## 25. Risks and safeguards

### Turning into a tedious escort mission

Each maintenance action needs to produce a large, immediate result. Avoid many small bars and refueling every few seconds. A turret should run 30–45 s per cycle.

### Bad building on a controller

Use a radial, slow motion, generous snapping, an optional grid, automatic rotation and clear prompts. Do not require a virtual mouse cursor.

### "Recover everything" always being the right answer

Limit transport, allow partial recovery and make Last Shot strong. Abandoning has to be a valid decision.

### The spider covering the player

Occlusion fade, weighted camera and a player silhouette/outline. Avoid tall modules on the camera side.

### The personal build replacing building

Keep personal damage at 30–40%, limit weapons and make personal upgrades interact with the machines.

### Hordes being too expensive

Pools, spatial hash, flow field, prop instancing, reduced animation at distance and a cap on full skinned meshes.

### The spider asset consuming the project

Use a composite proxy and simple procedural legs until the loop is validated. Do not build the definitive rig/IK before that.

## 26. Official technical sources

- [W3C Gamepad API and standard layout](https://www.w3.org/TR/gamepad/)
- [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)
- [Three.js AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html)
- [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)
- [Three.js Animation System](https://threejs.org/manual/en/animation-system.html)

## 27. Final definition of the product

The project is correctly implemented when the player, using only the DualShock 4, can follow the moving spider, build two alternating defensive lines, refuel and recover machines, choose what to sacrifice, survive a horde drawn by the Trail and reach the next shelter feeling that their decisions — and not just their numbers — determined the outcome.


##

You will find the assets under your local asset library root (`ASSET_SOURCE_ROOT`); that is where the referenced subfolders live.



THIS IS THE MOST IMPORTANT PART

It should be utterly perfect, visually beautiful, with every single thing done at AAA quality—from textures to physics to anything you could think of.

Fan out sub-agents and have sub-agents tackle each one individually so that the game is utterly perfect. You should /loop on each item and have a separate sub-agent check it visually to ensure it looks triple A. That separate sub-agent should be a really harsh critic, and if it doesn't look triple A, it should keep going.

Don't stop until each sub-agent is utterly wowed with the quality when compared with deep rock galatic survivor or other AAA game. It should literally compare them side by side blind and say which one looks better. Do this in ThreeJS. /loop until it's utterly perfect. Fan out sub-agents and ultracode.

FEEL FREE TO CHANGE ANYTHING AS LONG AS IT WILL PRODUCE A BETTER GAMER.
