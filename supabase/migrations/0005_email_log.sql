-- TurfPro — customer email comms layer.
--
-- Adds:
--   1. public.email_log — one row per outbound transactional email send.
--      The send-customer-email edge function writes a 'queued' row up front
--      and then promotes it to 'sent' or 'failed' once Resend returns.
--   2. Three boolean toggles on public.user_settings so operators can opt
--      out of any of the automatic email triggers. Defaults are TRUE so
--      installed-and-forget behavior just works for new users.
--
-- Both changes are additive; existing rows pick up the new columns with
-- the documented defaults. Idempotent — safe to re-run.

BEGIN;

-- =====================================================================
-- 1. email_log — audit trail for outbound customer emails
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  route_stop_id UUID REFERENCES public.route_stops(id) ON DELETE SET NULL,
  -- 'on_the_way' | 'completed' | 'review_request' | 'plan_confirmation'
  kind TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  subject TEXT,
  resend_message_id TEXT,
  -- 'queued' | 'sent' | 'failed'
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_log_user_kind
  ON public.email_log(user_id, kind, created_at DESC);

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

-- Drop-and-recreate pattern keeps this migration idempotent across local
-- re-runs without depending on Postgres 15+ "CREATE POLICY IF NOT EXISTS".
DROP POLICY IF EXISTS "Users view own email log" ON public.email_log;
CREATE POLICY "Users view own email log"
  ON public.email_log
  FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users insert own email log" ON public.email_log;
CREATE POLICY "Users insert own email log"
  ON public.email_log
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- =====================================================================
-- 2. user_settings — messaging preference toggles
--    Defaults to TRUE so operators get the lawn-care-flavored automatic
--    emails out of the box; they can opt out per kind from Settings.
-- =====================================================================
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS send_on_the_way_email      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS send_completed_email       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS send_review_request_email  BOOLEAN NOT NULL DEFAULT true;

COMMIT;
