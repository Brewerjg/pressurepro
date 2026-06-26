// TurfPro Stripe client helpers.
//
// We use a DYNAMIC import for @stripe/stripe-js so that the Vite build does
// not hard-fail in environments where `npm install` hasn't been run yet.
// The package is listed in package.json — once installed, getStripe() will
// resolve normally. If the dep is missing, getStripe() rejects at call time
// (rather than at module-load time, which would break the whole bundle).
//
// TurfPro shares PressurePro's Supabase project, so the same Stripe API keys
// + webhook secrets are reused server-side. Client-side we read
// VITE_PAYMENTS_CLIENT_TOKEN, the publishable key. `pk_test_*` means sandbox.

import { openInAppBrowser } from "@/lib/native-browser";

type StripeEnv = "sandbox" | "live";

const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;
const environment: StripeEnv = clientToken?.startsWith("pk_test_") ? "sandbox" : "live";

// We type the loaded module loosely to avoid pulling @stripe/stripe-js types
// into the build graph statically. The dynamic import is gated by getStripe().
let stripePromise: Promise<unknown> | null = null;

export function getStripe(): Promise<unknown> {
  if (!stripePromise) {
    if (!clientToken) {
      return Promise.reject(new Error("VITE_PAYMENTS_CLIENT_TOKEN is not set"));
    }
    // We dodge Rollup's static dependency analysis by using a variable +
    // a vite-ignore hint. This lets the build succeed in environments
    // where the dep hasn't been installed yet; the import only fails at
    // runtime when getStripe() is actually called.
    const moduleSpecifier = "@stripe/stripe-js";
    stripePromise = import(/* @vite-ignore */ moduleSpecifier)
      .then((mod: any) => mod.loadStripe(clientToken))
      .catch((err) => {
        console.error(
          "[stripe] Failed to load @stripe/stripe-js — run `npm install` to add it.",
          err,
        );
        throw err;
      });
  }
  return stripePromise;
}

export function getStripeEnvironment(): StripeEnv {
  return environment;
}

export type TierId = "payg" | "solo" | "crew";
export type Cycle = "monthly" | "yearly";

export interface Tier {
  id: TierId;
  name: string;
  tagline: string;
  monthly: { priceId: string; price: number };
  yearly: { priceId: string; price: number; saveLabel: string };
  /** Short bullet list shown on the pricing card. */
  highlights: string[];
  /** Number of user seats INCLUDED in the base price. */
  seats: number;
  /**
   * Price per ADDITIONAL seat beyond `seats`, in whole dollars/month. null =
   * extra seats not offered (the tier is capped at `seats`). Currently only
   * Crew sells add-on seats (+$10/seat beyond the 5 included).
   */
  extraSeatPrice: number | null;
  /**
   * Max route stops the operator may schedule per week. null = unlimited.
   * Enforced via canScheduleMoreStops()/weeklyStopLimitFor() against the
   * current week's route_stops count.
   */
  weeklyStopLimit: number | null;
  /**
   * Stripe Connect application fee percentage on customer-facing charges.
   * As of the 2026 pricing reset this is 0% on EVERY tier — TurfPro's revenue
   * is subscription-only and operators keep 100% of customer payments.
   * See feeForTier() for the runtime resolver.
   */
  applicationFeePercent: number;
}

// IMPORTANT — placeholder price IDs.
// Replace these constants with the real Stripe Price IDs (or lookup_keys)
// after creating the TurfPro Products + Prices in the Stripe dashboard.
// The edge function `create-checkout-session` resolves these via
// `stripe.prices.list({ lookup_keys: [priceId] })`, so they should be set
// as the price's lookup_key in Stripe — not the `price_xxx` ID.
export const TIERS: Tier[] = [
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

// Map any priceId / lookup_key back to a tier. Used by the Pricing page +
// SubscriptionGate to identify the user's current tier from the
// subscriptions row.
const PRICE_TO_TIER: Record<string, TierId> = {
  turfpro_payg_monthly: "payg",
  turfpro_payg_yearly: "payg",
  turfpro_solo_monthly: "solo",
  turfpro_solo_yearly: "solo",
  turfpro_crew_monthly: "crew",
  turfpro_crew_yearly: "crew",
};

/**
 * Resolve the application-fee percentage for a given tier id.
 *
 * As of the 2026 pricing reset, EVERY tier is 0% — TurfPro takes no
 * application fee on customer→operator payments; revenue is subscription-only.
 * Kept as a function (rather than inlining 0) so a future fee can be
 * reintroduced in one place, and so existing callers don't change.
 */
export function feeForTier(tierId: TierId | null | undefined): number {
  if (!tierId) return 0;
  const tier = TIERS.find((t) => t.id === tierId);
  return tier?.applicationFeePercent ?? 0;
}

/**
 * Weekly route-stop limit for a tier (null = unlimited). Operators with no
 * resolved tier fall back to the Base limit — the most restrictive paid floor.
 */
export function weeklyStopLimitFor(tierId: TierId | null | undefined): number | null {
  const tier = tierId ? TIERS.find((t) => t.id === tierId) : undefined;
  return (tier ?? getTier("payg")).weeklyStopLimit;
}

/**
 * True when `currentWeekStops` is below the tier's weekly limit (or the tier
 * is unlimited). Used to gate scheduling more stops + drive the upgrade prompt.
 */
export function canScheduleMoreStops(
  tierId: TierId | null | undefined,
  currentWeekStops: number,
): boolean {
  const limit = weeklyStopLimitFor(tierId);
  return limit === null || currentWeekStops < limit;
}

export function tierFromPriceId(priceId: string | null | undefined): TierId | null {
  if (!priceId) return null;
  return PRICE_TO_TIER[priceId] ?? null;
}

export function getTier(id: TierId): Tier {
  return TIERS.find((t) => t.id === id)!;
}

export function priceIdForTier(id: TierId, cycle: Cycle): string {
  const tier = getTier(id);
  return cycle === "monthly" ? tier.monthly.priceId : tier.yearly.priceId;
}

/**
 * Redirect to Stripe Checkout for the given priceId by calling the
 * `create-checkout-session` edge function. The edge function returns a
 * hosted Checkout URL; we navigate the browser to it.
 *
 * On error (no auth, edge function failure, etc.) the caller is responsible
 * for surfacing a message to the user — this helper just throws.
 */
export async function redirectToCheckout(opts: {
  priceId: string;
  userId: string;
  customerEmail?: string;
  /** Where Stripe should send the user after success / cancel. */
  returnUrl: string;
  /** Pre-built fetch (e.g. `supabase.functions.invoke`-style). */
  invoke: (body: Record<string, unknown>) => Promise<{ url?: string; error?: string }>;
}): Promise<void> {
  const { priceId, userId, customerEmail, returnUrl, invoke } = opts;
  const env = getStripeEnvironment();
  const result = await invoke({
    priceId,
    userId,
    customerEmail,
    returnUrl,
    environment: env,
  });
  if (result.error || !result.url) {
    throw new Error(result.error || "Checkout session did not return a URL");
  }
  await openInAppBrowser(result.url);
}
