-- 0027_manual_payments_route_nullable.sql
--
-- Fix #3: "unable to accept cash/check/bank payment for a job — route id missing."
--
-- The committed schema (0015_manual_payments.sql) makes the route link
-- nullable: manual payments can be tied to a customer/invoice/quote with NO
-- route. Invoice/quote cash payments work precisely because they never set a
-- route link. Only the route-mode "+ Payment" path sets a route link, and it
-- fails on the LIVE database — meaning the live table diverged from 0015 (a
-- route_id / route_stop_id column ended up NOT NULL when migrations were
-- hand-applied). The runtime Postgres error surfaces as "route id missing".
--
-- This migration is self-diagnosing and safe to re-run: it only relaxes a
-- NOT NULL if one actually exists, on whichever column diverged.

DO $$
BEGIN
  -- route_stop_id must be nullable (matches 0015: REFERENCES route_stops ON DELETE SET NULL)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'manual_payments'
      AND column_name = 'route_stop_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.manual_payments ALTER COLUMN route_stop_id DROP NOT NULL;
  END IF;

  -- a stray route_id column (not in 0015) left NOT NULL by a hand-applied
  -- version — the client never sets it, so the insert violates NOT NULL.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'manual_payments'
      AND column_name = 'route_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.manual_payments ALTER COLUMN route_id DROP NOT NULL;
  END IF;
END $$;
