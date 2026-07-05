# Quote-line Display Seam (Phase 0c-1b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route all quote/invoice line *display* through the vertical's `describe(line)`, then loosen the shared `QuoteLine` type to opaque `{id, total, [k]: unknown}` so the compiler enforces that shared screens never read a trade-specific field — making a future pressure vertical render through the same screens unchanged.

**Architecture:** Enrich `LineDescription` to `{label, detail, qty, rate, amount}` so one `describe()` call drives both the 4-column print tables and the card lists. Harden `lawnParseLines` to absorb the legacy-shape handling the two public pages did locally. Migrate all 6 display consumers to `parseLines → describe`, deleting 6 local helpers + 2 loose type defs. Finally loosen the shared type and cast-narrow inside the lawn module (the only place that knows the concrete lawn shape).

**Tech Stack:** React + TypeScript + Vite + @tanstack/react-query + vitest.

## Global Constraints

- **Phase 0c-1b** of the multi-vertical platform (spec: `2026-07-05-quote-line-display-seam-design.md`).
- **Ordering is load-bearing:** enrich the contract + migrate ALL consumers to `describe()` FIRST (Tasks 1–3, type stays concrete → every task compiles), then loosen the type LAST (Task 4). Never leave a task with a red `tsc`/build.
- **Card subtitle rule = hide when `qty === 1`**: `detail = qty === 1 ? null : \`${qty} × ${rate}\``. This is a deliberate declutter of QuoteDetail/InvoiceDetail single-qty lines — NOT pixel-identical there. All other rendering stays visually identical for real lawn quotes.
- **One money formatter in the lawn module** (`fmtLawnMoney(n) = \`$${n.toFixed(2)}\``) drives both `describe().rate` and `describe().detail`, so the two never diverge. (Matches the print tables' existing `$${rate.toFixed(2)}`; visually identical to the card screens' `Intl` `fmtUSD` for any rate < $1000.)
- **`fmtUSD` stays at each consumer** for the `amount` (unchanged per-file `Intl.NumberFormat` currency formatter).
- **Out of scope:** the editor path (`QuoteForm`/`LineEditor`/`NewQuote`), the edge/Deno QBO mapping, and any pressure `quoteLine`. `convertHelpers.ts` is touched ONLY in Task 4 (a narrow boundary cast so it survives the loosened type).
- Base branch: `feature/quote-line-display-seam` (spec committed there). Commit trailers on every commit:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` /
  `Claude-Session: https://claude.ai/code/session_01QrF17kQNQsTPBTHee6C3br`.
- Verify tsc with the STRICT app config: `npx tsc --noEmit -p tsconfig.app.json` (the root `tsc --noEmit` does NOT type-check `src/` under `noUnusedLocals`). Tests: `npm test -- --run`. Build: `npm run build`.

---

### Task 1: Enrich the contract + lawn `describe`/`parseLines` + `types.ts` re-export

**Files:**
- Modify: `src/verticals/quote-line.ts` (enrich `LineDescription`)
- Modify: `src/verticals/lawn/quote-line.tsx` (`fmtLawnMoney`, hardened `lawnParseLines`, enriched `lawnDescribe`)
- Modify: `src/components/quotes/types.ts` (re-export `describe` + `LineDescription`)
- Modify (test): `src/verticals/lawn/quote-line.test.ts`

**Interfaces:**
- Produces (used by Tasks 2–4): `LineDescription = { label: string; detail: string | null; qty: string; rate: string; amount: number }`; `describe` re-exported from `@/components/quotes/types`; hardened `parseLines` that yields canonical lawn lines from legacy shapes. `QuoteLine` stays CONCRETE this task.

- [ ] **Step 1: Enrich `LineDescription` in the contract**

In `src/verticals/quote-line.ts`, replace the `LineDescription` interface (currently `{ label, detail, amount }`) with:

```ts
export interface LineDescription {
  label: string;          // service name — table "Service" col + card title
  detail: string | null;  // card subtitle: qty === 1 ? null : `${qty} × ${rate}`
  qty: string;            // table "Qty" col  — vertical-formatted (e.g. "3")
  rate: string;           // table "Rate" col — vertical-formatted ("$45.00" | "—")
  amount: number;         // line total — consumers format with their own fmtUSD
}
```

Leave `QuoteLine`, `CatalogItem`, `LineEditorProps`, `QuoteLineModule` unchanged. Update the file's top comment to note the loosening happens in the FINAL task of this slice, not here.

- [ ] **Step 2: Update the `describe` unit tests (they now expect 5 fields)**

In `src/verticals/lawn/quote-line.test.ts`, REPLACE the existing `describe(...)` test block (the `it("describe: qty 1 → no detail; qty>1 → 'N × $R'", ...)` case) with:

```ts
  it("describe: qty 1 → detail null but qty/rate/amount still populated", () => {
    expect(
      lawnQuoteLine.describe({ id: "a", name: "Mow", qty: 1, rate: 45, total: 45 }),
    ).toEqual({ label: "Mow", detail: null, qty: "1", rate: "$45.00", amount: 45 });
  });
  it("describe: qty > 1 → detail 'N × $R.RR' with formatted rate", () => {
    expect(
      lawnQuoteLine.describe({ id: "a", name: "Mow", qty: 3, rate: 45, total: 135 }),
    ).toEqual({
      label: "Mow",
      detail: "3 × $45.00",
      qty: "3",
      rate: "$45.00",
      amount: 135,
    });
  });
```

- [ ] **Step 3: Add tests for the hardened `parseLines` legacy branches**

In the same test file, inside the `describe("lawnQuoteLine", …)` block, ADD these cases (keep the existing `parseLines reads the standard shape`, `synthesizes … {sqft,rate}`, and `returns [] for non-array` tests — they still hold):

```ts
  it("parseLines names a custom line from its label", () => {
    expect(
      lawnQuoteLine.parseLines([{ id: "x", custom: true, label: "One-off wash", qty: 1, rate: 80, total: 80 }]),
    ).toEqual([
      { id: "x", catalog_item_id: undefined, name: "One-off wash", qty: 1, rate: 80, total: 80 },
    ]);
  });
  it("parseLines humanizes a legacy surface into the name", () => {
    expect(
      lawnQuoteLine.parseLines([{ surface: "front_walk", rate: 0.5, sqft: 200 }]),
    ).toEqual([
      { id: expect.any(String), name: "Front Walk", qty: 200, rate: 0.5, total: 100 },
    ]);
  });
  it("parseLines folds area_sqft into qty when there is no qty key", () => {
    expect(
      lawnQuoteLine.parseLines([{ label: "Deck", area_sqft: 150, rate: 2 }]),
    ).toEqual([
      { id: expect.any(String), name: "Deck", qty: 150, rate: 2, total: 300 },
    ]);
  });
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test -- --run quote-line`
Expected: FAIL — old `describe` returns only `{label, detail, amount}` (missing `qty`/`rate`, and detail is `"3 × $45"` not `"3 × $45.00"`); the new `parseLines` legacy cases fail (surface not humanized, `area_sqft` not folded).

- [ ] **Step 5: Implement `fmtLawnMoney`, hardened `lawnParseLines`, enriched `lawnDescribe`**

In `src/verticals/lawn/quote-line.tsx`, make three edits.

(a) After the existing `lawnLineTotal` function, add a money formatter and a surface humanizer:

```tsx
// One money formatter for both the rate column and the detail subtitle so they
// never diverge. `$${n.toFixed(2)}` matches the print tables' existing rate cell.
function fmtLawnMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

// "front_walk" → "Front Walk". Absorbs QuotePrint/Accept's local surface label logic.
function humanizeSurface(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Line name precedence — absorbs the legacy label/custom/surface fallbacks the
// public pages used to do in local `lineLabel` helpers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lineName(r: any): string {
  if (r.custom && typeof r.label === "string" && r.label) return r.label;
  if (typeof r.name === "string" && r.name) return r.name;
  if (typeof r.label === "string" && r.label) return r.label;
  if (typeof r.surface === "string" && r.surface) return humanizeSurface(r.surface);
  return "Service";
}
```

(b) REPLACE the entire `lawnParseLines` function with the hardened version (preserves the standard-shape `qty = Number(r.qty) || 0` behavior exactly; only enriches name resolution, the legacy trigger, and legacy `total` fidelity):

```tsx
function lawnParseLines(raw: unknown): QuoteLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((r: any): QuoteLine | null => {
      if (!r || typeof r !== "object") return null;
      // Legacy pressure-shaped rows carried area in sqft/area_sqft and no qty key.
      const isLegacy =
        (typeof r.sqft === "number" || typeof r.area_sqft === "number") &&
        !("qty" in r);
      if (isLegacy) {
        const qty = Number(r.area_sqft) || Number(r.sqft) || 0;
        const rate = Number(r.rate) || 0;
        return {
          id: typeof r.id === "string" ? r.id : crypto.randomUUID(),
          name: lineName(r),
          qty,
          rate,
          total: typeof r.total === "number" ? r.total : lawnLineTotal({ qty, rate }),
        };
      }
      const qty = Number(r.qty) || 0;
      const rate = Number(r.rate) || 0;
      return {
        id: typeof r.id === "string" ? r.id : crypto.randomUUID(),
        catalog_item_id:
          typeof r.catalog_item_id === "string" ? r.catalog_item_id : undefined,
        name: lineName(r),
        qty,
        rate,
        total: typeof r.total === "number" ? r.total : lawnLineTotal({ qty, rate }),
      };
    })
    .filter((l): l is QuoteLine => l !== null);
}
```

(c) REPLACE `lawnDescribe` with the enriched version:

```tsx
function lawnDescribe(l: QuoteLine): LineDescription {
  const qty = String(l.qty);
  const rate = typeof l.rate === "number" ? fmtLawnMoney(l.rate) : "—";
  return {
    label: l.name,
    detail: l.qty === 1 ? null : `${qty} × ${rate}`,
    qty,
    rate,
    amount: l.total,
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- --run quote-line`
Expected: PASS — all `lawnQuoteLine` cases green (updated `describe` + new `parseLines` legacy cases + the untouched standard/legacy/blank/catalog cases).

- [ ] **Step 7: Re-export `describe` + `LineDescription` from `types.ts`**

In `src/components/quotes/types.ts`, add the `describe` delegation and the `LineDescription` type re-export so consumers never import `@/vertical` directly (keeps the import graph identical to 0c-1a). The file becomes:

```ts
// Quote line items live in the `quotes.lines` JSONB column. The line SHAPE and
// its math/parse/describe are owned by the active vertical's quoteLine module (a
// trade quotes differently). quoteTotal (sums the denormalized .total) and
// defaultExpiresAt are vertical-agnostic and stay here.

import { vertical } from "@/vertical";
import type { QuoteLine } from "@/verticals/quote-line";

export type { QuoteLine, LineDescription } from "@/verticals/quote-line";

export const lineTotal = vertical.quoteLine.lineTotal;
export const parseLines = vertical.quoteLine.parseLines;
export const describe = vertical.quoteLine.describe;

export const quoteTotal = (lines: QuoteLine[]) =>
  Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100;

export const defaultExpiresAt = (days = 14) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
```

- [ ] **Step 8: Typecheck, build, full test suite**

Run: `npx tsc --noEmit -p tsconfig.app.json` (clean — no consumer touched yet, contract change is additive), then `npm run build` (succeeds), then `npm test -- --run` (full suite green).

- [ ] **Step 9: Commit**

```bash
git add src/verticals/quote-line.ts src/verticals/lawn/quote-line.tsx src/verticals/lawn/quote-line.test.ts src/components/quotes/types.ts
git commit -m "feat(platform): enrich describe() + harden lawn parseLines for the display seam"
```

---

### Task 2: Migrate the print tables (QuotePrint, InvoicePrint) to `describe()`

**Files:**
- Modify: `src/pages/QuotePrint.tsx`
- Modify: `src/pages/InvoicePrint.tsx`

**Interfaces:**
- Consumes: `parseLines`, `describe`, `quoteTotal` from `@/components/quotes/types`; `LineDescription` shape `{label, detail, qty, rate, amount}`.

- [ ] **Step 1: QuotePrint — imports, drop local type + helpers**

In `src/pages/QuotePrint.tsx`:
- Add import: `import { parseLines, describe, quoteTotal } from "@/components/quotes/types";`
- DELETE the local `interface QuoteLine { … }` block (the `id?/name?/label?/custom?/qty?/rate?/total?/area_sqft?/surface?/sqft?/mode?` interface).
- In `type PrintQuote`, change `lines: QuoteLine[];` to `lines: unknown;`.
- DELETE the four local helpers `lineLabel`, `lineQty`, `lineRate`, `lineAmount`.

- [ ] **Step 2: QuotePrint — parse once, total via `quoteTotal`**

Replace the `total` memo (the `const total = useMemo(() => { if (!q) return 0; … reduce(… lineAmount) }, [q]);` block) with a parsed-lines memo plus a total memo:

```tsx
  const lines = useMemo(() => (q ? parseLines(q.lines) : []), [q]);

  const total = useMemo(() => {
    if (!q) return 0;
    if (typeof q.total === "number" && q.total > 0) return q.total;
    return quoteTotal(lines);
  }, [q, lines]);
```

- [ ] **Step 3: QuotePrint — render rows via `describe`**

Replace the table-body map (`{(q.lines ?? []).map((l, i) => ( <tr …> … </tr> ))}`) with:

```tsx
              {lines.map((l, i) => {
                const d = describe(l);
                return (
                  <tr key={l.id ?? i}>
                    <td>
                      <div className="font-semibold">{d.label}</div>
                    </td>
                    <td style={{ textAlign: "right" }}>{d.qty}</td>
                    <td style={{ textAlign: "right" }}>{d.rate}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>
                      {fmtUSD(d.amount)}
                    </td>
                  </tr>
                );
              })}
```

(`fmtUSD` remains defined at the top of the file; the footer `Total` row still renders `{fmtUSD(total)}`, unchanged.)

- [ ] **Step 4: InvoicePrint — imports, drop local helpers**

In `src/pages/InvoicePrint.tsx`:
- Change the import `import { parseLines, type QuoteLine } from "@/components/quotes/types";` to `import { parseLines, describe, type QuoteLine } from "@/components/quotes/types";` (keep `QuoteLine` — the `lines` memo is typed `useMemo<QuoteLine[]>`).
- DELETE the local `lineQty` and `lineRate` helpers.

- [ ] **Step 5: InvoicePrint — render rows via `describe`**

Replace the table-body map (`{lines.map((l, i) => ( <tr …> … </tr> ))}`) with:

```tsx
              {lines.map((l, i) => {
                const d = describe(l);
                return (
                  <tr key={l.id ?? i}>
                    <td>
                      <div className="font-semibold">{d.label}</div>
                    </td>
                    <td style={{ textAlign: "right" }}>{d.qty}</td>
                    <td style={{ textAlign: "right" }}>{d.rate}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>
                      {fmtUSD(d.amount)}
                    </td>
                  </tr>
                );
              })}
```

(The `total` memo, `amountPaid`/`amountDue` footer rows, and `fmtUSD` are unchanged — they already use `l.total`-summed `total`, not per-line fields.)

- [ ] **Step 6: Typecheck, build, test**

Run: `npx tsc --noEmit -p tsconfig.app.json` (clean), then `npm run build` (succeeds), then `npm test -- --run` (green).

- [ ] **Step 7: Commit**

```bash
git add src/pages/QuotePrint.tsx src/pages/InvoicePrint.tsx
git commit -m "feat(platform): print tables render quote lines via vertical describe()"
```

---

### Task 3: Migrate the card lists (QuoteDetail, InvoiceDetail, InvoiceView, Accept) to `describe()`

**Files:**
- Modify: `src/pages/QuoteDetail.tsx`
- Modify: `src/pages/InvoiceDetail.tsx`
- Modify: `src/pages/InvoiceView.tsx`
- Modify: `src/pages/Accept.tsx`

**Interfaces:**
- Consumes: `parseLines`, `describe`, `quoteTotal` from `@/components/quotes/types`.

- [ ] **Step 1: QuoteDetail — import `describe`, render card via it**

In `src/pages/QuoteDetail.tsx`:
- Change `import { parseLines, quoteTotal, type QuoteLine } from "@/components/quotes/types";` to `import { parseLines, quoteTotal, describe, type QuoteLine } from "@/components/quotes/types";`.
- Replace the line-items map (`{lines.map((l) => ( <li key={l.id} …> … {l.name} … {l.qty} × {fmtUSD(l.rate)} … {fmtUSD(l.total)} … </li> ))}`) with:

```tsx
            {lines.map((l) => {
              const d = describe(l);
              return (
                <li key={l.id} className="tp-card p-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm text-neutral-900 truncate">
                      {d.label}
                    </div>
                    {d.detail && (
                      <div className="text-[11px] text-neutral-500 tp-num mt-0.5">
                        {d.detail}
                      </div>
                    )}
                  </div>
                  <div className="tp-num font-bold text-sm text-neutral-900 shrink-0">
                    {fmtUSD(d.amount)}
                  </div>
                </li>
              );
            })}
```

- [ ] **Step 2: InvoiceDetail — import `describe`, render card via it**

In `src/pages/InvoiceDetail.tsx`:
- Change `import { parseLines, type QuoteLine } from "@/components/quotes/types";` to `import { parseLines, describe, type QuoteLine } from "@/components/quotes/types";`.
- Replace the line-items map with:

```tsx
            {lines.map((l) => {
              const d = describe(l);
              return (
                <li key={l.id} className="tp-card p-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm text-neutral-900 truncate">
                      {d.label}
                    </div>
                    {d.detail && (
                      <div className="text-[11px] text-neutral-500 tp-num mt-0.5">
                        {d.detail}
                      </div>
                    )}
                  </div>
                  <div className="tp-num font-bold text-sm text-neutral-900 shrink-0">
                    {fmtUSD(d.amount)}
                  </div>
                </li>
              );
            })}
```

- [ ] **Step 3: InvoiceView — import `describe`, render card via it**

In `src/pages/InvoiceView.tsx`:
- Change `import { parseLines, type QuoteLine } from "@/components/quotes/types";` to `import { parseLines, describe, type QuoteLine } from "@/components/quotes/types";`.
- Replace the line-items map (`{lines.map((l, i) => ( <div …>{l.name}… {l.qty !== 1 && (…{l.qty} × {fmtUSD(l.rate)}…)} … {fmtUSD(l.total)} </div> ))}`) with:

```tsx
            {lines.map((l, i) => {
              const d = describe(l);
              return (
                <div
                  key={l.id ?? i}
                  className={
                    "flex items-center gap-2.5 p-3.5 " +
                    (i ? "border-t border-hairline" : "")
                  }
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm text-neutral-900">{d.label}</div>
                    {d.detail && (
                      <div className="text-[11px] text-muted-foreground mt-0.5 tp-num">
                        {d.detail}
                      </div>
                    )}
                  </div>
                  <span className="tp-num font-bold text-sm text-neutral-900">
                    {fmtUSD(d.amount)}
                  </span>
                </div>
              );
            })}
```

- [ ] **Step 4: Accept — imports, drop local type + helpers, parse lines**

In `src/pages/Accept.tsx`:
- Add import: `import { parseLines, describe, quoteTotal } from "@/components/quotes/types";`
- DELETE the local `interface QuoteLine { … }` block.
- In `interface PublicQuote`, change `lines: QuoteLine[];` to `lines: unknown;`.
- DELETE the three local helpers `lineLabel`, `lineSubtitle`, `lineAmount`.
- Replace `const lines = Array.isArray(q.lines) ? q.lines : [];` and `const computedTotal = lines.reduce((s, l) => s + lineAmount(l), 0);` with:

```tsx
  const lines = parseLines(q.lines);
  const computedTotal = quoteTotal(lines);
```

(The next line `const total = q.total ?? computedTotal;` stays unchanged.)

- [ ] **Step 5: Accept — render card via `describe`**

Replace the line-items map (`{lines.map((l, i) => { const subtitle = lineSubtitle(l); return ( <div …>{lineLabel(l)} … {subtitle && …} … {fmtUSD(lineAmount(l))} </div> ); })}`) with:

```tsx
            {lines.map((l, i) => {
              const d = describe(l);
              return (
                <div
                  key={l.id ?? i}
                  className={
                    "flex items-center gap-2.5 p-3.5 " +
                    (i ? "border-t border-hairline" : "")
                  }
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm text-neutral-900">{d.label}</div>
                    {d.detail && (
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {d.detail}
                      </div>
                    )}
                  </div>
                  <span className="tp-num font-bold text-sm text-neutral-900">
                    {fmtUSD(d.amount)}
                  </span>
                </div>
              );
            })}
```

(Note: Accept's multi-qty subtitle changes from `Qty N` / sqft to `N × $rate.RR`, and legacy sqft lines render as a plain qty — the deliberate normalization from the spec. Single-qty lines still show no subtitle. `fmtUSD` at the top of the file is unchanged.)

- [ ] **Step 6: Typecheck, build, test**

Run: `npx tsc --noEmit -p tsconfig.app.json` (clean), then `npm run build` (succeeds), then `npm test -- --run` (green).

- [ ] **Step 7: Commit**

```bash
git add src/pages/QuoteDetail.tsx src/pages/InvoiceDetail.tsx src/pages/InvoiceView.tsx src/pages/Accept.tsx
git commit -m "feat(platform): card list screens render quote lines via vertical describe()"
```

---

### Task 4: Loosen the shared `QuoteLine` type + cast-narrow inside the lawn module

**Files:**
- Modify: `src/verticals/quote-line.ts` (loosen `QuoteLine`)
- Modify: `src/verticals/lawn/quote-line.tsx` (private `LawnQuoteLine`, boundary casts in `describe`/`lineTotal`/`LineEditor`)
- Modify: `src/components/quotes/convertHelpers.ts` (narrow the reader's boundary)

**Interfaces:**
- Consumes: everything from Tasks 1–3 (all display consumers already route through `describe`).
- Produces: the enforced seam — `QuoteLine = { id: string; total: number; [key: string]: unknown }`. After this task, any shared file that reads `line.name`/`.qty`/`.rate` fails `tsc`.

- [ ] **Step 1: Loosen the shared `QuoteLine`**

In `src/verticals/quote-line.ts`, replace the concrete `QuoteLine` type with the opaque one:

```ts
// Shared line — OPAQUE to the shared core. Display consumers know only id+total;
// every trade-specific field is the active vertical's private shape, read for
// display only through describe(). The lawn module casts to its concrete
// LawnQuoteLine at its own boundary.
export interface QuoteLine {
  id: string;
  total: number;
  [key: string]: unknown;
}
```

(`CatalogItem`, `LineDescription`, `LineEditorProps`, `QuoteLineModule` are unchanged. `quoteTotal` in `types.ts` still compiles — it reads only `l.total`, which stays typed `number`.)

- [ ] **Step 2: Add the private concrete lawn line type + cast-narrow the readers**

In `src/verticals/lawn/quote-line.tsx`:

(a) Just below the contract-type import block, add the private concrete type (not exported):

```tsx
// The concrete lawn line. The shared QuoteLine is opaque; this module is the one
// place that knows the lawn shape, so it casts at its boundary (parse/build emit
// these as QuoteLine; the readers below cast back).
interface LawnQuoteLine extends QuoteLine {
  catalog_item_id?: string;
  name: string;
  qty: number;
  rate: number;
  total: number;
}
```

(b) Change the `lineTotal` wrapper and `describe` to cast the opaque param:

In the `lawnQuoteLine` module object, change `lineTotal: (l) => lawnLineTotal(l),` to:
```tsx
  lineTotal: (l) => lawnLineTotal(l as LawnQuoteLine),
```

Change the `lawnDescribe` signature body to cast once at the top:
```tsx
function lawnDescribe(line: QuoteLine): LineDescription {
  const l = line as LawnQuoteLine;
  const qty = String(l.qty);
  const rate = typeof l.rate === "number" ? fmtLawnMoney(l.rate) : "—";
  return {
    label: l.name,
    detail: l.qty === 1 ? null : `${qty} × ${rate}`,
    qty,
    rate,
    amount: l.total,
  };
}
```

- [ ] **Step 3: Cast-narrow the `LineEditor`**

In `src/verticals/lawn/quote-line.tsx`, the `LawnLineEditor` receives `lines: QuoteLine[]` (now opaque). Cast to the concrete rows at the top and type the update patch. Replace the top of `LawnLineEditor` (the destructure + the three handlers) with:

```tsx
function LawnLineEditor({ lines, catalog, onChange }: LineEditorProps) {
  const rows = lines as LawnQuoteLine[];
  const addCatalogLine = (item: CatalogItem) => onChange([...rows, lawnCatalogToLine(item)]);
  const addCustomLine = () => onChange([...rows, lawnBlankLine()]);
  const updateLine = (id: string, patch: Partial<LawnQuoteLine>) =>
    onChange(
      rows.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        next.total = lawnLineTotal(next);
        return next;
      }),
    );
  const removeLine = (id: string) => onChange(rows.filter((l) => l.id !== id));
```

Then, in the JSX further down, change the line-rows map `{lines.length > 0 && ( … {lines.map((l) => ( … )) } … )}` to iterate `rows` instead of `lines`:
- `{lines.length > 0 && (` → `{rows.length > 0 && (`
- `{lines.map((l) => (` → `{rows.map((l) => (`

(The inner row JSX — `l.name`, `l.qty`, `l.rate`, `l.total` — is unchanged; `l` is now `LawnQuoteLine`, so those reads type-check. `lawnBlankLine`/`lawnCatalogToLine` return `QuoteLine` literals that are assignable to `LawnQuoteLine` spreads via `rows`; `onChange` upcasts `LawnQuoteLine[]` → `QuoteLine[]` implicitly.)

- [ ] **Step 4: Narrow `convertHelpers` at its reader boundary**

In `src/components/quotes/convertHelpers.ts`, `deriveInitialLineItems` reads `l.name` / `l.rate` off `QuoteLine`, which are now `unknown`. Add a local narrow view and cast at the loop boundary. Replace the `deriveInitialLineItems` function body's loop with a cast:

Change the function to:
```ts
export function deriveInitialLineItems(lines: QuoteLine[]): PlanLineItem[] {
  // The shared QuoteLine is opaque; this transform reads only these lawn fields.
  type ConvertibleLine = { id: string; name?: string; rate?: number };
  const seen = new Set<string>();
  const out: PlanLineItem[] = [];
  for (const raw of lines) {
    const l = raw as ConvertibleLine;
    const name = l.name?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const oneTime = isOneTimeByDefault(name);
    out.push({
      id: l.id,
      name,
      rate: Number(l.rate) || 0,
      isRecurring: defaultIsRecurring(name),
      source: "quote",
      isOneTimeByDefault: oneTime,
    });
  }
  return out;
}
```

(Signature, callers, and all other functions in the file are unchanged.)

- [ ] **Step 5: Typecheck (the enforcement gate), build, test**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: CLEAN. This is the proof the seam holds — every display consumer routes through `describe`, and no shared file reads a trade-specific field off `QuoteLine`. If tsc reports a `TS2339`/`unknown`-not-assignable error in any `src/pages/*` or shared file, that file still reads `.name`/`.qty`/`.rate` directly — fix it to use `describe()` before proceeding (do NOT widen the type back).

Then `npm run build` (succeeds) and `npm test -- --run` (full suite green).

- [ ] **Step 6: Commit**

```bash
git add src/verticals/quote-line.ts src/verticals/lawn/quote-line.tsx src/components/quotes/convertHelpers.ts
git commit -m "feat(platform): loosen shared QuoteLine to opaque; enforce display via describe()"
```

---

## Human verification (deferred — after deploy)

Not an implementer task (needs the running app). Confirm the 6 screens render as expected:
- **QuotePrint / InvoicePrint** (print tables): Service / Qty / Rate / Amount columns identical to today for a normal lawn quote/invoice.
- **QuoteDetail / InvoiceDetail** (operator cards): single-qty lines NO LONGER show the `1 × $45.00` subtitle (the deliberate declutter); multi-qty lines show `N × $45.00`.
- **InvoiceView** (public pay page): unchanged (already hid the subtitle at qty 1).
- **Accept** (public accept page): multi-qty lines now show `N × $45.00` instead of `Qty N`; single-qty lines show no subtitle; totals unchanged.

## Notes for the implementer

- **Do not reorder the tasks.** Tasks 1–3 keep `QuoteLine` concrete so every consumer compiles as it migrates; Task 4's loosening is the final gate that PROVES the migration is complete. Loosening earlier makes Tasks 2–3 uncompilable.
- **`describe()` is imported from `@/components/quotes/types`**, never `@/vertical` — keep the import graph identical to 0c-1a.
- **`fmtUSD` stays per-file** for `amount`. `describe().rate`/`.detail` use the lawn module's `fmtLawnMoney` (`$${n.toFixed(2)}`). These are visually identical for rates < $1000.
- If Task 4's `tsc` flags a consumer you didn't expect, that's the seam working — route it through `describe()`; never re-widen `QuoteLine`.
- The `.tp-input` / print `<style>` blocks and all `fmtUSD` definitions stay where they are.
