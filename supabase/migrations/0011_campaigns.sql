-- TurfPro — seasonal campaign blast tool.
--
-- Adds public.campaigns: one row per email/SMS blast the operator runs against
-- a filtered slice of their customers. This is the #1 annual revenue driver
-- per the spec — aeration in August, leaf cleanup in October, spring restart
-- in March, fert program pitch, snow signup, plus a generic "custom" kind for
-- one-offs. The row stays around after the send so the operator can see what
-- they blasted, when, and to how many recipients.
--
-- The audience filter is stored as JSONB so the front-end wizard can encode
-- any shape it likes (preset_kind + parameters) without a schema migration
-- every time we add a new preset. The send-campaign edge function resolves
-- the filter server-side against the operator's customers table at send time.
--
-- Status lifecycle:
--   draft   — saved but never queued
--   queued  — operator hit "send now", row is waiting to be picked up
--   sending — edge fn picked it up and is fanning out
--   sent    — terminal success
--   failed  — terminal failure (`error` populated)
--
-- All changes are additive; idempotent — safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- 'aeration' | 'leaf_cleanup' | 'spring_restart' | 'fert_program' | 'snow_signup' | 'custom'
  kind TEXT NOT NULL,
  -- Subset of {'email','sms'}. At least one is required by the wizard, but we
  -- don't enforce non-empty at the DB level — a draft can theoretically be
  -- saved before the operator picks channels.
  channels TEXT[] NOT NULL DEFAULT '{}',
  subject TEXT,                             -- email subject line; SMS ignores
  body TEXT NOT NULL,                       -- shared body; SMS auto-trims
  -- JSONB filter shape (see send-campaign/index.ts):
  --   { preset: 'all' }
  --   { preset: 'with_active_plan' }
  --   { preset: 'without_active_plan' }
  --   { preset: 'inactive_days', days: 60 }
  --   { preset: 'test_self' }   -- only sends to the operator's own contact
  audience_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at TIMESTAMPTZ,                 -- null = send immediately
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'queued', 'sending', 'sent', 'failed')),
  total_recipients INTEGER NOT NULL DEFAULT 0,
  email_sent_count INTEGER NOT NULL DEFAULT 0,
  sms_sent_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_user
  ON public.campaigns(user_id, created_at DESC);

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

-- Drop-and-recreate keeps the migration idempotent across local re-runs
-- (matches the pattern used in 0005_email_log.sql and 0008_sms.sql).
DROP POLICY IF EXISTS "Users view own campaigns" ON public.campaigns;
CREATE POLICY "Users view own campaigns"
  ON public.campaigns
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own campaigns" ON public.campaigns;
CREATE POLICY "Users insert own campaigns"
  ON public.campaigns
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own campaigns" ON public.campaigns;
CREATE POLICY "Users update own campaigns"
  ON public.campaigns
  FOR UPDATE
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS campaigns_updated_at ON public.campaigns;
CREATE TRIGGER campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMIT;
