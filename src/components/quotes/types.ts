// Local shape for line items inside the `quotes.lines` JSON column. TurfPro
// only writes this simple { qty, rate } per-visit shape; the public-facing
// Accept / Print pages (PressurePro-era) still read the older `sqft × rate ×
// mode` shape from the same column, but we don't need to author that here.

export type QuoteLine = {
  id: string;                 // uuid — stable React key
  catalog_item_id?: string;   // null for free-text custom rows
  name: string;               // display name
  qty: number;                // visits or units; usually 1 for one-offs
  rate: number;               // $ per unit
  total: number;              // qty * rate (kept on the row so legacy readers
                              // don't have to recompute)
};

export const lineTotal = (l: Pick<QuoteLine, "qty" | "rate">) =>
  Math.round(((l.qty ?? 0) * (l.rate ?? 0)) * 100) / 100;

export const quoteTotal = (lines: QuoteLine[]) =>
  Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100;

export const defaultExpiresAt = (days = 14) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

// Defensive parse from the `lines` JSON column. PressurePro rows may carry
// extra fields (sqft, mode, surface) we don't care about on the operator
// editor — we just keep the per-row id + name + qty + rate + total.
export function parseLines(raw: unknown): QuoteLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r: any) => {
      if (!r || typeof r !== "object") return null;
      // Legacy PressurePro line item — synthesize qty/rate from sqft × rate.
      const isLegacy = typeof r.sqft === "number" && typeof r.rate === "number" && !("qty" in r);
      if (isLegacy) {
        const qty = Number(r.sqft) || 0;
        const rate = Number(r.rate) || 0;
        return {
          id: typeof r.id === "string" ? r.id : crypto.randomUUID(),
          name: r.label ?? r.surface ?? "Line",
          qty,
          rate,
          total: lineTotal({ qty, rate }),
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
        total: typeof r.total === "number" ? r.total : lineTotal({ qty, rate }),
      } as QuoteLine;
    })
    .filter((l): l is QuoteLine => l !== null);
}
