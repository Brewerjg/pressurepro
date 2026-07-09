# Phase 1 slice 1d-2 — pressure billing seam design

Status: approved phase; this slice's design ready for planning.
Date: 2026-07-08.
Parent: `2026-07-08-pressure-vertical-phase1-design.md`. 1d split: 1d-1 (done),
1d-2 (this), 1d-3 (plan de-lawn).

## Purpose

The subscription tiers + Stripe price lookup keys are hardcoded (`turfpro_*`) in
`src/lib/stripe.ts`. Make them a `vertical.billing` config seam so a pressure
build shows PressurePro's tiers/prices and checks out against `pp_*` prices.
Behavior-identical for lawn. Not registered (register-last, 1e).

## Problem (from the billing audit)

`stripe.ts` hardcodes `export const TIERS: Tier[]` (3 tiers payg/solo/crew,
`turfpro_*` lookup keys) + `const PRICE_TO_TIER`. Consumers (`Pricing.tsx`,
`PaywallScreen`, `BreakevenCalc`, `SubscriptionCard`, `useSubscriptionStatus`,
`payg.ts`, `Routes.tsx`, print/accept pages) use the exported `TIERS` +
`tierFromPriceId`/`priceIdForTier`/`getTier`/`feeForTier`/`weeklyStopLimitFor`/
`canScheduleMoreStops`. PressurePro has **4 tiers** (adds "pro"), `pp_*` keys, a
`features` object + `iapProductId` per price, and legacy `pressurepro_*`→pro.
Subscription-status reads are already vertical-neutral (filter by Stripe
`environment`, not app) — UNCHANGED.

## Design

**New `src/verticals/billing.ts`:**

```ts
import type { Tier, TierId } from "@/lib/stripe";

export interface BillingModule {
  /** Subscription tiers offered by this vertical (the full pricing config). */
  tiers: Tier[];
  /** Reverse map: Stripe price lookup_key (incl. legacy) → tier id. */
  priceToTier: Record<string, TierId>;
}
```

(Imports `Tier`/`TierId` TYPE-ONLY from `stripe.ts` — no runtime import, so no
cycle with `stripe.ts` reading `vertical`.)

**`src/lib/stripe.ts`:**
- Widen `TierId` to `"payg" | "solo" | "pro" | "crew"` (safe — no
  `Record<TierId,…>` literal or exhaustive switch exists in turf code; turf's
  tier DATA stays 3 tiers, so nothing constructs a `"pro"` tier).
- Keep the `Tier` interface EXACTLY as today (`id,name,tagline,monthly{priceId,
  price},yearly{priceId,price,saveLabel},highlights,seats,extraSeatPrice,
  weeklyStopLimit,applicationFeePercent`).
- Replace the hardcoded `TIERS`/`PRICE_TO_TIER` consts with reads from the active
  vertical: `import { vertical } from "@/vertical";` then
  `export const TIERS: Tier[] = vertical.billing.tiers;` and
  `const PRICE_TO_TIER = vertical.billing.priceToTier;`. All the functions
  (`getTier`/`priceIdForTier`/`tierFromPriceId`/`feeForTier`/`weeklyStopLimitFor`/
  `canScheduleMoreStops`) keep their signatures and read these. (Consumers that
  `import { TIERS }` keep working — `TIERS` is now the active vertical's array.)
- Refactor `feeForTier`'s no-tier default from the hardcoded `0` to the payg
  tier's fee: `feeForTier(null)` → `getTier("payg").applicationFeePercent`.
  Behavior-identical for lawn (payg fee = 0); for pressure this correctly returns
  2% (payg). All other function bodies unchanged.

**`src/verticals/lawn/billing.ts`** — `lawnBilling: BillingModule` holding the
CURRENT turf 3 tiers (moved verbatim from `stripe.ts`) + the current turf
`priceToTier` (6 keys). Register `billing: lawnBilling` in `lawn/index.ts`.

**`src/verticals/pressure/billing.ts`** — `pressureBilling: BillingModule` with
PressurePro's 4 tiers CONFORMED to the turf `Tier` shape (its `features`
object, `iapProductId`, and `FEATURE_MATRIX` are NOT ported — that info lives in
`highlights`; see Deferred). `weeklyStopLimit: null` on every pressure tier
(pressure doesn't gate route stops); `extraSeatPrice: null`. Values (verbatim
prices/highlights from PressurePro `stripe.ts`):

- **payg** — name "Pay as you go", `pp_payg_monthly` $5 / `pp_payg_yearly` $50
  "Save $10", seats 1, `applicationFeePercent: 2.0`, highlights ["$5 monthly
  base","2% on processed payments","Up to 50 quotes / month","Best for trials +
  cash-heavy ops"].
- **solo** — "Solo", `pp_solo_monthly` $15 / `pp_solo_yearly` $150 "Save $30",
  seats 1, fee 0, highlights ["Up to 50 quotes / month","1 user","500 MB cloud
  photo backup","All quote, photo & SMS tools"].
- **pro** — "Pro", `pp_pro_monthly` $25 / `pp_pro_yearly` $250 "Save $50", seats
  2, fee 0, highlights ["Unlimited quotes","2 user seats","5 GB cloud photo
  backup","QuickBooks sync","Route optimization"].
- **crew** — "Crew", `pp_crew_monthly` $49 / `pp_crew_yearly` $490 "Save $98",
  seats 5, fee 0, highlights ["5 user seats","25 GB cloud photo backup","Fleet
  calendar","Reporting export","Everything in Pro"].

`priceToTier`: the 8 `pp_*` keys + legacy `pressurepro_monthly`/`pressurepro_yearly`
→ `"pro"`. NOT registered (1e).

**`src/verticals/types.ts`** — add `billing: BillingModule` to `Vertical`.

### Cycle safety

`stripe.ts` reads `vertical` at module top-level (`export const TIERS =
vertical.billing.tiers`). This is safe because the vertical-resolution chain
(`@/vertical → registry → lawn/index → lawn/billing`) imports `stripe.ts`
TYPE-ONLY (erased at runtime), so `stripe.ts` is never loaded during vertical
init — it loads only when a real consumer imports it, by which time `vertical` is
resolved. If the build ever shows `TIERS` undefined (a cycle), the fallback is to
convert `TIERS` to a `getTiers()` getter — but the type-only imports should
prevent this.

## Testing

- `src/verticals/lawn/billing.test.ts`: `lawnBilling.tiers` has 3 tiers
  (payg/solo/crew); `priceToTier["turfpro_solo_monthly"] === "solo"`; every
  tier's `applicationFeePercent === 0`.
- `src/verticals/pressure/billing.test.ts`: 4 tiers (payg/solo/pro/crew);
  `tiers` price ids are the `pp_*` keys; payg `applicationFeePercent === 2`, the
  rest `0`; `priceToTier["pressurepro_yearly"] === "pro"` (legacy);
  `priceToTier["pp_crew_monthly"] === "crew"`; `weeklyStopLimit === null` on all.
- Both test files need the `vi.mock("@/integrations/supabase/client", …)` shim
  ONLY if importing the vertical index pulls supabase — billing.ts imports only
  types, so a direct `import { lawnBilling } from "./billing"` needs NO shim;
  but importing `lawnVertical` (the index) does → prefer importing the billing
  module directly in tests.
- **tsc:** `npx tsc --noEmit -p tsconfig.app.json` stays at the 6-file baseline;
  `stripe.ts` and consumers stay clean (the `TierId` widening introduces no new
  error — verified: no `Record<TierId>` literals). `npm run build` green.
- Lawn behavior: `TIERS`/prices/fees identical (lawn config = the moved-verbatim
  values); `feeForTier(null)` still 0.

## Deferred (noted gaps, not this slice)

- **`iapProductId` (native IAP)**: PressurePro uses `pp_*_v1` App-Store product
  ids distinct from the Stripe `priceId`. The unified `Tier` shape carries only
  `priceId`; native RevenueCat product mapping is handled with the native/store
  config (1e/1f), not here. Web Stripe checkout uses `pp_*` correctly.
- **`features`/quote-limit gating**: the turf codebase gates route stops
  (`weeklyStopLimit`), not quotes. Pressure's `quoteLimit` enforcement is not in
  the shared code, so pressure payg won't hard-cap quotes — a parity gap; the
  info still shows in `highlights`. Add later if needed.
- **`FEATURE_MATRIX`** (the pricing comparison table) — pressure's is richer;
  the unified Pricing page uses `highlights`. Not ported.

## Out of scope (1d-2)

- Registering `pressureVertical` (1e); plan-cadence + Plans de-lawn (1d-3).
- Any consumer change beyond what the `TierId` widening / `TIERS`-source change
  requires (all functions keep their signatures).
- Native IAP wiring, quote-limit gating (deferred above).
- Any lawn behavior change.
