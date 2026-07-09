import type { Tier, TierId } from "@/lib/stripe";

// The billing seam — subscription tiers + Stripe price mapping per trade.
export interface BillingModule {
  /** Subscription tiers offered by this vertical (full pricing config). */
  tiers: Tier[];
  /** Reverse map: Stripe price lookup_key (incl. legacy) → tier id. */
  priceToTier: Record<string, TierId>;
}
