import { useEffect, useState } from "react";
import { ArrowRight, CreditCard, Loader2, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSubscriptionStatus } from "@/hooks/useSubscriptionStatus";
import { getTier, type TierId } from "@/lib/stripe";
import {
  isRevenueCatAvailable,
  getOfferings,
  purchasePackage,
  restorePurchases,
  manageSubscriptions,
  type IapPackage,
} from "@/lib/iap";
import { vertical } from "@/vertical";

// Subscription management card for the Settings → Billing section.
//
// Operator SaaS subscriptions ship through the app stores via RevenueCat, so
// all purchase/cancel/change flows are native-only. On web (or when RevenueCat
// isn't configured) this card renders the current plan read-only and points the
// operator to the mobile app.
//
// Tone matches the rest of Settings (tp-card, bronze/green, rounded-[14px]).
// Purchase/restore patterns mirror src/components/billing/PaywallScreen.tsx.

// Map a RevenueCat package back to the tier it represents, using the product
// identifier (which mirrors the Stripe lookup_keys in src/lib/stripe.ts:
// turfpro_solo_monthly, turfpro_crew_yearly, etc.).
function tierForPackage(pkg: IapPackage): TierId | null {
  const id: string =
    (pkg?.product?.identifier as string) ||
    (pkg?.identifier as string) ||
    "";
  const lower = id.toLowerCase();
  if (lower.includes("crew")) return "crew";
  if (lower.includes("solo")) return "solo";
  if (lower.includes("payg")) return "payg";
  return null;
}

export default function SubscriptionCard() {
  const qc = useQueryClient();
  const { loading, hasActiveSubscription, tier, trialDaysRemaining, trialExpired } =
    useSubscriptionStatus();

  const native = isRevenueCatAvailable();

  // Native (RevenueCat) state.
  const [packages, setPackages] = useState<IapPackage[] | null>(null);
  const [offeringsLoading, setOfferingsLoading] = useState(native);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [managing, setManaging] = useState(false);
  const [iapError, setIapError] = useState<string | null>(null);

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    setOfferingsLoading(true);
    getOfferings()
      .then((pkgs) => {
        if (!cancelled) setPackages(pkgs);
      })
      .catch(() => {
        if (!cancelled) setPackages(null);
      })
      .finally(() => {
        if (!cancelled) setOfferingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [native]);

  // After a successful purchase / restore, re-check the gate. The RevenueCat
  // webhook populates the `subscriptions` table server-side, so we invalidate
  // both subscription query keys and let the UI re-render.
  const refreshSubscription = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["subscription-status"] }),
      qc.invalidateQueries({ queryKey: ["subscription"] }),
    ]);
  };

  const handlePurchase = async (pkg: IapPackage) => {
    setIapError(null);
    setPurchasingId(pkg?.identifier ?? null);
    try {
      const result = await purchasePackage(pkg);
      if (result.status === "success") {
        await refreshSubscription();
      } else if (result.status === "error") {
        setIapError("That change didn't go through. Please try again.");
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

  const handleManage = async () => {
    setIapError(null);
    setManaging(true);
    try {
      await manageSubscriptions();
    } finally {
      setManaging(false);
    }
  };

  // Current-plan label. Active sub → tier name from TIERS; otherwise the free
  // default "Base (free)".
  const currentTier = hasActiveSubscription && tier ? getTier(tier) : null;
  const planName = currentTier ? currentTier.name : "Base (free)";

  const trialLabel =
    !hasActiveSubscription && !trialExpired && trialDaysRemaining !== null
      ? `Free trial · ${trialDaysRemaining} day${
          trialDaysRemaining === 1 ? "" : "s"
        } left`
      : null;

  // Plan summary header — shared by web + native renders.
  const planSummary = (
    <div className="rounded-xl border border-neutral-100 p-3 bg-neutral-100/40">
      <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
        Current plan
      </div>
      {loading ? (
        <div className="text-sm text-neutral-500 mt-1">Loading…</div>
      ) : (
        <div className="mt-1">
          <div className="text-sm font-semibold text-neutral-900">{planName}</div>
          {trialLabel ? (
            <div className="text-[11px] text-accent-700 font-semibold mt-0.5">
              {trialLabel}
            </div>
          ) : trialExpired && !hasActiveSubscription ? (
            <div className="text-[11px] text-neutral-500 mt-0.5">
              Your free trial has ended.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );

  // Web (or RevenueCat unavailable) — read-only with a pointer to the app.
  if (!native) {
    return (
      <div className="tp-card p-4 space-y-3">
        {planSummary}
        <p className="text-[12.5px] text-neutral-700 leading-relaxed">
          Subscriptions are managed in the {vertical.brand.name} mobile app. Open the app on
          your phone to change plans, update billing, or cancel.
        </p>
      </div>
    );
  }

  // Native — packages for the OTHER tiers (so the operator can switch). The
  // store handles proration on an upgrade/downgrade.
  const switchPackages = (packages ?? []).filter((pkg) => {
    const t = tierForPackage(pkg);
    // Hide the free "Base" tier and the tier they're already on.
    if (!t || t === "payg") return false;
    return t !== tier;
  });

  const busy = !!purchasingId || restoring || managing;

  return (
    <div className="tp-card p-4 space-y-3">
      {planSummary}

      {hasActiveSubscription && (
        <button
          type="button"
          onClick={handleManage}
          disabled={busy}
          className="w-full h-10 rounded-[14px] border-[1.5px] border-neutral-200 bg-card text-neutral-900 font-semibold text-sm hover:bg-neutral-100 active:scale-[0.98] transition-transform disabled:opacity-60 disabled:active:scale-100 flex items-center justify-center gap-2"
        >
          {managing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <CreditCard className="h-4 w-4" strokeWidth={2.2} />
              Manage subscription
            </>
          )}
        </button>
      )}

      {/* Change tier — show the other paid tier(s) as upgrade/downgrade CTAs. */}
      <div className="space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
          {hasActiveSubscription ? "Change plan" : "Choose a plan"}
        </div>
        {offeringsLoading ? (
          <div className="rounded-[14px] border border-neutral-100 p-3 flex items-center justify-center gap-2 text-neutral-500 text-[13px]">
            <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2.4} />
            Loading plans…
          </div>
        ) : switchPackages.length === 0 ? (
          <div className="rounded-[14px] border border-neutral-100 p-3 text-[12.5px] text-neutral-500 leading-snug">
            No other plans are available right now. Try again in a moment.
          </div>
        ) : (
          switchPackages.map((pkg) => {
            const product = pkg?.product ?? {};
            const t = tierForPackage(pkg);
            const title: string =
              (t ? getTier(t).name : null) ||
              product.title ||
              pkg?.identifier ||
              "Plan";
            const priceString: string =
              product.priceString ??
              (typeof product.price === "number" ? `$${product.price}` : "");
            const isPurchasing = purchasingId === pkg?.identifier;
            return (
              <button
                key={pkg?.identifier ?? title}
                type="button"
                onClick={() => handlePurchase(pkg)}
                disabled={busy}
                className="w-full rounded-[14px] border border-neutral-100 p-3 flex items-center justify-between text-left active:scale-[0.98] transition-transform disabled:opacity-60 disabled:active:scale-100"
              >
                <div className="flex flex-col">
                  <span className="font-display font-black text-[14px] text-neutral-900">
                    {title}
                  </span>
                  {priceString && (
                    <span className="text-[12px] font-semibold text-neutral-500 mt-0.5">
                      {priceString}
                    </span>
                  )}
                </div>
                <span className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-[14px] bg-accent-500 text-white font-extrabold text-[13px] shadow-accent">
                  {isPurchasing ? (
                    <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2.6} />
                  ) : (
                    <>
                      Switch
                      <ArrowRight className="h-4 w-4" strokeWidth={2.6} />
                    </>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>

      {iapError && (
        <p className="text-[12px] text-red-600 font-semibold">{iapError}</p>
      )}

      <button
        type="button"
        onClick={handleRestore}
        disabled={busy}
        className="w-full text-[13px] font-bold text-brand-700 hover:text-brand-800 underline underline-offset-2 disabled:opacity-60 flex items-center justify-center gap-1.5 pt-1"
      >
        {restoring ? (
          <>
            <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
            Restoring…
          </>
        ) : (
          "Restore purchases"
        )}
      </button>
    </div>
  );
}
