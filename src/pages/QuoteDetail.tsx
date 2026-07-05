import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  FileText,
  Link as LinkIcon,
  Loader2,
  Pencil,
  Printer,
  Send,
  Trash2,
  Files,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";
import QuoteForm from "@/components/quotes/QuoteForm";
import { parseLines, quoteTotal, type QuoteLine } from "@/components/quotes/types";
import { getInvoiceByQuote, formatInvoiceNumber } from "@/lib/invoices";
import { publicAppOrigin } from "@/lib/public-url";
import { sendQuote } from "@/lib/customer-email";
import { sendQuoteSms } from "@/lib/customer-sms";
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

const STATUS_PILL: Record<QuoteStatus, string> = {
  draft:     "bg-neutral-100 text-neutral-700",
  sent:      "bg-accent-100 text-accent-700",
  accepted:  "bg-brand-100 text-brand-800",
  scheduled: "bg-brand-100 text-brand-800",
  complete:  "bg-brand-100 text-brand-800",
  paid:      "bg-brand-100 text-brand-800",
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

  // Resolve the invoice generated from this quote (if any). Post-acceptance
  // operator actions — recording payments, marking complete/paid, converting
  // to a plan — all live on the invoice now, so we surface a prominent
  // "View invoice" link once the invoice exists.
  const { data: invoice } = useQuery({
    queryKey: ["invoice-by-quote", id],
    queryFn: async () => (id ? getInvoiceByQuote(id) : null),
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

  if (isLoading) {
    return <div className="pt-6 px-[22px] text-sm text-neutral-500">Loading…</div>;
  }
  if (!quote) {
    return (
      <div className="pt-6 px-[22px]">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-sm text-neutral-500 inline-flex items-center gap-1.5 mb-3"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="tp-card p-5 text-sm text-neutral-700">Quote not found.</div>
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

  // Once the quote is accepted (or an invoice already exists), the
  // post-acceptance workflow — recording payments, marking complete/paid,
  // converting to a plan — moves to the invoice. We surface a prominent
  // "View invoice" link instead of those inline controls. We treat the
  // resolved invoice query as the source of truth, falling back to the
  // accepted/complete/paid statuses (or a persisted quotes.invoice_id) so
  // the link shows even before the invoice query resolves.
  const quoteInvoiceId =
    (quote as { invoice_id?: string | null }).invoice_id ?? null;
  const showInvoiceLink =
    !!invoice ||
    !!quoteInvoiceId ||
    quote.status === "accepted" ||
    quote.status === "complete" ||
    quote.status === "paid";

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
    const url = `${publicAppOrigin()}/accept/${quote.id}`;
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
            className="h-9 w-9 rounded-full border border-neutral-200 bg-card flex items-center justify-center"
            aria-label="Cancel edit"
          >
            <ArrowLeft className="h-4 w-4 text-neutral-700" strokeWidth={2} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium tracking-[0.4px] uppercase text-neutral-500">
              Edit quote
            </div>
            <h1 className="tp-display text-2xl font-bold text-neutral-900 mt-0.5 truncate">
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
          className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.4px] uppercase text-neutral-500 mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Quotes
        </button>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold tracking-[0.4px] uppercase text-accent-600">
              Quote · #{quote.id.slice(0, 4).toUpperCase()}
            </div>
            <h1 className="tp-display text-[26px] font-bold text-neutral-900 mt-0.5 leading-tight truncate">
              {quote.customer_name}
            </h1>
            {quote.address && (
              <div className="text-sm text-neutral-500 mt-1 truncate">
                {quote.address}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="h-10 px-3.5 rounded-[14px] border border-neutral-200 bg-card text-neutral-700 text-sm font-semibold inline-flex items-center gap-1.5"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={2} /> Edit
          </button>
        </div>
      </header>

      {/* Status + total summary card */}
      <section className="mx-4 mb-3">
        <div className="rounded-[18px] bg-gradient-hero-deep text-white p-[18px] relative overflow-hidden">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-[10px] font-semibold tracking-[1px] uppercase text-accent-400">
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
            <div className="text-accent-400 text-[11px] mt-1 tp-num">
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
          className="rounded-[14px] bg-accent-500 text-white font-bold text-[13px] py-3 shadow-accent hover:bg-accent-600 transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
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
          className="rounded-[14px] border border-neutral-200 bg-card text-neutral-700 font-semibold text-[13px] py-3 hover:bg-neutral-100 transition-colors inline-flex items-center justify-center gap-1.5"
        >
          <Printer className="h-3.5 w-3.5" />
          Print
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
              Copy public link
            </>
          )}
        </button>
        <button
          type="button"
          onClick={handleDuplicate}
          disabled={duplicateQuote.isPending}
          className="rounded-[14px] border border-neutral-200 bg-card text-neutral-700 font-semibold text-[13px] py-3 hover:bg-neutral-100 transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
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
          className="rounded-[14px] border border-neutral-200 bg-card text-destructive font-semibold text-[13px] py-3 hover:bg-destructive/5 transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
        >
          <X className="h-3.5 w-3.5" /> Cancel quote
        </button>
      </section>

      {/* View invoice — the post-acceptance workflow (payments, marking
          complete/paid, converting to a plan) lives on the invoice. Once the
          quote is accepted or an invoice exists, point the operator there. */}
      {showInvoiceLink && (
        <section className="mx-4 mb-3">
          {invoice ? (
            <Link
              to={`/invoices/${invoice.id}`}
              className="w-full rounded-[14px] bg-brand-800 text-white font-bold text-[14px] py-3.5 shadow-accent hover:bg-brand-700 transition-colors inline-flex items-center justify-center gap-2"
            >
              <FileText className="h-4 w-4" />
              View invoice {formatInvoiceNumber(invoice.invoice_number)}
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <div className="tp-card p-3 flex items-center gap-2 text-[12.5px] text-neutral-600">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />
              Preparing invoice…
            </div>
          )}
        </section>
      )}

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
            <div className="text-[12px] font-semibold text-neutral-700">
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

      {/* Line items */}
      <section className="mx-4 mb-3">
        <div className="flex items-center justify-between px-1 pb-2">
          <h2 className="tp-display text-[15px] font-bold text-neutral-900">
            Line items
          </h2>
        </div>
        {lines.length === 0 ? (
          <div className="tp-card p-4 text-sm text-neutral-500">
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
                  <div className="font-semibold text-sm text-neutral-900 truncate">
                    {l.name}
                  </div>
                  <div className="text-[11px] text-neutral-500 tp-num mt-0.5">
                    {l.qty} × {fmtUSD(l.rate)}
                  </div>
                </div>
                <div className="tp-num font-bold text-sm text-neutral-900 shrink-0">
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
            <div className="text-[10px] font-bold uppercase tracking-[0.4px] text-neutral-500 mb-1">
              Notes
            </div>
            <p className="text-sm text-neutral-700 whitespace-pre-wrap">
              {quote.notes}
            </p>
          </div>
        </section>
      )}

      {/* Recent views — read-only audit trail */}
      <section className="mx-4 mb-3">
        <div className="flex items-center justify-between px-1 pb-2">
          <h2 className="tp-display text-[15px] font-bold text-neutral-900 inline-flex items-center gap-1.5">
            <Eye className="h-4 w-4 text-accent-600" strokeWidth={2.2} />
            Recent views
            <span className="text-neutral-500 font-semibold text-xs ml-0.5">
              ({views?.length ?? 0})
            </span>
          </h2>
        </div>
        {!views || views.length === 0 ? (
          <div className="tp-card p-4 text-sm text-neutral-500">
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
                  <div className="text-sm font-semibold text-neutral-900 tp-num">
                    {fmtDateTime(v.viewed_at)}
                  </div>
                  {v.user_agent && (
                    <div className="text-[11px] text-neutral-500 truncate mt-0.5">
                      {v.user_agent}
                    </div>
                  )}
                </div>
                {v.referrer && (
                  <div className="text-[11px] text-neutral-500 truncate max-w-[40%]">
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
