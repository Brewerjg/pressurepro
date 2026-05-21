import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Calendar,
  CreditCard,
  Loader2,
  Pause,
  Play,
  Repeat,
  Trash2,
  XCircle,
  Edit3,
  Save,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";

// PlanDetail. Mirrors PressurePro's PlanDetail but reads lawn-care extras
// (day_of_week, frequency, season_pause, plan_kind) added in
// supabase/migrations/0001_turfpro_lawn_care.sql.
//
// NOTE on actions: Pause / Resume / Cancel just flip the row's status here.
// Stripe-side subscription pause / cancel is intentionally deferred — that
// coordination will live in an edge function once billing wiring lands, so
// this UI does NOT call Stripe. See TURFPRO_SPEC.md for the broader plan.

type LawnPlan = Database["public"]["Tables"]["maintenance_plans"]["Row"] & {
  day_of_week: number | null;
  frequency: "weekly" | "biweekly" | "monthly" | "fert_program";
  season_pause: string[] | null;
  plan_kind: "mow" | "fert_program" | "other";
};

type PlanStatus = "active" | "paused" | "canceled";
type Frequency = LawnPlan["frequency"];

type ChargeEntry = {
  date?: string;
  amount?: number;
  status?: string;
};

const DAY_LABEL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const FREQUENCY_LABEL: Record<Frequency, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  fert_program: "Fert program",
};

const FREQ_OPTIONS: Frequency[] = ["weekly", "biweekly", "monthly", "fert_program"];
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

  if (isLoading) {
    return (
      <div className="pt-3">
        <PageBackHeader title="Loading…" />
        <div className="mx-4 tp-card h-48 animate-pulse bg-ink-100" />
      </div>
    );
  }

  if (error || !plan) {
    return (
      <div className="pt-3">
        <PageBackHeader title="Plan not found" />
        <div className="mx-4 tp-card p-6 text-center">
          <p className="text-sm text-ink-700">
            {error instanceof Error ? error.message : "This plan no longer exists."}
          </p>
          <Link
            to="/plans"
            className="inline-block mt-3 text-[12.5px] font-semibold text-green-800 hover:underline"
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
    // Stripe pause/cancel is intentionally NOT called here — see file header.
    updatePlan.mutate({ status: next });
  };

  const remove = () => {
    if (!window.confirm("Delete this plan and all its history? This cannot be undone.")) return;
    deletePlan.mutate();
  };

  return (
    <div className="pt-3">
      <PageBackHeader
        eyebrow={`Plan · ${plan.id.slice(0, 6).toUpperCase()}`}
        title={plan.customer_name}
        subtitle={plan.address}
        right={<StatusPill status={status} />}
      />

      <div className="mx-4 space-y-3 pb-6">
        {/* Hero summary */}
        <div className="rounded-[18px] bg-gradient-hero-deep text-white p-[18px] relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] font-semibold tracking-[1px] uppercase text-bronze-400">
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
              className="rounded-xl bg-ink-100 text-ink-800 font-semibold text-[12.5px] py-2.5 flex items-center justify-center gap-1.5 hover:bg-ink-200 transition-colors disabled:opacity-50"
            >
              <Pause className="h-3.5 w-3.5" /> Pause
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStatus("active")}
              disabled={isCanceled || updatePlan.isPending}
              className="rounded-xl bg-green-800 text-white font-semibold text-[12.5px] py-2.5 flex items-center justify-center gap-1.5 hover:bg-green-700 transition-colors disabled:opacity-50"
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
            className="rounded-xl bg-bronze-500 text-white font-semibold text-[12.5px] py-2.5 flex items-center justify-center gap-1.5 shadow-bronze hover:bg-bronze-600 transition-colors disabled:opacity-50"
          >
            <Edit3 className="h-3.5 w-3.5" /> {editing ? "Close" : "Edit"}
          </button>
        </div>

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
          border: 1px solid hsl(var(--ink-200));
          border-radius: 12px;
          padding: 10px 12px;
          font-size: 14px;
          color: hsl(var(--ink-900));
          font-family: inherit;
        }
        .tp-input:focus {
          outline: none;
          border-color: hsl(var(--green-800));
          box-shadow: 0 0 0 3px hsl(var(--green-100));
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
        className="h-9 w-9 rounded-full border border-ink-200 bg-card flex items-center justify-center mt-0.5"
        aria-label="Back to plans"
      >
        <ArrowLeft className="h-4 w-4 text-ink-700" strokeWidth={2} />
      </Link>
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <div className="text-xs font-medium tracking-[0.4px] uppercase text-ink-500">
            {eyebrow}
          </div>
        )}
        <h1 className="tp-display text-xl font-bold text-ink-900 mt-0.5 truncate">
          {title}
        </h1>
        {subtitle && (
          <div className="text-[12px] text-ink-500 mt-0.5 truncate">{subtitle}</div>
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
  const freqLabel = FREQUENCY_LABEL[plan.frequency] ?? "Weekly";
  const services = plan.services ?? [];
  const seasonPause = plan.season_pause ?? [];

  return (
    <section className="tp-card p-4">
      <div className="flex items-start justify-between mb-3">
        <h2 className="text-[14px] font-semibold text-ink-900">Schedule</h2>
        <button
          type="button"
          onClick={onEdit}
          className="text-[12px] font-semibold text-green-800 hover:underline"
        >
          Edit
        </button>
      </div>
      <dl className="grid grid-cols-2 gap-y-3 gap-x-3">
        <Stat label="Frequency" value={freqLabel} />
        <Stat label="Route day" value={dayLabel} />
        <Stat label="Amount" value={fmtUSD(Number(plan.amount))} />
        <Stat label="Billing" value={`Every ${plan.interval_months}mo`} />
        <Stat label="Start date" value={fmtDateShort(plan.start_date)} />
        <Stat label="Next charge" value={fmtDateShort(plan.next_charge_date)} />
      </dl>

      {services.length > 0 && (
        <div className="mt-4 pt-3 border-t border-ink-200">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-ink-500 mb-1.5">
            Services
          </div>
          <div className="flex flex-wrap gap-1.5">
            {services.map((s) => (
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

      {seasonPause.length > 0 && (
        <div className="mt-3 pt-3 border-t border-ink-200">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-ink-500 mb-1.5">
            Seasonal pauses
          </div>
          <div className="flex flex-wrap gap-1.5">
            {seasonPause.map((s) => (
              <span
                key={s}
                className="px-2.5 py-1 rounded-full bg-bronze-100 text-bronze-700 text-[11.5px] font-semibold capitalize"
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
      <dt className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-ink-500">
        {label}
      </dt>
      <dd className="text-[13.5px] font-semibold text-ink-900 mt-0.5">{value}</dd>
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
  const [frequency, setFrequency] = useState<Frequency>(plan.frequency ?? "weekly");
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
      plan_kind:
        frequency === "fert_program" && plan.plan_kind !== "other"
          ? "fert_program"
          : plan.plan_kind === "other"
            ? "other"
            : "mow",
    });
  };

  return (
    <section className="tp-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-ink-900">Edit plan</h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-[12px] font-semibold text-ink-500 hover:text-ink-700"
        >
          Cancel
        </button>
      </div>

      <div>
        <FieldLabel>Frequency</FieldLabel>
        <div className="grid grid-cols-2 gap-1.5">
          {FREQ_OPTIONS.map((f) => {
            const on = frequency === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFrequency(f)}
                className={cn(
                  "py-2 rounded-xl text-[12.5px] font-semibold transition-colors border",
                  on
                    ? "border-green-800 bg-green-800 text-white"
                    : "border-ink-200 bg-card text-ink-700 hover:border-green-700",
                )}
              >
                {FREQUENCY_LABEL[f]}
              </button>
            );
          })}
        </div>
      </div>

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
                    ? "bg-green-800 text-white"
                    : "bg-ink-100 text-ink-700 hover:bg-green-50",
                )}
              >
                {label}
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
                      ? "border-green-800 bg-green-800 text-white"
                      : "border-ink-200 bg-card text-ink-700 hover:border-green-700",
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
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400"
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
                    ? "bg-bronze-100 text-bronze-700 border-transparent"
                    : "bg-card text-ink-700 border-ink-200 hover:border-green-700",
                )}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={isSaving}
        className="w-full rounded-full bg-bronze-500 text-white font-bold text-[14px] py-3 shadow-bronze hover:bg-bronze-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
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
    <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-ink-500 mb-1.5">
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
        <CreditCard className="h-4 w-4 text-green-800" />
        <h2 className="text-[14px] font-semibold text-ink-900">Recent charges</h2>
      </div>
      {recent.length === 0 ? (
        <p className="text-[12.5px] text-ink-500">
          No charges recorded yet. Once billing fires, the last five will appear here.
        </p>
      ) : (
        <ul className="divide-y divide-ink-200">
          {recent.map((c, i) => (
            <li
              key={i}
              className="py-2.5 flex items-center justify-between text-[13px]"
            >
              <span className="text-ink-700">{fmtDateShort(c.date)}</span>
              <span className="tp-num font-semibold text-ink-900">
                {typeof c.amount === "number" ? fmtUSD(c.amount) : "—"}
              </span>
              <span
                className={cn(
                  "px-2 py-[2px] rounded-full text-[10.5px] font-bold uppercase tracking-[0.4px]",
                  c.status === "paid"
                    ? "bg-green-100 text-green-800"
                    : c.status === "failed"
                      ? "bg-[hsl(var(--destructive-bg))] text-destructive"
                      : "bg-ink-100 text-ink-700",
                )}
              >
                {c.status ?? "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusPill({ status }: { status: PlanStatus }) {
  const styles = {
    active: "bg-green-100 text-green-800",
    paused: "bg-ink-100 text-ink-700",
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
