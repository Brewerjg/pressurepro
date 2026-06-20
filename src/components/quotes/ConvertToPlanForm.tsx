import { useEffect, useMemo, useRef, useState } from "react";
import { Ban, Check, Loader2, Plus, Repeat, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { suggestFrequency, type PlanLineItem } from "@/components/quotes/convertHelpers";

// =====================================================================
// ConvertToPlanForm — rebuilt from scratch around the operator's actual
// mental model:
//
//   "Marisol's quote has $55 weekly mow, $10 edge, and a $175 spring
//    cleanup. The mow + edge keep recurring; cleanup was one-and-done.
//    Bill her every quarter."
//
// Three decisions, one screen:
//   1. Which quote items recur (checkboxes; seeded by lawn-care
//      heuristics — see convertHelpers.ts)
//   2. How often the service happens (cadence)
//   3. How often we charge the card (billing interval — independent of #2)
//
// The previous iteration had a parallel per-visit-rate input + a separate
// services chip list that the operator had to keep mentally in sync, and
// looked too similar to the read-only "Line items" panel above it. This
// version unifies everything into one checkbox list and auto-sums.
// =====================================================================

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);

const DAY_LABEL = ["S", "M", "T", "W", "T", "F", "S"] as const;
const DAY_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const FREQ_OPTIONS = [
  { key: "weekly" as const, label: "Weekly" },
  { key: "biweekly" as const, label: "Biweekly" },
  { key: "monthly" as const, label: "Monthly" },
  { key: "fert_program" as const, label: "Fert" },
];

const BILLING_OPTIONS = [
  { months: 1 as const, label: "Monthly" },
  { months: 3 as const, label: "Quarterly" },
  { months: 6 as const, label: "Every 6mo" },
  { months: 12 as const, label: "Yearly" },
];

// Visits per month per service frequency. Fert program is 5 visits/year
// (early/late spring, summer, early/late fall) — store as a fraction here
// so the billing-preview math works for any interval length; the preview
// renders the "5 visits/yr" copy separately.
const VISITS_PER_MONTH: Record<
  "weekly" | "biweekly" | "monthly" | "fert_program",
  number
> = {
  weekly: 4,
  biweekly: 2,
  monthly: 1,
  fert_program: 5 / 12,
};

const PERIOD_NAME: Record<1 | 3 | 6 | 12, string> = {
  1: "month",
  3: "quarter",
  6: "half-year",
  12: "year",
};

interface CatalogEntry {
  id: string;
  name: string;
  default_rate: number | null;
}

interface ConvertToPlanFormProps {
  submitting: boolean;
  error: string | null;
  initialLineItems: PlanLineItem[];
  catalog: CatalogEntry[];
  onCancel: () => void;
  onSubmit: (values: {
    services: string[];
    per_visit_rate: number;
    frequency: "weekly" | "biweekly" | "monthly" | "fert_program";
    day_of_week: number;
    interval_months: 1 | 3 | 6 | 12;
    start_date: string;
    send_card_link: boolean;
  }) => void;
}

export default function ConvertToPlanForm({
  submitting,
  error,
  initialLineItems,
  catalog,
  onCancel,
  onSubmit,
}: ConvertToPlanFormProps) {
  // The single unified item list. Quote-line items + anything the operator
  // adds via catalog or custom — all rendered the same way, all toggled the
  // same way. Source flag drives the "✕ remove" affordance (quote lines
  // stay; you uncheck instead).
  const [items, setItems] = useState<PlanLineItem[]>(initialLineItems);

  // Cadence + day + billing + start date + the optional post-create
  // "save card" SMS/email.
  const [frequency, setFrequency] = useState<
    "weekly" | "biweekly" | "monthly" | "fert_program"
  >(() => suggestFrequency(initialLineItems));
  const [dayOfWeek, setDayOfWeek] = useState<number>(3); // Wednesday
  const [intervalMonths, setIntervalMonths] = useState<1 | 3 | 6 | 12>(3);
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [sendCardLink, setSendCardLink] = useState<boolean>(false);

  // Per-visit rate override. null = use the auto-sum; a number = the
  // operator deliberately typed in a flat rate. Kept as a number (not a
  // string) so the disabled-state math is unambiguous.
  const [rateOverride, setRateOverride] = useState<number | null>(null);
  const [overrideOpen, setOverrideOpen] = useState<boolean>(false);
  const [overrideDraft, setOverrideDraft] = useState<string>("");

  // Inline add-from-catalog + add-custom drawer state.
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customRate, setCustomRate] = useState("");

  // Touched flags — once the operator has explicitly picked a frequency
  // or day, stop auto-suggesting based on the items list. Otherwise the
  // act of checking/unchecking a "fert" line item would silently
  // overwrite their manual choice.
  const frequencyTouched = useRef(false);
  const dayTouched = useRef(false);

  // Auto-suggest frequency whenever the checked-items shape changes, but
  // only if the operator hasn't manually overridden it. Day of week is the
  // same pattern — stays at Wednesday until the operator chooses, then
  // we stop touching it.
  useEffect(() => {
    if (frequencyTouched.current) return;
    const suggested = suggestFrequency(items);
    setFrequency((prev) => (prev === suggested ? prev : suggested));
  }, [items]);

  // Derive the auto-summed per-visit total from checked items. Memoized so
  // the billing-preview card doesn't recompute on every render.
  const autoSum = useMemo(
    () =>
      Math.round(
        items.filter((i) => i.isRecurring).reduce((s, i) => s + i.rate, 0) *
          100,
      ) / 100,
    [items],
  );
  const effectiveRate = rateOverride ?? autoSum;
  const checkedCount = items.filter((i) => i.isRecurring).length;

  // Billing-preview math. Visits/month × months in the billing interval ×
  // per-visit rate. For fert_program the visits-per-month is a fraction;
  // we render the human copy as "5 visits/yr" rather than "0.42 visits/mo".
  const billingPreview = useMemo(() => {
    const visitsPerMonth = VISITS_PER_MONTH[frequency];
    const visitsLabel =
      frequency === "fert_program"
        ? "5 visits/yr"
        : `${visitsPerMonth} visit${visitsPerMonth === 1 ? "" : "s"}/mo`;
    const total =
      Math.round(effectiveRate * visitsPerMonth * intervalMonths * 100) / 100;
    return {
      visitsLabel,
      total,
      periodName: PERIOD_NAME[intervalMonths],
    };
  }, [effectiveRate, frequency, intervalMonths]);

  // First-charge date in the same friendly format as the preview spec
  // ("June 13"). startDate is YYYY-MM-DD so we read it as a local date.
  const firstChargeLabel = useMemo(() => {
    if (!startDate) return "—";
    const [y, m, d] = startDate.split("-").map(Number);
    if (!y || !m || !d) return startDate;
    return new Date(y, m - 1, d).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
    });
  }, [startDate]);

  // ── Item-list mutators ─────────────────────────────────────────────
  const toggleItem = (id: string) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, isRecurring: !i.isRecurring } : i)),
    );
  };
  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const addFromCatalog = (entry: CatalogEntry) => {
    setItems((prev) => [
      ...prev,
      {
        id: `cat-${entry.id}-${Date.now()}`,
        name: entry.name,
        rate: Number(entry.default_rate) || 0,
        isRecurring: true,
        source: "catalog",
      },
    ]);
    setCatalogQuery("");
    setCatalogOpen(false);
  };

  const addCustom = () => {
    const name = customName.trim();
    const rate = Number(customRate);
    if (!name || !(rate > 0)) return;
    setItems((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}`,
        name,
        rate: Math.round(rate * 100) / 100,
        isRecurring: true,
        source: "custom",
      },
    ]);
    setCustomName("");
    setCustomRate("");
    setCustomOpen(false);
  };

  // Catalog search filter — case-insensitive name match, excluding items
  // already on the plan list (so the same service can't be added twice by
  // accident).
  const existingNames = useMemo(
    () => new Set(items.map((i) => i.name.toLowerCase())),
    [items],
  );
  const filteredCatalog = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    return catalog.filter(
      (c) =>
        !existingNames.has(c.name.toLowerCase()) &&
        (q === "" || c.name.toLowerCase().includes(q)),
    );
  }, [catalog, catalogQuery, existingNames]);

  // ── Override controls ──────────────────────────────────────────────
  const openOverride = () => {
    setOverrideDraft(
      rateOverride !== null ? rateOverride.toFixed(2) : autoSum.toFixed(2),
    );
    setOverrideOpen(true);
  };
  const applyOverride = () => {
    const n = Number(overrideDraft);
    if (n > 0) setRateOverride(Math.round(n * 100) / 100);
    else setRateOverride(null);
    setOverrideOpen(false);
  };
  const clearOverride = () => {
    setRateOverride(null);
    setOverrideOpen(false);
  };

  // ── Submit ─────────────────────────────────────────────────────────
  const canSubmit =
    !submitting &&
    checkedCount > 0 &&
    effectiveRate > 0 &&
    startDate.length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      services: items.filter((i) => i.isRecurring).map((i) => i.name),
      per_visit_rate: effectiveRate,
      frequency,
      day_of_week: dayOfWeek,
      interval_months: intervalMonths,
      start_date: startDate,
      send_card_link: sendCardLink,
    });
  };

  return (
    <div className="tp-card p-4 space-y-4">
      {/* Header — single line so operators immediately understand this is
          the conversion surface, not the read-only quote summary above. */}
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold text-ink-900 inline-flex items-center gap-1.5">
          <Repeat className="h-4 w-4 text-green-800" strokeWidth={2.2} />
          Create recurring plan from this quote
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-500 hover:text-ink-700"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.4} />
          Cancel
        </button>
      </div>

      {/* ── Section 1: which quote items recur ─────────────────────── */}
      <section className="space-y-2">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-ink-500">
          Which quote items should recur?
        </div>
        <ul className="rounded-2xl border border-ink-200 bg-card overflow-hidden divide-y divide-ink-200">
          {items.length === 0 && (
            <li className="px-3.5 py-4 text-[12.5px] text-ink-500 italic">
              No items yet — add one from your catalog or as a custom row below.
            </li>
          )}
          {items.map((item) => {
            const showOneTimeBadge =
              item.isOneTimeByDefault && !item.isRecurring;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => toggleItem(item.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3.5 py-3 text-left transition-colors",
                    item.isRecurring
                      ? "bg-green-50/40 hover:bg-green-50"
                      : "bg-card hover:bg-ink-100/60",
                  )}
                >
                  {/* Custom checkbox — bigger tap target than a native input,
                      visibly synced with row hover/state. */}
                  <span
                    className={cn(
                      "flex items-center justify-center h-5 w-5 rounded-md border-2 shrink-0 transition-colors",
                      item.isRecurring
                        ? "bg-green-800 border-green-800"
                        : "bg-card border-ink-300",
                    )}
                    aria-hidden
                  >
                    {item.isRecurring && (
                      <Check
                        className="h-3.5 w-3.5 text-white"
                        strokeWidth={3}
                      />
                    )}
                  </span>
                  <div className="min-w-0 flex-1 flex items-center gap-2">
                    <span
                      className={cn(
                        "text-[13.5px] font-semibold truncate",
                        item.isRecurring ? "text-ink-900" : "text-ink-600",
                      )}
                    >
                      {item.name}
                    </span>
                    {showOneTimeBadge && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded-full bg-ink-100 text-ink-600 text-[10px] font-bold uppercase tracking-[0.3px]">
                        <Ban className="h-2.5 w-2.5" strokeWidth={2.6} />
                        one-time
                      </span>
                    )}
                    {item.source === "catalog" && (
                      <span className="px-1.5 py-[1px] rounded-full bg-bronze-100 text-bronze-700 text-[9.5px] font-bold uppercase tracking-[0.3px]">
                        catalog
                      </span>
                    )}
                    {item.source === "custom" && (
                      <span className="px-1.5 py-[1px] rounded-full bg-bronze-100 text-bronze-700 text-[9.5px] font-bold uppercase tracking-[0.3px]">
                        custom
                      </span>
                    )}
                  </div>
                  <div
                    className={cn(
                      "tp-num text-[13.5px] font-bold shrink-0",
                      item.isRecurring ? "text-ink-900" : "text-ink-500",
                    )}
                  >
                    {fmtUSD(item.rate)}
                  </div>
                  {item.source !== "quote" && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Remove ${item.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeItem(item.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          removeItem(item.id);
                        }
                      }}
                      className="ml-1 h-6 w-6 rounded-full bg-ink-100 hover:bg-destructive/10 text-ink-500 hover:text-destructive flex items-center justify-center transition-colors shrink-0 cursor-pointer"
                    >
                      <X className="h-3 w-3" strokeWidth={2.6} />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {/* Add buttons — same row, side by side. Each opens an inline
            drawer below so we don't blow out into a modal. */}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              setCatalogOpen((v) => !v);
              setCustomOpen(false);
            }}
            className={cn(
              "flex-1 inline-flex items-center justify-center gap-1 py-2 rounded-xl text-[12px] font-semibold transition-colors border",
              catalogOpen
                ? "border-green-800 bg-green-50 text-green-800"
                : "border-ink-200 bg-card text-ink-700 hover:border-green-700",
            )}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            Add from catalog
          </button>
          <button
            type="button"
            onClick={() => {
              setCustomOpen((v) => !v);
              setCatalogOpen(false);
            }}
            className={cn(
              "flex-1 inline-flex items-center justify-center gap-1 py-2 rounded-xl text-[12px] font-semibold transition-colors border",
              customOpen
                ? "border-green-800 bg-green-50 text-green-800"
                : "border-ink-200 bg-card text-ink-700 hover:border-green-700",
            )}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            Add custom
          </button>
        </div>

        {catalogOpen && (
          <div className="rounded-2xl border border-ink-200 bg-card p-3 space-y-2">
            <input
              type="text"
              value={catalogQuery}
              onChange={(e) => setCatalogQuery(e.target.value)}
              placeholder="Search catalog…"
              className="w-full px-3 py-2 rounded-xl border border-ink-200 bg-card text-ink-900 text-[12.5px] focus:outline-none focus:border-green-800"
              autoFocus
            />
            <div className="max-h-44 overflow-y-auto">
              {filteredCatalog.length === 0 ? (
                <div className="text-[11.5px] text-ink-500 italic px-1 py-2">
                  No matching catalog items.
                </div>
              ) : (
                <ul className="divide-y divide-ink-200">
                  {filteredCatalog.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => addFromCatalog(c)}
                        className="w-full flex items-center justify-between gap-2 py-2 px-1 hover:bg-green-50 rounded-md transition-colors"
                      >
                        <span className="text-[12.5px] font-semibold text-ink-900 truncate">
                          {c.name}
                        </span>
                        <span className="tp-num text-[12px] text-ink-500 font-bold shrink-0">
                          {typeof c.default_rate === "number"
                            ? fmtUSD(c.default_rate)
                            : "—"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {customOpen && (
          <div className="rounded-2xl border border-ink-200 bg-card p-3 space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Service name"
                className="flex-1 px-3 py-2 rounded-xl border border-ink-200 bg-card text-ink-900 text-[12.5px] focus:outline-none focus:border-green-800"
                autoFocus
              />
              <div className="relative w-28">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500 text-sm">
                  $
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={customRate}
                  onChange={(e) => setCustomRate(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-6 pr-2 py-2 rounded-xl border border-ink-200 bg-card text-ink-900 text-[12.5px] focus:outline-none focus:border-green-800"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={addCustom}
              disabled={!customName.trim() || !(Number(customRate) > 0)}
              className="w-full py-2 rounded-xl bg-green-800 text-white text-[12px] font-bold disabled:opacity-50"
            >
              Add to plan
            </button>
          </div>
        )}
      </section>

      {/* ── Section 2: per-visit total (auto-summed, override-able) ── */}
      <section className="rounded-2xl bg-green-50/60 border border-green-100 p-3.5">
        <div className="flex items-baseline justify-between">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-green-800">
            Per-visit total
          </div>
          {rateOverride !== null && (
            <span className="px-1.5 py-[1px] rounded-full bg-bronze-100 text-bronze-700 text-[9.5px] font-bold uppercase tracking-[0.3px]">
              custom rate
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-3 mt-1">
          <div className="tp-display tp-num text-[30px] font-bold text-green-900 leading-none">
            {fmtUSD(effectiveRate)}
          </div>
          <button
            type="button"
            onClick={openOverride}
            className="text-[11.5px] font-semibold text-green-800 underline decoration-dotted underline-offset-2 hover:text-green-700"
          >
            {rateOverride !== null ? "edit override" : "override $___"}
          </button>
        </div>
        <div className="text-[11px] text-ink-600 mt-1">
          {rateOverride !== null
            ? "Manual rate — auto-sum ignored."
            : `Auto-summed from ${checkedCount} checked item${
                checkedCount === 1 ? "" : "s"
              } above.`}
        </div>
        {overrideOpen && (
          <div className="mt-2 flex gap-2 items-center">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 text-sm">
                $
              </span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={overrideDraft}
                onChange={(e) => setOverrideDraft(e.target.value)}
                placeholder="0.00"
                className="w-full pl-7 pr-3 py-2 rounded-xl border border-ink-200 bg-card text-ink-900 text-sm focus:outline-none focus:border-green-800"
                autoFocus
              />
            </div>
            <button
              type="button"
              onClick={applyOverride}
              className="px-3 py-2 rounded-xl bg-green-800 text-white text-[12px] font-bold"
            >
              Apply
            </button>
            {rateOverride !== null && (
              <button
                type="button"
                onClick={clearOverride}
                className="px-3 py-2 rounded-xl border border-ink-200 bg-card text-ink-700 text-[12px] font-semibold"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </section>

      {/* ── Section 3: cadence + day ──────────────────────────────── */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-ink-500 mb-1.5">
            How often
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {FREQ_OPTIONS.map((f) => {
              const on = frequency === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => {
                    frequencyTouched.current = true;
                    setFrequency(f.key);
                  }}
                  className={cn(
                    "py-2 rounded-xl text-[11.5px] font-bold transition-colors border",
                    on
                      ? "border-green-800 bg-green-800 text-white"
                      : "border-ink-200 bg-card text-ink-700 hover:border-green-700",
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-ink-500 mb-1.5">
            Day
          </div>
          <div className="grid grid-cols-7 gap-1">
            {DAY_LABEL.map((label, i) => {
              const on = dayOfWeek === i;
              return (
                <button
                  key={`${label}-${i}`}
                  type="button"
                  onClick={() => {
                    dayTouched.current = true;
                    setDayOfWeek(i);
                  }}
                  aria-label={DAY_FULL[i]}
                  className={cn(
                    "py-2 rounded-[10px] text-[11.5px] font-bold transition-colors",
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
      </section>

      {/* ── Section 4: how the card gets charged ─────────────────── */}
      <section className="space-y-2">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-ink-500">
          How the card gets charged
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {BILLING_OPTIONS.map((b) => {
            const on = intervalMonths === b.months;
            return (
              <button
                key={b.months}
                type="button"
                onClick={() => setIntervalMonths(b.months)}
                className={cn(
                  "py-2 rounded-xl text-[11.5px] font-bold transition-colors border",
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
        <div className="flex items-center gap-2 pt-1">
          <label
            htmlFor="convert-start-date"
            className="text-[12px] font-semibold text-ink-700 shrink-0"
          >
            Start:
          </label>
          <input
            id="convert-start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl border border-ink-200 bg-card text-ink-900 text-[13px] focus:outline-none focus:border-green-800"
          />
        </div>
      </section>

      {/* ── Billing preview card ─────────────────────────────────── */}
      <section className="rounded-2xl border-2 border-green-800 bg-gradient-to-br from-green-50 to-card p-3.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-green-800 mb-1.5">
          Billing preview
        </div>
        {effectiveRate > 0 ? (
          <>
            <div className="text-[12.5px] text-ink-700 tp-num leading-snug">
              {fmtUSD(effectiveRate)}/visit × {billingPreview.visitsLabel} ×{" "}
              {intervalMonths} {intervalMonths === 1 ? "month" : "months"}
            </div>
            <div className="tp-display tp-num text-[22px] font-bold text-green-900 leading-tight mt-1">
              = {fmtUSD(billingPreview.total)} per {billingPreview.periodName}
            </div>
            <div className="text-[11.5px] text-ink-600 mt-1.5">
              First charge: <span className="font-semibold text-ink-900">{firstChargeLabel}</span>
            </div>
          </>
        ) : (
          <div className="text-[12px] text-ink-500 italic">
            Check at least one item — or enter a rate override — to see the
            billing total.
          </div>
        )}
      </section>

      {/* ── Section 5: post-creation action ─────────────────────── */}
      <label className="flex items-start gap-2.5 cursor-pointer select-none">
        <span
          className={cn(
            "mt-0.5 flex items-center justify-center h-4.5 w-4.5 rounded border-2 shrink-0 transition-colors",
            sendCardLink
              ? "bg-green-800 border-green-800"
              : "bg-card border-ink-300",
          )}
          style={{ height: "1.1rem", width: "1.1rem" }}
          aria-hidden
        >
          {sendCardLink && (
            <Check className="h-3 w-3 text-white" strokeWidth={3} />
          )}
        </span>
        <input
          type="checkbox"
          className="sr-only"
          checked={sendCardLink}
          onChange={(e) => setSendCardLink(e.target.checked)}
        />
        <span className="text-[12.5px] text-ink-700 leading-snug">
          After creation, text the customer a "save card" link
          <span className="block text-[10.5px] text-ink-500 mt-0.5">
            Sends email + SMS with a portal link they can use to add a payment
            method.
          </span>
        </span>
      </label>

      {error && (
        <div className="rounded-xl bg-[hsl(var(--destructive-bg))] text-destructive text-[12.5px] font-semibold p-3">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full rounded-full bg-green-800 text-white font-bold text-[14px] py-3.5 hover:bg-green-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Repeat className="h-4 w-4" />
        )}
        Create plan
      </button>
    </div>
  );
}
