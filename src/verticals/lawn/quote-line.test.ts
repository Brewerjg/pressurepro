import { describe, it, expect } from "vitest";
import { lawnQuoteLine } from "@/verticals/lawn/quote-line";

describe("lawnQuoteLine", () => {
  it("catalogKindFilter is 'service'", () => {
    expect(lawnQuoteLine.catalogKindFilter).toBe("service");
  });
  it("blankLine returns a zeroed custom line with a uuid", () => {
    const l = lawnQuoteLine.blankLine();
    expect(l).toMatchObject({ name: "Custom service", qty: 1, rate: 0, total: 0 });
    expect(typeof l.id).toBe("string");
  });
  it("catalogToLine maps id/name/rate and defaults null rate to 0", () => {
    expect(lawnQuoteLine.catalogToLine({ id: "c1", name: "Mow", default_rate: 45 }))
      .toMatchObject({ catalog_item_id: "c1", name: "Mow", qty: 1, rate: 45, total: 45 });
    expect(lawnQuoteLine.catalogToLine({ id: "c2", name: "X", default_rate: null }))
      .toMatchObject({ rate: 0, total: 0 });
  });
  it("lineTotal rounds qty*rate to cents", () => {
    expect(lawnQuoteLine.lineTotal({ id: "a", name: "n", qty: 3, rate: 12.5, total: 0 })).toBe(37.5);
  });
  it("parseLines reads the standard shape", () => {
    expect(lawnQuoteLine.parseLines([{ id: "a", name: "Mow", qty: 2, rate: 45, total: 90 }]))
      .toEqual([{ id: "a", catalog_item_id: undefined, name: "Mow", qty: 2, rate: 45, total: 90 }]);
  });
  it("parseLines synthesizes qty/rate/total from a legacy {sqft,rate} row", () => {
    expect(lawnQuoteLine.parseLines([{ label: "Driveway", sqft: 100, rate: 0.5 }]))
      .toEqual([{ id: expect.any(String), name: "Driveway", qty: 100, rate: 0.5, total: 50 }]);
  });
  it("parseLines returns [] for non-array input", () => {
    expect(lawnQuoteLine.parseLines(null)).toEqual([]);
  });
  it("describe: qty 1 → no detail; qty>1 → 'N × $R'", () => {
    expect(lawnQuoteLine.describe({ id: "a", name: "Mow", qty: 1, rate: 45, total: 45 }))
      .toEqual({ label: "Mow", detail: null, amount: 45 });
    expect(lawnQuoteLine.describe({ id: "a", name: "Mow", qty: 3, rate: 45, total: 135 }))
      .toEqual({ label: "Mow", detail: "3 × $45", amount: 135 });
  });
});
