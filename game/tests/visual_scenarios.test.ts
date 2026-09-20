import { describe, expect, it, vi } from "vitest";
import { BoxGeometry, InstancedMesh, Matrix4, Scene, Vector3 } from "three";
import { MeshForge } from "../src/art/MeshForge.ts";
import { VfxSystem } from "../src/rendering/VfxSystem.ts";
import { SurfaceDetail, surfaceUV, surfaceValue } from "../src/rendering/SurfaceDetail.ts";
import { StoryEffectBridge } from "../src/story/StoryEffectBridge.ts";
import { StorySimulation } from "../src/story/StorySimulation.ts";

describe("terrain detail", () => {
  it("keeps detail deterministic and low contrast", () => {
    for (const style of ["yellow", "factory", "civil", "mountain", "brown", "crystal", "flower"] as const) {
      for (let x = 0; x < 128; x++) {
        const value = surfaceValue(style, x, 31);
        expect(value).toBe(surfaceValue(style, x, 31));
        expect(value).toBeGreaterThanOrEqual(0.82); expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
  it("shares textures and releases them", () => {
    const surfaces = new SurfaceDetail(), texture = surfaces.get("brown"), disposed = vi.fn();
    texture.addEventListener("dispose", disposed);
    expect(surfaces.get("brown")).toBe(texture);
    surfaces.dispose(); expect(disposed).toHaveBeenCalledTimes(1);
    expect(surfaces.get("brown")).not.toBe(texture); surfaces.dispose();
  });
  it("uses world coordinates without changing geometry", () => {
    const geometry = new BoxGeometry(), before = geometry.getAttribute("position").array.slice();
    surfaceUV(geometry, 2, 3, 24, 48);
    expect(geometry.getAttribute("position").array).toEqual(before);
    expect(geometry.getAttribute("uv").getX(0)).toBeCloseTo((before[0] * 2 + 24) / 24);
    geometry.dispose();
  });
});
describe("story cosmetic events", () => {
  const pool = () => ({ clear: vi.fn(), weaponFlash: vi.fn(), impact: vi.fn(), deathPoof: vi.fn(), explosion: vi.fn(), update: vi.fn() });
  it("emits once through paused renders and uses the fired weapon", () => {
    const sim = new StorySimulation(), vfx = pool(), bridge = new StoryEffectBridge(vfx, () => 6);
    sim.state.effects.push({ kind: "muzzle", x: 0, z: 0, toX: 0, toZ: 4, radius: 1, life: 0.16, maxLife: 0.16, weapon: "rocket" });
    sim.state.progress.selected = "rifle";
    bridge.update(sim.state, 0); bridge.update(sim.state, 0);
    expect(vfx.weaponFlash).toHaveBeenCalledExactlyOnceWith(0, 7.1, 0.8, 0, "launcher");
    expect(vfx.clear).toHaveBeenCalledTimes(1); expect(vfx.update).toHaveBeenLastCalledWith(0);
  });
  it("clears particles on replacement state and leaves hazards to gameplay", () => {
    const vfx = pool(), bridge = new StoryEffectBridge(vfx, () => 0), sim = new StorySimulation();
    sim.state.effects.push({ kind: "web", x: 0, z: 0, toX: 0, toZ: 0, radius: 3, life: 5, maxLife: 5 });
    bridge.update(sim.state, 0.01); bridge.update(new StorySimulation().state, 0);
    expect(vfx.clear).toHaveBeenCalledTimes(2); expect(vfx.explosion).not.toHaveBeenCalled();
    expect(sim.state.effects[0].life).toBe(5);
  });
});
describe("pooled terrain-relative effects", () => {
  it("stays above the hill, freezes when paused and can reuse a cleared pool", () => {
    const forge = new MeshForge(); forge.build();
    const scene = new Scene(), vfx = new VfxSystem(scene, forge, () => 6); vfx.prepare();
    vfx.explosion(0, 0, 3); vfx.update(0.01);
    const before: number[][] = [];
    scene.traverse(node => {
      if (!(node instanceof InstancedMesh) || !node.count) return;
      for (let i = 0; i < node.count; i++) {
        const matrix = new Matrix4(); node.getMatrixAt(i, matrix);
        expect(new Vector3().setFromMatrixPosition(matrix).y).toBeGreaterThan(6);
      }
      before.push(Array.from(node.instanceMatrix.array));
    });
    const count = vfx.activeEffects; vfx.update(0);
    const after: number[][] = []; scene.traverse(node => { if (node instanceof InstancedMesh && node.count) after.push(Array.from(node.instanceMatrix.array)); });
    expect(after).toEqual(before); expect(vfx.activeEffects).toBe(count);
    vfx.clear(); expect(vfx.activeEffects).toBe(0);
    vfx.weaponFlash(0, 7, 0, 0, "flamer"); vfx.update(0.01); expect(vfx.activeEffects).toBe(2);
    vfx.dispose(); forge.dispose();
  });
});
