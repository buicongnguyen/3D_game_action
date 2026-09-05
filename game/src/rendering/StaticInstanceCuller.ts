import { DynamicDrawUsage, type InstancedMesh } from "three";

/** Compact static scenery without changing the authored layout or navigation. */
export class StaticInstanceCuller {
  private readonly entries: { mesh: InstancedMesh; matrices: Float32Array; colors: Float32Array | null; count: number; extent: number }[] = [];
  private x = Infinity;
  private z = Infinity;
  private radius = -1;

  add(mesh: InstancedMesh): void {
    mesh.geometry.computeBoundingSphere();
    let maxScale = 1;
    const matrices = new Float32Array(mesh.instanceMatrix.array.slice(0, mesh.count * 16));
    for (let i = 0; i < mesh.count; i++) {
      const offset = i * 16;
      for (let axis = 0; axis < 3; axis++) maxScale = Math.max(maxScale,
        Math.hypot(matrices[offset + axis * 4], matrices[offset + axis * 4 + 1], matrices[offset + axis * 4 + 2]));
    }
    const sphere = mesh.geometry.boundingSphere!;
    this.entries.push({ mesh, matrices,
      colors: mesh.instanceColor ? new Float32Array(mesh.instanceColor.array.slice(0, mesh.count * 3)) : null,
      count: mesh.count, extent: (sphere.radius + sphere.center.length()) * maxScale });
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.instanceColor?.setUsage(DynamicDrawUsage);
    this.radius = -1;
  }

  update(x: number, z: number, radius: number): void {
    if (Math.hypot(x - this.x, z - this.z) < 3 && Math.abs(radius - this.radius) < 1) return;
    this.x = x;
    this.z = z;
    this.radius = radius;
    for (const entry of this.entries) {
      const { mesh, matrices, colors } = entry;
      // Includes camera motion between rebuilds and off-screen shadow casters.
      const reachSq = (radius + entry.extent + 18) ** 2;
      const target = mesh.instanceMatrix.array;
      const targetColors = mesh.instanceColor?.array;
      let count = 0;
      for (let i = 0; i < entry.count; i++) {
        const source = i * 16;
        if ((matrices[source + 12] - x) ** 2 + (matrices[source + 14] - z) ** 2 > reachSq) continue;
        for (let n = 0; n < 16; n++) target[count * 16 + n] = matrices[source + n];
        if (colors && targetColors) for (let n = 0; n < 3; n++) targetColors[count * 3 + n] = colors[i * 3 + n];
        count++;
      }
      mesh.count = count;
      if (!count) continue;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, count * 3);
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  clear(): void {
    this.entries.length = 0;
    this.radius = -1;
  }
}
