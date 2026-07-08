# Phase 0c-6b — property fields seam design

Status: approved design, ready for implementation planning.
Date: 2026-07-07.

## Context

Part of the multi-vertical platform (spec:
`2026-07-04-multi-vertical-platform-design.md`). **Phase 0c** extracts the lawn
domain behind the `Vertical` contract. **0c-6** (the last domain slice) is split
into **0c-6a campaign templates** (merged), **0c-6b property fields** (this), and
**0c-6c app-wide copy**.

### What the audit established (PropertyDetail.tsx, 810 lines)

- **Seven lawn-specific `properties` columns** (migration 0001, not in generated
  types, cast via `(supabase as any)`): `turf_sqft`, `grass_type`, `mow_height_in`,
  `pet_safe_only`, `irrigation_present`, `slope_warning`, `bag_clippings`. The
  local `PropertyRow` interface (lines 56–75) extends the DB row with these.
- **They are split across TWO cards:** `turf_sqft` + `slope_warning` live in the
  **Property** card; only the **other five** are in the **"Lawn details" card**:
  `grass_type` (datalist), `mow_height_in` (number), and `pet_safe_only` /
  `irrigation_present` / `bag_clippings` (toggles).
- **Form state** is a single `EditState` object (lines 97–123) with named keys;
  numeric columns are held as `string` (parsed with `Number()` at save). The save
  mutation (lines 195–225) writes ALL keys in one `Record<string, unknown>`
  payload via `(supabase as any).from("properties").update(payload)`.
- **The "Lawn details" edit card** (lines 364–410) and **read view** (lines
  508–548) hardcode the five fields. Read view: scalars (`grass_type`,
  `mow_height_in`) render as `<Stat>` in a 2-col grid (mow height gets a `"`
  suffix); toggles render as `<Pill>` with tones `green`/`rain`/`bronze`, gated on
  truthiness, with the empty-state string "No lawn-care flags set. Edit to record
  grass type, mow height, irrigation, etc." when all three are falsy.
- `COMMON_GRASS_TYPES` (lines 33–43): the 9-entry grass datalist.
- **Local helpers** `SectionLabel`, `Field`, `ToggleRow`, `Stat`, `Pill` (module
  scope, lines 689–809) are reusable as-is.
- **Separable / out of scope:** the `chemical_applications` ("Recent applications")
  and `maintenance_plans` ("Plans for this property") sections (lines 552–658) are
  relational-data sections outside the `editing` branch, with no shared state —
  they are NOT property custom fields. `turf_sqft`/`slope_warning` stay in the
  Property card. `PropertyDetail.tsx` is NOT in the tsc baseline (must stay clean).

## Decisions

1. **Add `propertyFields: PropertyFieldsModule` to the `Vertical` contract.**
2. **Scope = the 5 "Lawn details" card fields** only. The vertical owns the field
   definitions + section copy + grass suggestions.
3. **Config drives RENDERING, not state shape.** `EditState` keeps its named keys
   and the save payload is unchanged — the lowest-risk approach (mirrors the 0c-3
   "leave the shape, register via seam" choice). Config field `key`s equal the
   `EditState`/column keys for lawn; the card reads/writes `edit[key]` via a
   localized cast. A future pressure vertical supplies `fields: []` → the card
   doesn't render (its unused lawn `EditState` keys are harmless until Phase 1).
4. **Reuse the existing local helpers** (`Field`/`ToggleRow`/`Stat`/`Pill`/
   `SectionLabel`) unchanged.
5. **Behavior-identical** for TurfPro.

## The contract

New file `src/verticals/property-fields.ts`:

```ts
import type { LucideIcon } from "lucide-react";

// One editable custom field on the property record.
export type PropertyFieldDef =
  | { key: string; label: string; type: "datalist"; placeholder?: string; suggestions: string[] }
  | { key: string; label: string; type: "number"; placeholder?: string; step?: string; displaySuffix?: string }
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

The `Vertical` interface (`src/verticals/types.ts`) gains
`propertyFields: PropertyFieldsModule`.

## Architecture / mechanics

- **`src/verticals/lawn/property-fields.ts`** — `lawnPropertyFields`:
  ```ts
  export const lawnPropertyFields: PropertyFieldsModule = {
    sectionLabel: "Lawn details",
    sectionIcon: Leaf,
    emptyStateHint: "No lawn-care flags set. Edit to record grass type, mow height, irrigation, etc.",
    fields: [
      { key: "grass_type", label: "Grass type", type: "datalist",
        placeholder: "e.g. Bermuda, Fescue, Zoysia…",
        suggestions: ["Bermuda","Fescue","Zoysia","Kentucky Bluegrass","St. Augustine","Centipede","Ryegrass","Buffalo","mixed"] },
      { key: "mow_height_in", label: "Mow height (in)", type: "number",
        placeholder: "e.g. 3.5", step: "0.1", displaySuffix: "\"" },
      { key: "pet_safe_only", label: "Pet-safe chems only", type: "toggle", icon: PawPrint, pillTone: "green" },
      { key: "irrigation_present", label: "Irrigation present", type: "toggle", icon: Droplets, pillTone: "rain" },
      { key: "bag_clippings", label: "Bag clippings", type: "toggle", icon: Scissors, pillTone: "bronze" },
    ],
  };
  ```
  (`Leaf, PawPrint, Droplets, Scissors` imported from lucide-react — those icons
  are used ONLY by this section, so they also move out of `PropertyDetail`'s import.)
- **`src/verticals/lawn/index.ts`** — register `propertyFields: lawnPropertyFields`.
- **`src/pages/PropertyDetail.tsx`:**
  - `import { vertical } from "@/vertical"`; remove the now-unused `Leaf`/`PawPrint`/
    `Droplets`/`Scissors` from the lucide import (they moved to the vertical) and
    delete the local `COMMON_GRASS_TYPES` const.
  - **Edit card** — replace the five hardcoded controls with
    `{vertical.propertyFields.fields.map((f) => …)}` rendering per `f.type`:
    `datalist` → `<Field label={f.label}>` + `<input list={id} …>` + `<datalist
    id={id}>` (id = `` `datalist-${f.key}` ``) mapping `f.suggestions`; `number` →
    `<Field>` + `<input type="number" inputMode="decimal" step={f.step} …>`;
    `toggle` → `<ToggleRow label={f.label} icon={<f.icon …/>} checked=… onChange=…>`.
    Each control reads/writes `edit[f.key]` via a narrow cast
    (`(edit as Record<string, string | boolean>)[f.key]`; `setEdit({ ...edit,
    [f.key]: value })`). The card is only rendered when
    `vertical.propertyFields.fields.length > 0`, wrapped in the same
    `<SectionLabel accent="green">{vertical.propertyFields.sectionLabel}</SectionLabel>`.
  - **Read view** — render the same card driven by config: partition
    `vertical.propertyFields.fields` into scalars (`datalist`/`number` → `<Stat
    label value>` with `displaySuffix`) shown in the 2-col grid, and toggles
    (`type === "toggle"` → `<Pill tone={f.pillTone} icon={<f.icon/>}>` when
    `property[f.key]` truthy). Show `vertical.propertyFields.emptyStateHint` when no
    toggle field is set. Section label uses `sectionIcon` + `sectionLabel`.
  - **`EditState`, `emptyEdit`, the save mutation payload, and the Property card
    (`turf_sqft`/`slope_warning`) are UNCHANGED.** The `PropertyRow` interface keeps
    its lawn columns (they type the DB row read; not the config).

## Testing

- **Unit (vitest)** `src/verticals/lawn/property-fields.test.ts`: `fields` has 5
  entries with keys `["grass_type","mow_height_in","pet_safe_only","irrigation_present","bag_clippings"]`;
  `grass_type` is `datalist` with 9 suggestions; `mow_height_in` is `number` with
  `step "0.1"` + `displaySuffix "\""`; the three toggles have tones
  `green`/`rain`/`bronze`; `sectionLabel === "Lawn details"`; `emptyStateHint`
  exact.
- **Conformance:** `lawnVertical.propertyFields` defined.
- **Build + tsc:** `npx tsc --noEmit -p tsconfig.app.json` — error set stays the
  known 6-file baseline; `PropertyDetail.tsx` must NOT appear (it is currently
  clean). `npm run build` succeeds; full vitest suite green.
- **Manual (deferred, human):** the Lawn-details card renders the same 5 fields;
  editing grass type / mow height / the 3 toggles and saving persists identically;
  the read-view Stats + Pills + empty state look unchanged.

## Out of scope (0c-6b)

- `turf_sqft` + `slope_warning` (they live in the Property card).
- The `chemical_applications` + plans-by-property sections (relational data, not
  fields) — deferred.
- RouteMode's `PropertyFlagPills` (a separate lawn-only consumer, already in
  `extraRoutes`).
- Restructuring `EditState`/save into a dynamic `Record` — Phase 1 (when a second
  vertical actually needs different columns).
- App-wide copy (0c-6c). Any pressure property fields — Phase 1.
