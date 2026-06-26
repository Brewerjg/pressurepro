-- 0028_plan_schedule_anchor.sql
-- Auto-scheduling (display) support.
--
-- Adds a schedule anchor to maintenance_plans so the recurrence engine
-- (src/lib/planned-jobs.ts) can phase biweekly and monthly cadences:
--   * biweekly -> which week (even/odd) the plan fires, measured from the anchor
--   * monthly  -> which ordinal weekday-of-month (e.g. "2nd Tuesday") it fires
-- weekly plans don't need the anchor (they fire every matching day_of_week).
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS + an idempotent backfill.
ALTER TABLE public.maintenance_plans
  ADD COLUMN IF NOT EXISTS schedule_anchor_date DATE;

-- Backfill existing rows from the plan's start_date, falling back to the
-- row's creation date. Only touches rows that haven't been anchored yet, so
-- re-running this migration won't clobber an operator-set anchor.
UPDATE public.maintenance_plans
  SET schedule_anchor_date = COALESCE(start_date, created_at::date)
  WHERE schedule_anchor_date IS NULL;

COMMENT ON COLUMN public.maintenance_plans.schedule_anchor_date IS
  'Anchors biweekly/monthly recurrence phasing. Biweekly fires on weeks an even number of weeks from this date; monthly fires on the same ordinal weekday-of-month as this date. Defaults to start_date (then created_at). Weekly plans ignore it.';
