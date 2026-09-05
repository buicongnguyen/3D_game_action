import { describe, expect, it } from "vitest";
import { BoxGeometry, Color, InstancedMesh, Matrix4, MeshBasicMaterial } from "three";
import { StaticInstanceCuller } from "../src/rendering/StaticInstanceCuller.ts";
import { Random } from "../src/core/Random.ts";
import { buildTreeGeometry, buildBushGeometry, buildRockGeometry, buildRuinedHouseGeometry } from "../src/art/environment.ts";
import { MeshForge } from "../src/art/MeshForge.ts";

describe("static scenery compaction", () => {
  it("preserves original colors/transforms on return and zoom-out", () => {
    const mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 3);
    const culler = new StaticInstanceCuller();
    try {
      [0, 100, 200].forEach((x, i) => {
        mesh.setMatrixAt(i, new Matrix4().makeTranslation(x, 0, 0));
        mesh.setColorAt(i, new Color(i === 0 ? 0xff0000 : i === 1 ? 0x00ff00 : 0x0000ff));
      });
      culler.add(mesh);
      culler.update(100, 0, 10);
      expect(mesh.count).toBe(1);
      expect(mesh.instanceMatrix.array[12]).toBe(100);
      expect(mesh.instanceColor!.array[1]).toBe(1);
      const version = mesh.instanceMatrix.version;
      culler.update(101, 0, 10);
      expect(mesh.instanceMatrix.version).toBe(version);
      culler.update(1000, 0, 10);
      expect(mesh.count).toBe(0);
      culler.update(0, 0, 10);
      expect(mesh.count).toBe(1);
      expect(mesh.instanceMatrix.array[12]).toBe(0);
      expect(mesh.instanceColor!.array[0]).toBe(1);
      culler.update(0, 0, 250);
      expect(mesh.count).toBe(3);
      expect(mesh.instanceMatrix.array[44]).toBe(200);
      expect(mesh.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 48 }]);
      culler.clear();
      culler.update(1000, 0, 10);
      expect(mesh.count).toBe(3);
    } finally {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
      mesh.dispose();
    }
  });

  it("keeps large props whose centers lie outside the view", () => {
    const mesh = new InstancedMesh(new BoxGeometry(20, 20, 20), new MeshBasicMaterial(), 1);
    try {
      mesh.setMatrixAt(0, new Matrix4().makeTranslation(25, 0, 0));
      const culler = new StaticInstanceCuller();
      culler.add(mesh);
      culler.update(0, 0, 10);
      expect(mesh.count).toBe(1);
    } finally {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
      mesh.dispose();
    }
  });
});

describe("procedural asset quality budgets", () => {
  it.each([buildTreeGeometry, buildBushGeometry, buildRockGeometry, buildRuinedHouseGeometry])("generates finite, reproducible, bounded geometry (%#)", (build) => {
    for (let variant = 0; variant < 3; variant++) {
      const first = build(variant, new Random(101));
      const second = build(variant, new Random(101));
      try {
        const positions = first.getAttribute("position");
        expect(positions.count).toBeLessThan(6000);
        expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
        expect(Array.from(positions.array)).toEqual(Array.from(second.getAttribute("position").array));
        expect(first.getAttribute("color").count).toBe(positions.count);
      } finally { first.dispose(); second.dispose(); }
    }
  });

  it("gives every special item its own cached geometry instead of scrap", () => {
    const forge = new MeshForge();
    try {
      const kinds = ["scrap", "repairKit", "armorPlate", "shockMine", "weaponPart", "fuel", "cylinder"];
      const signatures = kinds.map((kind) => {
        const geometry = forge.pickupGeometry(kind);
        expect(forge.pickupGeometry(kind)).toBe(geometry);
        expect(geometry.getAttribute("position").count).toBeLessThan(6000);
        return Array.from(geometry.getAttribute("position").array).join(",");
      });
      expect(new Set(signatures).size).toBe(kinds.length);
    } finally { forge.dispose(); }
  });
});
