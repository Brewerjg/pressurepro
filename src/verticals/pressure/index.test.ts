import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { VERTICALS } from "@/verticals/registry";

describe("pressure vertical registration", () => {
  it("is registered and complete", () => {
    const p = VERTICALS.pressure;
    expect(p).toBeDefined();
    expect(p.id).toBe("pressurepro");
    for (const k of ["brand","billing","quoteLine","catalog","extraRoutes","navEntries","homeActions","planCadence","campaigns","propertyFields","copy"] as const) {
      expect(p[k]).toBeDefined();
    }
    expect(p.brand.deepLinkScheme).toBe("pressurepro");
    expect(p.navEntries).toHaveLength(5);
  });
});
