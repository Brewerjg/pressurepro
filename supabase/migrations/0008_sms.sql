-- TurfPro — customer SMS comms layer.
--
-- Adds:
--   1. public.sms_log — one row per outbound transactional SMS send,
--      mirroring email_log from 0005. The send-customer-sms edge function
--      writes a 'queued' row up front and then promotes it to 'sent' /
--      'failed' once Twilio's API returns. Rows can also stay 'queued' if
--      the operator's quiet-hours window is closed; a future scheduled
--      job is expected to drain that backlog when the window opens.
--   2. Three boolean toggles on public.user_settings — one per SMS-able
--      kind (on_the_way, completed, review_request). Defaults are FALSE
--      because SMS has real per-message cost and TCPA exposure; the
--      operator must opt in deliberately for each kind.
--   3. Quiet-hours window — sms_quiet_start_hour / sms_quiet_end_hour
--      (defaults 8am–8pm). The edge function refuses to send outside this
--      window; out-of-hours sends are logged as queued with error='quiet_hours'.
--
-- All changes are additive; existing rows pick up the new columns with
-- the documented defaults. Idempotent — safe to re-run.

BEGIN;

-- =====================================================================
-- 1. sms_log — audit trail for outbound customer SMS
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.sms_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  route_stop_id UUID REFERENCES public.route_stops(id) ON DELETE SET NULL,
  -- 'on_the_way' | 'completed' | 'review_request' | 'plan_confirmation'
  kind TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  body TEXT,
  twilio_message_sid TEXT,
  -- 'queued' | 'sent' | 'failed'
  -- 'queued' is also the parking state for messages blocked by quiet-hours;
  -- in that case `error` is set to 'quiet_hours' for later disambiguation.
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_log_user_kind
  ON public.sms_log(user_id, kind, created_at DESC);

ALTER TABLE public.sms_log ENABLE ROW LEVEL SECURITY;

-- Drop-and-recreate keeps the migration idempotent across local re-runs
-- (matches the pattern used in 0005_email_log.sql).
DROP POLICY IF EXISTS "Users view own sms log" ON public.sms_log;
CREATE POLICY "Users view own sms log"
  ON public.sms_log
  FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users insert own sms log" ON public.sms_log;
CREATE POLICY "Users insert own sms log"
  ON public.sms_log
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- =====================================================================
-- 2. user_settings — SMS preference toggles + quiet-hours window
--    SMS toggles default to FALSE: SMS has both per-message cost and
--    real TCPA exposure for the operator. Opt-in must be a deliberate
--    action in Settings, not a side effect of upgrading.
--
--    Quiet hours default 8am–8pm — a sensible "contractor texting" window
--    that lines up with how lawn customers expect to hear from a service.
-- =====================================================================
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS send_on_the_way_sms      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS send_completed_sms       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS send_review_request_sms  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_quiet_start_hour     SMALLINT NOT NULL DEFAULT 8
    CHECK (sms_quiet_start_hour BETWEEN 0 AND 23),
  ADD COLUMN IF NOT EXISTS sms_quiet_end_hour       SMALLINT NOT NULL DEFAULT 20
    CHECK (sms_quiet_end_hour BETWEEN 0 AND 23);

COMMIT;
