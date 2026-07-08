# Property Fields Seam (Phase 0c-6b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `vertical.propertyFields` config module and drive PropertyDetail's "Lawn details" card (5 fields + copy) from it, so a future vertical supplies its own custom fields (or none).

**Architecture:** New `src/verticals/property-fields.ts` contract (`PropertyFieldDef`, `PropertyFieldsModule`); `src/verticals/lawn/property-fields.ts` holds `lawnPropertyFields`; `PropertyDetail.tsx` renders the edit + read views by mapping `vertical.propertyFields.fields`. `EditState` and the save payload are unchanged (config drives rendering only).

**Tech Stack:** React + TypeScript + Vite + Supabase + vitest.

## Global Constraints

- **Phase 0c-6b** of the multi-vertical platform (spec: `2026-07-07-property-fields-seam-design.md`).
- **Behavior-identical for TurfPro** — same 5 Lawn-details fields, same labels/placeholders/icons/toggle tones, same read-view Stats/Pills/empty-state, same save.
- **Config drives RENDERING, not state.** `EditState`, `emptyEdit`, the save mutation, the `PropertyRow` interface, and the Property card (`turf_sqft`/`slope_warning`) are UNCHANGED. The card reads/writes `edit[key]` via localized casts; config field `key`s equal the `EditState`/column keys.
- **Contract refinement over the spec:** `PropertyFieldDef` scalar variants get an optional `readLabel?: string` (the read-view Stat label; falls back to `label`). Needed because the mow-height field's edit label is "Mow height (in)" but its read Stat label is "Mow height".
- Verify tsc with the STRICT app config: `npx tsc --noEmit -p tsconfig.app.json`. Known PRE-EXISTING 6-file baseline: `AudienceStep.tsx`, `campaigns/templates.ts`, `BusinessProfile.tsx`, `iap.ts`, `Campaigns.tsx`, `Onboarding.tsx`. `PropertyDetail.tsx` is CLEAN (not in baseline) — the gate is it must NOT appear in the error set. Success = error set stays EXACTLY the 6 baseline files.
- Tests: `npm test -- --run`. Build: `npm run build`.
- Base branch: `feature/property-fields-seam` (spec committed there). Commit trailers on every commit:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` /
  `Claude-Session: https://claude.ai/code/session_01QrF17kQNQsTPBTHee6C3br`.

---

### Task 1: The property-fields contract + lawn module + registration + tests

**Files:**
- Create: `src/verticals/property-fields.ts`
- Create: `src/verticals/lawn/property-fields.ts`
- Create (test): `src/verticals/lawn/property-fields.test.ts`
- Modify: `src/verticals/types.ts` (add `propertyFields` to `Vertical`)
- Modify: `src/verticals/lawn/index.ts` (register `propertyFields`)

**Interfaces:**
- Produces (used by Task 2): `PropertyFieldDef`, `PropertyFieldsModule` (`@/verticals/property-fields`); `lawnPropertyFields` (`@/verticals/lawn/property-fields`); `vertical.propertyFields` (via `@/vertical`).

- [ ] **Step 1: Create the contract**

Create `src/verticals/property-fields.ts`:

```ts
import type { LucideIcon } from "lucide-react";

// One editable custom field on the property record.
export type PropertyFieldDef =
  | { key: string; label: string; readLabel?: string; type: "datalist"; placeholder?: string; suggestions: string[] }
  | { key: string; label: string; readLabel?: string; type: "number"; placeholder?: string; step?: string; displaySuffix?: string }
  | { key: string; label: string; type: "toggle"; icon: LucideIcon; pillTone: "green" | "rain" | "bronze" };

export interface PropertyFieldsModule {
  /** Heading for the custom-fields card ("Lawn details"). */
  sectionLabel: string;
  /** Icon shown beside the read-view section label. */
  sectionIcon: LucideIcon;
  /** Shown when no toggle field is set. */
  emptyStateHint: string;
  /** The vertical's editable custom fields (empty = no card renders). */
  fields: PropertyFieldDef[];
}
```

- [ ] **Step 2: Add `propertyFields` to the `Vertical` contract**

In `src/verticals/types.ts`, add the import (after `import type { CampaignsModule } from "./campaigns";`):
```ts
import type { PropertyFieldsModule } from "./property-fields";
```
and inside `interface Vertical { … }`, after `campaigns: CampaignsModule;`, add:
```ts
  /** Editable custom property fields + section copy for this vertical. */
  propertyFields: PropertyFieldsModule;
```

- [ ] **Step 3: Write the lawn property-fields test (TDD)**

Create `src/verticals/lawn/property-fields.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { lawnPropertyFields } from "@/verticals/lawn/property-fields";

describe("lawnPropertyFields", () => {
  it("has the 5 Lawn-details fields in order", () => {
    expect(lawnPropertyFields.fields.map((f) => f.key)).toEqual([
      "grass_type", "mow_height_in", "pet_safe_only", "irrigation_present", "bag_clippings",
    ]);
  });
  it("grass_type is a datalist with 9 suggestions", () => {
    const f = lawnPropertyFields.fields.find((x) => x.key === "grass_type");
    expect(f?.type).toBe("datalist");
    expect(f?.type === "datalist" && f.suggestions).toHaveLength(9);
  });
  it("mow_height_in is a number with a step and an inch display suffix", () => {
    const f = lawnPropertyFields.fields.find((x) => x.key === "mow_height_in");
    expect(f?.type).toBe("number");
    expect(f?.type === "number" && f.step).toBe("0.1");
    expect(f?.type === "number" && f.displaySuffix).toBe('"');
    expect(f?.type === "number" && f.readLabel).toBe("Mow height");
  });
  it("the three flags are toggles with the right pill tones", () => {
    const tones = Object.fromEntries(
      lawnPropertyFields.fields
        .filter((f) => f.type === "toggle")
        .map((f) => [f.key, f.type === "toggle" ? f.pillTone : ""]),
    );
    expect(tones).toEqual({ pet_safe_only: "green", irrigation_present: "rain", bag_clippings: "bronze" });
  });
  it("carries the section copy", () => {
    expect(lawnPropertyFields.sectionLabel).toBe("Lawn details");
    expect(lawnPropertyFields.emptyStateHint).toBe(
      "No lawn-care flags set. Edit to record grass type, mow height, irrigation, etc.",
    );
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- --run property-fields`
Expected: FAIL — `@/verticals/lawn/property-fields` does not exist yet.

- [ ] **Step 5: Implement the lawn property-fields module**

Create `src/verticals/lawn/property-fields.ts` (grass suggestions relocated verbatim from `PropertyDetail`'s `COMMON_GRASS_TYPES`; labels/placeholders/icons/tones relocated verbatim from the Lawn-details card):

```ts
import { Leaf, PawPrint, Droplets, Scissors } from "lucide-react";
import type { PropertyFieldsModule } from "@/verticals/property-fields";

export const lawnPropertyFields: PropertyFieldsModule = {
  sectionLabel: "Lawn details",
  sectionIcon: Leaf,
  emptyStateHint:
    "No lawn-care flags set. Edit to record grass type, mow height, irrigation, etc.",
  fields: [
    {
      key: "grass_type",
      label: "Grass type",
      type: "datalist",
      placeholder: "e.g. Bermuda, Fescue, Zoysia…",
      suggestions: [
        "Bermuda", "Fescue", "Zoysia", "Kentucky Bluegrass", "St. Augustine",
        "Centipede", "Ryegrass", "Buffalo", "mixed",
      ],
    },
    {
      key: "mow_height_in",
      label: "Mow height (in)",
      readLabel: "Mow height",
      type: "number",
      placeholder: "e.g. 3.5",
      step: "0.1",
      displaySuffix: '"',
    },
    { key: "pet_safe_only", label: "Pet-safe chems only", type: "toggle", icon: PawPrint, pillTone: "green" },
    { key: "irrigation_present", label: "Irrigation present", type: "toggle", icon: Droplets, pillTone: "rain" },
    { key: "bag_clippings", label: "Bag clippings", type: "toggle", icon: Scissors, pillTone: "bronze" },
  ],
};
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- --run property-fields`
Expected: PASS — all lawnPropertyFields cases green.

- [ ] **Step 7: Register `propertyFields` on the lawn vertical**

In `src/verticals/lawn/index.ts`, add the import and the field:
```ts
import { lawnPropertyFields } from "./property-fields";
```
and inside `lawnVertical`, after `campaigns: lawnCampaigns,`, add:
```ts
  propertyFields: lawnPropertyFields,
```

- [ ] **Step 8: Typecheck, build, full suite**

Run: `npx tsc --noEmit -p tsconfig.app.json` (error set == 6-file baseline — `Vertical` now requires `propertyFields` and `lawnVertical` provides it; `PropertyDetail` still hardcodes its card, unaffected), then `npm run build` (succeeds), then `npm test -- --run` (green).

- [ ] **Step 9: Commit**

```bash
git add src/verticals/property-fields.ts src/verticals/lawn/property-fields.ts src/verticals/lawn/property-fields.test.ts src/verticals/types.ts src/verticals/lawn/index.ts
git commit -m "feat(platform): add vertical.propertyFields module (lawn fields + copy)"
```

---

### Task 2: PropertyDetail renders the custom fields from `vertical.propertyFields`

**Files:**
- Modify: `src/pages/PropertyDetail.tsx`

**Interfaces:**
- Consumes: `vertical.propertyFields` (`.fields` / `.sectionLabel` / `.sectionIcon` / `.emptyStateHint`).

- [ ] **Step 1: Imports + remove the relocated const/icons**

In `src/pages/PropertyDetail.tsx`:
- Add `import { vertical } from "@/vertical";` and `import type { PropertyFieldDef } from "@/verticals/property-fields";` (the latter is used by the read-view scalar filter's type predicate).
- Remove `Leaf`, `PawPrint`, `Droplets`, `Scissors` from the lucide import (they moved to the vertical; they were used ONLY by the Lawn-details card). KEEP the others (`ArrowLeft, MapPin, KeyRound, AlertTriangle, Mountain, Pencil, Save, Trash2, Repeat, ChevronRight, Beaker, Trees`).
- DELETE the local `const COMMON_GRASS_TYPES = [ … ];` block (now `lawnPropertyFields.fields[0].suggestions`).
- Near the top of the `PropertyDetail` component body, add `const SectionIcon = vertical.propertyFields.sectionIcon;` (used by the read-view section label).

- [ ] **Step 2: Replace the "Lawn details" EDIT card with a config-driven map**

Replace the entire edit-card block (`{/* Lawn details — NEW for TurfPro */} <div className="tp-card p-4 space-y-3"> … </div>`, currently lines ~364–410) with:

```tsx
          {/* Lawn details — driven by the active vertical */}
          {vertical.propertyFields.fields.length > 0 && (
            <div className="tp-card p-4 space-y-3">
              <SectionLabel accent="green">{vertical.propertyFields.sectionLabel}</SectionLabel>
              {vertical.propertyFields.fields.map((f) => {
                const state = edit as Record<string, string | boolean>;
                if (f.type === "toggle") {
                  const Icon = f.icon;
                  return (
                    <ToggleRow
                      key={f.key}
                      label={f.label}
                      icon={<Icon className="h-3.5 w-3.5" />}
                      checked={state[f.key] as boolean}
                      onChange={(v) => setEdit({ ...edit, [f.key]: v } as EditState)}
                    />
                  );
                }
                const listId = `datalist-${f.key}`;
                return (
                  <Field key={f.key} label={f.label}>
                    <input
                      type={f.type === "number" ? "number" : "text"}
                      {...(f.type === "number"
                        ? { inputMode: "decimal" as const, step: f.step }
                        : { list: listId })}
                      value={state[f.key] as string}
                      onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value } as EditState)}
                      placeholder={f.placeholder}
                      className="tp-input"
                    />
                    {f.type === "datalist" && (
                      <datalist id={listId}>
                        {f.suggestions.map((s) => (
                          <option value={s} key={s} />
                        ))}
                      </datalist>
                    )}
                  </Field>
                );
              })}
            </div>
          )}
```

- [ ] **Step 3: Replace the "Lawn details" READ view with a config-driven map**

Replace the entire read-view block (`{/* Lawn details */} <div className="tp-card p-4 space-y-3"> … </div>`, currently lines ~508–548) with:

```tsx
          {/* Lawn details — driven by the active vertical */}
          {vertical.propertyFields.fields.length > 0 && (
            <div className="tp-card p-4 space-y-3">
              <SectionLabel accent="green">
                <SectionIcon className="h-3.5 w-3.5 inline -mt-0.5 mr-1" strokeWidth={2.2} />
                {vertical.propertyFields.sectionLabel}
              </SectionLabel>
              <div className="grid grid-cols-2 gap-3">
                {vertical.propertyFields.fields
                  .filter(
                    (f): f is Extract<PropertyFieldDef, { type: "datalist" | "number" }> =>
                      f.type !== "toggle",
                  )
                  .map((f) => {
                    const raw = (property as Record<string, unknown>)[f.key];
                    const value =
                      f.type === "number"
                        ? raw != null
                          ? `${raw}${f.displaySuffix ?? ""}`
                          : "—"
                        : String(raw ?? "") || "—";
                    return <Stat key={f.key} label={f.readLabel ?? f.label} value={value} />;
                  })}
              </div>
              <div className="grid grid-cols-1 gap-1.5 pt-1">
                {vertical.propertyFields.fields.map((f) => {
                  if (f.type !== "toggle") return null;
                  if (!(property as Record<string, unknown>)[f.key]) return null;
                  const Icon = f.icon;
                  return (
                    <Pill key={f.key} icon={<Icon className="h-3 w-3" />} tone={f.pillTone}>
                      {f.label}
                    </Pill>
                  );
                })}
                {(() => {
                  const toggles = vertical.propertyFields.fields.filter((f) => f.type === "toggle");
                  const noneSet = toggles.every(
                    (f) => !(property as Record<string, unknown>)[f.key],
                  );
                  return toggles.length > 0 && noneSet ? (
                    <div className="text-xs text-neutral-500">
                      {vertical.propertyFields.emptyStateHint}
                    </div>
                  ) : null;
                })()}
              </div>
            </div>
          )}
```

- [ ] **Step 4: Typecheck, build, test**

Run: `npx tsc --noEmit -p tsconfig.app.json` (error set == baseline; `PropertyDetail.tsx` must NOT appear — if it does: a removed icon is still referenced, `COMMON_GRASS_TYPES` is still referenced, or a discriminated-union field access wasn't guarded by its `f.type` check), then `npm run build` (succeeds), then `npm test -- --run` (green).

- [ ] **Step 5: Commit**

```bash
git add src/pages/PropertyDetail.tsx
git commit -m "feat(platform): PropertyDetail renders custom fields from vertical.propertyFields"
```

---

## Human verification (deferred — after deploy)

Not an implementer task (needs the running app):
- PropertyDetail edit mode: the Lawn-details card shows Grass type (with the Bermuda/Fescue/… datalist), Mow height (in) (number, step 0.1), and the three toggles (Pet-safe chems only / Irrigation present / Bag clippings) with the same icons; editing + saving persists each value identically.
- Read mode: Grass type + Mow height render as Stats (mow height shows the `"` suffix; blank shows "—"); the set flags show as green/rain/bronze pills; when no flag is set, the "No lawn-care flags set…" hint shows.

## Notes for the implementer

- Behavior-identical: the five fields, their labels/placeholders/icons/tones, the read-view Stats/Pills/empty-state, and the save all match today. If a field renders or saves differently, stop and report.
- `EditState`, `emptyEdit`, the save mutation, the `PropertyRow` interface, and the Property card (`turf_sqft`/`slope_warning`) are OUT OF SCOPE — do not touch them.
- JSX gotcha: a component held in a variable must be Capitalized — assign `const Icon = f.icon;` (and `const SectionIcon = …`) before using `<Icon/>`; `<f.icon/>` renders as an HTML tag and is wrong.
- The `edit`/`property` casts (`as Record<string, string | boolean>` / `as Record<string, unknown>`, and `setEdit({…} as EditState)`) are the localized escape hatches that let a typed `EditState` be driven by string keys — expected, not a smell.
- `PropertyDetail.tsx` is NOT in the tsc baseline; it must stay out of the error set.
