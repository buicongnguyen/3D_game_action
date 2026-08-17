import {
  BatchedMesh,
  Matrix4,
  Mesh,
  type BufferGeometry,
  type Color,
  type Material,
  type Object3D,
} from "three";
import type { PuppetRig } from "../art/characters.ts";

/**
 * Draws every articulated enemy in one draw call.
 *
 * The rigid-puppet design gives cheap animation but expensive submission: a
 * skeleton is eleven meshes because its joints must move independently, and
 * three.js issues a draw call per mesh. Twenty-six of them is nearly three
 * hundred calls, which alone blows the whole frame budget.
 *
 * `BatchedMesh` resolves the tension. It holds many geometries in one buffer
 * and gives each instance its own matrix, which is exactly the shape of a
 * puppet: independent transforms, shared material. So the Object3D hierarchy is
 * kept purely as an animation rig - never added to the scene - and each frame
 * its resolved world matrices are copied into batch instances.
 *
 * The result is full articulation for the near horde at the cost of one call.
 */
export class HordeBatch {
  readonly mesh: BatchedMesh;

  /** Stable geometry ids, keyed by the shared geometry the forge cached. */
  private readonly geometryIds = new Map<BufferGeometry, number>();
  private readonly scratch = new Matrix4();
  /** Reusable per-rig scratch, so binding a rig never allocates a new array. */
  private readonly partScratch: Mesh[] = [];

  private instancesUsed = 0;

  constructor(
    material: Material,
    private readonly maxInstances: number,
    maxVertices: number,
    maxIndices: number,
  ) {
    this.mesh = new BatchedMesh(maxInstances, maxVertices, maxIndices, material);
    this.mesh.name = "hordeBatch";
    // Per-object culling would cost a bounds test per limb for a horde that is
    // almost entirely on screen anyway; the whole batch is culled as one.
    this.mesh.perObjectFrustumCulled = false;
    this.mesh.frustumCulled = false;
    this.mesh.sortObjects = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
  }

  /**
   * Binds a rig, returning one instance id per mesh in it, in traversal order.
   * Returns false when the batch is full, so the caller can fall back to an
   * impostor rather than silently dropping the subject.
   */
  acquire(rig: PuppetRig, out: number[]): boolean {
    return this.acquireRoot(rig.root, out);
  }

  /**
   * The same, for any hierarchy. Structures have the identical problem to
   * enemies — a turret is eight meshes with independently moving parts — and
   * they were costing enough draw calls on their own to push the frame past its
   * ceiling, so they share this machinery.
   */
  acquireRoot(root: Object3D, out: number[]): boolean {
    const parts = this.collectParts(root);
    if (this.instancesUsed + parts.length > this.maxInstances) return false;

    out.length = 0;
    for (let i = 0; i < parts.length; i++) {
      const geometry = parts[i].geometry as BufferGeometry;
      let geometryId = this.geometryIds.get(geometry);
      if (geometryId === undefined) {
        geometryId = this.mesh.addGeometry(geometry);
        this.geometryIds.set(geometry, geometryId);
      }
      const instanceId = this.mesh.addInstance(geometryId);
      this.mesh.setVisibleAt(instanceId, true);
      out.push(instanceId);
      this.instancesUsed++;
    }
    return true;
  }

  /**
   * Tints every part of one rig. `BatchedMesh` carries a per-instance colour,
   * so a white hit flash across a hundred bodies costs a few writes rather than
   * a material swap per enemy.
   */
  tint(ids: number[], color: Color): void {
    for (let i = 0; i < ids.length; i++) this.mesh.setColorAt(ids[i], color);
  }

  release(ids: number[]): void {
    for (let i = 0; i < ids.length; i++) {
      this.mesh.deleteInstance(ids[i]);
      this.instancesUsed--;
    }
    ids.length = 0;
  }

  /**
   * Pushes the rig's animated pose into the batch. The rig is not in the scene,
   * so its world matrices have to be resolved explicitly first.
   */
  update(rig: PuppetRig, ids: number[], visible: boolean): void {
    this.updateRoot(rig.root, ids, visible);
  }

  updateRoot(root: Object3D, ids: number[], visible: boolean): void {
    if (ids.length === 0) return;
    if (!visible) {
      for (let i = 0; i < ids.length; i++) this.mesh.setVisibleAt(ids[i], false);
      return;
    }

    root.updateMatrixWorld(true);
    const parts = this.collectParts(root);
    const count = Math.min(parts.length, ids.length);
    for (let i = 0; i < count; i++) {
      this.scratch.copy(parts[i].matrixWorld);
      this.mesh.setMatrixAt(ids[i], this.scratch);
      this.mesh.setVisibleAt(ids[i], true);
    }
  }

  /**
   * Meshes in traversal order. Order is stable for a given rig shape, which is
   * what lets `acquire` and `update` agree on which instance is which limb
   * without storing a parallel structure.
   */
  private collectParts(root: Object3D): Mesh[] {
    this.partScratch.length = 0;
    root.traverse((node) => {
      const mesh = node as Mesh;
      if (mesh.isMesh) this.partScratch.push(mesh);
    });
    return this.partScratch;
  }

  get used(): number {
    return this.instancesUsed;
  }

  get capacity(): number {
    return this.maxInstances;
  }

  dispose(): void {
    this.mesh.dispose();
    this.geometryIds.clear();
    this.instancesUsed = 0;
  }
}
