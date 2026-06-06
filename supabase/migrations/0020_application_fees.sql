-- 0020_application_fees.sql
--
-- Cache of TurfPro's application fees collected from Stripe Connect charges.
-- Reports reads this to surface "TurfPro fees this month" + the Pro upgrade
-- callout. The Stripe Connect webhook (payments-webhook handleConnectEvent)
-- is the authoritative source — this table is the local cache so the
-- Reports page doesn't have to round-trip to Stripe on every render.
--
-- Rows are written by the webhook on:
--   * charge.succeeded (one-off charges — quote deposits, visit charges,
--     plan_one_time)
--   * invoice.payment_succeeded (recurring maintenance-plan invoices)
--
-- A row is written even when fee_amount_cents = 0 (paid-tier operators)
-- so Reports can show "$X in revenue, $0 in fees" without needing a
-- separate revenue table.

CREATE TABLE public.application_fees (
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_application_fees_user_collected
  ON public.application_fees(user_id, collected_at DESC);

ALTER TABLE public.application_fees ENABLE ROW LEVEL SECURITY;

-- Users can see their own fee history; admins see everything for support.
-- INSERT is intentionally NOT exposed to authenticated users — the webhook
-- writes through the service role, which bypasses RLS.
CREATE POLICY "Users view own fees" ON public.application_fees
  FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
