# Phase 0c-1b — quote-line display seam (describe() + type loosening) design

Status: approved design, ready for implementation planning.
Date: 2026-07-05.

## Context

Part of the multi-vertical platform (spec:
`2026-07-04-multi-vertical-platform-design.md`). **Phase 0c-1a** (merged) added
the `vertical.quoteLine` seam, moved the lawn line math/parse/editor behind it,
and made `QuoteForm` delegate its editor — but deliberately kept the shared
`QuoteLine` type CONCRETE and left the ~6 display/print/public consumers reading
line fields directly. This slice (**0c-1b**) finishes the seam: it routes ALL
line *display* through the vertical's `describe(line)` and loosens the shared
line type so a future pressure vertical renders through the same screens
unchanged.

### What the audit established (the 6 display consumers)

Two rendering shapes:

- **Print tables** — 4-column `<table>`: **Service / Qty / Rate / Amount**.
  - `src/pages/QuotePrint.tsx` — local LOOSE `QuoteLine` interface (no import);
    local `lineLabel`/`lineQty`/`lineRate`/`lineAmount`; renders **raw `q.lines`**
    (does NOT call `parseLines`); public page.
  - `src/pages/InvoicePrint.tsx` — imports canonical `QuoteLine`, calls
    `parseLines` (useMemo); local `lineQty`/`lineRate`; `l.name`/`l.total` direct.
- **Card lists** — name (+ subtitle) / total.
  - `src/pages/QuoteDetail.tsx` — canonical, `parseLines` (useMemo), no helpers;
    subtitle `{l.qty} × {fmtUSD(l.rate)}` shown ALWAYS (even qty 1).
  - `src/pages/InvoiceDetail.tsx` — identical to QuoteDetail.
  - `src/pages/InvoiceView.tsx` — canonical, `parseLines` (inline); subtitle shown
    ONLY when `l.qty !== 1`; public pay page.
  - `src/pages/Accept.tsx` — local LOOSE `QuoteLine` interface; local
    `lineLabel`/`lineSubtitle`/`lineAmount`; renders **raw `q.lines`** (no
    `parseLines`); subtitle = sqft or `Qty N` when qty≠1; public accept page.

Non-renderers (out of scope, unchanged): `NewQuote.tsx` and `QuoteForm.tsx`
(delegate to the vertical's `LineEditor`), `convertHelpers.ts` /
`ConvertToPlanForm.tsx` (transform `QuoteLine[]` → `PlanLineItem[]`, read only
`name`/`id`/`rate`).

### The tension this slice resolves

The 0c-1a `describe()` returns `{label, detail, amount}` — perfect for card
lists, but the two print tables need **separate Qty and Rate columns**. And the
card subtitle has two variants today (Detail screens always show `1 × $45.00`;
InvoiceView hides it at qty 1). Both are settled below.

## Decisions

1. **Enrich `LineDescription`** to carry table columns as vertical-formatted
   strings, so one `describe()` call drives both layouts.
2. **Card subtitle rule = hide when `qty === 1`** (declutters QuoteDetail /
   InvoiceDetail single-qty lines; matches InvoiceView + the 0c-1a stub). A
   small, deliberate visual improvement — NOT pixel-identical on those two
   screens.
3. **`lawnParseLines` absorbs all legacy-shape handling** the public pages did
   locally, so post-parse every line is canonical and `describe()` is trivial.
4. **Loosen the shared `QuoteLine`** to opaque `{id, total, [k]: unknown}`; the
   lawn module keeps a private concrete `LawnQuoteLine`. The compiler now
   ENFORCES that shared code reads only `id`/`total` (any consumer reaching for
   `.name`/`.qty`/`.rate` fails `tsc`).
5. **Scope = full seam.** All 6 display consumers migrate; 6 local helpers + 2
   loose type defs are deleted. Editors (`QuoteForm`/`LineEditor`) and the
   transform path are untouched. Edge/Deno QBO mapping untouched.

## The enriched contract

`src/verticals/quote-line.ts`:

```ts
// Shared line — OPAQUE to the shared core. Display consumers know only id+total;
// every trade-specific field is the active vertical's private shape, read for
// display only through describe(). (0c-1a had this concrete; 0c-1b loosens it.)
export interface QuoteLine {
  id: string;
  total: number;
  [key: string]: unknown;
}

export interface LineDescription {
  label: string;          // service name — table "Service" col + card title
  detail: string | null;  // card subtitle: qty === 1 ? null : `${qty} × ${rate}`
  qty: string;            // table "Qty" col  — vertical-formatted
  rate: string;           // table "Rate" col — vertical-formatted ("$45.00" | "—")
  amount: number;         // line total — consumers format with their own fmtUSD
}
```

`QuoteLineModule` is unchanged in shape (`describe(line: QuoteLine):
LineDescription` already exists); only `LineDescription`'s fields grow and
`QuoteLine` loosens. `CatalogItem`/`LineEditorProps` unchanged.

## Architecture / mechanics

### Lawn module (`src/verticals/lawn/quote-line.tsx`)

- **Private concrete type** (not exported):
  ```ts
  interface LawnQuoteLine extends QuoteLine {
    catalog_item_id?: string;
    name: string;
    qty: number;
    rate: number;
    total: number;
  }
  ```
  (`name/qty/rate: number|string` are all assignable to the `[k]: unknown` index
  signature, so `LawnQuoteLine` is a valid subtype of `QuoteLine`.)
- `blankLine()`, `catalogToLine(item)`, `lawnParseLines(raw)` build
  `LawnQuoteLine` values and return them upcast to the contract's `QuoteLine` /
  `QuoteLine[]`. `lineTotal`, `describe`, and the `LineEditor` cast the incoming
  opaque `QuoteLine` down to `LawnQuoteLine` at the top of the function (a single
  `as LawnQuoteLine` at the boundary — the module owns the shape, so the cast is
  sound). `onChange` in the editor upcasts back to `QuoteLine[]`.
- **`fmtLawnMoney`** — a single module-local currency formatter
  (`` `$${n.toFixed(2)}` ``) used for both the `rate` column and the `detail`
  subtitle so they never diverge. (Uses `.toFixed(2)`, matching the print
  tables' existing `lineRate`; for the card screens this is visually identical to
  their `fmtUSD` for any rate < $1000 — thousands separators differ only above
  that, which lawn per-service rates never hit.)
- **`describe(l)`** (l cast to `LawnQuoteLine`):
  ```ts
  const qtyStr = String(l.qty);
  const rateStr = typeof l.rate === "number" ? fmtLawnMoney(l.rate) : "—";
  return {
    label: l.name,
    detail: l.qty === 1 ? null : `${qtyStr} × ${rateStr}`,
    qty: qtyStr,
    rate: rateStr,
    amount: l.total,
  };
  ```
- **`lawnParseLines(raw)` hardened** — for each row (defensive; non-array → `[]`):
  - `name` precedence (absorbs QuotePrint/Accept `lineLabel`):
    `custom && label` → `label` → `name` → title-cased `surface`
    (`surface.replace(/_/g," ").replace(/\b\w/g, c => c.toUpperCase())`) → `"Service"`.
  - `qty` = first numeric of `area_sqft`, `sqft`, `qty`, else `1`.
  - `rate` = numeric `rate` or `0`.
  - `total` = numeric `total`, else `lawnLineTotal({qty, rate})` (= `round(qty*rate)`).
  - `id` = string `id` or `crypto.randomUUID()`; `catalog_item_id` if string.
  The existing standard + `{sqft,rate}` legacy branches collapse into this single
  hardened mapping.

### Consumer migrations

Each display consumer imports `parseLines` and the vertical's `describe` (via
`vertical.quoteLine.describe`, or a thin re-export — see below) and renders from
`describe(line)`. `fmtUSD` stays at each call site for the `amount`.

- `QuotePrint.tsx`: delete the local `QuoteLine` interface and
  `lineLabel/lineQty/lineRate/lineAmount`; `const lines = parseLines(q.lines)`;
  per row render `d.label` / `d.qty` / `d.rate` / `fmtUSD(d.amount)` where
  `d = describe(l)`. The `total` memo keeps its existing precedence — prefer
  `q.total` when `> 0`, else `quoteTotal(lines)` (the canonical `.total` sum,
  which equals the old `sum(lineAmount)` now that lines are parsed).
- `InvoicePrint.tsx`: delete local `lineQty`/`lineRate`; render `d.qty`/`d.rate`/
  `d.label`/`fmtUSD(d.amount)` from `describe`.
- `Accept.tsx`: delete local interface + helpers; `const lines =
  parseLines(q.lines)`; card row = `d.label` + (`d.detail && <subtitle>`) +
  `fmtUSD(d.amount)`.
- `QuoteDetail.tsx` / `InvoiceDetail.tsx`: keep `parseLines`; card row swaps
  `{l.qty} × {fmtUSD(l.rate)}` for `{d.detail && <subtitle>{d.detail}</subtitle>}`
  and `fmtUSD(l.total)` → `fmtUSD(d.amount)`; title `d.label`.
- `InvoiceView.tsx`: keep `parseLines`; row = `d.label` + (`d.detail &&
  <subtitle>`) + `fmtUSD(d.amount)`. (Behavior already matches the new rule.)

**`describe` access.** Consumers import it as `describe` from
`@/components/quotes/types` (a new thin re-export
`export const describe = vertical.quoteLine.describe;` alongside the existing
`lineTotal`/`parseLines` delegations) so no page imports `@/vertical` directly and
the import graph stays identical to 0c-1a's. `types.ts` also re-exports the
`LineDescription` type.

## Testing

- **Unit (extend `src/verticals/lawn/quote-line.test.ts`):**
  - `describe`: returns all 5 fields; `qty===1 → detail null` + `qty`/`rate`/`amount`
    still populated; `qty>1 → detail "N × $R.RR"`; `rate` = `"$45.00"` when numeric,
    `"—"` when rate missing.
  - hardened `parseLines`: `custom&&label` uses `label`; bare `label` (no name)
    uses `label`; `surface: "front_walk"` → `"Front Walk"`; `area_sqft`/`sqft` →
    `qty`; standard `{name,qty,rate,total}` unchanged; non-array → `[]`.
- **Types:** `npx tsc --noEmit -p tsconfig.app.json` clean — and this now proves
  enforcement: temporarily reading `line.name` in a shared consumer would fail.
- **Build:** `npm run build` succeeds.
- **Vitest:** full suite green.
- **Manual (deferred, human):** the 6 screens render identically to today, except
  QuoteDetail/InvoiceDetail no longer show the `1 × $45.00` subtitle on single-qty
  lines (the deliberate declutter).

## Out of scope (0c-1b)

- The editor path (`QuoteForm`, `LineEditor`, `NewQuote`) — already delegated.
- The transform path (`convertHelpers`, `ConvertToPlanForm`) — reads only
  `name`/`id`/`rate`; it keeps a narrow local view (it may cast `QuoteLine` to a
  `{name?; id; rate?}` shape) but is not part of the display seam.
- The edge/Deno QBO mapping (already per-vertical).
- Any pressure `quoteLine`/`describe` — Phase 1. (This slice is what makes that a
  config-only addition: pressure implements `describe` + `parseLines`, and all 6
  screens render it with zero changes.)
- Catalog/calculators/plans/weather/campaign seams (0c-2 … 0c-6).
