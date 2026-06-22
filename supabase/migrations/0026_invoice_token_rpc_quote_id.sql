-- 0026_invoice_token_rpc_quote_id.sql
--
-- Fix-forward for the public invoice page (/invoice/:token).
--
-- 0023 shipped get_invoice_by_token(uuid) but its RETURNS TABLE omitted
-- quote_id. The customer-facing "Pay balance" / "Pay deposit" buttons call
-- create-checkout-session with { quote_id, kind }, and the edge function
-- derives the invoice + balance from that quote_id. Without quote_id on the
-- public read, the homeowner can view the invoice but cannot pay it.
--
-- This re-declares the function with quote_id added to the return shape.
-- Everything else is identical to 0023 §6. Security definer + STABLE + the
-- anon/authenticated GRANT are preserved.
--
-- We DROP first because Postgres refuses CREATE OR REPLACE when the RETURNS
-- TABLE shape changes (error 42P13 "cannot change return type"). DROP + CREATE
-- is the supported path for altering a function's return columns.
--
-- Safe to re-run.

BEGIN;

DROP FUNCTION IF EXISTS public.get_invoice_by_token(UUID);

CREATE OR REPLACE FUNCTION public.get_invoice_by_token(p_token UUID)
RETURNS TABLE (
  id              UUID,
  user_id         UUID,
  app             TEXT,
  quote_id        UUID,
  invoice_number  INTEGER,
  public_token    UUID,
  customer_name   TEXT,
  address         TEXT,
  phone           TEXT,
  customer_email  TEXT,
  lines           JSONB,
  total           NUMERIC,
  deposit_amount  NUMERIC,
  deposit_paid_at TIMESTAMPTZ,
  status          public.invoice_status,
  completed_at    TIMESTAMPTZ,
  issued_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.id, i.user_id, i.app, i.quote_id, i.invoice_number, i.public_token,
    i.customer_name, i.address, i.phone, i.customer_email,
    i.lines, i.total, i.deposit_amount, i.deposit_paid_at,
    i.status, i.completed_at, i.issued_at, i.created_at
  FROM public.invoices i
  WHERE i.public_token = p_token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_invoice_by_token(UUID) TO anon, authenticated;

COMMENT ON FUNCTION public.get_invoice_by_token(UUID) IS
  'Public customer-facing read of a single invoice by public_token. Security definer so the anon /invoice/:token page can fetch display fields (incl. quote_id, needed by the Pay balance/deposit checkout) without RLS access to the invoices table.';

COMMIT;
