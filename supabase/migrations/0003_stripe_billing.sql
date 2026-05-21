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
