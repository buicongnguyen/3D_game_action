import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readGameFile = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("Iron March branding", () => {
  it("uses the English name in the browser tab, loading screen and title menu", () => {
    const html = readGameFile("index.html");
    const main = readGameFile("src/main.ts");
    const screens = readGameFile("src/ui/Screens.ts");
    expect(html).toContain("<title>Iron March</title>");
    expect(main).toContain('<h1 class="boot-title">IRON MARCH</h1>');
    expect(main).toContain('document.title = `Iron March - ${scenario.label}`');
    expect(screens).toContain('title: "Iron March"');
    for (const source of [html, main, screens]) {
      expect(source).not.toMatch(/marcha\s+de\s+ferro/i);
    }
  });

  it("keeps the README and npm lockfile aligned with the renamed package", () => {
    const pkg = JSON.parse(readGameFile("package.json"));
    const lock = JSON.parse(readGameFile("package-lock.json"));
    expect(pkg.name).toBe("iron-march");
    expect(pkg.description).toMatch(/^Iron March -/);
    expect(lock.name).toBe(pkg.name);
    expect(lock.packages[""].name).toBe(pkg.name);
    expect(readGameFile("README.md")).toMatch(/^# Iron March\r?\n/);
  });
});
