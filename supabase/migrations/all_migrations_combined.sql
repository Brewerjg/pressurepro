-- Combined TurfPro Migrations
-- Generated on Tue May 26 20:35:58 PDT 2026
-- Contains all migrations from 0001 to 0012



-- ========================================
-- Migration: 0001_turfpro_lawn_care.sql
-- ========================================

-- TurfPro — additive migration on top of PressurePro's schema.
--
-- TurfPro shares the PressurePro Supabase project (see TURFPRO_SPEC.md
-- "Concrete near-term moves"), so this file ADDs new tables/columns rather
-- than redefining anything. Apply once in the shared project's SQL editor;
-- existing PressurePro behavior is unaffected because:
--   - new columns are nullable or have defaults
--   - new tables are namespaced by intent (routes / route_stops / chemical_applications)
--   - RLS policies are scoped to auth.uid() just like the existing tables
--
-- Order matters: properties + maintenance_plans columns first, then new tables
-- that reference them.

BEGIN;

-- =====================================================================
-- 1. properties — lawn-specific fields
--    The base table (id, customer_id, address, sqft, gate_code, dog_warning)
--    is reused verbatim from PressurePro.
-- =====================================================================
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS turf_sqft INTEGER,
  -- Cool-season vs warm-season drives mow height + fert schedule. Free text
  -- so operators can write 'bermuda/fescue mix' or regional names.
  ADD COLUMN IF NOT EXISTS grass_type TEXT,
  -- Decimal inches (3.5 = three-and-a-half-inch deck height).
  ADD COLUMN IF NOT EXISTS mow_height_in NUMERIC(3,1),
  -- Pet-safe chem only — gates which products show in the application calc.
  ADD COLUMN IF NOT EXISTS pet_safe_only BOOLEAN NOT NULL DEFAULT false,
  -- Has irrigation? If yes, drought-stretch logic should NOT auto-skip
  -- (their grass keeps growing during dry spells).
  ADD COLUMN IF NOT EXISTS irrigation_present BOOLEAN NOT NULL DEFAULT false,
  -- Crew safety / mower selection hint.
  ADD COLUMN IF NOT EXISTS slope_warning BOOLEAN NOT NULL DEFAULT false,
  -- Default disposition for clippings on this property.
  ADD COLUMN IF NOT EXISTS bag_clippings BOOLEAN NOT NULL DEFAULT false;

-- =====================================================================
-- 2. maintenance_plans — lawn-specific scheduling fields
--    interval_months CHECK from PressurePro is (3, 6, 12) and stays as-is
--    for billing cadence. Frequency below is the SERVICE cadence which is
--    independent — a customer can be on a 12-month billing plan that's
--    delivered weekly.
-- =====================================================================
ALTER TABLE public.maintenance_plans
  -- 0 = Sunday ... 6 = Saturday. Default route day for this property.
  ADD COLUMN IF NOT EXISTS day_of_week SMALLINT CHECK (day_of_week BETWEEN 0 AND 6),
  -- Service cadence — separate from billing cadence.
  ADD COLUMN IF NOT EXISTS frequency TEXT NOT NULL DEFAULT 'weekly'
    CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'fert_program')),
  -- Northern markets pause winter ('winter') or summer-vacation drops.
  -- Stored as a TEXT[] of season tokens: 'winter' | 'summer' | 'fall' | 'spring'.
  ADD COLUMN IF NOT EXISTS season_pause TEXT[] NOT NULL DEFAULT '{}',
  -- Distinguishes a recurring-mow plan from a fert-program plan.
  -- 'mow' is the default and matches today's PressurePro plans behavior.
  ADD COLUMN IF NOT EXISTS plan_kind TEXT NOT NULL DEFAULT 'mow'
    CHECK (plan_kind IN ('mow', 'fert_program', 'other'));

CREATE INDEX IF NOT EXISTS idx_plans_day_of_week
  ON public.maintenance_plans(day_of_week) WHERE status = 'active';

-- =====================================================================
-- 3. routes — an ordered list of property stops for one crew on one day
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  crew_id UUID REFERENCES public.crews(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_progress', 'complete', 'skipped')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  -- Snapshot at end-of-route so historical reports don't have to re-aggregate
  -- against constantly-changing route_stops. Optional; backfilled by an edge
  -- function or trigger when the route is marked complete.
  total_stops INTEGER,
  completed_stops INTEGER,
  total_miles NUMERIC(6,1),
  total_minutes INTEGER,
  total_collected_cents BIGINT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_routes_user_date ON public.routes(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_routes_crew_date ON public.routes(crew_id, date DESC);
ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own routes"   ON public.routes FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users insert own routes" ON public.routes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own routes" ON public.routes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own routes" ON public.routes FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER routes_updated_at BEFORE UPDATE ON public.routes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =====================================================================
-- 4. route_stops — the ordered visits on a route
--    A stop ties a route to a property and (optionally) the plan that
--    spawned it. Per-stop status is independent of route status so a route
--    can be 'in_progress' with 3 done / 1 skipped / 7 pending.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.route_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  route_id UUID NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES public.maintenance_plans(id) ON DELETE SET NULL,
  property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  -- Denormalized snapshot — survives plan/customer deletion so historical
  -- routes remain readable.
  address_snapshot TEXT,
  customer_name_snapshot TEXT,
  -- Display services from the plan at scheduling time, e.g. {'mow','edge','blow'}.
  services TEXT[] NOT NULL DEFAULT '{}',
  -- Expected fee in cents (avoids floating-point drift on bookkeeping math).
  fee_cents BIGINT,
  sort_order INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'done', 'skipped')),
  -- Why was it skipped? 'rain' | 'drought' | 'customer_travel' | 'gate_locked' | 'no_show' | 'other'
  skip_reason TEXT,
  arrived_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  -- Drive-time/miles FROM the previous stop. Populated by routing logic.
  drive_minutes_from_prev INTEGER,
  drive_miles_from_prev NUMERIC(5,2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (route_id, sort_order)
);
CREATE INDEX IF NOT EXISTS idx_stops_route_sort  ON public.route_stops(route_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_stops_user        ON public.route_stops(user_id);
CREATE INDEX IF NOT EXISTS idx_stops_plan        ON public.route_stops(plan_id);
CREATE INDEX IF NOT EXISTS idx_stops_property    ON public.route_stops(property_id);
ALTER TABLE public.route_stops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own stops"   ON public.route_stops FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users insert own stops" ON public.route_stops FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own stops" ON public.route_stops FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own stops" ON public.route_stops FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER stops_updated_at BEFORE UPDATE ON public.route_stops
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =====================================================================
-- 5. chemical_applications — pesticide/herbicide/fertilizer compliance log
--    Most US states require licensed applicators to log: product, EPA reg #,
--    rate, date/time/weather, applicator, customer notified. This is the
--    structured record; an export function can roll it up for annual reports.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.chemical_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  route_stop_id UUID REFERENCES public.route_stops(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applicator_name TEXT,
  applicator_license TEXT,
  -- Product details.
  product_name TEXT NOT NULL,
  epa_reg_number TEXT,
  active_ingredient TEXT,
  application_type TEXT NOT NULL
    CHECK (application_type IN ('fertilizer', 'herbicide', 'pesticide', 'fungicide', 'lime', 'other')),
  -- Rate as applied: e.g. "1.0 lb N / 1000 sqft" or "2 oz / gal".
  rate_amount NUMERIC(8,3),
  rate_unit TEXT,
  -- Total used across the application (bags / oz / gal).
  total_amount NUMERIC(10,3),
  total_unit TEXT,
  -- Area covered in sqft.
  area_sqft INTEGER,
  -- Weather at application time (regulatory requirement in many states).
  temperature_f NUMERIC(4,1),
  wind_mph NUMERIC(4,1),
  conditions TEXT, -- 'sunny' / 'cloudy' / 'after-rain' free text
  -- Notification of customer (required for some pesticides).
  customer_notified BOOLEAN NOT NULL DEFAULT false,
  signs_posted BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chem_user_applied ON public.chemical_applications(user_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_chem_property     ON public.chemical_applications(property_id);
CREATE INDEX IF NOT EXISTS idx_chem_route_stop   ON public.chemical_applications(route_stop_id);
ALTER TABLE public.chemical_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own chem apps"   ON public.chemical_applications FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users insert own chem apps" ON public.chemical_applications FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own chem apps" ON public.chemical_applications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own chem apps" ON public.chemical_applications FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER chem_updated_at BEFORE UPDATE ON public.chemical_applications
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMIT;

-- ========================================
-- Migration: 0002_seed_lawn_catalog.sql
-- ========================================

-- TurfPro — seed lawn-service catalog rows for a new user.
--
-- The catalog_items table already exists from PressurePro (it's the same DB).
-- This adds a helper that seeds lawn-care services for any user who doesn't
-- already have a populated catalog. Idempotent — re-running won't duplicate.

CREATE OR REPLACE FUNCTION private.seed_default_lawn_catalog(_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Skip if user already has any catalog rows (operator may have customized).
  IF EXISTS (SELECT 1 FROM public.catalog_items WHERE user_id = _user_id AND kind = 'service') THEN
    RETURN;
  END IF;

  INSERT INTO public.catalog_items (user_id, kind, name, unit, default_rate, min_charge, sort_order) VALUES
    -- Mow bundle — flat fee per visit is standard for residential lawn.
    (_user_id, 'service', 'Weekly mow',         'flat', 45,  45,  10),
    (_user_id, 'service', 'Biweekly mow',       'flat', 55,  55,  20),
    (_user_id, 'service', 'Edge',               'flat', 10,  10,  30),
    (_user_id, 'service', 'Trim',               'flat', 10,  10,  40),
    (_user_id, 'service', 'Blow',               'flat', 8,   8,   50),
    -- Seasonal one-offs.
    (_user_id, 'service', 'Spring cleanup',     'flat', 175, 175, 100),
    (_user_id, 'service', 'Fall cleanup',       'flat', 195, 195, 110),
    (_user_id, 'service', 'Leaf removal',       'flat', 145, 145, 120),
    (_user_id, 'service', 'Aeration',           'flat', 125, 125, 200),
    (_user_id, 'service', 'Overseed',           'flat', 165, 165, 210),
    (_user_id, 'service', 'Dethatching',        'flat', 145, 145, 220),
    (_user_id, 'service', 'Mulch install',      'flat', 75,  75,  230),
    -- Fert program — operators usually charge per visit; the 5-step is the round.
    (_user_id, 'service', 'Fert step 1 (pre-emergent)', 'flat', 85, 85, 300),
    (_user_id, 'service', 'Fert step 2 (weed + feed)',  'flat', 85, 85, 310),
    (_user_id, 'service', 'Fert step 3 (summer feed)',  'flat', 85, 85, 320),
    (_user_id, 'service', 'Fert step 4 (fall feed)',    'flat', 85, 85, 330),
    (_user_id, 'service', 'Fert step 5 (winterize)',    'flat', 85, 85, 340),
    -- Spot treatments.
    (_user_id, 'service', 'Weed control (spot)', 'flat', 65,  65,  400),
    (_user_id, 'service', 'Grub control',        'flat', 95,  95,  410),
    (_user_id, 'service', 'Lime application',    'flat', 75,  75,  420),
    -- Winter swap (northern markets).
    (_user_id, 'service', 'Snow plow (per visit)', 'flat', 75,  75,  900),
    (_user_id, 'service', 'Snow shovel (per visit)','flat', 55,  55,  910);
END;
$$;
REVOKE EXECUTE ON FUNCTION private.seed_default_lawn_catalog(UUID) FROM PUBLIC, anon, authenticated;

-- ========================================
-- Migration: 0003_stripe_billing.sql
-- ========================================

-- TurfPro — Stripe billing additions.
--
-- TurfPro shares PressurePro's Supabase project, so the `subscriptions`
-- table already exists (PressurePro brought it in) and we don't redefine
-- it here. This migration just ensures the supporting infrastructure is
-- in place and adds anything that may have been missed:
--
--   1. processed_stripe_events — idempotency table used by payments-webhook
--   2. Defensive index hints on subscriptions for fast lookups
--   3. RLS on subscriptions so users can only read their own row
--
-- Every statement is IF NOT EXISTS / OR REPLACE so this file is safe to
-- re-apply against an already-provisioned PressurePro project.

BEGIN;

-- =====================================================================
-- 1. processed_stripe_events
--    Webhook idempotency: payments-webhook inserts (event_id) before
--    processing; the unique constraint on the PK guarantees a single
--    successful insert when Stripe retries.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.processed_stripe_events (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  -- 'sandbox' | 'live' — separate streams so re-running test events in
  -- live (or vice versa) doesn't dedup against the wrong env.
  environment  TEXT NOT NULL DEFAULT 'sandbox'
    CHECK (environment IN ('sandbox', 'live')),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_processed_stripe_events_processed_at
  ON public.processed_stripe_events(processed_at DESC);

-- This table is service-role only. The edge functions run with the
-- service role key, so we enable RLS but write no policies — that locks
-- out anonymous + authenticated roles entirely.
ALTER TABLE public.processed_stripe_events ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- 2. subscriptions — additive indexes / RLS hardening
--    The table itself ships from PressurePro. We add indexes that the
--    TurfPro client + webhook hit hard.
-- =====================================================================

-- The Pricing page + SubscriptionGate query by (user_id, environment)
-- and order by created_at — a covering index makes that O(log n).
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_env_created
  ON public.subscriptions(user_id, environment, created_at DESC);

-- Webhook upserts by stripe_subscription_id; PressurePro already has the
-- unique constraint but we re-assert the index here defensively.
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub_id
  ON public.subscriptions(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- Ensure RLS is on (PressurePro should already have it; harmless re-run).
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- "Users can read their own subscriptions" — Pricing.tsx + SubscriptionGate
-- both read inline using the user's JWT, so the SELECT policy is required.
-- We don't write any INSERT/UPDATE/DELETE policies; only the service role
-- (edge functions) ever writes to this table.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'subscriptions'
       AND policyname = 'Users view own subscription'
  ) THEN
    CREATE POLICY "Users view own subscription"
      ON public.subscriptions
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;

COMMIT;

-- ========================================
-- Migration: 0004_weather_drive_cache.sql
-- ========================================

-- 0004_weather_drive_cache.sql
--
-- Adds the drive_matrix_cache table backing the drive-matrix edge function.
-- The weather_cache table already exists in the shared Supabase project
-- (created by PressurePro migration 20260502014522), so this migration only
-- adds the drive cache.
--
-- Cache semantics: keyed by SHA-256 hash of the ordered sequence
-- "lat,lng|lat,lng|...". Rows expire after 7 days (driving conditions are
-- structurally stable on that horizon — congestion is captured per-day by
-- Mapbox traffic, which we deliberately do not subscribe to here).
--
-- Access: service-role only. No RLS policies are defined, and with RLS
-- enabled that means authenticated/anon roles cannot read or write — exactly
-- the desired posture since the edge function uses the service role key.

BEGIN;

CREATE TABLE IF NOT EXISTS public.drive_matrix_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_hash TEXT NOT NULL UNIQUE,
  legs JSONB NOT NULL,  -- array of {from_idx, to_idx, minutes, miles}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE INDEX IF NOT EXISTS idx_drive_matrix_expires
  ON public.drive_matrix_cache(expires_at);

ALTER TABLE public.drive_matrix_cache ENABLE ROW LEVEL SECURITY;
-- Cache is service-role only. RLS denies all by default (no policies = no
-- access for authenticated/anon).

COMMIT;

-- ========================================
-- Migration: 0005_email_log.sql
-- ========================================

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

-- ========================================
-- Migration: 0006_onboarding.sql
-- ========================================

-- TurfPro — first-run onboarding marker.
--
-- The wizard at /onboarding writes profiles.onboarded_at on completion (or on
-- "Skip for now") so RequireOnboarded knows not to re-prompt. NULL = the user
-- has never finished (or skipped) the wizard and should be sent there before
-- they see any gated app surface. The column is added if-missing so this
-- migration is safe to re-run.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;

-- ========================================
-- Migration: 0007_gdd.sql
-- ========================================

-- 0007_gdd.sql
--
-- Adds the gdd_cache table backing the compute-gdd edge function.
--
-- Growing-Degree-Days is the agronomic measure that decides when crabgrass
-- pre-emergent herbicide should be applied. The compute-gdd edge function
-- composes today's GDD + an approximated YTD running total + a 7-day forward
-- projection, and stamps the resulting payload here keyed by ZIP. TTL is 6
-- hours which matches the upstream `weather_cache` cadence (forecast inputs
-- only refresh that often anyway).
--
-- We deliberately keep this table separate from `weather_cache` because:
--   1. The payload shape is computed (pre_emergent status, cumulative_gdd_ytd),
--      not raw weather, and we don't want to invalidate it whenever the
--      forecast cache turns over.
--   2. Keying includes base_f so a future "fungicide GDD" variant (base 65°F)
--      can coexist without a schema change.
--
-- Access: service-role only. No RLS policies are defined, and with RLS
-- enabled that means authenticated/anon roles cannot read or write — exactly
-- the desired posture since the edge function uses the service role key.

BEGIN;

CREATE TABLE IF NOT EXISTS public.gdd_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zip TEXT NOT NULL,
  base_f INTEGER NOT NULL DEFAULT 50,
  payload JSONB NOT NULL,            -- full response object
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '6 hours'),
  UNIQUE (zip, base_f)
);

CREATE INDEX IF NOT EXISTS idx_gdd_cache_expires
  ON public.gdd_cache(expires_at);

ALTER TABLE public.gdd_cache ENABLE ROW LEVEL SECURITY;
-- Service-role only — no policies = no access for authenticated/anon.

COMMIT;

-- ========================================
-- Migration: 0008_sms.sql
-- ========================================

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

-- ========================================
-- Migration: 0009_snow_swap.sql
-- ========================================

-- TurfPro — Snow swap mode (season state + pause reason tracking).
--
-- Northern-market operators pivot from mowing to snow removal in winter.
-- This migration introduces the per-operator season state and the ability
-- to distinguish auto-paused (winter swap) plans from manually-paused ones
-- so that flipping back to summer only resumes what we paused.
--
-- All changes are additive; existing rows pick up defaults and existing
-- queries are unaffected. Idempotent — safe to re-run.

BEGIN;

-- =====================================================================
-- 1. user_settings.season — single source of truth for an operator's
--    current season. Most operators only use the binary summer<->winter
--    swap, but the four-token enum keeps options open for fall/spring
--    transitional UX in a later release.
-- =====================================================================
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS season TEXT NOT NULL DEFAULT 'summer'
    CHECK (season IN ('spring', 'summer', 'fall', 'winter')),
  ADD COLUMN IF NOT EXISTS season_changed_at TIMESTAMPTZ;

-- =====================================================================
-- 2. maintenance_plans.pause_reason — explains WHY a plan is paused.
--    'winter_swap' means the season-swap auto-paused it; flipping back
--    to a non-winter season will auto-resume only these. Operator-driven
--    pauses ('customer_requested', 'card_failed', etc.) stay paused.
--
--    NULL by default — existing paused rows are treated as manually
--    paused (safe: they won't be auto-resumed). Operators can still
--    resume them by hand from Plans.
-- =====================================================================
ALTER TABLE public.maintenance_plans
  ADD COLUMN IF NOT EXISTS pause_reason TEXT;

-- Partial index — most plans have NULL pause_reason, so the index stays
-- small and only matters during the (rare) season-swap bulk update.
CREATE INDEX IF NOT EXISTS idx_plans_pause_reason
  ON public.maintenance_plans(user_id, pause_reason)
  WHERE pause_reason IS NOT NULL;

COMMIT;

-- ========================================
-- Migration: 0010_photo_pairs_lawn.sql
-- ========================================

ALTER TABLE public.photo_pairs
  ADD COLUMN IF NOT EXISTS route_stop_id UUID REFERENCES public.route_stops(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS public_gallery BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_photo_pairs_route_stop
  ON public.photo_pairs(route_stop_id) WHERE route_stop_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_photo_pairs_property_public
  ON public.photo_pairs(property_id) WHERE public_gallery = true;

-- ========================================
-- Migration: 0011_campaigns.sql
-- ========================================

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

-- ========================================
-- Migration: 0012_sms_drainer.sql
-- ========================================

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
