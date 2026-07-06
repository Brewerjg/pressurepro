import type { ComponentType } from "react";

// The quote-line seam — everything trade-specific about a quote's line items.
// 0c-1a: concrete lawn QuoteLine shape. 0c-1b (Task 1) enriches LineDescription
// and hardens describe/parseLines. QuoteLine loosens to { id; total; [k]: unknown }
// in the FINAL task of this slice (Task 4) — the compiler-enforced seam.

// Shared line — OPAQUE to the shared core. Display consumers know only id+total;
// every trade-specific field is the active vertical's private shape, read for
// display only through describe(). The lawn module casts to its concrete
// LawnQuoteLine at its own boundary.
export interface QuoteLine {
  id: string;
  total: number;
  [key: string]: unknown;
}

export interface CatalogItem {
  id: string;
  name: string;
  default_rate: number | null;
  surface_type?: string | null;
  mode?: string | null;
}

export interface LineDescription {
  label: string;          // service name — table "Service" col + card title
  detail: string | null;  // card subtitle: qty === 1 ? null : `${qty} × ${rate}`
  qty: string;            // table "Qty" col  — vertical-formatted (e.g. "3")
  rate: string;           // table "Rate" col — vertical-formatted ("$45.00" | "—")
  amount: number;         // line total — consumers format with their own fmtUSD
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
