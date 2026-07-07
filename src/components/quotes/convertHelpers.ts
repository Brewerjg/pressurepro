// Helpers for the "Convert quote → recurring plan" flow.
//
// Centralizes the lawn-care domain heuristics that decide
//   1. which quote line items should default to recurring vs one-time
//   2. what cadence the plan should default to
//
// Pulled out of QuoteDetail.tsx so the logic is unit-testable in isolation
// and the page file stays lean.

import type { QuoteLine } from "./types";

// Substring matches against the lowercased item name. These reflect the
// way our lawn-care operators actually phrase line items in quotes — short
// nouns like "mow", "edge", "trim", "blow" for recurring maintenance, and
// the longer task names ("spring cleanup", "mulch install", "aeration") for
// one-and-done seasonal work.
const RECURRING_KEYWORDS = ["mow", "edge", "trim", "blow", "fert"] as const;
const ONE_TIME_KEYWORDS = [
  "cleanup",
  "aeration",
  "overseed",
  "mulch",
  "install",
  "dethatch",
  "lime",
  "weed control",
  "snow",
] as const;

/** True if the line name looks like a one-and-done service. */
export function isOneTimeByDefault(name: string): boolean {
  const n = name.toLowerCase();
  return ONE_TIME_KEYWORDS.some((kw) => n.includes(kw));
}

/** True if the line name looks like an obvious recurring maintenance task. */
function isRecurringByDefault(name: string): boolean {
  const n = name.toLowerCase();
  return RECURRING_KEYWORDS.some((kw) => n.includes(kw));
}

/**
 * Stable, side-effect-free decision: should this name start checked?
 *
 * The precedence is:
 *   1. Explicit one-time keyword wins (cleanup beats mow if both somehow
 *      appear, e.g. "spring cleanup + mow").
 *   2. Explicit recurring keyword.
 *   3. Catch-all: checked (operator can uncheck — better to over-include
 *      than silently drop a billable service).
 */
function defaultIsRecurring(name: string): boolean {
  if (isOneTimeByDefault(name)) return false;
  if (isRecurringByDefault(name)) return true;
  return true;
}

/** What every checkbox row in the form actually carries. */
export interface PlanLineItem {
  id: string;
  name: string;
  rate: number;
  isRecurring: boolean;
  source: "quote" | "catalog" | "custom";
  isOneTimeByDefault?: boolean;
}

/**
 * Build the initial checkbox list from the quote's parsed line items.
 *
 * - Dedupes by trimmed name (case-sensitive — operators capitalize on
 *   purpose; "Mow" and "mow" are likely the same service typed twice).
 * - Applies the heuristics above to seed isRecurring + the
 *   isOneTimeByDefault badge flag.
 * - Rate is the quote's per-line rate (not qty * rate) — the plan view
 *   thinks in "per visit", so qty=4 weekly visits at $55 still maps to a
 *   single $55/visit item, not $220.
 */
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

