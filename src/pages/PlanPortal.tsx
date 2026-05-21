import { useEffect, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Pause,
  SkipForward,
  CreditCard,
  XCircle,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";
import { BrandHeader } from "@/components/public/BrandHeader";

// Public plan-management portal for TurfPro maintenance customers.
// Unlike PressurePro (which immediately mints a Stripe billing portal
// session and redirects), TurfPro shows an in-app card with explicit
// actions. The Stripe Billing Portal is still available behind the
// "Update payment method" action.

interface Plan {
  id: string;
  customer_name: string;
  address: string;
  amount: number;
  interval_months: number;
  next_charge_date: string;
  services: string[];
  status: "active" | "paused" | "canceled";
  card_last4: string | null;
  user_id: string;
  portal_token: string;
}

interface BusinessInfo {
  business: string;
  phone: string;
}

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

const STATUS_PILL: Record<Plan["status"], { label: string; classes: string }> = {
  active: { label: "Active", classes: "bg-success text-success-foreground" },
  paused: { label: "Paused", classes: "bg-warning text-warning-foreground" },
  canceled: { label: "Canceled", classes: "bg-ink-200 text-ink-700" },
};

const PlanPortal = () => {
  const { token } = useParams();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [business, setBusiness] = useState<BusinessInfo>({ business: "", phone: "" });
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [doneAction, setDoneAction] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setErrorMsg("Missing link token. Ask your service provider to resend the link.");
      setLoading(false);
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from("maintenance_plans")
        .select(
          "id, customer_name, address, amount, interval_months, next_charge_date, services, status, card_last4, user_id, portal_token",
        )
        .eq("portal_token", token)
        .maybeSingle();
      if (error || !data) {
        setErrorMsg("Plan not found — the link may have expired.");
        setLoading(false);
        return;
      }
      setPlan(data as unknown as Plan);
      const { data: prof } = await supabase.rpc("public_business_info", {
        p_user_id: (data as { user_id: string }).user_id,
      });
      const row = prof?.[0];
      if (row) setBusiness({ business: row.business_name ?? "", phone: row.phone ?? "" });
      setLoading(false);
    })();
  }, [token]);

  const updateStatus = async (next: "paused" | "active" | "canceled", action: string) => {
    if (!plan) return;
    setErrorMsg(null);
    setBusyAction(action);
    try {
      const { error } = await supabase
        .from("maintenance_plans")
        .update({ status: next } as never)
        .eq("portal_token", plan.portal_token);
      if (error) throw error;
      setPlan({ ...plan, status: next });
      setDoneAction(action);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Couldn't update your plan.");
    } finally {
      setBusyAction(null);
    }
  };

  const skipNext = async () => {
    if (!plan) return;
    setErrorMsg(null);
    setBusyAction("skip");
    try {
      // Bump next_charge_date by interval_months — i.e. skip the next visit.
      const next = new Date(plan.next_charge_date);
      next.setMonth(next.getMonth() + (plan.interval_months || 1));
      const iso = next.toISOString().slice(0, 10);
      const { error } = await supabase
        .from("maintenance_plans")
        .update({ next_charge_date: iso } as never)
        .eq("portal_token", plan.portal_token);
      if (error) throw error;
      setPlan({ ...plan, next_charge_date: iso });
      setDoneAction("skip");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Couldn't skip the next visit.");
    } finally {
      setBusyAction(null);
    }
  };

  const openBillingPortal = async () => {
    if (!plan) return;
    setErrorMsg(null);
    setBusyAction("card");
    /* TODO: wire Stripe Billing Portal. The create-plan-portal-session edge
       function being built in parallel exposes the API; once landed, mint a
       fresh session for portal_token and redirect there. */
    try {
      const { data, error } = await supabase.functions.invoke(
        "create-plan-portal-session",
        { body: { portal_token: plan.portal_token } },
      );
      if (error) throw error;
      const url = (data as { url?: string })?.url;
      if (!url) throw new Error("Billing portal isn't available yet. Please contact us.");
      window.location.href = url;
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Couldn't open billing portal.");
    } finally {
      setBusyAction(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-green-800" />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 bg-background">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="h-12 w-12 mx-auto rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h1 className="font-display text-xl">Plan not found</h1>
          <p className="text-sm text-muted-foreground">
            {errorMsg || "The link may have expired."}
          </p>
        </div>
      </div>
    );
  }

  if (doneAction) {
    return (
      <PlanPortalConfirmation
        action={doneAction}
        token={plan.portal_token}
        nextChargeDate={plan.next_charge_date}
      />
    );
  }

  const isActive = plan.status === "active";
  const isCanceled = plan.status === "canceled";

  return (
    <div className="min-h-screen bg-background pb-12">
      <BrandHeader business={business.business}>
        <div className="font-mono text-[11px] font-bold tracking-[0.12em] text-bronze-400">
          MAINTENANCE PLAN
        </div>
        <h1 className="font-display text-[28px] text-white mt-1.5">
          Hi {plan.customer_name.split(" ")[0]},
        </h1>
        <p className="text-white/75 text-sm mt-1.5">Manage your lawn-care plan below.</p>
      </BrandHeader>

      <main className="max-w-md mx-auto px-4 pt-5 space-y-4">
        {/* Plan summary */}
        <section className="tp-card p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
                Your plan
              </div>
              <div className="font-bold text-sm text-ink-900 mt-0.5">{plan.address}</div>
            </div>
            <span
              className={
                "px-2.5 py-1 rounded-full text-[10.5px] font-bold uppercase tracking-wider " +
                STATUS_PILL[plan.status].classes
              }
            >
              {STATUS_PILL[plan.status].label}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-y-3 gap-x-3 mt-3">
            <Stat label="Amount" value={fmtUSD(plan.amount)} />
            <Stat label="Billing" value={`Every ${plan.interval_months}mo`} />
            <Stat
              label={isActive ? "Next charge" : "Next charge (paused)"}
              value={fmtDate(plan.next_charge_date)}
            />
            <Stat label="Card on file" value={plan.card_last4 ? `•••• ${plan.card_last4}` : "—"} />
          </div>

          {plan.services && plan.services.length > 0 && (
            <div className="mt-4 pt-3 border-t border-ink-200">
              <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-ink-500 mb-1.5">
                Services
              </div>
              <div className="flex flex-wrap gap-1.5">
                {plan.services.map((s) => (
                  <span
                    key={s}
                    className="px-2.5 py-1 rounded-full bg-green-50 text-green-800 text-[11.5px] font-semibold"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Actions */}
        {!isCanceled && (
          <section>
            <h2 className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground mb-2.5">
              Make a change
            </h2>
            <div className="tp-card p-0 overflow-hidden">
              {isActive ? (
                <>
                  <ActionRow
                    icon={SkipForward}
                    label="Skip next visit"
                    sub={`Push to ${fmtDate(addMonths(plan.next_charge_date, plan.interval_months))}`}
                    onClick={skipNext}
                    busy={busyAction === "skip"}
                  />
                  <ActionRow
                    icon={Pause}
                    label="Pause plan"
                    sub="We'll stop visits until you reactivate"
                    onClick={() => updateStatus("paused", "pause")}
                    busy={busyAction === "pause"}
                  />
                </>
              ) : (
                <ActionRow
                  icon={CalendarClock}
                  label="Reactivate plan"
                  sub="Resume your regular schedule"
                  onClick={() => updateStatus("active", "resume")}
                  busy={busyAction === "resume"}
                />
              )}
              <ActionRow
                icon={CreditCard}
                label="Update payment method"
                sub={plan.card_last4 ? `Card ending in ${plan.card_last4}` : "Add or change card"}
                onClick={openBillingPortal}
                busy={busyAction === "card"}
              />
              <ActionRow
                icon={XCircle}
                label="Cancel plan"
                sub="End this maintenance plan"
                destructive
                onClick={() => updateStatus("canceled", "cancel")}
                busy={busyAction === "cancel"}
              />
            </div>
          </section>
        )}

        {errorMsg && (
          <p className="text-xs text-destructive text-center px-2">{errorMsg}</p>
        )}

        {business.phone && (
          <div className="text-center pt-2">
            <a
              href={`tel:${business.phone.replace(/[^\d+]/g, "")}`}
              className="text-sm font-semibold text-green-800 hover:underline"
            >
              Questions? Call {business.business || "us"}: {business.phone}
            </a>
          </div>
        )}

        <p className="text-center text-[11px] text-muted-foreground pt-4">
          Powered by TurfPro
        </p>
      </main>
    </div>
  );
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-ink-500">
        {label}
      </div>
      <div className="text-[13.5px] font-semibold text-ink-900 mt-0.5 tp-num">{value}</div>
    </div>
  );
}

interface ActionRowProps {
  icon: LucideIcon;
  label: string;
  sub: string;
  onClick: () => void;
  busy?: boolean;
  destructive?: boolean;
}

function ActionRow({ icon: Icon, label, sub, onClick, busy, destructive }: ActionRowProps) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={
        "w-full flex items-center gap-3 p-4 text-left border-b border-hairline last:border-b-0 " +
        "active:bg-ink-100/60 disabled:opacity-60 transition-colors"
      }
    >
      <div
        className={
          "h-10 w-10 rounded-xl flex items-center justify-center shrink-0 " +
          (destructive
            ? "bg-destructive/10 text-destructive"
            : "bg-green-50 text-green-800")
        }
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className={"font-bold text-sm " + (destructive ? "text-destructive" : "text-ink-900")}>
          {label}
        </div>
        <div className="text-[12px] text-muted-foreground truncate">{sub}</div>
      </div>
    </button>
  );
}

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + (months || 1));
  return d.toISOString().slice(0, 10);
}

// Inline confirmation view shown immediately after an action completes
// (without navigating). The `/plans/portal/:token/done` route uses the
// exported PlanPortalDone for link-shared confirmations.
function PlanPortalConfirmation({
  action,
  token,
  nextChargeDate,
}: {
  action: string;
  token: string;
  nextChargeDate: string;
}) {
  const copy = actionCopy(action, nextChargeDate);
  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-background">
      <div className="max-w-sm w-full text-center space-y-4">
        <div className="h-14 w-14 mx-auto rounded-full bg-[hsl(var(--success-bg))] text-success flex items-center justify-center">
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <h1 className="font-display text-2xl">{copy.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.body}</p>
        <Link
          to={`/plans/portal/${token}`}
          className="inline-block text-sm font-semibold text-green-800"
          onClick={(e) => {
            // Force re-mount so the portal refreshes its state.
            e.preventDefault();
            window.location.href = `/plans/portal/${token}`;
          }}
        >
          Back to plan →
        </Link>
      </div>
    </div>
  );
}

function actionCopy(
  action: string,
  nextChargeDate?: string,
): { title: string; body: string } {
  switch (action) {
    case "pause":
    case "paused":
      return {
        title: "Plan paused",
        body: "We've paused your visits. Reactivate any time from this page.",
      };
    case "cancel":
    case "canceled":
      return {
        title: "Plan canceled",
        body: "Sorry to see you go. You can sign up again from a fresh quote any time.",
      };
    case "resume":
    case "active":
      return {
        title: "Plan resumed",
        body: "You're back on the route. We'll be in touch with the next visit.",
      };
    case "skip":
    case "skipped":
      return {
        title: "Next visit skipped",
        body: nextChargeDate
          ? `We'll see you on ${fmtDate(nextChargeDate)} instead.`
          : "We'll see you on the visit after next.",
      };
    case "card":
    case "updated_card":
      return {
        title: "Payment method updated",
        body: "Your new card is on file.",
      };
    default:
      return {
        title: "All set",
        body: "Your changes have been saved.",
      };
  }
}

// /plans/portal/:token/done — used for redirects from external flows like
// the Stripe billing portal's return URL. Reads ?action=... for copy.
export const PlanPortalDone = () => {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const action = searchParams.get("action") || "done";
  const copy = actionCopy(action);
  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-background">
      <div className="max-w-sm w-full text-center space-y-4">
        <div className="h-14 w-14 mx-auto rounded-full bg-[hsl(var(--success-bg))] text-success flex items-center justify-center">
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <h1 className="font-display text-2xl">{copy.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.body}</p>
        {token && (
          <Link
            to={`/plans/portal/${token}`}
            className="inline-block text-sm font-semibold text-green-800"
          >
            Back to plan →
          </Link>
        )}
      </div>
    </div>
  );
};

export default PlanPortal;
