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
import { nextVisitDate } from "@/lib/next-visit";

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
  // Service-cadence fields. Added in 0001_turfpro_lawn_care.sql. day_of_week
  // is nullable when the operator hasn't assigned a route day yet.
  day_of_week: number | null;
  frequency: string;
  start_date: string;
}

interface NextVisitInfo {
  date: Date;
  // Soft prediction of arrival window, derived from this customer's route
  // stop sort_order. null when there's no scheduled route_stop matching
  // the visit date (typical until the operator builds that day's route).
  approxTimeLabel: string | null;
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
  const [nextVisit, setNextVisit] = useState<NextVisitInfo | null>(null);
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
      // Cast: day_of_week / frequency / start_date were added in migration
      // 0001 and are present in generated types, but the runtime select
      // string drives the response shape — we narrow to Plan after.
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (cols: string) => {
            eq: (k: string, v: string) => {
              maybeSingle: () => Promise<{ data: Plan | null; error: unknown }>;
            };
          };
        };
      })
        .from("maintenance_plans")
        .select(
          "id, customer_name, address, amount, interval_months, next_charge_date, services, status, card_last4, user_id, portal_token, day_of_week, frequency, start_date",
        )
        .eq("portal_token", token)
        .maybeSingle();
      if (error || !data) {
        setErrorMsg("Plan not found — the link may have expired.");
        setLoading(false);
        return;
      }
      const planRow = data as Plan;
      setPlan(planRow);
      const { data: prof } = await supabase.rpc("public_business_info", {
        p_user_id: planRow.user_id,
      });
      const row = prof?.[0];
      if (row) setBusiness({ business: row.business_name ?? "", phone: row.phone ?? "" });

      // Compute the next visit + (optionally) the approx arrival window.
      // Only meaningful for active plans — paused/canceled customers don't
      // have an upcoming visit.
      if (planRow.status === "active") {
        const visit = nextVisitDate({
          day_of_week: planRow.day_of_week,
          frequency: planRow.frequency,
          start_date: planRow.start_date,
        });
        if (visit) {
          let approxTimeLabel: string | null = null;
          // Look up a route_stop on this date for this plan. RLS will
          // silently return zero rows for the unauth'd public client; that's
          // fine — we just won't show a time estimate. (When the operator's
          // RLS policy is later extended to portal-token-scoped access this
          // will start showing.)
          const ymd = visit.toISOString().slice(0, 10);
          const { data: stopRows } = await (supabase as unknown as {
            from: (t: string) => {
              select: (cols: string) => {
                eq: (k: string, v: string) => {
                  eq: (k2: string, v2: string) => Promise<{ data: Array<{ sort_order: number; routes: { date: string } | null }> | null }>;
                };
              };
            };
          })
            .from("route_stops")
            .select("sort_order, routes!inner(date)")
            .eq("plan_id", planRow.id)
            .eq("routes.date", ymd);
          const stop = stopRows?.[0];
          if (stop) {
            approxTimeLabel = approxArrivalLabel(stop.sort_order);
          }
          setNextVisit({ date: visit, approxTimeLabel });
        }
        // TODO: weather caveat (e.g. "may be rescheduled if rain") — the
        // existing useForecast hook requires operator auth. A public-safe
        // path could call the forecast edge function with just the zip from
        // plan.address; skipped for v1.
      }

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

        {/* Your next visit — only meaningful for active plans where we
            can compute a real day. Paused/canceled plans skip this. */}
        {plan.status === "active" && nextVisit && (
          <section>
            <h2 className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground mb-2.5">
              Your next visit
            </h2>
            <div className="tp-card p-4">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-xl bg-green-50 text-green-800 flex items-center justify-center shrink-0">
                  <CalendarClock className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm text-ink-900">
                    {fmtVisitDate(nextVisit.date)}
                  </div>
                  {nextVisit.approxTimeLabel && (
                    <div className="text-[12px] text-muted-foreground mt-0.5">
                      Around {nextVisit.approxTimeLabel}
                    </div>
                  )}
                  {!nextVisit.approxTimeLabel && (
                    <div className="text-[12px] text-muted-foreground mt-0.5">
                      We'll send a heads-up the night before.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

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

// Rough arrival-window guess for a route_stop. We assume operators start
// their first stop at 8:00 am and that each stop takes ~25 minutes including
// drive time. This is intentionally fuzzy ("~10:30 am") because:
//   - real-world routes vary by traffic, weather, and equipment problems,
//   - we don't yet have the operator's actual start hour on a profile, and
//   - over-promising would erode trust on the first late visit.
function approxArrivalLabel(sortOrder: number | null | undefined): string | null {
  if (sortOrder == null || sortOrder < 0) return null;
  const totalMinutes = 8 * 60 + sortOrder * 25;
  const hour = Math.floor(totalMinutes / 60) % 24;
  const min = totalMinutes % 60;
  const period = hour < 12 ? "am" : "pm";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  const minStr = min === 0 ? "00" : min < 10 ? `0${min}` : `${min}`;
  return `~${displayHour}:${minStr} ${period}`;
}

function fmtVisitDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
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
