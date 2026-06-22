# Invoices — Go-Live Checklist

Feature: Quotes → Invoices (spec: `docs/superpowers/specs/2026-06-17-quotes-to-invoices-design.md`).
Frontend audited and made ship-ready 2026-06-19. `npx tsc --noEmit` passes.

## What was audited

- Routing (`src/App.tsx`) — all three routes registered; public route NOT auth-gated.
- Data layer (`src/lib/invoices.ts`) — columns, status enum, INV-#### formatting, public read path.
- Operator surfaces: `Invoices.tsx` (list), `InvoiceDetail.tsx` (money + fulfillment).
- Public surfaces: `InvoiceView.tsx` (`/invoice/:token` + Pay balance/deposit), `InvoicePrint.tsx`.
- `QuoteDetail.tsx` — strip-down + "View invoice" link, no removed-field references.
- End-to-end money flow against `create-checkout-session` + `payments-webhook` edge functions.

## Gaps found and fixed (frontend)

1. **Public invoice page was RLS-blocked (showstopper).** `getInvoiceByToken` did a
   direct `from("invoices").select()`. The `invoices` table has NO anon SELECT policy
   (only `auth.uid() = user_id`), so every homeowner opening `/invoice/:token` would
   get "Invoice not found". Fixed to call the security-definer RPC
   `get_invoice_by_token` (the path the migration intended). — `src/lib/invoices.ts`

## REQUIRED before go-live (only the user can do these)

1. **Apply migration `0026_invoice_token_rpc_quote_id.sql`** (via `db query -f`, not
   `db push`). The deployed `get_invoice_by_token` RPC from 0023 does NOT return
   `quote_id`, but the public "Pay balance" / "Pay deposit" buttons call
   `create-checkout-session` with `{ quote_id, kind }`. Without this migration the
   public page loads and prints fine, but the Pay buttons cannot start checkout.
   - File authored at `supabase/migrations/0026_invoice_token_rpc_quote_id.sql`.
   - Idempotent (`CREATE OR REPLACE`); re-running is safe.

2. **Stripe sandbox/live key + Connect.** Card payments only work when the operator's
   Stripe Connect account is ready (`connect_ready = true`, `stripe_account_id` set).
   `create-checkout-session` refuses the charge with `code: "connect_not_ready"`
   otherwise (by design — direct charges only). Confirm the test operator has
   finished Connect onboarding and the platform Stripe secret is set for the env.

3. **Web deploy.** Ship the built frontend (the build is run by another process per
   the work constraints; this checklist does not trigger it).

## Known limitations (acceptable for v1, not blockers)

- **List "amount due" / "outstanding" overstate partial-paid invoices.** `Invoices.tsx`
  shows `amount due = full total` for any open invoice and the header sums full totals,
  because the list query doesn't fetch `manual_payments` (avoids N+1). The *accurate*
  balance is shown on `InvoiceDetail` and the public `InvoiceView` (both fetch payments
  / derive server-side). The spec's "Partial" badge is likewise not rendered in the list.
  Cosmetic only; no miscalculation in payment flows.
- **Public page amount-paid is conservative.** `InvoiceView` deliberately does not read
  `manual_payments` (RLS scopes those to the operator), so a homeowner's "amount due" is
  `total − (deposit if paid)` until status flips to `paid`. The checkout edge function
  computes the true remaining balance server-side, so the actual charge is correct.
- **Paid state after return is eventual.** Returning from Stripe (`?paid=1`) remounts
  and refetches the invoice; the row flips to `paid` once `payments-webhook` processes
  the event (typically seconds).

## Verified working

- Routes: `/invoices`, `/invoices/:id` under `Protected`; `/invoice/:token` and
  `/invoice/:token/print` are public (outside auth/onboarding gates), matching `/accept`.
- `InvoiceDetail` money math: collected = sum of non-voided manual payments;
  remaining = max(0, total − collected); cumulative ≥ total prompts mark-paid.
- `payments-webhook` stamps `deposit_paid_at`, records the invoice-linked payment, and
  recomputes `status → paid` when cumulative payments meet total.
- `QuoteDetail` renders, links to the invoice (`View invoice INV-####`), and no longer
  exposes removed inline money/fulfillment controls.
- Loading / empty / error / not-found states present on every surface.
- `npx tsc --noEmit` exits 0.
