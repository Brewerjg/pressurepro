import { vi } from "vitest";

// Stub the Supabase client so the module loads in the Node test environment
// (the real client calls localStorage at import time, which Node does not have).
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { describe, it, expect } from "vitest";
import { pressureCatalog, surfaceRowToCatalogItem } from "./catalog";

describe("pressureCatalog", () => {
  it("seeds all 7 surfaces, one row each, well-formed", () => {
    expect(pressureCatalog.defaultSeed).toHaveLength(7);
    const surfaces = pressureCatalog.defaultSeed.map((s) => s.surface_type).sort();
    expect(surfaces).toEqual(
      ["concrete", "deck", "driveway", "fence", "house", "roof", "siding"],
    );
    for (const item of pressureCatalog.defaultSeed) {
      expect(["soft", "power"]).toContain(item.mode);
      expect(typeof item.default_rate).toBe("number");
      expect(typeof item.min_charge).toBe("number");
      expect(["sqft", "linear_ft", "flat"]).toContain(item.unit);
    }
  });

  it("prices fence per linear_ft and the rest per sqft", () => {
    const fence = pressureCatalog.defaultSeed.find((s) => s.surface_type === "fence");
    expect(fence?.unit).toBe("linear_ft");
    const roof = pressureCatalog.defaultSeed.find((s) => s.surface_type === "roof");
    expect(roof).toMatchObject({ mode: "soft", default_rate: 0.4, min_charge: 350, unit: "sqft" });
  });

  it("maps a surface_pricing row to the shared CatalogItem", () => {
    const item = surfaceRowToCatalogItem({
      id: "r1", surface_type: "roof", mode: "soft", default_rate: 0.4,
      min_charge: 350, unit: "sqft", user_id: "u", created_at: "", updated_at: "",
    });
    expect(item).toEqual({
      id: "r1", name: "Roof (soft)", default_rate: 0.4, surface_type: "roof", mode: "soft",
    });
  });

  it("declares serviceKind, defaultUnit, and seed copy", () => {
    expect(pressureCatalog.serviceKind).toBe("service");
    expect(pressureCatalog.defaultUnit).toBe("sqft");
    expect(pressureCatalog.copy.seedButtonLabel).toBe("Seed default surface pricing");
    expect(typeof pressureCatalog.loadServiceCatalog).toBe("function");
    expect(typeof pressureCatalog.seed).toBe("function");
  });
  it("provides a Settings editor component", () => {
    expect(pressureCatalog.SettingsEditor).toBeTruthy();
  });
});
