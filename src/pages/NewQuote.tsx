import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Database, Json } from "@/integrations/supabase/types";
import QuoteForm, { type QuoteFormValues } from "@/components/quotes/QuoteForm";
import { quoteTotal } from "@/components/quotes/types";

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

      // TODO: when action === "send", wire send-customer-email with kind:
      // 'quote_send'. Adding the email kind crosses the email agent's
      // namespace, so we just flip status -> 'sent' and rely on the
      // operator's own channel (or QuoteDetail's Resend) for now.

      const insert: QuoteInsert = {
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
      };

      const { data, error } = await supabase
        .from("quotes")
        .insert(insert)
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
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
