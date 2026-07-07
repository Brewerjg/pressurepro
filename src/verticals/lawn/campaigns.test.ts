import { describe, it, expect } from "vitest";
import { lawnCampaigns } from "@/verticals/lawn/campaigns";

describe("lawnCampaigns", () => {
  it("offers the 6 lawn templates including custom", () => {
    expect(lawnCampaigns.templates.map((t) => t.kind)).toEqual([
      "aeration", "leaf_cleanup", "spring_restart", "fert_program", "snow_signup", "custom",
    ]);
  });
  it("defaults to the aeration template", () => {
    expect(lawnCampaigns.defaultKind).toBe("aeration");
  });
  it("every template has a label and an icon", () => {
    for (const t of lawnCampaigns.templates) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.icon).toBeTruthy();
    }
  });
  it("carries the lawn campaign copy", () => {
    expect(lawnCampaigns.copy.previewFallbackBusinessName).toBe("your lawn crew");
    expect(lawnCampaigns.copy.pageSubtitle.length).toBeGreaterThan(0);
    expect(lawnCampaigns.copy.emptyStateBlurb.length).toBeGreaterThan(0);
  });
});
