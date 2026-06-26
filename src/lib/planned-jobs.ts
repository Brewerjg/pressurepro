// Planned-jobs recurrence engine.
//
// PURE, framework-free module (no React, no supabase) so it's unit-testable
// and reusable by both pages (Home, Routes) and — later — a server-side cron
// generator. It answers two questions:
//
//   planOccursOn(plan, date, opts)  -> does this plan fire on this date?
//   plannedStopsForDate(plans, ...) -> the read-only "ghost" stops for a date
//
// IMPORTANT: jobs are DISPLAYED from plans; they are NOT persisted here. A
// route only becomes real when the operator taps "Start route" (Routes.tsx).
//
// All date math is LOCAL-time. We mirror Home.tsx's dayLabel/isToday style
// (split a YYYY-MM-DD string and build new Date(y, m-1, d)) to avoid the
// UTC off-by-one that `new Date("2024-01-01")` would introduce.

import type { RouteStop } from "@/components/routes/types";

// ---------------------------------------------------------------------------
// Plan shape — the subset of maintenance_plans columns the engine needs. We
// keep this local (not the generated Database type) and tolerant: frequency /
// season_pause / plan_kind / schedule_anchor_date are newer columns accessed
// via `(supabase as any)` casts elsewhere, so they may be missing/unknown.
// ---------------------------------------------------------------------------
export type PlanFrequency = "weekly" | "biweekly" | "monthly" | "fert_program";

export interface SchedulablePlan {
  id: string;
  customer_id?: string | null;
  property_id?: string | null;
  address?: string | null;
  customer_name?: string | null;
  services?: string[] | null;
  amount?: number | string | null;
  /** SQL day-of-week: 0=Sun .. 6=Sat. */
  day_of_week?: number | null;
  frequency?: string | null;
  /** Season tokens that pause the plan, e.g. ['winter'] or ['summer']. */
  season_pause?: string[] | null;
  plan_kind?: string | null;
  status?: string | null;
  /** Anchors biweekly/monthly phasing. */
  schedule_anchor_date?: string | null;
  /** Fallback anchor when schedule_anchor_date is null. */
  start_date?: string | null;
}

export interface PlanOccurrenceOpts {
  /** From useSeason(). Only winter is reliably known in v1 (see season note). */
  isWinter: boolean;
}

// A planned ghost stop — shaped compatibly with RouteStop so the existing UI
// can render it, but flagged `planned: true` and given a synthetic id so it's
// obviously not-yet-persisted. Never write one of these to the DB.
export interface PlannedStop extends RouteStop {
  planned: true;
}

// ---------------------------------------------------------------------------
// Local-date helpers
// ---------------------------------------------------------------------------

// Parse a YYYY-MM-DD string into a LOCAL midnight Date. Mirrors Home.tsx's
// dayLabel parser. Returns null when the string is missing/malformed.
function parseLocalYmd(s: string | null | undefined): Date | null {
  if (!s) return null;
  // Tolerate full timestamps (created_at backfill) by taking the date part.
  const datePart = s.slice(0, 10);
  const [y, m, d] = datePart.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// Strip a Date down to LOCAL midnight, dropping any time component.
function localMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Whole days between two LOCAL-midnight dates (b - a). Uses noon to dodge DST
// transitions that would otherwise make a day 23 or 25 hours long.
function wholeDaysBetween(a: Date, b: Date): number {
  const aNoon = new Date(a.getFullYear(), a.getMonth(), a.getDate(), 12);
  const bNoon = new Date(b.getFullYear(), b.getMonth(), b.getDate(), 12);
  return Math.round((bNoon.getTime() - aNoon.getTime()) / 86_400_000);
}

// The ordinal of a date's weekday within its month: 1 = first <weekday>,
// 2 = second, ... e.g. the 2nd Tuesday returns 2. Computed purely from the
// day-of-month so it's independent of which weekday it actually is.
function ordinalWeekdayOfMonth(d: Date): number {
  return Math.floor((d.getDate() - 1) / 7) + 1;
}

// Resolve a plan's effective anchor: schedule_anchor_date, then start_date,
// then a stable default. The default keeps biweekly/monthly deterministic for
// legacy rows that somehow have neither (shouldn't happen post-backfill). We
// pick a fixed Monday (2024-01-01 is a Monday) so parity/ordinal are stable.
function planAnchor(plan: SchedulablePlan): Date {
  return (
    parseLocalYmd(plan.schedule_anchor_date) ??
    parseLocalYmd(plan.start_date) ??
    new Date(2024, 0, 1)
  );
}

// ---------------------------------------------------------------------------
// Season pause
// ---------------------------------------------------------------------------
// v1 only knows winter reliably (useSeason exposes isWinter). We structure
// this so adding spring/summer/fall later is trivial: extend PlanOccurrenceOpts
// with the active season token and compare season_pause against it directly.
// For now, a plan is paused iff it's winter AND season_pause includes 'winter'.
function isSeasonPaused(plan: SchedulablePlan, opts: PlanOccurrenceOpts): boolean {
  const pause = plan.season_pause ?? [];
  if (opts.isWinter && pause.includes("winter")) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Core: does a plan fire on a given date?
// ---------------------------------------------------------------------------
export function planOccursOn(
  plan: SchedulablePlan,
  date: Date,
  opts: PlanOccurrenceOpts,
): boolean {
  // 1) Only active plans schedule.
  if (plan.status !== "active") return false;

  // 2) Fert programs are GDD/program-driven, not day-of-week mow scheduling.
  if (plan.plan_kind === "fert_program") return false;

  // 3) Season pause (winter-only in v1).
  if (isSeasonPaused(plan, opts)) return false;

  // 4) Day-of-week must match (LOCAL time; 0=Sun..6=Sat).
  if (plan.day_of_week == null) return false;
  const day = localMidnight(date);
  if (day.getDay() !== plan.day_of_week) return false;

  // 5) Cadence phasing off the anchor.
  const anchor = planAnchor(plan);
  // Normalize unknown/missing frequency to weekly.
  const freq = (plan.frequency ?? "weekly") as string;

  if (freq === "biweekly") {
    // Fires every other week. Count whole weeks between the anchor's week and
    // this date's week; even => same phase as the anchor => fires.
    // We measure from each week's "start of day" so partial weeks don't drift;
    // floor(diffDays / 7) gives whole-week count regardless of weekday.
    const diffDays = wholeDaysBetween(anchor, day);
    const weeks = Math.floor(diffDays / 7);
    // Math.floor keeps parity correct for dates BEFORE the anchor too
    // (e.g. -1 week and +1 week are both "odd" → off-phase).
    return ((weeks % 2) + 2) % 2 === 0;
  }

  if (freq === "monthly") {
    // Fires on the SAME ordinal weekday-of-month as the anchor. The anchor and
    // the date already share a weekday (step 4), so we only compare ordinals:
    // anchor on the 2nd Tuesday => fires on the 2nd Tuesday of every month.
    // (Months without a "5th Tuesday" simply don't fire that month — correct.)
    return ordinalWeekdayOfMonth(anchor) === ordinalWeekdayOfMonth(day);
  }

  // weekly (and any unknown frequency): every matching day_of_week.
  return true;
}

// ---------------------------------------------------------------------------
// Display: build read-only ghost stops for a date.
// ---------------------------------------------------------------------------
function feeCentsFromAmount(amount: number | string | null | undefined): number | null {
  if (amount == null) return null;
  const n = Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

// Filter plans through planOccursOn and map each survivor to a PlannedStop.
// The returned stops are sorted by plan id only for a stable order (there's no
// drive-time optimization until the route is actually started). Synthetic ids
// are `plan:<plan_id>` so they're obviously not real route_stops rows.
export function plannedStopsForDate(
  plans: SchedulablePlan[],
  date: Date,
  opts: PlanOccurrenceOpts,
): PlannedStop[] {
  const matching = plans.filter((p) => planOccursOn(p, date, opts));
  return matching.map((p, i) => ({
    id: `plan:${p.id}`,
    user_id: "",
    route_id: "",
    plan_id: p.id,
    property_id: p.property_id ?? null,
    customer_id: p.customer_id ?? null,
    address_snapshot: p.address ?? null,
    customer_name_snapshot: p.customer_name ?? null,
    services: p.services ?? [],
    fee_cents: feeCentsFromAmount(p.amount),
    sort_order: (i + 1) * 10,
    status: "pending",
    skip_reason: null,
    arrived_at: null,
    completed_at: null,
    drive_minutes_from_prev: null,
    drive_miles_from_prev: null,
    notes: null,
    planned: true,
  }));
}
