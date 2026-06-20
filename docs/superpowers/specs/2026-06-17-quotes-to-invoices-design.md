# Quotes → Invoices — Design Spec

**Date:** 2026-06-17
**Status:** Approved design, pending spec review → implementation plan

## Problem

When a client accepts a quote, the job should become an **invoice** — a thing the
operator is now owed money for and must fulfill. Today there is no invoice
concept: a single `quotes` table carries a status enum
(`draft → sent → accepted → scheduled → complete → paid`), and the `Quotes`
screen shows accepted jobs and open proposals in one list, distinguished only by
a status pill. Accepted work isn't promoted out of the quote pile, so operators
lose track of what's been won and what's still owed.

## Decisions (locked with the user)

1. **Separate invoice records.** Acceptance creates a distinct `invoices` entity
   linked to the quote. The quote becomes a frozen historical proposal.
2. **Invoice owns the money + fulfillment lifecycle.** Quote lifecycle ends at
   `accepted`. Deposit, payments, paid state, and job completion live on the
   invoice. Manual payments move to `invoice_id`.
3. **New "Invoices" screen**, surfaced next to "Quotes" (a Home quick-link card —
   see §UI; Quotes is not in the 5-slot bottom `TabBar`).
4. **Sequential invoice numbers per operator** — `INV-1001`, assigned at creation.
5. **Backfill** existing `accepted/scheduled/complete/paid` quotes into invoices.
6. **Two independent status axes:** `status` (money: `open` → `paid`, plus `void`)
   and `completed_at` (job done). A job can be done-but-unpaid or paid-but-not-done.
7. **Customer-facing invoice page is in v1** — a public, shareable/printable
   invoice (reusing the existing public-link / print patterns).

## Data model

### New table: `invoices`

```
invoices
  id              uuid pk default gen_random_uuid()
  user_id         uuid not null            -- operator (RLS owner)
  app             text not null            -- 'turfpro' | 'pressurepro' (matches quotes.app)
  quote_id        uuid not null unique references quotes(id)
  invoice_number  int  not null            -- sequential per (user_id, app) → rendered "INV-1001"
  public_token    uuid not null default gen_random_uuid()  -- shareable customer link
  -- snapshot of the quote at acceptance:
  customer_id     uuid null
  customer_name   text
  address         text null
  phone           text null
  customer_email  text null
  lines           jsonb not null
  total           numeric not null
  deposit_amount  numeric null
  deposit_paid_at timestamptz null
  -- lifecycle (two axes):
  status          invoice_status not null default 'open'   -- 'open' | 'paid' | 'void'
  completed_at    timestamptz null
  issued_at       timestamptz not null default now()       -- = acceptance time
  created_at      timestamptz not null default now()
  updated_at      timestamptz not null default now()
```

- `create type invoice_status as enum ('open','paid','void');`
- **Amount paid is derived**, not stored: sum of non-voided `manual_payments`
  (by `invoice_id`) + Stripe-recorded payments + deposit. "Partial" is a UI badge
  when `0 < paid < total`; it is not an enum value (keeps the enum minimal).
- Snapshotting customer/lines/total means editing the historical quote never
  mutates the invoice document.

### Per-operator numbering: `invoice_counters`

```
invoice_counters
  user_id     uuid not null
  app         text not null
  next_number int  not null default 1001
  primary key (user_id, app)
```

Keyed by `(user_id, app)` because one operator login spans both TurfPro and
PressurePro, and each app gets its own `INV-####` sequence. Incremented
atomically inside the creation trigger (`... for update` / upsert returning) so
concurrent acceptances can't collide on a number.

### Changes to existing tables

- `quotes.invoice_id uuid null references invoices(id)` — back-link for the
  "View invoice" affordance. Quotes stop using post-`accepted` statuses.
- `manual_payments.invoice_id uuid null references invoices(id)` — payments now
  attach to invoices. `quote_id` retained for back-compat / history.

## Invoice creation — DB trigger (chosen approach)

A trigger on `quotes` fires when `status` transitions to `accepted` and no
invoice exists for the quote:

- reads & increments the operator's `invoice_counters.next_number`,
- inserts the `invoices` row (snapshot of customer/lines/total/deposit),
- sets `quotes.invoice_id`.

**Why a trigger** (vs. creating the invoice in the Accept page or an edge
function): acceptance happens on **two paths** — the customer clicks "Accept" on
the public `/accept/:id` page (`status → accepted`), and the operator taps
"Accepted" in `QuoteDetail`. A trigger covers both paths atomically, is
idempotent via `unique(quote_id)` (re-accepting can't double-create), and keeps
numbering race-free in one place. Client/edge creation would duplicate logic
across both paths and risk counter races.

## Lifecycle handoff

**QuoteDetail** (after accepted) becomes read-only proposal history:
- keeps: Send/Resend, Print, Copy public link, Duplicate, Cancel quote
- removes: Mark-status (accepted/complete/paid), Record-payment, deposit display,
  Convert-to-plan
- gains: prominent **"Invoice INV-1001 →"** link

**InvoiceDetail** (new) is the money + fulfillment surface:
- Record payment (manual), with the existing "cumulative ≥ total → mark paid"
  prompt logic ported from QuoteDetail
- Mark paid / Mark complete (`completed_at`)
- Deposit status
- **Convert-to-plan moves here** (recurring service is a post-acceptance action)
- Link back to source quote; customer-facing invoice link + print

## Stripe deposit integration

The public Accept page can take a deposit via `create-checkout-session`. Since the
invoice now owns deposits:
- `create-checkout-session` (kind `deposit`) looks up `invoice_id` from the quote
  and attaches it to session metadata (keeps `quote_id` too).
- `payments-webhook` on deposit/charge success with `invoice_id` metadata sets
  `invoices.deposit_paid_at` and records a payment row with `invoice_id`, then
  recomputes invoice `status`.

## Customer-facing invoice page (v1)

- Public route `/invoice/:token` (resolves `invoices.public_token`, no auth),
  reusing the `/accept` + `QuotePrint` presentation patterns.
- Shows: invoice number, operator/business, customer, line items, total, amount
  paid / amount due, paid + complete state, and (if a balance remains and Stripe
  is wired) a "Pay balance" button via `create-checkout-session`.
- Print variant `/invoice/:token/print` mirroring `/accept/:id/print`.

## Backfill migration

For every quote with status in (`accepted`, `scheduled`, `complete`, `paid`):
- create its invoice, numbered per `(operator, app)` by `created_at` order (seed
  each `invoice_counters` row to max+1 afterward),
- snapshot customer/lines/total, copy `deposit_amount`/`deposit_paid_at`,
- map status: `paid → status 'paid'`; `complete → completed_at set` (status
  derived from payments: `paid` if cumulative ≥ total, else `open`);
  `accepted/scheduled → status 'open'`,
- set `quotes.invoice_id`,
- repoint `manual_payments.invoice_id` where `quote_id` matches.

Result: the Invoices screen shows real history on day one.

## UI / navigation

- **Home:** add an "Invoices" quick-link card next to the existing "Quotes" card
  (`src/pages/Home.tsx` action grid).
- **`/invoices`** (`Invoices.tsx`): list with tabs **Unpaid / Paid / All**; header
  shows open count + outstanding $ (mirrors `Quotes.tsx`). Row shows
  `INV-####`, customer, total, amount due, status pill + optional "Complete" badge.
- **`/invoices/:id`** (`InvoiceDetail.tsx`): the surface described in
  "Lifecycle handoff".
- New routes in `App.tsx` (operator routes under `Protected`; public invoice
  routes alongside `/accept`).

## Security / RLS

- `invoices` RLS: operator can select/update only `user_id = auth.uid()`.
  Inserts happen via the trigger (security definer) — no direct client insert.
- Public invoice page reads a single invoice by `public_token` via a security
  -definer RPC or a narrow policy, exposing only display fields (mirrors how
  `/accept` reads a quote by id today).
- `invoice_counters` not client-accessible (trigger-only).

## Testing

- Trigger: accepting a quote creates exactly one invoice with the next per
  -operator number; re-accepting is idempotent (no duplicate).
- Numbering: two operators get independent sequences; concurrent accepts don't
  collide.
- Backfill: invoice count == eligible-quote count; numbering contiguous per
  operator; `manual_payments.invoice_id` repointed.
- Payments: cumulative manual payments ≥ total flips `status → paid`.
- RLS: operator cannot read another operator's invoices; public token reads only
  the one invoice.

## Build order (for the implementation plan)

1. Schema migration: `invoices` table, `invoice_status` enum, `invoice_counters`,
   `quotes.invoice_id`, `manual_payments.invoice_id`, creation trigger, RLS,
   public-read RPC/policy.
2. Backfill migration.
3. Regenerate Supabase types.
4. `manual-payments.ts`: `invoice_id` support + `listManualPaymentsForInvoice`.
5. Invoices list + detail pages + routes + Home card.
6. QuoteDetail strip-down + "View invoice" link.
7. Customer-facing public invoice page + print.
8. Stripe `create-checkout-session` + `payments-webhook` `invoice_id` wiring.
9. Tests (trigger idempotency, backfill counts, RLS, cumulative→paid) + deploy.

## Out of scope (future)

- Due dates / overdue tracking and reminders.
- Quote `declined`/`expired` explicit states (today "Cancel quote" hacks notes).
- Multi-invoice-per-quote (partial billing / progress invoices).
- Tax/discount lines beyond what `quotes.lines` already carries.
