import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Lock, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { vertical } from "@/vertical";

// Inline banner — drop into a screen anywhere we want to nudge the operator
// toward an active subscription. Renders nothing while loading or when the
// subscription is active, so it's safe to sprinkle conditionally:
//
//   <SubscriptionGate variant="route-mode" />
//
// We deliberately keep this READ-ONLY — no checkout buttons here, just a CTA
// to /pricing. Subscription state is read inline (no hook) to keep the
// component self-contained and avoid pulling in a real-time channel for a
// banner that may not even render.

type SubRow = {
  status: string;
  current_period_end: string | null;
  trial_end: string | null;
};

type GateState =
  | { kind: "loading" }
  | { kind: "active" }
  | { kind: "trial"; daysLeft: number }
  | { kind: "expired" }
  | { kind: "none" };

interface Props {
  /** Override copy for context-specific banners (e.g. "Routing requires Pro"). */
  message?: string;
  /** Tailwind classes appended to the outer wrapper for layout. */
  className?: string;
}

export default function SubscriptionGate({ message, className }: Props) {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<GateState>({ kind: "loading" });

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setState({ kind: "none" });
      return;
    }
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("subscriptions")
        .select("status, current_period_end, trial_end")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!active) return;
      setState(computeState((data as SubRow | null) ?? null));
    })();
    return () => {
      active = false;
    };
  }, [user, authLoading]);

  if (state.kind === "loading" || state.kind === "active") return null;

  let copy = message;
  if (!copy) {
    if (state.kind === "trial") {
      copy =
        state.daysLeft === 1
          ? `Your trial ends tomorrow — pick a plan to keep ${vertical.brand.name}.`
          : `${state.daysLeft} days left in your trial.`;
    } else if (state.kind === "expired") {
      copy = "Your subscription has lapsed. Reactivate to keep going.";
    } else {
      copy = `Subscribe to unlock ${vertical.brand.name}.`;
    }
  }

  const isUrgent = state.kind === "expired" || state.kind === "none";

  return (
    <div
      className={cn(
        "rounded-2xl p-3.5 flex items-center gap-3",
        isUrgent
          ? "bg-destructive/10 border border-destructive/30"
          : "bg-accent-100 border border-accent-400/40",
        className,
      )}
    >
      <div
        className={cn(
          "h-9 w-9 rounded-full grid place-items-center shrink-0",
          isUrgent ? "bg-destructive/20 text-destructive" : "bg-accent-500 text-white",
        )}
      >
        <Lock className="h-4 w-4" strokeWidth={2.2} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-neutral-900 leading-tight">
          {copy}
        </div>
      </div>
      <Link
        to="/pricing"
        className={cn(
          "inline-flex items-center gap-1 text-[12px] font-extrabold px-3 py-2 rounded-full shrink-0",
          isUrgent
            ? "bg-destructive text-destructive-foreground"
            : "bg-accent-500 text-white shadow-accent hover:bg-accent-600",
        )}
      >
        {state.kind === "expired" ? "Reactivate" : "View plans"}
        <ArrowRight className="h-3 w-3" strokeWidth={2.8} />
      </Link>
    </div>
  );
}

function computeState(sub: SubRow | null): GateState {
  if (!sub) return { kind: "none" };
  const now = Date.now();
  const periodEnd = sub.current_period_end
    ? new Date(sub.current_period_end).getTime()
    : null;
  const trialEnd = sub.trial_end ? new Date(sub.trial_end).getTime() : null;

  // Active or paid past_due still inside the period → no banner.
  if (sub.status === "active") return { kind: "active" };
  if (sub.status === "past_due" && (periodEnd === null || periodEnd > now)) {
    return { kind: "active" };
  }
  if (
    sub.status === "canceled" &&
    periodEnd !== null &&
    periodEnd > now
  ) {
    // Canceled but still inside paid-through period — treat as active for now.
    return { kind: "active" };
  }
  if (sub.status === "trialing" && trialEnd && trialEnd > now) {
    const daysLeft = Math.max(1, Math.ceil((trialEnd - now) / 86_400_000));
    return { kind: "trial", daysLeft };
  }
  return { kind: "expired" };
}
