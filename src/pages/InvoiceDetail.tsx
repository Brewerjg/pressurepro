import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  CheckCircle2,
  CircleCheckBig,
  DollarSign,
  Link as LinkIcon,
  Printer,
  Repeat,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { parseLines, describe, type QuoteLine } from "@/components/quotes/types";
import { deriveInitialLineItems } from "@/components/quotes/convertHelpers";
import ConvertToPlanForm from "@/components/quotes/ConvertToPlanForm";
import QuoteManualPaymentForm from "@/components/quotes/QuoteManualPaymentForm";
import ManualPaymentsList from "@/components/quotes/ManualPaymentsList";
import {
  getInvoice,
  formatInvoiceNumber,
  updateInvoice,
  type Invoice,
} from "@/lib/invoices";
import { publicAppOrigin } from "@/lib/public-url";
import {
  listManualPaymentsForInvoice,
  recordPayment,
  type ManualPayment,
  type ManualPaymentMethod,
} from "@/lib/manual-payments";
import { APP_ID } from "@/lib/app-context";
import { vertical } from "@/vertical";
import { getQuickBooksStatus } from "@/lib/quickbooks";
import { syncInvoiceToQuickBooks } from "@/lib/quickbooks-sync";

// InvoiceDetail — the post-acceptance money + fulfillment surface. Once a
// quote is accepted it spawns an invoice; the operator works the invoice
// from here: record offline payments, mark it paid / complete, and (since
// recurring service is a post-acceptance decision) convert it into a plan.
// Modeled on the post-accept half of QuoteDetail.tsx.

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const STATUS_PILL: Record<Invoice["status"], string> = {
  open: "bg-accent-100 text-accent-700",
  paid: "bg-brand-100 text-brand-800",
  void: "bg-neutral-100 text-neutral-700",
};

interface CatalogEntry {
  id: string;
  name: string;
  default_rate: number | null;
}

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [actionError, setActionError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [paymentFormOpen, setPaymentFormOpen] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [convertFormOpen, setConvertFormOpen] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  const { data: invoice, isLoading } = useQuery({
    queryKey: ["invoice", id],
    queryFn: async () => (id ? getInvoice(id) : null),
    enabled: !!id,
  });

  // Manual payments already logged against this invoice. Drives the
  // cumulative-total check that decides whether to prompt the operator to
  // flip status → 'paid'.
  const { data: manualPayments } = useQuery({
    queryKey: ["invoice-manual-payments", id],
    queryFn: async () => (id ? listManualPaymentsForInvoice(id) : []),
    enabled: !!id,
  });

  // Service catalog — feeds the "Add from catalog" affordance in the
  // convert form. Same query NewPlan.tsx uses.
  const { data: catalog } = useQuery({
    queryKey: ["catalog", "service", APP_ID],
    queryFn: async (): Promise<CatalogEntry[]> => {
      const { data, error } = await supabase
        .from("catalog_items")
        .select("id, name, default_rate")
        .eq("app", APP_ID)
        .eq("kind", vertical.catalog.serviceKind)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CatalogEntry[];
    },
  });

  // Parse the snapshotted JSONB lines column into the operator-side line
  // shape so we can render line items and seed the convert form.
  const lines = useMemo<QuoteLine[]>(
    () => (invoice ? parseLines(invoice.lines) : []),
    [invoice],
  );
  const initialLineItems = useMemo(
    () => deriveInitialLineItems(lines),
    [lines],
  );

  // Patch helper for status / completed_at flips.
  const update = useMutation({
    mutationFn: async (patch: Partial<Invoice>) => {
      if (!id) throw new Error("Missing id");
      await updateInvoice(id, patch);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoice", id] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : "Update failed"),
  });

  // Manual-payment mutation. After save we check cumulative recorded
  // payments against the invoice total and prompt the operator (window.confirm
  // — per spec, no toast lib) to flip status → 'paid'. The flip is OPT-IN.
  const recordPaymentMutation = useMutation({
    mutationFn: async (args: {
      method: ManualPaymentMethod;
      amountCents: number;
      checkNumber: string | null;
    }) => {
      if (!invoice) throw new Error("Missing invoice");
      const inserted = await recordPayment({
        invoice_id: invoice.id,
        customer_id: invoice.customer_id ?? null,
        method: args.method,
        amount_cents: args.amountCents,
        check_number: args.checkNumber,
      });
      return inserted;
    },
    onSuccess: async (inserted: ManualPayment) => {
      setPaymentFormOpen(false);
      setPaymentError(null);
      // Refresh the payments list so the cumulative math is current.
      await queryClient.invalidateQueries({
        queryKey: ["invoice-manual-payments", id],
      });
      if (!invoice) return;
      // Compute cumulative INCLUDING the newly inserted row — the query may
      // not have refetched yet, so add it locally.
      const prior = (manualPayments ?? []).reduce(
        (s, p) => s + (p.status === "voided" ? 0 : p.amount_cents),
        0,
      );
      const cumulativeCents = prior + inserted.amount_cents;
      const totalCents = Math.round(Number(invoice.total ?? 0) * 100);
      // Already paid in full -> offer to flip status to 'paid'.
      if (
        totalCents > 0 &&
        cumulativeCents >= totalCents &&
        invoice.status !== "paid"
      ) {
        if (
          window.confirm(
            "Cumulative payments meet the invoice total. Mark this invoice as paid?",
          )
        ) {
          update.mutate({ status: "paid" });
        }
      }
    },
    onError: (err) =>
      setPaymentError(
        err instanceof Error ? err.message : "Couldn't save payment",
      ),
  });

  // Convert-to-plan: hands off to the convert-quote-to-plan edge function
  // with the SOURCE quote's id. The function clones the line items into the
  // maintenance_plans.services array and computes the recurring amount from
  // the per-visit rate × cadence × billing interval.
  const convertToPlanMutation = useMutation({
    mutationFn: async (args: {
      services: string[];
      per_visit_rate: number;
      frequency: string;
      day_of_week: number;
      interval_months: 1 | 3 | 6 | 12;
      start_date: string;
      send_card_link: boolean;
    }) => {
      if (!invoice) throw new Error("Missing invoice");
      const { data, error } = await supabase.functions.invoke(
        "convert-quote-to-plan",
        {
          body: {
            quote_id: invoice.quote_id,
            mode: "standalone" as const,
            services: args.services,
            per_visit_rate: args.per_visit_rate,
            frequency: args.frequency,
            day_of_week: args.day_of_week,
            interval_months: args.interval_months,
            start_date: args.start_date,
          },
        },
      );
      if (error) throw error;
      const ack = data as
        | { ok?: boolean; plan_id?: string; error?: string }
        | null;
      if (!ack?.ok || !ack.plan_id) {
        throw new Error(ack?.error ?? "Couldn't convert quote to plan");
      }
      return ack.plan_id;
    },
    onSuccess: (planId: string) => {
      setConvertFormOpen(false);
      setConvertError(null);
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", id] });
      // Land the operator straight on the new plan page.
      navigate(`/plans/${planId}`);
    },
    onError: (err) =>
      setConvertError(err instanceof Error ? err.message : "Conversion failed"),
  });

  const { data: qbStatus } = useQuery({
    queryKey: ["quickbooks-status"],
    queryFn: getQuickBooksStatus,
    staleTime: 5 * 60 * 1000,
  });

  const [qbError, setQbError] = useState<string | null>(null);
  const syncQb = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("Missing invoice id");
      return syncInvoiceToQuickBooks(id);
    },
    onSuccess: () => {
      setQbError(null);
      queryClient.invalidateQueries({ queryKey: ["invoice", id] });
    },
    onError: (e: unknown) => {
      setQbError(e instanceof Error ? e.message : "QuickBooks sync failed");
      queryClient.invalidateQueries({ queryKey: ["invoice", id] });
    },
  });

  if (isLoading) {
    return <div className="pt-6 px-[22px] text-sm text-neutral-500">Loading…</div>;
  }
  if (!invoice) {
    return (
      <div className="pt-6 px-[22px]">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-sm text-neutral-500 inline-flex items-center gap-1.5 mb-3"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="tp-card p-5 text-sm text-neutral-700">
          Invoice not found.
        </div>
      </div>
    );
  }

  const total = Number(invoice.total ?? 0);
  const deposit = invoice.deposit_amount ? Number(invoice.deposit_amount) : 0;

  // Cumulative collected from the recorded (non-voided) manual payments.
  const collected = (manualPayments ?? []).reduce(
    (s, p) => s + (p.status === "voided" ? 0 : p.amount_cents / 100),
    0,
  );
  const remaining = Math.max(0, total - collected);

  const handleCopyLink = async () => {
    const url = `${publicAppOrigin()}/invoice/${invoice.public_token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      // Fallback prompt — some browsers gate clipboard behind permissions.
      window.prompt("Copy this link:", url);
    }
  };

  const handlePrint = () => {
    window.open(`/invoice/${invoice.public_token}/print`, "_blank", "noopener");
  };

  const handleMarkPaid = () => {
    if (invoice.status === "paid") return;
    if (
      !window.confirm("Mark this invoice as paid? This records it as settled.")
    )
      return;
    setActionError(null);
    update.mutate({ status: "paid" });
  };

  const handleMarkComplete = () => {
    if (invoice.completed_at) return;
    if (!window.confirm("Mark the work for this invoice complete?")) return;
    setActionError(null);
    update.mutate({ completed_at: new Date().toISOString() });
  };

  return (
    <div className="pt-3">
      {/* Header */}
      <header className="px-[22px] pb-3">
        <button
          type="button"
          onClick={() => navigate("/invoices")}
          className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.4px] uppercase text-neutral-500 mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Invoices
        </button>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold tracking-[0.4px] uppercase text-accent-600">
            Invoice · {formatInvoiceNumber(invoice.invoice_number)}
          </div>
          <h1 className="tp-display text-[26px] font-bold text-neutral-900 mt-0.5 leading-tight truncate">
            {invoice.customer_name}
          </h1>
          {invoice.address && (
            <div className="text-sm text-neutral-500 mt-1 truncate">
              {invoice.address}
            </div>
          )}
        </div>
      </header>

      {/* Status + total summary card */}
      <section className="mx-4 mb-3">
        <div className="rounded-[18px] bg-gradient-hero-deep text-white p-[18px] relative overflow-hidden">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-[10px] font-semibold tracking-[1px] uppercase text-accent-400">
              Invoice total
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-[0.4px]",
                  STATUS_PILL[invoice.status],
                )}
              >
                {invoice.status}
              </span>
              {invoice.completed_at && (
                <span className="px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-[0.4px] bg-brand-100 text-brand-800">
                  complete
                </span>
              )}
            </div>
          </div>
          <div className="tp-display tp-num text-[38px] font-bold leading-none">
            {fmtUSD(total)}
          </div>
          <div className="text-white/70 text-[12px] mt-2 tp-num">
            {lines.length} line{lines.length === 1 ? "" : "s"}
            {collected > 0
              ? ` · ${fmtUSD(collected)} collected`
              : ""}
            {remaining > 0 && total > 0
              ? ` · ${fmtUSD(remaining)} due`
              : total > 0
                ? " · paid in full"
                : ""}
          </div>
          {deposit > 0 && (
            <div className="text-accent-400 text-[11px] mt-1 tp-num">
              {fmtUSD(deposit)} deposit
              {invoice.deposit_paid_at
                ? ` · paid ${fmtDate(invoice.deposit_paid_at)}`
                : " · unpaid"}
            </div>
          )}
          <div className="text-white/50 text-[11px] mt-1 tp-num">
            Issued {fmtDate(invoice.issued_at)}
          </div>
        </div>
      </section>

      {/* Primary money actions */}
      <section className="mx-4 mb-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            setPaymentError(null);
            setPaymentFormOpen((v) => !v);
            setConvertFormOpen(false);
          }}
          className="rounded-[14px] bg-accent-500 text-white font-bold text-[13px] py-3 shadow-accent hover:bg-accent-600 transition-colors inline-flex items-center justify-center gap-1.5"
        >
          <DollarSign className="h-3.5 w-3.5" />
          Record payment
        </button>
        <button
          type="button"
          onClick={handleMarkPaid}
          disabled={invoice.status === "paid" || update.isPending}
          className="rounded-[14px] border border-neutral-200 bg-card text-neutral-700 font-semibold text-[13px] py-3 hover:bg-neutral-100 transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
        >
          {invoice.status === "paid" ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-brand-700" />
              Paid
            </>
          ) : (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Mark paid
            </>
          )}
        </button>
        <button
          type="button"
          onClick={handleMarkComplete}
          disabled={!!invoice.completed_at || update.isPending}
          className="rounded-[14px] border border-neutral-200 bg-card text-neutral-700 font-semibold text-[13px] py-3 hover:bg-neutral-100 transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
        >
          <CircleCheckBig className="h-3.5 w-3.5" />
          {invoice.completed_at ? "Completed" : "Mark complete"}
        </button>
        <button
          type="button"
          onClick={() => {
            setConvertError(null);
            setConvertFormOpen((v) => !v);
            setPaymentFormOpen(false);
          }}
          className="rounded-[14px] border border-neutral-200 bg-card text-neutral-700 font-semibold text-[13px] py-3 hover:bg-neutral-100 transition-colors inline-flex items-center justify-center gap-1.5"
        >
          <Repeat className="h-3.5 w-3.5" />
          Convert to plan
        </button>
        <button
          type="button"
          onClick={handleCopyLink}
          className="rounded-[14px] border border-neutral-200 bg-card text-neutral-700 font-semibold text-[13px] py-3 hover:bg-neutral-100 transition-colors inline-flex items-center justify-center gap-1.5"
        >
          {copyState === "copied" ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-brand-700" />
              Copied
            </>
          ) : (
            <>
              <LinkIcon className="h-3.5 w-3.5" />
              Customer link
            </>
          )}
        </button>
        <button
          type="button"
          onClick={handlePrint}
          className="rounded-[14px] border border-neutral-200 bg-card text-neutral-700 font-semibold text-[13px] py-3 hover:bg-neutral-100 transition-colors inline-flex items-center justify-center gap-1.5"
        >
          <Printer className="h-3.5 w-3.5" />
          Print
        </button>
      </section>

      {qbStatus?.connected && (
        <section className="mx-4 mb-3">
          <button
            type="button"
            onClick={() => syncQb.mutate()}
            disabled={syncQb.isPending}
            className="w-full rounded-[14px] border border-neutral-200 bg-card text-neutral-700 font-semibold text-[13px] py-3 hover:bg-neutral-100 transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            <Calculator className="h-3.5 w-3.5" />
            {syncQb.isPending
              ? "Syncing to QuickBooks…"
              : invoice.qbo_synced_at
                ? "Synced to QuickBooks ✓ — sync again"
                : "Sync to QuickBooks"}
          </button>
          {invoice.qbo_synced_at && !qbError && (
            <p className="mt-1 text-[11px] text-neutral-500">
              Last synced {fmtDate(invoice.qbo_synced_at)}.
            </p>
          )}
          {(qbError || invoice.qbo_sync_error) && (
            <p className="mt-1 text-[11px] font-semibold text-destructive">
              {qbError || invoice.qbo_sync_error}
            </p>
          )}
        </section>
      )}

      {/* Record-payment form */}
      {paymentFormOpen && (
        <section className="mx-4 mb-3">
          <QuoteManualPaymentForm
            defaultAmount={remaining}
            submitting={recordPaymentMutation.isPending}
            error={paymentError}
            onCancel={() => setPaymentFormOpen(false)}
            onSubmit={(args) =>
              recordPaymentMutation.mutate({
                method: args.method,
                amountCents: args.amountCents,
                checkNumber: args.checkNumber,
              })
            }
          />
        </section>
      )}

      {/* Convert-to-plan form. Submits to the convert-quote-to-plan edge
          function (with the source quote_id) and navigates to the new plan. */}
      {convertFormOpen && (
        <section className="mx-4 mb-3">
          <ConvertToPlanForm
            submitting={convertToPlanMutation.isPending}
            error={convertError}
            initialLineItems={initialLineItems}
            catalog={catalog ?? []}
            onCancel={() => setConvertFormOpen(false)}
            onSubmit={(values) => convertToPlanMutation.mutate(values)}
          />
        </section>
      )}

      {/* Recorded payments — history + cumulative total. */}
      {manualPayments && manualPayments.length > 0 && (
        <section className="mx-4 mb-3">
          <ManualPaymentsList payments={manualPayments} quoteTotal={total} />
        </section>
      )}

      {/* Line items */}
      <section className="mx-4 mb-3">
        <div className="flex items-center justify-between px-1 pb-2">
          <h2 className="tp-display text-[15px] font-bold text-neutral-900">
            Line items
          </h2>
        </div>
        {lines.length === 0 ? (
          <div className="tp-card p-4 text-sm text-neutral-500">No line items.</div>
        ) : (
          <ul className="space-y-2">
            {lines.map((l) => {
              const d = describe(l);
              return (
                <li key={l.id} className="tp-card p-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm text-neutral-900 truncate">
                      {d.label}
                    </div>
                    {d.detail && (
                      <div className="text-[11px] text-neutral-500 tp-num mt-0.5">
                        {d.detail}
                      </div>
                    )}
                  </div>
                  <div className="tp-num font-bold text-sm text-neutral-900 shrink-0">
                    {fmtUSD(d.amount)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Source quote link */}
      <section className="mx-4 mb-3">
        <Link
          to={`/quotes/${invoice.quote_id}`}
          className="tp-card p-3.5 flex items-center justify-between gap-2 text-[13px] font-semibold text-neutral-700 hover:bg-neutral-100 transition-colors"
        >
          <span>View source quote</span>
          <ArrowRight className="h-4 w-4 text-accent-600" />
        </Link>
      </section>

      {/* Error toast */}
      {actionError && (
        <div className="mx-4 mb-3 rounded-xl bg-[hsl(var(--destructive-bg))] text-destructive text-[12.5px] font-semibold p-3">
          {actionError}
        </div>
      )}
    </div>
  );
}
