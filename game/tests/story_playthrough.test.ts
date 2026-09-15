import { describe, expect, it } from "vitest";
import { StorySimulation } from "../src/story/StorySimulation.ts";
import { HILL_LAUNCH, HOME_LENGTH, MAZE_CRATES, MAZE_EXIT, MAZE_PEN, clearLine, mazeDistances, mazeWaypoint } from "../src/story/StoryMaps.ts";
import type { Point } from "../src/story/StoryData.ts";

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
function towards(a: Point, b: Point) { const d = distance(a, b); return d > 0.1 ? { x: (b.x - a.x) / d, z: (b.z - a.z) / d } : { x: 0, z: 0 }; }

describe("Homeward real combat playthrough", () => {
  it("can win the defense using real automatic weapons, pickups and stones", () => {
    const sim = new StorySimulation(71309); sim.start();
    for (let tick = 0; tick < 60 * 600 && sim.state.status === "playing"; tick++) {
      const s = sim.state;
      let target: Point = HILL_LAUNCH;
      const webbed = s.cows.find(c => c.status === "webbed");
      const pickup = [...s.pickups].sort((a,b) => distance(a,s.player)-distance(b,s.player))[0];
      if (webbed) target = webbed;
      else if (s.progress.shells < 5 && pickup) target = pickup;
      const move = towards(s.player,target);
      sim.step(1/60, { ...move, action: sim.canAct(), dodge: false });
    }
    expect({status:sim.state.status,hp:sim.state.player.hp,kills:sim.state.killed,time:sim.state.time}).toMatchObject({status:"complete",kills:40});
    expect(sim.state.progress.safeAtFarm).toBeGreaterThan(0);
  });
  it("can traverse the maze on foot without teleporting or shooting through walls", () => {
    const sim = new StorySimulation(); sim.state.status = "complete"; sim.nextChapter(); sim.start();
    const goals = [MAZE_CRATES[0], MAZE_PEN, MAZE_EXIT]; let goal = 0;
    for (let tick=0;tick<60*500 && sim.state.status!=="complete" && sim.state.status!=="defeat";tick++) {
      const s=sim.state;
      if(s.status==='upgrade'){sim.chooseUpgrade('damage');goal++;continue;}
      if(s.penOpen&&goal===1)goal++;
      const destination=goals[Math.min(goal,2)];
      const target=clearLine(2,s.player,destination)?destination:mazeWaypoint(s.player,mazeDistances(destination));
      sim.step(1/60,{...towards(s.player,target),action:distance(s.player,destination)<2.5,dodge:false});
    }
    expect({status:sim.state.status,hp:sim.state.player.hp,at:sim.state.player,pen:sim.state.penOpen}).toMatchObject({status:"complete",pen:true});
  });
  it("can beat the Queen with ordinary movement and weapons, then secure the cows", () => {
    const sim = new StorySimulation(); for(let i=1;i<3;i++){sim.state.status='complete';sim.nextChapter();}sim.start();
    for(let tick=0;tick<60*360&&sim.state.status==='playing';tick++){
      const s=sim.state,queen=s.enemies.find(e=>e.kind==='queen');
      let target:Point={x:0,z:-23};
      if(queen){
        const angle=s.time*0.30;
        target={x:queen.x+Math.sin(angle)*12,z:queen.z+Math.cos(angle)*12};
        const near=s.enemies.filter(e=>e.kind!=='queen'&&distance(e,s.player)<8).length;
        sim.selectWeapon(s.player.heat>0.8?'rifle':near>2?'flame':s.queenPhase==='open'?'laser':'rocket');
      }
      sim.step(1/60,{...towards(s.player,target),action:!queen&&sim.canAct(),dodge:!!queen&&s.queenPhase==='warning'&&s.queenClock<0.5&&distance(s.player,s.slam)<5.5});
    }
    expect({status:sim.state.status,hp:sim.state.player.hp,boss:sim.state.bossDefeated,time:sim.state.time}).toMatchObject({status:'complete',boss:true});
    expect(sim.state.progress.rescued).toBe(sim.state.progress.missing);
  });
  it("can escort the machine through real ambushes with repairs and turrets",()=>{
    const sim=new StorySimulation();for(let i=1;i<4;i++){sim.state.status='complete';sim.nextChapter();}sim.start();
    for(let tick=0;tick<60*240&&sim.state.status==='playing';tick++){
      const s=sim.state;
      let target:Point={x:s.machine.x+6,z:s.machine.z-4};
      const pickup=s.pickups.find(p=>p.kind==='supply'&&distance(p,s.machine)<15);
      if(pickup)target=pickup;
      sim.selectWeapon(s.player.heat>0.75?'rifle':'laser');
      if(s.machine.hp<240)s.selectedAction='context';
      else if(s.turrets.length<6&&s.progress.shells>=8&&s.turrets.every(t=>distance(t,s.player)>14))s.selectedAction='turret';
      else s.selectedAction='context';
      sim.step(1/60,{...towards(s.player,target),action:sim.canAct(),dodge:false});
    }
    expect({status:sim.state.status,hp:sim.state.player.hp,machine:sim.state.machine.hp,distance:sim.state.machine.distance}).toMatchObject({status:'victory',distance:HOME_LENGTH});
  });
});
