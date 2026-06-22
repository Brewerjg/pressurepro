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
  /** Seat count surfaced in the card subtitle. */
  seats: number;
  /**
   * Stripe Connect application fee percentage applied to every customer-facing
   * charge that flows through the operator's Stripe account (plan billing,
   * quote deposits, per-visit charges). Base (Pay-as-you-go) pays 1.5%; paid
   * tiers pay 0%. See feeForTier() for the runtime resolver.
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
    tagline: "Low base — pay only when you earn",
    monthly: { priceId: "turfpro_payg_monthly", price: 5 },
    yearly: { priceId: "turfpro_payg_yearly", price: 50, saveLabel: "Save $10" },
    seats: 1,
    // Base tier's Stripe Connect application fee (the % TurfPro keeps on each
    // customer→operator charge). Paid tiers below are 0%.
    highlights: [
      "$5 monthly base",
      "1.5% on processed payments",
      "All operator features",
      "Best for trials + cash-heavy ops",
    ],
    applicationFeePercent: 1.5,
  },
  {
    id: "solo",
    name: "Solo",
    tagline: "One truck, one operator",
    monthly: { priceId: "turfpro_solo_monthly", price: 15 },
    yearly: { priceId: "turfpro_solo_yearly", price: 150, saveLabel: "Save $30" },
    seats: 1,
    highlights: [
      "1 user seat",
      "Up to 50 stops / week",
      "Customer & property records",
      "Photo before/after, chemical log",
      "Weather & spray-day planner (beta)",
    ],
    applicationFeePercent: 0,
  },
  {
    id: "crew",
    name: "Crew",
    tagline: "Multi-truck operation",
    monthly: { priceId: "turfpro_crew_monthly", price: 49 },
    yearly: { priceId: "turfpro_crew_yearly", price: 490, saveLabel: "Save $98" },
    seats: 5,
    highlights: [
      "5 user seats",
      "Unlimited stops",
      "Multi-truck routing & route optimization (beta)",
      "QuickBooks sync (coming soon)",
      "Recurring billing + maintenance plans",
      "Fleet view, crew calendar & report export",
      "Everything in Solo",
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
 * Resolve the application-fee percentage for a given tier id. Used by:
 *   - create-plan-subscription / create-checkout-session edge fns when
 *     setting `application_fee_amount` on Stripe Connect charges
 *   - Reports page when computing "TurfPro fees this month" + Solo upgrade
 *     callout math
 *
 * Operators with no `subscriptions` row at all are treated as Base (1.5%).
 * This matches the post-trial state where the trial expired and they
 * never picked a tier — the fee model becomes their default.
 */
export function feeForTier(tierId: TierId | null | undefined): number {
  if (!tierId) return 1.5;
  const tier = TIERS.find((t) => t.id === tierId);
  return tier?.applicationFeePercent ?? 1.5;
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
