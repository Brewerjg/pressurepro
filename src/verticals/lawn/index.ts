import type { Vertical } from "@/verticals/types";

// Lawn-care vertical (TurfPro). Phase 0a holds identity only; the lawn domain
// (catalog seed, calculators, GDD/season/weather, quote-line model, theme) is
// extracted here in Phase 0c.
export const lawnVertical: Vertical = {
  id: "turfpro",
  brand: {
    name: "TurfPro",
    tagline: "Lawn care quoting, scheduling, and billing.",
    bundleId: "com.turfpro.beta",
    themeColor: "#f5f1e8",
  },
};
