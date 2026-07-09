import { describe, it, expect } from "vitest";
import { lawnPlanCadence } from "@/verticals/lawn/plan-cadence";

describe("lawnPlanCadence", () => {
  it("lists the 4 lawn frequencies in order", () => {
    expect(lawnPlanCadence.frequencies.map((f) => f.key)).toEqual([
      "weekly", "biweekly", "monthly", "fert_program",
    ]);
  });
  it("defaults to weekly service and quarterly billing", () => {
    expect(lawnPlanCadence.defaultFrequency).toBe("weekly");
    expect(lawnPlanCadence.defaultIntervalMonths).toBe(3);
  });
  it("visitsPerMonth maps known keys and falls back to 0", () => {
    expect(lawnPlanCadence.visitsPerMonth("weekly")).toBe(4);
    expect(lawnPlanCadence.visitsPerMonth("biweekly")).toBe(2);
    expect(lawnPlanCadence.visitsPerMonth("monthly")).toBe(1);
    expect(lawnPlanCadence.visitsPerMonth("fert_program")).toBeCloseTo(5 / 12);
    expect(lawnPlanCadence.visitsPerMonth("nope")).toBe(0);
  });
  it("frequencyLabel maps known keys and falls back to the key", () => {
    expect(lawnPlanCadence.frequencyLabel("monthly")).toBe("Monthly");
    expect(lawnPlanCadence.frequencyLabel("fert_program")).toBe("Fert program");
    expect(lawnPlanCadence.frequencyLabel("nope")).toBe("nope");
  });
  it("suggestFrequency matches keyword hints, else weekly", () => {
    const f = (name: string) => lawnPlanCadence.suggestFrequency([{ name, isRecurring: true }]);
    expect(f("Biweekly mow")).toBe("biweekly");
    expect(f("Monthly cleanup")).toBe("monthly");
    expect(f("Fert step 1")).toBe("fert_program");
    expect(f("Weekly mow")).toBe("weekly");
    expect(lawnPlanCadence.suggestFrequency([{ name: "Biweekly", isRecurring: false }])).toBe("weekly");
  });
  it("seasonSwap targets active mow plans on the mow frequencies", () => {
    expect(lawnPlanCadence.seasonSwap).toEqual({
      planKind: "mow",
      frequencies: ["weekly", "biweekly", "monthly"],
    });
  });
  it("uses the lawn per-visit plan model with all cadence sections", () => {
    expect(lawnPlanCadence.billingModel).toBe("per-visit");
    expect(lawnPlanCadence.hasServiceFrequency).toBe(true);
    expect(lawnPlanCadence.hasRouteDay).toBe(true);
    expect(lawnPlanCadence.hasSeasonPause).toBe(true);
    expect(lawnPlanCadence.defaultPlanKind).toBe("mow");
  });
});
