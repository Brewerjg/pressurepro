import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Extract the set of declared CSS custom-property names (e.g. "--brand-900"). */
function customProps(css: string): Set<string> {
  return new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
}

const pressureCss = readFileSync(resolve(here, "theme.css"), "utf8");

describe("pressure theme", () => {
  it("defines the weather-status vars so shared status pills never render undefined", () => {
    const pressure = customProps(pressureCss);
    for (const v of ["--rain", "--rain-bg", "--drought", "--drought-bg"]) {
      expect(pressure.has(v)).toBe(true);
    }
  });

  it("uses the pressure palette (navy brand + yellow accent)", () => {
    expect(pressureCss).toContain("--brand-900: 220 65% 12%;");
    expect(pressureCss).toContain("--accent-500: 48 100% 55%;");
    expect(pressureCss).toContain("--ring: 220 65% 18%;");
  });
});
