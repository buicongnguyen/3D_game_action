import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { Box3, Mesh, Scene, Vector3, InstancedMesh } from "three";
import { BlenderLibrary, BLENDER_IDS, houseAssetFor } from "../src/art/BlenderLibrary.ts";
import { MeshForge } from "../src/art/MeshForge.ts";
import { HordeBatch } from "../src/rendering/HordeBatch.ts";
import { VfxSystem } from "../src/rendering/VfxSystem.ts";

function bytes(): ArrayBuffer {
  const data = readFileSync(new URL("../public/assets/blender/iron-march.glb", import.meta.url));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

describe("Blender export and runtime integration", () => {
  it("ships 34 finite, indexed, vertex-colored assets within the download budget", async () => {
    const data = bytes();
    expect(data.byteLength).toBeLessThan(2_500_000);
    const library = await BlenderLibrary.parse(data);
    expect(library.size).toBe(34);
    for (const id of BLENDER_IDS) {
      const geo = library.get(id)!;
      expect(Object.keys(geo.attributes).sort()).toEqual(["color", "normal", "position"]);
      expect(geo.index!.count % 3).toBe(0);
      expect(geo.getAttribute("color").itemSize).toBe(3);
      expect(geo.boundingSphere!.radius).toBeGreaterThan(0);
      for (const attr of Object.values(geo.attributes)) expect(Array.from(attr.array).every(Number.isFinite)).toBe(true);
    }
    for (const name of ["house_cottage", "house_foundry", "house_town"]) {
      const box = library.get(name)!.boundingBox!;
      expect(box.min.y).toBeCloseTo(0, 3);
      expect(box.max.x - box.min.x).toBeLessThan(5.5);
      expect(box.max.z - box.min.z).toBeLessThan(4.7);
      expect(box.max.y).toBeGreaterThan(4);
    }
    library.dispose(); expect(library.size).toBe(0);
  });
  it("keeps articulated joints, shared limb geometry and existing horde capacity", async () => {
    const forge = new MeshForge(); forge.build();
    forge.installBlenderLibrary(await BlenderLibrary.parse(bytes()));
    const batch = new HordeBatch(forge.materials.surface, 70, 20000, 72000);
    for (const kind of ["minion", "warrior", "golem"]) {
      const rig = forge.createEnemy(kind);
      const second = forge.createEnemy(kind);
      expect(rig.root).not.toBe(second.root);
      expect((rig.head.children[0] as Mesh).geometry).toBe((second.head.children[0] as Mesh).geometry);
      expect((rig.head.children[0] as Mesh).geometry.name).toBe(`blender:${kind}_head`);
      const ids: number[] = [];
      expect(batch.acquire(rig, ids)).toBe(true);
      batch.update(rig, ids, true);
      const before = new Box3().setFromObject(rig.root);
      expect(before.min.y, kind).toBeGreaterThanOrEqual(-0.02);
      expect(before.max.y).toBeLessThan(2.15);
      rig.legL.rotation.x = .5;
      batch.update(rig, ids, true);
      expect(rig.shinL.parent).toBe(rig.legL);
      batch.release(ids);
    }
    batch.dispose(); forge.dispose();
  });
  it("uses Blender gun geometry while preserving the existing grip and muzzle socket", async () => {
    const forge = new MeshForge(); forge.build();
    forge.installBlenderLibrary(await BlenderLibrary.parse(bytes()));
    const gun = forge.createScattergun();
    expect(gun.getObjectByName("muzzle")!.position.distanceTo(new Vector3(0, .032, .59))).toBeLessThan(.0001);
    for (const [kind, root] of [
      ["shotgun", gun], ["carbine", forge.createGearburstCarbine()], ["rifle", forge.createRivetRifle()],
      ["flamer", forge.createSteamFlamer()], ["arc", forge.createArcProjector()], ["launcher", forge.createMagneticLauncher()],
    ] as const) expect((root.children[0] as Mesh).geometry.name).toBe(`blender:gun_${kind}`);
    forge.dispose();
  });
  it("retains procedural fallback and matches house style to the biome", async () => {
    const forge = new MeshForge(); forge.build();
    expect(forge.propGeometry("house_foundry")).toBe(forge.propGeometry("ruinedHouse"));
    expect(houseAssetFor("factory")).toBe("house_foundry");
    expect(houseAssetFor("civil")).toBe("house_town");
    expect(houseAssetFor("flower")).toBe("house_cottage");
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try { expect(await BlenderLibrary.load("/3D_game_action/")).toBeNull(); }
    finally { fetcher.mockRestore(); warning.mockRestore(); forge.dispose(); }
  });
  it("loads using the GitHub Pages base path and rejects malformed or oversized data", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(bytes()));
    try {
      const library = await BlenderLibrary.load("/3D_game_action/");
      expect(fetcher.mock.calls[0][0]).toBe("/3D_game_action/assets/blender/iron-march.glb");
      expect(library?.size).toBe(34); library?.dispose();
    } finally { fetcher.mockRestore(); }
    await expect(BlenderLibrary.parse(new ArrayBuffer(2_500_001))).rejects.toThrow("budget");
    await expect(BlenderLibrary.parse(new ArrayBuffer(20))).rejects.toThrow();
  });
  it("aborts a stalled download after eight seconds so boot can use fallback art", async () => {
    vi.useFakeTimers();
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const pending = BlenderLibrary.load("./");
      await vi.advanceTimersByTimeAsync(8000);
      expect(await pending).toBeNull();
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    } finally { fetcher.mockRestore(); warning.mockRestore(); vi.useRealTimers(); }
  });
  it("pools event meshes, updates finite transforms, expires effects and owns cleanup", async () => {
    const forge = new MeshForge(); forge.build();
    forge.installBlenderLibrary(await BlenderLibrary.parse(bytes()));
    const shared = forge.effectGeometry("flame")!;
    const disposed = vi.fn(); shared.addEventListener("dispose", disposed);
    const scene = new Scene(); const vfx = new VfxSystem(scene, forge); vfx.prepare();
    vfx.weaponFlash(0,1,0,0,"flamer"); vfx.weaponFlash(1,1,0,.7,"arc");
    vfx.muzzleFlash(2,1,0,1,false); vfx.explosion(3,0,3); vfx.overloadVent(4,0,.7);
    vfx.update(.05);
    const active: InstancedMesh[] = [];
    scene.traverse(n => { if (n instanceof InstancedMesh && n.count > 0) active.push(n); });
    expect(active).toHaveLength(5);
    expect(active.find(n => n.name === "vfx.flame")!.geometry).toBe(shared);
    for (const mesh of active) expect(Array.from(mesh.instanceMatrix.array).every(Number.isFinite)).toBe(true);
    vfx.update(5); expect(vfx.activeEffects).toBe(0);
    for (let i = 0; i < 500; i++) vfx.explosion(i, 0, 2);
    vfx.update(.01);
    expect(vfx.activeEffects).toBe(180);
    vfx.update(5); expect(vfx.activeEffects).toBe(0);
    vfx.weaponFlash(0, 1, 0, 0, "flamer"); vfx.update(.01);
    expect(vfx.activeEffects).toBe(2); // Saturation must not leak pool slots.
    vfx.dispose(); expect(disposed).not.toHaveBeenCalled();
    forge.dispose(); expect(disposed).toHaveBeenCalledTimes(1);
  });
});
