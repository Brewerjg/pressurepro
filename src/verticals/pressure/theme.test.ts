import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Extract the set of declared CSS custom-property names (e.g. "--brand-900"). */
function customProps(css: string): Set<string> {
  return new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
}

const lawnCss = readFileSync(resolve(here, "../lawn/theme.css"), "utf8");
const pressureCss = readFileSync(resolve(here, "theme.css"), "utf8");

describe("pressure theme", () => {
  it("defines exactly the same custom-property names as the lawn theme", () => {
    const lawn = customProps(lawnCss);
    const pressure = customProps(pressureCss);
    const missing = [...lawn].filter((v) => !pressure.has(v));
    const extra = [...pressure].filter((v) => !lawn.has(v));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("defines the lawn-status vars so shared status pills never render undefined", () => {
    const pressure = customProps(pressureCss);
    for (const v of ["--rain", "--rain-bg", "--drought", "--drought-bg"]) {
      expect(pressure.has(v)).toBe(true);
    }
  });

  it("uses the pressure palette, not lawn values (navy brand + yellow accent)", () => {
    expect(pressureCss).toContain("--brand-900: 220 65% 12%;");
    expect(pressureCss).toContain("--accent-500: 48 100% 55%;");
    expect(pressureCss).toContain("--ring: 220 65% 18%;");
  });
});
