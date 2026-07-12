import type { Vertical } from "@/verticals/types";
import { lawnBilling } from "./billing";
import { lawnQuoteLine } from "./quote-line";
import { lawnCatalog } from "./catalog";
import { lawnRoutes, lawnNavEntries, lawnHomeActions } from "./shell";
import { lawnPlanCadence } from "./plan-cadence";
import { lawnCampaigns } from "./campaigns";
import { lawnPropertyFields } from "./property-fields";
import { lawnCopy } from "./copy";

// Lawn-care vertical (TurfPro). Phase 0a holds identity only; the lawn domain
// (catalog seed, calculators, GDD/season/weather, quote-line model, theme) is
// extracted here in Phase 0c.
export const lawnVertical: Vertical = {
  id: "turfpro",
  billing: lawnBilling,
  brand: {
    name: "TurfPro",
    tagline: "Lawn care quoting, scheduling, and billing.",
    bundleId: "com.turfpro.beta",
    themeColor: "#f5f1e8",
    fallbackBusinessName: "Lawn Care",
    authTagline: "Routes, plans, and recurring lawn-care ops.",
    deepLinkScheme: "turfpro",
  },
  quoteLine: lawnQuoteLine,
  catalog: lawnCatalog,
  extraRoutes: lawnRoutes,
  navEntries: lawnNavEntries,
  homeActions: lawnHomeActions,
  planCadence: lawnPlanCadence,
  campaigns: lawnCampaigns,
  propertyFields: lawnPropertyFields,
  copy: lawnCopy,
  season: { gddWatch: true, seasonMode: true, workConditions: true },
};
