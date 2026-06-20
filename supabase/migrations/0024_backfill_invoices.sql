-- 0024_backfill_invoices.sql
--
-- Backfill: create invoices for every quote that has already moved past the
-- proposal stage, so the Invoices screen shows real history on day one.
--
-- Eligible quote statuses: accepted, scheduled, complete, paid.
-- Numbering: per (user_id, app), assigned by quotes.created_at order, starting
--   at 1001 (matching invoice_counters' default seed).
-- Snapshot: customer / lines / total, plus deposit_amount / deposit_paid_at.
-- Status mapping (money axis):
--   paid                 → status 'paid'
--   complete             → completed_at set; status 'paid' iff cumulative
--                          non-voided manual_payments (by quote_id) >= total,
--                          else 'open'
--   accepted / scheduled → status 'open'
-- Side effects:
--   * quotes.invoice_id set to the new invoice
--   * manual_payments.invoice_id repointed where quote_id matches
--   * invoice_counters seeded to max(invoice_number)+1 per (user_id, app)
--
-- Idempotent: skips quotes that already have an invoice (invoices.quote_id is
-- unique), so re-running only fills gaps. Counter reseed is a recompute, safe
-- to re-run.
--
-- NOTE: manual_payments.amount_cents is in CENTS; quotes.total is in DOLLARS.
-- The cumulative-paid comparison converts total → cents (total * 100).

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Insert invoices for eligible quotes that don't have one yet.
--    Numbering: dense rank over created_at within (user_id, app), offset by
--    any invoices already present for that (user_id, app) so re-runs and
--    trigger-created rows don't collide on invoice_number.
-- ---------------------------------------------------------------------
WITH eligible AS (
  SELECT
    q.id            AS quote_id,
    q.user_id,
    q.app,
    q.customer_id,
    q.customer_name,
    q.address,
    q.phone,
    q.customer_email,
    q.lines,
    q.total,
    q.deposit_amount,
    q.deposit_paid_at,
    q.status        AS quote_status,
    q.created_at,
    -- Cumulative non-voided manual payments for this quote, in cents.
    COALESCE((
      SELECT SUM(mp.amount_cents)
      FROM public.manual_payments mp
      WHERE mp.quote_id = q.id
        AND mp.status <> 'voided'
    ), 0)           AS paid_cents
  FROM public.quotes q
  WHERE q.status IN ('accepted', 'scheduled', 'complete', 'paid')
    AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.quote_id = q.id)
),
-- Starting number per (user_id, app): max existing invoice_number + 1, else 1001.
base AS (
  SELECT
    e.user_id,
    e.app,
    COALESCE(
      (SELECT MAX(i.invoice_number) FROM public.invoices i
        WHERE i.user_id = e.user_id AND i.app = e.app),
      1000
    ) AS base_number
  FROM eligible e
  GROUP BY e.user_id, e.app
),
numbered AS (
  SELECT
    e.*,
    b.base_number
      + ROW_NUMBER() OVER (
          PARTITION BY e.user_id, e.app
          ORDER BY e.created_at ASC, e.quote_id ASC
        ) AS invoice_number
  FROM eligible e
  JOIN base b ON b.user_id = e.user_id AND b.app = e.app
)
INSERT INTO public.invoices (
  user_id, app, quote_id, invoice_number,
  customer_id, customer_name, address, phone, customer_email,
  lines, total, deposit_amount, deposit_paid_at,
  status, completed_at, issued_at, created_at
)
SELECT
  n.user_id,
  n.app,
  n.quote_id,
  n.invoice_number,
  n.customer_id,
  COALESCE(n.customer_name, ''),
  n.address,
  n.phone,
  n.customer_email,
  COALESCE(n.lines, '[]'::jsonb),
  COALESCE(n.total, 0),
  n.deposit_amount,
  n.deposit_paid_at,
  -- Money-axis status.
  CASE
    WHEN n.quote_status = 'paid' THEN 'paid'::public.invoice_status
    WHEN n.quote_status = 'complete'
         AND n.paid_cents >= ROUND(COALESCE(n.total, 0) * 100)
      THEN 'paid'::public.invoice_status
    ELSE 'open'::public.invoice_status
  END,
  -- Fulfillment axis: completed_at set for complete (and paid implies done).
  CASE
    WHEN n.quote_status IN ('complete', 'paid') THEN COALESCE(n.created_at, now())
    ELSE NULL
  END,
  COALESCE(n.created_at, now()),  -- issued_at ~ acceptance; best proxy is created_at
  COALESCE(n.created_at, now())
FROM numbered n
ON CONFLICT (quote_id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Back-link quotes.invoice_id for the rows we just created (and any
--    pre-existing invoice whose quote isn't yet linked).
-- ---------------------------------------------------------------------
UPDATE public.quotes q
SET invoice_id = i.id
FROM public.invoices i
WHERE i.quote_id = q.id
  AND q.invoice_id IS DISTINCT FROM i.id;

-- ---------------------------------------------------------------------
-- 3. Repoint manual_payments.invoice_id where quote_id matches an invoice.
--    Only touch rows that aren't already pointed (idempotent).
-- ---------------------------------------------------------------------
UPDATE public.manual_payments mp
SET invoice_id = i.id
FROM public.invoices i
WHERE i.quote_id = mp.quote_id
  AND mp.quote_id IS NOT NULL
  AND mp.invoice_id IS DISTINCT FROM i.id;

-- ---------------------------------------------------------------------
-- 4. Seed invoice_counters to max(invoice_number)+1 per (user_id, app).
--    Recompute from the invoices table so the next trigger-minted number
--    continues the sequence without collision. Re-runnable.
-- ---------------------------------------------------------------------
INSERT INTO public.invoice_counters (user_id, app, next_number)
SELECT i.user_id, i.app, MAX(i.invoice_number) + 1
FROM public.invoices i
GROUP BY i.user_id, i.app
ON CONFLICT (user_id, app) DO UPDATE
  SET next_number = GREATEST(
    public.invoice_counters.next_number,
    EXCLUDED.next_number
  );

COMMIT;

-- ---------------------------------------------------------------------
-- Verification (uncomment + run after applying):
-- ---------------------------------------------------------------------
-- -- invoice count == eligible-quote count
-- SELECT
--   (SELECT count(*) FROM public.quotes
--      WHERE status IN ('accepted','scheduled','complete','paid')) AS eligible,
--   (SELECT count(*) FROM public.invoices) AS invoices;
-- -- numbering contiguous per (user_id, app)
-- SELECT user_id, app, min(invoice_number), max(invoice_number), count(*)
--   FROM public.invoices GROUP BY user_id, app;
-- -- manual_payments repointed
-- SELECT count(*) FROM public.manual_payments
--   WHERE quote_id IS NOT NULL AND invoice_id IS NULL;  -- expect 0 where quote has an invoice
-- -- counters ahead of max number
-- SELECT c.user_id, c.app, c.next_number, max(i.invoice_number)
--   FROM public.invoice_counters c JOIN public.invoices i
--     ON i.user_id = c.user_id AND i.app = c.app
--   GROUP BY c.user_id, c.app, c.next_number;
