// The Vertical contract — the per-trade configuration the shared core reads.
//
// Phase 0a is intentionally minimal (identity + brand). Later phases WIDEN this
// interface with the domain seams (quoteLine, catalog, theme, calculators,
// plan cadence, weather semantics, property fields, copy, extraRoutes) as those
// pieces are extracted out of the shared core. Do not add unused seams early.

import type { QuoteLineModule } from "./quote-line";
import type { CatalogModule } from "./catalog";
import type { VerticalRoute, NavEntry, HomeAction } from "./shell";
import type { PlanCadenceModule } from "./plan-cadence";
import type { CampaignsModule } from "./campaigns";
import type { PropertyFieldsModule } from "./property-fields";
import type { CopyModule } from "./copy";

export type AppId = "turfpro" | "pressurepro";

export interface Vertical {
  /** Trade identity — equals the DB `app` discriminator for this trade. */
  id: AppId;
  brand: {
    /** Display name, e.g. "TurfPro". */
    name: string;
    /** One-line positioning shown in marketing/settings surfaces. */
    tagline: string;
    /** Capacitor appId / bundle identifier, e.g. "com.turfpro.beta". */
    bundleId: string;
    /** Native status-bar / web theme-color hex. */
    themeColor: string;
    /** Public print/gallery header fallback when no business name is set ("Lawn Care"). */
    fallbackBusinessName: string;
    /** Auth screen subtitle. */
    authTagline: string;
  };
  quoteLine: QuoteLineModule;
  catalog: CatalogModule;
  /** Routes this vertical injects into the shared router (lawn: calc, chem-log, routes). */
  extraRoutes: VerticalRoute[];
  /** Bottom tab-bar entries for this vertical. */
  navEntries: NavEntry[];
  /** Home quick-action tiles specific to this vertical. */
  homeActions: HomeAction[];
  /** Recurring-service cadence config (frequencies, labels, season swap). */
  planCadence: PlanCadenceModule;
  /** Campaign message templates + campaign-surface copy for this vertical. */
  campaigns: CampaignsModule;
  /** Editable custom property fields + section copy for this vertical. */
  propertyFields: PropertyFieldsModule;
  /** Lawn-flavored domain copy rendered by shared screens. */
  copy: CopyModule;
}
