import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, CheckCircle2, XCircle, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getStripeEnvironment, tierFromPriceId, getTier } from "@/lib/stripe";
import { cn } from "@/lib/utils";

// Return URL Stripe sends the user to after Checkout. Handles BOTH:
//   - SaaS subscription (default): verify the session, forward to Settings.
//   - Maintenance plan (?kind=plan&plan_id=...): verify, then forward to
//     the plan detail page. On failure leave a breadcrumb and bounce to
//     /plans so the operator can retry or see status.
//
// We verify server-side (via `verify-checkout-session`) so we can show a
// confirmed success state even before the webhook has finished writing.

type VerifyState =
  | { kind: "verifying" }
  | { kind: "success"; status: string; priceId: string | null }
  | { kind: "failed"; message: string };

export default function CheckoutReturn() {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const kind = params.get("kind"); // 'plan' for maintenance-plan flows
  const planId = params.get("plan_id");
  const canceled = params.get("canceled") === "1";
  const isPlanFlow = kind === "plan";
  const navigate = useNavigate();
  const [state, setState] = useState<VerifyState>({ kind: "verifying" });

  useEffect(() => {
    // Stripe's cancel_url path: the operator backed out of Checkout.
    if (canceled) {
      setState({
        kind: "failed",
        message: isPlanFlow
          ? "You canceled the card setup. The plan was rolled back."
          : "Checkout was canceled.",
      });
      return;
    }
    if (!sessionId) {
      setState({ kind: "failed", message: "Missing session id in return URL." });
      return;
    }
    let cancelledFlag = false;
    (async () => {
      const { data, error } = await supabase.functions.invoke(
        "verify-checkout-session",
        {
          body: { sessionId, environment: getStripeEnvironment() },
        },
      );
      if (cancelledFlag) return;
      if (error) {
        setState({ kind: "failed", message: error.message });
        return;
      }
      const payload = data as {
        status?: string;
        payment_status?: string;
        priceId?: string | null;
        error?: string;
      };
      if (payload?.error) {
        setState({ kind: "failed", message: payload.error });
        return;
      }
      const paid =
        payload.payment_status === "paid" ||
        payload.payment_status === "no_payment_required" ||
        payload.status === "complete";
      if (!paid) {
        setState({
          kind: "failed",
          message: "Payment didn't go through. Try a different card or try again.",
        });
        return;
      }
      setState({
        kind: "success",
        status: payload.status ?? "complete",
        priceId: payload.priceId ?? null,
      });
    })();
    return () => {
      cancelledFlag = true;
    };
  }, [sessionId, canceled, isPlanFlow]);

  // Forward after the verify lands.
  //  - Plan flow success → /plans/:id
  //  - SaaS sub success → /settings?welcome=1
  //  - Plan flow failure → leave a breadcrumb (sessionStorage) and go to
  //    /plans so the operator can see the plan list and retry.
  useEffect(() => {
    if (state.kind === "success") {
      const t = setTimeout(() => {
        if (isPlanFlow && planId) {
          navigate(`/plans/${planId}`);
        } else {
          navigate("/settings?welcome=1");
        }
      }, isPlanFlow ? 1500 : 3000);
      return () => clearTimeout(t);
    }
    if (state.kind === "failed" && isPlanFlow) {
      try {
        sessionStorage.setItem(
          "plan_checkout_error",
          JSON.stringify({
            planId,
            message: state.message,
            at: new Date().toISOString(),
          }),
        );
      } catch {
        // sessionStorage may be unavailable (private mode); non-fatal.
      }
    }
  }, [state, navigate, isPlanFlow, planId]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-10">
      <div className="tp-card max-w-md w-full p-6 text-center">
        {state.kind === "verifying" && (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-bronze-500 mx-auto mb-4" />
            <h1 className="font-display text-xl font-bold text-ink-900 mb-1">
              {isPlanFlow ? "Activating the plan…" : "Confirming your subscription…"}
            </h1>
            <p className="text-sm text-ink-500">Hang tight, just a moment.</p>
          </>
        )}

        {state.kind === "success" && (
          isPlanFlow ? (
            <PlanSuccessCard
              onContinue={() =>
                planId ? navigate(`/plans/${planId}`) : navigate("/plans")
              }
            />
          ) : (
            <SuccessCard
              priceId={state.priceId}
              onContinue={() => navigate("/settings?welcome=1")}
            />
          )
        )}

        {state.kind === "failed" && (
          <>
            <XCircle className="h-12 w-12 text-destructive mx-auto mb-3" strokeWidth={2.2} />
            <h1 className="font-display text-xl font-bold text-ink-900 mb-1">
              {isPlanFlow ? "Card setup didn't complete" : "Payment didn't go through"}
            </h1>
            <p className="text-sm text-ink-500 mb-5">{state.message}</p>
            <button
              type="button"
              onClick={() => navigate(isPlanFlow ? "/plans" : "/pricing")}
              className="w-full h-12 rounded-[14px] bg-bronze-500 text-white font-extrabold text-sm shadow-bronze hover:bg-bronze-600 transition-colors"
            >
              {isPlanFlow ? "Back to plans" : "Try again"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function PlanSuccessCard({ onContinue }: { onContinue: () => void }) {
  return (
    <>
      <CheckCircle2
        className="h-14 w-14 text-green-600 mx-auto mb-3"
        strokeWidth={2.2}
      />
      <h1 className="font-display text-xl font-bold text-ink-900 mb-1">
        Card on file. Plan is active.
      </h1>
      <p className="text-sm text-ink-500 mb-5">
        We'll bill the card on schedule. Taking you to the plan…
      </p>
      <button
        type="button"
        onClick={onContinue}
        className={cn(
          "w-full h-12 rounded-[14px] bg-bronze-500 text-white font-extrabold text-sm shadow-bronze hover:bg-bronze-600",
          "transition-colors flex items-center justify-center gap-2",
        )}
      >
        Open plan
        <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
      </button>
    </>
  );
}

function SuccessCard({
  priceId,
  onContinue,
}: {
  priceId: string | null;
  onContinue: () => void;
}) {
  const tierId = tierFromPriceId(priceId);
  const tier = tierId ? getTier(tierId) : null;
  return (
    <>
      <CheckCircle2
        className="h-14 w-14 text-green-600 mx-auto mb-3"
        strokeWidth={2.2}
      />
      <h1 className="font-display text-xl font-bold text-ink-900 mb-1">
        {tier ? `You're subscribed to ${tier.name}` : "You're subscribed"}
      </h1>
      <p className="text-sm text-ink-500 mb-5">
        Welcome to TurfPro. Taking you to your settings…
      </p>
      <button
        type="button"
        onClick={onContinue}
        className={cn(
          "w-full h-12 rounded-[14px] bg-bronze-500 text-white font-extrabold text-sm shadow-bronze hover:bg-bronze-600",
          "transition-colors flex items-center justify-center gap-2",
        )}
      >
        Open settings
        <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
      </button>
    </>
  );
}
