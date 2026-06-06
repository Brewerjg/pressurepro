-- =========================================================================
-- TurfPro — pending migrations bundle as of 2026-06-06
-- =========================================================================
--
-- Generated to catch the shared Supabase project up to TurfPro main.
-- Contains the three migrations the REST-API probe found missing on
-- 2026-06-06:
--
--     0017_time_tracking.sql      — route_stops time-attribution columns
--     0019_connect_ready.sql      — profiles Stripe Connect readiness flags
--     0020_application_fees.sql   — fees cache for the PAYG / Connect model
--
-- Skipped intentionally:
--   * 0014  (Quote agent chose a notes-field sentinel instead of a column)
--   * 0001–0013, 0015, 0016, 0018  (verified already applied)
--
-- All statements use IF NOT EXISTS guards (and the policy block uses
-- DROP IF EXISTS) so this is safe to re-run if any of these migrations
-- have already partially applied via another path.
--
-- Wrapped in a single transaction so a partial failure rolls back cleanly.
-- Paste into the Supabase SQL editor (Dashboard → SQL editor → New query).
-- =========================================================================

BEGIN;

-- =========================================================================
-- 0017_time_tracking.sql
-- Per-stop time tracking columns on route_stops.
-- =========================================================================
--
-- assigned_user_id — preps for multi-user crews. When a future crew member
-- taps Mark-done / Arrive, we attribute the timestamp to *their* user_id so
-- reports can break out per-employee on-site time. For the solo-operator
-- case today, this stays NULL and reports fall back to the route owner.
--
-- arrival_adjusted — flag for back-filled arrivals. Two back-fill paths
-- in the UI: automatic (Mark-done tapped without a prior Arrive — stamps
-- arrived_at = now() and sets this true) and manual (operator notices
-- "I forgot to clock arrival" and back-dates 5/10/15 minutes via picker).
-- The timestamp is still useful for ordering, just not load-bearing for
-- "how long were we on site."

ALTER TABLE public.route_stops
  ADD COLUMN IF NOT EXISTS assigned_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS arrival_adjusted BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_route_stops_assigned
  ON public.route_stops(assigned_user_id) WHERE assigned_user_id IS NOT NULL;


-- =========================================================================
-- 0019_connect_ready.sql
-- Stripe Connect Express onboarding state on profiles.
-- =========================================================================
--
-- profiles.stripe_account_id already exists (inherited from PressurePro's
-- original schema) and stores the acct_* id once the Express account has
-- been created. The presence of stripe_account_id alone is NOT enough to
-- know whether the operator can actually accept charges — Stripe requires
-- the AccountLink hosted form to be completed before charges_enabled flips
-- true. An operator may abandon the form halfway through and the row will
-- still show stripe_account_id without being payment-ready.
--
-- connect_ready (BOOLEAN) is the authoritative "this operator can take
-- money" flag. The connect-onboarding edge function flips it to true when
-- Stripe reports details_submitted && charges_enabled on the Express
-- account. Downstream Stripe-touching code (create-checkout-session with
-- application_fee_amount, create-plan-subscription, quote deposit charges)
-- should refuse to mint charges against operators whose connect_ready is
-- false — otherwise the funds have nowhere to settle.
--
-- connect_completed_at records when the operator finished onboarding, for
-- support-debug and reporting. Nullable because operators who never finish
-- never get a timestamp.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS connect_ready BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS connect_completed_at TIMESTAMPTZ;


-- =========================================================================
-- 0020_application_fees.sql
-- Cache of TurfPro application fees collected from Stripe Connect charges.
-- =========================================================================
--
-- Reports reads this to surface "TurfPro fees this month" + the Pro upgrade
-- callout. The Stripe Connect webhook (payments-webhook handleConnectEvent)
-- is the authoritative source — this table is the local cache so Reports
-- doesn't round-trip to Stripe on every render.
--
-- Rows are written by the webhook on:
--   * charge.succeeded (one-off charges — quote deposits, visit charges,
--     plan_one_time)
--   * invoice.payment_succeeded (recurring maintenance-plan invoices)
--
-- A row is written even when fee_amount_cents = 0 (paid-tier operators)
-- so Reports can show "$X in revenue, $0 in fees" without needing a
-- separate revenue table.

CREATE TABLE IF NOT EXISTS public.application_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Charge / invoice that produced the fee. We keep all three Stripe ids
  -- because depending on the source path, different ones are populated:
  -- one-off charges have charge_id + payment_intent_id; recurring invoices
  -- have invoice_id + charge_id.
  stripe_charge_id TEXT,
  stripe_invoice_id TEXT,
  stripe_payment_intent_id TEXT,

  -- Linked operator records (best-effort — set from charge.metadata when
  -- the originating edge fn stamped them). NULL when we couldn't map back.
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  plan_id UUID REFERENCES public.maintenance_plans(id) ON DELETE SET NULL,
  quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL,

  -- Amounts (cents). charge_amount is the gross customer payment;
  -- fee_amount is the slice TurfPro kept; fee_percent is the rate at the
  -- moment of capture (handy if the operator later upgrades — the row
  -- reflects their tier at the time, not now).
  charge_amount_cents BIGINT NOT NULL,
  fee_amount_cents BIGINT NOT NULL,
  fee_percent NUMERIC(4,2) NOT NULL,
  tier_at_capture TEXT NOT NULL,

  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_application_fees_user_collected
  ON public.application_fees(user_id, collected_at DESC);

ALTER TABLE public.application_fees ENABLE ROW LEVEL SECURITY;

-- Policies don't support IF NOT EXISTS, so drop-then-create for idempotency.
-- Users can see their own fee history; admins see everything for support.
-- INSERT is intentionally NOT exposed to authenticated users — the webhook
-- writes through the service role, which bypasses RLS.
DROP POLICY IF EXISTS "Users view own fees" ON public.application_fees;
CREATE POLICY "Users view own fees" ON public.application_fees
  FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));


COMMIT;

-- =========================================================================
-- Done. To verify after running:
--   SELECT 'route_stops.assigned_user_id'  AS check, 'ok' WHERE EXISTS (
--     SELECT 1 FROM information_schema.columns
--      WHERE table_name='route_stops' AND column_name='assigned_user_id'
--   )
--   UNION ALL
--   SELECT 'profiles.connect_ready', 'ok' WHERE EXISTS (
--     SELECT 1 FROM information_schema.columns
--      WHERE table_name='profiles' AND column_name='connect_ready'
--   )
--   UNION ALL
--   SELECT 'application_fees', 'ok' WHERE EXISTS (
--     SELECT 1 FROM information_schema.tables
--      WHERE table_name='application_fees'
--   );
-- All three rows should return.
-- =========================================================================
