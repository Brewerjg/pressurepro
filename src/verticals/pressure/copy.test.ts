import { describe, it, expect } from "vitest";
import { pressureCopy } from "./copy";

describe("pressureCopy", () => {
  it("has non-empty strings for every scalar key", () => {
    const scalar: Array<keyof typeof pressureCopy> = [
      "quoteRecurringBlurb", "quoteFooterThankYou", "photoPairLabel",
      "galleryCtaHeadline", "galleryCtaBody", "reviewCalloutHeadline",
      "reviewCalloutBody", "planPortalSubtitle", "plansEmptyStateBody",
      "customerPlansEmptyState", "onboardingCatalogTitle", "onboardingCatalogSubtitle",
      "businessNamePlaceholder", "catalogItemNamePlaceholder", "completedNotificationBlurb",
      "pricingTagline",
    ];
    for (const k of scalar) {
      expect(typeof pressureCopy[k]).toBe("string");
      expect((pressureCopy[k] as string).length).toBeGreaterThan(0);
    }
  });

  it("preserves parameter tokens and spot-checks values", () => {
    expect(pressureCopy.quoteRecurringBlurb).toContain("{months}");
    expect(pressureCopy.galleryCtaBody).toContain("{business}");
    expect(pressureCopy.customerPlansEmptyState).toContain("{brand}");
    expect(pressureCopy.businessNamePlaceholder).toBe("Acme Pressure Washing");
    expect(pressureCopy.onboardingCatalogTitle).toBe("Surface pricing");
    expect(pressureCopy.pricingTagline).toBe("Built for pressure-washing pros.");
  });

  it("has a 6-item onboarding seed preview", () => {
    expect(pressureCopy.onboardingSeedPreview).toHaveLength(6);
  });
});
