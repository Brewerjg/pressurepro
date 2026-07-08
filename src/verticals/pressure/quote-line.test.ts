import { describe, it, expect } from "vitest";
import { pressureQuoteLine } from "./quote-line";
import type { CatalogItem } from "@/verticals/quote-line";

const { blankLine, catalogToLine, lineTotal, parseLines, describe: describeLine } =
  pressureQuoteLine;

describe("pressureQuoteLine", () => {
  it("satisfies the module contract", () => {
    for (const k of ["blankLine", "catalogToLine", "lineTotal", "parseLines", "describe", "LineEditor"] as const) {
      expect(pressureQuoteLine[k]).toBeDefined();
    }
  });

  it("lineTotal = sqft * rate, rounded to 2 dp", () => {
    expect(lineTotal({ id: "l", surface: "concrete", sqft: 333, rate: 0.187, mode: "power", total: 0 })).toBe(62.27);
    expect(lineTotal({ id: "c", surface: "concrete", sqft: 1, rate: 150, mode: "power", custom: true, total: 0 })).toBe(150);
  });

  it("blankLine is a custom flat line", () => {
    const l = blankLine();
    expect(l).toMatchObject({ sqft: 1, rate: 0, custom: true });
    expect(typeof l.id).toBe("string");
  });

  it("catalogToLine builds a surface line from a surface catalog item", () => {
    const item: CatalogItem = { id: "cat1", name: "Roof", default_rate: 0.4, surface_type: "roof", mode: "soft" };
    const l = catalogToLine(item) as Record<string, unknown>;
    expect(l).toMatchObject({ surface: "roof", mode: "soft", rate: 0.4, sqft: 1500, custom: false });
    expect(l.total).toBe(600);
  });

  it("catalogToLine builds a custom flat line when the item has no surface_type", () => {
    const item: CatalogItem = { id: "cat2", name: "Gutter cleaning", default_rate: 120 };
    const l = catalogToLine(item) as Record<string, unknown>;
    expect(l).toMatchObject({ custom: true, rate: 120, sqft: 1, label: "Gutter cleaning" });
    expect(l.total).toBe(120);
  });

  it("parseLines round-trips surface + custom rows and drops junk", () => {
    const raw = [
      { id: "a", surface: "house", sqft: 1500, rate: 0.25, mode: "soft" },
      { id: "b", custom: true, sqft: 1, rate: 200, label: "Deck seal", surface: "deck" },
      null,
      "nope",
      { id: "c", surface: "bogus", sqft: 10, rate: 2 }, // invalid surface -> custom
    ];
    const out = parseLines(raw) as Record<string, unknown>[];
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ id: "a", surface: "house", sqft: 1500, rate: 0.25, mode: "soft", total: 375 });
    expect(out[1]).toMatchObject({ id: "b", custom: true, rate: 200, label: "Deck seal" });
    expect(out[2]).toMatchObject({ custom: true });
  });

  it("parseLines synthesizes id/total and coerces string numbers", () => {
    const out = parseLines([{ surface: "concrete", sqft: "600", rate: "0.2", mode: "power" }]) as Record<string, unknown>[];
    expect(typeof out[0].id).toBe("string");
    expect(out[0].total).toBe(120);
  });

  it("describe formats a surface line for the shared display", () => {
    const d = describeLine({ id: "a", surface: "roof", sqft: 1500, rate: 0.4, mode: "soft", total: 600 });
    expect(d).toEqual({
      label: "Roof",
      detail: "1,500 sqft × $0.40 · soft",
      qty: "1,500 sqft",
      rate: "$0.40",
      amount: 600,
    });
  });

  it("describe formats a custom line", () => {
    const d = describeLine({ id: "c", surface: "concrete", sqft: 1, rate: 175, mode: "power", custom: true, label: "Gutter cleaning", total: 175 });
    expect(d).toEqual({ label: "Gutter cleaning", detail: null, qty: "1", rate: "—", amount: 175 });
  });
});
