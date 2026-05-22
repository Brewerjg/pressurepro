import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  getStripeEnvironment,
  tierFromPriceId,
  type TierId,
} from "@/lib/stripe";

// Combined trial + subscription state for the paywall gate.
//
// Trial window: 14 days from `profiles.created_at`. We fall back to the
// auth user's `created_at` only if the profile row is missing (which
// shouldn't happen — the signup trigger creates a profile — but we
// defend against it so the hook can't crash an existing user out of
// access). The trial applies once per user; we don't track separate
// "trial used" state, since `created_at` is immutable.
//
// "Active" subscription mirrors SubGate.tsx in PressurePro: status in
// ('active','trialing','past_due'), plus a canceled-but-paid-through
// grace period. `cancel_at_period_end=true` is still active until the
// period rolls over.

export type SubStatus = {
  loading: boolean;
  hasActiveSubscription: boolean;
  trialDaysRemaining: number | null;
  trialExpired: boolean;
  tier: TierId | null;
};

const TRIAL_DAYS = 14;
const MS_PER_DAY = 86_400_000;

type SubRow = {
  status: string;
  price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  updated_at: string;
};

type ProfileRow = {
  created_at: string;
};

function isActiveSub(sub: SubRow | null): boolean {
  if (!sub) return false;
  const now = Date.now();
  const periodEnd = sub.current_period_end
    ? new Date(sub.current_period_end).getTime()
    : null;
  if (["active", "trialing"].includes(sub.status)) {
    // cancel_at_period_end=true is still active until period rolls over.
    if (sub.cancel_at_period_end && periodEnd !== null && periodEnd <= now) {
      return false;
    }
    return true;
  }
  if (sub.status === "past_due") {
    // Treat as active while Stripe is still attempting to charge — the
    // operator gets a few days to update their card before we lock them
    // out, matching the parent app's behavior.
    return periodEnd === null || periodEnd > now;
  }
  if (sub.status === "canceled") {
    // Paid through the end of the period — keep them in until then.
    return periodEnd !== null && periodEnd > now;
  }
  return false;
}

export function useSubscriptionStatus(): SubStatus {
  const { user, loading: authLoading } = useAuth();

  const query = useQuery({
    queryKey: ["subscription-status", user?.id ?? null],
    enabled: !authLoading && !!user,
    // The webhook updates the subscriptions row asynchronously, so a
    // short stale window keeps the gate responsive without thrashing.
    staleTime: 30_000,
    queryFn: async () => {
      if (!user) {
        return { sub: null as SubRow | null, profile: null as ProfileRow | null };
      }
      // Pull the most recent subscription row (by updated_at, scoped to
      // the current Stripe environment) and the profile row in parallel.
      const [subRes, profileRes] = await Promise.all([
        supabase
          .from("subscriptions")
          .select(
            "status, price_id, current_period_end, cancel_at_period_end, updated_at",
          )
          .eq("user_id", user.id)
          .eq("environment", getStripeEnvironment())
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("created_at")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
      return {
        sub: (subRes.data as SubRow | null) ?? null,
        profile: (profileRes.data as ProfileRow | null) ?? null,
      };
    },
  });

  const loading = authLoading || (!!user && query.isPending);

  if (!user) {
    return {
      loading,
      hasActiveSubscription: false,
      trialDaysRemaining: null,
      trialExpired: false,
      tier: null,
    };
  }

  const sub = query.data?.sub ?? null;
  const profile = query.data?.profile ?? null;
  const hasActiveSubscription = isActiveSub(sub);
  const tier = hasActiveSubscription ? tierFromPriceId(sub?.price_id) : null;

  if (hasActiveSubscription) {
    return {
      loading,
      hasActiveSubscription: true,
      trialDaysRemaining: null,
      trialExpired: false,
      tier,
    };
  }

  // Trial computation — prefer profiles.created_at, fall back to the auth
  // user's created_at if the profile row is missing.
  const createdAtIso =
    profile?.created_at ?? user.created_at ?? null;
  if (!createdAtIso) {
    // Defensive: with no created_at we can't compute a trial. Treat as
    // expired so the paywall surfaces — better than silently granting
    // unlimited access.
    return {
      loading,
      hasActiveSubscription: false,
      trialDaysRemaining: 0,
      trialExpired: true,
      tier: null,
    };
  }

  const createdAtMs = new Date(createdAtIso).getTime();
  const daysSince = Math.floor((Date.now() - createdAtMs) / MS_PER_DAY);
  const trialDaysRemaining = Math.max(0, TRIAL_DAYS - daysSince);
  const trialExpired = trialDaysRemaining <= 0;

  return {
    loading,
    hasActiveSubscription: false,
    trialDaysRemaining,
    trialExpired,
    tier: null,
  };
}
