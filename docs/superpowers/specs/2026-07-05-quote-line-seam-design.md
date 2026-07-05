# Phase 0c-1a — quote-line seam (contract + lawn impl + QuoteForm) design

Status: approved design, ready for implementation planning.
Date: 2026-07-05.

## Context

Part of the multi-vertical platform (spec:
`2026-07-04-multi-vertical-platform-design.md`). **Phase 0c** extracts the lawn
domain behind the `Vertical` contract, decomposed into sub-slices, in order:
1. **0c-1 quote-line seam** (this — the keystone, highest blast radius), split into
   **0c-1a** (contract + lawn `quoteLine` + `QuoteForm` builder — THIS spec) and
   **0c-1b** (refactor the display/print/public consumers to `describe()` + loosen
   the shared line type).
2. 0c-2 catalog seed + editor config
3. 0c-3 `extraRoutes` composition + calculators (ApplicationCalc/ChemicalLog, RouteMode/Routes)
4. 0c-4 plan-cadence seam
5. 0c-5 weather/GDD/season seam
6. 0c-6 campaign templates + property fields + copy

### What the audit established
- Line shape (`src/components/quotes/types.ts`): `QuoteLine = { id; catalog_item_id?;
  name; qty; rate; total }`. Pure fns: `lineTotal(l)`, `quoteTotal(lines)` (sums
  the denormalized `.total`), `parseLines(raw)` (handles the legacy PressurePro
  `{sqft,rate}` shape), `defaultExpiresAt(days)`.
- Editor (`src/components/quotes/QuoteForm.tsx`, 572 lines): owns the
  `catalog_items` query (`app=APP_ID, kind="service", archived=false`), and the
  inline line factories `addCatalogLine`/`addCustomLine`/`updateLine`. Lawn-shaped
  (Qty/Rate columns, "Custom service").
- 9 consumers of the line shape; `QuotePrint` and `Accept` re-implement dual-shape
  parsing locally (an existing duplication smell — cleaned in 0c-1b).
- QBO mapping (`_shared/quickbooks-map.ts`) is already per-vertical
  (`buildInvoiceLines` lawn / `buildQuoteInvoiceLine` pressure), dispatched by op
  in `quickbooks-sync`. **Edge side is out of scope here** — already correct.

## Decisions

1. **Add `quoteLine` to the `Vertical` contract** — the seam the shared core reads
   for everything trade-specific about quote lines.
2. **0c-1a keeps the shared `QuoteLine` type CONCRETE (lawn shape)** so the 9 display
   consumers still compile unchanged. `describe()` is implemented + tested now but
   consumers adopt it — and the type loosens to opaque `{id, total, [k]: unknown}` —
   in **0c-1b**. This keeps each slice behavior-identical and shippable.
3. **Behavior-identical**: pure relocation of lawn logic behind the contract. TurfPro
   builds/edits/totals quotes identically.
4. **Client seam only.** The Deno/edge QBO mapping stays as-is.

## The contract

New file `src/verticals/quote-line.ts` (contract types — imported by both the
contract and the lawn impl, so there is no cycle back to `components/quotes/types.ts`):

```ts
export type QuoteLine = {
  id: string;
  catalog_item_id?: string;
  name: string;
  qty: number;
  rate: number;
  total: number;
};  // 0c-1a: concrete lawn shape. 0c-1b loosens to { id; total; [k:string]: unknown }.

export interface CatalogItem { id: string; name: string; default_rate: number | null;
  surface_type?: string | null; mode?: string | null; }

export interface LineDescription { label: string; detail: string | null; amount: number; }

export interface QuoteLineModule {
  /** The catalog `kind` this vertical's services use in the catalog_items query. */
  catalogKindFilter: string;
  /** A fresh empty custom line. */
  blankLine(): QuoteLine;
  /** Build a line from a catalog item chip. */
  catalogToLine(item: CatalogItem): QuoteLine;
  /** Per-line total (recomputed on every edit). */
  lineTotal(line: QuoteLine): number;
  /** Defensive parse of the JSONB `lines` column into this vertical's lines. */
  parseLines(raw: unknown): QuoteLine[];
  /** Display-ready view of a line (for print / public / detail rendering — used in 0c-1b). */
  describe(line: QuoteLine): LineDescription;
  /** The line-items editor section (catalog chips + editable rows). */
  LineEditor: React.ComponentType<LineEditorProps>;
}

export interface LineEditorProps {
  lines: QuoteLine[];
  catalog: CatalogItem[];
  onChange: (lines: QuoteLine[]) => void;
}
```

The `Vertical` interface (`src/verticals/types.ts`) gains `quoteLine: QuoteLineModule`.

## Architecture / mechanics

- **`src/verticals/lawn/quote-line.tsx`** — `export const lawnQuoteLine: QuoteLineModule`.
  Holds the current lawn logic, relocated verbatim:
  - `catalogKindFilter: "service"`.
  - `blankLine()` = `{ id: uuid, name: "Custom service", qty: 1, rate: 0, total: 0 }`.
  - `catalogToLine(item)` = `{ id: uuid, catalog_item_id: item.id, name: item.name,
    qty: 1, rate: item.default_rate ?? 0, total: item.default_rate ?? 0 }`.
  - `lineTotal(l)` = the current `types.ts` implementation (`round(qty*rate)`).
  - `parseLines(raw)` = the current `types.ts` implementation (incl. legacy branch).
  - `describe(l)` = `{ label: l.name, detail: l.qty === 1 ? null : \`${l.qty} × $${l.rate}\`, amount: l.total }`.
  - `LineEditor` = the catalog-chip picker + line-row list extracted from
    `QuoteForm.tsx` (Qty/Rate/Total fields, add-custom button), calling `onChange`.
- **`src/verticals/lawn/index.ts`** — add `quoteLine: lawnQuoteLine` to `lawnVertical`.
- **`src/components/quotes/types.ts`** — `lineTotal` and `parseLines` become
  re-exports of `vertical.quoteLine.lineTotal` / `.parseLines` (delegation; the 9
  consumers' imports are unchanged). `quoteTotal` and `defaultExpiresAt` stay
  shared. Re-export the `QuoteLine` type from `@/verticals/quote-line` (so
  `import { QuoteLine } from "@/components/quotes/types"` keeps working). Avoids the
  cycle: `types.ts → @/vertical → registry → lawn → lawn/quote-line → @/verticals/quote-line`
  (which imports nothing from `types.ts`).
- **`src/components/quotes/QuoteForm.tsx`** — remove the inline `addCatalogLine`/
  `addCustomLine`/`updateLine` and the line-items JSX; render
  `<vertical.quoteLine.LineEditor lines={lines} catalog={catalog} onChange={setLines} />`
  in that slot. Use `vertical.quoteLine.catalogKindFilter` in the `catalog_items`
  query. Keep the customer/property/deposit/notes/expiry sections and the total
  summary (`quoteTotal(lines)`) in `QuoteForm`.

## Testing

- **Unit (vitest)** the lawn `quoteLine` pure fns: `lineTotal` (round), `parseLines`
  (standard + legacy `{sqft,rate}` branches), `blankLine` (shape), `catalogToLine`
  (maps id/name/rate), `describe` (qty=1 → no detail; qty>1 → "N × $R"). These move
  the existing `types.ts` behavior under test.
- **Build + tsc**: green; `QuoteForm` compiles with the delegated editor.
- **Manual (deferred, human)**: NewQuote / edit a quote — catalog chips add lines,
  custom line adds, qty/rate edits recompute total, deposit math unchanged. Identical
  to today.

## Out of scope (0c-1a)

- Refactoring the 9 display consumers to `describe()` and loosening the shared
  `QuoteLine` type — that is **0c-1b**.
- The edge/Deno QBO mapping (already per-vertical).
- Catalog seed / editor config (0c-2), calculators/routes (0c-3), plans (0c-4),
  weather (0c-5), campaigns/property (0c-6).
- Any pressure-washing `quoteLine` — added in Phase 1 (which is when the concrete
  `QuoteLine` type gets its pressure sibling; 0c-1b's loosening enables that).
