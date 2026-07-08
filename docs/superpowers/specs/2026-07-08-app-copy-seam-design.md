# Phase 0c-6c — app-wide copy seam design

Status: approved design, ready for implementation planning.
Date: 2026-07-08.

## Context

Part of the multi-vertical platform. **0c-6** is the last domain slice, split into
**0c-6a campaign templates** (merged), **0c-6b property fields** (merged), and
**0c-6c app-wide copy** (this). It routes the ~40 hardcoded lawn/brand copy
literals in SHARED screens through `vertical.brand` (extended) + a new
`vertical.copy`.

### What the audit established

- **`vertical.brand` is defined but UNPLUMBED** — zero UI references today. It has
  `name`/`tagline`/`bundleId`/`themeColor`.
- **~40 literals across ~25 shared files**, in four buckets (full file:line
  inventory lives in the implementation plan). Lawn-domain screens already
  extracted to `extraRoutes` (calc, chem-log, routes, season/gdd) are OUT — their
  copy is the lawn vertical's own.
- **Two files are in the pre-existing tsc baseline** (`BusinessProfile.tsx`,
  `Onboarding.tsx`) — the gate for those is "no NEW error".

## Decisions

1. **Extend `Vertical.brand`** with `fallbackBusinessName: string` ("Lawn Care") and
   `authTagline: string` ("Routes, plans, and recurring lawn-care ops."). `name`,
   `tagline`, `bundleId`, `themeColor` stay.
2. **Add `vertical.copy: CopyModule`** — a flat object of the lawn-flavored domain
   strings (mirrors the working `vertical.catalog.copy` precedent). Parameterized
   strings carry `{token}` placeholders the consumer replaces (keeps `copy` a plain
   string object, no functions).
3. **Bucket A ("TurfPro" app-name) uses inline `vertical.brand.name`** — no copy
   keys; the surrounding sentence is generic, only the brand word varies.
4. **Scope = genuinely shared screens.** Auth's "One login works across TurfPro and
   PressurePro." STAYS (intentionally cross-brand).
5. **Behavior-identical for TurfPro.**

## The contract

**`src/verticals/types.ts` — extend `brand`:**
```ts
  brand: {
    name: string;
    tagline: string;
    bundleId: string;
    themeColor: string;
    fallbackBusinessName: string; // public print/gallery header fallback ("Lawn Care")
    authTagline: string;          // Auth screen subtitle
  };
```

**New file `src/verticals/copy.ts`:**
```ts
export interface CopyModule {
  // Public print / quote
  quoteRecurringBlurb: string;   // "We'll keep the lawn on schedule every {months} months."
  quoteFooterThankYou: string;   // "Thank you for the opportunity to quote your lawn."
  // Public gallery
  photoPairLabel: string;        // "Lawn care visit"
  galleryCtaHeadline: string;    // "Want a lawn like this?"
  galleryCtaBody: string;        // "Get a quote from {business} for your own yard."
  // Public review
  reviewCalloutHeadline: string; // "Help us reach more lawns"
  reviewCalloutBody: string;     // "A quick Google review goes a long way for a small lawn-care business."
  // Public plan portal
  planPortalSubtitle: string;    // "Manage your lawn-care plan below."
  // Plan empty states
  plansEmptyStateBody: string;   // "Recurring is the default for lawn care — add your first plan to get started."
  customerPlansEmptyState: string; // "No plans yet. Recurring service is the {brand} default — add a plan to put this customer on a route."
  // Onboarding + settings
  onboardingCatalogTitle: string;    // "Lawn services catalog"
  onboardingCatalogSubtitle: string; // "Want us to drop in the standard lawn-care services? You can edit them anytime."
  businessNamePlaceholder: string;   // "Acme Lawn Care" (Onboarding + BusinessProfile)
  catalogItemNamePlaceholder: string;// "Weekly mow" (CatalogEditor new-item name)
  completedNotificationBlurb: string;// "Thanks-for-letting-us-mow message after each stop wraps."
  // Onboarding seed preview (Step 3 UI list)
  onboardingSeedPreview: ReadonlyArray<{ name: string; price: string }>;
  // Pricing
  pricingTagline: string;        // "Built for lawn-care crews." (consumer appends " Cancel anytime.")
}
```

The `Vertical` interface gains `copy: CopyModule`. Tokens: `{months}`, `{business}`,
`{brand}` (replaced with `vertical.brand.name`).

## Architecture / mechanics

- **`src/verticals/lawn/copy.ts`** — `export const lawnCopy: CopyModule = { … }` with
  every value above (relocated verbatim from the screens, incl. the 6-item
  `onboardingSeedPreview` from Onboarding's `SEED_PREVIEW`). Lawn brand values move
  into `lawn/index.ts`'s `brand` (`fallbackBusinessName: "Lawn Care"`,
  `authTagline: "Routes, plans, and recurring lawn-care ops."`).
- **`src/verticals/lawn/index.ts`** — add the two `brand` fields + `copy: lawnCopy`.
- **Plumbing by bucket** (each touched file adds `import { vertical } from "@/vertical"`
  unless it already has it — 4 already do):
  - **A — brand name (~22 sites):** `Powered by TurfPro` → `` `Powered by ${vertical.brand.name}` `` /
    `{vertical.brand.name}`; bare `TurfPro` hero/logo/labels → `{vertical.brand.name}`;
    sentences with TurfPro embedded (CheckoutReturn, SubscriptionGate, SubscriptionCard,
    DemoBanner, Reports fees, Onboarding step-5, QuoteForm, PlanDetail confirm) →
    inline `${vertical.brand.name}`. Auth:366 cross-brand line UNCHANGED.
  - **B — fallback business name (5 sites):** `|| "Lawn Care"` / `|| "TURFPRO"` →
    `|| vertical.brand.fallbackBusinessName` (QuotePrint, InvoicePrint, Gallery ×2,
    BrandHeader). `Gallery:216` uppercases it: `(business || vertical.brand.fallbackBusinessName).toUpperCase()`.
  - **C — taglines:** Auth:234 → `{vertical.brand.authTagline}`; Pricing:317 →
    `{vertical.copy.pricingTagline} Cancel anytime.`
  - **D — domain copy (~16 keys):** replace each lawn string with
    `{vertical.copy.<key>}`; parameterized ones do `.replace("{months}", …)` /
    `.replace("{business}", business || "us")` / `.replace("{brand}", vertical.brand.name)`;
    `onboardingSeedPreview` renders `vertical.copy.onboardingSeedPreview`.

## Testing

- **Unit (vitest)** `src/verticals/lawn/copy.test.ts` + brand assertions: every
  `CopyModule` key is a non-empty string (and `onboardingSeedPreview` has 6 items);
  spot-check exact values (`quoteFooterThankYou`, `galleryCtaHeadline`,
  `pricingTagline`, `businessNamePlaceholder`); `lawnVertical.brand.fallbackBusinessName
  === "Lawn Care"` and `.authTagline` set. Conformance: `lawnVertical.copy` defined.
- **Build + tsc:** `npx tsc --noEmit -p tsconfig.app.json` — error set stays the
  known 6-file baseline; `BusinessProfile.tsx`/`Onboarding.tsx` gain NO new error;
  no other file appears. `npm run build`; full vitest suite green.
- **Manual (deferred, human):** spot-check the public prints, Auth, Onboarding,
  Gallery/Review/PlanPortal, Pricing, billing — all read identically to today.

## Out of scope (0c-6c)

- Lawn-domain screens already in `extraRoutes` (their copy is the vertical's own).
- Auth's cross-brand "One login…" line (stays).
- Any pressure copy values — Phase 1 (this seam makes them config-only).
- Deeper i18n / a general string catalog — YAGNI.
