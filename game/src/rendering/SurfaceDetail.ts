import { BufferAttribute, DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType, type BufferGeometry } from "three";
import type { TerrainStyle } from "../core/types.ts";

/** Subtle, deterministic albedo only: never modifies height or navigation. */
export function surfaceValue(style: TerrainStyle, x: number, y: number): number {
  const hash = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  const grain = hash - Math.floor(hash);
  let value = 0.95 + (grain - 0.5) * 0.07;
  if (style === "yellow") value -= (1 + Math.sin(y * Math.PI / 8 + Math.sin(x * Math.PI / 32))) * 0.025;
  if (style === "factory" || style === "civil") {
    if (x % 32 < 1 || y % 32 < 1) value -= 0.09;
  }
  if (style === "mountain" || style === "brown") value -= Math.abs(Math.sin((x + y * 2) * Math.PI / 32)) * 0.04;
  if (style === "crystal") value -= Math.abs(Math.sin((x - y) * Math.PI / 16)) * 0.055;
  return Math.max(0.82, Math.min(1, value));
}

export function surfaceUV(geometry: BufferGeometry, sx = 1, sz = 1, ox = 0, oz = 0): void {
  const positions = geometry.getAttribute("position"), uv = new Float32Array(positions.count * 2);
  for (let i = 0; i < positions.count; i++) {
    uv[i * 2] = (positions.getX(i) * sx + ox) / 24;
    uv[i * 2 + 1] = (positions.getZ(i) * sz + oz) / 24;
  }
  geometry.setAttribute("uv", new BufferAttribute(uv, 2));
}

export class SurfaceDetail {
  private textures = new Map<TerrainStyle, DataTexture>();
  get(style: TerrainStyle): DataTexture {
    let texture = this.textures.get(style);
    if (texture) return texture;
    const pixels = new Uint8Array(128 * 128 * 4);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const i = (y * 128 + x) * 4, value = Math.round(surfaceValue(style, x, y) * 255);
      pixels[i] = pixels[i + 1] = pixels[i + 2] = value; pixels[i + 3] = 255;
    }
    texture = new DataTexture(pixels, 128, 128, RGBAFormat, UnsignedByteType);
    texture.colorSpace = SRGBColorSpace; texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.generateMipmaps = true; texture.anisotropy = 2; texture.needsUpdate = true;
    texture.minFilter = LinearMipmapLinearFilter; texture.magFilter = LinearFilter;
    this.textures.set(style, texture); return texture;
  }
  dispose(): void { for (const texture of this.textures.values()) texture.dispose(); this.textures.clear(); }
}
