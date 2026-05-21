import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Check, Sparkles, ArrowRight, Loader2, Leaf } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  TIERS,
  type TierId,
  type Cycle,
  tierFromPriceId,
  priceIdForTier,
  redirectToCheckout,
} from "@/lib/stripe";
import { cn } from "@/lib/utils";

// Public marketing surface — no AppShell, no tab bar. The route is
// registered as public in App.tsx so non-authenticated visitors can land
// here from external links. Choosing a plan while signed-out kicks the
// visitor to `/auth?next=/pricing&priceId=...` so they return after sign-in.

type SubRow = {
  status: string;
  price_id: string | null;
};

export default function Pricing() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [subscription, setSubscription] = useState<SubRow | null>(null);
  const [subLoading, setSubLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState<TierId | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read the current subscription so we can highlight the user's tier.
  useEffect(() => {
    let active = true;
    if (!user) {
      setSubLoading(false);
      setSubscription(null);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("subscriptions")
        .select("status, price_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!active) return;
      setSubscription((data as SubRow | null) ?? null);
      setSubLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [user]);

  // Honor an incoming ?priceId hint from the post-auth redirect — the user
  // clicked "Choose plan" while signed-out, signed in, and is now back here.
  // We don't auto-checkout silently; we just preselect the matching cycle
  // and let them click again, so they see the price they're about to pay.
  useEffect(() => {
    const hinted = params.get("priceId");
    if (!hinted) return;
    if (hinted.endsWith("_yearly")) setCycle("yearly");
    else if (hinted.endsWith("_monthly")) setCycle("monthly");
  }, [params]);

  const currentTier: TierId | null = tierFromPriceId(subscription?.price_id ?? null);
  const isActive =
    subscription != null &&
    ["active", "trialing", "past_due"].includes(subscription.status);

  const handleSelect = async (tierId: TierId) => {
    setError(null);
    const priceId = priceIdForTier(tierId, cycle);
    if (!user) {
      const next = encodeURIComponent(`/pricing?priceId=${priceId}`);
      navigate(`/auth?next=${next}&priceId=${priceId}`);
      return;
    }
    setCheckingOut(tierId);
    try {
      await redirectToCheckout({
        priceId,
        userId: user.id,
        customerEmail: user.email ?? undefined,
        returnUrl: `${window.location.origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
        invoke: async (body) => {
          const { data, error } = await supabase.functions.invoke(
            "create-checkout-session",
            { body },
          );
          if (error) return { error: error.message };
          return data as { url?: string; error?: string };
        },
      });
      // redirectToCheckout navigates the window away — control rarely returns.
    } catch (e) {
      setCheckingOut(null);
      setError(e instanceof Error ? e.message : "Couldn't start checkout");
    }
  };

  const loading = authLoading || subLoading;

  return (
    <div className="min-h-screen bg-background">
      <header className="px-5 pt-6 pb-4 flex items-center justify-between max-w-5xl mx-auto">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-[10px] bg-green-800 text-bronze-400 flex items-center justify-center">
            <Leaf className="h-[18px] w-[18px]" strokeWidth={2.2} />
          </div>
          <div className="font-display font-extrabold text-lg text-ink-900">TurfPro</div>
        </Link>
        {!user && !authLoading && (
          <Link
            to="/auth"
            className="text-sm font-semibold text-ink-700 hover:text-ink-900"
          >
            Sign in
          </Link>
        )}
      </header>

      <main className="max-w-5xl mx-auto px-4 pt-2 pb-16">
        <div className="text-center mb-7">
          <h1 className="font-display text-[28px] sm:text-[32px] font-bold text-ink-900">
            Pick your plan
          </h1>
          <p className="text-[13px] sm:text-sm text-ink-500 mt-2">
            Built for lawn-care crews. Cancel anytime.
          </p>
        </div>

        {/* Cycle toggle */}
        <div className="flex justify-center mb-7">
          <div className="inline-flex gap-1 p-1 bg-ink-100 rounded-full">
            {(["monthly", "yearly"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCycle(c)}
                className={cn(
                  "px-4 py-2 rounded-full text-xs font-extrabold transition-colors flex items-center gap-1.5",
                  cycle === c
                    ? "bg-card text-ink-900 shadow-card"
                    : "text-ink-500",
                )}
              >
                {c === "monthly" ? "Monthly" : "Yearly"}
                {c === "yearly" && (
                  <span className="px-1.5 py-0.5 rounded-full bg-bronze-500 text-white text-[10px] font-extrabold tracking-wide">
                    -17%
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="tp-card max-w-md mx-auto mb-6 p-3.5 border border-destructive/30 bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Tier cards */}
        <div className="flex flex-col sm:grid sm:grid-cols-3 gap-3 sm:gap-4 mb-10">
          {TIERS.map((tier) => {
            const cycleData = cycle === "monthly" ? tier.monthly : tier.yearly;
            const isCurrent = isActive && currentTier === tier.id;
            const isPro = tier.id === "pro";
            const busy = checkingOut === tier.id;

            return (
              <div
                key={tier.id}
                className={cn(
                  "relative rounded-[22px] p-5 flex flex-col",
                  isPro
                    ? "bg-gradient-hero-deep text-white shadow-card-lg"
                    : "tp-card",
                )}
              >
                {isPro && (
                  <div className="absolute -top-2.5 left-5 inline-flex items-center gap-1 bg-bronze-500 text-white px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-[0.06em] shadow-bronze">
                    <Sparkles className="h-3 w-3" strokeWidth={2.5} />
                    Most popular
                  </div>
                )}

                <div className="flex items-baseline justify-between mb-3 mt-1">
                  <div>
                    <h3
                      className={cn(
                        "font-display font-black text-xl",
                        isPro ? "text-white" : "text-ink-900",
                      )}
                    >
                      {tier.name}
                    </h3>
                    <p
                      className={cn(
                        "text-[12px]",
                        isPro ? "text-[#cfead8]" : "text-ink-500",
                      )}
                    >
                      {tier.tagline}
                    </p>
                  </div>
                  <div className="text-right">
                    <div
                      className={cn(
                        "font-display font-bold text-[30px] leading-none",
                        isPro ? "text-white" : "text-ink-900",
                      )}
                    >
                      ${cycleData.price}
                    </div>
                    <span
                      className={cn(
                        "text-[11px] font-semibold",
                        isPro ? "text-[#cfead8]" : "text-ink-500",
                      )}
                    >
                      /{cycle === "monthly" ? "mo" : "yr"}
                    </span>
                  </div>
                </div>

                {cycle === "yearly" && (
                  <p
                    className={cn(
                      "text-[12px] font-extrabold -mt-2 mb-3",
                      isPro ? "text-bronze-400" : "text-success",
                    )}
                  >
                    {tier.yearly.saveLabel}
                  </p>
                )}

                <ul className="flex flex-col gap-1.5 mb-4 flex-1 mt-1">
                  {tier.highlights.map((h) => (
                    <li
                      key={h}
                      className={cn(
                        "flex items-start gap-2 text-[13px]",
                        isPro ? "text-white/90" : "text-ink-700",
                      )}
                    >
                      <Check
                        className={cn(
                          "h-4 w-4 shrink-0 mt-0.5",
                          isPro ? "text-bronze-400" : "text-green-600",
                        )}
                        strokeWidth={3}
                      />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <button
                    type="button"
                    disabled
                    className="w-full h-12 rounded-[14px] bg-green-600 text-white font-extrabold text-sm cursor-default"
                  >
                    Current plan
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSelect(tier.id)}
                    disabled={busy || loading}
                    className={cn(
                      "w-full h-12 rounded-[14px] font-extrabold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-60 disabled:active:scale-100",
                      isPro
                        ? "bg-bronze-500 text-white shadow-bronze hover:bg-bronze-600"
                        : "border-[1.5px] border-ink-200 bg-card text-ink-900 hover:bg-ink-100",
                    )}
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        Choose {tier.name}
                        <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                      </>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-center text-[12px] text-ink-500">
          Prices in USD. Stripe handles payment securely — we never see your card.
        </p>
      </main>
    </div>
  );
}
