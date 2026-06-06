// Compute the next-visit date for a maintenance plan.
//
// Plans store two distinct cadences:
//   - interval_months  : billing cadence (3, 6, 12)
//   - frequency        : service cadence ('weekly', 'biweekly', 'monthly',
//                        'fert_program')
//   - day_of_week      : 0 (Sun) … 6 (Sat) — preferred service day
//   - start_date       : the very first scheduled visit (anchors biweekly math)
//
// `next_charge_date` on the plan is a BILLING date — not when the truck rolls.
// The actual visit is "the next day-of-week that matches the cadence",
// computed from today.
//
// Biweekly is the only mode that needs `start_date`: we count whole weeks
// since start_date and round up to the next even multiple. The visit can
// therefore land 1–14 days from `from` depending on phase.
//
// Returns null when:
//   - day_of_week is null (operator hasn't set a route day yet),
//   - frequency is unrecognized, or
//   - biweekly is requested but start_date is missing / invalid.

export interface NextVisitPlan {
  day_of_week: number | null;
  frequency: string;
  // Required only for biweekly cadence; ignored otherwise.
  start_date?: string | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function atLocalMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Smallest n >= 0 such that (from.dow + n) % 7 === targetDow.
function daysUntilDow(fromDow: number, targetDow: number): number {
  return (targetDow - fromDow + 7) % 7;
}

export function nextVisitDate(
  plan: NextVisitPlan,
  from: Date = new Date(),
): Date | null {
  const { day_of_week, frequency, start_date } = plan;
  if (day_of_week == null || day_of_week < 0 || day_of_week > 6) return null;

  const base = atLocalMidnight(from);
  const baseDow = base.getDay();

  if (frequency === "weekly") {
    const delta = daysUntilDow(baseDow, day_of_week);
    return new Date(base.getTime() + delta * MS_PER_DAY);
  }

  if (frequency === "biweekly") {
    if (!start_date) return null;
    const start = new Date(start_date);
    if (Number.isNaN(start.getTime())) return null;
    const startMid = atLocalMidnight(start);

    // Walk forward day-by-day from `base` to the next matching day_of_week,
    // then keep adding 7 days while the gap from start_date is an ODD
    // number of weeks (which would mean it's an off-week visit).
    const firstCandidate = new Date(
      base.getTime() + daysUntilDow(baseDow, day_of_week) * MS_PER_DAY,
    );
    let candidate = firstCandidate;
    for (let i = 0; i < 3; i++) {
      const weeksSinceStart = Math.round(
        (candidate.getTime() - startMid.getTime()) / (7 * MS_PER_DAY),
      );
      if (weeksSinceStart >= 0 && weeksSinceStart % 2 === 0) return candidate;
      candidate = new Date(candidate.getTime() + 7 * MS_PER_DAY);
    }
    return null;
  }

  if (frequency === "monthly") {
    // Monthly = the next occurrence of day_of_week that's also within the
    // next 30 days. Operators model monthly fert as "the X day-of-week in
    // each month" so we approximate by walking forward four weeks and
    // taking the first match.
    const delta = daysUntilDow(baseDow, day_of_week);
    return new Date(base.getTime() + delta * MS_PER_DAY);
  }

  // 'fert_program' and unknown values: not a recurring mow cadence — we
  // can't compute a meaningful next visit.
  return null;
}
