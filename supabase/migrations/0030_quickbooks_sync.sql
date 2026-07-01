-- 0030_quickbooks_sync.sql
--
-- QuickBooks Online Phase 2 (invoice + payment SYNC) support columns. Adds the
-- QBO entity-id caches that make the manual "Sync to QuickBooks" action
-- idempotent, plus the invoice-level sync state the button reads.
--
-- All columns are written ONLY by the service-role `quickbooks-sync` edge
-- function. No RLS changes: the qbo_* columns inherit each table's existing
-- policies (customers/invoices/manual_payments are operator-scoped; the client
-- never needs to write these).
--
-- APPLY (migrations are NOT tracked by `supabase db push`):
--   supabase db query --linked -f supabase/migrations/0030_quickbooks_sync.sql
-- Idempotent (ADD COLUMN IF NOT EXISTS) — safe to re-run.

-- Cache of the matched/created QBO Customer id (per operator's connected realm).
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS qbo_customer_id TEXT;

-- Invoice sync state + idempotency.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS qbo_invoice_id TEXT,
  ADD COLUMN IF NOT EXISTS qbo_synced_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qbo_sync_error TEXT;

-- Per-payment idempotency: which QBO Payment this row was posted as.
ALTER TABLE public.manual_payments
  ADD COLUMN IF NOT EXISTS qbo_payment_id TEXT;

-- Cache of the default "Landscaping Services" QBO Item id for this connection.
ALTER TABLE public.quickbooks_connections
  ADD COLUMN IF NOT EXISTS qbo_default_item_id TEXT;

-- ---------------------------------------------------------------------------
-- OAuth account-linking hardening (see Task 4). Two changes:
--   1) State rows get a TTL so a leaked state can't be replayed later.
--   2) A pending-grant table: the callback stores exchanged tokens keyed by a
--      claim_token delivered ONLY to the approving browser; an authenticated
--      `claim` call promotes the grant into quickbooks_connections under the
--      caller's user_id. This binds the connection to whoever actually
--      approved at Intuit, closing the account-linking hijack. Service-role
--      only (RLS on, no policies), matching the other quickbooks_* tables.
-- ---------------------------------------------------------------------------
ALTER TABLE public.quickbooks_oauth_states
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.quickbooks_pending_connections (
  claim_token      TEXT PRIMARY KEY,
  realm_id         TEXT NOT NULL,
  access_token     TEXT NOT NULL,
  refresh_token    TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes')
);
ALTER TABLE public.quickbooks_pending_connections ENABLE ROW LEVEL SECURITY;
