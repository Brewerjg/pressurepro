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

function lawnBlankLine(): QuoteLine {
  return { id: crypto.randomUUID(), name: "Custom service", qty: 1, rate: 0, total: 0 };
}

function lawnCatalogToLine(item: CatalogItem): QuoteLine {
  const rate = Number(item.default_rate ?? 0);
  return { id: crypto.randomUUID(), catalog_item_id: item.id, name: item.name, qty: 1, rate, total: rate };
}

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
