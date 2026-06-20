// Stripe Connect application-fee helpers, shared by every Stripe-touching
// edge function in TurfPro.
//
// We DUPLICATE the tier→fee mapping that lives in src/lib/stripe.ts here on
// purpose — Deno edge functions can't import from the Vite client bundle.
// The contract MUST stay in sync with `feeForTier()` and `PRICE_TO_TIER` in
// src/lib/stripe.ts. If you change the mapping in one place, update both.
//
// Fee model:
//   - Base tier (id "payg") pays 2.0% on every Connect-routed charge.
//   - Solo / Crew (paid tiers) pay 0%.
//   - No `subscriptions` row at all → treated as Base (2%). Since paid-tier
//     subscriptions are sold via the mobile app store (not Stripe), the
//     default for operators is Base — which is exactly the 2% we collect.
//
// Connect routing is gated by the STRIPE_CONNECT_ENABLED env var (see
// `connectEnabled()` below). When that's false, Connect logic short-circuits
// and the existing platform-account behavior runs — needed for local dev
// where Connect isn't configured.

export type TierId = "payg" | "solo" | "crew";

/**
 * Resolve the application-fee percentage for a given tier id. Mirrors
 * `feeForTier()` in src/lib/stripe.ts exactly.
 */
export function feeForTier(tierId: TierId | null | undefined): number {
  if (!tierId) return 2.0;
  const mapping: Record<TierId, number> = {
    payg: 2.0,
    solo: 0,
    crew: 0,
  };
  return mapping[tierId] ?? 2.0;
}

/**
 * Resolve the operator's current tier from their `subscriptions` row.
 * Returns 'payg' when no subscription exists (the default post-trial
 * state) or when the most recent row is canceled.
 *
 * We sort by updated_at desc so trial → paid transitions resolve to the
 * paid row even if the trial row was created later.
 */
export async function resolveTier(
  supabase: any,
  userId: string,
): Promise<TierId> {
  const { data } = await supabase
    .from("subscriptions")
    .select("price_id, status")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data || data.status === "canceled") return "payg";
  // Map price_id (which is the lookup_key — see payments-webhook
  // resolveLookupKey) to tier — duplicate the mapping here to avoid
  // client/server import cycles. Keep in sync with PRICE_TO_TIER in
  // src/lib/stripe.ts.
  const map: Record<string, TierId> = {
    turfpro_payg_monthly: "payg",
    turfpro_payg_yearly: "payg",
    turfpro_solo_monthly: "solo",
    turfpro_solo_yearly: "solo",
    turfpro_crew_monthly: "crew",
    turfpro_crew_yearly: "crew",
  };
  return map[data.price_id ?? ""] ?? "payg";
}

/**
 * Dev-mode escape hatch. When STRIPE_CONNECT_ENABLED is unset or falsy,
 * all Connect logic short-circuits and existing platform-account behavior
 * runs. Use this in every edge fn before deciding whether to apply
 * Connect routing.
 *
 * Falsy values: undefined, "", "0", "false", "FALSE", "no".
 */
export function connectEnabled(): boolean {
  const v = (Deno.env.get("STRIPE_CONNECT_ENABLED") ?? "").trim().toLowerCase();
  if (!v) return false;
  return !(v === "0" || v === "false" || v === "no");
}

/**
 * Bundled result of looking up the operator's Connect state. Returned by
 * `loadOperatorConnect()` so callers can branch on a single object.
 */
export interface OperatorConnect {
  stripeAccountId: string | null;
  connectReady: boolean;
  tier: TierId;
  feePercent: number;
  /**
   * True when (connect_enabled env) AND connect_ready AND stripe_account_id
   * is set. The single "should we route this through the operator's Connect
   * account?" boolean used by callers.
   */
  shouldRoute: boolean;
}

/**
 * Convenience: load profile.stripe_account_id + profile.connect_ready and
 * the operator's current tier in one call.
 *
 * The `connect_ready` column was added in migration 0019. We tolerate the
 * column being missing (older deploys) by treating its absence as false.
 */
export async function loadOperatorConnect(
  supabase: any,
  userId: string,
): Promise<OperatorConnect> {
  const tier = await resolveTier(supabase, userId);
  const feePercent = feeForTier(tier);

  let stripeAccountId: string | null = null;
  let connectReady = false;
  try {
    // Match by id OR user_id — the merged PressurePro/TurfPro profiles table
    // carries both, and connect-onboarding writes the Connect columns keyed on
    // whichever matched. Since charges now REFUSE when Connect isn't found, a
    // single-column lookup that missed would silently block all payouts.
    const { data } = await supabase
      .from("profiles")
      .select("stripe_account_id, connect_ready")
      .or(`id.eq.${userId},user_id.eq.${userId}`)
      .maybeSingle();
    stripeAccountId = data?.stripe_account_id ?? null;
    connectReady = Boolean(data?.connect_ready);
  } catch (e) {
    console.warn("[fees] profile lookup failed", e);
  }

  const shouldRoute = connectEnabled() && connectReady && !!stripeAccountId;
  return { stripeAccountId, connectReady, tier, feePercent, shouldRoute };
}
