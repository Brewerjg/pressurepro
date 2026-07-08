import { describe, it, expect } from "vitest";
import { lawnVertical } from "./index";
import { lawnCopy } from "./copy";

describe("lawn copy module", () => {
  it("is registered on the vertical", () => {
    expect(lawnVertical.copy).toBe(lawnCopy);
  });

  it("extends brand with fallback + auth tagline", () => {
    expect(lawnVertical.brand.fallbackBusinessName).toBe("Lawn Care");
    expect(lawnVertical.brand.authTagline).toBe(
      "Routes, plans, and recurring lawn-care ops.",
    );
  });

  it("has non-empty string values for every scalar copy key", () => {
    const scalarKeys: Array<keyof typeof lawnCopy> = [
      "quoteRecurringBlurb",
      "quoteFooterThankYou",
      "photoPairLabel",
      "galleryCtaHeadline",
      "galleryCtaBody",
      "reviewCalloutHeadline",
      "reviewCalloutBody",
      "planPortalSubtitle",
      "plansEmptyStateBody",
      "customerPlansEmptyState",
      "onboardingCatalogTitle",
      "onboardingCatalogSubtitle",
      "businessNamePlaceholder",
      "catalogItemNamePlaceholder",
      "completedNotificationBlurb",
      "pricingTagline",
    ];
    for (const k of scalarKeys) {
      expect(typeof lawnCopy[k]).toBe("string");
      expect((lawnCopy[k] as string).length).toBeGreaterThan(0);
    }
  });

  it("spot-checks exact values", () => {
    expect(lawnCopy.quoteFooterThankYou).toBe(
      "Thank you for the opportunity to quote your lawn.",
    );
    expect(lawnCopy.galleryCtaHeadline).toBe("Want a lawn like this?");
    expect(lawnCopy.pricingTagline).toBe("Built for lawn-care crews.");
    expect(lawnCopy.businessNamePlaceholder).toBe("Acme Lawn Care");
    expect(lawnCopy.catalogItemNamePlaceholder).toBe("Weekly mow");
  });

  it("preserves the {token} placeholders for parameterized strings", () => {
    expect(lawnCopy.quoteRecurringBlurb).toContain("{months}");
    expect(lawnCopy.galleryCtaBody).toContain("{business}");
    expect(lawnCopy.customerPlansEmptyState).toContain("{brand}");
  });

  it("has a 6-item onboarding seed preview", () => {
    expect(lawnCopy.onboardingSeedPreview).toHaveLength(6);
    expect(lawnCopy.onboardingSeedPreview[0]).toEqual({
      name: "Weekly mow",
      price: "$45",
    });
  });
});
