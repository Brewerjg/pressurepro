# Quote-line Seam (Phase 0c-1a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `vertical.quoteLine` seam, implement it for lawn (relocating the existing logic), and make `QuoteForm` delegate its line-editor section — behavior-identical for TurfPro.

**Architecture:** New `src/verticals/quote-line.ts` contract; `src/verticals/lawn/quote-line.tsx` implements it (pure math/parse + a `LineEditor` component extracted from `QuoteForm`); shared `Section`/`Field` move to `src/components/quotes/FormSection.tsx`; `components/quotes/types.ts` delegates `lineTotal`/`parseLines` to the active vertical; `QuoteForm` renders `vertical.quoteLine.LineEditor`.

**Tech Stack:** React + TypeScript + Vite + @tanstack/react-query + vitest.

## Global Constraints

- **Phase 0c-1a** of the multi-vertical platform (spec: `2026-07-05-quote-line-seam-design.md`). Scope: the contract + lawn impl + `QuoteForm` delegation. The 9-consumer `describe()` refactor + type-loosening is **0c-1b** — NOT here.
- **Behavior-identical:** TurfPro builds/edits/totals/renders quotes exactly as before. This is a relocation, not a redesign.
- **Keep the concrete `QuoteLine` type** (`{id, catalog_item_id?, name, qty, rate, total}`) this slice; it loosens in 0c-1b.
- Import graph (no cycle): `components/quotes/types.ts → @/vertical → registry → lawn → lawn/quote-line → {@/verticals/quote-line, @/components/quotes/FormSection}`. `@/verticals/quote-line` and `FormSection` import nothing from `components/quotes/types.ts`.
- Base branch: `feature/quote-line-seam` (spec committed there). Commit trailers: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01QrF17kQNQsTPBTHee6C3br`.

---

### Task 1: Contract + FormSection + lawn quoteLine + delegation

**Files:**
- Create: `src/verticals/quote-line.ts`
- Create: `src/components/quotes/FormSection.tsx`
- Create: `src/verticals/lawn/quote-line.tsx`
- Create (test): `src/verticals/lawn/quote-line.test.ts`
- Modify: `src/verticals/types.ts` (add `quoteLine` to `Vertical`)
- Modify: `src/verticals/lawn/index.ts` (register `quoteLine`)
- Modify: `src/components/quotes/types.ts` (delegate `lineTotal`/`parseLines`)

**Interfaces:**
- Produces (used by Task 2 + later slices): `QuoteLine`, `CatalogItem`, `LineDescription`, `LineEditorProps`, `QuoteLineModule` (`@/verticals/quote-line`); `Section`, `Field` (`@/components/quotes/FormSection`); `lawnQuoteLine` (`@/verticals/lawn/quote-line`); `vertical.quoteLine` (via `@/vertical`).

- [ ] **Step 1: Create the contract types**

Create `src/verticals/quote-line.ts`:

```ts
import type { ComponentType } from "react";

// The quote-line seam — everything trade-specific about a quote's line items.
// 0c-1a: concrete lawn QuoteLine shape. 0c-1b loosens it to { id; total; [k]: unknown }
// and refactors display consumers to describe().

export type QuoteLine = {
  id: string;
  catalog_item_id?: string;
  name: string;
  qty: number;
  rate: number;
  total: number;
};

export interface CatalogItem {
  id: string;
  name: string;
  default_rate: number | null;
  surface_type?: string | null;
  mode?: string | null;
}

export interface LineDescription {
  label: string;
  detail: string | null;
  amount: number;
}

export interface LineEditorProps {
  lines: QuoteLine[];
  catalog: CatalogItem[];
  onChange: (lines: QuoteLine[]) => void;
}

export interface QuoteLineModule {
  /** The `kind` value this vertical's services use in the catalog_items query. */
  catalogKindFilter: string;
  /** A fresh empty custom line. */
  blankLine(): QuoteLine;
  /** Build a line from a catalog item. */
  catalogToLine(item: CatalogItem): QuoteLine;
  /** Per-line total (recomputed on every edit). */
  lineTotal(line: QuoteLine): number;
  /** Defensive parse of the JSONB `lines` column into this vertical's lines. */
  parseLines(raw: unknown): QuoteLine[];
  /** Display-ready view of a line (adopted by consumers in 0c-1b). */
  describe(line: QuoteLine): LineDescription;
  /** The line-items editor section (catalog chips + editable rows). */
  LineEditor: ComponentType<LineEditorProps>;
}
```

- [ ] **Step 2: Add `quoteLine` to the `Vertical` contract**

In `src/verticals/types.ts`, add the import and the field:
```ts
import type { QuoteLineModule } from "./quote-line";
```
and inside `interface Vertical { … }`, after `brand: {...}`:
```ts
  quoteLine: QuoteLineModule;
```

- [ ] **Step 3: Extract `Section` + `Field` to a shared module**

Create `src/components/quotes/FormSection.tsx` (copied verbatim from the definitions currently at the bottom of `QuoteForm.tsx`):

```tsx
import type { ReactNode } from "react";

// Shared quote-form primitives: a titled card section and a labelled field.
// Used by QuoteForm and by each vertical's quote-line LineEditor.
export function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="tp-card p-4 space-y-3">
      <div>
        <h2 className="text-[14px] font-semibold text-neutral-900">{title}</h2>
        {subtitle && (
          <p className="text-[11.5px] text-neutral-500 mt-0.5 leading-snug">
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[10.5px] font-bold uppercase tracking-[0.4px] text-neutral-500">
        {label}
      </span>
      {children}
    </label>
  );
}
```

- [ ] **Step 4: Write the lawn quoteLine test (TDD)**

Create `src/verticals/lawn/quote-line.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { lawnQuoteLine } from "@/verticals/lawn/quote-line";

describe("lawnQuoteLine", () => {
  it("catalogKindFilter is 'service'", () => {
    expect(lawnQuoteLine.catalogKindFilter).toBe("service");
  });
  it("blankLine returns a zeroed custom line with a uuid", () => {
    const l = lawnQuoteLine.blankLine();
    expect(l).toMatchObject({ name: "Custom service", qty: 1, rate: 0, total: 0 });
    expect(typeof l.id).toBe("string");
  });
  it("catalogToLine maps id/name/rate and defaults null rate to 0", () => {
    expect(lawnQuoteLine.catalogToLine({ id: "c1", name: "Mow", default_rate: 45 }))
      .toMatchObject({ catalog_item_id: "c1", name: "Mow", qty: 1, rate: 45, total: 45 });
    expect(lawnQuoteLine.catalogToLine({ id: "c2", name: "X", default_rate: null }))
      .toMatchObject({ rate: 0, total: 0 });
  });
  it("lineTotal rounds qty*rate to cents", () => {
    expect(lawnQuoteLine.lineTotal({ id: "a", name: "n", qty: 3, rate: 12.5, total: 0 })).toBe(37.5);
  });
  it("parseLines reads the standard shape", () => {
    expect(lawnQuoteLine.parseLines([{ id: "a", name: "Mow", qty: 2, rate: 45, total: 90 }]))
      .toEqual([{ id: "a", catalog_item_id: undefined, name: "Mow", qty: 2, rate: 45, total: 90 }]);
  });
  it("parseLines synthesizes qty/rate/total from a legacy {sqft,rate} row", () => {
    expect(lawnQuoteLine.parseLines([{ label: "Driveway", sqft: 100, rate: 0.5 }]))
      .toEqual([{ id: expect.any(String), name: "Driveway", qty: 100, rate: 0.5, total: 50 }]);
  });
  it("parseLines returns [] for non-array input", () => {
    expect(lawnQuoteLine.parseLines(null)).toEqual([]);
  });
  it("describe: qty 1 → no detail; qty>1 → 'N × $R'", () => {
    expect(lawnQuoteLine.describe({ id: "a", name: "Mow", qty: 1, rate: 45, total: 45 }))
      .toEqual({ label: "Mow", detail: null, amount: 45 });
    expect(lawnQuoteLine.describe({ id: "a", name: "Mow", qty: 3, rate: 45, total: 135 }))
      .toEqual({ label: "Mow", detail: "3 × $45", amount: 135 });
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test -- quote-line`
Expected: FAIL — `@/verticals/lawn/quote-line` does not exist yet.

- [ ] **Step 6: Implement the lawn quoteLine module**

Create `src/verticals/lawn/quote-line.tsx`:

```tsx
import { Plus, Trash2 } from "lucide-react";
import type {
  QuoteLine,
  CatalogItem,
  LineDescription,
  LineEditorProps,
  QuoteLineModule,
} from "@/verticals/quote-line";
import { Section, Field } from "@/components/quotes/FormSection";

// Lawn line math/parse — relocated verbatim from src/components/quotes/types.ts.
function lawnLineTotal(l: { qty: number; rate: number }): number {
  return Math.round((l.qty ?? 0) * (l.rate ?? 0) * 100) / 100;
}

function lawnParseLines(raw: unknown): QuoteLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((r: any) => {
      if (!r || typeof r !== "object") return null;
      const isLegacy =
        typeof r.sqft === "number" && typeof r.rate === "number" && !("qty" in r);
      if (isLegacy) {
        const qty = Number(r.sqft) || 0;
        const rate = Number(r.rate) || 0;
        return {
          id: typeof r.id === "string" ? r.id : crypto.randomUUID(),
          name: r.label ?? r.surface ?? "Line",
          qty,
          rate,
          total: lawnLineTotal({ qty, rate }),
        } as QuoteLine;
      }
      const qty = Number(r.qty) || 0;
      const rate = Number(r.rate) || 0;
      return {
        id: typeof r.id === "string" ? r.id : crypto.randomUUID(),
        catalog_item_id:
          typeof r.catalog_item_id === "string" ? r.catalog_item_id : undefined,
        name: typeof r.name === "string" ? r.name : "Line",
        qty,
        rate,
        total: typeof r.total === "number" ? r.total : lawnLineTotal({ qty, rate }),
      } as QuoteLine;
    })
    .filter((l): l is QuoteLine => l !== null);
}

function lawnBlankLine(): QuoteLine {
  return { id: crypto.randomUUID(), name: "Custom service", qty: 1, rate: 0, total: 0 };
}

function lawnCatalogToLine(item: CatalogItem): QuoteLine {
  const rate = Number(item.default_rate ?? 0);
  return { id: crypto.randomUUID(), catalog_item_id: item.id, name: item.name, qty: 1, rate, total: rate };
}

function lawnDescribe(l: QuoteLine): LineDescription {
  return { label: l.name, detail: l.qty === 1 ? null : `${l.qty} × $${l.rate}`, amount: l.total };
}

function LawnLineEditor({ lines, catalog, onChange }: LineEditorProps) {
  const addCatalogLine = (item: CatalogItem) => onChange([...lines, lawnCatalogToLine(item)]);
  const addCustomLine = () => onChange([...lines, lawnBlankLine()]);
  const updateLine = (id: string, patch: Partial<QuoteLine>) =>
    onChange(
      lines.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        next.total = lawnLineTotal(next);
        return next;
      }),
    );
  const removeLine = (id: string) => onChange(lines.filter((l) => l.id !== id));

  return (
    <Section
      title="Line items"
      subtitle="Pick from your service catalog or add a custom row. Most one-offs are a single flat-fee line."
    >
      {catalog && catalog.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {catalog.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => addCatalogLine(item)}
              className="px-3 py-1.5 rounded-full text-[12px] font-semibold border border-neutral-200 bg-card text-neutral-700 hover:border-brand-700 transition-colors inline-flex items-center gap-1"
            >
              <Plus className="h-3 w-3" strokeWidth={2.4} />
              {item.name}
              {item.default_rate ? (
                <span className="text-neutral-500 ml-0.5 tp-num">
                  ${Number(item.default_rate).toFixed(0)}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-neutral-500">
          No services in your catalog yet — add some under Settings, or just add a
          custom line below.
        </p>
      )}

      <button
        type="button"
        onClick={addCustomLine}
        className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-neutral-200 py-2 text-[12px] font-semibold text-neutral-700 hover:bg-neutral-100 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
        Add custom line
      </button>

      {lines.length > 0 && (
        <ul className="space-y-2 pt-1">
          {lines.map((l) => (
            <li key={l.id} className="rounded-xl border border-neutral-200 bg-card p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  value={l.name}
                  onChange={(e) => updateLine(l.id, { name: e.target.value })}
                  placeholder="Line item name"
                  className="tp-input flex-1 font-semibold"
                />
                <button
                  type="button"
                  onClick={() => removeLine(l.id)}
                  className="h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10 flex items-center justify-center"
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Qty">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.5"
                    value={l.qty}
                    onChange={(e) => updateLine(l.id, { qty: Number(e.target.value) || 0 })}
                    className="tp-input"
                  />
                </Field>
                <Field label="Rate ($)">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={l.rate}
                    onChange={(e) => updateLine(l.id, { rate: Number(e.target.value) || 0 })}
                    className="tp-input"
                  />
                </Field>
                <Field label="Total">
                  <div className="tp-input bg-neutral-100 text-neutral-700 font-semibold tp-num">
                    ${l.total.toFixed(2)}
                  </div>
                </Field>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export const lawnQuoteLine: QuoteLineModule = {
  catalogKindFilter: "service",
  blankLine: lawnBlankLine,
  catalogToLine: lawnCatalogToLine,
  lineTotal: (l) => lawnLineTotal(l),
  parseLines: lawnParseLines,
  describe: lawnDescribe,
  LineEditor: LawnLineEditor,
};
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- quote-line`
Expected: PASS — all lawnQuoteLine cases green.

- [ ] **Step 8: Register `quoteLine` on the lawn vertical**

In `src/verticals/lawn/index.ts`, import and add the field:
```ts
import { lawnQuoteLine } from "./quote-line";
```
and inside `lawnVertical`, add:
```ts
  quoteLine: lawnQuoteLine,
```

- [ ] **Step 9: Delegate `lineTotal`/`parseLines` from `components/quotes/types.ts`**

Replace `src/components/quotes/types.ts` with:

```ts
// Quote line items live in the `quotes.lines` JSONB column. The line SHAPE and
// its math/parse are owned by the active vertical's quoteLine module (a trade
// quotes differently). quoteTotal (sums the denormalized .total) and
// defaultExpiresAt are vertical-agnostic and stay here.

import { vertical } from "@/vertical";
import type { QuoteLine } from "@/verticals/quote-line";

export type { QuoteLine } from "@/verticals/quote-line";

export const lineTotal = vertical.quoteLine.lineTotal;
export const parseLines = vertical.quoteLine.parseLines;

export const quoteTotal = (lines: QuoteLine[]) =>
  Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100;

export const defaultExpiresAt = (days = 14) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
```

- [ ] **Step 10: Typecheck, build, test (behavior-identical guard)**

Run: `npx tsc --noEmit` (clean — all `types.ts` importers still resolve `lineTotal`/`parseLines`/`quoteTotal`/`QuoteLine`), then `npm run build` (succeeds), then `npm test` (full suite green incl. the new quote-line test).

- [ ] **Step 11: Commit**

```bash
git add src/verticals src/components/quotes/FormSection.tsx src/components/quotes/types.ts
git commit -m "feat(platform): quoteLine contract + lawn impl + delegated line math"
```

---

### Task 2: QuoteForm delegates its line-editor section

**Files:**
- Modify: `src/components/quotes/QuoteForm.tsx`

**Interfaces:**
- Consumes: `vertical` (`@/vertical`), `Section`/`Field` (`@/components/quotes/FormSection`), `vertical.quoteLine.LineEditor` + `.catalogKindFilter`.

- [ ] **Step 1: Swap imports**

In `src/components/quotes/QuoteForm.tsx`:
- Add: `import { vertical } from "@/vertical";` and `import { Section, Field } from "@/components/quotes/FormSection";`
- Remove the now-unused lucide icons `Plus` and `Trash2` from the `lucide-react` import (they moved into `LineEditor`). Keep `Loader2, Save, Send, X`.
- The `QuoteLine`, `lineTotal`, `quoteTotal`, `defaultExpiresAt` imports from `./types` stay (types.ts still exports them).

- [ ] **Step 2: Use the vertical's catalog `kind` filter**

In the `catalog_items` query, change `.eq("kind", "service")` to `.eq("kind", vertical.quoteLine.catalogKindFilter)`.

- [ ] **Step 3: Delete the inline line factories**

Remove the four handlers now living in `LineEditor`: `addCatalogLine`, `addCustomLine`, `updateLine`, `removeLine`. (The `const [lines, setLines] = useState<QuoteLine[]>(...)` and `const total = useMemo(() => quoteTotal(lines), [lines])` STAY — `QuoteForm` still owns the lines state + total.)

- [ ] **Step 4: Replace the line-items JSX with the delegated editor**

Replace the entire `{/* Line items */} <Section title="Line items" subtitle="…"> … </Section>` block with:
```tsx
      {/* Line items — delegated to the active vertical */}
      <vertical.quoteLine.LineEditor
        lines={lines}
        catalog={catalog ?? []}
        onChange={setLines}
      />
```

- [ ] **Step 5: Remove the local `Section` / `Field` definitions**

Delete the `function Section({…}) {…}` and `function Field({…}) {…}` declarations at the bottom of `QuoteForm.tsx` (now imported from `FormSection`). The remaining `<Section …>` / `<Field …>` usages elsewhere in `QuoteForm` (customer, property, deposit, notes sections) now resolve to the imported versions — identical markup.

- [ ] **Step 6: Typecheck, build, test**

Run: `npx tsc --noEmit` (clean — no unused symbols, `LineEditor` renders), then `npm run build` (succeeds), then `npm test` (green).

- [ ] **Step 7: Commit**

```bash
git add src/components/quotes/QuoteForm.tsx
git commit -m "feat(platform): QuoteForm delegates line-editor to vertical.quoteLine.LineEditor"
```

---

## Human verification (deferred — after deploy)

Not an implementer task (needs the running app): NewQuote and edit-a-quote — catalog chips add lines, "Add custom line" adds a blank row, editing Qty/Rate recomputes the row Total and the summary total, deposit math is unchanged. Identical to today.

## Notes for the implementer

- Behavior-identical: the lawn `LineEditor` markup + factories are copied verbatim from `QuoteForm`. If a quote renders or totals differently, you changed something — stop and report.
- The `.tp-input` styles come from the `<style>` block still inside `QuoteForm` (global injection); `LineEditor` renders inside the same `<form>`, so its `.tp-input` inputs stay styled. Do not move that style block.
- Do NOT loosen the `QuoteLine` type or touch the 9 display consumers — that's 0c-1b.
- If `tsc` flags a consumer that called `lineTotal` with a partial (not a full `QuoteLine`), report it — the contract's `lineTotal(line: QuoteLine)` takes a full line; `QuoteForm.updateLine` passes a full line, so this is not expected.
