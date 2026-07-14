import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { VERTICALS } from "@/verticals/registry";

// Settings → Campaigns card blurb — was a hardcoded lawn literal in
// Settings.tsx ("Blast aeration, leaf cleanup, …") leaking into pressure
// (found in the 2026-07-12 live verification). Now vertical.campaigns.copy
// owns it.

describe("campaigns settingsBlurb", () => {
  it("every vertical provides one", () => {
    for (const v of Object.values(VERTICALS)) {
      expect(v.campaigns.copy.settingsBlurb.length).toBeGreaterThan(0);
    }
  });

  it("pressure blurb has no lawn/snow terms", () => {
    const blurb = VERTICALS.pressure.campaigns.copy.settingsBlurb.toLowerCase();
    for (const term of ["aeration", "leaf", "mow", "snow", "lawn"]) {
      expect(blurb).not.toContain(term);
    }
  });
});
