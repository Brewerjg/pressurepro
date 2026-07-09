# Phase 1 slice 1d-1 — pressure config modules (campaigns + copy + property-fields) design

Status: approved phase; this slice's design ready for planning.
Date: 2026-07-08.
Parent: `2026-07-08-pressure-vertical-phase1-design.md`. 1d split: 1d-1 (this,
config modules), 1d-2 (billing seam), 1d-3 (plan-cadence + Plans de-lawn).

## Purpose

Author three pressure config modules that mirror the existing 0c seams:
`pressure/campaigns.ts` (0c-6a), `pressure/copy.ts` (0c-6c), and
`pressure/property-fields.ts` (0c-6b). campaigns + copy are pure data ports;
property-fields also completes the 0c-6b-deferred `PropertyDetail` refactor
(make `EditState`/save config-driven so a second vertical's columns persist).
Nothing is registered (register-last, 1e).

## Module 1 — `pressure/campaigns.ts` (pure port)

`pressureCampaigns: CampaignsModule` — the 6 PressurePro templates relocated
verbatim, with **merge tags normalized** from PressurePro's `{firstName}`/
`{businessName}` to the unified `{first_name}`/`{business_name}` (the unified
`applyMergeTags`/edge fn resolves `{first_name}`, `{address}`, `{business_name}`).
The unified `CampaignTemplate` has a single `subject`+`body`, so map PressurePro's
`email_subject`→`subject` and `email_body_html`→`body` (SMS bodies dropped — the
unified model is one body).

Templates (kind, label, blurb, season, icon, subject, body — bodies verbatim from
PressurePro `templates.ts` with tags converted):
- `spring_signup` — "Spring power-wash signup", icon `Sparkles`, season "March".
- `pre_winter_wash` — "Pre-winter house wash", icon `Leaf`, "October".
- `fence_deck_refresh` — "Fence + deck refresh", icon `Fence`, "April".
- `commercial_requote` — "Commercial property re-quote", icon `Briefcase`, "Nov – Dec".
- `roof_softwash` — "Roof soft-wash", icon `Droplet`, "Apr – May".
- `custom` — "Custom", icon `Sparkles`, "Any time", empty subject/body.

`defaultKind: "spring_signup"`. `copy: { pageSubtitle: "Seasonal blasts to fill
your route.", emptyStateBlurb: "No campaigns yet. Pick a seasonal template to
reach past customers.", previewFallbackBusinessName: "your wash crew" }`.
(`MERGE_TAGS`/`applyMergeTags` stay generic in `components/campaigns/templates.ts`
— unchanged.)

## Module 2 — `pressure/copy.ts` (port)

`pressureCopy: CopyModule` — pressure-flavored values for all 17 keys (authored,
on-brand; parameter tokens `{months}`/`{business}`/`{brand}` preserved):

```ts
quoteRecurringBlurb: "We'll reach out every {months} months to keep things looking sharp.",
quoteFooterThankYou: "Thank you for the opportunity to quote your property.",
photoPairLabel: "Pressure wash visit",
galleryCtaHeadline: "Want results like this?",
galleryCtaBody: "Get a quote from {business} for your own property.",
reviewCalloutHeadline: "Help us reach more homes",
reviewCalloutBody: "A quick Google review goes a long way for a small pressure-washing business.",
planPortalSubtitle: "Manage your wash plan below.",
plansEmptyStateBody: "Recurring keeps surfaces clean year-round — add your first plan to get started.",
customerPlansEmptyState: "No plans yet. Recurring service is the {brand} way — add a plan to keep this property on a schedule.",
onboardingCatalogTitle: "Surface pricing",
onboardingCatalogSubtitle: "We pre-loaded standard rates for the seven core surfaces. Tweak them anytime.",
businessNamePlaceholder: "Acme Pressure Washing",
catalogItemNamePlaceholder: "House wash",
completedNotificationBlurb: "Thanks-for-your-business message after each job wraps.",
onboardingSeedPreview: [
  { name: "House wash", price: "$250+" },
  { name: "Roof soft-wash", price: "$350+" },
  { name: "Driveway", price: "$150+" },
  { name: "Deck", price: "$200+" },
  { name: "Fence", price: "$150+" },
  { name: "+ concrete, siding…", price: "" },
],
pricingTagline: "Built for pressure-washing pros.",
```

## Module 3 — `pressure/property-fields.ts` + `PropertyDetail` refactor

Pressure's property fields are `gate_code` (text), `surface_notes` (textarea),
`dog_warning` (toggle) — columns CONFIRMED present live on `properties`. The
0c-6b `PropertyFieldDef` union only has `datalist`/`number`/`toggle`, and 0c-6b
kept `PropertyDetail`'s `EditState`/save as fixed lawn-named keys (explicitly
deferring the dynamic refactor to Phase 1). This slice completes both.

### Contract widening (`src/verticals/property-fields.ts`)

Add two variants to `PropertyFieldDef`:

```ts
  | { key: string; label: string; readLabel?: string; type: "text"; placeholder?: string }
  | { key: string; label: string; readLabel?: string; type: "textarea"; placeholder?: string }
```

### `PropertyDetail.tsx` — config-driven EditState/save (the 0c-6b-deferred refactor)

Make the edit state + save payload DRIVEN BY `vertical.propertyFields.fields`
rather than hardcoded lawn keys, so each vertical writes only its own columns
(lawn unaffected; pressure persists its 3 fields):
- `EditState` becomes a `Record<string, string | boolean>` initialized from the
  config fields (toggles → `boolean`, scalars/text/textarea → `string`;
  number/datalist keep the string-holding-number pattern). The Property-card
  fields (`turf_sqft`/`slope_warning` for lawn) stay as they are — this refactor
  covers only the custom-fields card that 0c-6b already made config-driven.
- The save payload writes exactly the config fields' keys (numbers parsed via
  `Number()`), so lawn saves write only lawn columns and pressure saves write only
  `gate_code`/`surface_notes`/`dog_warning`. This removes the cross-vertical
  column-write concern.
- **Edit render** gains `text` → `<input type="text">` and `textarea` →
  `<textarea>` branches (alongside the existing datalist/number/toggle).
- **Read render** gains: `text` shown like a scalar `<Stat>` (label + value,
  omitted when empty); `textarea` shown as a full-width paragraph under the card
  (omitted when empty). Toggles unchanged (`<Pill>`).
- **Behavior-identical for lawn:** lawn's fields are only datalist/number/toggle,
  so the new branches never execute; the config-driven EditState/save reproduces
  lawn's current writes for lawn's keys exactly (verified by the whole-branch
  review). `PropertyDetail.tsx` is NOT in the tsc baseline — must stay clean.

### `pressure/property-fields.ts`

```ts
export const pressurePropertyFields: PropertyFieldsModule = {
  sectionLabel: "Site details",
  sectionIcon: <a lucide icon, e.g. MapPin>,
  emptyStateHint: "No site details yet. Edit to record a gate code, surface notes, or a dog warning.",
  fields: [
    { key: "gate_code", label: "Gate code", type: "text", placeholder: "e.g. 1234#" },
    { key: "surface_notes", label: "Surface notes", type: "textarea", placeholder: "Materials, problem areas, access…" },
    { key: "dog_warning", label: "Dog on property", type: "toggle", icon: <Dog/PawPrint>, pillTone: "bronze" },
  ],
};
```

(`pillTone` is the fixed `"green"|"rain"|"bronze"` union — `bronze` for the dog
warning; the tone names are lawn-flavored but map to theme vars defined in both
themes.)

## Testing

- `pressure/campaigns.test.ts`: 6 templates; kinds match the set; every non-custom
  template's `body` contains `{first_name}` and `{business_name}` and NO
  `{firstName}`/`{businessName}` (tag normalization); `custom` has empty
  subject/body; `defaultKind === "spring_signup"`; copy fields present.
- `pressure/copy.test.ts`: all 17 keys non-empty strings; `onboardingSeedPreview`
  6 items; token strings retain `{months}`/`{business}`/`{brand}`; spot-check
  `pricingTagline`, `businessNamePlaceholder`, `onboardingCatalogTitle`.
- `pressure/property-fields.test.ts`: 3 fields with keys
  `["gate_code","surface_notes","dog_warning"]`; types `text`/`textarea`/`toggle`;
  `dog_warning` tone `bronze`; `sectionLabel === "Site details"`.
- `PropertyDetail` has no unit test (matches 0c-6b) — its lawn-identity is covered
  by the whole-branch review; the tsc baseline must stay clean and `npm run build`
  green.
- All three modules keep the `vi.mock("@/integrations/supabase/client", …)` shim
  if their index/import chain pulls supabase (campaigns/copy don't; property-fields
  imports only lucide + types — likely no shim needed, but add if a test crashes).
- tsc at the 6-file baseline (no NEW file; `PropertyDetail.tsx` must NOT appear).

## Out of scope (1d-1)

- Registering `pressureVertical` (1e).
- Billing seam (1d-2); plan-cadence + Plans de-lawn (1d-3).
- The Property-card fields (`turf_sqft`/`slope_warning`) — unchanged (Property card,
  not the custom-fields card).
- Pressure chemicals / any field beyond the three.
- SMS-vs-email split in campaigns (unified model is one body).
- Any lawn behavior change.
