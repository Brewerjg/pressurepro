# Stripe Setup Playbook — for Claude Cowork (Chrome) to Execute

This is a step-by-step playbook for Claude Cowork to set up **two separate
Stripe platform accounts** — one for TurfPro, one for PressurePro — in **test
mode**, end-to-end, with the operator (Jason) handling only the steps that
legally require a human.

The goal: when Cowork finishes, the code-side (Claude in this terminal) gets
handed 8 secrets + 2 publishable keys. We wire them into Supabase + Vercel,
run E2E test-mode validation, and then Jason flips to live mode.

---

## Glossary

- **TurfPro Stripe** — the platform account that services TurfPro operators.
  Operators connect their own Stripe accounts via Express; TurfPro takes 2%
  on PAYG, 0% on paid tiers.
- **PressurePro Stripe** — the platform account that services PressurePro
  operators. Same model as TurfPro.
- **Test mode / Sandbox** — Stripe's no-real-money environment. Identical
  API. Card `4242 4242 4242 4242` always succeeds.
- **Live mode** — real money. Requires gov ID + bank verification.
- **Connect Express** — Stripe's hosted onboarding flow for operators (your
  customers' customers, essentially). Stripe handles their identity
  verification, payouts, taxes.
- **lookup_key** — a stable identifier you give a Price object. Code uses
  these instead of brittle `price_xxx` IDs so test/live can use the same
  source code.

---

## Pre-flight (Jason does, once)

Before Cowork starts:

1. Confirm logged in at https://dashboard.stripe.com with the existing
   account.
2. **Decide which app the existing account becomes** — TurfPro or
   PressurePro. The other one will need a new account.
   - To create a second account: top-left account switcher → "New account" →
     follow the flow. You'll need: business name, email, country, business
     type. **Stop after account is created** — leave verification (gov ID,
     bank) for later.
3. Switch to test mode (toggle in the top-right of the dashboard) on
   **both** accounts before Cowork begins. Every step below assumes test
   mode is on. **Cowork: verify the "Test mode" pill is visible top-right
   before each step.**

---

## Setup steps — Cowork executes, per account

Do **all** of the following for **TurfPro Stripe first**, then repeat the
entire flow for **PressurePro Stripe**. The values differ between the two —
each step calls out which app it's for.

For each step, Cowork should:
- Take the action listed under **Action**.
- Pause and surface to Jason any step marked **Human required: yes** — those
  cannot be automated.
- Run the **Verify** check before moving on; if it fails, surface the issue
  rather than proceeding.

---

### Step 1 — Confirm test mode

**Action.** Navigate to https://dashboard.stripe.com. Confirm the top-right
shows "Test mode". If "Live mode" is shown, click the toggle to switch.

**Verify.** The orange "Test mode" pill is visible top-right.

**Human required.** No.

---

### Step 2 — Set business profile basics

**Action.** Navigate to **Settings → Business → Public details** (URL:
https://dashboard.stripe.com/test/settings/public).

Fill in:

| Field | TurfPro value | PressurePro value |
|---|---|---|
| Business name | TurfPro | PressurePro |
| Statement descriptor | TURFPRO | PRESSUREPRO |
| Shortened descriptor | TURFPRO | PRESSURE |
| Customer support phone | (Jason's number) | (Jason's number) |
| Customer support email | support@turfpro.app *(or whatever Jason provides)* | support@pressurepro.app *(or whatever Jason provides)* |
| Business URL | https://turfpro.vercel.app (replace once Jason confirms) | https://pressurepro.vercel.app (replace once Jason confirms) |

If Jason hasn't provided real URLs, **pause and ask**. Don't make up domains.

**Verify.** Save succeeds; page reloads with all fields populated.

**Human required.** Partial — Jason must confirm the customer-facing email
address and the public domain. The form-filling itself is automatable.

---

### Step 3 — Enable Stripe Connect

**Action.** Navigate to **Settings → Connect → Settings** (URL:
https://dashboard.stripe.com/test/settings/connect).

- Toggle **Enable Connect** if not already on.
- Under **Account types**, ensure **Express** is enabled.
- Under **Capabilities** (test mode), enable: `card_payments` and
  `transfers`.

**Verify.** "Connect is enabled" indicator on the page.

**Human required.** No (in test mode). In live mode, this would require
accepting the Connect Platform Agreement — **don't do that step in test mode**.

---

### Step 4 — Configure Connect platform branding

**Action.** Navigate to **Settings → Connect → Branding** (URL:
https://dashboard.stripe.com/test/settings/connect/branding).

Fill in:

| Field | TurfPro value | PressurePro value |
|---|---|---|
| Platform name | TurfPro | PressurePro |
| Platform email (for connected accounts) | support@turfpro.app | support@pressurepro.app |
| Brand color | `#10b981` (TurfPro green) | `#0ea5e9` (PressurePro blue) |
| Accent color | `#064e3b` | `#0c4a6e` |
| Logo | *(skip — Jason hasn't provided logo files yet; flag for him)* | *(same)* |

**Verify.** Save succeeds; the Connect-hosted onboarding preview (if shown
on the page) reflects the chosen colors.

**Human required.** Partial — Jason needs to provide logo files (PNG, ≥128px
square, transparent background) for both apps. If not available, Cowork
should leave logo blank and surface a TODO to Jason.

---

### Step 5 — Create the 8 Products + Prices

For each app, we need **8 Prices** total (4 tiers × monthly/yearly).

**Action.** Navigate to **Product catalog** (URL:
https://dashboard.stripe.com/test/products?active=true). Click **+ Create
product** for each row in the table below.

For each product, set:
- **Name** = the Product name in the table
- **Description** = the Description in the table
- **Tax behavior** = "Exclusive" (we don't collect tax through Stripe for now)

Then add **TWO prices** to each product (monthly + yearly). For each price,
set:
- **Pricing model** = "Standard pricing" (or "Subscription" — both work for
  recurring)
- **Price** = the dollar amount
- **Billing period** = "Monthly" or "Yearly"
- **Currency** = USD
- Click **Advanced** → set **Lookup key** = the value from the table
- For yearly prices: set the lookup_key with `_yearly` suffix

**Critical:** the `lookup_key` strings below MUST match exactly — the
edge functions in code look these up by string.

#### TurfPro products

| Product name | Description | Monthly price | Monthly lookup_key | Yearly price | Yearly lookup_key |
|---|---|---|---|---|---|
| TurfPro PAYG | Low base + 2% platform fee on routed charges | $5.00 | `turfpro_payg_monthly` | $50.00 | `turfpro_payg_yearly` |
| TurfPro Solo | Solo operator — single-user account, no platform fee | $15.00 | `turfpro_solo_monthly` | $150.00 | `turfpro_solo_yearly` |
| TurfPro Pro | Growing crew (2 seats), no platform fee | $25.00 | `turfpro_pro_monthly` | $250.00 | `turfpro_pro_yearly` |
| TurfPro Crew | Multi-truck operation (5 seats), no platform fee | $49.00 | `turfpro_crew_monthly` | $490.00 | `turfpro_crew_yearly` |

Yearly prices match the TIERS array in [src/lib/stripe.ts](src/lib/stripe.ts) — Solo/Pro/Crew use a "10× monthly minus 2 months free" pattern; PAYG uses a "$10 off" pattern.

#### PressurePro products

| Product name | Description | Monthly price | Monthly lookup_key | Yearly price | Yearly lookup_key |
|---|---|---|---|---|---|
| PressurePro PAYG | Low base + 2% platform fee on routed charges | $5.00 | `pp_payg_monthly` | $50.00 | `pp_payg_yearly` |
| PressurePro Solo | Solo operator — single-user account, no platform fee | $15.00 | `pp_solo_monthly` | $150.00 | `pp_solo_yearly` |
| PressurePro Pro | Growing crew (2 seats), no platform fee | $25.00 | `pp_pro_monthly` | $250.00 | `pp_pro_yearly` |
| PressurePro Crew | Multi-truck operation (5 seats), no platform fee | $49.00 | `pp_crew_monthly` | $490.00 | `pp_crew_yearly` |

**Verify.** After creating each product, check that **two prices appear** on
the product detail page, each with the correct `lookup_key`. Search
"turfpro_payg_monthly" (or whichever key) in the global search bar — the
product should be findable by lookup_key.

**Human required.** No (form-filling). But Jason should confirm price points
before mass creation if he wants different amounts.

---

### Step 6 — Register webhook endpoint

**Action.** Navigate to **Developers → Webhooks** (URL:
https://dashboard.stripe.com/test/webhooks). Click **+ Add endpoint**.

Endpoint URLs — each app has its own edge fn (PP's was renamed to avoid
collision with TurfPro's). The `?app=` query param is still passed for
symmetry and to make the secret-selection branch explicit.

- **TurfPro:** `https://dkksryutecjbyuscpxdb.supabase.co/functions/v1/payments-webhook?app=turfpro&env=sandbox`
- **PressurePro:** `https://dkksryutecjbyuscpxdb.supabase.co/functions/v1/pp-payments-webhook?app=pressurepro&env=sandbox`

**Listen to:** "Events on Connected accounts" — toggle ON. (This is the
Connect-platform pattern; events from connected Express accounts flow back
through the platform webhook.)

**Events to send.** Select the following:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.trial_will_end`
- `invoice.created`
- `invoice.finalized`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.payment_succeeded`
- `account.updated`
- `account.application.deauthorized`
- `application_fee.created`
- `application_fee.refunded`
- `charge.succeeded`
- `charge.refunded`
- `charge.dispute.created`

Click **Add endpoint**.

**Verify.** The endpoint appears in the webhook list with the correct URL
and event count.

**Copy the signing secret.** On the new endpoint's detail page, click
**Reveal** under "Signing secret" (a value starting with `whsec_…`). Save it
somewhere safe for hand-off — see Step 8.

**Human required.** No.

---

### Step 7 — Generate API keys

**Action.** Navigate to **Developers → API keys** (URL:
https://dashboard.stripe.com/test/apikeys).

Stripe shows two keys by default in test mode:

- **Publishable key** — starts with `pk_test_…`. Already visible; click
  **Copy**.
- **Secret key** — starts with `sk_test_…`. Click **Reveal test key**, then
  **Copy**.

Save both for Step 8.

**Restricted keys (optional).** If Jason wants least-privilege keys for
the edge functions instead of the full secret key, click **+ Create
restricted key** with these permissions:

- Read+Write: `Checkout Sessions`, `Customers`, `Prices`, `Products`,
  `Subscriptions`, `Subscription items`, `Invoices`, `Charges`, `Connect`
- Read only: `Events`, `Balance`

For test mode, the full secret key is fine — restricted keys are mainly a
live-mode hardening step.

**Verify.** Both keys copy successfully (paste into a scratch buffer to
confirm).

**Human required.** No.

---

### Step 8 — Hand off keys to code-side Claude

**Action.** Open `C:\Users\Jason\Desktop\turf\.env` and add the following
lines (replace `<…>` with the values copied in Steps 6 and 7).

**Do not commit `.env` to git** — it's already in `.gitignore`. These values
also need to be set in the Supabase Edge Functions Secrets UI and the Vercel
project's Environment Variables — see Step 9.

```env
# ===== TurfPro Stripe (test mode) =====
STRIPE_SANDBOX_API_KEY_TURFPRO=<sk_test_… from TurfPro account, Step 7>
PAYMENTS_SANDBOX_WEBHOOK_SECRET_TURFPRO=<whsec_… from TurfPro account, Step 6>
# Publishable key — used by the TurfPro Vite build only:
VITE_PAYMENTS_CLIENT_TOKEN_TURFPRO=<pk_test_… from TurfPro account, Step 7>

# ===== PressurePro Stripe (test mode) =====
STRIPE_SANDBOX_API_KEY_PRESSUREPRO=<sk_test_… from PressurePro account, Step 7>
PAYMENTS_SANDBOX_WEBHOOK_SECRET_PRESSUREPRO=<whsec_… from PressurePro account, Step 6>
# Publishable key — used by the PressurePro Vite build only:
VITE_PAYMENTS_CLIENT_TOKEN_PRESSUREPRO=<pk_test_… from PressurePro account, Step 7>

# Live keys come later, after Jason completes identity + bank verification.
# STRIPE_LIVE_API_KEY_TURFPRO=
# PAYMENTS_LIVE_WEBHOOK_SECRET_TURFPRO=
# STRIPE_LIVE_API_KEY_PRESSUREPRO=
# PAYMENTS_LIVE_WEBHOOK_SECRET_PRESSUREPRO=

STRIPE_CONNECT_ENABLED=true
```

**Verify.** Open the `.env` file after writing. The 6 test-mode lines all
have values (no `<…>` placeholders remaining).

**Human required.** No (file write). But Jason must verify the values match
what he sees in the dashboard.

---

### Step 9 — Wire keys into Supabase and Vercel

**Action.** This step has two sub-tasks.

#### 9a — Supabase Edge Function Secrets

Navigate to https://supabase.com/dashboard/project/dkksryutecjbyuscpxdb/settings/functions

For each of the 4 secrets below (test mode only — live values come later),
click **+ Add new secret** and paste:

| Secret name | Value (from .env in Step 8) |
|---|---|
| `STRIPE_SANDBOX_API_KEY_TURFPRO` | `sk_test_…` (TurfPro) |
| `PAYMENTS_SANDBOX_WEBHOOK_SECRET_TURFPRO` | `whsec_…` (TurfPro) |
| `STRIPE_SANDBOX_API_KEY_PRESSUREPRO` | `sk_test_…` (PressurePro) |
| `PAYMENTS_SANDBOX_WEBHOOK_SECRET_PRESSUREPRO` | `whsec_…` (PressurePro) |
| `STRIPE_CONNECT_ENABLED` | `true` |

**Verify.** After adding, all 5 secrets appear in the secrets list (Stripe
masks the values once saved — that's expected).

**Human required.** Partial — Jason needs to be logged into Supabase. Cowork
can drive the UI once he's logged in.

#### 9b — Vercel project env vars

**TurfPro Vercel project** (https://vercel.com/dashboard → turf project →
Settings → Environment Variables):

| Name | Value | Environments |
|---|---|---|
| `VITE_PAYMENTS_CLIENT_TOKEN` | `pk_test_…` (TurfPro) | Production, Preview, Development |

**PressurePro Vercel project** (similar path):

| Name | Value | Environments |
|---|---|---|
| `VITE_PAYMENTS_CLIENT_TOKEN` | `pk_test_…` (PressurePro) | Production, Preview, Development |

**Important:** the variable name is the **same** in both Vercel projects
(`VITE_PAYMENTS_CLIENT_TOKEN`) because each project is its own SPA build —
the build picks up the correct publishable key per project. We are **not**
shipping both publishable keys to the same bundle.

**Verify.** Each Vercel project shows the env var. Trigger a redeploy from
the Vercel UI so the new var is baked into the SPA bundle.

**Human required.** Partial — Jason logged into Vercel.

---

### Step 10 — Smoke test

After all the above, Cowork should validate the wiring by doing a single
test checkout end-to-end. Open the deployed TurfPro Vercel URL, sign in,
navigate to Pricing, click "Subscribe to Solo", and complete the Stripe
Checkout with card `4242 4242 4242 4242`, any future expiry, any CVC, any
ZIP.

**Verify:**
- Checkout completes and redirects back to TurfPro
- Stripe TurfPro dashboard → **Payments** shows the test payment
- Stripe TurfPro dashboard → **Developers → Webhooks → [endpoint] → Recent
  events** shows `checkout.session.completed` delivered with HTTP 200
- Supabase → `subscriptions` table has a new row for the test user

Repeat the same flow for PressurePro.

**If any step fails:** surface the failure to Jason; code-side Claude will
investigate. Don't try to fix Stripe-side or code-side issues — that's our
job.

**Human required.** Yes — Jason needs to authenticate in the apps as a test
operator.

---

## Steps Cowork CANNOT do (Jason owns these)

These steps require either personal identity, financial info, or signed
legal agreements. Cowork should pause and surface them to Jason; Jason does
them in his own session.

1. **Identity verification** (Settings → Business → Verification) — gov ID
   upload, SSN/EIN entry, business address proof. Required to unlock live
   mode and receive payouts.
2. **Bank account** (Settings → Business → Payouts) — routing + account
   number for the bank that receives platform fees.
3. **Sign Stripe Terms of Service** — checkbox during activation flow.
4. **Sign Connect Platform Agreement** — separate checkbox under Connect
   settings, required for live-mode Connect.
5. **Toggle test → live mode** — only available after #1 + #3 + #4 are done.
6. **Generate live-mode API keys** — only available after live mode is
   activated. Once Jason has them, repeat Steps 8 + 9 for the four
   `*_LIVE_*` env vars.

---

## What "done" looks like

After Cowork completes Steps 1–10 for both accounts:

- 16 Prices exist across two Stripe accounts (8 TurfPro + 8 PressurePro)
- 2 webhook endpoints registered, each pointing at the same Supabase
  function URL with different `?app=` query params
- 8 test-mode env vars set in Supabase + `.env`
- 2 publishable keys set in the two Vercel projects
- Code-side Claude has completed Phases 0–4 (refactor + parity)
- A successful test checkout has happened on each app

At that point Jason does the identity + bank steps, copies the 4 live keys
into Supabase + `.env`, redeploys the Vercel projects with live publishable
keys, and we go live.

---

## Notes for code-side Claude

- The migration accepts both old (single-account) and new (per-app) env var
  names — see [supabase/functions/_shared/stripe.ts](supabase/functions/_shared/stripe.ts).
  If only the legacy vars are present, both apps share one Stripe account
  (the pre-migration state). If both per-app vars are present, each app
  routes to its own. This means Cowork can set up the new accounts while
  the existing flow keeps running on the legacy keys.
- PressurePro's PAYG tier (`pp_payg_monthly` / `pp_payg_yearly`) does not
  exist in code yet — that's Phase 4. The Stripe-side prices need to exist
  before Phase 4 ships, which is why this playbook creates them upfront.
- PressurePro's conflicting edge fns were renamed to `pp-*` prefix to let
  both repos deploy side-by-side in the shared Supabase project:
  `pp-payments-webhook`, `pp-create-plan-subscription`,
  `pp-create-plan-portal-session`. TurfPro's keep their original names.
  PressurePro client callers updated.
