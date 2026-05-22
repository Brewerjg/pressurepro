import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Sparkles, ArrowRight, Leaf, RefreshCw, Lock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { TIERS } from "@/lib/stripe";
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

  const handleRefresh = async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: ["subscription-status"] });
    // Small UX touch — keep the spinner visible long enough that the
    // tap registers, even on a fast refetch.
    setTimeout(() => setRefreshing(false), 400);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header — bare brand chip, no AppShell tab bar on this screen */}
      <header className="px-5 pt-6 pb-4 flex items-center justify-between max-w-3xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-[10px] bg-green-800 text-bronze-400 flex items-center justify-center">
            <Leaf className="h-[18px] w-[18px]" strokeWidth={2.2} />
          </div>
          <div className="font-display font-extrabold text-lg text-ink-900">
            TurfPro
          </div>
        </div>
        <Link
          to="/"
          className="text-sm font-semibold text-ink-700 hover:text-ink-900"
        >
          Home
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-2 pb-16">
        {/* Lockout headline */}
        <section className="mx-auto max-w-xl text-center pt-2 pb-7">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-bronze-100 border border-bronze-400/40 text-bronze-700 text-[11px] font-extrabold uppercase tracking-[0.08em] mb-4">
            <Lock className="h-3 w-3" strokeWidth={2.6} />
            Trial ended
          </div>
          <h1 className="tp-display text-[28px] sm:text-[34px] font-bold text-ink-900 leading-[1.1]">
            Your free trial has ended.
          </h1>
          <p className="text-[14px] sm:text-[15px] text-ink-500 mt-3 leading-snug">
            Pick a plan to keep running routes, plans, and reports. Your
            customers and history are safe — they'll be right where you
            left them.
          </p>
        </section>

        {/* Tier preview — compact, pricing details live on /pricing */}
        <section className="flex flex-col sm:grid sm:grid-cols-3 gap-3 sm:gap-4 mb-7">
          {TIERS.map((tier) => {
            const isPro = tier.id === "pro";
            return (
              <div
                key={tier.id}
                className={cn(
                  "relative rounded-[20px] p-4 flex flex-col",
                  isPro
                    ? "bg-gradient-hero-deep text-white shadow-card-lg"
                    : "tp-card",
                )}
              >
                {isPro && (
                  <div className="absolute -top-2.5 left-4 inline-flex items-center gap-1 bg-bronze-500 text-white px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-[0.06em] shadow-bronze">
                    <Sparkles className="h-3 w-3" strokeWidth={2.5} />
                    Most popular
                  </div>
                )}

                <div className="flex items-baseline justify-between mt-1 mb-2">
                  <h3
                    className={cn(
                      "font-display font-black text-lg",
                      isPro ? "text-white" : "text-ink-900",
                    )}
                  >
                    {tier.name}
                  </h3>
                  <div className="text-right">
                    <span
                      className={cn(
                        "font-display font-bold text-[22px] leading-none",
                        isPro ? "text-white" : "text-ink-900",
                      )}
                    >
                      ${tier.monthly.price}
                    </span>
                    <span
                      className={cn(
                        "text-[11px] font-semibold ml-0.5",
                        isPro ? "text-[#cfead8]" : "text-ink-500",
                      )}
                    >
                      /mo
                    </span>
                  </div>
                </div>
                <p
                  className={cn(
                    "text-[12px] mb-2.5",
                    isPro ? "text-[#cfead8]" : "text-ink-500",
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
                        isPro ? "text-white/90" : "text-ink-700",
                      )}
                    >
                      <Check
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 mt-0.5",
                          isPro ? "text-bronze-400" : "text-green-600",
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
            className="flex-1 h-12 rounded-[14px] bg-bronze-500 text-white font-extrabold text-[15px] shadow-bronze hover:bg-bronze-600 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
          >
            See plans
            <ArrowRight className="h-4 w-4" strokeWidth={2.6} />
          </Link>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex-1 h-12 rounded-[14px] border-[1.5px] border-ink-200 bg-card text-ink-900 font-extrabold text-[14px] hover:bg-ink-100 active:scale-[0.98] transition-transform disabled:opacity-60 disabled:active:scale-100 flex items-center justify-center gap-2"
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

        <p className="text-center text-[12px] text-ink-500 mt-5">
          Routes, Plans, and Reports unlock the moment your subscription
          is active. Customers, photos, and settings stay available either
          way.
        </p>
      </main>
    </div>
  );
}
