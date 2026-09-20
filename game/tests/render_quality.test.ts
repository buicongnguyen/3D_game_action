import { describe, expect, it, vi } from "vitest";
import { Group, InstancedMesh, Object3D } from "three";
import { AdaptiveResolution, chooseQuality, DESKTOP_QUALITY, drawingRatio, MOBILE_QUALITY } from "../src/rendering/RenderQuality.ts";
import { MeshForge } from "../src/art/MeshForge.ts";
import { TerrainBuilder } from "../src/rendering/TerrainBuilder.ts";
import { GameWorld } from "../src/game/GameWorld.ts";
import { MiniSpiderBatch } from "../src/story/MiniSpiderBatch.ts";
import { StorySimulation } from "../src/story/StorySimulation.ts";
import { buildSpider } from "../src/art/machines.ts";
import { solveSpiderLegs } from "../src/rendering/SpiderLegSolver.ts";

describe("render quality without gameplay changes", () => {
  it("detects touch-first phones/tablets but not ordinary touch laptops", () => {
    expect(chooseQuality(true, 5, "")).toBe(MOBILE_QUALITY);
    expect(chooseQuality(false, 0, "Android")).toBe(MOBILE_QUALITY);
    expect(chooseQuality(false, 10, "Windows")).toBe(DESKTOP_QUALITY);
    expect(chooseQuality(true, 5, "iPad", "high")).toBe(DESKTOP_QUALITY);
    expect(chooseQuality(false, 0, "Windows", "low")).toBe(MOBILE_QUALITY);
    expect(MOBILE_QUALITY.shadows).toBe(false); expect(MOBILE_QUALITY.maxAnimatedEnemies).toBe(32);
    // Story roadside props alternate left/right; odd strides preserve both.
    expect(MOBILE_QUALITY.decorationStride % 2).toBe(1);
  });
  it("caps physical pixels on retina phones, ultrawide and 4K screens", () => {
    for (const quality of [DESKTOP_QUALITY, MOBILE_QUALITY]) for (const [w,h,dpr] of [[390,844,3],[3840,2160,2],[5120,1440,1]]) {
      const ratio = drawingRatio(w,h,dpr,quality);
      expect(w*h*ratio*ratio).toBeLessThanOrEqual(quality.pixelBudget + 0.01);
      expect(ratio).toBeLessThanOrEqual(quality.maxDpr);
    }
    expect(drawingRatio(390,844,3,MOBILE_QUALITY)).toBe(1.25);
  });
  it("ignores isolated stalls, lowers sustained load and recovers slowly", () => {
    const resolution = new AdaptiveResolution();
    resolution.sample(1); resolution.sample(NaN); expect(resolution.scale).toBe(1);
    for(let i=0;i<200;i++)resolution.sample(1/30);
    expect(resolution.scale).toBe(0.75);
    for(let i=0;i<60;i++)resolution.sample(1/60);
    expect(resolution.scale).toBe(0.75);
    for(let i=0;i<1500;i++)resolution.sample(1/60);
    expect(resolution.scale).toBe(1);
  });
  it("keeps identical navigation/solid scenery while thinning only decoration", () => {
    const forge = new MeshForge(); forge.build();
    const roots = [new Group(), new Group()], worlds = [new GameWorld(713), new GameWorld(713)];
    const terrains = [new TerrainBuilder(forge, roots[0], DESKTOP_QUALITY), new TerrainBuilder(forge, roots[1], MOBILE_QUALITY)];
    try {
      worlds.forEach((w,i)=>{w.route.enterSegment("seg.approach");terrains[i].build(w);terrains[i].sceneryVisibility.update(0,0,10000);});
      for(let i=0;i<worlds[0].navigation.cellCount;i++)expect(worlds[0].navigation.isBlocked(i)).toBe(worlds[1].navigation.isBlocked(i));
      const trees = roots.map(root => root.getObjectByName("prop.treeBroadleaf") as InstancedMesh);
      expect(trees[0].count).toBe(trees[1].count); expect(trees[0].instanceMatrix.array).toEqual(trees[1].instanceMatrix.array);
      const grass = roots.map(root => root.getObjectByName("prop.grass") as InstancedMesh);
      expect(grass[1].count).toBe(Math.ceil(grass[0].count / 3));
    } finally { terrains.forEach(t=>t.dispose()); forge.dispose(); }
  });
  it("culls only off-screen Spider visuals and restores them without changing enemy state", () => {
    const forge = new MeshForge(); forge.build();
    const batch = new MiniSpiderBatch(new Group(), forge.materials), sim = new StorySimulation();
    sim.spawn("broodling", {x:0,z:0}); sim.spawn("broodling", {x:150,z:0});
    const before=JSON.stringify(sim.state.enemies);
    try {
      batch.update(sim.state.enemies,1/60,1,{x:0,z:0,radius:30}); expect(batch.meshes[0].count).toBe(1);
      batch.update(sim.state.enemies,1/60,1,{x:150,z:0,radius:30}); expect(batch.meshes[0].count).toBe(1);
      batch.update(sim.state.enemies,1/60,1); expect(batch.meshes[0].count).toBe(2);
      expect(JSON.stringify(sim.state.enemies)).toBe(before);
      expect(batch.meshes[0].instanceMatrix.updateRanges).toEqual([{start:0,count:32}]);
    } finally { batch.dispose(); forge.dispose(); }
  });
  it.each([false, true])("bounds Spider IK transform work independently of decorative complexity (mini=%s)", mini => {
    const forge = new MeshForge(); forge.build();
    const rig = buildSpider(forge.materials, mini);
    const updates = vi.spyOn(Object3D.prototype, "updateMatrix");
    try {
      solveSpiderLegs(rig, 1/60, 1, true);
      // Eight three-joint chains plus the shared root/body transforms, not
      // whole-model traversal or repeated ancestor walks for every foot.
      expect(updates.mock.calls.length).toBeLessThanOrEqual(32);
    } finally { updates.mockRestore(); forge.dispose(); }
  });
});
