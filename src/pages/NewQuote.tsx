import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Database, Json } from "@/integrations/supabase/types";
import QuoteForm, { type QuoteFormValues } from "@/components/quotes/QuoteForm";
import { quoteTotal } from "@/components/quotes/types";
import { sendQuote } from "@/lib/customer-email";
import { sendQuoteSms } from "@/lib/customer-sms";
import { RESEND_ENABLED, TWILIO_ENABLED } from "@/lib/feature-flags";
import { APP_ID } from "@/lib/app-context";

// NewQuote — the operator-side "author a quote" page. Routed at /quotes/new.
// Accepts ?customer=<id> so CustomerDetail can deep-link with a prefilled
// customer (QuoteForm also auto-picks the only-property in that case).

type QuoteInsert = Database["public"]["Tables"]["quotes"]["Insert"];

export default function NewQuote() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const preselectCustomer = params.get("customer");

  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async ({
      values,
      action,
    }: {
      values: QuoteFormValues;
      action: "draft" | "send" | "save";
    }) => {
      if (!user) throw new Error("Not signed in");
      if (!values.customer_id) throw new Error("Pick a customer");
      if (values.lines.length === 0) {
        throw new Error("Add at least one line item");
      }

      const total = quoteTotal(values.lines);
      const depositAmount =
        values.deposit_percent > 0
          ? Math.round(total * (values.deposit_percent / 100) * 100) / 100
          : null;

      const status: Database["public"]["Enums"]["quote_status"] =
        action === "send" ? "sent" : "draft";

      // `app` field added in migration 0022; generated types may not include
      // it yet — cast through Insert via a widened object.
      const insert = {
        user_id: user.id,
        customer_id: values.customer_id || null,
        property_id: values.property_id || null,
        customer_name: values.customer_name,
        phone: values.phone,
        customer_email: values.customer_email || null,
        address: values.address,
        lines: values.lines as unknown as Json,
        total,
        deposit_amount: depositAmount,
        notes: values.notes || null,
        expires_at: values.expires_at
          ? new Date(values.expires_at).toISOString()
          : null,
        status,
        emailed_at: action === "send" ? new Date().toISOString() : null,
        app: APP_ID,
      } as unknown as QuoteInsert;

      const { data, error } = await supabase
        .from("quotes")
        .insert(insert)
        .select("id")
        .single();
      if (error) throw error;
      const quoteId = data.id as string;

      // Fire-and-forget customer comms when the operator picked "Send".
      // We don't roll back the row on a send failure — the status pill
      // reflects what the operator chose to do; an email/SMS hiccup is
      // logged in email_log and surfaced in the inline error.
      //
      // Both email (Resend) and SMS (Twilio) auto-sends are now gated
      // behind their respective feature flags. The default flow lands
      // the operator on QuoteDetail (via the onSuccess navigate) where
      // <MessageCustomerButton> lets them send via their own Messages
      // and Mail apps.
      if (action === "send") {
        if (RESEND_ENABLED && values.customer_email) {
          const r = await sendQuote(quoteId);
          if (!r.ok) {
            console.warn("sendQuote failed:", r.error);
          }
        }
        if (TWILIO_ENABLED && values.phone) {
          const r = await sendQuoteSms(quoteId);
          if (!r.ok && !r.deferred) {
            console.warn("sendQuoteSms failed:", r.error);
          }
        }
      }
      return quoteId;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      navigate(`/quotes/${id}`);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Couldn't save quote");
    },
  });

  return (
    <div className="pt-3">
      {/* Header */}
      <header className="px-[22px] pb-[18px] flex items-center gap-3">
        <Link
          to="/quotes"
          className="h-9 w-9 rounded-full border border-ink-200 bg-card flex items-center justify-center"
          aria-label="Back to quotes"
        >
          <ArrowLeft className="h-4 w-4 text-ink-700" strokeWidth={2} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium tracking-[0.4px] uppercase text-ink-500">
            One-off job
          </div>
          <h1 className="tp-display text-2xl font-bold text-ink-900 mt-0.5">
            New quote
          </h1>
        </div>
      </header>

      <QuoteForm
        submitMode="create"
        preselectCustomerId={preselectCustomer}
        busy={create.isPending}
        error={error}
        onCancel={() => navigate("/quotes")}
        onSubmit={(values, action) => {
          setError(null);
          create.mutate({ values, action });
        }}
      />
    </div>
  );
}
