import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Printer } from "lucide-react";
import { getInvoiceByToken, formatInvoiceNumber, type Invoice } from "@/lib/invoices";
import { parseLines, type QuoteLine } from "@/components/quotes/types";

// Customer-facing printable invoice. Resolved by invoices.public_token (no
// auth). Auto-opens the print dialog so any modern browser's "Save as PDF"
// is the de-facto PDF generator with zero bundle weight. Mirrors the
// QuotePrint presentation so quote + invoice paperwork match.

interface Business {
  business: string;
  phone: string;
}

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const lineQty = (l: QuoteLine): string => {
  if (typeof l.qty === "number") return String(l.qty);
  return "1";
};

const lineRate = (l: QuoteLine): string => {
  if (typeof l.rate === "number") return `$${l.rate.toFixed(2)}`;
  return "—";
};

const InvoicePrint = () => {
  const { token } = useParams<{ token: string }>();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [biz, setBiz] = useState<Business>({ business: "", phone: "" });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        // Public lookup by public_token — anon read allowed by RLS policy.
        const inv = await getInvoiceByToken(token);
        if (!inv) {
          setLoading(false);
          return;
        }
        setInvoice(inv);
        const { data: prof } = await supabase.rpc("public_business_info", {
          p_user_id: inv.user_id,
        });
        const row = prof?.[0];
        if (row) {
          setBiz({ business: row.business_name ?? "", phone: row.phone ?? "" });
        }
      } catch {
        // Fall through to not-found.
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  // Auto-open the print dialog once content has rendered.
  useEffect(() => {
    if (loading || !invoice) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [loading, invoice]);

  const lines = useMemo<QuoteLine[]>(
    () => (invoice ? parseLines(invoice.lines) : []),
    [invoice],
  );

  const total = useMemo(() => {
    if (!invoice) return 0;
    if (typeof invoice.total === "number" && invoice.total > 0) return invoice.total;
    return lines.reduce((s, l) => s + l.total, 0);
  }, [invoice, lines]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-brand-800" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div>
          <h1 className="font-display text-2xl">Invoice not found</h1>
        </div>
      </div>
    );
  }

  const issued = new Date(invoice.issued_at).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const isPaid = invoice.status === "paid";
  const isVoid = invoice.status === "void";
  const depositPaid = !!invoice.deposit_paid_at;
  const depositAmount = Number(invoice.deposit_amount ?? 0);
  const amountPaid = isPaid
    ? total
    : depositPaid
      ? Math.min(depositAmount, total)
      : 0;
  const amountDue = Math.max(0, total - amountPaid);

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
          className="bg-brand-800 text-white rounded-xl px-4 py-2 text-sm font-bold flex items-center gap-2 shadow"
        >
          <Printer className="h-4 w-4" /> Print / Save PDF
        </button>
      </div>

      <main className="max-w-3xl mx-auto p-8 md:p-12">
        <header className="flex items-start justify-between gap-6 pb-6 border-b border-neutral-200">
          <div>
            <div className="text-xs uppercase tracking-widest text-neutral-500 font-bold">
              Invoice
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
            <div className="font-semibold">
              {formatInvoiceNumber(invoice.invoice_number)}
            </div>
            <div className="text-neutral-600">Issued {issued}</div>
            {isPaid && <div className="text-brand-700 font-semibold">Paid in full</div>}
            {isVoid && <div className="text-red-600 font-semibold">Void</div>}
          </div>
        </header>

        <section className="mt-6">
          <div className="text-xs uppercase tracking-widest text-neutral-500 font-bold">
            Billed to
          </div>
          <div className="mt-1 font-semibold text-lg">{invoice.customer_name}</div>
          {invoice.address && (
            <div className="text-sm text-neutral-700">{invoice.address}</div>
          )}
          <div className="text-sm text-neutral-600 mt-1">
            {invoice.phone && <span>{invoice.phone}</span>}
            {invoice.phone && invoice.customer_email && <span> · </span>}
            {invoice.customer_email && <span>{invoice.customer_email}</span>}
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
              {lines.map((l, i) => (
                <tr key={l.id ?? i}>
                  <td>
                    <div className="font-semibold">{l.name}</div>
                  </td>
                  <td style={{ textAlign: "right" }}>{lineQty(l)}</td>
                  <td style={{ textAlign: "right" }}>{lineRate(l)}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>
                    {fmtUSD(l.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ textAlign: "right" }}>
                  Total
                </td>
                <td style={{ textAlign: "right", fontSize: "20px" }}>
                  {fmtUSD(total)}
                </td>
              </tr>
              {amountPaid > 0 && !isPaid && (
                <tr>
                  <td colSpan={3} style={{ textAlign: "right", fontWeight: 500 }}>
                    Paid
                  </td>
                  <td style={{ textAlign: "right" }}>−{fmtUSD(amountPaid)}</td>
                </tr>
              )}
              {!isPaid && !isVoid && amountDue > 0 && (
                <tr>
                  <td colSpan={3} style={{ textAlign: "right" }}>
                    Balance due
                  </td>
                  <td style={{ textAlign: "right", fontSize: "20px" }}>
                    {fmtUSD(amountDue)}
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        </section>

        <footer className="mt-12 pt-6 border-t border-neutral-200 text-xs text-neutral-500 text-center">
          {isPaid
            ? "Thank you — this invoice has been paid in full."
            : "Thank you for your business."}
        </footer>
      </main>
    </div>
  );
};

export default InvoicePrint;
