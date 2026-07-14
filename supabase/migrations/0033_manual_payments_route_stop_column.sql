-- 0033: restore manual_payments.route_stop_id on the LIVE database.
--
-- 0015_manual_payments.sql defines
--   route_stop_id UUID REFERENCES public.route_stops(id) ON DELETE SET NULL
-- but the live table has NO route_stop_id column at all (verified
-- 2026-07-14 via information_schema; the hand-applied live version diverged
-- from 0015). The client (src/lib/manual-payments.ts recordPayment) sends
-- route_stop_id on EVERY insert — null when not in route mode — so with the
-- column missing, recording ANY cash/check payment fails with PostgREST
-- "could not find the 'route_stop_id' column", surfaced in the June internal
-- test as bug #3 ("route id missing"). 0027 assumed the column existed as
-- NOT NULL and only relaxed it; it could not fix this state.
--
-- Additive + idempotent. No route_id column is added — 0027 identified it as
-- a stray; the client never writes it.
--
-- UNTRACKED-MIGRATION CONVENTION: apply with
--   supabase db query -f supabase/migrations/0033_manual_payments_route_stop_column.sql --linked
-- (never `db push`). Mirror this FILE to Brewerjg/pressurepro (shared DB —
-- apply once; the file copy is for repo parity).

ALTER TABLE public.manual_payments
  ADD COLUMN IF NOT EXISTS route_stop_id UUID
  REFERENCES public.route_stops(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_manual_payments_route_stop
  ON public.manual_payments(route_stop_id);
