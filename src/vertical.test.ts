import { describe, it, expect, vi } from "vitest";

// Stub the Supabase client so pressure/catalog.ts loads in the Node test environment.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { vertical } from "@/vertical";
import { VERTICALS } from "@/verticals/registry";

describe("vertical selection", () => {
  it("defaults to the pressure vertical (id pressurepro) when VITE_VERTICAL is unset", () => {
    expect(vertical.id).toBe("pressurepro");
  });
  it("every registered vertical has a valid id and brand", () => {
    for (const [slug, v] of Object.entries(VERTICALS)) {
      expect(typeof slug).toBe("string");
      expect(v.id).toBe("pressurepro");
      expect(v.brand.name.length).toBeGreaterThan(0);
      expect(v.brand.bundleId.length).toBeGreaterThan(0);
    }
  });
});
