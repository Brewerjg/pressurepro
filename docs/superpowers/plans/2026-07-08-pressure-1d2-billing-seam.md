# Phase 1 slice 1d-2 (pressure billing seam) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make subscription tiers + Stripe price keys a `vertical.billing` seam. `stripe.ts` sources `TIERS`/`PRICE_TO_TIER` from the active vertical; lawn values move verbatim (behavior-identical); `pressureBilling` adds the 4 pressure tiers.

**Architecture:** `BillingModule` config per vertical; `stripe.ts` keeps the `Tier` interface + all functions and reads `vertical.billing`. `TierId` widens to include `"pro"` (safe — no exhaustive `Record<TierId>` in turf). Cycle-safe: vertical modules import `Tier`/`TierId` TYPE-ONLY from `stripe.ts`, so `stripe.ts` is never loaded during vertical init. Pressure billing is authored but NOT registered (register-last, 1e).

**Tech Stack:** TypeScript, vitest.

## Global Constraints

- **tsc gate:** `npx tsc --noEmit -p tsconfig.app.json` (NOT root). Baseline = exactly 6 files: `AudienceStep.tsx`, `campaigns/templates.ts`, `BusinessProfile.tsx`, `iap.ts`, `Campaigns.tsx`, `Onboarding.tsx`. Gate = no NEW file. `stripe.ts` + its consumers must stay clean after the `TierId` widening + `TIERS` source change.
- **Lawn behavior-identical:** `lawnBilling` holds the CURRENT turf tier values verbatim; `TIERS`/prices/fees resolve identically; `feeForTier(null)` still returns 0 for lawn.
- **Cycle safety:** `src/verticals/billing.ts`, `lawn/billing.ts`, `pressure/billing.ts` import `Tier`/`TierId` with `import type` ONLY (never a value import of `stripe.ts`).
- **Commit trailers on every commit:**
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QrF17kQNQsTPBTHee6C3br
  ```
- Full vitest suite green; `npm run build` succeeds.

---

### Task 1: BillingModule contract + stripe.ts refactor + lawnBilling

**Files:**
- Create: `src/verticals/billing.ts`
- Create: `src/verticals/lawn/billing.ts`
- Modify: `src/lib/stripe.ts` (widen TierId; source TIERS/PRICE_TO_TIER from vertical; feeForTier)
- Modify: `src/verticals/types.ts` (add `billing`)
- Modify: `src/verticals/lawn/index.ts` (register `billing: lawnBilling`)
- Test: `src/verticals/lawn/billing.test.ts`

**Interfaces:**
- Produces: `BillingModule { tiers: Tier[]; priceToTier: Record<string, TierId> }`; `Vertical.billing: BillingModule`; `lawnBilling`.

- [ ] **Step 1: Create the contract**

Create `src/verticals/billing.ts`:

```ts
import type { Tier, TierId } from "@/lib/stripe";

// The billing seam — subscription tiers + Stripe price mapping per trade.
export interface BillingModule {
  /** Subscription tiers offered by this vertical (full pricing config). */
  tiers: Tier[];
  /** Reverse map: Stripe price lookup_key (incl. legacy) → tier id. */
  priceToTier: Record<string, TierId>;
}
```

- [ ] **Step 2: Widen `TierId` + source tiers from the vertical in `stripe.ts`**

In `src/lib/stripe.ts`:

(a) Add the vertical import near the top (after the existing imports):
```ts
import { vertical } from "@/vertical";
```

(b) Widen `TierId`:
```ts
export type TierId = "payg" | "solo" | "pro" | "crew";
```

(c) DELETE the hardcoded `export const TIERS: Tier[] = [ … ]` array (the three payg/solo/crew objects) AND the `const PRICE_TO_TIER: Record<string, TierId> = { … }` object. Replace BOTH with:
```ts
// Tiers + price map come from the active vertical (src/verticals/<slug>/billing.ts).
export const TIERS: Tier[] = vertical.billing.tiers;
const PRICE_TO_TIER: Record<string, TierId> = vertical.billing.priceToTier;
```
(Keep the `Tier` interface, `Cycle`, and the "IMPORTANT — placeholder price IDs" comment context. The moved tier objects go verbatim into `lawn/billing.ts` in Step 3.)

(d) Refactor `feeForTier` so the no-tier default is the payg tier's fee (identical for lawn where payg = 0):
```ts
export function feeForTier(tierId: TierId | null | undefined): number {
  const tier = tierId ? TIERS.find((t) => t.id === tierId) : undefined;
  return (tier ?? getTier("payg")).applicationFeePercent;
}
```

Leave `getStripe`, `getStripeEnvironment`, `weeklyStopLimitFor`, `canScheduleMoreStops`, `tierFromPriceId`, `getTier`, `priceIdForTier`, `redirectToCheckout` UNCHANGED (they read `TIERS`/`PRICE_TO_TIER`, now vertical-sourced).

- [ ] **Step 3: Create `lawn/billing.ts` (turf tiers moved verbatim)**

Create `src/verticals/lawn/billing.ts` — the three tier objects deleted from `stripe.ts`, verbatim, plus the turf price map:

```ts
import type { BillingModule } from "@/verticals/billing";
import type { Tier, TierId } from "@/lib/stripe";

const LAWN_TIERS: Tier[] = [
  {
    id: "payg",
    name: "Base",
    tagline: "Low flat price — keep 100%",
    monthly: { priceId: "turfpro_payg_monthly", price: 8 },
    yearly: { priceId: "turfpro_payg_yearly", price: 80, saveLabel: "Save $16" },
    seats: 1,
    extraSeatPrice: null,
    weeklyStopLimit: 25,
    highlights: [
      "$8/mo flat",
      "0% payout fees — keep 100%",
      "1 user seat",
      "Up to 25 stops / week",
      "All operator features",
    ],
    applicationFeePercent: 0,
  },
  {
    id: "solo",
    name: "Solo",
    tagline: "One truck, one operator",
    monthly: { priceId: "turfpro_solo_monthly", price: 15 },
    yearly: { priceId: "turfpro_solo_yearly", price: 150, saveLabel: "Save $30" },
    seats: 1,
    extraSeatPrice: null,
    weeklyStopLimit: 50,
    highlights: [
      "1 user seat",
      "Up to 50 stops / week",
      "0% payout fees — keep 100%",
      "Photo before/after, chemical log",
      "Weather & spray-day planner (beta)",
    ],
    applicationFeePercent: 0,
  },
  {
    id: "crew",
    name: "Crew",
    tagline: "Multi-truck operation",
    monthly: { priceId: "turfpro_crew_monthly", price: 59 },
    yearly: { priceId: "turfpro_crew_yearly", price: 590, saveLabel: "Save $118" },
    seats: 5,
    extraSeatPrice: 10,
    weeklyStopLimit: null,
    highlights: [
      "5 seats included (+$10/seat after)",
      "Unlimited stops",
      "Multi-truck routing & route optimization (beta)",
      "QuickBooks sync (coming soon)",
      "Recurring billing + maintenance plans",
      "Fleet view, crew calendar & report export",
    ],
    applicationFeePercent: 0,
  },
];

const LAWN_PRICE_TO_TIER: Record<string, TierId> = {
  turfpro_payg_monthly: "payg",
  turfpro_payg_yearly: "payg",
  turfpro_solo_monthly: "solo",
  turfpro_solo_yearly: "solo",
  turfpro_crew_monthly: "crew",
  turfpro_crew_yearly: "crew",
};

export const lawnBilling: BillingModule = {
  tiers: LAWN_TIERS,
  priceToTier: LAWN_PRICE_TO_TIER,
};
```

- [ ] **Step 4: Add `billing` to the contract + register on lawn**

In `src/verticals/types.ts`: add `import type { BillingModule } from "./billing";` and add to the `Vertical` interface:
```ts
  /** Subscription tiers + Stripe price mapping for this vertical. */
  billing: BillingModule;
```

In `src/verticals/lawn/index.ts`: add `import { lawnBilling } from "./billing";` and add `billing: lawnBilling,` to the `lawnVertical` object.

- [ ] **Step 5: Test**

Create `src/verticals/lawn/billing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { lawnBilling } from "./billing";

describe("lawnBilling", () => {
  it("offers the three turf tiers with 0% fees", () => {
    expect(lawnBilling.tiers.map((t) => t.id)).toEqual(["payg", "solo", "crew"]);
    for (const t of lawnBilling.tiers) expect(t.applicationFeePercent).toBe(0);
  });
  it("maps turf price keys to tiers", () => {
    expect(lawnBilling.priceToTier["turfpro_solo_monthly"]).toBe("solo");
    expect(lawnBilling.priceToTier["turfpro_crew_yearly"]).toBe("crew");
  });
});
```

- [ ] **Step 6: Gates**

Run: `npx vitest run src/verticals/lawn/billing.test.ts` → PASS.
Run: `npx tsc --noEmit -p tsconfig.app.json` → error set unchanged (6 baseline; `stripe.ts`, `types.ts`, `lawn/index.ts`, `billing.ts` clean; no new file). The `TierId` widening must NOT introduce errors in any consumer.
Run: `npx vitest run` → full suite green.
Run: `npm run build` → **succeeds** (this proves no runtime import cycle from `stripe.ts` reading `vertical`; if `TIERS` were undefined at load the build/tests would fail).

- [ ] **Step 7: Commit**

```bash
git add src/verticals/billing.ts src/verticals/lawn/billing.ts src/lib/stripe.ts src/verticals/types.ts src/verticals/lawn/index.ts src/verticals/lawn/billing.test.ts
git commit
```
(`feat(platform): vertical.billing seam (TIERS from vertical; lawnBilling)` + trailers.)

---

### Task 2: pressureBilling module

**Files:**
- Create: `src/verticals/pressure/billing.ts`
- Test: `src/verticals/pressure/billing.test.ts`

**Interfaces:**
- Consumes: `BillingModule` from `@/verticals/billing`; `Tier`, `TierId` (type-only) from `@/lib/stripe`.
- Produces: `export const pressureBilling: BillingModule` (consumed by 1e assembly).

- [ ] **Step 1: Write the failing test**

Create `src/verticals/pressure/billing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pressureBilling } from "./billing";

describe("pressureBilling", () => {
  it("offers four tiers incl. pro", () => {
    expect(pressureBilling.tiers.map((t) => t.id)).toEqual(["payg", "solo", "pro", "crew"]);
  });
  it("prices via pp_* keys and charges 2% only on payg", () => {
    const payg = pressureBilling.tiers.find((t) => t.id === "payg")!;
    expect(payg.monthly.priceId).toBe("pp_payg_monthly");
    expect(payg.applicationFeePercent).toBe(2);
    for (const t of pressureBilling.tiers.filter((t) => t.id !== "payg")) {
      expect(t.applicationFeePercent).toBe(0);
    }
  });
  it("does not gate route stops (weeklyStopLimit null)", () => {
    for (const t of pressureBilling.tiers) expect(t.weeklyStopLimit).toBeNull();
  });
  it("maps pp_* + legacy pressurepro_* prices to tiers", () => {
    expect(pressureBilling.priceToTier["pp_crew_monthly"]).toBe("crew");
    expect(pressureBilling.priceToTier["pressurepro_yearly"]).toBe("pro");
  });
});
```

- [ ] **Step 2: Run test → fail.**

- [ ] **Step 3: Create the module**

Create `src/verticals/pressure/billing.ts` (prices/highlights verbatim from PressurePro `stripe.ts`, conformed to the turf `Tier` shape — `weeklyStopLimit: null`, `extraSeatPrice: null`; `features`/`iapProductId` NOT ported):

```ts
import type { BillingModule } from "@/verticals/billing";
import type { Tier, TierId } from "@/lib/stripe";

const PRESSURE_TIERS: Tier[] = [
  {
    id: "payg",
    name: "Pay as you go",
    tagline: "Low base — pay only when you earn",
    monthly: { priceId: "pp_payg_monthly", price: 5 },
    yearly: { priceId: "pp_payg_yearly", price: 50, saveLabel: "Save $10" },
    seats: 1,
    extraSeatPrice: null,
    weeklyStopLimit: null,
    highlights: [
      "$5 monthly base",
      "2% on processed payments",
      "Up to 50 quotes / month",
      "Best for trials + cash-heavy ops",
    ],
    applicationFeePercent: 2.0,
  },
  {
    id: "solo",
    name: "Solo",
    tagline: "One truck, one operator",
    monthly: { priceId: "pp_solo_monthly", price: 15 },
    yearly: { priceId: "pp_solo_yearly", price: 150, saveLabel: "Save $30" },
    seats: 1,
    extraSeatPrice: null,
    weeklyStopLimit: null,
    highlights: [
      "Up to 50 quotes / month",
      "1 user",
      "500 MB cloud photo backup",
      "All quote, photo & SMS tools",
    ],
    applicationFeePercent: 0,
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Growing crew",
    monthly: { priceId: "pp_pro_monthly", price: 25 },
    yearly: { priceId: "pp_pro_yearly", price: 250, saveLabel: "Save $50" },
    seats: 2,
    extraSeatPrice: null,
    weeklyStopLimit: null,
    highlights: [
      "Unlimited quotes",
      "2 user seats",
      "5 GB cloud photo backup",
      "QuickBooks sync",
      "Route optimization",
    ],
    applicationFeePercent: 0,
  },
  {
    id: "crew",
    name: "Crew",
    tagline: "Multi-truck operation",
    monthly: { priceId: "pp_crew_monthly", price: 49 },
    yearly: { priceId: "pp_crew_yearly", price: 490, saveLabel: "Save $98" },
    seats: 5,
    extraSeatPrice: null,
    weeklyStopLimit: null,
    highlights: [
      "5 user seats",
      "25 GB cloud photo backup",
      "Fleet calendar",
      "Reporting export",
      "Everything in Pro",
    ],
    applicationFeePercent: 0,
  },
];

const PRESSURE_PRICE_TO_TIER: Record<string, TierId> = {
  pp_payg_monthly: "payg",
  pp_payg_yearly: "payg",
  pp_solo_monthly: "solo",
  pp_solo_yearly: "solo",
  pp_pro_monthly: "pro",
  pp_pro_yearly: "pro",
  pp_crew_monthly: "crew",
  pp_crew_yearly: "crew",
  // Grandfathered legacy single-tier plan → Pro.
  pressurepro_monthly: "pro",
  pressurepro_yearly: "pro",
};

export const pressureBilling: BillingModule = {
  tiers: PRESSURE_TIERS,
  priceToTier: PRESSURE_PRICE_TO_TIER,
};
```

- [ ] **Step 4: Run test → pass.** tsc gate (no new file). `npx vitest run` green.

- [ ] **Step 5: Commit**

```bash
git add src/verticals/pressure/billing.ts src/verticals/pressure/billing.test.ts
git commit
```
(`feat(platform): pressureBilling (4 tiers, pp_* keys + legacy)` + trailers.)

---

## Self-Review notes (author)

- **Spec coverage:** contract + stripe refactor + lawnBilling + register + types (Task 1); pressureBilling (Task 2).
- **Lawn identity:** `LAWN_TIERS` is the exact 3 objects from today's `stripe.ts`; `feeForTier(null)` → `getTier("payg").applicationFeePercent` = 0 for lawn (unchanged). `TIERS`/prices/fees resolve identically.
- **Cycle safety:** `billing.ts`/`lawn/billing.ts`/`pressure/billing.ts` use `import type` for `Tier`/`TierId`; `stripe.ts`'s `vertical` read is validated by a green `npm run build` (Step 6).
- **TierId widening:** no `Record<TierId,…>` literal exists in turf src (checked), so `+"pro"` adds no consumer error; turf tier DATA stays 3 tiers.
- **No placeholders:** full code for every file. Pressure `features`/`iapProductId`/quote-gating intentionally omitted (deferred, per spec).
