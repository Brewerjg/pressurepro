import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Calendar, Loader2, Repeat } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";
import { createPlanSubscription, type NewPlanInput } from "@/lib/plan-stripe";
import { APP_ID } from "@/lib/app-context";

// NewPlan creates a maintenance_plan with the lawn-care extensions
// (day_of_week, frequency, season_pause, plan_kind) defined in
// supabase/migrations/0001_turfpro_lawn_care.sql.
//
// Important UX decision: BILLING cadence (interval_months — 3/6/12) and
// SERVICE cadence (frequency — weekly/biweekly/monthly/fert_program) are
// independent dimensions. The DB enforces this; the UI mirrors it by giving
// each its own section with a small "what this means" caption so operators
// don't conflate the two (e.g. weekly mow service billed quarterly is
// completely valid).

type Customer = Database["public"]["Tables"]["customers"]["Row"];
type Property = Database["public"]["Tables"]["properties"]["Row"];
type CatalogItem = Database["public"]["Tables"]["catalog_items"]["Row"];

type Frequency = "weekly" | "biweekly" | "monthly" | "fert_program";
type BillingInterval = 1 | 3 | 6 | 12;
type Season = "winter" | "spring" | "summer" | "fall";
type PlanKind = "mow" | "fert_program" | "other";

const FREQ_OPTIONS: { key: Frequency; label: string; sub: string }[] = [
  { key: "weekly", label: "Weekly", sub: "Peak season mow" },
  { key: "biweekly", label: "Biweekly", sub: "Every 2 weeks" },
  { key: "monthly", label: "Monthly", sub: "Light touch" },
  { key: "fert_program", label: "Fert program", sub: "Scheduled apps" },
];

const BILLING_OPTIONS: { months: BillingInterval; label: string }[] = [
  { months: 1,  label: "Monthly" },
  { months: 3,  label: "Quarterly" },
  { months: 6,  label: "Every 6 mo" },
  { months: 12, label: "Yearly" },
];

// Visits per month per service frequency. Uses operator-simplified math
// (weekly=4, not the calendar-precise 4.33) since that's what operators
// actually quote — "I do 4 mows a month at $55." Fert program is
// approximated as 5 visits / 12 months across the year.
const VISITS_PER_MONTH: Record<Frequency, number> = {
  weekly: 4,
  biweekly: 2,
  monthly: 1,
  fert_program: 5 / 12,
};

// Round to 2 decimals — billing amounts shouldn't carry float drift.
function calcBillingAmount(
  perVisitRate: number,
  frequency: Frequency,
  intervalMonths: number,
): number {
  if (!perVisitRate || perVisitRate <= 0) return 0;
  const raw = perVisitRate * VISITS_PER_MONTH[frequency] * intervalMonths;
  return Math.round(raw * 100) / 100;
}

const DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const SEASONS: { key: Season; label: string; tone: string }[] = [
  { key: "winter", label: "Winter", tone: "bg-[hsl(212_60%_95%)] text-[hsl(212_60%_38%)]" },
  { key: "spring", label: "Spring", tone: "bg-green-50 text-green-800" },
  { key: "summer", label: "Summer", tone: "bg-[hsl(48_95%_92%)] text-[hsl(36_80%_30%)]" },
  { key: "fall",   label: "Fall",   tone: "bg-bronze-100 text-bronze-700" },
];

export default function NewPlan() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // ---- form state ----
  const [customerId, setCustomerId] = useState<string>("");
  const [propertyId, setPropertyId] = useState<string>("");
  const [services, setServices] = useState<string[]>([]);
  const [perVisitRate, setPerVisitRate] = useState<string>("");
  // Override of the auto-calculated billing total. Empty string = use the
  // calculated value. Non-empty = use this number instead (custom-priced plan).
  const [amountOverride, setAmountOverride] = useState<string>("");
  const [showOverride, setShowOverride] = useState<boolean>(false);
  const [frequency, setFrequency] = useState<Frequency>("weekly");
  const [dayOfWeek, setDayOfWeek] = useState<number>(3); // default Wednesday
  const [intervalMonths, setIntervalMonths] = useState<BillingInterval>(3);
  const [startDate, setStartDate] = useState<string>(
    () => new Date().toISOString().slice(0, 10),
  );
  const [seasonPause, setSeasonPause] = useState<Season[]>([]);
  const [planKind, setPlanKind] = useState<PlanKind>("mow");
  const [formError, setFormError] = useState<string | null>(null);

  // plan_kind auto-tracks frequency unless operator picked "other" explicitly.
  // We keep planKind in state so the (future) "Other" option can override.
  useEffect(() => {
    setPlanKind((current) => {
      if (current === "other") return "other";
      return frequency === "fert_program" ? "fert_program" : "mow";
    });
  }, [frequency]);

  // ---- data loads ----
  const { data: customers } = useQuery({
    queryKey: ["customers", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Customer[];
    },
    enabled: !!user,
  });

  const { data: properties } = useQuery({
    queryKey: ["properties", customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("*")
        .eq("customer_id", customerId)
        .order("address");
      if (error) throw error;
      return (data ?? []) as Property[];
    },
    enabled: !!customerId,
  });

  const { data: catalog } = useQuery({
    queryKey: ["catalog", "service", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_items")
        .select("*")
        .eq("app", APP_ID)
        .eq("kind", "service")
        .eq("archived", false)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as CatalogItem[];
    },
    enabled: !!user,
  });

  const selectedCustomer = useMemo(
    () => customers?.find((c) => c.id === customerId) ?? null,
    [customers, customerId],
  );
  const selectedProperty = useMemo(
    () => properties?.find((p) => p.id === propertyId) ?? null,
    [properties, propertyId],
  );

  // When customer changes, clear property selection.
  useEffect(() => {
    setPropertyId("");
  }, [customerId]);

  const toggleService = (name: string) =>
    setServices((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name],
    );

  const toggleSeason = (s: Season) =>
    setSeasonPause((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );

  // ---- submit ----
  // Defers the plan-row INSERT to the `create-plan-subscription` edge
  // function so the row, the Stripe Customer / Subscription, and (if
  // needed) a hosted Checkout session are all minted together. The fn
  // returns either:
  //   { kind: 'checkout', checkoutUrl } → we redirect (Stripe will collect
  //     a card and bounce back to /checkout/return?kind=plan&plan_id=...)
  //   { kind: 'existing', planId }      → card on file; jump to the plan
  const createPlan = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      if (!selectedCustomer) throw new Error("Pick a customer");
      if (!selectedProperty) throw new Error("Pick a property");
      if (services.length === 0) throw new Error("Pick at least one service");
      const perVisitNum = Number(perVisitRate);
      if (!perVisitNum || perVisitNum <= 0) {
        throw new Error("Enter a per-visit rate greater than $0");
      }
      // Auto-derive billing amount from per-visit rate × frequency × interval.
      // Override wins if the operator opened the override field with a value.
      const calculatedAmount = calcBillingAmount(perVisitNum, frequency, intervalMonths);
      const overrideNum = showOverride ? Number(amountOverride) : NaN;
      const amountNum = Number.isFinite(overrideNum) && overrideNum > 0
        ? overrideNum
        : calculatedAmount;
      if (!amountNum || amountNum <= 0) {
        throw new Error("Couldn't compute a billing amount — check your inputs");
      }
      if (!startDate) throw new Error("Pick a start date");

      const input: NewPlanInput = {
        user_id: user.id,
        customer_id: selectedCustomer.id,
        property_id: selectedProperty.id,
        customer_name: selectedCustomer.name,
        phone: selectedCustomer.phone ?? "",
        address: selectedProperty.address,
        services,
        amount: amountNum,
        // New column added in migration 0021. Stored so PlanDetail's edit
        // form can show the operator's mental-model number without having
        // to reverse-engineer from amount + frequency.
        per_visit_rate: perVisitNum,
        interval_months: intervalMonths,
        start_date: startDate,
        next_charge_date: startDate,
        status: "active",
        day_of_week: dayOfWeek,
        frequency,
        season_pause: seasonPause,
        plan_kind: planKind,
      };

      return await createPlanSubscription(input);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      if (result.kind === "checkout") {
        // Hand off to Stripe — the homeowner has no card yet. CheckoutReturn
        // picks the user back up at /checkout/return?kind=plan&plan_id=...
        window.location.assign(result.checkoutUrl);
        return;
      }
      navigate(`/plans/${result.planId}`);
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "Couldn't save plan");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    createPlan.mutate();
  };

  // Derived billing math for the live preview cards.
  const perVisitNum = Number(perVisitRate) || 0;
  const calculatedAmount = calcBillingAmount(perVisitNum, frequency, intervalMonths);
  const overrideNum = showOverride ? Number(amountOverride) || 0 : 0;
  const effectiveAmount = overrideNum > 0 ? overrideNum : calculatedAmount;

  // Human-readable label for the per-visit rate input. "application" for
  // fert programs reads more naturally than "visit".
  const perVisitLabel = frequency === "fert_program" ? "Per-application rate" : "Per-visit rate";
  // Operator-shorthand visit count surfaced in the math caption.
  const visitsPerMonthLabel: Record<Frequency, string> = {
    weekly: "4 visits/mo",
    biweekly: "2 visits/mo",
    monthly: "1 visit/mo",
    fert_program: "5 apps/yr",
  };

  return (
    <div className="pt-3">
      {/* Header */}
      <header className="px-[22px] pb-[18px] flex items-center gap-3">
        <Link
          to="/plans"
          className="h-9 w-9 rounded-full border border-ink-200 bg-card flex items-center justify-center"
          aria-label="Back to plans"
        >
          <ArrowLeft className="h-4 w-4 text-ink-700" strokeWidth={2} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium tracking-[0.4px] uppercase text-ink-500">
            Recurring service
          </div>
          <h1 className="tp-display text-2xl font-bold text-ink-900 mt-0.5">
            New plan
          </h1>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="px-4 space-y-3 pb-6">
        {/* Customer + property */}
        <Section title="Customer" subtitle="Who is this plan for?">
          <Field label="Customer">
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="tp-input"
              required
            >
              <option value="">Select a customer…</option>
              {customers?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <div className="mt-1.5">
              <Link
                to="/customers"
                className="text-[11px] font-semibold text-green-800 hover:underline"
              >
                + Add a customer
              </Link>
            </div>
          </Field>

          <Field label="Property">
            <select
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              className="tp-input"
              disabled={!customerId}
              required
            >
              <option value="">
                {customerId ? "Select a property…" : "Pick a customer first"}
              </option>
              {properties?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.address}
                </option>
              ))}
            </select>
          </Field>
        </Section>

        {/* Services */}
        <Section
          title="Services"
          subtitle="Pick everything included in this recurring visit"
        >
          {catalog && catalog.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {catalog.map((item) => {
                const on = services.includes(item.name);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleService(item.name)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-colors",
                      on
                        ? "bg-green-800 text-white border-green-800"
                        : "bg-card text-ink-700 border-ink-200 hover:border-green-700",
                    )}
                  >
                    {item.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-[12px] text-ink-500">
              No services in your catalog yet. Add some under Settings, or just
              type one below.
            </p>
          )}
          {/* Free-text fallback — useful when the catalog is empty or the
              operator wants a one-off service that isn't worth cataloging. */}
          <Field label="Add custom service">
            <CustomServiceInput onAdd={(name) => {
              if (!services.includes(name)) setServices([...services, name]);
            }} />
          </Field>
          {services.length > 0 && (
            <div className="text-[11px] text-ink-500">
              Selected: {services.join(", ")}
            </div>
          )}
        </Section>

        {/* Service cadence */}
        <Section
          title="Service frequency"
          subtitle="How often crews show up. Independent from billing cadence."
        >
          <div className="grid grid-cols-2 gap-2">
            {FREQ_OPTIONS.map((opt) => {
              const on = frequency === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setFrequency(opt.key)}
                  className={cn(
                    "text-left rounded-xl border p-3 transition-colors",
                    on
                      ? "border-green-800 bg-green-50"
                      : "border-ink-200 bg-card hover:border-green-700",
                  )}
                >
                  <div className="text-[13px] font-semibold text-ink-900">
                    {opt.label}
                  </div>
                  <div className="text-[11px] text-ink-500 mt-0.5">{opt.sub}</div>
                </button>
              );
            })}
          </div>
        </Section>

        {/* Day-of-week picker */}
        <Section
          title="Route day"
          subtitle="Which weekday this property normally falls on"
        >
          <div className="grid grid-cols-7 gap-1.5">
            {DAY_LABEL.map((label, i) => {
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
        </Section>

        {/* Pricing + billing */}
        <Section
          title="Pricing & billing"
          subtitle="The card is charged on the billing cadence below — service still runs on the frequency above."
        >
          <Field label={perVisitLabel}>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 text-sm">
                $
              </span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={perVisitRate}
                onChange={(e) => setPerVisitRate(e.target.value)}
                placeholder="0.00"
                className="tp-input pl-7"
                required
              />
            </div>
          </Field>

          {/* Auto-calculated billing total — shows the math so operators
              don't have to compute it in their head. The override toggle
              opens a manual amount input for discounted / custom plans. */}
          {perVisitNum > 0 && (
            <div className="rounded-[14px] bg-green-50 border border-green-100 p-3.5 text-[12.5px] text-ink-700">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.5px] text-green-700 mb-0.5">
                    Billing total
                  </div>
                  <div className="tp-num font-bold text-[18px] text-green-900">
                    ${effectiveAmount.toFixed(2)} every {intervalMonths}mo
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (showOverride) {
                      setAmountOverride("");
                      setShowOverride(false);
                    } else {
                      setAmountOverride(calculatedAmount.toFixed(2));
                      setShowOverride(true);
                    }
                  }}
                  className="text-[11.5px] font-semibold text-bronze-600 hover:text-bronze-700 underline-offset-2 hover:underline"
                >
                  {showOverride ? "Use auto" : "Override"}
                </button>
              </div>
              <div className="text-[11.5px] text-ink-600 mt-1.5 tp-num">
                ${perVisitNum.toFixed(2)} × {visitsPerMonthLabel[frequency]} × {intervalMonths}{intervalMonths === 1 ? "mo" : "mo"} = ${calculatedAmount.toFixed(2)}
              </div>
              {showOverride && (
                <div className="mt-2 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 text-sm">$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={amountOverride}
                    onChange={(e) => setAmountOverride(e.target.value)}
                    placeholder="Custom amount"
                    className="tp-input pl-7"
                  />
                </div>
              )}
            </div>
          )}

          <Field label="Billing cadence">
            <div className="grid grid-cols-4 gap-2">
              {BILLING_OPTIONS.map((b) => {
                const on = intervalMonths === b.months;
                return (
                  <button
                    key={b.months}
                    type="button"
                    onClick={() => setIntervalMonths(b.months)}
                    className={cn(
                      "py-2 rounded-xl border text-[12.5px] font-semibold transition-colors",
                      on
                        ? "border-green-800 bg-green-800 text-white"
                        : "border-ink-200 bg-card text-ink-700 hover:border-green-700",
                    )}
                  >
                    {b.label}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="First charge / start date">
            <div className="relative">
              <Calendar
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400"
                strokeWidth={2}
              />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="tp-input pl-9"
                required
              />
            </div>
          </Field>
        </Section>

        {/* Season pause */}
        <Section
          title="Seasonal pauses"
          subtitle="Skip service automatically during these seasons (optional)."
        >
          <div className="flex flex-wrap gap-1.5">
            {SEASONS.map((s) => {
              const on = seasonPause.includes(s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => toggleSeason(s.key)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors border",
                    on
                      ? `${s.tone} border-transparent`
                      : "bg-card text-ink-700 border-ink-200 hover:border-green-700",
                  )}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </Section>

        {/* Summary card */}
        <div className="rounded-[18px] bg-gradient-hero-deep text-white p-[18px] relative overflow-hidden">
          <div className="text-[10px] font-semibold tracking-[1px] uppercase text-bronze-400">
            Plan preview
          </div>
          <div className="flex items-baseline gap-2 mt-1.5">
            <div className="tp-display tp-num text-[34px] font-bold leading-none">
              {effectiveAmount > 0 ? `$${effectiveAmount.toFixed(0)}` : "$—"}
            </div>
            <div className="text-bronze-400 font-semibold text-sm">
              every {intervalMonths}{intervalMonths === 1 ? "mo" : "mo"}
            </div>
          </div>
          <div className="flex items-center gap-2 text-white/80 text-[12px] mt-2">
            <Repeat className="h-3.5 w-3.5" />
            {DAY_LABEL[dayOfWeek]} · {FREQ_OPTIONS.find((f) => f.key === frequency)?.label}
            {seasonPause.length > 0 && (
              <span className="text-bronze-400">
                · pauses {seasonPause.join(", ")}
              </span>
            )}
          </div>
        </div>

        {formError && (
          <div className="rounded-xl bg-[hsl(var(--destructive-bg))] text-destructive text-[12.5px] font-semibold p-3">
            {formError}
          </div>
        )}

        {/* Actions */}
        <div className="grid grid-cols-[1fr_2fr] gap-2 pt-1">
          <Link
            to="/plans"
            className="rounded-full border border-ink-200 bg-card text-ink-700 font-semibold text-[14px] py-3 text-center hover:bg-ink-100 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={createPlan.isPending}
            className="rounded-full bg-bronze-500 text-white font-bold text-[14px] py-3 shadow-bronze hover:bg-bronze-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {createPlan.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              "Activate plan"
            )}
          </button>
        </div>
      </form>

      {/* Inline input styling — kept here so we don't create a new ui file. */}
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
        .tp-input:disabled {
          background: hsl(var(--ink-100));
          color: hsl(var(--ink-500));
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="tp-card p-4 space-y-3">
      <div>
        <h2 className="text-[14px] font-semibold text-ink-900">{title}</h2>
        {subtitle && (
          <p className="text-[11.5px] text-ink-500 mt-0.5 leading-snug">
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[10.5px] font-bold uppercase tracking-[0.4px] text-ink-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function CustomServiceInput({ onAdd }: { onAdd: (name: string) => void }) {
  const [value, setValue] = useState("");
  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue("");
  };
  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="e.g. Edge & blow"
        className="tp-input flex-1"
      />
      <button
        type="button"
        onClick={submit}
        className="px-3 rounded-xl bg-ink-100 text-ink-700 text-[12.5px] font-semibold hover:bg-green-50 transition-colors"
      >
        Add
      </button>
    </div>
  );
}
