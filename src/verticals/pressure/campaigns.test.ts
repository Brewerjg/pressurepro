import { describe, it, expect } from "vitest";
import { pressureCampaigns } from "./campaigns";

describe("pressureCampaigns", () => {
  it("offers the six pressure templates + custom default", () => {
    const kinds = pressureCampaigns.templates.map((t) => t.kind);
    expect(kinds).toEqual([
      "spring_signup", "pre_winter_wash", "fence_deck_refresh",
      "commercial_requote", "roof_softwash", "custom",
    ]);
    expect(pressureCampaigns.defaultKind).toBe("spring_signup");
  });

  it("uses unified merge tags, not PressurePro camelCase", () => {
    for (const t of pressureCampaigns.templates) {
      if (t.kind === "custom") continue;
      expect(t.body).toContain("{first_name}");
      expect(t.body).toContain("{business_name}");
      expect(t.body).not.toContain("{firstName}");
      expect(t.body).not.toContain("{businessName}");
    }
  });

  it("has an empty custom template and campaign copy", () => {
    const custom = pressureCampaigns.templates.find((t) => t.kind === "custom")!;
    expect(custom.subject).toBe("");
    expect(custom.body).toBe("");
    expect(pressureCampaigns.copy.previewFallbackBusinessName).toBe("your wash crew");
  });
});
