import { describe, it, expect } from "vitest";
import { lawnCatalog } from "@/verticals/lawn/catalog";

describe("lawnCatalog", () => {
  it("serves the 'service' kind and defaults to the flat unit", () => {
    expect(lawnCatalog.serviceKind).toBe("service");
    expect(lawnCatalog.defaultUnit).toBe("flat");
  });
  it("names the seed RPC and the seed button", () => {
    expect(lawnCatalog.seedRpcName).toBe("seed_default_lawn_catalog");
    expect(lawnCatalog.copy.seedButtonLabel).toBe("Seed default lawn catalog");
  });
  it("carries all 22 starter items, each well-formed", () => {
    expect(lawnCatalog.defaultSeed).toHaveLength(22);
    for (const item of lawnCatalog.defaultSeed) {
      expect(item.name.trim().length).toBeGreaterThan(0);
      expect(typeof item.default_rate).toBe("number");
      expect(typeof item.min_charge).toBe("number");
      expect(["flat", "sqft", "linear_ft"]).toContain(item.unit);
      expect(typeof item.sort_order).toBe("number");
    }
  });
  it("lists seed items in strictly ascending sort_order", () => {
    const orders = lawnCatalog.defaultSeed.map((i) => i.sort_order);
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThan(orders[i - 1]);
    }
  });
});
