-- 0023_invoices.sql
--
-- Quotes → Invoices. When a client accepts a quote, the job becomes an
-- *invoice* — a distinct record that owns the money + fulfillment lifecycle.
-- The quote becomes a frozen historical proposal; the invoice snapshots the
-- customer / line items / total at acceptance so editing the quote later never
-- mutates the invoice document.
--
-- See docs/superpowers/specs/2026-06-17-quotes-to-invoices-design.md.
--
-- This migration:
--   * defines the invoice_status enum ('open' | 'paid' | 'void'),
--   * creates the `invoices` table (snapshot + two-axis lifecycle),
--   * creates the per-(operator,app) `invoice_counters` numbering table,
--   * adds back-link columns quotes.invoice_id and manual_payments.invoice_id,
--   * wires RLS: operators read/update only their own; NO direct client insert
--     (inserts happen only via the security-definer creation trigger),
--   * exposes a public-read RPC get_invoice_by_token(uuid) for the customer
--     -facing /invoice/:token page (mirrors how /accept reads a quote + the
--     public_business_info RPC pattern),
--   * installs the AFTER INSERT/UPDATE trigger on quotes that atomically mints
--     the next invoice number and snapshots the invoice when a quote becomes
--     'accepted'. Idempotent via unique(quote_id); security definer.
--
-- Safe to re-run. Idempotent on type / table / column / policy / function.

BEGIN;

-- ---------------------------------------------------------------------
-- 1. invoice_status enum
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status') THEN
    CREATE TYPE public.invoice_status AS ENUM ('open', 'paid', 'void');
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. invoices table
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- App discriminator — matches quotes.app ('turfpro' | 'pressurepro').
  app             TEXT NOT NULL DEFAULT 'turfpro',
  -- One invoice per quote. The unique constraint is what makes the creation
  -- trigger idempotent (re-accepting can't double-create).
  quote_id        UUID NOT NULL UNIQUE REFERENCES public.quotes(id) ON DELETE CASCADE,
  -- Sequential per (user_id, app) → rendered "INV-1001" in the UI.
  invoice_number  INTEGER NOT NULL,
  -- Shareable customer link target (no auth; resolved via get_invoice_by_token).
  public_token    UUID NOT NULL DEFAULT gen_random_uuid(),
  -- Snapshot of the quote at acceptance.
  customer_id     UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name   TEXT NOT NULL DEFAULT '',
  address         TEXT,
  phone           TEXT,
  customer_email  TEXT,
  lines           JSONB NOT NULL DEFAULT '[]'::jsonb,
  total           NUMERIC NOT NULL DEFAULT 0,
  deposit_amount  NUMERIC,
  deposit_paid_at TIMESTAMPTZ,
  -- Two independent lifecycle axes (money vs. fulfillment).
  status          public.invoice_status NOT NULL DEFAULT 'open',
  completed_at    TIMESTAMPTZ,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Numbers are unique within an operator's app sequence.
  CONSTRAINT invoices_user_app_number_key UNIQUE (user_id, app, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_invoices_user_app_created
  ON public.invoices(user_id, app, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_quote
  ON public.invoices(quote_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_public_token
  ON public.invoices(public_token);
CREATE INDEX IF NOT EXISTS idx_invoices_customer
  ON public.invoices(customer_id);

COMMENT ON TABLE public.invoices IS
  'Accepted-quote → invoice. Snapshots customer/lines/total at acceptance; owns the money (status) + fulfillment (completed_at) lifecycle. Inserted only by tg_create_invoice_on_accept (security definer).';
COMMENT ON COLUMN public.invoices.app IS
  'App that owns this invoice. Values: turfpro | pressurepro. Mirrors quotes.app for the numbering sequence + list filtering.';
COMMENT ON COLUMN public.invoices.public_token IS
  'Unguessable token for the public /invoice/:token customer page. Resolved via get_invoice_by_token().';

-- ---------------------------------------------------------------------
-- 3. invoice_counters — per-(operator, app) sequential numbering
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_counters (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app         TEXT NOT NULL DEFAULT 'turfpro',
  next_number INTEGER NOT NULL DEFAULT 1001,
  PRIMARY KEY (user_id, app)
);

COMMENT ON TABLE public.invoice_counters IS
  'Per-(operator, app) invoice number sequence. Trigger-only — NOT client accessible (no RLS policies granted). Incremented atomically inside tg_create_invoice_on_accept.';

-- ---------------------------------------------------------------------
-- 4. Back-link columns on existing tables
-- ---------------------------------------------------------------------
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.quotes.invoice_id IS
  'Back-link to the invoice minted when this quote was accepted. Set by tg_create_invoice_on_accept.';

ALTER TABLE public.manual_payments
  ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_manual_payments_invoice
  ON public.manual_payments(invoice_id);
COMMENT ON COLUMN public.manual_payments.invoice_id IS
  'Invoice this payment is applied to. quote_id retained for back-compat / history.';

-- ---------------------------------------------------------------------
-- 5. RLS — operators select/update own only; NO direct insert/delete.
--    Inserts come exclusively from the security-definer creation trigger.
-- ---------------------------------------------------------------------
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY; -- deny-by-default (no policies)

DROP POLICY IF EXISTS "Users view own invoices" ON public.invoices;
CREATE POLICY "Users view own invoices" ON public.invoices
  FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users update own invoices" ON public.invoices;
CREATE POLICY "Users update own invoices" ON public.invoices
  FOR UPDATE USING (auth.uid() = user_id);

-- Intentionally NO INSERT / DELETE policy: client inserts are blocked; the
-- creation trigger (security definer) bypasses RLS to write rows.

CREATE TRIGGER invoices_updated_at BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- 6. Public-read RPC — resolve one invoice by public_token (no auth).
--    Mirrors the /accept access model: anon reads a single display row by an
--    unguessable token. Returns only customer-facing display fields.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_invoice_by_token(p_token UUID)
RETURNS TABLE (
  id              UUID,
  user_id         UUID,
  app             TEXT,
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
    i.id, i.user_id, i.app, i.invoice_number, i.public_token,
    i.customer_name, i.address, i.phone, i.customer_email,
    i.lines, i.total, i.deposit_amount, i.deposit_paid_at,
    i.status, i.completed_at, i.issued_at, i.created_at
  FROM public.invoices i
  WHERE i.public_token = p_token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_invoice_by_token(UUID) TO anon, authenticated;

COMMENT ON FUNCTION public.get_invoice_by_token(UUID) IS
  'Public customer-facing read of a single invoice by public_token. Security definer so the anon /invoice/:token page can fetch display fields without RLS access to the invoices table.';

-- ---------------------------------------------------------------------
-- 7. Creation trigger — mint invoice when a quote becomes 'accepted'.
--    Fires AFTER INSERT OR UPDATE on quotes. Atomically takes the next
--    invoice_counters.next_number for (user_id, app), inserts the snapshot,
--    and sets quotes.invoice_id. Idempotent via unique(quote_id).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_create_invoice_on_accept()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_number  INTEGER;
  v_invoice UUID;
BEGIN
  -- Only act on the accepted transition. On UPDATE, skip if status didn't
  -- change into 'accepted' (avoids re-firing on unrelated column updates).
  IF NEW.status IS DISTINCT FROM 'accepted' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'accepted' THEN
    RETURN NEW;
  END IF;

  -- Idempotency guard: bail if an invoice already exists for this quote.
  IF EXISTS (SELECT 1 FROM public.invoices WHERE quote_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Atomically reserve the next number for (user_id, app). The upsert locks
  -- the counter row; concurrent accepts serialize on the PK and each gets a
  -- distinct number. We RETURN the post-statement next_number, then claim
  -- (next_number - 1) as this invoice's number:
  --   * first INSERT path:  VALUES seeds next_number=1002 → claim 1001
  --   * ON CONFLICT path:   next_number := old+1          → claim old
  INSERT INTO public.invoice_counters (user_id, app, next_number)
    VALUES (NEW.user_id, NEW.app, 1002)
  ON CONFLICT (user_id, app) DO UPDATE
    SET next_number = public.invoice_counters.next_number + 1
  RETURNING (public.invoice_counters.next_number - 1) INTO v_number;

  INSERT INTO public.invoices (
    user_id, app, quote_id, invoice_number,
    customer_id, customer_name, address, phone, customer_email,
    lines, total, deposit_amount, deposit_paid_at,
    status, issued_at
  ) VALUES (
    NEW.user_id, NEW.app, NEW.id, v_number,
    NEW.customer_id, COALESCE(NEW.customer_name, ''), NEW.address, NEW.phone, NEW.customer_email,
    COALESCE(NEW.lines, '[]'::jsonb), COALESCE(NEW.total, 0), NEW.deposit_amount, NEW.deposit_paid_at,
    'open', now()
  )
  ON CONFLICT (quote_id) DO NOTHING
  RETURNING id INTO v_invoice;

  -- Set the back-link on the quote (only if we actually created the invoice).
  IF v_invoice IS NOT NULL THEN
    UPDATE public.quotes SET invoice_id = v_invoice WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotes_create_invoice ON public.quotes;
CREATE TRIGGER quotes_create_invoice
  AFTER INSERT OR UPDATE OF status ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.tg_create_invoice_on_accept();

COMMENT ON FUNCTION public.tg_create_invoice_on_accept() IS
  'Mints an invoice (snapshot + next per-operator number) when a quote becomes accepted, on either the public /accept path or the operator QuoteDetail path. Idempotent via invoices.quote_id unique. Security definer to write invoices/invoice_counters under deny-by-default RLS.';

COMMIT;

-- ---------------------------------------------------------------------
-- Verification (uncomment + run after applying):
-- ---------------------------------------------------------------------
-- SELECT enumlabel FROM pg_enum
--   JOIN pg_type t ON t.oid = enumtypid WHERE t.typname = 'invoice_status';
--   -- expect open / paid / void
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'invoices' ORDER BY ordinal_position;
-- SELECT tgname FROM pg_trigger WHERE tgname = 'quotes_create_invoice';
