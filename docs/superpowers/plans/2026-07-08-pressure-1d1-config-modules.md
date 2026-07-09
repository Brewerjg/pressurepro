# Phase 1 slice 1d-1 (pressure config modules) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author `pressure/campaigns.ts`, `pressure/copy.ts`, and `pressure/property-fields.ts` (mirroring the 0c seams), plus the minimal `PropertyDetail`/contract support for a `textarea` field (`surface_notes`). Nothing registered (1e).

**Architecture:** campaigns + copy are self-contained data modules. property-fields adds one `PropertyFieldDef` variant + a `surface_notes` superset field to `PropertyDetail` (matching the existing `gate_code`/`dog_warning` superset pattern — no refactor). Lawn behavior unchanged throughout.

**Tech Stack:** TypeScript, React, lucide-react, vitest.

## Global Constraints

- **tsc gate:** `npx tsc --noEmit -p tsconfig.app.json` (NOT root). Baseline = exactly 6 files: `AudienceStep.tsx`, `campaigns/templates.ts`, `BusinessProfile.tsx`, `iap.ts`, `Campaigns.tsx`, `Onboarding.tsx`. Gate = no NEW file. **`PropertyDetail.tsx` must NOT become a new error** (Task 3).
- **Behavior-identical for lawn:** the new modules are unreferenced (register-last); the `PropertyDetail` textarea branch never executes for lawn (no lawn textarea field); `surface_notes` stays `""`/`null` on lawn saves (like the existing superset `gate_code`).
- **Merge tags:** pressure campaign bodies use the UNIFIED tags `{first_name}` / `{business_name}` (NOT PressurePro's `{firstName}`/`{businessName}`).
- **Test env:** add `vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }))` at the top of a test only if its import chain pulls supabase (campaigns/copy/property-fields import only lucide + types → NOT needed; add only if a test crashes with `localStorage`).
- **Commit trailers on every commit:**
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QrF17kQNQsTPBTHee6C3br
  ```
- Full vitest suite green; `npm run build` succeeds.

---

### Task 1: pressure campaigns module

**Files:**
- Create: `src/verticals/pressure/campaigns.ts`
- Test: `src/verticals/pressure/campaigns.test.ts`

**Interfaces:**
- Consumes: `CampaignTemplate`, `CampaignsModule` from `@/verticals/campaigns`.
- Produces: `export const pressureCampaigns: CampaignsModule`.

- [ ] **Step 1: Write the failing test**

Create `src/verticals/pressure/campaigns.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pressureCampaigns } from "./campaigns";

describe("pressureCampaigns", () => {
  it("offers the six pressure templates + custom default", () => {
    const kinds = pressureCampaigns.templates.map((t) => t.kind);
    expect(kinds).toEqual([
      "spring_signup", "pre_winter_wash", "fence_deck_refresh",
      "commercial_requote", "roof_softwash", "custom",
    ]);
    expect(pressureCampaigns.defaultKind).toBe("spring_signup");
  });

  it("uses unified merge tags, not PressurePro camelCase", () => {
    for (const t of pressureCampaigns.templates) {
      if (t.kind === "custom") continue;
      expect(t.body).toContain("{first_name}");
      expect(t.body).toContain("{business_name}");
      expect(t.body).not.toContain("{firstName}");
      expect(t.body).not.toContain("{businessName}");
    }
  });

  it("has an empty custom template and campaign copy", () => {
    const custom = pressureCampaigns.templates.find((t) => t.kind === "custom")!;
    expect(custom.subject).toBe("");
    expect(custom.body).toBe("");
    expect(pressureCampaigns.copy.previewFallbackBusinessName).toBe("your wash crew");
  });
});
```

- [ ] **Step 2: Run test → fail** — `npx vitest run src/verticals/pressure/campaigns.test.ts` (module missing).

- [ ] **Step 3: Create the module**

Create `src/verticals/pressure/campaigns.ts` (bodies relocated verbatim from PressurePro `templates.ts`, tags converted to `{first_name}`/`{business_name}`):

```ts
import { Briefcase, Droplet, Fence, Leaf, Sparkles } from "lucide-react";
import type { CampaignTemplate, CampaignsModule } from "@/verticals/campaigns";

const PRESSURE_TEMPLATES: CampaignTemplate[] = [
  {
    kind: "spring_signup",
    label: "Spring power-wash signup",
    blurb: "March kickoff to clean up winter grime. Save 10% pulls folks off the fence.",
    season: "March",
    icon: Sparkles,
    subject: "Spring's here — let's wash off winter",
    body: `Hi {first_name},

Spring's here. Your driveway, siding, and deck have probably picked up a winter's worth of grime, salt, and mildew.

Book a wash with us this month and we'll take 10% off the bill. We're starting routes the first week of March and slots fill fast.

Reply YES and we'll lock in your date.

— {business_name}`,
  },
  {
    kind: "pre_winter_wash",
    label: "Pre-winter house wash",
    blurb: "October nudge — clean siding before the leaves and freeze lock dirt in.",
    season: "October",
    icon: Leaf,
    subject: "Get the house washed before the leaves drop",
    body: `Hi {first_name},

October is the last clean window. Once leaves come down and temps drop, dirt and mildew on your siding lock in for the winter.

We're scheduling pre-winter house washes through the end of the month. Limited slots — soft-wash, gutter exteriors, sidewalks all included.

Reply with a yes and we'll send a confirmation for your usual day.

— {business_name}`,
  },
  {
    kind: "fence_deck_refresh",
    label: "Fence + deck refresh",
    blurb: "April push — soft-wash and brighten wood before peak yard season.",
    season: "April",
    icon: Fence,
    subject: "Bring your fence + deck back this April",
    body: `Hi {first_name},

Fences and decks take the brunt of winter — gray, green, mossy. We can bring the wood back.

Our April fence + deck package is a soft-wash plus a brightener to lift the gray and pop the natural color. Quick to schedule, big visual difference, and it prolongs the wood.

Reply to grab an April slot.

— {business_name}`,
  },
  {
    kind: "commercial_requote",
    label: "Commercial property re-quote",
    blurb: "Year-end check-in with commercial accounts to lock in next year's contract.",
    season: "Nov – Dec",
    icon: Briefcase,
    subject: "End-of-year wash contract review",
    body: `Hi {first_name},

End-of-year check-in. We'd like to revisit your annual pressure-washing contract for next year — same scope, updated pricing, and any tweaks you want to make to the schedule.

Reply and we'll set up a 15-minute call to walk through it. If you want to add storefronts, awnings, dumpster pads, or extra visits, this is the easy time to do it.

— {business_name}`,
  },
  {
    kind: "roof_softwash",
    label: "Roof soft-wash",
    blurb: "April–May push — kill algae before it eats the shingles. High-margin add-on.",
    season: "Apr – May",
    icon: Droplet,
    subject: "Black streaks on your roof? It's algae.",
    body: `Hi {first_name},

Those black streaks on your roof are algae, and they're slowly eating your shingles. Left alone they shorten roof life by years.

We soft-wash roofs with a low-pressure mix that's safe for the shingles, kills the algae, and brings the roof back to clean. One visit, big improvement.

Reply if you want a quick estimate — most jobs come in under a few hundred dollars.

— {business_name}`,
  },
  {
    kind: "custom",
    label: "Custom",
    blurb: "Start from a blank message. Add merge tags as needed.",
    season: "Any time",
    icon: Sparkles,
    subject: "",
    body: "",
  },
];

export const pressureCampaigns: CampaignsModule = {
  templates: PRESSURE_TEMPLATES,
  defaultKind: "spring_signup",
  copy: {
    pageSubtitle: "Seasonal blasts to fill your route.",
    emptyStateBlurb: "No campaigns yet. Pick a seasonal template to reach past customers.",
    previewFallbackBusinessName: "your wash crew",
  },
};
```

- [ ] **Step 4: Run test → pass.** tsc gate (no new file). `npx vitest run` green.

- [ ] **Step 5: Commit**

```bash
git add src/verticals/pressure/campaigns.ts src/verticals/pressure/campaigns.test.ts
git commit
```
(`feat(platform): pressureCampaigns (6 templates, unified merge tags)` + trailers.)

---

### Task 2: pressure copy module

**Files:**
- Create: `src/verticals/pressure/copy.ts`
- Test: `src/verticals/pressure/copy.test.ts`

**Interfaces:**
- Consumes: `CopyModule` from `@/verticals/copy`.
- Produces: `export const pressureCopy: CopyModule`.

- [ ] **Step 1: Write the failing test**

Create `src/verticals/pressure/copy.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test → fail.**

- [ ] **Step 3: Create the module**

Create `src/verticals/pressure/copy.ts`:

```ts
import type { CopyModule } from "@/verticals/copy";

export const pressureCopy: CopyModule = {
  quoteRecurringBlurb: "We'll reach out every {months} months to keep things looking sharp.",
  quoteFooterThankYou: "Thank you for the opportunity to quote your property.",
  photoPairLabel: "Pressure wash visit",
  galleryCtaHeadline: "Want results like this?",
  galleryCtaBody: "Get a quote from {business} for your own property.",
  reviewCalloutHeadline: "Help us reach more homes",
  reviewCalloutBody:
    "A quick Google review goes a long way for a small pressure-washing business.",
  planPortalSubtitle: "Manage your wash plan below.",
  plansEmptyStateBody:
    "Recurring keeps surfaces clean year-round — add your first plan to get started.",
  customerPlansEmptyState:
    "No plans yet. Recurring service is the {brand} way — add a plan to keep this property on a schedule.",
  onboardingCatalogTitle: "Surface pricing",
  onboardingCatalogSubtitle:
    "We pre-loaded standard rates for the seven core surfaces. Tweak them anytime.",
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
};
```

- [ ] **Step 4: Run test → pass.** tsc gate. `npx vitest run` green.

- [ ] **Step 5: Commit**

```bash
git add src/verticals/pressure/copy.ts src/verticals/pressure/copy.test.ts
git commit
```
(`feat(platform): pressureCopy (17 CopyModule keys)` + trailers.)

---

### Task 3: property-fields — textarea variant + surface_notes + pressure module

**Files:**
- Modify: `src/verticals/property-fields.ts` (add `textarea` variant)
- Modify: `src/pages/PropertyDetail.tsx` (add `surface_notes` superset + textarea branches)
- Create: `src/verticals/pressure/property-fields.ts`
- Test: `src/verticals/pressure/property-fields.test.ts`

**Interfaces:**
- Consumes: `PropertyFieldsModule`, `PropertyFieldDef` from `@/verticals/property-fields`.
- Produces: `export const pressurePropertyFields: PropertyFieldsModule`.

- [ ] **Step 1: Widen `PropertyFieldDef`**

In `src/verticals/property-fields.ts`, add a variant to the `PropertyFieldDef` union (after the `number` variant):

```ts
  | { key: string; label: string; readLabel?: string; type: "textarea"; placeholder?: string }
```

- [ ] **Step 2: Add `surface_notes` to `PropertyDetail` (superset — mirrors `gate_code`)**

In `src/pages/PropertyDetail.tsx`:

(a) `interface EditState` — add after `slope_warning: boolean;`:
```ts
  surface_notes: string;
```
(b) `const emptyEdit` — add:
```ts
  surface_notes: "",
```
(c) The load `setEdit({…})` (in the hydrate `useEffect`) — add:
```ts
      surface_notes: p.surface_notes ?? "",
```
(d) The save `payload` object — add (next to `gate_code`):
```ts
        surface_notes: edit.surface_notes.trim() || null,
```
(e) The local `PropertyRow` interface (grep for `interface PropertyRow`) — add:
```ts
  surface_notes?: string | null;
```
(so `p.surface_notes` typechecks in the load).

- [ ] **Step 3: Add the `textarea` EDIT branch**

In the config-driven edit map (`vertical.propertyFields.fields.map((f) => {…}`), immediately AFTER the `if (f.type === "toggle") {…}` block and BEFORE the `const listId = …` line, insert:

```tsx
                if (f.type === "textarea") {
                  return (
                    <Field key={f.key} label={f.label}>
                      <textarea
                        value={state[f.key] as string}
                        onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value } as EditState)}
                        placeholder={f.placeholder}
                        rows={3}
                        className="tp-input"
                      />
                    </Field>
                  );
                }
```

- [ ] **Step 4: Add the `textarea` READ rendering + exclude it from the Stat grid**

In the read view (the second `vertical.propertyFields.fields.length > 0` block):

(a) Change the scalar filter so `textarea` is excluded from the 2-col Stat grid. Replace:
```tsx
                  .filter(
                    (f): f is Extract<PropertyFieldDef, { type: "datalist" | "number" }> =>
                      f.type !== "toggle",
                  )
```
with:
```tsx
                  .filter(
                    (f): f is Extract<PropertyFieldDef, { type: "datalist" | "number" }> =>
                      f.type !== "toggle" && f.type !== "textarea",
                  )
```

(b) Immediately AFTER the closing `</div>` of the `grid grid-cols-2` Stat block and BEFORE the `<div className="grid grid-cols-1 gap-1.5 pt-1">` toggle block, insert a textarea read block:
```tsx
              {vertical.propertyFields.fields.map((f) => {
                if (f.type !== "textarea") return null;
                const raw = (property as unknown as Record<string, unknown>)[f.key];
                const value = String(raw ?? "");
                if (!value) return null;
                return (
                  <p key={f.key} className="text-sm text-neutral-600 whitespace-pre-wrap">
                    {value}
                  </p>
                );
              })}
```

(The toggle-based `emptyStateHint` logic stays as-is — lawn-identical. Pressure's card with an empty `surface_notes` shows just the section label, which is acceptable.)

- [ ] **Step 5: Create the pressure module + test**

Create `src/verticals/pressure/property-fields.ts`:

```ts
import { StickyNote } from "lucide-react";
import type { PropertyFieldsModule } from "@/verticals/property-fields";

export const pressurePropertyFields: PropertyFieldsModule = {
  sectionLabel: "Site details",
  sectionIcon: StickyNote,
  emptyStateHint:
    "No site notes yet. Edit to record surface materials, problem areas, or access notes.",
  fields: [
    {
      key: "surface_notes",
      label: "Surface notes",
      type: "textarea",
      placeholder: "Materials, problem areas, access…",
    },
  ],
};
```

Create `src/verticals/pressure/property-fields.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pressurePropertyFields } from "./property-fields";

describe("pressurePropertyFields", () => {
  it("exposes a single surface_notes textarea field", () => {
    expect(pressurePropertyFields.fields).toHaveLength(1);
    const f = pressurePropertyFields.fields[0];
    expect(f.key).toBe("surface_notes");
    expect(f.type).toBe("textarea");
  });
  it("labels the Site details section", () => {
    expect(pressurePropertyFields.sectionLabel).toBe("Site details");
    expect(pressurePropertyFields.emptyStateHint.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Gates**

Run: `npx vitest run src/verticals/pressure/property-fields.test.ts` → PASS.
Run: `npx tsc --noEmit -p tsconfig.app.json` → error set unchanged (6 baseline; **`PropertyDetail.tsx` must NOT appear** — verify `surface_notes` was added to `EditState`/`emptyEdit`/load/save/`PropertyRow` so nothing is missing, and the textarea branches compile).
Run: `npx vitest run` → full suite green.
Run: `npm run build` → succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/verticals/property-fields.ts src/pages/PropertyDetail.tsx src/verticals/pressure/property-fields.ts src/verticals/pressure/property-fields.test.ts
git commit
```
(`feat(platform): pressurePropertyFields (surface_notes) + textarea field type` + trailers.)

---

## Self-Review notes (author)

- **Spec coverage:** campaigns (Task 1), copy (Task 2), property-fields incl. the `textarea` widening + `surface_notes` superset + pressure module (Task 3).
- **No placeholders:** full module code; property-fields uses precise old→new anchors against the current `PropertyDetail`.
- **Merge tags:** every pressure template body uses `{first_name}`/`{business_name}`; the test enforces the absence of `{firstName}`/`{businessName}`.
- **Lawn identity:** `surface_notes` mirrors the existing `gate_code` superset field exactly (stays `""`/`null` for lawn); the `textarea` edit/read branches never execute for lawn (no lawn textarea field). `PropertyDetail` not in the tsc baseline → must stay clean.
- **Cycle safety:** all three modules import only lucide + types (no supabase, no vertical) → no test mock needed, no cycle.
