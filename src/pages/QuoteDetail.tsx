import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Ban,
  Check,
  CheckCircle2,
  DollarSign,
  Eye,
  Link as LinkIcon,
  Loader2,
  Pencil,
  Plus,
  Printer,
  Repeat,
  Send,
  Trash2,
  Files,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";
import QuoteForm, { type QuoteFormValues } from "@/components/quotes/QuoteForm";
import { parseLines, quoteTotal, type QuoteLine } from "@/components/quotes/types";
import {
  deriveInitialLineItems,
  suggestFrequency,
  type PlanLineItem,
} from "@/components/quotes/convertHelpers";
import {
  listManualPaymentsForQuote,
  recordPayment,
  type ManualPayment,
  type ManualPaymentMethod,
  METHOD_LABEL,
} from "@/lib/manual-payments";
import { sendQuote, sendPlanConfirmation } from "@/lib/customer-email";
import { sendQuoteSms, sendPlanConfirmationSms } from "@/lib/customer-sms";
import MessageCustomerButton from "@/components/messaging/MessageCustomerButton";
import { APP_ID } from "@/lib/app-context";
import { RESEND_ENABLED, TWILIO_ENABLED } from "@/lib/feature-flags";

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

  // Catalog services for the convert-to-plan editor. Same shape as NewPlan
  // uses for its catalog quick-pick chips, scoped to non-archived services.
  // `default_rate` lets us auto-bump the convert form's per-visit rate when
  // the operator clicks a catalog chip — so adding "Trim $10" actually moves
  // the billing total, instead of just adding a label.
  const { data: catalog } = useQuery({
    queryKey: ["catalog", "service"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_items")
        .select("id, name, sort_order, default_rate")
        .eq("app", APP_ID)
        .eq("kind", "service")
        .eq("archived", false)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; sort_order: number; default_rate: number | null }>;
    },
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

  // Duplicate the current quote into a fresh draft. Carries over customer,
  // property, lines, total, recurring_months, deposit, notes (with sentinels
  // stripped) — resets id, status (back to 'draft'), created_at (DB default),
  // expires_at (14 days from today), portal_token (DB default), plan_id,
  // emailed_at, and view-counters. The operator lands on the new quote in
  // its detail view and can edit anything (including the date) before sending.
  const duplicateQuote = useMutation({
    mutationFn: async (): Promise<string> => {
      if (!quote) throw new Error("Missing source quote");

      // Strip sentinels we use on notes for internal state — they shouldn't
      // bleed into the duplicate. Order matters: longest match first.
      let cleanedNotes: string | null = quote.notes;
      if (cleanedNotes) {
        cleanedNotes = cleanedNotes
          .replace(/^\s*\[recurring_requested\]\s*/i, "")
          .replace(/^\s*Canceled:\s*/i, "")
          .trim();
        if (!cleanedNotes) cleanedNotes = null;
      }

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 14);

      const insertPayload = {
        user_id: quote.user_id,
        app: APP_ID,
        customer_id: quote.customer_id,
        property_id: quote.property_id,
        customer_name: quote.customer_name,
        phone: quote.phone,
        customer_email: quote.customer_email,
        address: quote.address,
        lines: quote.lines,
        total: quote.total,
        deposit_amount: quote.deposit_amount,
        recurring_months: quote.recurring_months,
        notes: cleanedNotes,
        expires_at: expiresAt.toISOString(),
        status: "draft" as QuoteStatus,
      };

      const { data, error } = await supabase
        .from("quotes")
        .insert(insertPayload)
        .select("id")
        .single();
      if (error) throw error;
      if (!data?.id) throw new Error("Insert returned no id");
      return data.id as string;
    },
    onSuccess: (newId) => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      navigate(`/quotes/${newId}`);
    },
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : "Duplicate failed"),
  });

  const handleDuplicate = () => {
    if (!quote) return;
    if (!window.confirm(
      "Duplicate this quote? A fresh draft will be created with today's date " +
      "and a 14-day expiry. You'll land on the new quote to edit before sending.",
    )) return;
    duplicateQuote.mutate();
  };

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
  // The function clones the operator's selected services into the new
  // maintenance_plans row and uses per_visit_rate as `amount` per visit. We
  // don't take payment here in v1 — the plan lands with status='active' and
  // the operator can collect a card later from PlanDetail (or, if they
  // checked "text the customer a save-card link", we kick off the plan
  // confirmation email + SMS from this client right after success).
  const convertToPlanMutation = useMutation({
    mutationFn: async (args: {
      services: string[];
      per_visit_rate: number;
      frequency: "weekly" | "biweekly" | "monthly" | "fert_program";
      day_of_week: number;
      interval_months: 1 | 3 | 6 | 12;
      start_date: string;
      send_card_link: boolean;
    }) => {
      if (!id || !quote) throw new Error("Missing quote");
      const { data, error } = await supabase.functions.invoke(
        "convert-quote-to-plan",
        {
          body: {
            quote_id: id,
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
      const ack = data as {
        ok?: boolean;
        plan_id?: string;
        error?: string;
        field?: string;
      } | null;
      if (!ack?.ok || !ack.plan_id) {
        throw new Error(ack?.error ?? "Couldn't convert quote to plan");
      }
      return { planId: ack.plan_id, sendCardLink: args.send_card_link };
    },
    onSuccess: ({ planId, sendCardLink }) => {
      setConvertFormOpen(false);
      setConvertError(null);
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      queryClient.invalidateQueries({ queryKey: ["quote", id] });
      // Fire the "save your card" link in the background. Both email
      // (Resend) and SMS (Twilio) auto-sends are now gated behind their
      // respective feature flags — by default the operator sends both
      // channels from their own apps via the <MessageCustomerButton>
      // rendered in the success banner below.
      if (sendCardLink && quote) {
        const recipientName = quote.customer_name ?? undefined;
        if (RESEND_ENABLED && quote.customer_email) {
          void sendPlanConfirmation(
            planId,
            { email: quote.customer_email, name: recipientName },
            quote.customer_id ?? null,
          );
        }
        if (TWILIO_ENABLED && quote.phone) {
          void sendPlanConfirmationSms(
            planId,
            { phone: quote.phone, name: recipientName },
            quote.customer_id ?? null,
          );
        }
      }
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

  // Send / Resend handler — flips status + emailed_at optimistically.
  // Both the Resend email auto-send and the Twilio SMS auto-send are
  // gated behind their respective feature flags. By default the operator
  // sends both channels from their own apps via the
  // <MessageCustomerButton> in the actions grid below. Sends are
  // fire-and-forget: a transport failure is logged to email_log/sms_log
  // and surfaced inline, but we don't roll back the status flip.
  const handleSend = () => {
    setActionError(null);
    if (!quote) return;
    update.mutate(
      { status: "sent", emailed_at: new Date().toISOString() },
      {
        onSuccess: async () => {
          if (RESEND_ENABLED && quote.customer_email) {
            const r = await sendQuote(quote.id);
            if (!r.ok) {
              setActionError(
                `Status updated, but email send failed: ${r.error ?? "unknown"}`,
              );
            }
          }
          if (TWILIO_ENABLED && quote.phone) {
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
          onClick={handleDuplicate}
          disabled={duplicateQuote.isPending}
          className="rounded-[14px] border border-ink-200 bg-card text-ink-700 font-semibold text-[13px] py-3 hover:bg-ink-100 transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
        >
          {duplicateQuote.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Files className="h-3.5 w-3.5" />
          )}
          Duplicate
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

      {/* Operator-driven SMS + email via sms:/mailto: deep-links.
          Renders alongside the "Send / Resend" CTA so the operator can
          send the public accept link from their own Messages or Mail
          app without the Twilio + Resend overhead. Hidden only when
          BOTH auto-send paths are enabled (since then the auto-pipe is
          doing the work) AND the customer has neither phone nor email
          (we still render with copy-only otherwise). */}
      {(!TWILIO_ENABLED || !RESEND_ENABLED) && (
        <section className="mx-4 mb-3">
          <div className="tp-card p-3 flex flex-col gap-2">
            <div className="text-[12px] font-semibold text-ink-700">
              Send the quote link from your phone or mail app
            </div>
            <MessageCustomerButton
              kind="quote_send"
              quoteId={quote.id}
              variant="secondary"
              label="Message customer the quote link"
            />
          </div>
        </section>
      )}

      {/* Inline conversion form — shows below the actions grid when open.
          Submits to the convert-quote-to-plan edge function and navigates
          to /plans/{id} on success. */}
      {convertFormOpen && (
        <section className="mx-4 mb-3">
          <ConvertToPlanForm
            submitting={convertToPlanMutation.isPending}
            error={convertError}
            initialLineItems={deriveInitialLineItems(lines)}
            catalog={catalog ?? []}
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

function ConvertToPlanForm({
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
