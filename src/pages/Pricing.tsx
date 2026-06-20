import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Check, Sparkles, ArrowRight, Loader2, Leaf } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  TIERS,
  type TierId,
  type Cycle,
  type Tier,
  tierFromPriceId,
  priceIdForTier,
  redirectToCheckout,
} from "@/lib/stripe";
import { setPayAsYouGoTier } from "@/lib/payg";
import { cn } from "@/lib/utils";

// Public marketing surface — no AppShell, no tab bar. The route is
// registered as public in App.tsx so non-authenticated visitors can land
// here from external links. Choosing a paid plan while signed-out kicks
// the visitor to `/auth?next=/pricing&priceId=...`; choosing Pay-as-you-go
// uses `/auth?next=/pricing&autoPayg=1` so we can finish the PAYG setup
// (a small DB write — no Stripe Checkout) automatically on bounce-back.

type SubRow = {
  status: string;
  price_id: string | null;
};

export default function Pricing() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [subscription, setSubscription] = useState<SubRow | null>(null);
  const [subLoading, setSubLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState<TierId | null>(null);
  const [paygSubmitting, setPaygSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read the current subscription so we can highlight the user's tier.
  // Bumping `subscription` after a PAYG setup also re-derives the
  // "Current plan" badge without needing a full page reload.
  const refetchSubscription = async () => {
    if (!user) {
      setSubscription(null);
      setSubLoading(false);
      return;
    }
    const { data } = await supabase
      .from("subscriptions")
      .select("status, price_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setSubscription((data as SubRow | null) ?? null);
    setSubLoading(false);
  };

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

  // Honor ?autoPayg=1 — the signed-out user clicked "Start free" on the
  // PAYG card, signed up, and is now back at /pricing. We finish the
  // setup (subscriptions upsert) and forward to settings with the welcome
  // banner. We only run this once per visit; the query param is stripped
  // immediately so a refresh doesn't loop.
  useEffect(() => {
    if (params.get("autoPayg") !== "1") return;
    if (authLoading) return;
    if (!user) return; // wait for auth context to resolve
    if (paygSubmitting) return;

    setPaygSubmitting(true);
    setError(null);
    (async () => {
      try {
        await setPayAsYouGoTier(user.id);
        // Strip the query param so a back-button or refresh doesn't
        // re-trigger this branch. We do this before the navigate so the
        // URL is clean if the navigate fails for some reason.
        const next = new URLSearchParams(params);
        next.delete("autoPayg");
        setParams(next, { replace: true });
        navigate("/settings?welcome=payg");
      } catch (e) {
        setPaygSubmitting(false);
        setError(
          e instanceof Error ? e.message : "Couldn't activate Base",
        );
      }
    })();
    // We intentionally depend only on user + authLoading; including
    // `params` would re-trigger after we strip the query string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading]);

  const currentTier: TierId | null = tierFromPriceId(subscription?.price_id ?? null);
  const isActive =
    subscription != null &&
    ["active", "trialing", "past_due"].includes(subscription.status);

  const handleSelectPayg = async () => {
    setError(null);
    if (!user) {
      // Signed-out PAYG flow: send to auth with autoPayg so we can finish
      // the setup on bounce-back. We don't need a priceId here — PAYG
      // skips Stripe Checkout entirely.
      const next = encodeURIComponent("/pricing?autoPayg=1");
      navigate(`/auth?next=${next}&autoPayg=1`);
      return;
    }
    setPaygSubmitting(true);
    try {
      await setPayAsYouGoTier(user.id);
      navigate("/settings?welcome=payg");
    } catch (e) {
      setPaygSubmitting(false);
      setError(
        e instanceof Error ? e.message : "Couldn't activate Pay-as-you-go",
      );
    }
  };

  const handleSelectPaid = async (tierId: TierId) => {
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

  const handleSelect = (tierId: TierId) => {
    if (tierId === "payg") {
      void handleSelectPayg();
    } else {
      void handleSelectPaid(tierId);
    }
  };

  const loading = authLoading || subLoading;
  // Suppress the refetch lint warning — we only expose it for future use
  // (eg. an in-page success toast after PAYG setup). It's intentionally
  // unused right now.
  void refetchSubscription;

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

        {/* Tier cards. PAYG renders first as the "no decision" entry
            point. On mobile we stack (flex-col); at lg+ we lay the three
            tiers out in a single row. */}
        <div className="flex flex-col sm:grid sm:grid-cols-3 gap-3 sm:gap-4 mb-10">
          {TIERS.map((tier) => (
            <TierCard
              key={tier.id}
              tier={tier}
              cycle={cycle}
              isCurrent={isActive && currentTier === tier.id}
              busy={
                tier.id === "payg" ? paygSubmitting : checkingOut === tier.id
              }
              disabled={loading || paygSubmitting}
              onSelect={() => handleSelect(tier.id)}
            />
          ))}
        </div>

        <p className="text-center text-[12px] text-ink-500 mt-10">
          Prices in USD. Stripe handles payment securely — we never see your card.
        </p>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TierCard — extracted so the per-tier rendering branches (PAYG vs Crew vs
// the rest) stay readable. PAYG and Crew both have distinct visual treatments;
// Solo uses the default `tp-card` look.

interface TierCardProps {
  tier: Tier;
  cycle: Cycle;
  isCurrent: boolean;
  busy: boolean;
  disabled: boolean;
  onSelect: () => void;
}

function TierCard({ tier, cycle, isCurrent, busy, disabled, onSelect }: TierCardProps) {
  const isFeatured = tier.id === "crew";
  const isPayg = tier.id === "payg";
  const cycleData = cycle === "monthly" ? tier.monthly : tier.yearly;

  // PAYG keeps a clean tp-card (NOT the bronze-gradient hero look that's
  // reserved for the "recommended" Crew tier). Crew stays the visual
  // anchor; PAYG signals "different category" via a quieter chip.
  const cardClass = cn(
    "relative rounded-[22px] p-5 flex flex-col",
    isFeatured ? "bg-gradient-hero-deep text-white shadow-card-lg" : "tp-card",
  );

  return (
    <div className={cardClass}>
      {isFeatured && (
        <div className="absolute -top-2.5 left-5 inline-flex items-center gap-1 bg-bronze-500 text-white px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-[0.06em] shadow-bronze">
          <Sparkles className="h-3 w-3" strokeWidth={2.5} />
          Recommended
        </div>
      )}
      {isPayg && (
        <div className="absolute -top-2.5 left-5 inline-flex items-center gap-1 bg-bronze-400 text-white px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-[0.06em]">
          Best for starting out
        </div>
      )}

      <div className="flex items-baseline justify-between mb-3 mt-1 gap-2">
        <div className="min-w-0">
          <h3
            className={cn(
              "font-display font-black text-xl",
              isFeatured ? "text-white" : "text-ink-900",
            )}
          >
            {tier.name}
          </h3>
          <p
            className={cn(
              "text-[12px]",
              isFeatured ? "text-[#cfead8]" : "text-ink-500",
            )}
          >
            {tier.tagline}
          </p>
        </div>
        <div className="text-right shrink-0">
          {isPayg ? (
            // PAYG reads as a low base + the 2% line carrying the real
            // variable cost: "$5/mo + 2% per payment".
            <>
              <div className="font-display font-bold text-[30px] leading-none text-ink-900">
                ${cycleData.price}
                <span className="text-[13px] font-semibold text-ink-500 ml-0.5">
                  /{cycle === "monthly" ? "mo" : "yr"}
                </span>
              </div>
              <span className="text-[11px] font-extrabold text-bronze-600 whitespace-nowrap">
                + 2% per payment
              </span>
            </>
          ) : (
            <>
              <div
                className={cn(
                  "font-display font-bold text-[30px] leading-none",
                  isFeatured ? "text-white" : "text-ink-900",
                )}
              >
                ${cycleData.price}
              </div>
              <span
                className={cn(
                  "text-[11px] font-semibold",
                  isFeatured ? "text-[#cfead8]" : "text-ink-500",
                )}
              >
                /{cycle === "monthly" ? "mo" : "yr"}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Yearly savings label — never applies to PAYG (saveLabel is ""). */}
      {cycle === "yearly" && !isPayg && tier.yearly.saveLabel && (
        <p
          className={cn(
            "text-[12px] font-extrabold -mt-2 mb-3",
            isFeatured ? "text-bronze-400" : "text-success",
          )}
        >
          {tier.yearly.saveLabel}
        </p>
      )}

      <ul className="flex flex-col gap-1.5 mb-3 flex-1 mt-1">
        {tier.highlights.map((h) => (
          <li
            key={h}
            className={cn(
              "flex items-start gap-2 text-[13px]",
              isFeatured ? "text-white/90" : "text-ink-700",
            )}
          >
            <Check
              className={cn(
                "h-4 w-4 shrink-0 mt-0.5",
                isFeatured ? "text-bronze-400" : "text-green-600",
              )}
              strokeWidth={3}
            />
            <span>{h}</span>
          </li>
        ))}
      </ul>

      {/* PAYG-only callout — explains the Stripe-Connect-vs-cash distinction
          that subscription tiers don't have to surface. */}
      {isPayg && (
        <p className="text-[11px] italic text-ink-500 mb-4 leading-relaxed">
          Need to charge cards? Connect Stripe in Settings. Cash-only
          operators pay just the base — no transaction fees.
        </p>
      )}

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
          onClick={onSelect}
          disabled={busy || disabled}
          className={cn(
            "w-full h-12 rounded-[14px] font-extrabold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-60 disabled:active:scale-100",
            isFeatured
              ? "bg-bronze-500 text-white shadow-bronze hover:bg-bronze-600"
              : "border-[1.5px] border-ink-200 bg-card text-ink-900 hover:bg-ink-100",
          )}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              {`Choose ${tier.name}`}
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </>
          )}
        </button>
      )}
    </div>
  );
}
