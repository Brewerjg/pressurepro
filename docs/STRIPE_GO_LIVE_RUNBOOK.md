# Stripe Connect — Go-Live Runbook (LIVE payouts)

Steps to take TurfPro payouts from approved-Connect → working **live** card
payments. Companion to `STRIPE_PAYOUTS_SETUP.md` (which covers the model +
sandbox). This is the live cutover.

> ⚠️ **Test cards do NOT work in live mode.** `4242 4242 4242 4242` is declined
> live. To validate live you make a small **real** charge with a **real** card
> and refund it. Operators also must do **real** Express onboarding (real legal
> name, SSN, real bank) — there is no test shortcut in live.

## Fee model (recap)
Direct charges on the operator's connected account: funds settle to the
operator, the operator's account pays Stripe's processing fee, and TurfPro
takes a **0%** application fee on **every** tier (Base $8/$80, Solo $15/$150,
Crew $59/$590 — subscriptions sold via the app store). Operators keep 100% of
customer payments. TurfPro never holds funds. Not-Connect-ready operators are
refused (409), never routed to the platform.

## ✅ Already done
- `STRIPE_LIVE_API_KEY_TURFPRO` set on Supabase
- `STRIPE_CONNECT_ENABLED=true` set
- Connect enabled + **approved** on the platform account
- All 7 Stripe edge functions deployed with current code
- Code fix: deposit (`Accept.tsx`) + balance (`InvoiceView.tsx`) now send
  `environment` so public payment pages hit the LIVE key (they previously
  defaulted to sandbox server-side)

## 🟦 Stripe Dashboard — do these in **Live mode** (turn off "Test mode")
1. **Branding / platform profile** — Connect → Settings → set business name,
   icon, brand color, support details. Shown on operator onboarding.
2. **Create the live Connect webhook** — Developers → Webhooks → Add endpoint:
   - URL: `https://dkksryutecjbyuscpxdb.supabase.co/functions/v1/payments-webhook?env=live&app=turfpro`
   - **Enable "Listen to events on Connected accounts"** (direct-charge events
     originate on the connected account — without this, reconciliation/fee
     cache won't fire)
   - Events: `checkout.session.completed`, `charge.succeeded`, `charge.failed`,
     `invoice.payment_succeeded`, `invoice.payment_failed`,
     `customer.subscription.created` / `updated` / `deleted` / `paused` / `resumed`
   - Copy the **Signing secret** (`whsec_…`)
3. **Get the live publishable key** — Developers → API keys (live) → `pk_live_…`
4. *(Optional, for plan "update card" link)* Connect → set a default **Billing
   Portal** configuration for connected accounts.

## 🟩 Set these (Supabase secret + client env)
- `.env`: `VITE_PAYMENTS_CLIENT_TOKEN=pk_live_…`
  (a non-`pk_test_` value selects the **live** environment in
  `src/lib/stripe.ts`). Then rebuild: `npm run build` + `npx cap sync android`.
- Supabase secret (from step 2):
  `npx supabase@latest secrets set PAYMENTS_LIVE_WEBHOOK_SECRET_TURFPRO=whsec_… --project-ref dkksryutecjbyuscpxdb`

## 🟧 Onboard + verify with a real card
5. App → **Settings → Set up payouts** → complete **real** Express onboarding
   (real name, SSN, real bank account = your payout account).
6. When it shows **Connected ✓**, run a real charge: Accept page → deposit →
   real card. Verify in Stripe (Live):
   - Funds on the **connected account's** balance
   - **No** application fee under Connect → Application fees (0% on every tier)
   - Invoice advanced to paid in the app
7. **Refund** the charge in the Stripe dashboard to undo it.
   (Stripe's processing fee on a refunded charge is **not** returned — expect to
   be out ~30–60¢ on the test. Normal.)

## ⚠️ Cautions (real money now)
- In live, **every** operator action that takes a payment creates a **real**
  charge — no safety net. Fine for your own smoke test; be deliberate.
- Express onboarding requires real SSN + real bank; no test values.
- Keep sandbox config intact too — the functions serve both envs per-request
  (`?env=`), so test and live coexist.
