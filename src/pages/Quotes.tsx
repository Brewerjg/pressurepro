import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, FileText, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";

// Quotes list — TurfPro's one-off jobs surface (spring cleanup, aeration, leaf
// removal, snow events). Recurring service lives on Plans. We read directly
// from the shared PressurePro `quotes` table; the public-facing /accept and
// /quotes/:id/print pages already consume the same rows.

type QuoteRow = Database["public"]["Tables"]["quotes"]["Row"];
type Status = Database["public"]["Enums"]["quote_status"];

type StatusFilter = "all" | "draft" | "sent" | "accepted" | "paid";

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "accepted", label: "Accepted" },
  { key: "paid", label: "Paid" },
];

// Color tokens that operators glance at on a 6" phone. Kept deliberately
// distinct between adjacent lifecycle states (sent → accepted is the big
// hand-off).
const STATUS_STYLE: Record<Status, { pill: string; stripe: string }> = {
  draft:     { pill: "bg-ink-100 text-ink-700",     stripe: "bg-ink-400" },
  sent:      { pill: "bg-bronze-100 text-bronze-700", stripe: "bg-bronze-500" },
  accepted:  { pill: "bg-green-100 text-green-800", stripe: "bg-green-700" },
  scheduled: { pill: "bg-green-100 text-green-800", stripe: "bg-green-600" },
  complete:  { pill: "bg-green-100 text-green-800", stripe: "bg-green-500" },
  paid:      { pill: "bg-green-100 text-green-800", stripe: "bg-green-800" },
};

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const fmtDateShort = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function Quotes() {
  const [filter, setFilter] = useState<StatusFilter>("all");

  const { data: quotes, isLoading, error } = useQuery({
    queryKey: ["quotes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as QuoteRow[];
    },
  });

  // "Open" = anything not yet fully settled. Outstanding $ excludes paid.
  const openQuotes = useMemo(
    () =>
      (quotes ?? []).filter(
        (q) => q.status !== "paid" && q.status !== "complete",
      ),
    [quotes],
  );
  const outstanding = useMemo(
    () => openQuotes.reduce((s, q) => s + Number(q.total ?? 0), 0),
    [openQuotes],
  );

  const filtered = useMemo(() => {
    if (!quotes) return [];
    if (filter === "all") return quotes;
    return quotes.filter((q) => q.status === filter);
  }, [quotes, filter]);

  return (
    <div className="pt-3">
      {/* Header */}
      <header className="px-[22px] pb-[18px] flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium tracking-[0.4px] uppercase text-ink-500">
            One-off jobs
          </div>
          <h1 className="tp-display text-2xl font-bold text-ink-900 mt-0.5">
            Quotes
          </h1>
          <div className="text-[12px] text-ink-500 mt-1 tp-num">
            {isLoading
              ? "Loading…"
              : `${openQuotes.length} open · ${fmtUSD(outstanding)} outstanding`}
          </div>
        </div>
        <Link
          to="/quotes/new"
          className="h-10 px-3.5 rounded-full bg-bronze-500 text-white flex items-center gap-1.5 font-semibold text-[13px] shadow-bronze hover:bg-bronze-600 transition-colors"
        >
          <Plus className="h-4 w-4" strokeWidth={2.4} />
          New quote
        </Link>
      </header>

      {/* Status filter — same segmented control pattern as Plans */}
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
            <p className="text-sm text-destructive">Couldn't load quotes.</p>
            <p className="text-xs text-ink-500 mt-1">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </div>
        ) : isLoading ? (
          <ul className="flex flex-col gap-2.5">
            {[0, 1, 2].map((i) => (
              <li
                key={i}
                className="tp-card p-3.5 h-[80px] animate-pulse bg-ink-100"
              />
            ))}
          </ul>
        ) : filtered.length === 0 ? (
          <div className="tp-card p-6 text-center">
            <FileText className="h-7 w-7 mx-auto text-ink-400" strokeWidth={1.7} />
            <p className="text-sm font-semibold text-ink-900 mt-2">
              {filter === "all" ? "No quotes yet." : `No ${filter} quotes.`}
            </p>
            <p className="text-xs text-ink-500 mt-1 max-w-[260px] mx-auto">
              Build a quote for a spring cleanup, leaf haul, or any one-off
              job that doesn't fit on a plan.
            </p>
            <Link
              to="/quotes/new"
              className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-full bg-bronze-500 text-white text-[13px] font-semibold shadow-bronze hover:bg-bronze-600 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
              New quote
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {filtered.map((q) => (
              <QuoteRowItem key={q.id} quote={q} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function QuoteRowItem({ quote }: { quote: QuoteRow }) {
  const tone = STATUS_STYLE[quote.status];
  return (
    <li>
      <Link
        to={`/quotes/${quote.id}`}
        className="tp-card block p-3.5 active:scale-[0.99] transition-transform"
      >
        <div className="flex items-stretch gap-3">
          {/* Status stripe — high-glance lifecycle marker */}
          <div
            className={cn("w-1.5 rounded-[3px] self-stretch shrink-0", tone.stripe)}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-semibold text-[14px] text-ink-900 truncate">
                {quote.customer_name || "Unnamed customer"}
              </div>
              <div className="tp-num font-bold text-[14px] text-ink-900 shrink-0">
                {fmtUSD(Number(quote.total ?? 0))}
              </div>
            </div>
            {quote.address && (
              <div className="text-[11.5px] text-ink-500 truncate mt-0.5">
                {quote.address}
              </div>
            )}
            <div className="flex items-center justify-between mt-2">
              <span
                className={cn(
                  "px-2 py-[2px] rounded-full text-[10.5px] font-bold uppercase tracking-[0.4px]",
                  tone.pill,
                )}
              >
                {quote.status}
              </span>
              <div className="text-[11px] text-ink-500 tp-num">
                {fmtDateShort(quote.created_at)}
              </div>
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
