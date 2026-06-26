// Base ("payg") tier setup helper.
//
// Base is now a flat $8/mo ($80/yr) plan with a 0% payout fee — TurfPro
// takes no per-transaction skim, operators keep 100% of customer payments
// (see feeForTier in src/lib/stripe.ts, which returns 0 for every tier).
// The "payg" id is retained for historical continuity. Unlike the other
// paid tiers (Solo / Crew) sold via Stripe Checkout / app-store IAP, opting
// into Base on web/Android currently just upserts a subscriptions row
// directly rather than starting a recurring charge.
//
// We store the Base lookup_key as `price_id` (rather than null) so that
// the existing tierFromPriceId() resolver and useSubscriptionStatus() hook
// correctly identify Base users as having an active tier. Everything that
// already keys off price_id (SubscriptionGate, the "Current plan" badge on
// Pricing) just works.
//
// status='active' is intentional — Base operators have nothing to "trial"
// or "renew". Setting active also keeps them out of the trial-expired paywall.

import { supabase } from "@/integrations/supabase/client";
import { getStripeEnvironment, priceIdForTier } from "@/lib/stripe";

/**
 * Upsert the caller's subscriptions row to the PAYG tier.
 *
 * Called from the Pricing page when a signed-in user clicks "Start free"
 * on the PAYG card, and also after a signed-out user signs up via
 * `/auth?next=/pricing&autoPayg=1` (the autoPayg query param re-triggers
 * this on the post-auth bounce).
 *
 * Throws on any Supabase error so the caller can surface a message —
 * the page wraps this in a try/catch and shows `setError(...)`.
 */
export async function setPayAsYouGoTier(userId: string): Promise<void> {
  // We store the monthly PAYG lookup_key (vs yearly) since PAYG has no
  // billing cycle semantics — both lookup_keys map to the same tier via
  // PRICE_TO_TIER. Picking monthly is an arbitrary canonical choice.
  const priceId = priceIdForTier("payg", "monthly");
  const environment = getStripeEnvironment();

  // Look for an existing row scoped to this user + Stripe environment.
  // If one exists (e.g. they downgraded from a paid tier or are
  // re-confirming PAYG after a bounce), update it in place to preserve
  // its `id`. Otherwise insert a new row.
  const { data: existing, error: selectError } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("user_id", userId)
    .eq("environment", environment)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (selectError) throw selectError;

  const payload = {
    user_id: userId,
    status: "active",
    price_id: priceId,
    product_id: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    cancel_at_period_end: false,
    canceled_at: null,
    current_period_start: null,
    current_period_end: null,
    trial_end: null,
    environment,
  };

  if (existing?.id) {
    const { error } = await supabase
      .from("subscriptions")
      .update(payload)
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("subscriptions").insert(payload);
    if (error) throw error;
  }
}
