import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  CreditCard,
  DollarSign,
  Loader2,
  Pause,
  Play,
  Repeat,
  Send,
  Trash2,
  XCircle,
  Edit3,
  Save,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";
import { mutatePlanSubscription, type PlanAction } from "@/lib/plan-stripe";
import {
  recordPayment,
  type ManualPaymentMethod,
  METHOD_LABEL,
} from "@/lib/manual-payments";
import { sendPaymentRetryLink } from "@/lib/customer-email";
import { sendPaymentRetryLinkSms } from "@/lib/customer-sms";
import MessageCustomerButton from "@/components/messaging/MessageCustomerButton";
import { RESEND_ENABLED, TWILIO_ENABLED } from "@/lib/feature-flags";
import { vertical } from "@/vertical";

// PlanDetail. Mirrors PressurePro's PlanDetail but reads lawn-care extras
// (day_of_week, frequency, season_pause, plan_kind) added in
// supabase/migrations/0001_turfpro_lawn_care.sql.
//
// Pause / Resume / Cancel: optimistically flips the row's status for snappy
// UI, then fires `mutate-plan-subscription` so the real Stripe Subscription
// is paused / canceled to match. If Stripe errors out the local row stays
// flipped (the webhook will eventually correct it) but the UI surfaces the
// error so the operator knows.

type LawnPlan = Database["public"]["Tables"]["maintenance_plans"]["Row"] & {
  day_of_week: number | null;
  frequency: "weekly" | "biweekly" | "monthly" | "fert_program";
  season_pause: string[] | null;
  plan_kind: "mow" | "fert_program" | "other";
};

type PlanStatus = "active" | "paused" | "canceled";

type ChargeEntry = {
  date?: string;
  amount?: number;
  status?: string;
};

const DAY_LABEL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const BILLING_OPTIONS: (3 | 6 | 12)[] = [3, 6, 12];
const SEASONS = ["winter", "spring", "summer", "fall"] as const;

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const fmtDateLong = (iso: string | null | undefined) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
};

const fmtDateShort = (iso: string | null | undefined) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

export default function PlanDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [stripeError, setStripeError] = useState<string | null>(null);
  // Inline manual-payment form (cash / check / Venmo intake against this
  // plan). Closed by default; toggle via the "Record payment" button.
  const [paymentFormOpen, setPaymentFormOpen] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  // Dunning banner state — surfaces the most recent failed charge from the
  // plan's charge_history. The banner offers two actions: "Send retry link"
  // (fires the payment_retry email + SMS) and "Mark as resolved" (operator
  // override that prepends a {status:'resolved'} entry to charge_history so
  // the banner clears).
  const [dunningStatus, setDunningStatus] = useState<
    | { kind: "idle" }
    | { kind: "sending" }
    | { kind: "sent" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const {
    data: plan,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["plan", id],
    queryFn: async () => {
      if (!id) throw new Error("Missing plan id");
      const { data, error } = await supabase
        .from("maintenance_plans")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return data as unknown as LawnPlan;
    },
    enabled: !!id,
  });

  const updatePlan = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      if (!id) throw new Error("Missing plan id");
      const { error } = await supabase
        .from("maintenance_plans")
        // Cast — new lawn fields aren't in generated types yet.
        .update(patch as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plan", id] });
      queryClient.invalidateQueries({ queryKey: ["plans"] });
    },
  });

  const deletePlan = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("Missing plan id");
      const { error } = await supabase
        .from("maintenance_plans")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      navigate("/plans");
    },
  });

  // Record an off-cycle manual payment against this plan. After insert we
  // append a synthetic { date, amount, status: 'manual:<method>' } entry to
  // the plan's charge_history JSONB so the existing "Recent charges" list
  // surfaces it without needing a separate UI. We deliberately do NOT touch
  // next_charge_date — moving the next-charge window is a separate decision
  // the operator makes via the Edit form.
  const recordPaymentMutation = useMutation({
    mutationFn: async (args: {
      method: ManualPaymentMethod;
      amountCents: number;
      checkNumber: string | null;
    }) => {
      if (!plan || !id) throw new Error("Missing plan");
      await recordPayment({
        plan_id: id,
        customer_id: plan.customer_id ?? null,
        method: args.method,
        amount_cents: args.amountCents,
        check_number: args.checkNumber,
      });
      // Append to charge_history. JSONB column — read current, prepend the
      // new entry, write back. We prepend so the "Recent charges" card
      // (which slices the first 5) shows the freshest first.
      const existing = Array.isArray(plan.charge_history)
        ? (plan.charge_history as unknown as ChargeEntry[])
        : [];
      const next = [
        {
          date: new Date().toISOString(),
          amount: args.amountCents / 100,
          status: `manual:${args.method}`,
        },
        ...existing,
      ];
      const { error } = await supabase
        .from("maintenance_plans")
        .update({ charge_history: next as unknown as Json })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setPaymentFormOpen(false);
      setPaymentError(null);
      queryClient.invalidateQueries({ queryKey: ["plan", id] });
      queryClient.invalidateQueries({ queryKey: ["plans"] });
    },
    onError: (e) => {
      setPaymentError(e instanceof Error ? e.message : "Couldn't save payment");
    },
  });

  // "Mark as resolved" override. The webhook will keep prepending failed
  // entries on subsequent retries — operator marks the CURRENT failure as
  // resolved by prepending a synthetic {status:'resolved'} entry. Because
  // the banner check inspects history[0], a single resolved entry hides
  // the alert until Stripe fires another invoice.payment_failed (which the
  // webhook will then prepend back on top, re-surfacing the banner).
  const markResolvedMutation = useMutation({
    mutationFn: async () => {
      if (!plan || !id) throw new Error("Missing plan");
      const existing = Array.isArray(plan.charge_history)
        ? (plan.charge_history as unknown as ChargeEntry[])
        : [];
      const next = [
        {
          date: new Date().toISOString(),
          status: "resolved",
        },
        ...existing,
      ];
      const { error } = await supabase
        .from("maintenance_plans")
        .update({ charge_history: next as unknown as Json })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plan", id] });
      queryClient.invalidateQueries({ queryKey: ["plans"] });
    },
  });

  const sendRetryLink = async () => {
    if (!id) return;
    setDunningStatus({ kind: "sending" });
    // Both email (Resend) and SMS (Twilio) auto-sends are now gated
    // behind their respective feature flags. The default path is
    // operator-driven send via <MessageCustomerButton kind="payment_retry">
    // rendered inside the DunningBanner — the operator's own phone +
    // mail app are the transports. When neither flag is on we no-op
    // and immediately resolve to "sent" so the inline banner clears.
    const transports: Promise<{ ok: boolean; error?: string }>[] = [];
    if (RESEND_ENABLED) {
      transports.push(sendPaymentRetryLink(id));
    }
    if (TWILIO_ENABLED) {
      transports.push(sendPaymentRetryLinkSms(id));
    }
    if (transports.length === 0) {
      // Nothing to auto-fire — operator handles via MessageCustomerButton.
      setDunningStatus({ kind: "sent" });
      return;
    }
    const results = await Promise.all(transports);
    const anyOk = results.some((r) => r.ok);
    if (anyOk) {
      setDunningStatus({ kind: "sent" });
      return;
    }
    const message =
      results.find((r) => r.error)?.error || "Couldn't reach customer";
    setDunningStatus({ kind: "error", message });
  };

  if (isLoading) {
    return (
      <div className="pt-3">
        <PageBackHeader title="Loading…" />
        <div className="mx-4 tp-card h-48 animate-pulse bg-neutral-100" />
      </div>
    );
  }

  if (error || !plan) {
    return (
      <div className="pt-3">
        <PageBackHeader title="Plan not found" />
        <div className="mx-4 tp-card p-6 text-center">
          <p className="text-sm text-neutral-700">
            {error instanceof Error ? error.message : "This plan no longer exists."}
          </p>
          <Link
            to="/plans"
            className="inline-block mt-3 text-[12.5px] font-semibold text-brand-800 hover:underline"
          >
            Back to all plans
          </Link>
        </div>
      </div>
    );
  }

  const status = plan.status as PlanStatus;
  const isCanceled = status === "canceled";

  const setStatus = (next: PlanStatus) => {
    if (next === "canceled" && !window.confirm("Cancel this plan? Crews will stop visiting.")) return;
    setStripeError(null);
    // Optimistic local update — snappy UI. We update DB *and* call Stripe
    // in parallel; if Stripe fails, the row will get corrected by the
    // payments-webhook on the next subscription.updated event.
    updatePlan.mutate({ status: next });
    const action: PlanAction | null =
      next === "paused" ? "pause" :
      next === "active" ? "resume" :
      next === "canceled" ? "cancel" : null;
    if (!action || !id) return;
    mutatePlanSubscription(id, action).catch((e) => {
      setStripeError(
        e instanceof Error
          ? `Couldn't sync with Stripe: ${e.message}`
          : "Couldn't sync with Stripe.",
      );
    });
  };

  const remove = () => {
    if (!window.confirm("Delete this plan and all its history? This cannot be undone.")) return;
    deletePlan.mutate();
  };

  // Surface the dunning banner ONLY when the most recent charge_history
  // entry is a failure. The webhook prepends fresh entries (newest-first),
  // so history[0] is the source of truth. Marking as resolved prepends a
  // 'resolved' entry which causes this check to flip false; if Stripe
  // retries and fails again the webhook will re-prepend a 'failed' entry
  // and the banner returns.
  const history = Array.isArray(plan.charge_history)
    ? (plan.charge_history as unknown as ChargeEntry[])
    : [];
  const latestCharge = history[0];
  const lastChargeFailed =
    !!latestCharge &&
    (latestCharge.status === "failed" ||
      latestCharge.status === "payment_failed");

  return (
    <div className="pt-3">
      <PageBackHeader
        eyebrow={`Plan · ${plan.id.slice(0, 6).toUpperCase()}`}
        title={plan.customer_name}
        subtitle={plan.address}
        right={<StatusPill status={status} />}
      />

      <div className="mx-4 space-y-3 pb-6">
        {/* Dunning banner — surfaces only when the most recent charge entry
            is a failure. Renders at the TOP of the content area so the
            operator sees it before the plan summary. */}
        {lastChargeFailed && id && (
          <DunningBanner
            planId={id}
            failedOnIso={latestCharge?.date}
            status={dunningStatus}
            isMarkingResolved={markResolvedMutation.isPending}
            onSendRetry={() => void sendRetryLink()}
            onMarkResolved={() => {
              if (
                !window.confirm(
                  `Mark this failure as resolved? Stripe will keep retrying — this just hides the alert in ${vertical.brand.name}.`,
                )
              ) {
                return;
              }
              setDunningStatus({ kind: "idle" });
              markResolvedMutation.mutate();
            }}
          />
        )}

        {/* Hero summary */}
        <div className="rounded-[18px] bg-gradient-hero-deep text-white p-[18px] relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] font-semibold tracking-[1px] uppercase text-accent-400">
                Next charge
              </div>
              <div className="font-bold text-lg mt-1">
                {fmtDateLong(plan.next_charge_date)}
              </div>
            </div>
          </div>
          <div className="tp-display tp-num text-[42px] font-bold leading-none mt-3">
            {fmtUSD(Number(plan.amount))}
          </div>
          <div className="flex items-center gap-2 mt-2 text-white/80 text-[12px] flex-wrap">
            <Repeat className="h-3.5 w-3.5" />
            Every {plan.interval_months}mo billing
            {plan.card_last4 && (
              <>
                <span>·</span>
                <CreditCard className="h-3.5 w-3.5" />
                ••••{plan.card_last4}
              </>
            )}
          </div>
        </div>

        {/* Schedule summary OR edit form */}
        {editing ? (
          <EditCard
            plan={plan}
            onSave={(patch) => {
              updatePlan.mutate(patch, {
                onSuccess: () => setEditing(false),
              });
            }}
            onCancel={() => setEditing(false)}
            isSaving={updatePlan.isPending}
          />
        ) : (
          <SummaryCard plan={plan} onEdit={() => setEditing(true)} />
        )}

        {/* Pause / Resume / Cancel */}
        <div className="grid grid-cols-3 gap-2">
          {status === "active" ? (
            <button
              type="button"
              onClick={() => setStatus("paused")}
              disabled={isCanceled || updatePlan.isPending}
              className="rounded-xl bg-neutral-100 text-neutral-800 font-semibold text-[12.5px] py-2.5 flex items-center justify-center gap-1.5 hover:bg-neutral-200 transition-colors disabled:opacity-50"
            >
              <Pause className="h-3.5 w-3.5" /> Pause
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStatus("active")}
              disabled={isCanceled || updatePlan.isPending}
              className="rounded-xl bg-brand-800 text-white font-semibold text-[12.5px] py-2.5 flex items-center justify-center gap-1.5 hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" /> Resume
            </button>
          )}
          <button
            type="button"
            onClick={() => setStatus("canceled")}
            disabled={isCanceled || updatePlan.isPending}
            className="rounded-xl bg-[hsl(var(--destructive-bg))] text-destructive font-semibold text-[12.5px] py-2.5 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <XCircle className="h-3.5 w-3.5" /> Cancel
          </button>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            disabled={updatePlan.isPending}
            className="rounded-xl bg-accent-500 text-white font-semibold text-[12.5px] py-2.5 flex items-center justify-center gap-1.5 shadow-accent hover:bg-accent-600 transition-colors disabled:opacity-50"
          >
            <Edit3 className="h-3.5 w-3.5" /> {editing ? "Close" : "Edit"}
          </button>
        </div>

        {stripeError && (
          <div className="rounded-xl bg-[hsl(var(--destructive-bg))] text-destructive text-[12.5px] font-semibold p-3">
            {stripeError}
          </div>
        )}

        {/* Record payment — manual cash/check intake against this plan.
            Sits beside Pause/Resume/Cancel as a peer action because the
            operator's mental model is "this plan got paid out-of-band, log
            it". Bronze-outline so it reads as a secondary CTA. */}
        <button
          type="button"
          onClick={() => {
            setPaymentError(null);
            setPaymentFormOpen((v) => !v);
          }}
          className={cn(
            "w-full rounded-xl border font-semibold text-[12.5px] py-2.5 flex items-center justify-center gap-1.5 transition-colors",
            paymentFormOpen
              ? "bg-accent-100 border-accent-400 text-accent-700"
              : "bg-card border-accent-400 text-accent-700 hover:bg-accent-50",
          )}
        >
          <DollarSign className="h-3.5 w-3.5" />
          {paymentFormOpen ? "Close" : "Record payment"}
        </button>

        {paymentFormOpen && (
          <PlanManualPaymentForm
            defaultAmount={Number(plan.amount ?? 0)}
            submitting={recordPaymentMutation.isPending}
            error={paymentError}
            onCancel={() => {
              setPaymentFormOpen(false);
              setPaymentError(null);
            }}
            onSubmit={(values) => recordPaymentMutation.mutate(values)}
          />
        )}

        {/* Charge history */}
        <ChargeHistoryCard chargeHistory={plan.charge_history} />

        {/* Delete */}
        <button
          type="button"
          onClick={remove}
          disabled={deletePlan.isPending}
          className="w-full flex items-center justify-center gap-2 text-destructive text-[13px] font-bold py-3 disabled:opacity-50"
        >
          {deletePlan.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Delete plan
        </button>
      </div>

      {/* Inline input styles — kept here to avoid creating a ui dir. */}
      <style>{`
        .tp-input {
          width: 100%;
          background: hsl(var(--card));
          border: 1px solid hsl(var(--neutral-200));
          border-radius: 12px;
          padding: 10px 12px;
          font-size: 14px;
          color: hsl(var(--neutral-900));
          font-family: inherit;
        }
        .tp-input:focus {
          outline: none;
          border-color: hsl(var(--brand-800));
          box-shadow: 0 0 0 3px hsl(var(--brand-100));
        }
      `}</style>
    </div>
  );
}

// ---------- subcomponents ----------

function PageBackHeader({
  title,
  eyebrow,
  subtitle,
  right,
}: {
  title: string;
  eyebrow?: string;
  subtitle?: string | null;
  right?: React.ReactNode;
}) {
  return (
    <header className="px-[22px] pb-[18px] flex items-start gap-3">
      <Link
        to="/plans"
        className="h-9 w-9 rounded-full border border-neutral-200 bg-card flex items-center justify-center mt-0.5"
        aria-label="Back to plans"
      >
        <ArrowLeft className="h-4 w-4 text-neutral-700" strokeWidth={2} />
      </Link>
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <div className="text-xs font-medium tracking-[0.4px] uppercase text-neutral-500">
            {eyebrow}
          </div>
        )}
        <h1 className="tp-display text-xl font-bold text-neutral-900 mt-0.5 truncate">
          {title}
        </h1>
        {subtitle && (
          <div className="text-[12px] text-neutral-500 mt-0.5 truncate">{subtitle}</div>
        )}
      </div>
      {right && <div className="mt-1 shrink-0">{right}</div>}
    </header>
  );
}

function SummaryCard({ plan, onEdit }: { plan: LawnPlan; onEdit: () => void }) {
  const dayLabel =
    plan.day_of_week != null && plan.day_of_week >= 0 && plan.day_of_week <= 6
      ? DAY_LABEL[plan.day_of_week]
      : "Not set";
  const freqLabel = vertical.planCadence.frequencyLabel(plan.frequency ?? "weekly");
  const services = plan.services ?? [];
  const seasonPause = plan.season_pause ?? [];

  return (
    <section className="tp-card p-4">
      <div className="flex items-start justify-between mb-3">
        <h2 className="text-[14px] font-semibold text-neutral-900">Schedule</h2>
        <button
          type="button"
          onClick={onEdit}
          className="text-[12px] font-semibold text-brand-800 hover:underline"
        >
          Edit
        </button>
      </div>
      <dl className="grid grid-cols-2 gap-y-3 gap-x-3">
        {vertical.planCadence.hasServiceFrequency && (
          <Stat label="Frequency" value={freqLabel} />
        )}
        {vertical.planCadence.hasRouteDay && (
          <Stat label="Route day" value={dayLabel} />
        )}
        <Stat label="Amount" value={fmtUSD(Number(plan.amount))} />
        <Stat label="Billing" value={`Every ${plan.interval_months}mo`} />
        <Stat label="Start date" value={fmtDateShort(plan.start_date)} />
        <Stat label="Next charge" value={fmtDateShort(plan.next_charge_date)} />
      </dl>

      {services.length > 0 && (
        <div className="mt-4 pt-3 border-t border-neutral-200">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-neutral-500 mb-1.5">
            Services
          </div>
          <div className="flex flex-wrap gap-1.5">
            {services.map((s) => (
              <span
                key={s}
                className="px-2.5 py-1 rounded-full bg-brand-50 text-brand-800 text-[11.5px] font-semibold"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {vertical.planCadence.hasSeasonPause && seasonPause.length > 0 && (
        <div className="mt-3 pt-3 border-t border-neutral-200">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-neutral-500 mb-1.5">
            Seasonal pauses
          </div>
          <div className="flex flex-wrap gap-1.5">
            {seasonPause.map((s) => (
              <span
                key={s}
                className="px-2.5 py-1 rounded-full bg-accent-100 text-accent-700 text-[11.5px] font-semibold capitalize"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-neutral-500">
        {label}
      </dt>
      <dd className="text-[13.5px] font-semibold text-neutral-900 mt-0.5">{value}</dd>
    </div>
  );
}

function EditCard({
  plan,
  onSave,
  onCancel,
  isSaving,
}: {
  plan: LawnPlan;
  onSave: (patch: Record<string, unknown>) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [amount, setAmount] = useState(String(plan.amount));
  const [frequency, setFrequency] = useState<string>(plan.frequency ?? "weekly");
  const [dayOfWeek, setDayOfWeek] = useState<number>(plan.day_of_week ?? 3);
  const [intervalMonths, setIntervalMonths] = useState<3 | 6 | 12>(
    (plan.interval_months as 3 | 6 | 12) ?? 3,
  );
  const [nextChargeDate, setNextChargeDate] = useState(
    plan.next_charge_date ?? "",
  );
  const [seasonPause, setSeasonPause] = useState<string[]>(plan.season_pause ?? []);

  const toggleSeason = (s: string) =>
    setSeasonPause((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );

  const submit = () => {
    const amountNum = Number(amount);
    if (!amountNum || amountNum <= 0) {
      window.alert("Enter a valid amount");
      return;
    }
    onSave({
      amount: amountNum,
      interval_months: intervalMonths,
      next_charge_date: nextChargeDate,
      day_of_week: dayOfWeek,
      frequency,
      season_pause: seasonPause,
      plan_kind: vertical.planCadence.hasServiceFrequency
        ? (frequency === "fert_program" && plan.plan_kind !== "other"
            ? "fert_program"
            : plan.plan_kind === "other"
              ? "other"
              : "mow")
        : vertical.planCadence.defaultPlanKind,
    });
  };

  return (
    <section className="tp-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-neutral-900">Edit plan</h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-[12px] font-semibold text-neutral-500 hover:text-neutral-700"
        >
          Cancel
        </button>
      </div>

      {vertical.planCadence.hasServiceFrequency && (
        <div>
          <FieldLabel>Frequency</FieldLabel>
          <div className="grid grid-cols-2 gap-1.5">
            {vertical.planCadence.frequencies.map((opt) => {
              const on = frequency === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setFrequency(opt.key)}
                  className={cn(
                    "py-2 rounded-xl text-[12.5px] font-semibold transition-colors border",
                    on
                      ? "border-brand-800 bg-brand-800 text-white"
                      : "border-neutral-200 bg-card text-neutral-700 hover:border-brand-700",
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {vertical.planCadence.hasRouteDay && (
        <div>
          <FieldLabel>Route day</FieldLabel>
          <div className="grid grid-cols-7 gap-1.5">
            {DAY_SHORT.map((label, i) => {
              const on = dayOfWeek === i;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setDayOfWeek(i)}
                  className={cn(
                    "py-2 rounded-[10px] text-[11.5px] font-semibold transition-colors",
                    on
                      ? "bg-brand-800 text-white"
                      : "bg-neutral-100 text-neutral-700 hover:bg-brand-50",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Amount</FieldLabel>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="tp-input"
            inputMode="decimal"
            min="0"
            step="0.01"
          />
        </div>
        <div>
          <FieldLabel>Billing cadence</FieldLabel>
          <div className="grid grid-cols-3 gap-1.5">
            {BILLING_OPTIONS.map((m) => {
              const on = intervalMonths === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setIntervalMonths(m)}
                  className={cn(
                    "py-2 rounded-xl text-[12px] font-semibold transition-colors border",
                    on
                      ? "border-brand-800 bg-brand-800 text-white"
                      : "border-neutral-200 bg-card text-neutral-700 hover:border-brand-700",
                  )}
                >
                  {m}mo
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div>
        <FieldLabel>Next charge</FieldLabel>
        <div className="relative">
          <Calendar
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400"
            strokeWidth={2}
          />
          <input
            type="date"
            value={nextChargeDate ? nextChargeDate.slice(0, 10) : ""}
            onChange={(e) => setNextChargeDate(e.target.value)}
            className="tp-input pl-9"
          />
        </div>
      </div>

      {vertical.planCadence.hasSeasonPause && (
        <div>
          <FieldLabel>Seasonal pauses</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {SEASONS.map((s) => {
              const on = seasonPause.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSeason(s)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors border capitalize",
                    on
                      ? "bg-accent-100 text-accent-700 border-transparent"
                      : "bg-card text-neutral-700 border-neutral-200 hover:border-brand-700",
                  )}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={isSaving}
        className="w-full rounded-full bg-accent-500 text-white font-bold text-[14px] py-3 shadow-accent hover:bg-accent-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {isSaving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Saving…
          </>
        ) : (
          <>
            <Save className="h-4 w-4" /> Save changes
          </>
        )}
      </button>
    </section>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-neutral-500 mb-1.5">
      {children}
    </div>
  );
}

function ChargeHistoryCard({ chargeHistory }: { chargeHistory: Json }) {
  // charge_history is a jsonb column — defensively parse into an array of
  // { date, amount, status }. Newest first, show at most 5.
  const recent = useMemo<ChargeEntry[]>(() => {
    if (!Array.isArray(chargeHistory)) return [];
    return (chargeHistory as unknown as ChargeEntry[])
      .filter((c) => c && typeof c === "object")
      .slice(0, 5);
  }, [chargeHistory]);

  return (
    <section className="tp-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <CreditCard className="h-4 w-4 text-brand-800" />
        <h2 className="text-[14px] font-semibold text-neutral-900">Recent charges</h2>
      </div>
      {recent.length === 0 ? (
        <p className="text-[12.5px] text-neutral-500">
          No charges recorded yet. Once billing fires, the last five will appear here.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200">
          {recent.map((c, i) => (
            <li
              key={i}
              className="py-2.5 flex items-center justify-between text-[13px]"
            >
              <span className="text-neutral-700">{fmtDateShort(c.date)}</span>
              <span className="tp-num font-semibold text-neutral-900">
                {typeof c.amount === "number" ? fmtUSD(c.amount) : "—"}
              </span>
              <span
                className={cn(
                  "px-2 py-[2px] rounded-full text-[10.5px] font-bold uppercase tracking-[0.4px]",
                  c.status === "paid"
                    ? "bg-brand-100 text-brand-800"
                    : c.status === "failed"
                      ? "bg-[hsl(var(--destructive-bg))] text-destructive"
                      : typeof c.status === "string" && c.status.startsWith("manual:")
                        ? "bg-accent-100 text-accent-700"
                        : "bg-neutral-100 text-neutral-700",
                )}
              >
                {typeof c.status === "string" && c.status.startsWith("manual:")
                  ? c.status.replace("manual:", "") + " (manual)"
                  : c.status ?? "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// =====================================================================
// DunningBanner — destructive-tinted alert that surfaces a failed charge.
//
// Renders two CTAs:
//   • "Send retry link" → fires payment_retry email + SMS in parallel via
//     sendPaymentRetryLink / sendPaymentRetryLinkSms. The customer lands
//     on /plans/portal/{token} which routes them into the Stripe Billing
//     Portal for the actual card update.
//   • "Mark as resolved" → operator override that prepends a synthetic
//     {status:'resolved'} entry to charge_history so the banner clears.
//     Important: this does NOT pause/cancel the Stripe subscription. If
//     Stripe retries and fails again, the webhook will prepend a fresh
//     'failed' entry on top of the resolved one and the banner returns.
//
// Why two actions instead of one auto-resolve:
//   Operators sometimes know out-of-band that the card was already
//   updated (customer texted them), and sometimes they want to escalate
//   directly to the customer. The action set covers both.
// =====================================================================
function DunningBanner({
  planId,
  failedOnIso,
  status,
  isMarkingResolved,
  onSendRetry,
  onMarkResolved,
}: {
  planId: string;
  failedOnIso: string | undefined;
  status:
    | { kind: "idle" }
    | { kind: "sending" }
    | { kind: "sent" }
    | { kind: "error"; message: string };
  isMarkingResolved: boolean;
  onSendRetry: () => void;
  onMarkResolved: () => void;
}) {
  const dateLabel = failedOnIso ? fmtDateLong(failedOnIso) : "recently";
  return (
    <section className="rounded-[18px] bg-[hsl(var(--destructive-bg))] border border-destructive/30 p-4">
      <div className="flex items-start gap-2.5">
        <AlertTriangle
          className="h-5 w-5 text-destructive shrink-0 mt-0.5"
          strokeWidth={2}
        />
        <div className="flex-1 min-w-0">
          <h2 className="text-[14px] font-bold text-destructive">
            Last charge failed on {dateLabel}
          </h2>
          <p className="text-[12.5px] text-destructive/85 mt-0.5">
            Stripe will keep retrying. You can send the customer a quick link
            to update their card, or mark this as resolved if you already
            handled it.
          </p>

          {status.kind === "sent" && (
            <div className="mt-2.5 flex items-center gap-1.5 text-[12px] font-semibold text-destructive">
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.2} />
              Retry link sent.
            </div>
          )}
          {status.kind === "error" && (
            <div className="mt-2.5 text-[12px] font-semibold text-destructive">
              {status.message}
            </div>
          )}

          <div
            className={cn(
              "grid gap-2 mt-3",
              RESEND_ENABLED ? "grid-cols-2" : "grid-cols-1",
            )}
          >
            {/* Auto-send button only renders when the Resend pipe is on.
                Otherwise the operator uses the <MessageCustomerButton>
                below to send via their own apps. */}
            {RESEND_ENABLED && (
              <button
                type="button"
                onClick={onSendRetry}
                disabled={status.kind === "sending"}
                className="rounded-xl bg-destructive text-white font-semibold text-[12.5px] py-2.5 flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {status.kind === "sending" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" strokeWidth={2.2} />
                )}
                {status.kind === "sending" ? "Sending…" : "Email retry link"}
              </button>
            )}
            <button
              type="button"
              onClick={onMarkResolved}
              disabled={isMarkingResolved}
              className="rounded-xl bg-card border border-destructive/40 text-destructive font-semibold text-[12.5px] py-2.5 flex items-center justify-center gap-1.5 hover:bg-destructive/5 transition-colors disabled:opacity-60"
            >
              {isMarkingResolved ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
              )}
              Mark as resolved
            </button>
          </div>

          {/* Operator-driven send — they send the portal link from their
              own Messages or Mail app instead of routing through
              Twilio/Resend. Surfaces text/email/copy actions based on
              which contact channels the customer has on file. */}
          {(!TWILIO_ENABLED || !RESEND_ENABLED) && (
            <div className="mt-3 flex flex-col gap-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.4px] text-destructive/80">
                Also message them
              </div>
              <MessageCustomerButton
                kind="payment_retry"
                planId={planId}
                variant="secondary"
                label="Message card-update link"
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: PlanStatus }) {
  const styles = {
    active: "bg-brand-100 text-brand-800",
    paused: "bg-neutral-100 text-neutral-700",
    canceled: "bg-[hsl(var(--destructive-bg))] text-destructive",
  } as const;
  return (
    <span
      className={cn(
        "px-2.5 py-1 rounded-full text-[10.5px] font-bold uppercase tracking-[0.4px]",
        styles[status],
      )}
    >
      {status}
    </span>
  );
}

// =====================================================================
// PlanManualPaymentForm — inline cash/check intake against the plan.
// Light-theme variant of the form (RouteMode has its own dark-theme one).
// =====================================================================
const PLAN_METHODS: ManualPaymentMethod[] = [
  "cash",
  "check",
  "venmo",
  "cashapp",
  "zelle",
  "other",
];

function PlanManualPaymentForm({
  defaultAmount,
  submitting,
  error,
  onCancel,
  onSubmit,
}: {
  defaultAmount: number;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (args: {
    method: ManualPaymentMethod;
    amountCents: number;
    checkNumber: string | null;
  }) => void;
}) {
  const [method, setMethod] = useState<ManualPaymentMethod>("cash");
  const [amount, setAmount] = useState<string>(
    defaultAmount > 0 ? String(defaultAmount) : "",
  );
  const [checkNumber, setCheckNumber] = useState<string>("");

  const submit = () => {
    const amountNum = Number(amount);
    if (!amountNum || amountNum <= 0) {
      window.alert("Enter a valid amount");
      return;
    }
    onSubmit({
      method,
      amountCents: Math.round(amountNum * 100),
      checkNumber: method === "check" ? (checkNumber.trim() || null) : null,
    });
  };

  return (
    <section className="tp-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-neutral-900">Record payment</h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-[12px] font-semibold text-neutral-500 hover:text-neutral-700"
        >
          Cancel
        </button>
      </div>

      <div>
        <FieldLabel>Method</FieldLabel>
        <div className="grid grid-cols-3 gap-1.5">
          {PLAN_METHODS.map((m) => {
            const on = method === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={cn(
                  "py-2 rounded-xl text-[12px] font-semibold transition-colors border",
                  on
                    ? "border-accent-500 bg-accent-500 text-white"
                    : "border-neutral-200 bg-card text-neutral-700 hover:border-accent-400",
                )}
              >
                {METHOD_LABEL[m]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Amount</FieldLabel>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="tp-input"
          />
        </div>
        {method === "check" && (
          <div>
            <FieldLabel>Check #</FieldLabel>
            <input
              type="text"
              value={checkNumber}
              onChange={(e) => setCheckNumber(e.target.value)}
              className="tp-input"
              placeholder="optional"
            />
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl bg-[hsl(var(--destructive-bg))] text-destructive text-[12.5px] font-semibold p-3">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="w-full rounded-full bg-accent-500 text-white font-bold text-[14px] py-3 shadow-accent hover:bg-accent-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Check className="h-4 w-4" />
        )}
        Save payment
      </button>
    </section>
  );
}
