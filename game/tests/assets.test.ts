import { describe, expect, it } from "vitest";
import { assetIds, getEntry, hasEntry, MANIFEST } from "../src/assets/AssetManifest.ts";

const DRIVE_LETTER_ABSOLUTE = /^[A-Za-z]:[\\/]/;
const FILE_URL_ABSOLUTE = /^file:\/\//;

function isAbsoluteLocalPath(value: string): boolean {
  return DRIVE_LETTER_ABSOLUTE.test(value) || FILE_URL_ABSOLUTE.test(value);
}

describe("asset manifest", () => {
  it("parses with the expected top-level shape", () => {
    expect(MANIFEST.version).toBe(1);
    expect(MANIFEST.sourceRootEnv).toBe("ASSET_SOURCE_ROOT");
    expect(Array.isArray(MANIFEST.licenses)).toBe(true);
    expect(MANIFEST.licenses.length).toBeGreaterThan(0);
    expect(typeof MANIFEST.assets).toBe("object");
    expect(assetIds().length).toBeGreaterThan(0);
  });

  it("carries all four licenses referenced by prompt_guide.md §17.1", () => {
    expect(MANIFEST.licenses).toEqual([
      "kay_assets/The Complete KayKit Collection v6.1/License.txt",
      "assets/kenney_factory/License.txt",
      "assets/kenney_space-kit/License.txt",
      "assets/kenney_nature/License.txt",
    ]);
  });

  it("gives every entry all required fields with the right types", () => {
    for (const id of assetIds()) {
      const entry = getEntry(id);
      expect(entry.id, `${id}.id`).toBe(id);
      expect(typeof entry.source, `${id}.source`).toBe("string");
      expect(entry.source.length, `${id}.source non-empty`).toBeGreaterThan(0);
      expect(typeof entry.runtime, `${id}.runtime`).toBe("string");
      expect(typeof entry.scale, `${id}.scale`).toBe("number");
      expect(Number.isFinite(entry.scale), `${id}.scale finite`).toBe(true);
      expect(entry.scale, `${id}.scale positive`).toBeGreaterThan(0);
      expect(typeof entry.rotationY, `${id}.rotationY`).toBe("number");
      expect(Number.isFinite(entry.rotationY), `${id}.rotationY finite`).toBe(true);
      expect(typeof entry.castShadow, `${id}.castShadow`).toBe("boolean");
      expect(typeof entry.kind, `${id}.kind`).toBe("string");
      expect(entry.kind.length, `${id}.kind non-empty`).toBeGreaterThan(0);
      expect(entry.procedural, `${id}.procedural`).toBe(true);
    }
  });

  it("never has an absolute local path in a source or runtime field", () => {
    for (const id of assetIds()) {
      const entry = getEntry(id);
      expect(isAbsoluteLocalPath(entry.source), `${id}.source = "${entry.source}"`).toBe(false);
      expect(isAbsoluteLocalPath(entry.runtime), `${id}.runtime = "${entry.runtime}"`).toBe(false);
    }
  });

  it("never has an absolute local path anywhere in the four licenses either", () => {
    for (const license of MANIFEST.licenses) {
      expect(isAbsoluteLocalPath(license), `license = "${license}"`).toBe(false);
    }
  });

  it("roots every runtime path under /assets/", () => {
    for (const id of assetIds()) {
      const entry = getEntry(id);
      expect(entry.runtime.startsWith("/assets/"), `${id}.runtime = "${entry.runtime}"`).toBe(true);
    }
  });

  it("keeps every runtime path unique", () => {
    const ids = assetIds();
    const runtimePaths = ids.map((id) => getEntry(id).runtime);
    const unique = new Set(runtimePaths);
    expect(unique.size).toBe(runtimePaths.length);
  });

  it("keeps every source path relative, so nothing hardcodes ASSET_SOURCE_ROOT", () => {
    for (const id of assetIds()) {
      const entry = getEntry(id);
      expect(entry.source.startsWith("/"), `${id}.source = "${entry.source}"`).toBe(false);
      expect(/^[A-Za-z]:/.test(entry.source), `${id}.source = "${entry.source}"`).toBe(false);
    }
  });

  it("hasEntry agrees with assetIds()", () => {
    for (const id of assetIds()) {
      expect(hasEntry(id)).toBe(true);
    }
    expect(hasEntry("does.not.exist")).toBe(false);
  });

  it("getEntry throws for an unknown id", () => {
    expect(() => getEntry("does.not.exist")).toThrow();
    expect(() => getEntry("")).toThrow();
  });
});
