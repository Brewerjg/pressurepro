# QuickBooks Phase 2 — invoice & payment sync (design)

Status: approved design, ready for implementation planning.
Date: 2026-06-30.

## Context

Phase 1 (the OAuth "connect foundation") is built, deployed, and verified: an
operator connects their QuickBooks Online (QBO) company from **Settings →
Integrations**, and the `quickbooks-oauth` edge function stores the
access/refresh tokens server-side in `public.quickbooks_connections` (RLS on,
no policies — tokens never reach the browser). A `refreshIfNeeded()` helper
already lives in that function, written for Phase 2 to call before any QBO API
request.

Phase 1 stores the connection but **syncs nothing**. This spec defines Phase 2:
pushing a TurfPro invoice — and its payments — into the operator's QuickBooks
company.

### Relevant existing data model

- `invoices`: `id`, `user_id`, `app`, `quote_id`, `invoice_number`,
  `customer_id` (nullable FK → `customers`), `customer_name`, `address`,
  `phone`, `customer_email`, `lines` (JSONB array of
  `{ id, name, qty, rate, total }`), `total` (numeric), `deposit_amount`,
  `deposit_paid_at`, `status` (`open` | `paid` | `void`), `completed_at`.
- `customers`: `id`, `user_id`, `name`, `phone`, `email`, `primary_address`,
  `notes`. (No QBO id column yet.)
- `manual_payments`: linked to an invoice via `invoice_id`; carries
  `amount_cents`, `method`, `status` (`recorded` | `deposited` | `voided`).
  **All** payments land here — manual cash entries *and* Stripe deposit/balance
  charges (the `payments-webhook` records a `manual_payments` row per charge).
  Non-voided rows are the real payments to mirror.
- Line parsing: `src/components/quotes/types.ts` → `parseLines(raw)` normalizes
  the JSONB `lines` (including legacy PressurePro `sqft × rate` rows) to
  `{ id, name, qty, rate, total }`.
- QBO plumbing: `refreshIfNeeded(conn, svc)` currently inside
  `supabase/functions/quickbooks-oauth/index.ts`.

## Decisions

1. **Sync trigger: manual button.** A "Sync to QuickBooks" button on the
   invoice screen. The operator controls exactly when a push happens. Smallest
   testable surface; no background infra. (Automatic-on-paid is a possible
   later enhancement, explicitly out of scope here.)
2. **Line-item mapping: single service item.** Find-or-create one QBO service
   item ("Landscaping Services"), use it for every invoice line, and put the
   TurfPro line name in the line `Description`. Amounts/totals match exactly;
   itemization lives in descriptions. One item to manage, no per-catalog cache.
3. **Payment mirroring: every payment.** Each non-voided `manual_payments` row
   becomes a distinct QBO `Payment`, tracked per-row so re-sync never
   duplicates.

## Architecture & components

### 1. New shared module `supabase/functions/_shared/quickbooks.ts`

Extract the QBO plumbing so both the OAuth and sync functions share it:

- `loadConnection(svc, userId)` → the `quickbooks_connections` row or `null`.
- `refreshIfNeeded(conn, svc)` → **moved here** from `quickbooks-oauth`; that
  function is edited to import it (behavior unchanged).
- `qboApiBase(env)` → data-API base by `QUICKBOOKS_ENV`:
  - sandbox: `https://sandbox-quickbooks.api.intuit.com/v3/company/{realm}`
  - production: `https://quickbooks.api.intuit.com/v3/company/{realm}`
- `qboFetch(conn, path, init)` → authed JSON fetch against QBO (Bearer token,
  `Accept: application/json`), throws a clean `Error` on a QBO `fault`.

### 2. New edge function `quickbooks-sync`

Auth required (resolves the user from the `Authorization` header exactly like
`quickbooks-oauth`; `verify_jwt` left at default — it is only ever called by the
signed-in operator). One op: `sync_invoice` with body `{ invoice_id }`. It
orchestrates the full push (algorithm below). All DB writes use the service-role
client so it can touch the RLS-locked `quickbooks_connections` and the
`qbo_*` columns.

### 3. Client `src/lib/quickbooks-sync.ts`

`syncInvoiceToQuickBooks(invoiceId): Promise<{ ok, qbo_invoice_id, payments_synced }>`,
mirroring the `src/lib/quickbooks.ts` wrapper style (invoke edge fn; throw on
error).

### 4. `src/pages/InvoiceDetail.tsx`

A "Sync to QuickBooks" button, shown only when QB is connected (reuse
`getQuickBooksStatus()`), with inline state — `Syncing…` / `Synced ✓` /
error — driven by the invoice's `qbo_invoice_id` / `qbo_synced_at` /
`qbo_sync_error`. On success, invalidate the `["invoice", id]` query so the
button reflects the new state.

## Schema changes — migration `0030_quickbooks_sync.sql`

All additive `ADD COLUMN IF NOT EXISTS`; applied via
`supabase db query --linked -f supabase/migrations/0030_quickbooks_sync.sql`
(the same path as 0029 — migrations are **not** tracked by `db push`).
Idempotent / safe to re-run. No RLS changes; the `qbo_*` columns are written
only by the service-role sync function.

| Table | New column(s) | Purpose |
|-------|---------------|---------|
| `customers` | `qbo_customer_id TEXT` | cache matched/created QB customer |
| `invoices` | `qbo_invoice_id TEXT`, `qbo_synced_at TIMESTAMPTZ`, `qbo_sync_error TEXT` | idempotency + button state |
| `manual_payments` | `qbo_payment_id TEXT` | per-payment idempotency |
| `quickbooks_connections` | `qbo_default_item_id TEXT` | cache default service item id |

## Sync algorithm (`sync_invoice`)

Given `{ invoice_id }` and the authenticated operator:

1. **Auth & load.** Resolve the user from the JWT. Service-role load the
   `invoices` row scoped to `user_id`; 404 if not theirs. Load the
   `quickbooks_connections` row; if none → clean "QuickBooks not connected"
   error.
2. **Fresh token.** `refreshIfNeeded(conn, svc)` — guarantees a live access
   token and persists any rotated refresh token.
3. **Resolve the default item.** If `conn.qbo_default_item_id` is set, use it.
   Else query QBO for a `Service` item named "Landscaping Services"; if absent,
   create one referencing the company's first `Income`-type `Account`
   (`IncomeAccountRef`). Cache the id on `quickbooks_connections`.
4. **Find-or-create the QB customer.**
   - If the invoice's `customer_id` → `customers.qbo_customer_id` is set, use it.
   - Else query QBO `Customer` by `DisplayName = customer_name`
     (fallback: `PrimaryEmailAddr = customer_email`). If found, cache + use.
   - Else create a QBO `Customer` from `customer_name` / `customer_email` /
     `phone` / `address`. Cache the id on the `customers` row when
     `customer_id` is present.
5. **Create the QB invoice (once).** If `invoices.qbo_invoice_id` is already
   set, skip creation (re-sync only advances payments). Else `POST /invoice`
   with one `Line` per `parseLines(invoice.lines)` entry:
   `SalesItemLineDetail.ItemRef` = default item, `Qty`, `UnitPrice` = rate,
   `Description` = line name, `Amount` = total; `CustomerRef` = the customer.
   Persist the returned id to `invoices.qbo_invoice_id`.
6. **Mirror payments.** Read `manual_payments` for this invoice where
   `status <> 'voided'` **and** `qbo_payment_id IS NULL`. For each, `POST
   /payment` with `CustomerRef`, `TotalAmt` = `amount_cents / 100`, and
   `Line[].LinkedTxn` = `{ TxnId: qbo_invoice_id, TxnType: 'Invoice' }`. Write
   the returned payment id back to that `manual_payments` row before moving to
   the next. Per-row write-back is what makes re-sync safe.
7. **Finalize.** Set `invoices.qbo_synced_at = now()`, clear
   `invoices.qbo_sync_error`. Return `{ ok: true, qbo_invoice_id,
   payments_synced }`.

## Idempotency & error handling

- **Resumable by construction.** Ids are persisted at each step, so a failure
  mid-way (invoice created but a payment POST fails) leaves completed work
  recorded; re-tapping Sync resumes rather than duplicating.
- **Errors** from any QBO call are caught, the message written to
  `invoices.qbo_sync_error`, and returned to the client for inline display.
  Partial success (invoice up, one payment failed) still records what
  succeeded.

### Known v1 limitations (documented, not built)

- Voiding an **already-synced** payment in TurfPro does not reverse it in QB.
- Editing invoice lines after the first sync does not update the QB invoice
  (create-once). Both are deferred; the button only reflects sync state.
- Cached `qbo_*` ids are realm-specific. If an operator disconnects and
  reconnects a **different** QuickBooks company, the cached `qbo_customer_id` /
  `qbo_invoice_id` / `qbo_default_item_id` reference the old realm and would be
  invalid. Deferred; a later enhancement clears these caches on `disconnect`.

## Testing

- **Unit** the pure mapping helpers (TurfPro lines → QBO `Line[]`; a
  `manual_payments` row → QBO `Payment`) — no network; exercises the legacy line
  shape through `parseLines`.
- **Manual sandbox pass:** create an invoice → Sync → confirm it appears in the
  QBO sandbox company; record a cash payment → Sync → confirm the QB payment
  applies and the invoice reads Paid; tap Sync again → confirm no duplicate
  invoice or payment.

## Out of scope

- Automatic sync (on invoice create / on paid via `payments-webhook`).
- Per-catalog QBO items / itemized QB reporting.
- Reversing voided payments or updating edited invoices in QB.
- Webhooks from Intuit back into TurfPro.
