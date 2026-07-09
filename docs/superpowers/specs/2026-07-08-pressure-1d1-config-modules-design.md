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

## Module 3 — `pressure/property-fields.ts` (+ minimal `PropertyDetail` textarea support)

**Key finding (from reading `PropertyDetail.tsx`):** `gate_code` and `dog_warning`
are ALREADY fields in the shared Property card + `EditState` + save payload
(inherited from the PressurePro base, shown for both verticals) — they already
persist for pressure with ZERO change. The custom-fields card + read view are
ALREADY config-driven over `vertical.propertyFields.fields` (0c-6b). So the only
genuinely-new pressure field is **`surface_notes`** (a textarea), and it is added
as a superset `EditState`/save field EXACTLY like the existing `gate_code`/
`dog_warning` superset fields — **no dynamic refactor** (my earlier framing was
wrong; the codebase already uses the superset pattern). `surface_notes` column
CONFIRMED present live.

### Contract widening (`src/verticals/property-fields.ts`)

Add ONE variant to `PropertyFieldDef` (only `textarea` is needed — `gate_code`
stays a hardcoded Property-card input, not a config field):

```ts
  | { key: string; label: string; readLabel?: string; type: "textarea"; placeholder?: string }
```

### `PropertyDetail.tsx` — add `surface_notes` (superset) + a `textarea` branch

Matches the existing `gate_code`/`dog_warning` superset pattern; NO restructuring:
- `EditState` gains `surface_notes: string`; `emptyEdit` gains `surface_notes: ""`;
  the load `setEdit({…})` gains `surface_notes: p.surface_notes ?? ""`; the save
  `payload` gains `surface_notes: edit.surface_notes.trim() || null` (lawn never
  edits it → stays `""` → saved `null`, harmless — identical to how lawn already
  writes `gate_code`).
- The config-driven **edit map** gains a `textarea` branch (`<textarea
  value={state[f.key]} onChange=… />`) alongside toggle/number/datalist.
- The config-driven **read view**: `textarea` renders as a full-width paragraph
  (omitted when empty), NOT a `<Stat>`. Adjust the scalar partition so `textarea`
  is excluded from the 2-col Stat grid and rendered separately. The
  `emptyStateHint` shows when the card has no set value.
- **Behavior-identical for lawn:** lawn's config has no `textarea` field, so the
  new branch never executes; `surface_notes` stays `""`/`null` on every lawn save
  (same as the pre-existing superset `gate_code`). `PropertyDetail.tsx` is NOT in
  the tsc baseline — must stay clean (`p.surface_notes` needs the `PropertyRow`
  interface to include `surface_notes?: string | null`).

### `pressure/property-fields.ts`

```ts
export const pressurePropertyFields: PropertyFieldsModule = {
  sectionLabel: "Site details",
  sectionIcon: <a lucide icon, e.g. MapPin>,
  emptyStateHint: "No site notes yet. Edit to record surface materials, problem areas, or access notes.",
  fields: [
    { key: "surface_notes", label: "Surface notes", type: "textarea", placeholder: "Materials, problem areas, access…" },
  ],
};
```

(`gate_code` + `dog_warning` are intentionally NOT in the config — they live in
the shared Property card and already work for pressure.)

## Testing

- `pressure/campaigns.test.ts`: 6 templates; kinds match the set; every non-custom
  template's `body` contains `{first_name}` and `{business_name}` and NO
  `{firstName}`/`{businessName}` (tag normalization); `custom` has empty
  subject/body; `defaultKind === "spring_signup"`; copy fields present.
- `pressure/copy.test.ts`: all 17 keys non-empty strings; `onboardingSeedPreview`
  6 items; token strings retain `{months}`/`{business}`/`{brand}`; spot-check
  `pricingTagline`, `businessNamePlaceholder`, `onboardingCatalogTitle`.
- `pressure/property-fields.test.ts`: 1 field, key `surface_notes`, type
  `textarea`; `sectionLabel === "Site details"`; `emptyStateHint` present.
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
