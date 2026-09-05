import { describe, expect, it, vi } from "vitest";
import { BufferGeometry, Color, Group, Matrix4, Quaternion, Vector3, type InstancedMesh, type Material } from "three";
import { MeshForge } from "../src/art/MeshForge.ts";
import { WorldView } from "../src/rendering/WorldView.ts";
import { GameWorld } from "../src/game/GameWorld.ts";
import type { PickupKind } from "../src/core/types.ts";

const kinds: PickupKind[] = ["scrap", "fuel", "cylinder", "repairKit", "pressureCanister", "shockMine", "armorPlate", "weaponPart"];

describe("runtime asset integration", () => {
  it("keeps cached single-mesh pickup geometry alive until forge disposal", () => {
    const forge = new MeshForge();
    const dispose = vi.spyOn(BufferGeometry.prototype, "dispose");
    try {
      const geometry = forge.pickupGeometry("repairKit");
      expect(dispose.mock.contexts.filter((context) => context === geometry)).toHaveLength(0);
      expect(forge.pickupGeometry("repairKit")).toBe(geometry);
      forge.dispose();
      expect(dispose.mock.contexts.filter((context) => context === geometry)).toHaveLength(1);
    } finally { dispose.mockRestore(); }
  });

  it("uses all eight real pickup models in gameplay and clears expired instances", () => {
    const forge = new MeshForge();
    const world = new GameWorld(64);
    const meshes = new Map<string, InstancedMesh>();
    const view = Object.create(WorldView.prototype) as {
      buildPickups(): void;
      syncPickups(world: GameWorld): void;
      pickupGlow: InstancedMesh;
    };
    Object.assign(view, { forge, root: new Group(), pickupMeshes: meshes, clock: 1,
      position: new Vector3(), scale: new Vector3(), quaternion: new Quaternion(),
      matrix: new Matrix4(), tempColor: new Color() });
    view.buildPickups();
    try {
      for (const [index, kind] of kinds.entries()) {
        const pickup = world.pickups.acquire()!;
        Object.assign(pickup, { active: true, kind, x: index * 3, z: 2,
          phase: 0, attracted: false });
        expect(meshes.get(kind)!.geometry).toBe(forge.pickupGeometry(kind));
      }
      view.syncPickups(world);
      expect(view.pickupGlow.count).toBe(kinds.length);
      for (const [index, kind] of kinds.entries()) {
        const mesh = meshes.get(kind)!;
        expect(mesh.count).toBe(1);
        expect(mesh.instanceMatrix.array[12]).toBe(index * 3);
        expect(mesh.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 16 }]);
        expect(Array.from(mesh.instanceMatrix.array.slice(0, 16)).every(Number.isFinite)).toBe(true);
      }
      for (const pickup of world.pickups.backing) pickup.active = false;
      view.syncPickups(world);
      expect(view.pickupGlow.count).toBe(0);
      for (const mesh of meshes.values()) expect(mesh.count).toBe(0);
    } finally {
      for (const mesh of meshes.values()) mesh.dispose();
      view.pickupGlow.geometry.dispose();
      (view.pickupGlow.material as Material).dispose();
      view.pickupGlow.dispose();
      forge.dispose();
    }
  });
});
