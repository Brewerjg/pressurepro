# Campaign Templates Seam (Phase 0c-6a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `vertical.campaigns` config module (templates + campaign-surface copy) so the shared Campaigns page/TemplatePicker read the active vertical's templates instead of a hardcoded lawn `TEMPLATES` array.

**Architecture:** New `src/verticals/campaigns.ts` contract (`CampaignTemplate`, `CampaignsModule`); `src/verticals/lawn/campaigns.ts` holds `lawnCampaigns`; `templates.ts` keeps the generic `MERGE_TAGS`/`applyMergeTags` and re-exports the `CampaignTemplate` type; `TemplatePicker` + `Campaigns` read `vertical.campaigns`.

**Tech Stack:** React + TypeScript + Vite + vitest.

## Global Constraints

- **Phase 0c-6a** of the multi-vertical platform (spec: `2026-07-07-campaign-templates-seam-design.md`).
- **Behavior-identical for TurfPro** — same templates, same header/empty-state copy, same picker + preview.
- **`CampaignTemplate.kind` loosens to `string`** (kinds are vertical-specific; `custom` shared). The lawn `CampaignKind` union is dropped; `Campaigns.tsx`'s `kind` state/row-type field loosens to `string` (like the 0c-4 frequency loosening).
- **`MERGE_TAGS` + `applyMergeTags` stay in `templates.ts`** (generic merge logic, unchanged — including the pre-existing `replaceAll` error on line 140).
- Verify tsc with the STRICT app config: `npx tsc --noEmit -p tsconfig.app.json`. Known PRE-EXISTING baseline of errors in 6 UNRELATED files: `src/components/campaigns/AudienceStep.tsx`, `src/components/campaigns/templates.ts` (the `replaceAll` error — stays), `src/components/settings/BusinessProfile.tsx`, `src/lib/iap.ts`, `src/pages/Campaigns.tsx`, `src/pages/Onboarding.tsx`.
  **IMPORTANT NUANCE:** `Campaigns.tsx` is ALSO in the baseline (it has its own pre-existing error unrelated to this work). So for `Campaigns.tsx` the gate is "no NEW error beyond its pre-existing one." For every OTHER file you touch (`TemplatePicker.tsx`, the new vertical files) the gate is "must NOT appear in the error set." Net: the error set stays EXACTLY the same 6 files.
- Tests: `npm test -- --run`. Build: `npm run build`.
- Base branch: `feature/campaign-templates-seam` (spec committed there). Commit trailers on every commit:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` /
  `Claude-Session: https://claude.ai/code/session_01QrF17kQNQsTPBTHee6C3br`.

---

### Task 1: The campaigns contract + lawn module + templates.ts type re-export + tests

**Files:**
- Create: `src/verticals/campaigns.ts`
- Create: `src/verticals/lawn/campaigns.ts`
- Create (test): `src/verticals/lawn/campaigns.test.ts`
- Modify: `src/verticals/types.ts` (add `campaigns` to `Vertical`)
- Modify: `src/verticals/lawn/index.ts` (register `campaigns`)
- Modify: `src/components/campaigns/templates.ts` (make `CampaignTemplate` a re-export of the contract type)

**Interfaces:**
- Produces (used by Tasks 2–3): `CampaignTemplate`, `CampaignsModule` (`@/verticals/campaigns`); `lawnCampaigns` (`@/verticals/lawn/campaigns`); `vertical.campaigns` (via `@/vertical`) exposing `templates`, `defaultKind`, `copy`.

- [ ] **Step 1: Create the contract**

Create `src/verticals/campaigns.ts`:

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

- [ ] **Step 2: Add `campaigns` to the `Vertical` contract**

In `src/verticals/types.ts`, add the import (after `import type { PlanCadenceModule } from "./plan-cadence";`):
```ts
import type { CampaignsModule } from "./campaigns";
```
and inside `interface Vertical { … }`, after `planCadence: PlanCadenceModule;`, add:
```ts
  /** Campaign message templates + campaign-surface copy for this vertical. */
  campaigns: CampaignsModule;
```

- [ ] **Step 3: Write the lawn campaigns test (TDD)**

Create `src/verticals/lawn/campaigns.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { lawnCampaigns } from "@/verticals/lawn/campaigns";

describe("lawnCampaigns", () => {
  it("offers the 6 lawn templates including custom", () => {
    expect(lawnCampaigns.templates.map((t) => t.kind)).toEqual([
      "aeration", "leaf_cleanup", "spring_restart", "fert_program", "snow_signup", "custom",
    ]);
  });
  it("defaults to the aeration template", () => {
    expect(lawnCampaigns.defaultKind).toBe("aeration");
  });
  it("every template has a label and an icon", () => {
    for (const t of lawnCampaigns.templates) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.icon).toBeTruthy();
    }
  });
  it("carries the lawn campaign copy", () => {
    expect(lawnCampaigns.copy.previewFallbackBusinessName).toBe("your lawn crew");
    expect(lawnCampaigns.copy.pageSubtitle.length).toBeGreaterThan(0);
    expect(lawnCampaigns.copy.emptyStateBlurb.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- --run campaigns`
Expected: FAIL — `@/verticals/lawn/campaigns` does not exist yet.

- [ ] **Step 5: Implement the lawn campaigns module**

Create `src/verticals/lawn/campaigns.ts`. Copy the six template objects **verbatim, byte-identical** from the `TEMPLATES` array currently in `src/components/campaigns/templates.ts` (the array literal at lines 32–129 — `aeration`, `leaf_cleanup`, `spring_restart`, `fert_program`, `snow_signup`, `custom`, with their exact `label`/`blurb`/`season`/`icon`/`subject`/`body` values). Import the same five lucide icons those templates use.

```ts
import { CloudSnow, Leaf, MessageCircle, Sparkles, Sprout } from "lucide-react";
import type { CampaignTemplate, CampaignsModule } from "@/verticals/campaigns";

// The six lawn campaign templates (relocated verbatim from the former
// components/campaigns/templates.ts TEMPLATES array). Merge tags {first_name},
// {address}, {business_name} are resolved by the send-campaign edge fn.
const LAWN_TEMPLATES: CampaignTemplate[] = [
  // …the six objects copied verbatim from templates.ts lines 33–128…
];

export const lawnCampaigns: CampaignsModule = {
  templates: LAWN_TEMPLATES,
  defaultKind: "aeration",
  copy: {
    pageSubtitle: "Seasonal blasts — aeration, leaf cleanup, spring restart.",
    emptyStateBlurb:
      "Aeration in August, leaf cleanup in October, spring restart in March. Pick a template and blast your customer list in two minutes.",
    previewFallbackBusinessName: "your lawn crew",
  },
};
```

(The six objects are the exact literals from `templates.ts`; the only change is the surrounding const name `TEMPLATES` → `LAWN_TEMPLATES` and its type annotation `CampaignTemplate[]` now resolving to the contract type. Note: `templates.ts` still has its own copy of `TEMPLATES` at this point — that is intentional and removed in Task 3.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- --run campaigns`
Expected: PASS — all lawnCampaigns cases green.

- [ ] **Step 7: Register `campaigns` on the lawn vertical**

In `src/verticals/lawn/index.ts`, add the import and the field:
```ts
import { lawnCampaigns } from "./campaigns";
```
and inside `lawnVertical`, after `planCadence: lawnPlanCadence,`, add:
```ts
  campaigns: lawnCampaigns,
```

- [ ] **Step 8: Point `templates.ts`'s `CampaignTemplate` at the contract**

In `src/components/campaigns/templates.ts`, so that the type is single-sourced (consumers importing `CampaignTemplate` from `./templates` get the SAME type as `vertical.campaigns.templates`):
- DELETE the local `export interface CampaignTemplate { … }` block (lines 21–30).
- DELETE the `import type { LucideIcon } from "lucide-react";` line (line 10) — it was only used by the now-deleted interface, so leaving it triggers a NEW `noUnusedLocals` error. (KEEP the VALUE import `import { CloudSnow, Leaf, MessageCircle, Sparkles, Sprout } from "lucide-react";` — those icons are still used by `TEMPLATES`, which stays until Task 3.)
- Add, near the top: `export type { CampaignTemplate } from "@/verticals/campaigns";`.
- KEEP `CampaignKind` (still imported by `Campaigns.tsx` until Task 2), `TEMPLATES` (its annotation stays `CampaignTemplate[]` — now the re-exported contract type; the literal `kind` values satisfy `string`), `MERGE_TAGS`, and `applyMergeTags` (unchanged, incl. the pre-existing `replaceAll` line).

(After this step `TEMPLATES` still compiles: each entry's `kind` is a string literal, assignable to the contract's `kind: string`; each `icon` is a value from the kept value import.)

- [ ] **Step 9: Typecheck, build, full suite**

Run: `npx tsc --noEmit -p tsconfig.app.json` (error set == the 6-file baseline — `Vertical` now requires `campaigns` and `lawnVertical` provides it; `templates.ts` keeps its pre-existing `replaceAll` error and no new error; consumers still use `TEMPLATES`/`CampaignKind` unchanged), then `npm run build` (succeeds), then `npm test -- --run` (green).

- [ ] **Step 10: Commit**

```bash
git add src/verticals/campaigns.ts src/verticals/lawn/campaigns.ts src/verticals/lawn/campaigns.test.ts src/verticals/types.ts src/verticals/lawn/index.ts src/components/campaigns/templates.ts
git commit -m "feat(platform): add vertical.campaigns module (lawn templates + copy)"
```

---

### Task 2: TemplatePicker + Campaigns read `vertical.campaigns`

**Files:**
- Modify: `src/components/campaigns/TemplatePicker.tsx`
- Modify: `src/pages/Campaigns.tsx`

**Interfaces:**
- Consumes: `vertical.campaigns.templates` / `.defaultKind` / `.copy` (via `@/vertical`).

- [ ] **Step 1: TemplatePicker — read templates + copy from the vertical**

In `src/components/campaigns/TemplatePicker.tsx`:
- Change the import `import { TEMPLATES, applyMergeTags, type CampaignTemplate } from "./templates";` to `import { applyMergeTags, type CampaignTemplate } from "./templates";` and add `import { vertical } from "@/vertical";`.
- The two `business_name: businessName || "your lawn crew"` lines (in the `preview` and `subjectPreview` memos) → `business_name: businessName || vertical.campaigns.copy.previewFallbackBusinessName`.
- The `{TEMPLATES.map((t) => {` → `{vertical.campaigns.templates.map((t) => {`.
- The placeholder `placeholder="An update from your lawn crew"` → `placeholder={\`An update from ${vertical.campaigns.copy.previewFallbackBusinessName}\`}`.

- [ ] **Step 2: Campaigns — swap imports, loosen `kind`, read from the vertical**

In `src/pages/Campaigns.tsx`:
- Change the import block `import { TEMPLATES, type CampaignKind, type CampaignTemplate } from "@/components/campaigns/templates";` to `import { type CampaignTemplate } from "@/components/campaigns/templates";` and add `import { vertical } from "@/vertical";`.
- In the local `CampaignRow` interface, change `kind: CampaignKind;` to `kind: string;`.
- Change `const [kind, setKind] = useState<CampaignKind>("aeration");` to `const [kind, setKind] = useState<string>(vertical.campaigns.defaultKind);`.
- Change `const t = TEMPLATES[0];` to `const t = vertical.campaigns.templates[0];`.
- Change both `TEMPLATES.find((t) => t.kind === campaign.kind)?.label ?? campaign.kind` occurrences to `vertical.campaigns.templates.find((t) => t.kind === campaign.kind)?.label ?? campaign.kind`.
- Change both `?? "your lawn crew"` occurrences (the preview-context builder and the `businessName={…}` prop) to `?? vertical.campaigns.copy.previewFallbackBusinessName`.
- Replace the header subtitle text `Seasonal blasts — aeration, leaf cleanup, spring restart.` with `{vertical.campaigns.copy.pageSubtitle}`.
- Replace the empty-state paragraph text (`Aeration in August, leaf cleanup in October, spring restart in March. Pick a template and blast your customer list in two minutes.`) with `{vertical.campaigns.copy.emptyStateBlurb}`.

- [ ] **Step 3: Typecheck, build, test**

Run: `npx tsc --noEmit -p tsconfig.app.json` (error set == baseline — `TemplatePicker.tsx` must NOT appear; `Campaigns.tsx` must have NO NEW error beyond its pre-existing one), then `npm run build` (succeeds), then `npm test -- --run` (green).

- [ ] **Step 4: Commit**

```bash
git add src/components/campaigns/TemplatePicker.tsx src/pages/Campaigns.tsx
git commit -m "feat(platform): Campaigns + TemplatePicker read vertical.campaigns"
```

---

### Task 3: Remove the now-dead `TEMPLATES` + `CampaignKind` from templates.ts

**Files:**
- Modify: `src/components/campaigns/templates.ts`

**Interfaces:**
- Consumes: nothing new. Deletes dead exports no longer referenced after Task 2.

- [ ] **Step 1: Delete the relocated/dead exports**

In `src/components/campaigns/templates.ts`:
- DELETE the `export type CampaignKind = …;` union.
- DELETE the entire `export const TEMPLATES: CampaignTemplate[] = [ … ];` array.
- DELETE the lucide icon import line (`import { CloudSnow, Leaf, MessageCircle, Sparkles, Sprout } from "lucide-react";`) — those icons were only used by `TEMPLATES`.
- KEEP: the `export type { CampaignTemplate } from "@/verticals/campaigns";` re-export (from Task 1), `MERGE_TAGS`, and `applyMergeTags` (with its pre-existing `replaceAll` line). Keep the top-of-file comment or trim it to describe the remaining merge helpers.

After this, `templates.ts` contains only: the `CampaignTemplate` re-export, `MERGE_TAGS`, `applyMergeTags`. (The `LucideIcon` TYPE import was already removed in Task 1; here the lucide VALUE import goes because `TEMPLATES` — its only user — is deleted.)

- [ ] **Step 2: Typecheck, build, test**

Run: `npx tsc --noEmit -p tsconfig.app.json` (error set == baseline; `templates.ts` still present with ONLY its pre-existing `replaceAll` error — if a NEW error appears in `templates.ts`, an import it still needs was removed; if another file appears, something still imported `TEMPLATES`/`CampaignKind`), then `npm run build` (succeeds), then `npm test -- --run` (green).

- [ ] **Step 3: Confirm nothing references the deleted symbols**

Run: `grep -rn "TEMPLATES\|CampaignKind" src` — expected: ZERO matches (the vertical uses `LAWN_TEMPLATES`; consumers use `vertical.campaigns.templates`; `kind` is `string` everywhere).

- [ ] **Step 4: Commit**

```bash
git add src/components/campaigns/templates.ts
git commit -m "feat(platform): drop dead TEMPLATES/CampaignKind from templates.ts (now in vertical)"
```

---

## Human verification (deferred — after deploy)

Not an implementer task (needs the running app):
- Campaigns page: the header subtitle + empty-state paragraph read the same; the "New campaign" wizard shows the same six template cards (Aeration push, Leaf cleanup signup, Spring restart, Fert program enrollment, Snow season signup, Custom).
- Selecting a template prefills the same subject/body; the live preview renders merge tags with the fallback business name ("your lawn crew") when no business name is set.
- A saved campaign's row shows the correct template label.

## Notes for the implementer

- Behavior-identical: the six templates in `lawn/campaigns.ts` must be byte-identical to the former `templates.ts` `TEMPLATES` (same subjects/bodies/merge-tags/icons). If a template renders or prefills differently, stop and report.
- The `TEMPLATES` duplication between `templates.ts` and `lawn/campaigns.ts` exists only across Tasks 1–2 and is removed in Task 3 — it is intentional, not a defect.
- Do NOT touch `MERGE_TAGS`/`applyMergeTags` (generic; the `replaceAll` error is pre-existing baseline). Do NOT touch `AudienceStep.tsx` (out of scope).
- `Campaigns.tsx` is in the pre-existing tsc baseline; its gate is "no NEW error." Every other touched file must stay out of the error set.
- After Task 3, `grep -rn "TEMPLATES\|CampaignKind" src` must be empty.
