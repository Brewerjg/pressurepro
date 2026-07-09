import { describe, it, expect } from "vitest";
import { computeMix, SH_TARGETS, SURFACES } from "./mix-calc";

describe("mix-calc", () => {
  it("computes the soft-wash recipe", () => {
    const r = computeMix({ totalGallons: 50, targetPct: 1.0, stockPct: 12.5, surfactantOzPerGal: 1.0 });
    expect(r.stockGal).toBe(4);
    expect(r.waterGal).toBe(46);
    expect(r.surfactantOz).toBe(50);
  });
  it("has SH targets for all 7 surfaces", () => {
    expect(SURFACES).toHaveLength(7);
    for (const s of SURFACES) {
      expect(typeof SH_TARGETS[s].targetPct).toBe("number");
      expect(typeof SH_TARGETS[s].surfactantOzPerGal).toBe("number");
    }
    expect(SH_TARGETS.roof.targetPct).toBe(4.0);
  });
});
