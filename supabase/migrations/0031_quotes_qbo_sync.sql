-- 0031_quotes_qbo_sync.sql
--
-- QuickBooks Phase 2 for PressurePro: PressurePro bills via `quotes` (not the
-- `invoices` table TurfPro uses), so the quote row needs the same QBO sync
-- state columns the invoices table already has (from 0030). manual_payments
-- (qbo_payment_id) and customers (qbo_customer_id) are already covered by 0030.
--
-- Shared table: TurfPro quotes get these columns too but never write them
-- (TurfPro syncs invoices, not quotes) — harmless.
--
-- APPLY: supabase db query --linked -f supabase/migrations/0031_quotes_qbo_sync.sql
-- Idempotent (ADD COLUMN IF NOT EXISTS) — safe to re-run.
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS qbo_invoice_id TEXT,
  ADD COLUMN IF NOT EXISTS qbo_synced_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qbo_sync_error TEXT;
