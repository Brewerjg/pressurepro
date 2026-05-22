-- TurfPro — Snow swap mode (season state + pause reason tracking).
--
-- Northern-market operators pivot from mowing to snow removal in winter.
-- This migration introduces the per-operator season state and the ability
-- to distinguish auto-paused (winter swap) plans from manually-paused ones
-- so that flipping back to summer only resumes what we paused.
--
-- All changes are additive; existing rows pick up defaults and existing
-- queries are unaffected. Idempotent — safe to re-run.

BEGIN;

-- =====================================================================
-- 1. user_settings.season — single source of truth for an operator's
--    current season. Most operators only use the binary summer<->winter
--    swap, but the four-token enum keeps options open for fall/spring
--    transitional UX in a later release.
-- =====================================================================
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS season TEXT NOT NULL DEFAULT 'summer'
    CHECK (season IN ('spring', 'summer', 'fall', 'winter')),
  ADD COLUMN IF NOT EXISTS season_changed_at TIMESTAMPTZ;

-- =====================================================================
-- 2. maintenance_plans.pause_reason — explains WHY a plan is paused.
--    'winter_swap' means the season-swap auto-paused it; flipping back
--    to a non-winter season will auto-resume only these. Operator-driven
--    pauses ('customer_requested', 'card_failed', etc.) stay paused.
--
--    NULL by default — existing paused rows are treated as manually
--    paused (safe: they won't be auto-resumed). Operators can still
--    resume them by hand from Plans.
-- =====================================================================
ALTER TABLE public.maintenance_plans
  ADD COLUMN IF NOT EXISTS pause_reason TEXT;

-- Partial index — most plans have NULL pause_reason, so the index stays
-- small and only matters during the (rare) season-swap bulk update.
CREATE INDEX IF NOT EXISTS idx_plans_pause_reason
  ON public.maintenance_plans(user_id, pause_reason)
  WHERE pause_reason IS NOT NULL;

COMMIT;
