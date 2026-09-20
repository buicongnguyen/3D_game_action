import { ConeGeometry, CylinderGeometry, TorusGeometry, type BufferGeometry } from "three";
import { applyColor, merge, place } from "./geometry.ts";

// Opaque, faceted rewards: one cached geometry per kind, no glass sorting or lights.
export function buildRewardGeometry(kind: string): BufferGeometry {
  const parts: BufferGeometry[] = [];
  if (kind === "scrap") {
    parts.push(place(applyColor(new CylinderGeometry(0.53, 0.53, 0.14, 20), 0xe7a52b), 0, 0.6, 0, Math.PI / 2));
    for (const side of [-1, 1]) {
      parts.push(place(applyColor(new CylinderGeometry(0.42, 0.42, 0.025, 20), 0xffd457), 0, 0.6, side * 0.081, Math.PI / 2));
      parts.push(place(applyColor(new TorusGeometry(0.47, 0.035, 4, 20), 0xffed9a), 0, 0.6, side * 0.085));
      // Raised four-sided stamp keeps the face recognizable while spinning.
      parts.push(place(applyColor(new CylinderGeometry(0.22, 0.22, 0.035, 4).rotateY(Math.PI / 4), 0xfff1ad), 0, 0.6, side * 0.108, Math.PI / 2));
    }
  } else {
    const styles: Record<string, [number, number, number, number]> = {
      fuel: [0xffbd45, 6, 0.55, 0.9], cylinder: [0x63e3ff, 8, 0.48, 1.05],
      pressureCanister: [0x63e3ff, 8, 0.48, 1.05], repairKit: [0x76efa0, 4, 0.56, 0.85],
      shockMine: [0x559aff, 6, 0.6, 0.8], armorPlate: [0xa4c8f2, 4, 0.63, 0.75],
      weaponPart: [0xdd8aff, 8, 0.5, 1.15],
    };
    const [color, sides, radius, height] = styles[kind] ?? styles.cylinder;
    const pavilion = applyColor(new ConeGeometry(radius, height * 0.7, sides), color);
    parts.push(place(pavilion, 0, height * 0.35 + 0.05, 0, Math.PI));
    parts.push(place(applyColor(new CylinderGeometry(radius * 0.48, radius, height * 0.3, sides), color), 0, height * 0.85 + 0.05, 0));
    parts.push(place(applyColor(new CylinderGeometry(radius * 0.48, radius * 0.48, 0.025, sides), 0xe5faff), 0, height + 0.07, 0));
  }
  const result = merge(parts); for (const part of parts) part.dispose();
  result.computeBoundingBox(); return result;
}
