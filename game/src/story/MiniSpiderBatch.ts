import { Color, DynamicDrawUsage, Group, InstancedMesh, Mesh } from "three";
import { buildSpider, type SpiderRig } from "../art/machines.ts";
import type { MaterialLibrary } from "../art/materials.ts";
import { animateSpider, captureSpiderRest } from "../rendering/AnimationSystem.ts";
import { resetSpiderLegs } from "../rendering/SpiderLegSolver.ts";
import { STORY_ENEMIES, STORY_LIMITS, type Chapter, type StoryEnemyKind } from "./StoryData.ts";
import { groundHeight } from "./StoryMaps.ts";
import type { StoryEnemy } from "./StoryState.ts";

export const isMiniSpider = (kind: StoryEnemyKind): boolean =>
  kind === "broodling" || kind === "jumper" || kind === "shellback";

interface Walker {
  rig: SpiderRig;
  parts: Mesh[][];
  x: number;
  z: number;
  airborne: boolean;
}

/** Original machine skeleton and reduced original geometry, rendered in four batches.
 * Hidden rigs solve joints independently; only their matrices go to the GPU.
 * No per-enemy materials, lights or full hero draw-call cost.
 */
export class MiniSpiderBatch {
  readonly meshes: InstancedMesh[];
  private walkers = new Map<number, Walker>();
  private pool: Walker[] = [];
  private living: StoryEnemy[] = [];
  private ids = new Set<number>();
  private counts = new Int32Array(4);
  private color = new Color();
  private white = new Color(0xffffff);
  private chapter: Chapter | 0 = 0;
  private airHeight = 0;
  private contactHeight = (x: number, z: number) => groundHeight(this.chapter || 1, x, z) + this.airHeight;
  constructor(root: Group, private materials: MaterialLibrary) {
    const template = this.createWalker();
    this.pool.push(template);
    this.meshes = template.parts.map((parts, i) => {
      const mesh = new InstancedMesh(parts[0].geometry, materials.surface, STORY_LIMITS.enemies * (i ? 8 : 1));
      mesh.name = ["mini-hulls", "mini-upper-legs", "mini-lower-legs", "mini-feet"][i];
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0; mesh.frustumCulled = false; root.add(mesh);
      return mesh;
    });
  }
  private createWalker(): Walker {
    const rig = buildSpider(this.materials, true); captureSpiderRest(rig);
    return { rig, parts: [
      [rig.body.getObjectByName("hull") as Mesh],
      rig.legUpper.map(n => n.children[0] as Mesh),
      rig.legLower.map(n => n.children[0] as Mesh),
      rig.legFoot.map(n => n.children[0] as Mesh),
    ], x: 0, z: 0, airborne: false };
  }
  clear(): void {
    for (const walker of this.walkers.values()) { resetSpiderLegs(walker.rig); this.pool.push(walker); }
    this.walkers.clear();
    for (const mesh of this.meshes) mesh.count = 0;
  }
  update(enemies: readonly StoryEnemy[], dt: number, chapter: Chapter, view?: { x: number; z: number; radius: number }): void {
    if (chapter !== this.chapter) { this.clear(); this.chapter = chapter; }
    const living = this.living, ids = this.ids, counts = this.counts;
    living.length = 0; ids.clear(); counts.fill(0);
    for (const e of enemies) {
      if (e.hp <= 0 || !isMiniSpider(e.kind) || living.length >= STORY_LIMITS.enemies) continue;
      if (view && (e.x - view.x) ** 2 + (e.z - view.z) ** 2 > (view.radius + 3) ** 2) continue;
      living.push(e); ids.add(e.id);
    }
    for (const [id, walker] of this.walkers) if (!ids.has(id)) {
      resetSpiderLegs(walker.rig); this.pool.push(walker); this.walkers.delete(id);
    }
    for (const e of living) {
      let walker = this.walkers.get(e.id);
      if (!walker) {
        walker = this.pool.pop() ?? this.createWalker();
        walker.x = e.x; walker.z = e.z; walker.airborne = false;
        walker.rig.gaitPhase = 0; resetSpiderLegs(walker.rig); this.walkers.set(e.id, walker);
      }
      const scale = e.kind === "shellback" ? 0.34 : 0.25;
      const airborne = e.jump > 0 && e.jump < 1;
      this.airHeight = airborne ? Math.sin((1 - e.jump) * Math.PI) * 4 : 0;
      const speed = dt > 0 ? Math.min(5, Math.hypot(e.x - walker.x, e.z - walker.z) / dt) : 0;
      walker.rig.root.scale.setScalar(scale);
      walker.rig.root.position.set(e.x, groundHeight(chapter, e.x, e.z) + this.airHeight, e.z);
      walker.rig.root.rotation.y = e.heading;
      // Flight must not stretch legs down to stale grounded contacts.
      if (airborne || walker.airborne) resetSpiderLegs(walker.rig);
      animateSpider(walker.rig, dt, airborne ? 0 : speed, false, false, 0, this.contactHeight);
      walker.rig.root.updateMatrixWorld(true);
      walker.x = e.x; walker.z = e.z; walker.airborne = airborne;
      this.color.setHex(STORY_ENEMIES[e.kind].color).lerp(this.white, 0.75);
      for (let batch = 0; batch < 4; batch++) for (const part of walker.parts[batch]) {
        const index = counts[batch]++;
        this.meshes[batch].setMatrixAt(index, part.matrixWorld);
        this.meshes[batch].setColorAt(index, this.color);
      }
    }
    for (let i = 0; i < 4; i++) {
      const mesh = this.meshes[i]; mesh.count = counts[i];
      if (!mesh.count) continue;
      mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16); mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) { mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.addUpdateRange(0, mesh.count * 3); mesh.instanceColor.needsUpdate = true; }
    }
  }
  dispose(): void {
    this.clear(); this.pool.length = 0;
    for (const mesh of this.meshes) { mesh.removeFromParent(); mesh.dispose(); }
    // Geometry and materials belong to MeshForge's shared machine cache.
  }
}
