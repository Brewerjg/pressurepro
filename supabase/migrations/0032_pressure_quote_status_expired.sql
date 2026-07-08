-- Phase 1 (pressure vertical cutover): add 'expired' to quote_status.
--
-- The live quote_status enum on the shared DB is
--   {draft, sent, accepted, scheduled, complete, paid}
-- but the pressure app writes quotes.status = 'expired' when auto-expiring stale
-- quotes (Quotes.tsx / QuoteDetail.tsx). Those writes currently fail on the live
-- enum. Adding the value is additive and backward-compatible (no existing row or
-- query changes). Lawn does not write 'expired'; it is harmless there.
--
-- UNTRACKED-MIGRATION CONVENTION: apply with `supabase db query -f`, never
-- `db push`. Applied in slice 1f (pre-cutover gate), not when this file lands.
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block, so run it as a
-- standalone statement.

ALTER TYPE public.quote_status ADD VALUE IF NOT EXISTS 'expired';
