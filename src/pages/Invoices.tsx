import { useMemo, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, FileText, ChevronRight, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_ID } from "@/lib/app-context";
import {
  listInvoices,
  formatInvoiceNumber,
  type Invoice,
} from "@/lib/invoices";
import { getQuickBooksStatus } from "@/lib/quickbooks";
import { qboSyncState } from "@/lib/qbo-sync-state";
import { QbSyncChip } from "@/components/invoices/QbSyncChip";

// Invoices list — the surface where TurfPro operators work the bills they've
// issued from accepted quotes. Mirrors the Quotes list structure/styling: a
// header with an open count + outstanding $, a segmented status filter, and a
// glanceable card list tuned for a 6" phone. Reads through src/lib/invoices.ts
// (invoices isn't in the generated Database type, so the lib casts at the
// boundary).

type StatusFilter = "unpaid" | "paid" | "all" | "unsynced";

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "unpaid", label: "Unpaid" },
  { key: "paid", label: "Paid" },
  { key: "all", label: "All" },
];

// Color tokens that operators glance at on a phone. Open = still owed (bronze),
// paid = settled (green), void = inert (ink).
const STATUS_STYLE: Record<Invoice["status"], { pill: string; stripe: string }> = {
  open: { pill: "bg-bronze-100 text-bronze-700", stripe: "bg-bronze-500" },
  paid: { pill: "bg-green-100 text-green-800", stripe: "bg-green-700" },
  void: { pill: "bg-ink-100 text-ink-700", stripe: "bg-ink-400" },
};

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const fmtDateShort = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function Invoices() {
  const [filter, setFilter] = useState<StatusFilter>("unpaid");

  const { data: invoices, isLoading, error } = useQuery({
    queryKey: ["invoices"],
    queryFn: () => listInvoices(APP_ID),
  });

  const { data: qbStatus } = useQuery({
    queryKey: ["quickbooks-status"],
    queryFn: getQuickBooksStatus,
    staleTime: 5 * 60 * 1000,
  });
  const qbConnected = !!qbStatus?.connected;

  // "Open" = status open (still owed). Outstanding $ sums those totals.
  const openInvoices = useMemo(
    () => (invoices ?? []).filter((inv) => inv.status === "open"),
    [invoices],
  );
  const outstanding = useMemo(
    () => openInvoices.reduce((s, inv) => s + Number(inv.total ?? 0), 0),
    [openInvoices],
  );

  useEffect(() => {
    if (!qbConnected && filter === "unsynced") setFilter("unpaid");
  }, [qbConnected, filter]);

  const filtered = useMemo(() => {
    if (!invoices) return [];
    if (filter === "all") return invoices;
    if (filter === "unpaid") return invoices.filter((inv) => inv.status === "open");
    if (filter === "unsynced") return invoices.filter((inv) => qboSyncState(inv) === "unsynced");
    return invoices.filter((inv) => inv.status === "paid");
  }, [invoices, filter]);

  const tabs: { key: StatusFilter; label: string }[] = [
    ...STATUS_TABS,
    ...(qbConnected ? [{ key: "unsynced" as const, label: "Unsynced" }] : []),
  ];

  return (
    <div className="pt-3">
      {/* Header */}
      <header className="px-[22px] pb-[18px] flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium tracking-[0.4px] uppercase text-ink-500">
            Billing
          </div>
          <h1 className="tp-display text-2xl font-bold text-ink-900 mt-0.5">
            Invoices
          </h1>
          <div className="text-[12px] text-ink-500 mt-1 tp-num">
            {isLoading
              ? "Loading…"
              : `${openInvoices.length} open · ${fmtUSD(outstanding)} outstanding`}
          </div>
        </div>
        <Link
          to="/quotes"
          className="h-10 px-3.5 rounded-full bg-bronze-500 text-white flex items-center gap-1.5 font-semibold text-[13px] shadow-bronze hover:bg-bronze-600 transition-colors"
        >
          <Plus className="h-4 w-4" strokeWidth={2.4} />
          From quote
        </Link>
      </header>

      {/* Status filter — same segmented control pattern as Quotes / Plans */}
      <section className="mx-4 mb-3">
        <div className="tp-card p-1 flex gap-1">
          {tabs.map((tab) => {
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
            <p className="text-sm text-destructive">Couldn't load invoices.</p>
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
              {filter === "all"
                ? "No invoices yet."
                : `No ${filter} invoices.`}
            </p>
            <p className="text-xs text-ink-500 mt-1 max-w-[260px] mx-auto">
              Convert an accepted quote into an invoice to bill a customer and
              track what's still owed.
            </p>
            <Link
              to="/quotes"
              className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-full bg-bronze-500 text-white text-[13px] font-semibold shadow-bronze hover:bg-bronze-600 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
              From quote
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {filtered.map((inv) => (
              <InvoiceRowItem key={inv.id} invoice={inv} qbConnected={qbConnected} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function InvoiceRowItem({ invoice, qbConnected }: { invoice: Invoice; qbConnected: boolean }) {
  const tone = STATUS_STYLE[invoice.status];
  // Amount due = full total while open, nothing once paid/void.
  const amountDue = invoice.status === "open" ? Number(invoice.total ?? 0) : 0;
  return (
    <li>
      <Link
        to={`/invoices/${invoice.id}`}
        className="tp-card block p-3.5 active:scale-[0.99] transition-transform"
      >
        <div className="flex items-stretch gap-3">
          {/* Status stripe — high-glance lifecycle marker */}
          <div
            className={cn("w-1.5 rounded-[3px] self-stretch shrink-0", tone.stripe)}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-[14px] text-ink-900 truncate">
                  {invoice.customer_name || "Unnamed customer"}
                </div>
                <div className="text-[11px] text-ink-500 tp-num mt-0.5">
                  {formatInvoiceNumber(invoice.invoice_number)}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="tp-num font-bold text-[14px] text-ink-900">
                  {fmtUSD(Number(invoice.total ?? 0))}
                </div>
                {amountDue > 0 && (
                  <div className="text-[11px] text-bronze-700 tp-num font-semibold mt-0.5">
                    {fmtUSD(amountDue)} due
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between mt-2 gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className={cn(
                    "px-2 py-[2px] rounded-full text-[10.5px] font-bold uppercase tracking-[0.4px] shrink-0",
                    tone.pill,
                  )}
                >
                  {invoice.status}
                </span>
                {invoice.completed_at && (
                  <span className="inline-flex items-center gap-0.5 px-2 py-[2px] rounded-full text-[10.5px] font-bold uppercase tracking-[0.4px] bg-green-100 text-green-800 shrink-0">
                    <CheckCircle2 className="h-3 w-3" strokeWidth={2.4} />
                    Complete
                  </span>
                )}
                {qbConnected && <QbSyncChip row={invoice} />}
              </div>
              <div className="text-[11px] text-ink-500 tp-num shrink-0">
                {fmtDateShort(invoice.created_at)}
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
