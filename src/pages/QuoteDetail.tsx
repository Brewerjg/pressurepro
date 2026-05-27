import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  Link as LinkIcon,
  Loader2,
  Pencil,
  Printer,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";
import QuoteForm, { type QuoteFormValues } from "@/components/quotes/QuoteForm";
import { parseLines, quoteTotal, type QuoteLine } from "@/components/quotes/types";

// QuoteDetail — read view + edit toggle + lifecycle actions. The operator
// usually lands here from the list, glances at the status pill, and either
// resends or marks the row through to paid. Print and public-link actions
// piggyback on the already-shipped /accept and /accept/:id/print pages.

type QuoteRow = Database["public"]["Tables"]["quotes"]["Row"];
type QuoteUpdate = Database["public"]["Tables"]["quotes"]["Update"];
type QuoteStatus = Database["public"]["Enums"]["quote_status"];
type QuoteViewRow = Database["public"]["Tables"]["quote_views"]["Row"];

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

  // Send / Resend handler. See TODO below — we currently just flip status
  // and set emailed_at; wiring an actual `quote_send` email template lives
  // in the email agent's territory.
  const handleSend = () => {
    setActionError(null);
    // TODO: wire send-customer-email with kind: 'quote_send' once the
    // email agent adds that template kind. For now we just mark the row
    // as sent so the status pill reflects reality — operators frequently
    // send via their own channel (text, in-person link) and just want
    // TurfPro to show "sent".
    update.mutate({
      status: "sent",
      emailed_at: new Date().toISOString(),
    });
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
          onClick={handleCancel}
          disabled={update.isPending}
          className="rounded-[14px] border border-ink-200 bg-card text-destructive font-semibold text-[13px] py-3 hover:bg-destructive/5 transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
        >
          <X className="h-3.5 w-3.5" /> Cancel quote
        </button>
      </section>

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
