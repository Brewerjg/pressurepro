import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { VERTICALS } from "@/verticals/registry";

// vertical.season flags — the minimal 0c-5 stand-in that keeps lawn-only
// agronomy UI (Pre-emergent/GDD watch on Home, the Season/winter-mode toggle
// in Settings) out of other verticals. Found leaking on the live pressure
// deploy during 1f verification (runbook anomalies A2/A3).

describe("vertical.season flags", () => {
  it("lawn keeps GDD watch, season mode, and work-condition verdicts", () => {
    expect(VERTICALS.lawn.season).toEqual({
      gddWatch: true,
      seasonMode: true,
      workConditions: true,
    });
  });

  it("pressure hides GDD watch, season mode, and work-condition verdicts", () => {
    expect(VERTICALS.pressure.season).toEqual({
      gddWatch: false,
      seasonMode: false,
      workConditions: false,
    });
  });

  it("every registered vertical declares the flags", () => {
    for (const v of Object.values(VERTICALS)) {
      expect(typeof v.season.gddWatch).toBe("boolean");
      expect(typeof v.season.seasonMode).toBe("boolean");
      expect(typeof v.season.workConditions).toBe("boolean");
    }
  });
});
