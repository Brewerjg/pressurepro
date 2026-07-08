# Phase 1 slice 1b — pressure quote-line seam design

Status: approved phase; this slice's design ready for planning.
Date: 2026-07-08.
Parent: `2026-07-08-pressure-vertical-phase1-design.md`.

## Purpose

Implement the pressure vertical's `quoteLine` module — the deepest seam. It is a
faithful port of PressurePro's `SurfaceLine` model + quote editor, expressed
through the existing `QuoteLineModule` contract (`src/verticals/quote-line.ts`),
mirroring `src/verticals/lawn/quote-line.tsx` structurally. Nothing is registered
here (register-last, 1e); the shared `QuoteForm` already delegates to
`vertical.quoteLine.LineEditor` (`QuoteForm.tsx:225`), so no shared change is
needed.

## The contract (unchanged — already exists)

`QuoteLineModule` requires: `blankLine()`, `catalogToLine(item)`,
`lineTotal(line)`, `parseLines(raw)`, `describe(line) → LineDescription`,
`LineEditor`. The shared `QuoteLine` is opaque `{ id; total; [k]: unknown }`;
display consumers read only `describe()`'s `LineDescription`
`{ label; detail; qty; rate; amount }`. `CatalogItem` is
`{ id; name; default_rate; surface_type?; mode? }`. This slice adds NO contract
change.

## The pressure line shape

New file `src/verticals/pressure/quote-line.tsx` (mirrors lawn):

```ts
type SurfaceKey = "concrete" | "siding" | "roof" | "deck" | "fence" | "driveway" | "house";
type JobMode = "soft" | "power";

interface PressureSurfaceLine extends QuoteLine {
  surface: SurfaceKey;
  sqft: number;
  rate: number;      // $/sqft, or flat $ when custom (sqft = 1)
  mode: JobMode;
  label?: string;    // custom-line name override
  custom?: boolean;  // true = flat user-entered line
  // inherited: id: string; total: number
}
```

Relocated domain constants (verbatim from PressurePro `store.ts`):

```ts
const SURFACE_META: Record<SurfaceKey, { label: string; emoji: string; recommended: JobMode }> = {
  house:    { label: "House Wash", emoji: "🏠", recommended: "soft" },
  siding:   { label: "Siding",     emoji: "🧱", recommended: "soft" },
  roof:     { label: "Roof",       emoji: "🛖", recommended: "soft" },
  driveway: { label: "Driveway",   emoji: "🛣️", recommended: "power" },
  concrete: { label: "Concrete",   emoji: "🧊", recommended: "power" },
  deck:     { label: "Deck",       emoji: "🪵", recommended: "soft" },
  fence:    { label: "Fence",      emoji: "🚧", recommended: "soft" },
};
// Add-time default area by surface (from PressurePro NewQuote.addSurface).
const DEFAULT_SQFT: Record<SurfaceKey, number> = {
  house: 1500, siding: 1500, roof: 1500, driveway: 600, concrete: 600, deck: 300, fence: 300,
};
```

## Module behavior

- **`lineTotal(line)`** = `Math.round(sqft * rate * 100) / 100` (verbatim from
  PressurePro `store.ts:837`).
- **`blankLine()`** → a custom flat line: `{ id: uuid, surface: "concrete",
  sqft: 1, rate: 0, mode: "power", label: "Custom item", custom: true, total: 0 }`.
  (`surface` is a required field but ignored for custom lines.)
- **`catalogToLine(item)`**: if `item.surface_type` is a valid `SurfaceKey` → a
  surface line `{ surface, mode: item.mode as JobMode ?? SURFACE_META[surface].recommended,
  rate: Number(item.default_rate ?? 0), sqft: DEFAULT_SQFT[surface], custom: false }`
  with `total = lineTotal`; else → a custom flat line from `item.name` +
  `default_rate` (sqft 1, custom true).
- **`parseLines(raw)`**: `Array.isArray` guard; per row, require an object; read
  `surface` (validate against `SURFACE_META`, else treat as custom), `sqft`,
  `rate`, `mode` (default "soft"), `label`, `custom`; `id` = existing string or
  `crypto.randomUUID()`; `total` = existing number or recomputed. Drop non-object
  rows (`filter`). Pressure's live quotes already store this shape, so this is a
  pass-through with defensive coercion (mirrors `lawnParseLines`).
- **`describe(line) → LineDescription`** (drives the shared print table + accept
  cards):
  - `label` = `custom ? (label || "Custom item") : SURFACE_META[surface].label`
  - `qty` = `custom ? "1" : `${sqft.toLocaleString()} sqft``
  - `rate` = `custom ? "—" : `$${rate.toFixed(2)}``
  - `detail` = `custom ? null : `${sqft.toLocaleString()} sqft × $${rate.toFixed(2)} · ${mode}``
  - `amount` = `total`

## LineEditor

`PressureLineEditor({ lines, catalog, onChange })` — mirrors `LawnLineEditor`'s
structure and **uses the shared `tp-*` classes + `Section`/`Field` from
`@/components/quotes/FormSection`** (NOT PressurePro's `pp-*` classes), so it
themes under the active vertical:

- A `<Section title="Line items" subtitle="Tap a surface to add it, or add a
  custom line. Edit sqft, rate, and wash mode per line.">`.
- **Surface grid**: a `grid grid-cols-4 gap-2` of emoji buttons from
  `SURFACE_META`; tapping adds a surface line. Rate source: look up the `catalog`
  prop for an item whose `surface_type === surface` and `mode === recommended`;
  use its `default_rate`, else `0`. (Catalog is wired to `surface_pricing` in
  1c; until then surfaces add at rate 0 and the operator edits — the editor is
  fully functional either way.)
- **"Add custom line item"** dashed button → `blankLine()`.
- **Per-line rows**: custom → emoji ✏️ + name input + `Field "Amount ($)"`
  (writes `{ rate, sqft: 1 }`); surface → `SURFACE_META` emoji + label + a
  3-col grid `Field "Sqft"` / `Field "$ / sqft"` / `Field "Mode"` with an inline
  **ModeToggle** (soft/power segmented control, `Droplets`/`Zap` icons, shared
  theme classes — ported from PressurePro's `ModeToggle` but using an available
  shadow utility, no `pp-*`/`shadow-soft`). Each row shows a "Line total" =
  `lineTotal`. A trash button removes the line. Edits recompute `total` via
  `lineTotal` (same pattern as `LawnLineEditor.updateLine`).

The `ModeToggle` is defined inside `quote-line.tsx` (self-contained), typed on
the module's local `JobMode`.

## Testing

`src/verticals/pressure/quote-line.test.ts` (mirrors lawn's coverage):

- `lineTotal`: `{sqft:333, rate:0.187}` → `62.27` (PressurePro's own test value);
  custom flat `{sqft:1, rate:150}` → `150`.
- `parseLines`: round-trips a surface row + a custom row; drops a non-object;
  synthesizes `id`/`total` when missing; coerces string numbers.
- `catalogToLine`: surface item (`surface_type:"roof", mode:"soft",
  default_rate:0.4`) → surface line (sqft 1500, mode soft, total 600);
  no-`surface_type` item → custom flat line.
- `blankLine`: custom flat, sqft 1, rate 0.
- `describe`: surface line → `qty "1,500 sqft"`, `rate "$0.40"`,
  `detail "1,500 sqft × $0.40 · soft"`; custom line → `qty "1"`, `rate "—"`,
  `detail null`.
- Conformance: `pressureQuoteLine` satisfies `QuoteLineModule` (all 6 members).

## Testing gates

- `npx tsc --noEmit -p tsconfig.app.json` stays at the known 6-file baseline (no
  NEW file — `quote-line.tsx`/`.test.ts` are clean).
- `npm run build` (lawn) green. Full vitest suite green.

## Out of scope (1b)

- `seasonalRate()` add-time pricing bump — DEFERRED (needs season + user_settings
  not in `LineEditor` props). Logged as a parity gap alongside the weather
  washing-window; add later.
- Registering `pressureVertical` / any `QuoteForm` change (1e; QuoteForm already
  delegates).
- Catalog / `surface_pricing` wiring — the editor's rate lookup consumes whatever
  `catalog` prop 1c provides; 1b does not build the catalog module.
- Cost estimator (`estimateCostDefaults`), chemicals, Mix Calculator (1e shell).
- Any lawn behavior change.
