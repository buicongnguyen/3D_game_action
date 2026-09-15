import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Group, Mesh, Vector3 } from "three";
import { buildSpider, machineCache } from "../src/art/machines.ts";
import { MaterialLibrary } from "../src/art/materials.ts";
import { animateSpider, captureSpiderRest } from "../src/rendering/AnimationSystem.ts";
import { MiniSpiderBatch } from "../src/story/MiniSpiderBatch.ts";
import { StorySimulation } from "../src/story/StorySimulation.ts";

const materials = new MaterialLibrary();
afterEach(() => machineCache.dispose());
afterAll(() => materials.dispose());
describe("Simplified original Spider enemies", () => {
  it("reuses original joint proportions with fewer triangles and no furnace materials", () => {
    const hero = buildSpider(materials), mini = buildSpider(materials, true);
    const vertices = (root: Group) => { let n = 0; root.traverse(o => { if (o instanceof Mesh) n += o.geometry.getAttribute("position").count; }); return n; };
    expect(vertices(mini.root)).toBeLessThan(vertices(hero.root) * 0.65);
    expect(mini.furnace.children).toHaveLength(0); expect(mini.smokestacks).toHaveLength(0);
    expect(mini.legs).toHaveLength(8);
    for (let i = 0; i < 8; i++) {
      expect(mini.legs[i].position.equals(hero.legs[i].position)).toBe(true);
      expect(mini.legs[i].userData).toEqual(hero.legs[i].userData);
    }
  });
  it.each([30, 60, 120])("keeps mini feet planted above raised sloping ground at %i Hz", hz => {
    const rig = buildSpider(materials, true); rig.root.scale.setScalar(0.25); captureSpiderRest(rig);
    const ground = (x: number, z: number) => 6 + x * 0.04 + z * 0.025;
    const tip = new Vector3(), previous = Array.from({length:8},()=>new Vector3());
    let planted = 0;
    for (let frame = 0; frame < hz * 3; frame++) {
      rig.root.position.z += 1.8 / hz;
      rig.root.position.y = ground(rig.root.position.x, rig.root.position.z);
      rig.root.rotation.y = Math.sin(frame / hz) * 0.12;
      animateSpider(rig, 1 / hz, 1.8, false, false, 0, ground);
      rig.root.updateMatrixWorld(true);
      for (let i = 0; i < 8; i++) {
        tip.set(0, 0, 0.75).applyMatrix4(rig.legFoot[i].matrixWorld);
        expect(tip.y).toBeGreaterThanOrEqual(ground(tip.x,tip.z)-0.03);
        if (frame && Math.abs(tip.y-ground(tip.x,tip.z)) < 0.001 && Math.abs(previous[i].y-ground(previous[i].x,previous[i].z)) < 0.001) {
          expect(tip.distanceTo(previous[i])).toBeLessThan(0.001); planted++;
        }
        previous[i].copy(tip);
      }
    }
    expect(planted).toBeGreaterThan(hz);
  });
  it("batches 48 walkers in four draws, removes dead walkers, and resets chapter IDs", () => {
    const sim = new StorySimulation(), batch = new MiniSpiderBatch(new Group(), materials);
    for (let i = 0; i < 48; i++) sim.spawn("broodling", {x:i % 8,z:Math.floor(i/8)});
    batch.update(sim.state.enemies,1/60,1);
    expect(batch.meshes.map(m=>m.count)).toEqual([48,384,384,384]);
    sim.state.enemies[0].hp = 0; batch.update(sim.state.enemies,1/60,1);
    expect(batch.meshes[0].count).toBe(47);
    batch.update([],1/60,2); expect(batch.meshes.every(m=>m.count===0)).toBe(true);
    batch.dispose();
  });
});
