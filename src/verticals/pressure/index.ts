import type { Vertical } from "@/verticals/types";
import { pressureQuoteLine } from "./quote-line";
import { pressureCatalog } from "./catalog";
import { pressureRoutes, pressureNavEntries, pressureHomeActions } from "./shell";
import { pressurePlanCadence } from "./plan-cadence";
import { pressureCampaigns } from "./campaigns";
import { pressurePropertyFields } from "./property-fields";
import { pressureCopy } from "./copy";
import { pressureBilling } from "./billing";

// Pressure-washing vertical (PressurePro). Assembled from the Phase 1 seam
// modules (1a–1d); native capacitor config is deferred to slice 1f.
export const pressureVertical: Vertical = {
  id: "pressurepro",
  brand: {
    name: "PressurePro",
    tagline: "Pressure & soft-wash quoting, scheduling, and billing.",
    bundleId: "com.pressurepro.app",
    themeColor: "#11203F",
    fallbackBusinessName: "Pressure Washing",
    authTagline: "Quotes, plans, and recurring wash-route ops.",
    deepLinkScheme: "pressurepro",
  },
  billing: pressureBilling,
  quoteLine: pressureQuoteLine,
  catalog: pressureCatalog,
  extraRoutes: pressureRoutes,
  navEntries: pressureNavEntries,
  homeActions: pressureHomeActions,
  planCadence: pressurePlanCadence,
  campaigns: pressureCampaigns,
  propertyFields: pressurePropertyFields,
  copy: pressureCopy,
};
