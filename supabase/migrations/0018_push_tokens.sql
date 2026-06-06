-- 0018_push_tokens.sql
--
-- Native-device push token store. Each user can have N rows (one per device
-- the operator has signed in on — iPhone + iPad + spouse's Android, etc.).
-- The send-push edge function fans out to all tokens for a given user.
--
-- We dedupe on (user_id, token) so the same physical device re-registering
-- on app launch (which it does on every Capacitor.PushNotifications.register
-- call) becomes an idempotent upsert rather than piling up duplicate rows.
--
-- last_seen_at is bumped on every re-registration so we can later prune
-- stale tokens (Apple and Google both reject pushes to tokens that haven't
-- been refreshed in ~270 days).
--
-- Cron note (deferred for v1):
--   A pg_cron job that scans `routes` for today's date and fires a push
--   30 minutes before the operator's typical start time (~8am local) is the
--   natural fit for "Route starts in 30 min" reminders. We're not landing
--   the cron in v1 — the push transport (this table + send-push edge fn)
--   is the durable surface; the cron is a thin caller on top of it.
--   Sketch for when we do:
--     SELECT cron.schedule(
--       'push-route-reminders',
--       '0 7 * * *',  -- 7am UTC, adjust to operator local later
--       $$ SELECT net.http_post(
--            url := current_setting('app.send_push_url'),
--            headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
--            body := jsonb_build_object('kind','route_reminder', 'user_id', r.user_id, 'title', 'Route starts soon', 'body', '30 minutes until your first stop')
--          )
--          FROM routes r WHERE r.date = current_date AND r.status = 'planned'; $$
--     );

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  device_label TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON public.push_tokens(user_id);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

-- Operators can see / register / delete their own tokens. The send-push
-- edge function uses the service role key so it bypasses RLS for the
-- cross-user fan-out reads.
CREATE POLICY "Users view own push tokens" ON public.push_tokens
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own push tokens" ON public.push_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own push tokens" ON public.push_tokens
  FOR DELETE USING (auth.uid() = user_id);
