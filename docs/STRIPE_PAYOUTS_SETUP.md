# Stripe payouts setup (Connect direct charges)

How TurfPro collects money for operators. **Read this before deploying the
payment edge functions** — the code is wired, but it stays inert until the
secrets, Connect, and webhook below are configured.

## The model: direct charges

Every customer→operator payment (quote deposits, invoice balances, per-visit
charges, recurring maintenance plans) is a **Stripe Connect direct charge**
created _on the operator's connected account_:

- Funds settle **directly into the operator's** Stripe balance. TurfPro never
  holds or owes the operator's money.
- The **operator's** account pays Stripe's processing fee (~2.9% + 30¢).
- TurfPro keeps a clean **2% `application_fee`** (the "Base" tier fee). Solo/
  Crew tiers are 0% — but those are sold via the mobile app store, so by
  default every operator is Base (2%).
- The **operator** is the merchant of record and is liable for refunds/
  chargebacks — not TurfPro.

If an operator hasn't finished Stripe Connect onboarding, charges are
**refused** (HTTP 409 `connect_not_ready`). We never fall back to charging on
the platform account.

> Subscriptions (operator paying for TurfPro itself) are handled by the mobile
> app store, **not** Stripe. You do **not** need to create Stripe Products/
> Prices for payouts. (You'd only need them later if you add web subscriptions.)

## 1. Enable Connect on the Stripe platform account

In the TurfPro Stripe account (sandbox first), enable **Connect**. Operators
onboard as **Express** accounts with `card_payments` + `transfers`
capabilities (already wired in `connect-onboarding`).

## 2. Set edge-function secrets (Supabase)

Set these on the Supabase project (Dashboard → Edge Functions → Secrets, or
`supabase secrets set`). Sandbox names shown; add the `LIVE` equivalents for
production.

| Secret | Value | Notes |
| --- | --- | --- |
| `STRIPE_CONNECT_ENABLED` | `true` | **Required.** `_shared/fees.ts` defaults this to *false*; if unset, `shouldRoute` is false and **every charge is refused**. |
| `STRIPE_SANDBOX_API_KEY_TURFPRO` | `sk_test_…` / `rk_test_…` | TurfPro platform secret (a restricted key is preferred). Legacy fallback name: `STRIPE_SANDBOX_API_KEY`. |
| `PAYMENTS_SANDBOX_WEBHOOK_SECRET_TURFPRO` | `whsec_…` | The webhook endpoint's signing secret (from step 4). Legacy fallback: `PAYMENTS_SANDBOX_WEBHOOK_SECRET`. |

Live equivalents: `STRIPE_LIVE_API_KEY_TURFPRO`,
`PAYMENTS_LIVE_WEBHOOK_SECRET_TURFPRO`.

## 3. Set the client publishable key

In `.env`, set `VITE_PAYMENTS_CLIENT_TOKEN` to the platform **publishable**
key. `pk_test_*` selects sandbox; anything else (or unset) → live. See `.env`.

## 4. Configure the webhook (must listen on connected accounts)

Because direct-charge events originate on the connected accounts, the webhook
endpoint **must have "Listen to events on Connected accounts" enabled** — a
Connect webhook. (The single endpoint handles both platform and Connect
events; `event.account` distinguishes them.)

- **URL:** `{SUPABASE_URL}/functions/v1/payments-webhook?env=sandbox&app=turfpro`
  (use `env=live` for production)
- **Signing secret** → step 2 (`PAYMENTS_SANDBOX_WEBHOOK_SECRET_TURFPRO`)
- **Events to send:**
  - `checkout.session.completed`
  - `charge.succeeded`, `charge.failed`
  - `invoice.payment_succeeded`, `invoice.payment_failed`
  - `customer.subscription.created` / `updated` / `deleted` / `paused` / `resumed`

## 5. Billing Portal config (for the homeowner card-update link)

`create-plan-portal-session` mints the portal **on the connected account**.
Each connected account needs a Billing Portal configuration — set a default in
the Express dashboard, or have the platform create one per account. Without it,
the "Update payment method" link 500s.

## 6. Deploy the edge functions

```
supabase functions deploy create-checkout-session create-plan-subscription \
  mutate-plan-subscription create-plan-portal-session payments-webhook \
  connect-onboarding verify-checkout-session
```

## Sandbox test checklist

1. **Onboard** a test operator: Settings → "Set up payouts" → finish Stripe's
   test onboarding → confirm `profiles.connect_ready = true`.
2. **Deposit:** public Accept page → pay a deposit with `4242 4242 4242 4242`.
   - Money lands on the **connected** account; an `application_fee` of 2% is
     taken; `application_fees` row written; `manual_payments` row recorded;
     invoice status advances.
3. **Balance:** public Invoice page → pay remaining balance → invoice → `paid`.
4. **Recurring plan:** create a maintenance plan → complete Checkout → plan
   goes `active`; renewals deduct 2% each cycle.
5. **Not-ready guard:** with a non-onboarded operator, a charge returns 409
   `connect_not_ready` (nothing routes to the platform).
6. **Reports:** "TurfPro fees this month" reflects the 2% taken.

## Files changed for direct charges

- `create-checkout-session` — deposits/balances/visit charges → direct charges; refuse if not ready.
- `create-plan-subscription` — recurring plans → direct charges on the connected account; refuse if not ready.
- `mutate-plan-subscription` — pause/resume/cancel scoped to the connected account.
- `create-plan-portal-session` — portal minted on the connected account.
- `payments-webhook` — runs deposit + plan business logic on Connect events (account-scoped reads), plus the fee cache.
- `_shared/fees.ts`, `src/lib/stripe.ts` — tier/fee model (Base = 2%, Solo/Crew = 0%).
