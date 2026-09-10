import { BufferAttribute, BufferGeometry, Mesh, type Object3D, type Material } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import catalog from "../../public/assets/blender/catalog.json";

export const BLENDER_IDS = Object.keys(catalog.meshes);
const MAX_BYTES = 2_500_000;

/** Only immutable shared geometry survives import. No glTF materials or scene nodes per enemy. */
export class BlenderLibrary {
  private readonly geometries = new Map<string, BufferGeometry>();
  get size(): number { return this.geometries.size; }
  get(name: string): BufferGeometry | undefined { return this.geometries.get(name); }

  static async parse(bytes: ArrayBuffer): Promise<BlenderLibrary> {
    if (bytes.byteLength > MAX_BYTES) throw new Error("Blender library exceeds the download budget");
    const gltf = await new GLTFLoader().parseAsync(bytes, "");
    const result = new BlenderLibrary();
    const sourceGeometries = new Set<BufferGeometry>();
    const sourceMaterials = new Set<Material>();
    try {
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((node: Object3D) => {
        if (!(node instanceof Mesh)) return;
        sourceGeometries.add(node.geometry);
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) sourceMaterials.add(material);
        if (!BLENDER_IDS.includes(node.name) || result.geometries.has(node.name)) throw new Error(`Unexpected Blender mesh: ${node.name}`);
        const source = node.geometry as BufferGeometry;
        const geometry = new BufferGeometry();
        result.geometries.set(node.name, geometry);
        // Match HordeBatch's exact indexed position/normal/RGB schema.
        for (const name of ["position", "normal", "color"] as const) {
          const attr = source.getAttribute(name);
          if (!attr || attr.itemSize < 3 || !attr.count) throw new Error(`Missing ${name}: ${node.name}`);
          if (name !== "position" && attr.count !== geometry.getAttribute("position").count)
            throw new Error(`Mismatched attribute count: ${node.name}`);
          const values = new Float32Array(attr.count * 3);
          for (let i = 0; i < attr.count; i++) {
            values[i*3] = attr.getX(i); values[i*3+1] = attr.getY(i); values[i*3+2] = attr.getZ(i);
          }
          if (!values.every(Number.isFinite)) throw new Error(`Non-finite ${name}: ${node.name}`);
          geometry.setAttribute(name, new BufferAttribute(values, 3));
        }
        if (!source.index) throw new Error(`Non-indexed Blender mesh: ${node.name}`);
        const vertexCount = geometry.getAttribute("position").count;
        if (!source.index.count || source.index.count % 3 !== 0) throw new Error(`Invalid triangles: ${node.name}`);
        for (let i = 0; i < source.index.count; i++) {
          const index = source.index.getX(i);
          if (!Number.isInteger(index) || index < 0 || index >= vertexCount) throw new Error(`Invalid index: ${node.name}`);
        }
        geometry.setIndex(source.index.clone());
        geometry.applyMatrix4(node.matrixWorld);
        geometry.name = `blender:${node.name}`;
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        if (!Number.isFinite(geometry.boundingSphere!.radius) || geometry.boundingSphere!.radius <= 0)
          throw new Error(`Invalid bounds: ${node.name}`);
      });
      if (result.size !== BLENDER_IDS.length) throw new Error("Incomplete Blender library");
      let enemyVertices = 0, enemyIndices = 0;
      for (const [name, geometry] of result.geometries) {
        if (/^(minion|warrior|golem)_/.test(name)) {
          enemyVertices += geometry.getAttribute("position").count;
          enemyIndices += geometry.index!.count;
        }
      }
      if (enemyVertices > 18_500 || enemyIndices > 66_000) throw new Error("Blender enemies exceed the horde batch budget");
      return result;
    } catch (error) {
      result.dispose();
      throw error;
    } finally {
      // Collect even nodes not reached if validation failed halfway through.
      gltf.scene.traverse((node) => {
        if (!(node instanceof Mesh)) return;
        sourceGeometries.add(node.geometry);
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) sourceMaterials.add(material);
      });
      for (const geometry of sourceGeometries) geometry.dispose();
      for (const material of sourceMaterials) material.dispose();
    }
  }

  /** One same-origin request with a bounded wait. Old art remains usable offline. */
  static async load(base = import.meta.env.BASE_URL): Promise<BlenderLibrary | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${base}assets/blender/iron-march.glb`, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await BlenderLibrary.parse(await response.arrayBuffer());
    } catch (error) {
      console.warn("[art] Blender library unavailable; using procedural models", error);
      return null;
    } finally { clearTimeout(timeout); }
  }

  dispose(): void {
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear();
  }
}

/** Exactly one house batch per stage, using a biome-matched architecture. */
export function houseAssetFor(style: string | undefined): string {
  if (style === "factory" || style === "crystal") return "house_foundry";
  if (style === "civil" || style === "mountain" || style === "valley") return "house_town";
  return "house_cottage";
}
