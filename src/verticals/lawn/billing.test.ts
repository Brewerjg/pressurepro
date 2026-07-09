import { describe, it, expect } from "vitest";
import { lawnBilling } from "./billing";

describe("lawnBilling", () => {
  it("offers the three turf tiers with 0% fees", () => {
    expect(lawnBilling.tiers.map((t) => t.id)).toEqual(["payg", "solo", "crew"]);
    for (const t of lawnBilling.tiers) expect(t.applicationFeePercent).toBe(0);
  });
  it("maps turf price keys to tiers", () => {
    expect(lawnBilling.priceToTier["turfpro_solo_monthly"]).toBe("solo");
    expect(lawnBilling.priceToTier["turfpro_crew_yearly"]).toBe("crew");
  });
});
