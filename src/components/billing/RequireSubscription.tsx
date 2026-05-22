import { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useSubscriptionStatus } from "@/hooks/useSubscriptionStatus";
import PaywallScreen from "./PaywallScreen";

// Gate for the "core operator" routes (Routes, Plans, Reports). The
// rules, per TURFPRO_SPEC + paywall brief:
//
//   1. Loading auth or subscription state → centered spinner.
//   2. Active subscription                 → pass through.
//   3. Inside the 14-day trial window     → pass through.
//   4. Otherwise                          → full-screen paywall.
//
// The trial window is computed against `profiles.created_at` inside
// `useSubscriptionStatus`. Non-gated routes (Home, Customers, Settings,
// Photos, Calc, ChemLog) wrap with `<Protected>` instead so the
// operator can still see their data after the trial expires.

export default function RequireSubscription({ children }: { children: ReactNode }) {
  const { loading, hasActiveSubscription, trialDaysRemaining, trialExpired } =
    useSubscriptionStatus();

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-ink-400" strokeWidth={2} />
      </div>
    );
  }

  if (hasActiveSubscription) return <>{children}</>;

  // Trial still has days left → allow access. `trialDaysRemaining`
  // may be null for the no-user / defensive cases; treat those as 0.
  if (!trialExpired && (trialDaysRemaining ?? 0) > 0) {
    return <>{children}</>;
  }

  return <PaywallScreen />;
}
