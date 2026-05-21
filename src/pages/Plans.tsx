import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Repeat, ChevronRight, Calendar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";

// Plans is TurfPro's PRIMARY work surface — recurring is the lawn-care default.
// We retain PressurePro's maintenance_plans table verbatim and additively read
// the lawn-specific columns (day_of_week, frequency, season_pause, plan_kind)
// that ship in supabase/migrations/0001_turfpro_lawn_care.sql. Those new
// columns are not in the generated types.ts yet, so we extend the Row locally
// and cast at the boundary.

type LawnPlan = Database["public"]["Tables"]["maintenance_plans"]["Row"] & {
  day_of_week: number | null;
  frequency: "weekly" | "biweekly" | "monthly" | "fert_program";
  season_pause: string[] | null;
  plan_kind: "mow" | "fert_program" | "other";
};

type StatusFilter = "active" | "paused" | "canceled" | "all";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const FREQUENCY_LABEL: Record<LawnPlan["frequency"], string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  fert_program: "Fert program",
};

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "paused", label: "Paused" },
  { key: "canceled", label: "Canceled" },
  { key: "all", label: "All" },
];

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const fmtDateShort = (iso: string) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

// Convert per-visit / per-month amount into monthly recurring revenue.
// Billing cadence (interval_months) is independent from service frequency, so
// MRR is driven by interval_months — the cadence at which the customer is
// actually charged.
const monthlyRevenue = (plan: LawnPlan) => {
  if (!plan.amount || !plan.interval_months) return 0;
  return plan.amount / plan.interval_months;
};

export default function Plans() {
  const [filter, setFilter] = useState<StatusFilter>("active");

  const { data: plans, isLoading, error } = useQuery({
    queryKey: ["plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_plans")
        .select("*")
        .order("next_charge_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as LawnPlan[];
    },
  });

  const activePlans = useMemo(
    () => (plans ?? []).filter((p) => p.status === "active"),
    [plans],
  );
  const mrr = useMemo(
    () => activePlans.reduce((sum, p) => sum + monthlyRevenue(p), 0),
    [activePlans],
  );

  const filtered = useMemo(() => {
    if (!plans) return [];
    if (filter === "all") return plans;
    return plans.filter((p) => p.status === filter);
  }, [plans, filter]);

  return (
    <div className="pt-3">
      {/* Header — matches Home.tsx spacing (px-[22px]) */}
      <header className="px-[22px] pb-[18px] flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium tracking-[0.4px] uppercase text-ink-500">
            Recurring revenue
          </div>
          <h1 className="tp-display text-2xl font-bold text-ink-900 mt-0.5">Plans</h1>
          <div className="text-[12px] text-ink-500 mt-1 tp-num">
            {isLoading
              ? "Loading…"
              : `${activePlans.length} active · ${fmtUSD(mrr)} MRR`}
          </div>
        </div>
        <Link
          to="/plans/new"
          className="h-10 px-3.5 rounded-full bg-bronze-500 text-white flex items-center gap-1.5 font-semibold text-[13px] shadow-bronze hover:bg-bronze-600 transition-colors"
        >
          <Plus className="h-4 w-4" strokeWidth={2.4} />
          New plan
        </Link>
      </header>

      {/* Status filter — segmented control */}
      <section className="mx-4 mb-3">
        <div className="tp-card p-1 flex gap-1">
          {STATUS_TABS.map((tab) => {
            const isActive = filter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                className={cn(
                  "flex-1 py-2 rounded-[12px] text-[12px] font-semibold transition-colors",
                  isActive
                    ? "bg-green-800 text-white"
                    : "text-ink-700 hover:bg-ink-100",
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* List */}
      <section className="mx-4 mb-3">
        {error ? (
          <div className="tp-card p-6 text-center">
            <p className="text-sm text-destructive">Couldn't load plans.</p>
            <p className="text-xs text-ink-500 mt-1">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </div>
        ) : isLoading ? (
          <ul className="flex flex-col gap-2.5">
            {[0, 1, 2].map((i) => (
              <li
                key={i}
                className="tp-card p-3.5 h-[88px] animate-pulse bg-ink-100"
              />
            ))}
          </ul>
        ) : filtered.length === 0 ? (
          <div className="tp-card p-6 text-center">
            <Repeat className="h-7 w-7 mx-auto text-ink-400" strokeWidth={1.7} />
            <p className="text-sm font-semibold text-ink-900 mt-2">
              No plans yet.
            </p>
            <p className="text-xs text-ink-500 mt-1 max-w-[260px] mx-auto">
              Recurring is the default for lawn care — add your first plan to get
              started.
            </p>
            <Link
              to="/plans/new"
              className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-full bg-bronze-500 text-white text-[13px] font-semibold shadow-bronze hover:bg-bronze-600 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
              New plan
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {filtered.map((plan) => (
              <PlanRow key={plan.id} plan={plan} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PlanRow({ plan }: { plan: LawnPlan }) {
  const isActive = plan.status === "active";
  const isPaused = plan.status === "paused";
  const isCanceled = plan.status === "canceled";

  const dayLabel =
    plan.day_of_week != null && plan.day_of_week >= 0 && plan.day_of_week <= 6
      ? DAY_SHORT[plan.day_of_week]
      : null;
  const freqLabel = FREQUENCY_LABEL[plan.frequency] ?? "Weekly";

  const services = plan.services ?? [];
  const visibleServices = services.slice(0, 3);
  const extraServiceCount = services.length - visibleServices.length;

  return (
    <li>
      <Link
        to={`/plans/${plan.id}`}
        className="tp-card block p-3.5 active:scale-[0.99] transition-transform"
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "h-[38px] w-[38px] rounded-[10px] flex items-center justify-center shrink-0",
              isActive
                ? "bg-green-800 text-bronze-400"
                : "bg-ink-100 text-ink-500",
            )}
          >
            <Repeat className="h-[18px] w-[18px]" strokeWidth={2} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-semibold text-[14px] text-ink-900 truncate">
                {plan.customer_name}
              </div>
              <div className="tp-num font-bold text-[14px] text-ink-900 shrink-0">
                {fmtUSD(Number(plan.amount))}
              </div>
            </div>

            {plan.address && (
              <div className="text-[11.5px] text-ink-500 truncate mt-0.5">
                {plan.address}
              </div>
            )}

            {/* Day + frequency badge */}
            <div className="flex items-center flex-wrap gap-1.5 mt-2">
              <span className="inline-flex items-center gap-1 px-2 py-[3px] rounded-full bg-green-50 text-green-800 text-[10.5px] font-semibold">
                <Calendar className="h-3 w-3" strokeWidth={2.2} />
                {dayLabel ? `${dayLabel} · ${freqLabel}` : freqLabel}
              </span>
              <span className="text-[10.5px] text-ink-500 tp-num">
                every {plan.interval_months}mo billing
              </span>
            </div>

            {/* Service chips */}
            {visibleServices.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {visibleServices.map((s) => (
                  <span
                    key={s}
                    className="px-2 py-[2px] rounded-full bg-ink-100 text-ink-700 text-[10.5px] font-medium"
                  >
                    {s}
                  </span>
                ))}
                {extraServiceCount > 0 && (
                  <span className="px-2 py-[2px] rounded-full bg-ink-100 text-ink-500 text-[10.5px] font-medium">
                    +{extraServiceCount}
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center justify-between mt-2">
              <div className="text-[11px] text-ink-500">
                Next charge {fmtDateShort(plan.next_charge_date)}
              </div>
              <StatusPill
                status={isCanceled ? "canceled" : isPaused ? "paused" : "active"}
              />
            </div>
          </div>

          <ChevronRight
            className="h-4 w-4 text-ink-400 self-center shrink-0"
            strokeWidth={2.2}
          />
        </div>
      </Link>
    </li>
  );
}

function StatusPill({ status }: { status: "active" | "paused" | "canceled" }) {
  const styles = {
    active: "bg-green-100 text-green-800",
    paused: "bg-ink-100 text-ink-700",
    canceled: "bg-[hsl(var(--destructive-bg))] text-destructive",
  } as const;
  return (
    <span
      className={cn(
        "px-2 py-[2px] rounded-full text-[10.5px] font-bold uppercase tracking-[0.4px]",
        styles[status],
      )}
    >
      {status}
    </span>
  );
}
