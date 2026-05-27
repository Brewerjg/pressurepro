-- TurfPro — pg_cron drainer for quiet-hours-queued SMS rows.
--
-- Background: send-customer-sms (functions/send-customer-sms/index.ts) writes
-- an sms_log row with status='queued' and error='quiet_hours' when an SMS
-- is triggered outside the operator's user_settings.sms_quiet_* window.
-- Today nothing ever picks those rows back up — they stay queued forever.
--
-- This migration:
--   1. Ensures pg_cron is installed (it usually is on Supabase by default;
--      this is a no-op otherwise).
--   2. Schedules a job that pokes the drain-sms-queue edge function every
--      5 minutes. The function does the actual work (selecting candidates,
--      re-firing Twilio, promoting rows to 'sent').
--
-- =====================================================================
-- OPERATOR SETUP REQUIRED
-- =====================================================================
-- The cron job POSTs to the edge function URL with the service-role key.
-- pg_cron has no access to function secrets, so the operator must publish
-- those two values as database parameters via:
--
--   Supabase dashboard → Database → Configuration → Custom Postgres Config
--
-- and add:
--
--   app.supabase_url      = 'https://<project-ref>.supabase.co'
--   app.service_role_key  = 'eyJhbGc...'   (service-role JWT)
--
-- Until both are set, current_setting() returns NULL and net.http_post()
-- silently no-ops (the function never actually fires). That's intentionally
-- safe: a fresh project doesn't accidentally fan out SMS before the
-- operator has configured anything.
--
-- Verifying after setup:
--   SELECT * FROM cron.job WHERE jobname = 'turfpro_drain_sms';
--   SELECT * FROM cron.job_run_details
--     WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'turfpro_drain_sms')
--     ORDER BY start_time DESC LIMIT 5;
-- =====================================================================

BEGIN;

-- Requires pg_cron extension (already installed in most Supabase projects).
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Unschedule any prior version so re-running this migration replaces the
-- job cleanly. cron.unschedule() raises if the job doesn't exist, so we
-- wrap it in a DO block that swallows the not-found case.
DO $$
BEGIN
  PERFORM cron.unschedule('turfpro_drain_sms');
EXCEPTION WHEN OTHERS THEN
  -- No prior schedule with this name — fine.
  NULL;
END;
$$;

-- Schedule via pg_cron — runs every 5 min, finds queued SMS rows whose
-- operator's current local hour falls inside the quiet-hours window, and
-- invokes the send-customer-sms edge fn with a special "drain" mode that
-- re-fires the original request with the gate disabled.
--
-- We POST from pg_cron to the edge fn URL with the service-role key so the
-- function can read whichever rows it wants. The fn handles the rest.
--
-- Operators must store their Supabase URL + service-role key as pg_cron
-- session settings via the dashboard before this job will actually fire.
SELECT cron.schedule(
  'turfpro_drain_sms',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url', true) || '/functions/v1/drain-sms-queue',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

COMMIT;
