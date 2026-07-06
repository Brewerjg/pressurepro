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
