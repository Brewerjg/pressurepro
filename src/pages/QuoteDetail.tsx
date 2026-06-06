import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  DollarSign,
  Eye,
  Link as LinkIcon,
  Loader2,
  Pencil,
  Printer,
  Repeat,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";
import QuoteForm, { type QuoteFormValues } from "@/components/quotes/QuoteForm";
import { parseLines, quoteTotal, type QuoteLine } from "@/components/quotes/types";
import {
  listManualPaymentsForQuote,
  recordPayment,
  type ManualPayment,
  type ManualPaymentMethod,
  METHOD_LABEL,
} from "@/lib/manual-payments";
import { sendQuote } from "@/lib/customer-email";
import { sendQuoteSms } from "@/lib/customer-sms";

// QuoteDetail — read view + edit toggle + lifecycle actions. The operator
// usually lands here from the list, glances at the status pill, and either
// resends or marks the row through to paid. Print and public-link actions
// piggyback on the already-shipped /accept and /accept/:id/print pages.

type QuoteRow = Database["public"]["Tables"]["quotes"]["Row"];
type QuoteUpdate = Database["public"]["Tables"]["quotes"]["Update"];
type QuoteStatus = Database["public"]["Enums"]["quote_status"];
type QuoteViewRow = Database["public"]["Tables"]["quote_views"]["Row"];

// Sentinel prefix written into `quotes.notes` by Accept.tsx when the
// customer opts into recurring service. We piggyback on the notes column
// to avoid a new schema migration — see README of this file's edits.
// Format: `[recurring_requested] ${original_notes}` so the operator can
// still read their original notes underneath.
const RECURRING_REQUESTED_SENTINEL = "[recurring_requested]";

const STATUS_PILL: Record<QuoteStatus, string> = {
  draft:     "bg-ink-100 text-ink-700",
  sent:      "bg-bronze-100 text-bronze-700",
  accepted:  "bg-green-100 text-green-800",
  scheduled: "bg-green-100 text-green-800",
  complete:  "bg-green-100 text-green-800",
  paid:      "bg-green-100 text-green-800",
};

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default function QuoteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [paymentFormOpen, setPaymentFormOpen] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  // Convert-to-plan inline form — only relevant once a quote is past
  // accepted/complete/paid. Local state so opening the form doesn't carry
  // any persisted draft across navigations.
  const [convertFormOpen, setConvertFormOpen] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  // Tracks whether the customer opted into recurring on the public Accept
  // page. We persist this via a sentinel prefix in the notes column to avoid
  // a schema change — see the recurring_requested helper below.
  // const recurringRequested computed inline below.

  const { data: quote, isLoading } = useQuery({
    queryKey: ["quote", id],
    queryFn: async () => {
      if (!id) throw new Error("Missing id");
      const { data, error } = await supabase
        .from("quotes")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as QuoteRow | null;
    },
    enabled: !!id,
  });

  // Manual payments already logged against this quote. Drives the
  // cumulative-total check that decides whether to prompt the operator to
  // flip status → 'paid' (or 'accepted' once a deposit threshold is hit).
  const { data: manualPayments } = useQuery({
    queryKey: ["quote-manual-payments", id],
    queryFn: async () => (id ? listManualPaymentsForQuote(id) : []),
    enabled: !!id,
  });

  const { data: views } = useQuery({
    queryKey: ["quote-views", id],
    queryFn: async () => {
      if (!id) return [];
      const { data, error } = await supabase
        .from("quote_views")
        .select("*")
        .eq("quote_id", id)
        .order("viewed_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as QuoteViewRow[];
    },
    enabled: !!id,
  });

  // Parse the JSONB lines column into the operator-side line shape. Older
  // PressurePro rows are normalized to qty/rate so the editor still works.
  const lines = useMemo<QuoteLine[]>(
    () => (quote ? parseLines(quote.lines) : []),
    [quote],
  );

  const update = useMutation({
    mutationFn: async (patch: QuoteUpdate) => {
      if (!id) throw new Error("Missing id");
      const { error } = await supabase
        .from("quotes")
        .update(patch)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quote", id] });
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
    },
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : "Update failed"),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("Missing id");
      const { error } = await supabase.from("quotes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      navigate("/quotes");
    },
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : "Delete failed"),
  });

  // Manual-payment mutation for the quote. After save we check cumulative
  // recorded payments against the quote's total / deposit_amount and prompt
  // the operator (window.confirm — per spec, no toast lib) to flip status
  // accordingly. The status flip is OPT-IN — the operator may have other
  // reasons to keep it as draft/sent (e.g. partial deposit + work pending).
  const recordPaymentMutation = useMutation({
    mutationFn: async (args: {
      method: ManualPaymentMethod;
      amountCents: number;
      checkNumber: string | null;
    }) => {
      if (!id || !quote) throw new Error("Missing quote");
      const inserted = await recordPayment({
        quote_id: id,
        customer_id: quote.customer_id ?? null,
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
        queryKey: ["quote-manual-payments", id],
      });
      // Compute cumulative INCLUDING the newly inserted row — query may
      // not have refetched yet, so add it locally.
      const prior = (manualPayments ?? []).reduce(
        (s, p) => s + (p.status === "voided" ? 0 : p.amount_cents),
        0,
      );
      const cumulativeCents = prior + inserted.amount_cents;
      if (!quote) return;
      const totalCents = Math.round(Number(quote.total ?? 0) * 100);
      const depositCents = quote.deposit_amount
        ? Math.round(Number(quote.deposit_amount) * 100)
        : 0;
      // Already paid in full -> offer to flip status to 'paid'.
      if (totalCents > 0 && cumulativeCents >= totalCents) {
        if (quote.status !== "paid") {
          if (window.confirm(
            "Cumulative payments meet the quote total. Mark this quote as paid?",
          )) {
            update.mutate({ status: "paid" });
          }
        }
      } else if (
        depositCents > 0 &&
        cumulativeCents >= depositCents &&
        quote.status === "draft"
      ) {
        // Deposit covered while still in draft — offer to flip to accepted.
        if (window.confirm(
          "Deposit covered. Mark this quote as accepted?",
        )) {
          update.mutate({ status: "accepted" });
        }
      }
    },
    onError: (err) =>
      setPaymentError(err instanceof Error ? err.message : "Couldn't save payment"),
  });

  // Convert-to-plan: hands off to the convert-quote-to-plan edge function.
  // The function clones quote line items into the maintenance_plans.services
  // array and uses the quote total as `amount` per visit. We don't go
  // through Stripe in v1 — the plan lands with status='active' and the
  // operator collects a card later from PlanDetail if/when they want
  // automated billing.
  const convertToPlanMutation = useMutation({
    mutationFn: async (args: {
      frequency: "weekly" | "biweekly" | "monthly";
      day_of_week: number;
      interval_months: 3 | 6 | 12;
      start_date: string;
    }) => {
      if (!id || !quote) throw new Error("Missing quote");
      const { data, error } = await supabase.functions.invoke(
        "convert-quote-to-plan",
        {
          body: {
            quote_id: id,
            mode: "standalone" as const,
            frequency: args.frequency,
            day_of_week: args.day_of_week,
            interval_months: args.interval_months,
            start_date: args.start_date,
          },
        },
      );
      if (error) throw error;
      const ack = data as { ok?: boolean; plan_id?: string; error?: string } | null;
      if (!ack?.ok || !ack.plan_id) {
        throw new Error(ack?.error ?? "Couldn't convert quote to plan");
      }
      return ack.plan_id;
    },
    onSuccess: (planId: string) => {
      setConvertFormOpen(false);
      setConvertError(null);
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      queryClient.invalidateQueries({ queryKey: ["quote", id] });
      // Land the operator straight on the new plan page so they can review
      // services and (optionally) take a card later. PlanDetail is the
      // canonical surface for plan-level edits.
      navigate(`/plans/${planId}`);
    },
    onError: (err) =>
      setConvertError(err instanceof Error ? err.message : "Conversion failed"),
  });

  if (isLoading) {
    return <div className="pt-6 px-[22px] text-sm text-ink-500">Loading…</div>;
  }
  if (!quote) {
    return (
      <div className="pt-6 px-[22px]">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-sm text-ink-500 inline-flex items-center gap-1.5 mb-3"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="tp-card p-5 text-sm text-ink-700">Quote not found.</div>
      </div>
    );
  }

  const total = Number(quote.total ?? 0);
  const depositPercent =
    quote.deposit_amount && total > 0
      ? Math.round((Number(quote.deposit_amount) / total) * 100)
      : 0;
  const expiresIso = quote.expires_at
    ? quote.expires_at.slice(0, 10)
    : "";

  // True once the customer has finished signing — these are the statuses
  // where converting to a recurring plan makes sense. Drafts and "sent"
  // quotes are still in negotiation, so we don't show the CTA there.
  const isConvertEligible =
    quote.status === "accepted" ||
    quote.status === "complete" ||
    quote.status === "paid";
  // The Accept page writes "Recurring requested: " as a sentinel prefix
  // into notes when the customer ticks the opt-in. We highlight the
  // CTA in that case so the operator sees the upsell signal at a glance.
  const recurringRequested =
    typeof quote.notes === "string" &&
    quote.notes.includes(RECURRING_REQUESTED_SENTINEL);

  // Send / Resend handler — flips status + emailed_at optimistically and
  // fires the quote_send email (and SMS if a phone is on file). Sends are
  // fire-and-forget: a transport failure is logged to email_log/sms_log
  // and surfaced inline, but we don't roll back the status flip.
  const handleSend = () => {
    setActionError(null);
    if (!quote) return;
    update.mutate(
      { status: "sent", emailed_at: new Date().toISOString() },
      {
        onSuccess: async () => {
          if (quote.customer_email) {
            const r = await sendQuote(quote.id);
            if (!r.ok) {
              setActionError(
                `Status updated, but email send failed: ${r.error ?? "unknown"}`,
              );
            }
          }
          if (quote.phone) {
            const r = await sendQuoteSms(quote.id);
            if (!r.ok && !r.deferred) {
              setActionError((prev) =>
                prev
                  ? `${prev}; SMS: ${r.error ?? "unknown"}`
                  : `Status updated, but SMS failed: ${r.error ?? "unknown"}`,
              );
            }
          }
        },
      },
    );
  };

  const handleStatus = (status: QuoteStatus) => {
    setActionError(null);
    update.mutate({ status });
  };

  const handleCancel = () => {
    if (!window.confirm("Cancel this quote? It will be moved back to draft and flagged in the notes.")) {
      return;
    }
    // TODO: schema has no 'canceled' status. We prepend a "Canceled: " marker
    // to notes and set status back to draft so it falls out of "open" totals.
    const prefix = "Canceled: ";
    const notes = quote.notes && quote.notes.startsWith(prefix)
      ? quote.notes
      : `${prefix}${quote.notes ?? ""}`.trim();
    update.mutate({ status: "draft", notes });
  };

  const handleDelete = () => {
    if (!window.confirm("Delete this quote? This cannot be undone.")) return;
    remove.mutate();
  };

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/accept/${quote.id}`;
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
    window.open(`/accept/${quote.id}/print`, "_blank", "noopener");
  };

  // ──────────────────────────────────────────────────────────────────────
  // Edit mode — same form layout as NewQuote, preserves status.
  if (editing) {
    return (
      <div className="pt-3">
        <header className="px-[22px] pb-[18px] flex items-center gap-3">
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="h-9 w-9 rounded-full border border-ink-200 bg-card flex items-center justify-center"
            aria-label="Cancel edit"
          >
            <ArrowLeft className="h-4 w-4 text-ink-700" strokeWidth={2} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium tracking-[0.4px] uppercase text-ink-500">
              Edit quote
            </div>
            <h1 className="tp-display text-2xl font-bold text-ink-900 mt-0.5 truncate">
              {quote.customer_name}
            </h1>
          </div>
        </header>

        <QuoteForm
          submitMode="edit"
          busy={update.isPending}
          error={actionError}
          initial={{
            customer_id: quote.customer_id ?? "",
            property_id: quote.property_id ?? "",
            customer_name: quote.customer_name,
            phone: quote.phone,
            customer_email: quote.customer_email ?? "",
            address: quote.address,
            lines,
            notes: quote.notes ?? "",
            deposit_percent: depositPercent,
            expires_at: expiresIso,
          }}
          onCancel={() => setEditing(false)}
          onSubmit={(values) => {
            setActionError(null);
            const newTotal = quoteTotal(values.lines);
            const depositAmount =
              values.deposit_percent > 0
                ? Math.round(newTotal * (values.deposit_percent / 100) * 100) / 100
                : null;
            update.mutate(
              {
                customer_id: values.customer_id || null,
                property_id: values.property_id || null,
                customer_name: values.customer_name,
                phone: values.phone,
                customer_email: values.customer_email || null,
                address: values.address,
                lines: values.lines as unknown as Json,
                total: newTotal,
                deposit_amount: depositAmount,
                notes: values.notes || null,
                expires_at: values.expires_at
                  ? new Date(values.expires_at).toISOString()
                  : null,
              },
              {
                onSuccess: () => setEditing(false),
              },
            );
          }}
        />
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Read view.
  return (
    <div className="pt-3">
      {/* Header */}
      <header className="px-[22px] pb-3">
        <button
          type="button"
          onClick={() => navigate("/quotes")}
          className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.4px] uppercase text-ink-500 mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Quotes
        </button>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold tracking-[0.4px] uppercase text-bronze-600">
              Quote · #{quote.id.slice(0, 4).toUpperCase()}
            </div>
            <h1 className="tp-display text-[26px] font-bold text-ink-900 mt-0.5 leading-tight truncate">
              {quote.customer_name}
            </h1>
            {quote.address && (
              <div className="text-sm text-ink-500 mt-1 truncate">
                {quote.address}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="h-10 px-3.5 rounded-[14px] border border-ink-200 bg-card text-ink-700 text-sm font-semibold inline-flex items-center gap-1.5"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={2} /> Edit
          </button>
        </div>
      </header>

      {/* Status + total summary card */}
      <section className="mx-4 mb-3">
        <div className="rounded-[18px] bg-gradient-hero-deep text-white p-[18px] relative overflow-hidden">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-[10px] font-semibold tracking-[1px] uppercase text-bronze-400">
              Quote total
            </div>
            <span
              className={cn(
                "px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-[0.4px]",
                STATUS_PILL[quote.status],
              )}
            >
              {quote.status}
            </span>
          </div>
          <div className="tp-display tp-num text-[38px] font-bold leading-none">
            {fmtUSD(total)}
          </div>
          <div className="text-white/70 text-[12px] mt-2 tp-num">
            {lines.length} line{lines.length === 1 ? "" : "s"}
            {quote.deposit_amount && Number(quote.deposit_amount) > 0
              ? ` · ${fmtUSD(Number(quote.deposit_amount))} deposit`
              : ""}
            {quote.emailed_at ? ` · sent ${fmtDateTime(quote.emailed_at)}` : ""}
          </div>
          {quote.expires_at && (
            <div className="text-bronze-400 text-[11px] mt-1 tp-num">
              Expires {new Date(quote.expires_at).toLocaleDateString()}
            </div>
          )}
        </div>
      </section>

      {/* Primary actions */}
      <section className="mx-4 mb-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={handleSend}
          disabled={update.isPending}
          className="rounded-[14px] bg-bronze-500 text-white font-bold text-[13px] py-3 shadow-bronze hover:bg-bronze-600 transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
        >
          {update.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          {quote.status === "draft" ? "Send" : "Resend"}
        </button>
        <button
          type="button"
          onClick={handlePrint}
          className="rounded-[14px] border border-ink-200 bg-card text-ink-700 font-semibold text-[13px] py-3 hover:bg-ink-100 transition-colors inline-flex items-center justify-center gap-1.5"
        >
          <Printer className="h-3.5 w-3.5" />
          Print
        </button>
        <button
          type="button"
          onClick={handleCopyLink}
          className="rounded-[14px] border border-ink-200 bg-card text-ink-700 font-semibold text-[13px] py-3 hover:bg-ink-100 transition-colors inline-flex items-center justify-center gap-1.5"
        >
          {copyState === "copied" ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-green-700" />
              Copied
            </>
          ) : (
            <>
              <LinkIcon className="h-3.5 w-3.5" />
              Copy public link
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setPaymentError(null);
            setPaymentFormOpen((v) => !v);
          }}
          className={cn(
            "rounded-[14px] border font-semibold text-[13px] py-3 inline-flex items-center justify-center gap-1.5 transition-colors",
            paymentFormOpen
              ? "bg-bronze-100 border-bronze-400 text-bronze-700"
              : "bg-card border-bronze-400 text-bronze-700 hover:bg-bronze-50",
          )}
        >
          <DollarSign className="h-3.5 w-3.5" />
          {paymentFormOpen ? "Close payment" : "Record payment"}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={update.isPending}
          className="rounded-[14px] border border-ink-200 bg-card text-destructive font-semibold text-[13px] py-3 hover:bg-destructive/5 transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
        >
          <X className="h-3.5 w-3.5" /> Cancel quote
        </button>
        {/* Convert-to-plan CTA — only meaningful once the quote is past
            negotiation. Highlighted (bronze fill) when the customer ticked
            the recurring opt-in on the public Accept page. */}
        {isConvertEligible && (
          <button
            type="button"
            onClick={() => {
              setConvertError(null);
              setConvertFormOpen((v) => !v);
            }}
            className={cn(
              "col-span-2 rounded-[14px] font-bold text-[13px] py-3 inline-flex items-center justify-center gap-1.5 transition-colors",
              recurringRequested
                ? "bg-green-800 text-white hover:bg-green-700 shadow-bronze"
                : "border border-green-800 bg-card text-green-800 hover:bg-green-50",
            )}
          >
            <Repeat className="h-3.5 w-3.5" />
            {convertFormOpen
              ? "Close conversion"
              : recurringRequested
                ? "Convert to plan (customer requested)"
                : "Convert to plan"}
          </button>
        )}
      </section>

      {/* Inline conversion form — shows below the actions grid when open.
          Submits to the convert-quote-to-plan edge function and navigates
          to /plans/{id} on success. */}
      {convertFormOpen && (
        <section className="mx-4 mb-3">
          <ConvertToPlanForm
            submitting={convertToPlanMutation.isPending}
            error={convertError}
            onCancel={() => {
              setConvertFormOpen(false);
              setConvertError(null);
            }}
            onSubmit={(values) => convertToPlanMutation.mutate(values)}
          />
        </section>
      )}

      {/* Inline manual-payment form + cumulative-payments summary. Shows the
          running paid total against the quote's amount/deposit so the
          operator knows where they stand before saving the next payment. */}
      {paymentFormOpen && (
        <section className="mx-4 mb-3">
          <QuoteManualPaymentForm
            defaultAmount={Math.max(
              0,
              Number(quote.total ?? 0) -
                (manualPayments ?? []).reduce(
                  (s, p) =>
                    s + (p.status === "voided" ? 0 : p.amount_cents / 100),
                  0,
                ),
            )}
            submitting={recordPaymentMutation.isPending}
            error={paymentError}
            onCancel={() => {
              setPaymentFormOpen(false);
              setPaymentError(null);
            }}
            onSubmit={(values) => recordPaymentMutation.mutate(values)}
          />
        </section>
      )}

      {/* Recorded payments list — visible whenever any manual payment
          exists. Keeps the operator's mental model honest about how much
          has actually been collected against the quote. */}
      {(manualPayments?.length ?? 0) > 0 && (
        <section className="mx-4 mb-3">
          <ManualPaymentsList
            payments={manualPayments ?? []}
            quoteTotal={Number(quote.total ?? 0)}
          />
        </section>
      )}

      {/* Lifecycle overrides — operators often close a quote offline. */}
      <section className="mx-4 mb-4">
        <div className="tp-card p-3">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-ink-500 mb-2">
            Mark status
          </div>
          <div className="grid grid-cols-3 gap-2">
            <StatusButton
              label="Accepted"
              tone="text-green-700"
              active={quote.status === "accepted"}
              onClick={() => handleStatus("accepted")}
              disabled={update.isPending}
            />
            <StatusButton
              label="Complete"
              tone="text-green-500"
              active={quote.status === "complete"}
              onClick={() => handleStatus("complete")}
              disabled={update.isPending}
            />
            <StatusButton
              label="Paid"
              tone="text-green-800"
              active={quote.status === "paid"}
              onClick={() => handleStatus("paid")}
              disabled={update.isPending}
            />
          </div>
        </div>
      </section>

      {/* Line items */}
      <section className="mx-4 mb-3">
        <div className="flex items-center justify-between px-1 pb-2">
          <h2 className="tp-display text-[15px] font-bold text-ink-900">
            Line items
          </h2>
        </div>
        {lines.length === 0 ? (
          <div className="tp-card p-4 text-sm text-ink-500">
            No line items.
          </div>
        ) : (
          <ul className="space-y-2">
            {lines.map((l) => (
              <li
                key={l.id}
                className="tp-card p-3 flex items-center gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm text-ink-900 truncate">
                    {l.name}
                  </div>
                  <div className="text-[11px] text-ink-500 tp-num mt-0.5">
                    {l.qty} × {fmtUSD(l.rate)}
                  </div>
                </div>
                <div className="tp-num font-bold text-sm text-ink-900 shrink-0">
                  {fmtUSD(l.total)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Notes */}
      {quote.notes && (
        <section className="mx-4 mb-3">
          <div className="tp-card p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.4px] text-ink-500 mb-1">
              Notes
            </div>
            <p className="text-sm text-ink-700 whitespace-pre-wrap">
              {quote.notes}
            </p>
          </div>
        </section>
      )}

      {/* Recent views — read-only audit trail */}
      <section className="mx-4 mb-3">
        <div className="flex items-center justify-between px-1 pb-2">
          <h2 className="tp-display text-[15px] font-bold text-ink-900 inline-flex items-center gap-1.5">
            <Eye className="h-4 w-4 text-bronze-600" strokeWidth={2.2} />
            Recent views
            <span className="text-ink-500 font-semibold text-xs ml-0.5">
              ({views?.length ?? 0})
            </span>
          </h2>
        </div>
        {!views || views.length === 0 ? (
          <div className="tp-card p-4 text-sm text-ink-500">
            No views yet. Once the customer opens the public link, each open is
            logged here.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {views.map((v) => (
              <li
                key={v.id}
                className="tp-card p-3 flex items-start justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink-900 tp-num">
                    {fmtDateTime(v.viewed_at)}
                  </div>
                  {v.user_agent && (
                    <div className="text-[11px] text-ink-500 truncate mt-0.5">
                      {v.user_agent}
                    </div>
                  )}
                </div>
                {v.referrer && (
                  <div className="text-[11px] text-ink-500 truncate max-w-[40%]">
                    {v.referrer}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Error toast — minimal, matches NewPlan's inline pattern. */}
      {actionError && (
        <div className="mx-4 mb-3 rounded-xl bg-[hsl(var(--destructive-bg))] text-destructive text-[12.5px] font-semibold p-3">
          {actionError}
        </div>
      )}

      <button
        type="button"
        onClick={handleDelete}
        disabled={remove.isPending}
        className="mx-4 mt-1 mb-6 w-[calc(100%-2rem)] text-destructive text-sm font-semibold py-3 flex items-center justify-center gap-2 disabled:opacity-60"
      >
        <Trash2 className="h-4 w-4" /> Delete quote
      </button>
    </div>
  );
}

function StatusButton({
  label,
  active,
  tone,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  tone: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "py-2 rounded-[12px] text-[12px] font-semibold transition-colors border",
        active
          ? "border-green-800 bg-green-800 text-white"
          : `border-ink-200 bg-card ${tone} hover:bg-ink-100`,
        disabled && "opacity-60",
      )}
    >
      {label}
    </button>
  );
}

// =====================================================================
// ConvertToPlanForm — inline form for turning an accepted/complete/paid
// quote into a maintenance plan. Mirrors the relevant NewPlan fields
// (frequency, day-of-week, billing cadence, start date) without dragging
// in customer/property pickers — those come from the source quote row
// server-side. Same control vocabulary as NewPlan so operators don't
// have to relearn anything.
// =====================================================================
const CONVERT_DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const CONVERT_FREQ_OPTIONS = [
  { key: "weekly" as const, label: "Weekly" },
  { key: "biweekly" as const, label: "Biweekly" },
  { key: "monthly" as const, label: "Monthly" },
];
const CONVERT_BILLING_OPTIONS = [
  { months: 3 as const, label: "Quarterly" },
  { months: 6 as const, label: "Every 6 mo" },
  { months: 12 as const, label: "Yearly" },
];

function ConvertToPlanForm({
  submitting,
  error,
  onCancel,
  onSubmit,
}: {
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: {
    frequency: "weekly" | "biweekly" | "monthly";
    day_of_week: number;
    interval_months: 3 | 6 | 12;
    start_date: string;
  }) => void;
}) {
  // Defaults align with NewPlan's defaults — weekly + Wednesday + quarterly
  // billing — and a start date one week out so the operator has a buffer
  // to confirm the homeowner before the first visit.
  const [frequency, setFrequency] = useState<"weekly" | "biweekly" | "monthly">(
    "weekly",
  );
  const [dayOfWeek, setDayOfWeek] = useState<number>(3);
  const [intervalMonths, setIntervalMonths] = useState<3 | 6 | 12>(3);
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });

  return (
    <div className="tp-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-ink-900 inline-flex items-center gap-1.5">
          <Repeat className="h-4 w-4 text-green-800" strokeWidth={2.2} />
          Convert to plan
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-[12px] font-semibold text-ink-500 hover:text-ink-700"
        >
          Cancel
        </button>
      </div>

      <p className="text-[11.5px] text-ink-500 leading-snug">
        We'll create a maintenance plan using the quote's line items and total.
        You can collect a card later from the plan page.
      </p>

      <div>
        <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-ink-500 mb-1.5">
          Service frequency
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {CONVERT_FREQ_OPTIONS.map((f) => {
            const on = frequency === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFrequency(f.key)}
                className={cn(
                  "py-2 rounded-xl text-[12px] font-semibold transition-colors border",
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
          Route day
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {CONVERT_DAY_LABEL.map((label, i) => {
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

      <div>
        <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-ink-500 mb-1.5">
          Billing cadence
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {CONVERT_BILLING_OPTIONS.map((b) => {
            const on = intervalMonths === b.months;
            return (
              <button
                key={b.months}
                type="button"
                onClick={() => setIntervalMonths(b.months)}
                className={cn(
                  "py-2 rounded-xl text-[12px] font-semibold transition-colors border",
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
      </div>

      <div>
        <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-ink-500 mb-1.5">
          Start date
        </div>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="w-full px-3 py-2.5 rounded-xl border border-ink-200 bg-card text-ink-900 text-sm focus:outline-none focus:border-green-800"
        />
      </div>

      {error && (
        <div className="rounded-xl bg-[hsl(var(--destructive-bg))] text-destructive text-[12.5px] font-semibold p-3">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={() =>
          onSubmit({
            frequency,
            day_of_week: dayOfWeek,
            interval_months: intervalMonths,
            start_date: startDate,
          })
        }
        disabled={submitting || !startDate}
        className="w-full rounded-full bg-green-800 text-white font-bold text-[14px] py-3 hover:bg-green-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
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

// =====================================================================
// QuoteManualPaymentForm — inline cash/check intake against a quote.
// Same shape as the PlanDetail variant; kept local so the two pages can
// drift independently if quote/plan UX requirements diverge.
// =====================================================================
const QUOTE_METHODS: ManualPaymentMethod[] = [
  "cash",
  "check",
  "venmo",
  "cashapp",
  "zelle",
  "other",
];

function QuoteManualPaymentForm({
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
    defaultAmount > 0 ? defaultAmount.toFixed(2) : "",
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
    <div className="tp-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-ink-900">
          Record payment
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-[12px] font-semibold text-ink-500 hover:text-ink-700"
        >
          Cancel
        </button>
      </div>

      <div>
        <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-ink-500 mb-1.5">
          Method
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {QUOTE_METHODS.map((m) => {
            const on = method === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={cn(
                  "py-2 rounded-xl text-[12px] font-semibold transition-colors border",
                  on
                    ? "border-bronze-500 bg-bronze-500 text-white"
                    : "border-ink-200 bg-card text-ink-700 hover:border-bronze-400",
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
          <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-ink-500 mb-1.5">
            Amount
          </div>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-ink-200 bg-card text-ink-900 text-sm focus:outline-none focus:border-green-800"
          />
        </div>
        {method === "check" && (
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-ink-500 mb-1.5">
              Check #
            </div>
            <input
              type="text"
              value={checkNumber}
              onChange={(e) => setCheckNumber(e.target.value)}
              placeholder="optional"
              className="w-full px-3 py-2.5 rounded-xl border border-ink-200 bg-card text-ink-900 text-sm focus:outline-none focus:border-green-800"
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
        className="w-full rounded-full bg-bronze-500 text-white font-bold text-[14px] py-3 shadow-bronze hover:bg-bronze-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Check className="h-4 w-4" />
        )}
        Save payment
      </button>
    </div>
  );
}

// =====================================================================
// ManualPaymentsList — recorded payment history for the quote, plus the
// running cumulative total so the operator can see at-a-glance how much of
// the quote total has been collected offline.
// =====================================================================
function ManualPaymentsList({
  payments,
  quoteTotal,
}: {
  payments: ManualPayment[];
  quoteTotal: number;
}) {
  const cumulative = payments.reduce(
    (s, p) => s + (p.status === "voided" ? 0 : p.amount_cents / 100),
    0,
  );
  const remaining = Math.max(0, quoteTotal - cumulative);
  return (
    <div className="tp-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[14px] font-semibold text-ink-900 inline-flex items-center gap-1.5">
          <DollarSign className="h-4 w-4 text-bronze-600" strokeWidth={2.2} />
          Recorded payments
        </h2>
        <div className="text-[11px] text-ink-500 tp-num">
          <span className="font-semibold text-ink-900">{fmtUSD(cumulative)}</span>
          {quoteTotal > 0 && (
            <span className="ml-1.5">
              of {fmtUSD(quoteTotal)} ·{" "}
              {remaining > 0 ? `${fmtUSD(remaining)} remaining` : "paid in full"}
            </span>
          )}
        </div>
      </div>
      <ul className="divide-y divide-ink-200">
        {payments.map((p) => (
          <li key={p.id} className="py-2.5 flex items-center justify-between text-[13px]">
            <span className="text-ink-700">
              {new Date(p.received_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
            <span className="tp-num font-semibold text-ink-900">
              {fmtUSD(p.amount_cents / 100)}
            </span>
            <span className="px-2 py-[2px] rounded-full text-[10.5px] font-bold uppercase tracking-[0.4px] bg-bronze-100 text-bronze-700">
              {METHOD_LABEL[p.method]}
              {p.check_number ? ` #${p.check_number}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
