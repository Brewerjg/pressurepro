-- 0015_manual_payments.sql
--
-- Manual (offline) payment intake. Stripe handles plan billing and one-off
-- charges via the existing flows; this table is the bucket for cash, checks,
-- Venmo, CashApp, Zelle and other money the operator collects out-of-band so
-- it shows up in Reports MRR / lifetime totals and the operator stops seeing
-- "next charge due" on a plan that's already been paid in cash.
--
-- Linkage is intentionally loose — a payment may be tied to any combination
-- of customer / plan / route_stop / quote (or none, for catch-all entries).
-- Reconciliation status lets the operator mark when checks have been
-- deposited at the bank; the UI for that flip is a v1.5 concern.

CREATE TABLE public.manual_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  plan_id UUID REFERENCES public.maintenance_plans(id) ON DELETE SET NULL,
  route_stop_id UUID REFERENCES public.route_stops(id) ON DELETE SET NULL,
  quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL,
  method TEXT NOT NULL CHECK (method IN ('cash', 'check', 'venmo', 'cashapp', 'zelle', 'ach_offline', 'other')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  check_number TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  -- Reconciliation status. 'recorded' is the default; 'deposited' lets the
  -- operator mark when they took the checks to the bank.
  status TEXT NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded', 'deposited', 'voided')),
  deposited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_manual_payments_user_received
  ON public.manual_payments(user_id, received_at DESC);
CREATE INDEX idx_manual_payments_route_stop
  ON public.manual_payments(route_stop_id);
CREATE INDEX idx_manual_payments_customer
  ON public.manual_payments(customer_id);

ALTER TABLE public.manual_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own manual payments" ON public.manual_payments
  FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users insert own manual payments" ON public.manual_payments
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own manual payments" ON public.manual_payments
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own manual payments" ON public.manual_payments
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER manual_payments_updated_at BEFORE UPDATE ON public.manual_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
