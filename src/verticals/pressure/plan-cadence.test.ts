import { describe, it, expect } from "vitest";
import { pressurePlanCadence } from "./plan-cadence";

describe("pressurePlanCadence", () => {
  it("is flat-billing with no cadence sections", () => {
    expect(pressurePlanCadence.billingModel).toBe("flat");
    expect(pressurePlanCadence.hasServiceFrequency).toBe(false);
    expect(pressurePlanCadence.hasRouteDay).toBe(false);
    expect(pressurePlanCadence.hasSeasonPause).toBe(false);
    expect(pressurePlanCadence.defaultPlanKind).toBe("other");
  });
  it("has no frequencies and a valid default frequency", () => {
    expect(pressurePlanCadence.frequencies).toHaveLength(0);
    expect(pressurePlanCadence.defaultFrequency).toBe("weekly");
  });
});
