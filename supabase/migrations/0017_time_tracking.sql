-- 0017_time_tracking.sql
--
-- Per-stop time tracking on route_stops. The base schema (0001) already added
-- `arrived_at` and `completed_at`. Today only `completed_at` is populated on
-- Mark-done; this migration adds:
--
--   1. assigned_user_id — preps for multi-user crews. When a future crew
--      member taps Mark-done / Arrive, we attribute the timestamp to *their*
--      user_id so reports can break out per-employee on-site time. For the
--      solo-operator case today, this stays NULL and reports fall back to the
--      route owner.
--
--   2. arrival_adjusted — flag for back-filled arrivals. There are two
--      back-fill paths in the UI:
--        - automatic, when Mark-done is tapped without a prior Arrive
--          (we stamp arrived_at = now() and set this true so reports know
--          we don't actually have arrival data on that stop);
--        - manual, when the operator notices "I forgot to clock arrival"
--          and back-dates it 5/10/15 minutes via a tiny picker.
--      In both cases the timestamp is still useful for ordering, just not
--      load-bearing for "how long were we on site."
--
-- A partial index keeps the user-attribution lookups cheap once multi-user
-- crews come online — we only index rows that have been assigned.

ALTER TABLE public.route_stops
  ADD COLUMN IF NOT EXISTS assigned_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS arrival_adjusted BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_route_stops_assigned
  ON public.route_stops(assigned_user_id) WHERE assigned_user_id IS NOT NULL;
