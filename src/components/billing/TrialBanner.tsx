import { Link } from "react-router-dom";
import { Clock, ArrowRight } from "lucide-react";
import { useSubscriptionStatus } from "@/hooks/useSubscriptionStatus";
import { cn } from "@/lib/utils";

// Slim banner shown across signed-in pages while the user is still on
// their free trial (or has lapsed without subscribing). Hides itself
// when there's an active subscription — safe to drop into AppShell.
//
// Visual rules:
//   - 4-14 days left:   bronze chip, calm
//   - 1-3 days left:    destructive border + tint, urgent
//   - 0 days left:      destructive, "Trial ended" copy
//
// We deliberately keep this READ-ONLY (link to /pricing only) so it
// can sit on top of any screen without owning checkout state.

export default function TrialBanner() {
  const { loading, hasActiveSubscription, trialDaysRemaining } =
    useSubscriptionStatus();

  // Hide while loading (no flash), and hide entirely for paying users.
  if (loading || hasActiveSubscription) return null;

  // Spec: render whenever a trial value is computable
  // (`trialDaysRemaining !== null`) and there's no active sub.
  if (trialDaysRemaining === null) return null;

  const expired = trialDaysRemaining <= 0;
  const urgent = trialDaysRemaining <= 3; // 0..3 → red border

  let copy: string;
  if (expired) {
    copy = "Your free trial has ended — pick a plan to keep going.";
  } else if (trialDaysRemaining === 1) {
    copy = "1 day left in your trial — pick a plan.";
  } else {
    copy = `${trialDaysRemaining} days left in your trial — pick a plan.`;
  }

  return (
    <div
      className={cn(
        "mx-4 mt-3 rounded-2xl p-3 flex items-center gap-3",
        urgent
          ? "bg-destructive/10 border border-destructive/40"
          : "bg-bronze-100 border border-bronze-400/40",
      )}
      role="status"
    >
      <div
        className={cn(
          "h-8 w-8 rounded-full grid place-items-center shrink-0",
          urgent ? "bg-destructive/20 text-destructive" : "bg-bronze-500 text-white",
        )}
      >
        <Clock className="h-4 w-4" strokeWidth={2.2} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-ink-900 leading-tight">
          {copy}
        </div>
      </div>
      <Link
        to="/pricing"
        className={cn(
          "inline-flex items-center gap-1 text-[12px] font-extrabold px-3 py-2 rounded-full shrink-0",
          urgent
            ? "bg-destructive text-destructive-foreground"
            : "bg-bronze-500 text-white shadow-bronze hover:bg-bronze-600",
        )}
      >
        {expired ? "Pick a plan" : "View plans"}
        <ArrowRight className="h-3 w-3" strokeWidth={2.8} />
      </Link>
    </div>
  );
}
