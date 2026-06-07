-- 0022_app_discriminator.sql
--
-- TurfPro and PressurePro share the same Supabase project — same customers,
-- properties, profiles, crews — but operator-side records (quotes, plans,
-- catalog items, photo pairs, campaigns) currently leak across both apps.
-- An operator opens PressurePro and sees lawn-care quotes; opens TurfPro and
-- sees pressure-washing plans.
--
-- This migration adds an `app` discriminator column to each cross-leaking
-- table. The default 'turfpro' tags every existing row to TurfPro (since
-- the user has been testing TurfPro). PressurePro's matching migration
-- (when ported) needs to update its INSERTs to set 'pressurepro' AND
-- backfill any rows it created post-this-migration that defaulted to
-- 'turfpro' — see ALIGN_WITH_TURFPRO.md for the porting steps.
--
-- Why a column, not a schema namespace:
--   * Schema-per-app would require rewriting every query in both apps and
--     break shared cross-app reporting (e.g. "Marisol's total spend across
--     both businesses").
--   * Column discriminator is one ALTER per table, indexes are cheap, and
--     RLS still works untouched.
--   * Future "operator runs three apps" expansion stays trivial.
--
-- Tables that DON'T get the column:
--   * customers / properties / profiles / crews — genuinely shared
--   * subscriptions — SaaS-level, one row per operator regardless of app
--   * manual_payments — links to a quote/plan that's already discriminated
--   * routes / route_stops / chemical_applications / gdd_cache — TurfPro-
--     only by nature; PressurePro doesn't query them
--   * Edge fn cache tables (weather_cache, drive_matrix_cache, etc.) — shared
--
-- Safe to re-run. Idempotent on column + index creation.

BEGIN;

-- ---------------------------------------------------------------------
-- Discriminator + per-app indexes for fast filtered list queries
-- ---------------------------------------------------------------------

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS app TEXT NOT NULL DEFAULT 'turfpro';
CREATE INDEX IF NOT EXISTS idx_quotes_user_app
  ON public.quotes(user_id, app);

ALTER TABLE public.maintenance_plans
  ADD COLUMN IF NOT EXISTS app TEXT NOT NULL DEFAULT 'turfpro';
CREATE INDEX IF NOT EXISTS idx_maintenance_plans_user_app
  ON public.maintenance_plans(user_id, app);

ALTER TABLE public.catalog_items
  ADD COLUMN IF NOT EXISTS app TEXT NOT NULL DEFAULT 'turfpro';
CREATE INDEX IF NOT EXISTS idx_catalog_items_user_app
  ON public.catalog_items(user_id, app);

ALTER TABLE public.photo_pairs
  ADD COLUMN IF NOT EXISTS app TEXT NOT NULL DEFAULT 'turfpro';
CREATE INDEX IF NOT EXISTS idx_photo_pairs_user_app
  ON public.photo_pairs(user_id, app);

-- Campaigns table is gated behind a guard — if the table doesn't exist
-- in this DB (Wave 8 migration not applied), skip silently.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'campaigns'
  ) THEN
    EXECUTE 'ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS app TEXT NOT NULL DEFAULT ''turfpro''';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_campaigns_user_app ON public.campaigns(user_id, app)';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Column comments so future devs / agents discover the convention
-- ---------------------------------------------------------------------

COMMENT ON COLUMN public.quotes.app IS
  'App that owns this row. Values: turfpro | pressurepro. Operator-side queries MUST filter by this column to avoid cross-app leakage.';
COMMENT ON COLUMN public.maintenance_plans.app IS
  'App that owns this row. Values: turfpro | pressurepro.';
COMMENT ON COLUMN public.catalog_items.app IS
  'App that owns this catalog row. Lawn services for turfpro; surfaces / chemicals for pressurepro.';
COMMENT ON COLUMN public.photo_pairs.app IS
  'App that owns this photo pair. Before/after meaning differs per app.';

COMMIT;

-- ---------------------------------------------------------------------
-- Verification (uncomment and run after applying):
-- ---------------------------------------------------------------------
-- SELECT table_name, column_name, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND column_name = 'app'
--  ORDER BY table_name;
--
-- Expect 4 or 5 rows depending on whether campaigns is present.
-- All should show column_default = ''turfpro''::text
