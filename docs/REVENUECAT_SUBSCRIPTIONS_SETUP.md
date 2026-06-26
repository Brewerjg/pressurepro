# Operator subscriptions (RevenueCat / app-store IAP)

Operator SaaS subscriptions (Solo / Crew) are sold through the **mobile app
stores** via **RevenueCat** — not Stripe. (Stripe is only for **payouts** —
customer→operator payments; see `docs/STRIPE_PAYOUTS_SETUP.md`.) "Base" is the
entry tier at **$8/mo ($80/yr)**. Every tier — Base, Solo, Crew — has a **0%
payout fee**; operators keep 100% of customer payments.

## How it fits together

```
App store purchase ──> RevenueCat ──webhook──> revenuecat-webhook edge fn
                                                      │ upserts entitlement
                                                      ▼
                                            public.subscriptions table
                                                      │ read by
                          ┌───────────────────────────┴───────────────────────┐
              useSubscriptionStatus (gate/paywall)        resolveTier/feeForTier (payout fee)
```

Because the webhook writes into the **same `subscriptions` table** the app
already reads, nothing downstream had to change — `useSubscriptionStatus`,
`SubscriptionGate`, and the payout fee tiering all keep working.

## Product / entitlement identifiers (must match exactly)

Create these product identifiers in App Store Connect, Google Play, **and**
RevenueCat — they must equal the existing Stripe lookup_keys (the constants in
`src/lib/stripe.ts`) so `tierFromPriceId()` resolves the tier with no extra
mapping. Prices:

- `turfpro_payg_monthly` (Base, $8/mo), `turfpro_payg_yearly` (Base, $80/yr)
- `turfpro_solo_monthly` ($15/mo), `turfpro_solo_yearly` ($150/yr)
- `turfpro_crew_monthly` ($59/mo), `turfpro_crew_yearly` ($590/yr)

Attach them to the current **Offering**'s packages. (Base's identifiers keep
the historical `payg` slug.)

## Config checklist

### RevenueCat dashboard
1. Create the project; add an **iOS app** (App Store) and **Android app** (Play).
2. Add the products above; attach to an Offering.
3. Copy the **public SDK keys** → `.env` (`VITE_REVENUECAT_IOS_KEY` = `appl_…`,
   `VITE_REVENUECAT_ANDROID_KEY` = `goog_…`).
4. Configure a **webhook**:
   - URL: `{SUPABASE_URL}/functions/v1/revenuecat-webhook`
   - Authorization header: a secret string (see next step).

### Supabase
5. Set the secret: `supabase secrets set REVENUECAT_WEBHOOK_AUTH=<same string as the RC webhook Authorization header>`.
6. `verify_jwt = false` for the function is already in `supabase/config.toml`.
7. Deploy: `supabase functions deploy revenuecat-webhook`.

### Stores
8. App Store Connect / Play Console: create the IAP subscription products with
   the identifiers above, in a subscription group; submit for review with the
   build.

## How the client works

- `src/lib/iap.ts` — RevenueCat wrapper (configure/getOfferings/purchasePackage/
  restorePurchases), loaded via dynamic import, native-only, keyed by platform.
- `src/lib/native-init.ts` — calls `configureRevenueCat(userId)` once per
  signed-in user (`appUserID = supabase user.id`).
- `src/components/billing/PaywallScreen.tsx` — on native, renders the offering's
  packages as Subscribe buttons + "Restore purchases"; on web, the existing
  "See plans → /pricing" layout is unchanged. After purchase it invalidates the
  `subscription-status` query so the gate re-checks once the webhook lands.

## Sandbox test checklist

1. Build a native app with the RC keys set; sign in.
2. Buy `turfpro_solo_monthly` with a store **sandbox** tester account.
3. RevenueCat fires the webhook → `subscriptions` row upserts (`price_id =
   turfpro_solo_monthly`, status `active`, environment `sandbox`).
4. The paywall clears and the app unlocks (Routes/Plans/Reports).
5. Confirm the operator's tier shows as Solo (payout fee is 0% on every tier).
6. Cancel in the store → webhook sets `cancel_at_period_end`; on expiration →
   `canceled`; access ends after the period.

## Note: Apple's IAP rules

Physical services (lawn care) processed via Stripe Connect are **exempt** from
Apple's IAP requirement, so Connect payouts stay on Stripe. Only the **digital
SaaS subscription** (operator paying for TurfPro) must use IAP — which is
exactly this RevenueCat path. See the iOS note in `connect-onboarding/index.ts`.
