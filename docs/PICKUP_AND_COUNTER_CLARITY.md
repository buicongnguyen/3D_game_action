# Pickup and counter clarity review

Implemented 2026-09-10. Scope: explain collections and displayed quantities without changing drop rates, costs, combat balance, or save format.

## Problems confirmed

- Mixed drops immediately replaced one another in the old receipt. Names such as PART, CAN and KIT did not explain purpose.
- Fuel pickups increased the reserve, but only Spider tank fuel was shown. This made successful collections look ineffective.
- Weapon parts were a lifetime counter with a modulo-three progress indicator. The reset to zero looked like lost inventory, even though an automatic damage boost had been awarded.
- Weapon position, weapon Mark, engineer level, build shortcut and price all used small numbers without clear context.
- Mission progress lacked units; travel ETA was misleading while the Spider was stopped.
- Collected item toasts advertised controller R1 even on keyboard. Phone users had no direct Use item button.

## Completed changes

- [x] Name all eight pickup kinds, normalize the two pressure-canister variants, and explain each effect.
- [x] Keep receipts for six seconds, merge same-kind gains, and retain up to seven distinct resource groups. Display the three most recent groups plus an overflow count; Inventory always shows all current totals.
- [x] Use compact phone/short-screen notices to keep the Spider visible. Full descriptions live in a paused, scrollable Inventory guide.
- [x] Show Scrap, Canisters and Fuel reserve by name; label the Spider gauge Fuel tank.
- [x] Show full field-item names and parts remaining toward the next +8% gun-damage boost, alongside boosts already earned. Inventory separately labels parts collected this run.
- [x] Add Inventory / guide to the HUD and pause menu. Keyboard/controller directional input scrolls the reference; mouse wheel and touch swiping also work.
- [x] Add a tap/click Use item action using the existing field-item system. Priority remains nearby machine repair, self-heal, Spider armor, then mine deployment. Opening the guide never consumes items.
- [x] Label Stage N of 9, distance travelled %, weapon Mk, Engineer Lv, XP to next level, Key N shortcuts and Scrap prices.
- [x] Add objective units (seconds assisted/powered/survived, scrap collected, enemies defeated, machines recovered, nests cleared). Keep the mission deadline separately labelled as time left.
- [x] Label ETA versus checkpoint halt countdown, and show Stopped instead of a false travel estimate.
- [x] Use consistent tenth-unit resource displays and round purchase shortfalls upward to avoid promising an unaffordable purchase.
- [x] Clarify workshop previews, turret upgrade counts, damage per rivet and salvos per second. Clarify summary percentages and machine counters.
- [x] Remove redundant pickup toasts with wrong device instructions; retain a distinct notification for automatic parts boosts using the actual compounded multiplier.

## Verification

- Asset validation, TypeScript, production build: passed.
- 390 tests across 33 files: passed. New coverage includes mixed receipts, expiry, canister aliases, compact notices, resource precision, objective units, real reserve collection and real multi-boost part collection.
- Eleven browser scenarios passed: desktop 1280×720, portrait 390×844, landscape 844×390.
- Browser assertions check actual collection receipts, build cost units, all seven inventory entries, paused simulation, opening and closing the guide, nested pause navigation, directional scrolling, item consumption, and mission units. Existing workshop purchase checks also pass.
- Screenshots are in `docs/pickup-review/{desktop,mobile,landscape}`. Phone receipts were shortened after visual inspection showed the initial full notices obscured the Spider.

## Performance and boundaries

No added 3D meshes, lights, textures or draw calls. Receipt groups are bounded and text is cached until a pickup or expiry changes it. Reference cards are constructed only when opening Inventory, while gameplay is paused. No hardware FPS claim is made from these headless UI checks.

This change does not redesign mobile movement or touch refuelling; it adds direct item use and a readable reference. Fuel transfer still uses the existing contextual service control. Currency is shown to tenths; the simulation retains its existing full precision.

The implementation was originally delivered locally. The user subsequently requested publication together with the Blender artwork; release history and deployment results are recorded by Git and the existing GitHub Pages workflow.
