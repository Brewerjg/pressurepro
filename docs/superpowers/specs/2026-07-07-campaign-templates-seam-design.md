# Phase 0c-6a — campaign templates seam design

Status: approved design, ready for implementation planning.
Date: 2026-07-07.

## Context

Part of the multi-vertical platform (spec:
`2026-07-04-multi-vertical-platform-design.md`). **Phase 0c** extracts the lawn
domain behind the `Vertical` contract. **0c-6** (campaign templates + property
fields + copy) is the last domain slice, split into three sub-slices:
**0c-6a campaign templates** (this), 0c-6b property fields, 0c-6c app-wide copy.

### What the audit established

- **`src/components/campaigns/templates.ts`** (144 lines) defines the
  `CampaignKind` union, the `CampaignTemplate` interface, the `TEMPLATES` array
  (5 named templates + `custom`), and the generic merge machinery `MERGE_TAGS` +
  `applyMergeTags`. All 5 named templates (`aeration`, `leaf_cleanup`,
  `spring_restart`, `fert_program`, `snow_signup`) are 100% lawn-specific in body
  copy; `custom` is a shared blank slate. Merge tags used by the lawn bodies:
  `{first_name}`, `{address}`, `{business_name}`.
- **Consumers:**
  - `src/components/campaigns/TemplatePicker.tsx` — imports `TEMPLATES`,
    `applyMergeTags`, `CampaignTemplate`; maps `TEMPLATES`; has 3× `"your lawn
    crew"` fallbacks (lines 41, 50 + a 113 placeholder "An update from your lawn
    crew").
  - `src/pages/Campaigns.tsx` — imports `TEMPLATES`, `CampaignKind`,
    `CampaignTemplate`; `useState<CampaignKind>("aeration")` (default kind);
    `TEMPLATES[0]` / `TEMPLATES.find(...)`; header "Seasonal blasts — aeration,
    leaf cleanup, spring restart."; an empty-state paragraph; `?? "your lawn
    crew"` fallbacks (329, 523).
- **`templates.ts` has a pre-existing tsc baseline error** at line 140
  (`replaceAll` not in the target lib) inside `applyMergeTags`. `applyMergeTags`
  STAYS in this slice, so that error stays and `templates.ts` remains in the
  6-file tsc baseline — unaffected by this work.
- `AudienceStep.tsx` presets (esp. `inactive_days` → `route_stops`) are audience
  targeting, NOT templates — out of scope.
- `vertical.brand` is defined but unplumbed; the `vertical.catalog.copy` sub-object
  is the working precedent for a per-vertical copy object.

## Decisions

1. **Add `campaigns: CampaignsModule` to the `Vertical` contract.**
2. **The module owns the templates + campaign-surface copy:** `templates`,
   `defaultKind`, and `copy` (page subtitle, empty-state blurb, preview fallback
   business name).
3. **Loosen `CampaignTemplate.kind` to `string`** (kinds are vertical-specific;
   `custom` is a shared convention) — drop the lawn `CampaignKind` union.
   Consumers' `kind` state loosens to `string` (like the 0c-4 frequency loosening).
4. **Keep `MERGE_TAGS` + `applyMergeTags` in `templates.ts`** (generic merge
   logic). `templates.ts` re-exports the `CampaignTemplate` type from the contract
   so consumers' `import … from "./templates"` keeps resolving.
5. **Behavior-identical for lawn** — same templates, same copy, same picker.

## The contract

New file `src/verticals/campaigns.ts`:

```ts
import type { LucideIcon } from "lucide-react";

// A built-in campaign message template the wizard offers in step 1.
export interface CampaignTemplate {
  kind: string;      // template id ("aeration", …, "custom"); vertical-specific
  label: string;
  blurb: string;
  season: string;    // informational ("Aug – Oct")
  icon: LucideIcon;
  subject: string;
  body: string;      // uses this vertical's merge tags
}

export interface CampaignsModule {
  /** Built-in templates offered by the campaign wizard. */
  templates: CampaignTemplate[];
  /** The template kind selected by default when composing a new campaign. */
  defaultKind: string;
  /** Trade-specific copy on the campaigns surfaces. */
  copy: {
    pageSubtitle: string;
    emptyStateBlurb: string;
    previewFallbackBusinessName: string;
  };
}
```

The `Vertical` interface (`src/verticals/types.ts`) gains `campaigns: CampaignsModule`.

## Architecture / mechanics

- **`src/verticals/lawn/campaigns.ts`** — imports the lucide icons the templates
  use (`CloudSnow, Leaf, MessageCircle, Sparkles, Sprout`) and exports
  `lawnCampaigns: CampaignsModule` holding the 6 templates (the 5 lawn templates +
  `custom`, relocated verbatim from `TEMPLATES`), `defaultKind: "aeration"`, and
  `copy`:
  - `pageSubtitle: "Seasonal blasts — aeration, leaf cleanup, spring restart."`
  - `emptyStateBlurb: "Aeration in August, leaf cleanup in October, spring restart in March. Pick a template and blast your customer list in two minutes."`
  - `previewFallbackBusinessName: "your lawn crew"`
- **`src/verticals/lawn/index.ts`** — register `campaigns: lawnCampaigns`.
- **`src/components/campaigns/templates.ts`** — remove `CampaignKind`, the
  `CampaignTemplate` interface, and the `TEMPLATES` array. Keep `MERGE_TAGS` and
  `applyMergeTags` (unchanged — including the pre-existing `replaceAll` line).
  Add `export type { CampaignTemplate } from "@/verticals/campaigns";` so existing
  type imports from this module keep working.
- **`src/components/campaigns/TemplatePicker.tsx`** — change the import to
  `import { applyMergeTags, type CampaignTemplate } from "./templates";` and add
  `import { vertical } from "@/vertical";`. Map `vertical.campaigns.templates`
  instead of `TEMPLATES`. Replace the 3 `businessName || "your lawn crew"` /
  placeholder uses with `vertical.campaigns.copy.previewFallbackBusinessName`
  (the placeholder becomes `` `An update from ${vertical.campaigns.copy.previewFallbackBusinessName}` ``).
- **`src/pages/Campaigns.tsx`** — change the import to
  `import { applyMergeTags, type CampaignTemplate } from "@/components/campaigns/templates";`
  (drop `TEMPLATES`, `CampaignKind`) and add `import { vertical } from "@/vertical";`.
  Replace `TEMPLATES` reads (`TEMPLATES[0]`, `TEMPLATES.find(...)`) with
  `vertical.campaigns.templates`. Change `useState<CampaignKind>("aeration")` to
  `useState<string>(vertical.campaigns.defaultKind)` and the local `kind:
  CampaignKind` field type to `string`. Source the header subtitle, empty-state
  blurb, and the two `?? "your lawn crew"` fallbacks from `vertical.campaigns.copy`.

## Testing

- **Unit (vitest)** `src/verticals/lawn/campaigns.test.ts`:
  `lawnCampaigns.templates` has 6 entries; the kinds include `aeration`,
  `leaf_cleanup`, `spring_restart`, `fert_program`, `snow_signup`, `custom`;
  `defaultKind === "aeration"`; `copy.previewFallbackBusinessName === "your lawn
  crew"`; `copy.pageSubtitle` and `copy.emptyStateBlurb` are non-empty; every
  template has a non-empty `label` and an `icon`.
- **Conformance:** `lawnVertical.campaigns` defined.
- **Build + tsc:** `npx tsc --noEmit -p tsconfig.app.json` — the error set stays
  EXACTLY the known 6-file baseline (`templates.ts` remains, with its unchanged
  `replaceAll` error; `TemplatePicker.tsx` and `Campaigns.tsx` must NOT appear).
  `npm run build` succeeds; full vitest suite green.
- **Manual (deferred, human):** the Campaigns page shows the same template cards,
  header, and empty state; selecting a template prefills subject/body; the preview
  pane renders merge tags with the same fallback business name.

## Out of scope (0c-6a)

- `AudienceStep` presets + the `inactive_days` → `route_stops` recency query
  (Phase 1 — pressure needs a different recency signal).
- Merge-tag verticalization (`MERGE_TAGS`/`applyMergeTags` stay lawn-shaped;
  PressurePro's camelCase, `{address}`-less tags are Phase 1).
- Property fields (0c-6b) and app-wide copy — Auth/prints/portals/etc. (0c-6c).
- Reconciling the `CampaignTemplate` shape with PressurePro's split
  `email_body_html`/`sms_body` — Phase 1.
