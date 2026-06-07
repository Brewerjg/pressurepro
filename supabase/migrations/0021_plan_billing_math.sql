-- 0021_plan_billing_math.sql
--
-- Fixes for the "biweekly mow at $55 should bill $330 every 3 months" bug:
--
--   1. Allow interval_months = 1 (monthly billing). The original CHECK
--      constraint forbade it.
--   2. Add per_visit_rate NUMERIC. NewPlan asks for the per-visit rate
--      and computes amount = per_visit_rate × visits_per_month × interval_months.
--      Storing both means PlanDetail's edit form can show the operator's
--      mental-model number without reverse-engineering it.
--
-- Re-runnable. Wrapped in a transaction so a partial failure rolls back
-- cleanly. Safe to paste even if a previous run of this file got partway
-- through — the DROP CONSTRAINT IF EXISTS + DO-block recovery handles
-- both the "constraint still exists with old (3,6,12) values" case and
-- the "constraint was renamed at some point" case.
--
-- Important Postgres trivia: CHECK (x IN (a, b, c)) is normalized to
-- CHECK (x = ANY (ARRAY[a, b, c])) in pg_get_constraintdef output. The
-- recovery DO block matches on column name only, not the literal "IN".

BEGIN;

-- ---------------------------------------------------------------------
-- Step 1. Drop the existing CHECK on interval_months.
-- ---------------------------------------------------------------------

-- Most-likely auto-generated name from the inline CHECK in CREATE TABLE.
ALTER TABLE public.maintenance_plans
  DROP CONSTRAINT IF EXISTS maintenance_plans_interval_months_check;

-- Recovery: in case the constraint was ever renamed, drop any OTHER
-- CHECK on this table that mentions interval_months. No-op if the above
-- DROP already cleared it.
DO $$
DECLARE
  cname text;
BEGIN
  FOR cname IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.maintenance_plans'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ~* 'interval_months'
  LOOP
    EXECUTE format('ALTER TABLE public.maintenance_plans DROP CONSTRAINT %I', cname);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Step 2. Re-add the constraint with monthly billing included.
-- ---------------------------------------------------------------------

ALTER TABLE public.maintenance_plans
  ADD CONSTRAINT maintenance_plans_interval_months_check
  CHECK (interval_months IN (1, 3, 6, 12));

-- ---------------------------------------------------------------------
-- Step 3. Add per_visit_rate column. Nullable — legacy plans keep
-- working; PlanDetail's edit form shows "—" until the operator updates.
-- ---------------------------------------------------------------------

ALTER TABLE public.maintenance_plans
  ADD COLUMN IF NOT EXISTS per_visit_rate NUMERIC;

COMMENT ON COLUMN public.maintenance_plans.per_visit_rate IS
  'Per-visit price the operator quoted. amount column = per_visit_rate * visits_per_month(frequency) * interval_months. NULL for legacy plans created before this column existed.';

COMMIT;

-- ---------------------------------------------------------------------
-- Verification (uncomment after running):
-- ---------------------------------------------------------------------
--
-- SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conrelid = 'public.maintenance_plans'::regclass
--    AND contype  = 'c'
--    AND pg_get_constraintdef(oid) ~* 'interval_months';
-- Expect 1 row: CHECK ((interval_months = ANY (ARRAY[1, 3, 6, 12])))
--
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND table_name   = 'maintenance_plans'
--    AND column_name  = 'per_visit_rate';
-- Expect 1 row: per_visit_rate | numeric | YES
