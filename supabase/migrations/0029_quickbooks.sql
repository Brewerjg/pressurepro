-- 0029_quickbooks.sql
--
-- QuickBooks Online (QBO) OAuth2 connection storage — Phase 1 "connect
-- foundation" only. This migration stores the server-side OAuth tokens that
-- let an operator connect their QuickBooks COMPANY (a.k.a. "realm") to
-- TurfPro. The actual invoice/payment SYNC is Phase 2 (see
-- docs/QUICKBOOKS_SETUP.md) and is intentionally NOT built yet.
--
-- SECURITY MODEL
--   Both tables hold secrets (OAuth access/refresh tokens, short-lived CSRF
--   state). They are touched ONLY by the `quickbooks-oauth` edge function
--   using the service role key, which bypasses RLS. We therefore:
--     - ENABLE row level security on both tables, and
--     - add NO anon/authenticated policies at all.
--   With RLS enabled and zero policies, the client (anon/authenticated JWT)
--   can never SELECT/INSERT/UPDATE/DELETE these rows, so OAuth tokens are
--   never readable from the browser. The client learns its connection status
--   ONLY via the `status` op of the `quickbooks-oauth` edge function (which
--   returns company_name/realm_id but never tokens).
--
-- APPLY (IMPORTANT)
--   This repo's migrations are NOT tracked by `supabase db push`. Apply this
--   file directly against the database:
--     supabase db query -f supabase/migrations/0029_quickbooks.sql
--   It is written to be safe to re-run (IF NOT EXISTS / idempotent).

-- ---------------------------------------------------------------------------
-- quickbooks_connections — one row per connected operator (user_id PK).
--   realm_id      : the QuickBooks company id (QBO calls it the "realmId").
--   access_token  : short-lived bearer token (~1h); refreshed via refresh_token.
--   refresh_token : long-lived (~100 days, rotates on refresh).
--   token_expires_at : when access_token expires (now() + expires_in at grant).
--   company_name  : best-effort display name shown in Settings.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quickbooks_connections (
  user_id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  realm_id         TEXT NOT NULL,
  access_token     TEXT NOT NULL,
  refresh_token    TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  company_name     TEXT,
  connected_at     TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- quickbooks_oauth_states — short-lived CSRF state → user mapping.
--   The `authorize` op writes one row before redirecting the operator to
--   Intuit; the `callback` op looks it up (and deletes it) to recover which
--   TurfPro user the Intuit redirect belongs to. Rows are single-use.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quickbooks_oauth_states (
  state      TEXT PRIMARY KEY,
  user_id    UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- RLS: enable on both, add NO policies. Only the service role (used by the
-- `quickbooks-oauth` edge fn) may read/write these rows. Clients discover
-- connection status exclusively through the edge fn's `status` op.
-- ---------------------------------------------------------------------------
ALTER TABLE public.quickbooks_connections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quickbooks_oauth_states ENABLE ROW LEVEL SECURITY;
