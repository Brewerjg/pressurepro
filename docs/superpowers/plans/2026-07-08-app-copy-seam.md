# App-wide Copy Seam (Phase 0c-6c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the ~40 hardcoded lawn/brand copy literals in SHARED screens through `vertical.brand` (extended) and a new `vertical.copy` module, so a future pressure vertical changes copy by config only.

**Architecture:** Extend `Vertical.brand` with two string fields (`fallbackBusinessName`, `authTagline`). Add a new flat `vertical.copy: CopyModule` of lawn-flavored domain strings (mirrors the existing `vertical.catalog` / `vertical.campaigns` precedent). Parameterized strings carry `{token}` placeholders the consumer replaces with `.replace(...)`. Plumb the literals through these in four buckets. Behavior-identical for TurfPro.

**Tech Stack:** React + TypeScript + Vite, vitest. Config lives in `src/verticals/`; the resolver is `@/vertical` (singular).

## Global Constraints

- **tsc gate:** `npx tsc --noEmit -p tsconfig.app.json` (NOT root `tsc --noEmit`, which has `files:[]` and exits 0 uselessly). The pre-existing baseline is exactly 6 files: `AudienceStep.tsx`, `campaigns/templates.ts`, `BusinessProfile.tsx`, `iap.ts`, `Campaigns.tsx`, `Onboarding.tsx`. Gate = that error set stays EXACTLY these 6, no NEW file appears. `BusinessProfile.tsx` and `Onboarding.tsx` are already in the baseline; the gate for those is "no NEW error" (their error count does not increase).
- **Only user-visible text changes.** NEVER touch comments, JSDoc, identifiers (e.g. the `TurfProFeesCard` component name), storage-key strings, bundle IDs, user-agent strings, or anything under `src/lib/`, `src/integrations/`. Every edit is a JSX text node or a string passed to a UI prop.
- **Import path:** add `import { vertical } from "@/vertical";` (singular) to any touched file that does not already import it. Idempotent — if the file already imports `vertical`, do not add a duplicate.
- **Auth.tsx:366 STAYS UNCHANGED:** "One login works across TurfPro and PressurePro." is intentionally cross-brand.
- **Token replacement rules:** `{months}` → `String(q.recurring_months)`; `{business}` → `business || "us"`; `{brand}` → `vertical.brand.name`.
- **Commit trailers required on every commit:**
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QrF17kQNQsTPBTHee6C3br
  ```
- Full vitest suite must stay green; `npm run build` must succeed at the end.

---

### Task 1: The contract — extend brand, add CopyModule + lawnCopy, register, test

**Files:**
- Modify: `src/verticals/types.ts` (brand block + add `copy: CopyModule`)
- Create: `src/verticals/copy.ts` (`CopyModule` interface)
- Create: `src/verticals/lawn/copy.ts` (`lawnCopy`)
- Modify: `src/verticals/lawn/index.ts` (register brand fields + `copy`)
- Test: `src/verticals/lawn/copy.test.ts`

**Interfaces:**
- Produces: `import type { CopyModule } from "@/verticals/copy"`; `import { lawnCopy } from "./copy"`. `vertical.brand.fallbackBusinessName: string`, `vertical.brand.authTagline: string`, `vertical.copy: CopyModule`. The `CopyModule` keys (all `string` unless noted) that later tasks consume: `quoteRecurringBlurb`, `quoteFooterThankYou`, `photoPairLabel`, `galleryCtaHeadline`, `galleryCtaBody`, `reviewCalloutHeadline`, `reviewCalloutBody`, `planPortalSubtitle`, `plansEmptyStateBody`, `customerPlansEmptyState`, `onboardingCatalogTitle`, `onboardingCatalogSubtitle`, `businessNamePlaceholder`, `catalogItemNamePlaceholder`, `completedNotificationBlurb`, `pricingTagline`, and `onboardingSeedPreview: ReadonlyArray<{ name: string; price: string }>`.

- [ ] **Step 1: Write the failing test**

Create `src/verticals/lawn/copy.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/verticals/lawn/copy.test.ts`
Expected: FAIL — `./copy` does not exist / `lawnVertical.copy` undefined.

- [ ] **Step 3: Create the `CopyModule` interface**

Create `src/verticals/copy.ts`:

```ts
// The lawn-flavored domain copy that shared screens render. A flat object of
// strings (mirrors vertical.catalog / vertical.campaigns). Parameterized strings
// carry {token} placeholders the CONSUMER replaces — keeps this a plain string
// object with no functions. Tokens: {months}, {business}, {brand}.
export interface CopyModule {
  // Public print / quote
  quoteRecurringBlurb: string; // "We'll keep the lawn on schedule every {months} months."
  quoteFooterThankYou: string; // "Thank you for the opportunity to quote your lawn."
  // Public gallery
  photoPairLabel: string; // "Lawn care visit"
  galleryCtaHeadline: string; // "Want a lawn like this?"
  galleryCtaBody: string; // "Get a quote from {business} for your own yard."
  // Public review
  reviewCalloutHeadline: string; // "Help us reach more lawns"
  reviewCalloutBody: string; // "A quick Google review goes a long way for a small lawn-care business."
  // Public plan portal
  planPortalSubtitle: string; // "Manage your lawn-care plan below."
  // Plan empty states
  plansEmptyStateBody: string; // "Recurring is the default for lawn care — add your first plan to get started."
  customerPlansEmptyState: string; // "No plans yet. Recurring service is the {brand} default — add a plan to put this customer on a route."
  // Onboarding + settings
  onboardingCatalogTitle: string; // "Lawn services catalog"
  onboardingCatalogSubtitle: string; // "Want us to drop in the standard lawn-care services? You can edit them anytime."
  businessNamePlaceholder: string; // "Acme Lawn Care" (Onboarding + BusinessProfile)
  catalogItemNamePlaceholder: string; // "Weekly mow" (CatalogEditor new-item name)
  completedNotificationBlurb: string; // "Thanks-for-letting-us-mow message after each stop wraps."
  // Onboarding seed preview (Step 3 UI list)
  onboardingSeedPreview: ReadonlyArray<{ name: string; price: string }>;
  // Pricing
  pricingTagline: string; // "Built for lawn-care crews." (consumer appends " Cancel anytime.")
}
```

- [ ] **Step 4: Create `lawnCopy`**

Create `src/verticals/lawn/copy.ts` (values relocated verbatim from the screens):

```ts
import type { CopyModule } from "@/verticals/copy";

export const lawnCopy: CopyModule = {
  quoteRecurringBlurb: "We'll keep the lawn on schedule every {months} months.",
  quoteFooterThankYou: "Thank you for the opportunity to quote your lawn.",
  photoPairLabel: "Lawn care visit",
  galleryCtaHeadline: "Want a lawn like this?",
  galleryCtaBody: "Get a quote from {business} for your own yard.",
  reviewCalloutHeadline: "Help us reach more lawns",
  reviewCalloutBody:
    "A quick Google review goes a long way for a small lawn-care business.",
  planPortalSubtitle: "Manage your lawn-care plan below.",
  plansEmptyStateBody:
    "Recurring is the default for lawn care — add your first plan to get started.",
  customerPlansEmptyState:
    "No plans yet. Recurring service is the {brand} default — add a plan to put this customer on a route.",
  onboardingCatalogTitle: "Lawn services catalog",
  onboardingCatalogSubtitle:
    "Want us to drop in the standard lawn-care services? You can edit them anytime.",
  businessNamePlaceholder: "Acme Lawn Care",
  catalogItemNamePlaceholder: "Weekly mow",
  completedNotificationBlurb:
    "Thanks-for-letting-us-mow message after each stop wraps.",
  onboardingSeedPreview: [
    { name: "Weekly mow", price: "$45" },
    { name: "Biweekly mow", price: "$55" },
    { name: "Spring cleanup", price: "$175" },
    { name: "Aeration", price: "$125" },
    { name: "Fert step 1 (pre-emergent)", price: "$85" },
    { name: "+ 17 more (cleanups, fert, snow…)", price: "" },
  ],
  pricingTagline: "Built for lawn-care crews.",
};
```

- [ ] **Step 5: Extend the `brand` block + add `copy` to the `Vertical` contract**

In `src/verticals/types.ts`, add the import near the other module-type imports:

```ts
import type { CopyModule } from "./copy";
```

Extend the `brand` object type (add the two fields after `themeColor`):

```ts
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
```

Add `copy` to the `Vertical` interface (after `propertyFields`):

```ts
  /** Editable custom property fields + section copy for this vertical. */
  propertyFields: PropertyFieldsModule;
  /** Lawn-flavored domain copy rendered by shared screens. */
  copy: CopyModule;
```

- [ ] **Step 6: Register on the lawn vertical**

In `src/verticals/lawn/index.ts`, add the import:

```ts
import { lawnCopy } from "./copy";
```

Add the two brand fields (after `themeColor`):

```ts
  brand: {
    name: "TurfPro",
    tagline: "Lawn care quoting, scheduling, and billing.",
    bundleId: "com.turfpro.beta",
    themeColor: "#f5f1e8",
    fallbackBusinessName: "Lawn Care",
    authTagline: "Routes, plans, and recurring lawn-care ops.",
  },
```

Add `copy` to the object (after `propertyFields: lawnPropertyFields,`):

```ts
  propertyFields: lawnPropertyFields,
  copy: lawnCopy,
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/verticals/lawn/copy.test.ts`
Expected: PASS (all cases).

- [ ] **Step 8: Verify tsc gate + full suite**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: error set unchanged (the known 6 baseline files only; no `types.ts`/`copy.ts`/`lawn/index.ts` errors).

Run: `npx vitest run`
Expected: full suite green.

- [ ] **Step 9: Commit**

```bash
git add src/verticals/types.ts src/verticals/copy.ts src/verticals/lawn/copy.ts src/verticals/lawn/index.ts src/verticals/lawn/copy.test.ts
git commit
```
(Use a message like `feat(platform): add vertical.copy + brand fallback/auth-tagline (contract)` with the required trailers.)

---

### Task 2: Bucket A — brand name plumbing (~24 sites, 18 files)

**Files (all Modify):** `src/pages/Accept.tsx`, `src/pages/InvoiceView.tsx`, `src/pages/InvoicePrint.tsx`, `src/pages/PlanPortal.tsx`, `src/pages/QuotePrint.tsx`, `src/pages/Review.tsx`, `src/components/public/BrandHeader.tsx`, `src/pages/Auth.tsx`, `src/pages/ResetPassword.tsx`, `src/pages/Onboarding.tsx`, `src/pages/Pricing.tsx`, `src/pages/CheckoutReturn.tsx`, `src/pages/Gallery.tsx`, `src/components/billing/PaywallScreen.tsx`, `src/components/billing/SubscriptionGate.tsx`, `src/components/settings/SubscriptionCard.tsx`, `src/components/DemoBanner.tsx`, `src/pages/Reports.tsx`, `src/components/quotes/QuoteForm.tsx`, `src/pages/PlanDetail.tsx`

**Interfaces:**
- Consumes: `vertical.brand.name` (from Task 1 — already existed, now guaranteed on the contract). Add `import { vertical } from "@/vertical";` to each file that lacks it (QuoteForm and PlanDetail already import it).

There is no unit test for this task (pure JSX text swap); the gate is tsc-clean + build + manual read-through. Do all edits, then run the gate, then commit once.

- [ ] **Step 1: "Powered by …" surfaces — swap the brand word to `{vertical.brand.name}`**

Each below: replace ONLY the literal `TurfPro` token; leave surrounding markup identical.

- `src/pages/Accept.tsx:502` — `Powered by <span className="font-semibold text-brand-800">TurfPro</span>` → inner text becomes `{vertical.brand.name}`:
  `Powered by <span className="font-semibold text-brand-800">{vertical.brand.name}</span>`
- `src/pages/InvoiceView.tsx:370` — same `<span>` pattern → `{vertical.brand.name}` inside the span.
- `src/pages/InvoicePrint.tsx:144` — `Powered by TurfPro` → `Powered by {vertical.brand.name}`
- `src/pages/PlanPortal.tsx:436` — `Powered by TurfPro` → `Powered by {vertical.brand.name}`
- `src/pages/QuotePrint.tsx:156` — `Powered by TurfPro` → `Powered by {vertical.brand.name}`
- `src/pages/Review.tsx:298` — `Powered by TurfPro` → `Powered by {vertical.brand.name}`
- `src/components/public/BrandHeader.tsx:31` — hero text `TurfPro` → `{vertical.brand.name}`

- [ ] **Step 2: Hero / logo / label sites — bare `TurfPro` → `{vertical.brand.name}`**

- `src/pages/Auth.tsx:231` — `TurfPro` (the `tp-display` hero div) → `{vertical.brand.name}`. **DO NOT touch line 366** ("One login works across TurfPro and PressurePro.").
- `src/pages/ResetPassword.tsx:100` — `TurfPro` → `{vertical.brand.name}`
- `src/pages/Onboarding.tsx:431` — `TurfPro` (hero) → `{vertical.brand.name}`
- `src/pages/Pricing.tsx:299` — `<div className="font-display font-extrabold text-lg text-neutral-900">TurfPro</div>` → inner text `{vertical.brand.name}`
- `src/components/billing/PaywallScreen.tsx:120` — `TurfPro` → `{vertical.brand.name}`
- `src/components/billing/PaywallScreen.tsx:256` — `TurfPro` → `{vertical.brand.name}`

- [ ] **Step 3: Embedded-in-sentence sites — inline `${vertical.brand.name}` / `{vertical.brand.name}`**

- `src/pages/CheckoutReturn.tsx:220` — JSX text `Welcome to TurfPro. Taking you to your settings…` → `Welcome to {vertical.brand.name}. Taking you to your settings…`
- `src/pages/Gallery.tsx:212` — link text `Get a quote from TurfPro` → `Get a quote from {vertical.brand.name}`
- `src/components/settings/SubscriptionCard.tsx:168` — `Subscriptions are managed in the TurfPro mobile app. Open the app on` → `Subscriptions are managed in the {vertical.brand.name} mobile app. Open the app on`
- `src/components/DemoBanner.tsx:72` — `<strong>Demo Mode:</strong> You're exploring TurfPro with a demo account. Data won't be saved.` → `…You're exploring {vertical.brand.name} with a demo account…`
- `src/pages/Reports.tsx:1205` — JSX text `TurfPro fees · this month` → `{vertical.brand.name} fees · this month`
- `src/pages/Reports.tsx:1212` — JSX text `TurfPro takes 0% — you keep 100% of customer payments.` → `{vertical.brand.name} takes 0% — you keep 100% of customer payments.`
  (Leave the `TurfProFeesCard` component name and all comments in Reports.tsx UNTOUCHED.)

- [ ] **Step 4: String-value props / expressions — convert to template literals**

- `src/pages/Onboarding.tsx:995` — `subtitle="TurfPro charges your customers and deposits the money in your bank account. Connect Stripe once — takes about 2 minutes."` → `subtitle={`${vertical.brand.name} charges your customers and deposits the money in your bank account. Connect Stripe once — takes about 2 minutes.`}`
- `src/components/billing/SubscriptionGate.tsx:73` — `? "Your trial ends tomorrow — pick a plan to keep TurfPro."` → `` ? `Your trial ends tomorrow — pick a plan to keep ${vertical.brand.name}.` ``
- `src/components/billing/SubscriptionGate.tsx:78` — `copy = "Subscribe to unlock TurfPro.";` → `` copy = `Subscribe to unlock ${vertical.brand.name}.`; ``
- `src/components/quotes/QuoteForm.tsx:234` — `subtitle="Optional deposit and expiry — TurfPro defaults to 0% deposit and a 14-day window."` → `subtitle={`Optional deposit and expiry — ${vertical.brand.name} defaults to 0% deposit and a 14-day window.`}`
- `src/pages/PlanDetail.tsx:375` — `"Mark this failure as resolved? Stripe will keep retrying — this just hides the alert in TurfPro.",` → `` `Mark this failure as resolved? Stripe will keep retrying — this just hides the alert in ${vertical.brand.name}.`, ``

- [ ] **Step 5: Add the `vertical` import where missing**

For each file touched above that does NOT already `import { vertical } from "@/vertical";`, add it with the other imports. Files that ALREADY import it: `QuoteForm.tsx`, `PlanDetail.tsx`. All the others in this task need the import added.

- [ ] **Step 6: Verify no stray user-facing `TurfPro` remains in touched files**

Run: `git diff --name-only` then for the touched pages/components confirm remaining `TurfPro` hits are only comments/identifiers/Auth:366:

Run: `grep -rn "TurfPro" src/pages/ src/components/ | grep -v "verticals/"`
Expected: remaining hits are ONLY comments (`//`), the `TurfProFeesCard` identifier + its comments in Reports.tsx, and `Auth.tsx:366`.

- [ ] **Step 7: tsc gate + build**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: error set unchanged (the known 6 baseline files only; `Onboarding.tsx` count does NOT increase; no new file appears).

Run: `npx vitest run`
Expected: full suite green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit
```
(`feat(platform): route brand name through vertical.brand.name in shared screens` + trailers.)

---

### Task 3: Buckets B + C — fallback business name + taglines

**Files (all Modify):** `src/components/public/BrandHeader.tsx`, `src/pages/Gallery.tsx`, `src/pages/InvoicePrint.tsx`, `src/pages/QuotePrint.tsx`, `src/pages/Auth.tsx`, `src/pages/Pricing.tsx`

**Interfaces:**
- Consumes: `vertical.brand.fallbackBusinessName`, `vertical.brand.authTagline` (Task 1), `vertical.copy.pricingTagline` (Task 1). BrandHeader/Gallery/InvoicePrint/QuotePrint/Auth/Pricing all received the `vertical` import in Task 2 (Gallery, InvoicePrint, QuotePrint, BrandHeader, Auth, Pricing were all touched in Task 2). If any lacks it, add it.

- [ ] **Step 1: Bucket B — replace the "Lawn Care" / "TURFPRO" fallbacks**

- `src/components/public/BrandHeader.tsx:34` — `{business || "Lawn Care"}` → `{business || vertical.brand.fallbackBusinessName}`
- `src/pages/Gallery.tsx:125` — `<BrandHeader business={business || "Lawn Care"}>` → `<BrandHeader business={business || vertical.brand.fallbackBusinessName}>`
- `src/pages/Gallery.tsx:216` — `{(business || "TURFPRO").toUpperCase()}` → `{(business || vertical.brand.fallbackBusinessName).toUpperCase()}`
- `src/pages/InvoicePrint.tsx:140` — `<h1 className="text-3xl mt-1 brand">{biz.business || "Lawn Care"}</h1>` → `{biz.business || vertical.brand.fallbackBusinessName}`
- `src/pages/QuotePrint.tsx:152` — `<h1 className="text-3xl mt-1 brand">{biz.business || "Lawn Care"}</h1>` → `{biz.business || vertical.brand.fallbackBusinessName}`

- [ ] **Step 2: Bucket C — taglines**

- `src/pages/Auth.tsx:234` — JSX text (the `<p className="text-sm text-white/80 mt-1">` subtitle) `Routes, plans, and recurring lawn-care ops.` → `{vertical.brand.authTagline}`
- `src/pages/Pricing.tsx:317` — JSX text `Built for lawn-care crews. Cancel anytime.` → `{vertical.copy.pricingTagline} Cancel anytime.`

- [ ] **Step 3: Confirm imports present**

Ensure every file in this task imports `vertical` (all were touched in Task 2; add if any is missing).

- [ ] **Step 4: tsc gate + build**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: error set unchanged (6 baseline files; no new file).

Run: `npx vitest run`
Expected: full suite green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit
```
(`feat(platform): route business-name fallback + taglines through vertical` + trailers.)

---

### Task 4: Bucket D — domain copy plumbing (~15 keys)

**Files (all Modify):** `src/pages/QuotePrint.tsx`, `src/pages/Gallery.tsx`, `src/pages/Review.tsx`, `src/pages/PlanPortal.tsx`, `src/pages/Plans.tsx`, `src/pages/CustomerDetail.tsx`, `src/pages/Onboarding.tsx`, `src/components/settings/MessagingPreferences.tsx`, `src/components/settings/BusinessProfile.tsx`, `src/components/settings/CatalogEditor.tsx`

**Interfaces:**
- Consumes: `vertical.copy.*` (Task 1). Files touched here already import `vertical` after Tasks 2–3 for QuotePrint/Gallery/Review/PlanPortal/Plans/CustomerDetail/Onboarding/CatalogEditor. `MessagingPreferences.tsx` and `BusinessProfile.tsx` may NOT yet import it — add `import { vertical } from "@/vertical";` where missing. `BusinessProfile.tsx` and `Onboarding.tsx` are in the tsc baseline — gate is "no NEW error".

- [ ] **Step 1: QuotePrint — recurring blurb + footer**

- `src/pages/QuotePrint.tsx:232` — `We'll keep the lawn on schedule every {q.recurring_months} months.` → `{vertical.copy.quoteRecurringBlurb.replace("{months}", String(q.recurring_months))}`
- `src/pages/QuotePrint.tsx:247` — footer JSX text `Thank you for the opportunity to quote your lawn.` → `{vertical.copy.quoteFooterThankYou}`

- [ ] **Step 2: Gallery — photo label + CTA headline/body**

- `src/pages/Gallery.tsx:180` — `<div className="font-bold text-[13px] text-neutral-900">Lawn care visit</div>` → inner text `{vertical.copy.photoPairLabel}`
- `src/pages/Gallery.tsx:203` — headline JSX text `Want a lawn like this?` → `{vertical.copy.galleryCtaHeadline}`
- `src/pages/Gallery.tsx:206` — `Get a quote from {business || "us"} for your own yard.` → `{vertical.copy.galleryCtaBody.replace("{business}", business || "us")}`

- [ ] **Step 3: Review — callout headline/body**

- `src/pages/Review.tsx:195` — headline JSX text `Help us reach more lawns` → `{vertical.copy.reviewCalloutHeadline}`
- `src/pages/Review.tsx:198` — body JSX text `A quick Google review goes a long way for a small lawn-care business.` → `{vertical.copy.reviewCalloutBody}`

- [ ] **Step 4: PlanPortal — subtitle**

- `src/pages/PlanPortal.tsx:284` — `<p className="text-white/75 text-sm mt-1.5">Manage your lawn-care plan below.</p>` → inner text `{vertical.copy.planPortalSubtitle}`

- [ ] **Step 5: Plans + CustomerDetail — empty states**

- `src/pages/Plans.tsx:222` — the `<p>` body currently reads (wrapped across lines) `Recurring is the default for lawn care — add your first plan to get started.` → replace the text content with `{vertical.copy.plansEmptyStateBody}`
- `src/pages/CustomerDetail.tsx:372` — the `<div>` body `No plans yet. Recurring service is the TurfPro default — add a plan to put this customer on a route.` → `{vertical.copy.customerPlansEmptyState.replace("{brand}", vertical.brand.name)}`

- [ ] **Step 6: Onboarding — catalog step copy, business placeholder, seed preview**

- `src/pages/Onboarding.tsx:476` — `title="Lawn services catalog"` → `title={vertical.copy.onboardingCatalogTitle}`
- `src/pages/Onboarding.tsx:477` — `subtitle="Want us to drop in the standard lawn-care services? You can edit them anytime."` → `subtitle={vertical.copy.onboardingCatalogSubtitle}`
- `src/pages/Onboarding.tsx:654` — `placeholder="Acme Lawn Care"` → `placeholder={vertical.copy.businessNamePlaceholder}`
- `src/pages/Onboarding.tsx` — delete the module-level `const SEED_PREVIEW = [...]` (lines ~62–69) and change the map source at line ~862 from `SEED_PREVIEW.map(` → `vertical.copy.onboardingSeedPreview.map(`. Confirm no other `SEED_PREVIEW` references remain: `grep -n "SEED_PREVIEW" src/pages/Onboarding.tsx` should return nothing after the edit.

- [ ] **Step 7: MessagingPreferences + BusinessProfile + CatalogEditor**

- `src/components/settings/MessagingPreferences.tsx:67` — in the `completed` message def, `blurb: "Thanks-for-letting-us-mow message after each stop wraps.",` → `blurb: vertical.copy.completedNotificationBlurb,` (add the `vertical` import if missing; if the surrounding array is module-level, referencing `vertical` there is fine — it is a resolved singleton).
- `src/components/settings/BusinessProfile.tsx:116` — `placeholder="Acme Lawn Care"` → `placeholder={vertical.copy.businessNamePlaceholder}` (add import if missing).
- `src/components/settings/CatalogEditor.tsx:382` — `placeholder="Weekly mow"` → `placeholder={vertical.copy.catalogItemNamePlaceholder}` (CatalogEditor already imports `vertical`).

- [ ] **Step 8: Verify no stray lawn copy remains + imports present**

Run: `grep -rn "quote your lawn\|reach more lawns\|lawn-care plan below\|Lawn services catalog\|Acme Lawn Care\|Weekly mow\|SEED_PREVIEW" src/pages/ src/components/ | grep -v "verticals/"`
Expected: no hits (all relocated to `vertical.copy`).

- [ ] **Step 9: tsc gate + build**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: error set unchanged (6 baseline files; `BusinessProfile.tsx` and `Onboarding.tsx` counts do NOT increase; no new file appears).

Run: `npx vitest run`
Expected: full suite green.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit
```
(`feat(platform): route lawn domain copy through vertical.copy` + trailers.)

---

## Self-Review notes (author)

- **Spec coverage:** Bucket A → Task 2 (24 brand-name sites, Auth:366 excluded). Bucket B → Task 3 Step 1 (5 fallback sites). Bucket C → Task 3 Step 2 (Auth authTagline + Pricing pricingTagline). Bucket D → Task 4 (~15 copy keys incl. `onboardingSeedPreview`). Contract (extend brand + `copy` + `lawnCopy` + register + tests) → Task 1. All spec sections mapped.
- **Type consistency:** `CopyModule` key names in Task 1 exactly match the consumers in Tasks 3–4 (`pricingTagline`, `onboardingSeedPreview`, `galleryCtaBody`, etc.). Token names (`{months}`, `{business}`, `{brand}`) match the `.replace(...)` calls.
- **Ordering:** Task 1 lands the config before any consumer rewires. Import-add is folded into the first task that touches each file (Task 2 for most), so Tasks 3–4 rarely re-add.
- **Risk guardrails:** Global Constraints forbid touching `src/lib/*`, comments, identifiers (`TurfProFeesCard`), storage keys, bundle IDs — the noisy `grep "TurfPro"` hits that are NOT copy.
