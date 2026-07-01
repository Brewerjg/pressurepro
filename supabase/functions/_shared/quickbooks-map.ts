// quickbooks-map.ts
//
// PURE mapping helpers: TurfPro invoice data → QuickBooks Online request
// payloads. No Deno APIs, no remote imports, no network — so this module is
// unit-testable with vitest (see quickbooks-map.test.ts) and importable from
// the Deno `quickbooks-sync` edge function alike.

/** Normalized TurfPro line: what the mapper needs from invoices.lines. */
export interface ParsedLine {
  name: string;
  qty: number;
  rate: number;
  total: number;
}

/** A single QBO Invoice.Line (SalesItemLineDetail). */
export interface QboInvoiceLine {
  Amount: number;
  DetailType: "SalesItemLineDetail";
  Description: string;
  SalesItemLineDetail: {
    ItemRef: { value: string };
    Qty: number;
    UnitPrice: number;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Defensive parse of the invoices.lines JSONB into ParsedLine[]. Mirrors the
 * client parseLines (src/components/quotes/types.ts) but lives Deno-side so the
 * edge function is self-contained. Handles the standard { name, qty, rate,
 * total } rows and legacy PressurePro { label/surface, sqft, rate } rows.
 */
export function parseInvoiceLines(raw: unknown): ParsedLine[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedLine[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const isLegacy =
      typeof row.sqft === "number" &&
      typeof row.rate === "number" &&
      !("qty" in row);
    if (isLegacy) {
      const qty = Number(row.sqft) || 0;
      const rate = Number(row.rate) || 0;
      out.push({
        name: String(row.label ?? row.surface ?? "Line"),
        qty,
        rate,
        total: round2(qty * rate),
      });
      continue;
    }
    const qty = Number(row.qty) || 0;
    const rate = Number(row.rate) || 0;
    out.push({
      name: typeof row.name === "string" ? row.name : "Line",
      qty,
      rate,
      total: typeof row.total === "number" ? row.total : round2(qty * rate),
    });
  }
  return out;
}

/** Map parsed lines onto QBO invoice lines using one shared service item. */
export function buildInvoiceLines(
  lines: ParsedLine[],
  itemId: string,
): QboInvoiceLine[] {
  return lines.map((l) => ({
    Amount: round2(l.total),
    DetailType: "SalesItemLineDetail",
    Description: l.name,
    SalesItemLineDetail: {
      ItemRef: { value: itemId },
      Qty: l.qty,
      UnitPrice: l.rate,
    },
  }));
}

/** Build a QBO Payment payload applying `amountCents` to a QBO invoice. */
export function buildPaymentPayload(
  amountCents: number,
  qboInvoiceId: string,
  customerRef: string,
) {
  const amount = round2(amountCents / 100);
  return {
    CustomerRef: { value: customerRef },
    TotalAmt: amount,
    Line: [
      {
        Amount: amount,
        LinkedTxn: [{ TxnId: qboInvoiceId, TxnType: "Invoice" as const }],
      },
    ],
  };
}
