import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Printer } from "lucide-react";

// Customer-facing printable quote. Auto-opens the print dialog so any
// modern browser's "Save as PDF" is the de-facto PDF generator with zero
// bundle weight. Service-agnostic — works for mow / cleanup / aeration /
// fert / anything else in the TurfPro catalog.

interface QuoteLine {
  id?: string;
  name?: string;
  label?: string;
  custom?: boolean;
  qty?: number;
  rate?: number;
  total?: number;
  area_sqft?: number;
  surface?: string;
  sqft?: number;
  mode?: string;
}

type PrintQuote = {
  id: string;
  customer_name: string;
  customer_email: string | null;
  phone: string;
  address: string;
  lines: QuoteLine[];
  notes: string | null;
  total: number | null;
  deposit_amount: number | null;
  created_at: string;
  expires_at: string | null;
  recurring_months: number | null;
  user_id: string;
};

type Business = {
  business: string;
  phone: string;
};

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const lineLabel = (l: QuoteLine): string => {
  if (l.custom && l.label) return l.label;
  if (l.name) return l.name;
  if (l.label) return l.label;
  if (l.surface) return l.surface.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return "Service";
};

const lineQty = (l: QuoteLine): string => {
  if (l.area_sqft) return `${l.area_sqft.toLocaleString()} sqft`;
  if (l.sqft) return `${l.sqft.toLocaleString()} sqft`;
  if (typeof l.qty === "number") return String(l.qty);
  return "1";
};

const lineRate = (l: QuoteLine): string => {
  if (typeof l.rate === "number") return `$${l.rate.toFixed(2)}`;
  return "—";
};

const lineAmount = (l: QuoteLine): number => {
  if (typeof l.total === "number") return l.total;
  if (typeof l.rate === "number" && typeof l.qty === "number") return l.rate * l.qty;
  if (typeof l.rate === "number" && typeof l.sqft === "number") return l.rate * l.sqft;
  return 0;
};

const QuotePrint = () => {
  const { id } = useParams();
  const [q, setQ] = useState<PrintQuote | null>(null);
  const [biz, setBiz] = useState<Business>({ business: "", phone: "" });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data } = await supabase
        .from("quotes")
        .select(
          "id,customer_name,customer_email,phone,address,lines,notes,total,deposit_amount,created_at,expires_at,recurring_months,user_id",
        )
        .eq("id", id)
        .maybeSingle();
      if (!data) {
        setLoading(false);
        return;
      }
      const quote = data as unknown as PrintQuote;
      setQ(quote);
      const { data: prof } = await supabase.rpc("public_business_info", {
        p_user_id: quote.user_id,
      });
      const row = prof?.[0];
      if (row) {
        setBiz({
          business: row.business_name ?? "",
          phone: row.phone ?? "",
        });
      }
      setLoading(false);
    })();
  }, [id]);

  // Auto-open the print dialog once content has rendered.
  useEffect(() => {
    if (loading || !q) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [loading, q]);

  const total = useMemo(() => {
    if (!q) return 0;
    if (typeof q.total === "number" && q.total > 0) return q.total;
    return (q.lines ?? []).reduce((s, l) => s + lineAmount(l), 0);
  }, [q]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-green-800" />
      </div>
    );
  }

  if (!q) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div>
          <h1 className="font-display text-2xl">Quote not found</h1>
        </div>
      </div>
    );
  }

  const created = new Date(q.created_at).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const validUntil = q.expires_at
    ? new Date(q.expires_at).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="quote-print min-h-screen bg-white text-black">
      {/* Print stylesheet — keeps non-print noise off the paper. */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          @page { margin: 0.6in; }
        }
        .quote-print { font-family: ui-sans-serif, system-ui, sans-serif; }
        .quote-print h1 { font-weight: 800; }
        .quote-print .brand { color: #1a4d2e; }
        .quote-print table { width: 100%; border-collapse: collapse; }
        .quote-print thead th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #555; border-bottom: 1px solid #ddd; padding: 8px 6px; }
        .quote-print tbody td { padding: 10px 6px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
        .quote-print tfoot td { padding: 12px 6px; font-weight: 700; }
      `}</style>

      <div className="no-print fixed top-3 right-3 z-50">
        <button
          onClick={() => window.print()}
          className="bg-green-800 text-white rounded-xl px-4 py-2 text-sm font-bold flex items-center gap-2 shadow"
        >
          <Printer className="h-4 w-4" /> Print / Save PDF
        </button>
      </div>

      <main className="max-w-3xl mx-auto p-8 md:p-12">
        <header className="flex items-start justify-between gap-6 pb-6 border-b border-neutral-200">
          <div>
            <div className="text-xs uppercase tracking-widest text-neutral-500 font-bold">
              Quote
            </div>
            <h1 className="text-3xl mt-1 brand">{biz.business || "Lawn Care"}</h1>
            <div className="text-sm text-neutral-600 mt-1 leading-relaxed">
              {biz.phone && <div>{biz.phone}</div>}
              <div className="text-xs uppercase tracking-widest mt-1 text-neutral-400 font-bold">
                Powered by TurfPro
              </div>
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="font-semibold">Quote #{q.id.slice(0, 8)}</div>
            <div className="text-neutral-600">Issued {created}</div>
            {validUntil && (
              <div className="text-neutral-600">Valid until {validUntil}</div>
            )}
          </div>
        </header>

        <section className="mt-6">
          <div className="text-xs uppercase tracking-widest text-neutral-500 font-bold">
            Prepared for
          </div>
          <div className="mt-1 font-semibold text-lg">{q.customer_name}</div>
          <div className="text-sm text-neutral-700">{q.address}</div>
          <div className="text-sm text-neutral-600 mt-1">
            {q.phone && <span>{q.phone}</span>}
            {q.phone && q.customer_email && <span> · </span>}
            {q.customer_email && <span>{q.customer_email}</span>}
          </div>
        </section>

        <section className="mt-8">
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th style={{ width: "20%", textAlign: "right" }}>Qty</th>
                <th style={{ width: "20%", textAlign: "right" }}>Rate</th>
                <th style={{ width: "20%", textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {(q.lines ?? []).map((l, i) => (
                <tr key={l.id ?? i}>
                  <td>
                    <div className="font-semibold">{lineLabel(l)}</div>
                  </td>
                  <td style={{ textAlign: "right" }}>{lineQty(l)}</td>
                  <td style={{ textAlign: "right" }}>{lineRate(l)}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>
                    {fmtUSD(lineAmount(l))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {q.deposit_amount != null && q.deposit_amount > 0 && (
                <tr>
                  <td colSpan={3} style={{ textAlign: "right", fontWeight: 500 }}>
                    Deposit due on approval
                  </td>
                  <td style={{ textAlign: "right" }}>{fmtUSD(q.deposit_amount)}</td>
                </tr>
              )}
              <tr>
                <td colSpan={3} style={{ textAlign: "right" }}>
                  Total
                </td>
                <td style={{ textAlign: "right", fontSize: "20px" }}>{fmtUSD(total)}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        {q.recurring_months && (
          <section className="mt-6 p-4 rounded-lg border border-neutral-200 bg-neutral-50 text-sm">
            <div className="font-semibold">Recommended recurring service</div>
            <div className="text-neutral-700 mt-0.5">
              We'll keep the lawn on schedule every {q.recurring_months} months.
            </div>
          </section>
        )}

        {q.notes && (
          <section className="mt-6">
            <div className="text-xs uppercase tracking-widest text-neutral-500 font-bold">
              Notes
            </div>
            <p className="text-sm text-neutral-700 mt-1 whitespace-pre-wrap">{q.notes}</p>
          </section>
        )}

        <footer className="mt-12 pt-6 border-t border-neutral-200 text-xs text-neutral-500 text-center">
          Thank you for the opportunity to quote your lawn.
        </footer>
      </main>
    </div>
  );
};

export default QuotePrint;
