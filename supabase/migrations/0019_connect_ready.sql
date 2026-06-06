-- 0019_connect_ready.sql
--
-- Stripe Connect Express onboarding state on profiles.
--
-- `profiles.stripe_account_id` already exists (inherited from PressurePro's
-- original schema) and stores the `acct_*` id once the operator's Express
-- account has been created. The presence of stripe_account_id alone is NOT
-- enough to know whether the operator can actually accept charges — Stripe
-- requires the account's hosted onboarding form (`AccountLink` flow) to be
-- completed before `charges_enabled` flips true. An operator may abandon
-- the form halfway through and the row will still show stripe_account_id
-- without being payment-ready.
--
-- `connect_ready` (BOOLEAN) is the authoritative "this operator can take
-- money" flag. The `connect-onboarding` edge function flips it to true
-- when Stripe reports `details_submitted && charges_enabled` on the
-- Express account. Downstream Stripe-touching code (create-checkout-session
-- with application_fee_amount, create-plan-subscription, quote deposit
-- charges) should refuse to mint charges against operators whose
-- connect_ready is false — otherwise the funds have nowhere to settle.
--
-- `connect_completed_at` records when the operator finished onboarding,
-- for support-debug and reporting (e.g. "how long after signup did the
-- median operator complete Connect?"). Nullable because operators who
-- never finish never get a timestamp.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS connect_ready BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS connect_completed_at TIMESTAMPTZ;
