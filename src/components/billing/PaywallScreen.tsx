import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Sparkles, ArrowRight, Leaf, RefreshCw, Lock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { TIERS } from "@/lib/stripe";
import {
  isRevenueCatAvailable,
  getOfferings,
  purchasePackage,
  restorePurchases,
  type IapPackage,
} from "@/lib/iap";
import { cn } from "@/lib/utils";

// Full-screen lockout shown when the operator's trial is over and they
// don't have an active subscription. This is the marketing-visible
// surface that sells the upgrade, so the visual tone matches Home.tsx
// and Pricing.tsx (green/bronze, tp-card, tp-display).
//
// Primary CTA → /pricing (where Stripe Checkout lives). We intentionally
// don't kick checkout straight from here — the operator should see the
// 3 tiers side-by-side first so they can pick the right one.
//
// The "I just paid" button invalidates the subscription-status query so
// the gate re-fetches from Supabase immediately after the webhook lands.

export default function PaywallScreen() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  // Native (RevenueCat) state. On web these stay inert and the existing
  // Stripe-driven layout renders unchanged.
  const native = isRevenueCatAvailable();
  const [packages, setPackages] = useState<IapPackage[] | null>(null);
  const [offeringsLoading, setOfferingsLoading] = useState(native);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [iapError, setIapError] = useState<string | null>(null);

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    setOfferingsLoading(true);
    getOfferings()
      .then((pkgs) => {
        if (cancelled) return;
        setPackages(pkgs);
      })
      .catch(() => {
        if (cancelled) return;
        setPackages(null);
      })
      .finally(() => {
        if (cancelled) return;
        setOfferingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [native]);

  // After a successful purchase or restore, re-check the gate. The
  // RevenueCat webhook populates the `subscriptions` table server-side, so
  // we invalidate both subscription query keys and let the gate re-render.
  const refreshSubscription = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["subscription-status"] }),
      qc.invalidateQueries({ queryKey: ["subscription"] }),
    ]);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: ["subscription-status"] });
    // Small UX touch — keep the spinner visible long enough that the
    // tap registers, even on a fast refetch.
    setTimeout(() => setRefreshing(false), 400);
  };

  const handlePurchase = async (pkg: IapPackage) => {
    setIapError(null);
    setPurchasingId(pkg?.identifier ?? null);
    try {
      const result = await purchasePackage(pkg);
      if (result.status === "success") {
        await refreshSubscription();
      } else if (result.status === "error") {
        setIapError("That purchase didn't go through. Please try again.");
      }
      // "cancelled" — stay quiet, the user backed out intentionally.
    } finally {
      setPurchasingId(null);
    }
  };

  const handleRestore = async () => {
    setIapError(null);
    setRestoring(true);
    try {
      const result = await restorePurchases();
      if (result.status === "success") {
        await refreshSubscription();
      } else {
        setIapError("We couldn't restore your purchases. Please try again.");
      }
    } finally {
      setRestoring(false);
    }
  };

  if (native) {
    return (
      <div className="min-h-screen bg-background">
        <header className="px-5 pt-6 pb-4 flex items-center justify-between max-w-3xl mx-auto">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-[10px] bg-brand-800 text-accent-400 flex items-center justify-center">
              <Leaf className="h-[18px] w-[18px]" strokeWidth={2.2} />
            </div>
            <div className="font-display font-extrabold text-lg text-neutral-900">
              TurfPro
            </div>
          </div>
          <Link
            to="/"
            className="text-sm font-semibold text-neutral-700 hover:text-neutral-900"
          >
            Home
          </Link>
        </header>

        <main className="max-w-3xl mx-auto px-4 pt-2 pb-16">
          <section className="mx-auto max-w-xl text-center pt-2 pb-7">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent-100 border border-accent-400/40 text-accent-700 text-[11px] font-extrabold uppercase tracking-[0.08em] mb-4">
              <Lock className="h-3 w-3" strokeWidth={2.6} />
              Trial ended
            </div>
            <h1 className="tp-display text-[28px] sm:text-[34px] font-bold text-neutral-900 leading-[1.1]">
              Your free trial has ended.
            </h1>
            <p className="text-[14px] sm:text-[15px] text-neutral-500 mt-3 leading-snug">
              Pick a plan to keep running routes, plans, and reports. Your
              customers and history are safe — they'll be right where you
              left them.
            </p>
          </section>

          <section className="mx-auto max-w-xl">
            {offeringsLoading ? (
              <div className="tp-card rounded-[20px] p-6 flex items-center justify-center gap-2 text-neutral-500 text-[14px]">
                <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2.4} />
                Loading plans…
              </div>
            ) : !packages || packages.length === 0 ? (
              <div className="tp-card rounded-[20px] p-6 text-center text-neutral-500 text-[14px]">
                Plans aren't available right now. Pull to refresh or try again
                in a moment.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {packages.map((pkg) => {
                  const product = pkg?.product ?? {};
                  const title: string =
                    product.title || pkg?.identifier || "Plan";
                  const priceString: string =
                    product.priceString ??
                    (typeof product.price === "number"
                      ? `$${product.price}`
                      : "");
                  const isPurchasing = purchasingId === pkg?.identifier;
                  return (
                    <button
                      key={pkg?.identifier ?? title}
                      type="button"
                      onClick={() => handlePurchase(pkg)}
                      disabled={isPurchasing || !!purchasingId || restoring}
                      className="tp-card rounded-[14px] p-4 flex items-center justify-between text-left active:scale-[0.98] transition-transform disabled:opacity-60 disabled:active:scale-100"
                    >
                      <div className="flex flex-col">
                        <span className="font-display font-black text-[15px] text-neutral-900">
                          {title}
                        </span>
                        {priceString && (
                          <span className="text-[13px] font-semibold text-neutral-500 mt-0.5">
                            {priceString}
                          </span>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-1.5 h-10 px-4 rounded-[14px] bg-accent-500 text-white font-extrabold text-[14px] shadow-accent">
                        {isPurchasing ? (
                          <RefreshCw
                            className="h-4 w-4 animate-spin"
                            strokeWidth={2.6}
                          />
                        ) : (
                          <>
                            Subscribe
                            <ArrowRight className="h-4 w-4" strokeWidth={2.6} />
                          </>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {iapError && (
              <p className="text-center text-[13px] text-red-600 font-semibold mt-4">
                {iapError}
              </p>
            )}

            <div className="flex flex-col items-center gap-3 mt-6">
              <button
                type="button"
                onClick={handleRestore}
                disabled={restoring || !!purchasingId}
                className="text-[13px] font-bold text-brand-700 hover:text-brand-800 underline underline-offset-2 disabled:opacity-60"
              >
                {restoring ? "Restoring…" : "Restore purchases"}
              </button>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing}
                className="inline-flex items-center gap-2 text-[13px] font-bold text-neutral-700 hover:text-neutral-900 disabled:opacity-60"
              >
                <RefreshCw
                  className={cn("h-4 w-4", refreshing && "animate-spin")}
                  strokeWidth={2.4}
                />
                I just paid — refresh
              </button>
            </div>
          </section>

          <p className="text-center text-[12px] text-neutral-500 mt-7">
            Routes, Plans, and Reports unlock the moment your subscription
            is active. Customers, photos, and settings stay available either
            way.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header — bare brand chip, no AppShell tab bar on this screen */}
      <header className="px-5 pt-6 pb-4 flex items-center justify-between max-w-3xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-[10px] bg-brand-800 text-accent-400 flex items-center justify-center">
            <Leaf className="h-[18px] w-[18px]" strokeWidth={2.2} />
          </div>
          <div className="font-display font-extrabold text-lg text-neutral-900">
            TurfPro
          </div>
        </div>
        <Link
          to="/"
          className="text-sm font-semibold text-neutral-700 hover:text-neutral-900"
        >
          Home
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-2 pb-16">
        {/* Lockout headline */}
        <section className="mx-auto max-w-xl text-center pt-2 pb-7">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent-100 border border-accent-400/40 text-accent-700 text-[11px] font-extrabold uppercase tracking-[0.08em] mb-4">
            <Lock className="h-3 w-3" strokeWidth={2.6} />
            Trial ended
          </div>
          <h1 className="tp-display text-[28px] sm:text-[34px] font-bold text-neutral-900 leading-[1.1]">
            Your free trial has ended.
          </h1>
          <p className="text-[14px] sm:text-[15px] text-neutral-500 mt-3 leading-snug">
            Pick a plan to keep running routes, plans, and reports. Your
            customers and history are safe — they'll be right where you
            left them.
          </p>
        </section>

        {/* Tier preview — compact, pricing details live on /pricing */}
        <section className="flex flex-col sm:grid sm:grid-cols-3 gap-3 sm:gap-4 mb-7">
          {TIERS.map((tier) => {
            const isFeatured = tier.id === "crew";
            return (
              <div
                key={tier.id}
                className={cn(
                  "relative rounded-[20px] p-4 flex flex-col",
                  isFeatured
                    ? "bg-gradient-hero-deep text-white shadow-card-lg"
                    : "tp-card",
                )}
              >
                {isFeatured && (
                  <div className="absolute -top-2.5 left-4 inline-flex items-center gap-1 bg-accent-500 text-white px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-[0.06em] shadow-accent">
                    <Sparkles className="h-3 w-3" strokeWidth={2.5} />
                    Recommended
                  </div>
                )}

                <div className="flex items-baseline justify-between mt-1 mb-2">
                  <h3
                    className={cn(
                      "font-display font-black text-lg",
                      isFeatured ? "text-white" : "text-neutral-900",
                    )}
                  >
                    {tier.name}
                  </h3>
                  <div className="text-right">
                    <span
                      className={cn(
                        "font-display font-bold text-[22px] leading-none",
                        isFeatured ? "text-white" : "text-neutral-900",
                      )}
                    >
                      ${tier.monthly.price}
                    </span>
                    <span
                      className={cn(
                        "text-[11px] font-semibold ml-0.5",
                        isFeatured ? "text-[#cfead8]" : "text-neutral-500",
                      )}
                    >
                      /mo
                    </span>
                  </div>
                </div>
                <p
                  className={cn(
                    "text-[12px] mb-2.5",
                    isFeatured ? "text-[#cfead8]" : "text-neutral-500",
                  )}
                >
                  {tier.tagline}
                </p>

                <ul className="flex flex-col gap-1.5 flex-1">
                  {tier.highlights.slice(0, 3).map((h) => (
                    <li
                      key={h}
                      className={cn(
                        "flex items-start gap-2 text-[12.5px]",
                        isFeatured ? "text-white/90" : "text-neutral-700",
                      )}
                    >
                      <Check
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 mt-0.5",
                          isFeatured ? "text-accent-400" : "text-brand-600",
                        )}
                        strokeWidth={3}
                      />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-2.5 max-w-xl mx-auto">
          <Link
            to="/pricing"
            className="flex-1 h-12 rounded-[14px] bg-accent-500 text-white font-extrabold text-[15px] shadow-accent hover:bg-accent-600 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
          >
            See plans
            <ArrowRight className="h-4 w-4" strokeWidth={2.6} />
          </Link>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex-1 h-12 rounded-[14px] border-[1.5px] border-neutral-200 bg-card text-neutral-900 font-extrabold text-[14px] hover:bg-neutral-100 active:scale-[0.98] transition-transform disabled:opacity-60 disabled:active:scale-100 flex items-center justify-center gap-2"
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                refreshing && "animate-spin",
              )}
              strokeWidth={2.4}
            />
            I just paid — refresh
          </button>
        </div>

        <p className="text-center text-[12px] text-neutral-500 mt-5">
          Routes, Plans, and Reports unlock the moment your subscription
          is active. Customers, photos, and settings stay available either
          way.
        </p>
      </main>
    </div>
  );
}
