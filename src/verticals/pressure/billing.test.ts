import { describe, it, expect } from "vitest";
import { pressureBilling } from "./billing";

describe("pressureBilling", () => {
  it("offers four tiers incl. pro", () => {
    expect(pressureBilling.tiers.map((t) => t.id)).toEqual(["payg", "solo", "pro", "crew"]);
  });
  it("prices via pp_* keys and charges 2% only on payg", () => {
    const payg = pressureBilling.tiers.find((t) => t.id === "payg")!;
    expect(payg.monthly.priceId).toBe("pp_payg_monthly");
    expect(payg.applicationFeePercent).toBe(2);
    for (const t of pressureBilling.tiers.filter((t) => t.id !== "payg")) {
      expect(t.applicationFeePercent).toBe(0);
    }
  });
  it("does not gate route stops (weeklyStopLimit null)", () => {
    for (const t of pressureBilling.tiers) expect(t.weeklyStopLimit).toBeNull();
  });
  it("maps pp_* + legacy pressurepro_* prices to tiers", () => {
    expect(pressureBilling.priceToTier["pp_crew_monthly"]).toBe("crew");
    expect(pressureBilling.priceToTier["pressurepro_yearly"]).toBe("pro");
  });
});
