import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Plus,
  Download,
  Calendar,
  Thermometer,
  Wind,
  Beaker,
  ClipboardCheck,
  Search,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import SaveApplicationForm, {
  APPLICATION_TYPES,
  type ApplicationType,
} from "@/components/calc/SaveApplicationForm";

// Chemical log — the operator's read-out of the chemical_applications table.
// chemical_applications isn't in supabase/types.ts (defined in
// supabase/migrations/0001_turfpro_lawn_care.sql), so we cast at I/O.
// The companion form lives in src/components/calc/SaveApplicationForm.tsx
// and is shared with ApplicationCalc.

type DateRange = "month" | "year" | "all";

type ChemRow = {
  id: string;
  property_id: string | null;
  customer_id: string | null;
  applied_at: string;
  applicator_name: string | null;
  applicator_license: string | null;
  product_name: string;
  epa_reg_number: string | null;
  active_ingredient: string | null;
  application_type: ApplicationType;
  rate_amount: number | null;
  rate_unit: string | null;
  total_amount: number | null;
  total_unit: string | null;
  area_sqft: number | null;
  temperature_f: number | null;
  wind_mph: number | null;
  conditions: string | null;
  customer_notified: boolean;
  signs_posted: boolean;
  notes: string | null;
  // Joined property — supabase nests under the FK name.
  properties: { id: string; address: string } | null;
};

const TYPE_STYLE: Record<ApplicationType, { dot: string; chip: string; label: string }> = {
  fertilizer: {
    dot: "bg-brand-700",
    chip: "bg-brand-50 text-brand-800",
    label: "Fertilizer",
  },
  herbicide: {
    dot: "bg-accent-600",
    chip: "bg-accent-100 text-accent-700",
    label: "Herbicide",
  },
  pesticide: {
    dot: "bg-destructive",
    chip: "bg-[hsl(var(--destructive-bg))] text-destructive",
    label: "Pesticide",
  },
  fungicide: {
    dot: "bg-[hsl(var(--rain))]",
    chip: "bg-[hsl(var(--rain-bg))] text-[hsl(var(--rain))]",
    label: "Fungicide",
  },
  lime: {
    dot: "bg-neutral-700",
    chip: "bg-neutral-100 text-neutral-700",
    label: "Lime",
  },
  other: {
    dot: "bg-neutral-500",
    chip: "bg-neutral-100 text-neutral-700",
    label: "Other",
  },
};

const RANGE_TABS: { key: DateRange; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
];

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const initials = (name: string | null) => {
  if (!name) return null;
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
};

// Tiny CSV cell escaper — handles commas, quotes, newlines. We deliberately
// don't pull in a CSV library; the export is straightforward.
const csvCell = (v: unknown): string => {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

export default function ChemicalLog() {
  const { user } = useAuth();
  const [range, setRange] = useState<DateRange>("year");
  const [typeFilter, setTypeFilter] = useState<ApplicationType | "all">("all");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  // Date floor for the current range filter.
  const sinceIso = useMemo(() => {
    const now = new Date();
    if (range === "month") {
      return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    }
    if (range === "year") {
      return new Date(now.getFullYear(), 0, 1).toISOString();
    }
    return null;
  }, [range]);

  const rowsQuery = useQuery({
    queryKey: ["chemical-applications", user?.id, sinceIso],
    enabled: !!user,
    queryFn: async (): Promise<ChemRow[]> => {
      if (!user) return [];
      let q = (supabase as any)
        .from("chemical_applications")
        .select("*, properties(id, address)")
        .eq("user_id", user.id)
        .order("applied_at", { ascending: false });
      if (sinceIso) q = q.gte("applied_at", sinceIso);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ChemRow[];
    },
  });

  // YTD count is independent of the visible range filter — it's the headline
  // operators actually want at a glance for compliance reporting.
  const ytdQuery = useQuery({
    queryKey: ["chemical-applications-ytd", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<number> => {
      if (!user) return 0;
      const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
      const { count, error } = await (supabase as any)
        .from("chemical_applications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("applied_at", yearStart);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const filtered = useMemo(() => {
    const rows = rowsQuery.data ?? [];
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter !== "all" && r.application_type !== typeFilter) return false;
      if (!term) return true;
      const hay = [
        r.product_name,
        r.epa_reg_number,
        r.active_ingredient,
        r.applicator_name,
        r.properties?.address,
        r.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(term);
    });
  }, [rowsQuery.data, typeFilter, search]);

  const handleExport = () => {
    const headers = [
      "applied_at",
      "applicator_name",
      "applicator_license",
      "product_name",
      "epa_reg_number",
      "active_ingredient",
      "application_type",
      "rate_amount",
      "rate_unit",
      "total_amount",
      "total_unit",
      "area_sqft",
      "temperature_f",
      "wind_mph",
      "conditions",
      "customer_notified",
      "signs_posted",
      "property_address",
      "notes",
    ];
    const lines = [headers.join(",")];
    for (const r of filtered) {
      lines.push(
        [
          r.applied_at,
          r.applicator_name,
          r.applicator_license,
          r.product_name,
          r.epa_reg_number,
          r.active_ingredient,
          r.application_type,
          r.rate_amount,
          r.rate_unit,
          r.total_amount,
          r.total_unit,
          r.area_sqft,
          r.temperature_f,
          r.wind_mph,
          r.conditions,
          r.customer_notified,
          r.signs_posted,
          r.properties?.address ?? "",
          r.notes,
        ]
          .map(csvCell)
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const yr = new Date().getFullYear();
    const tag = range === "month" ? `${yr}-month` : range === "year" ? `${yr}-YTD` : `${yr}-all`;
    a.download = `chemical-log-${tag}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="pt-3 pb-10">
      {/* Header */}
      <header className="px-[22px] pb-[14px] flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium tracking-[0.4px] uppercase text-neutral-500">
            Regulatory record
          </div>
          <h1 className="tp-display text-[28px] font-bold text-neutral-900 leading-tight mt-0.5">
            Chemical log
          </h1>
          <div className="text-[12px] text-neutral-500 mt-1 tp-num">
            {ytdQuery.isLoading
              ? "Loading…"
              : `${ytdQuery.data ?? 0} application${ytdQuery.data === 1 ? "" : "s"} year-to-date`}
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <button
            type="button"
            onClick={handleExport}
            disabled={filtered.length === 0}
            className="h-9 px-3 rounded-full border border-neutral-200 bg-card flex items-center gap-1.5 text-[12.5px] font-semibold text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2} />
            CSV
          </button>
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="h-9 px-3 rounded-full bg-accent-500 text-white flex items-center gap-1.5 text-[12.5px] font-bold shadow-accent hover:bg-accent-600 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
            Add
          </button>
        </div>
      </header>

      {/* Inline add drawer */}
      {showAdd && (
        <div className="mx-4 mb-3">
          <SaveApplicationForm
            variant="inline"
            onSaved={() => setShowAdd(false)}
            onCancel={() => setShowAdd(false)}
          />
        </div>
      )}

      {/* Range pills */}
      <section className="mx-4 mb-3">
        <div className="tp-card p-1 flex gap-1">
          {RANGE_TABS.map((r) => {
            const on = range === r.key;
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                className={cn(
                  "flex-1 py-2 rounded-[12px] text-[12px] font-semibold transition-colors",
                  on ? "bg-brand-800 text-white" : "text-neutral-700 hover:bg-neutral-100",
                )}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Type chips + search */}
      <section className="mx-4 mb-3">
        <div className="flex flex-wrap gap-1.5">
          <TypeChip on={typeFilter === "all"} onClick={() => setTypeFilter("all")}>
            All
          </TypeChip>
          {APPLICATION_TYPES.map((t) => {
            const on = typeFilter === t.value;
            const style = TYPE_STYLE[t.value];
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setTypeFilter(t.value)}
                className={cn(
                  "px-2.5 py-1.5 rounded-full text-[11.5px] font-semibold flex items-center gap-1.5 transition-colors",
                  on
                    ? "bg-brand-800 text-white"
                    : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    on ? "bg-accent-400" : style.dot,
                  )}
                />
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="mt-2.5 relative">
          <Search
            className="h-3.5 w-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2"
            strokeWidth={2}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by product, address, applicator…"
            className="w-full bg-card border border-neutral-200 rounded-full pl-8 pr-9 py-2 text-[12.5px] text-neutral-900 placeholder:text-neutral-400"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 grid place-items-center rounded-full hover:bg-neutral-100"
              aria-label="Clear search"
            >
              <X className="h-3 w-3 text-neutral-500" strokeWidth={2} />
            </button>
          )}
        </div>
      </section>

      {/* List */}
      <section className="mx-4">
        {rowsQuery.error ? (
          <div className="tp-card p-6 text-center">
            <p className="text-sm text-destructive">Couldn't load applications.</p>
            <p className="text-xs text-neutral-500 mt-1">
              {rowsQuery.error instanceof Error
                ? rowsQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        ) : rowsQuery.isLoading ? (
          <ul className="flex flex-col gap-2.5">
            {[0, 1, 2].map((i) => (
              <li
                key={i}
                className="tp-card p-3.5 h-[112px] animate-pulse bg-neutral-100"
              />
            ))}
          </ul>
        ) : filtered.length === 0 ? (
          <EmptyState
            hasAny={(rowsQuery.data ?? []).length > 0}
            onAdd={() => setShowAdd(true)}
          />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {filtered.map((row) => (
              <LogRow key={row.id} row={row} />
            ))}
          </ul>
        )}

        {filtered.length > 0 && (
          <div className="text-center text-[11px] text-neutral-400 mt-4 pb-2">
            Showing {filtered.length} record{filtered.length === 1 ? "" : "s"}
          </div>
        )}
      </section>
    </div>
  );
}

function TypeChip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2.5 py-1.5 rounded-full text-[11.5px] font-semibold transition-colors",
        on ? "bg-brand-800 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200",
      )}
    >
      {children}
    </button>
  );
}

function LogRow({ row }: { row: ChemRow }) {
  const style = TYPE_STYLE[row.application_type] ?? TYPE_STYLE.other;
  const inits = initials(row.applicator_name);
  const rateLine = [
    row.rate_amount != null && row.rate_unit
      ? `${row.rate_amount} ${row.rate_unit}`
      : null,
    row.area_sqft != null
      ? `${row.area_sqft.toLocaleString()} ft²`
      : null,
    row.total_amount != null && row.total_unit
      ? `${row.total_amount} ${row.total_unit} total`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="tp-card p-3.5">
      <div className="flex items-start gap-3">
        <div className="h-[34px] w-[34px] rounded-[10px] bg-brand-50 text-brand-800 grid place-items-center shrink-0">
          <Beaker className="h-4 w-4" strokeWidth={1.9} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-neutral-900 truncate">
                {row.product_name}
              </div>
              {row.epa_reg_number && (
                <div className="text-[10.5px] text-neutral-500 tp-num">
                  EPA {row.epa_reg_number}
                  {row.active_ingredient && (
                    <span className="text-neutral-400"> · {row.active_ingredient}</span>
                  )}
                </div>
              )}
            </div>
            <span
              className={cn(
                "px-2 py-[2px] rounded-full text-[10px] font-bold uppercase tracking-[0.4px] whitespace-nowrap shrink-0",
                style.chip,
              )}
            >
              {style.label}
            </span>
          </div>

          {row.properties?.address && (
            <Link
              to={`/properties/${row.properties.id}`}
              className="block text-[11.5px] text-neutral-700 font-semibold mt-1 truncate hover:underline"
            >
              {row.properties.address}
            </Link>
          )}

          <div className="flex items-center flex-wrap gap-1.5 mt-1.5 text-[11px] text-neutral-500">
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" strokeWidth={2} />
              {fmtDateTime(row.applied_at)}
            </span>
            {inits && (
              <>
                <span className="text-neutral-300">·</span>
                <span className="font-semibold text-neutral-700 tp-num">{inits}</span>
              </>
            )}
          </div>

          {rateLine && (
            <div className="text-[11.5px] text-neutral-700 mt-1 tp-num">{rateLine}</div>
          )}

          {(row.temperature_f != null ||
            row.wind_mph != null ||
            row.customer_notified ||
            row.signs_posted) && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {row.temperature_f != null && (
                <span className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full bg-neutral-100 text-neutral-700 text-[10.5px] font-semibold">
                  <Thermometer className="h-2.5 w-2.5" />
                  <span className="tp-num">{row.temperature_f}</span>°F
                </span>
              )}
              {row.wind_mph != null && (
                <span className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full bg-neutral-100 text-neutral-700 text-[10.5px] font-semibold">
                  <Wind className="h-2.5 w-2.5" />
                  <span className="tp-num">{row.wind_mph}</span> mph
                </span>
              )}
              {row.customer_notified && (
                <span className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full bg-brand-50 text-brand-800 text-[10.5px] font-semibold">
                  <ClipboardCheck className="h-2.5 w-2.5" /> Notified
                </span>
              )}
              {row.signs_posted && (
                <span className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full bg-accent-100 text-accent-700 text-[10.5px] font-semibold">
                  Signs posted
                </span>
              )}
            </div>
          )}

          {row.notes && (
            <div className="text-[11px] text-neutral-500 mt-1.5 italic line-clamp-2">
              {row.notes}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function EmptyState({ hasAny, onAdd }: { hasAny: boolean; onAdd: () => void }) {
  return (
    <div className="tp-card p-6 text-center">
      <div className="mx-auto h-12 w-12 rounded-full bg-brand-50 text-brand-700 grid place-items-center mb-3">
        <ClipboardCheck className="h-5 w-5" strokeWidth={1.8} />
      </div>
      <div className="text-[15px] font-semibold text-neutral-900">
        {hasAny ? "Nothing matches that filter" : "No applications logged yet"}
      </div>
      <p className="text-xs text-neutral-500 mt-1.5 max-w-[280px] mx-auto leading-relaxed">
        {hasAny
          ? "Loosen the filter or switch to all-time to see older records."
          : "This is the regulatory record most US states require for pesticide, herbicide, and fertilizer applications. Save from the calculator or add one directly."}
      </p>
      {!hasAny && (
        <button
          type="button"
          onClick={onAdd}
          className="mt-3.5 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-brand-800 text-white text-[13px] font-bold hover:bg-brand-700 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Add application
        </button>
      )}
    </div>
  );
}
