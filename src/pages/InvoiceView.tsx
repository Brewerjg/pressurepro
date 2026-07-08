import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getStripeEnvironment } from "@/lib/stripe";
import {
  Loader2,
  Printer,
  CreditCard,
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";
import { BrandHeader } from "@/components/public/BrandHeader";
import { getInvoiceByToken, formatInvoiceNumber, type Invoice } from "@/lib/invoices";
import { parseLines, describe, type QuoteLine } from "@/components/quotes/types";
import { vertical } from "@/vertical";

// Customer-facing PUBLIC invoice (no auth). Resolved by invoices.public_token
// via getInvoiceByToken (the anon supabase client reads it through the public
// RLS policy). Mirrors the /accept presentation: green brand hero, total,
// line items, and — when a balance remains and Stripe is wired — a "Pay
// balance" button that drops the customer into Stripe Checkout.
//
// Amount-paid is derived only from what's publicly readable on the invoice
// row itself: a 'paid' status means the balance is settled, and
// deposit_paid_at means the deposit has been collected. We deliberately do
// NOT read manual_payments here (RLS scopes those to the operator), so the
// public "amount due" is the conservative total − (deposit if paid).

interface BusinessInfo {
  business: string;
  phone: string;
}

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const InvoiceView = () => {
  const { token } = useParams<{ token: string }>();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [business, setBusiness] = useState<BusinessInfo>({ business: "", phone: "" });
  const [loading, setLoading] = useState(true);
  const [payLoading, setPayLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
          setBusiness({ business: row.business_name ?? "", phone: row.phone ?? "" });
        }
      } catch {
        // Fall through to the not-found state below.
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-brand-800" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div>
          <h1 className="font-display text-2xl">Invoice not found</h1>
          <p className="text-muted-foreground text-sm mt-1">
            The link may have expired.
          </p>
        </div>
      </div>
    );
  }

  const lines: QuoteLine[] = parseLines(invoice.lines);
  const total = Number(invoice.total ?? 0);
  const isPaid = invoice.status === "paid";
  const isVoid = invoice.status === "void";
  const isComplete = !!invoice.completed_at;
  const depositPaid = !!invoice.deposit_paid_at;
  const depositAmount = Number(invoice.deposit_amount ?? 0);

  // Conservative public derivation: a paid invoice owes nothing; otherwise the
  // only publicly-known payment is a collected deposit.
  const amountPaid = isPaid ? total : depositPaid ? Math.min(depositAmount, total) : 0;
  const amountDue = Math.max(0, total - amountPaid);
  const hasBalance = !isVoid && !isPaid && amountDue > 0;

  // The deposit edge-function path keys off the quote (it hydrates the
  // amount + invoice_id from the quote). When a deposit hasn't been paid yet
  // we collect the deposit; once it has, the remaining balance is collected.
  const payKind: "deposit" | "balance" =
    depositAmount > 0 && !depositPaid ? "deposit" : "balance";

  const firstName = (invoice.customer_name || "").split(" ")[0];
  const issued = new Date(invoice.issued_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const payBalance = async () => {
    setErrorMsg(null);
    setPayLoading(true);
    try {
      // Mirror how Accept.tsx invokes the checkout function — the edge
      // function hydrates the amount, operator, and invoice_id from the
      // quote linked to this invoice.
      const { data, error } = await supabase.functions.invoke(
        "create-checkout-session",
        {
          body: {
            quote_id: invoice.quote_id,
            kind: payKind,
            returnUrl: `${window.location.origin}/invoice/${token}?paid=1`,
            environment: getStripeEnvironment(),
          },
        },
      );
      if (error) throw error;
      const url = (data as { url?: string })?.url;
      if (!url) throw new Error("Couldn't start payment. Please try again.");
      window.location.href = url;
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Couldn't start payment.");
    } finally {
      setPayLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <BrandHeader business={business.business}>
        <div className="font-mono text-[11px] font-bold tracking-[0.12em] text-accent-400">
          {formatInvoiceNumber(invoice.invoice_number)} · {issued.toUpperCase()}
        </div>
        <h1 className="font-display text-[30px] text-white mt-1.5">
          Hi {firstName || "there"},
        </h1>
        <p className="text-white/75 text-sm mt-1.5">
          {invoice.address
            ? `Here's your invoice for ${invoice.address}.`
            : "Here's your invoice."}
        </p>
        <div className="mt-5">
          <div className="tp-display tp-num text-[64px] leading-none text-accent-400 font-extrabold">
            {fmtUSD(isVoid ? total : amountDue)}
          </div>
          <div className="text-white/70 text-xs mt-1.5">
            {isVoid
              ? "This invoice has been voided."
              : isPaid
                ? "Paid in full — thank you!"
                : amountDue < total
                  ? `${fmtUSD(amountPaid)} paid · ${fmtUSD(amountDue)} due`
                  : "Amount due"}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          {isPaid && (
            <span className="px-2.5 py-1 rounded-full bg-success text-success-foreground text-[11px] font-bold uppercase tracking-wider">
              Paid
            </span>
          )}
          {isComplete && (
            <span className="px-2.5 py-1 rounded-full bg-accent-500 text-brand-900 text-[11px] font-bold uppercase tracking-wider">
              Work complete
            </span>
          )}
          {isVoid && (
            <span className="px-2.5 py-1 rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold uppercase tracking-wider">
              Void
            </span>
          )}
        </div>
      </BrandHeader>

      <main className="max-w-md mx-auto px-4 pt-5">
        {/* Line items */}
        <section>
          <h2 className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground mb-2.5">
            Your invoice
          </h2>
          <div className="tp-card p-0 overflow-hidden">
            {lines.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">No line items.</div>
            )}
            {lines.map((l, i) => {
              const d = describe(l);
              return (
                <div
                  key={l.id ?? i}
                  className={
                    "flex items-center gap-2.5 p-3.5 " +
                    (i ? "border-t border-hairline" : "")
                  }
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm text-neutral-900">{d.label}</div>
                    {d.detail && (
                      <div className="text-[11px] text-muted-foreground mt-0.5 tp-num">
                        {d.detail}
                      </div>
                    )}
                  </div>
                  <span className="tp-num font-bold text-sm text-neutral-900">
                    {fmtUSD(d.amount)}
                  </span>
                </div>
              );
            })}
            <div className="border-t border-hairline p-3.5 flex items-center justify-between bg-brand-50">
              <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-brand-800">
                Total
              </div>
              <div className="tp-num font-extrabold text-base text-brand-900">
                {fmtUSD(total)}
              </div>
            </div>
            {amountPaid > 0 && !isPaid && (
              <div className="border-t border-hairline p-3.5 flex items-center justify-between">
                <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
                  Paid
                </div>
                <div className="tp-num font-bold text-sm text-neutral-900">
                  −{fmtUSD(amountPaid)}
                </div>
              </div>
            )}
            {hasBalance && (
              <div className="border-t border-hairline p-3.5 flex items-center justify-between bg-brand-50">
                <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-brand-800">
                  Balance due
                </div>
                <div className="tp-num font-extrabold text-base text-brand-900">
                  {fmtUSD(amountDue)}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Pay deposit — the only online card path wired today. (Collecting a
            full remaining balance by card isn't implemented yet; see the
            balance note below.) */}
        {hasBalance && payKind === "deposit" && (
          <section className="mt-5">
            <h2 className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground mb-2.5">
              Reserve your spot
            </h2>
            <div className="tp-card p-4">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-sm font-bold text-neutral-900">Deposit</span>
                <span className="tp-num font-extrabold text-lg text-brand-900">
                  {fmtUSD(depositAmount)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                A small deposit holds your spot on our route. The balance is due
                after the work is done.
              </p>
              <button
                onClick={payBalance}
                disabled={payLoading}
                className="w-full h-12 rounded-2xl bg-brand-800 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.98] transition-transform"
              >
                {payLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CreditCard className="h-4 w-4" />
                )}
                Pay deposit
              </button>
              {errorMsg && (
                <p className="mt-2 text-xs text-destructive text-center">{errorMsg}</p>
              )}
            </div>
          </section>
        )}

        {/* Pay the remaining balance by card. */}
        {hasBalance && payKind === "balance" && (
          <section className="mt-5">
            <h2 className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground mb-2.5">
              Pay your balance
            </h2>
            <div className="tp-card p-4">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-sm font-bold text-neutral-900">Balance due</span>
                <span className="tp-num font-extrabold text-lg text-brand-900">
                  {fmtUSD(amountDue)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Pay securely by card. Your payment goes straight to your service
                provider.
              </p>
              <button
                onClick={payBalance}
                disabled={payLoading}
                className="w-full h-12 rounded-2xl bg-brand-800 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.98] transition-transform"
              >
                {payLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CreditCard className="h-4 w-4" />
                )}
                Pay balance
              </button>
              {errorMsg && (
                <p className="mt-2 text-xs text-destructive text-center">{errorMsg}</p>
              )}
            </div>
          </section>
        )}

        {/* Paid confirmation */}
        {isPaid && (
          <section className="tp-card p-4 mt-5 flex items-start gap-3 border-success bg-[hsl(var(--success-bg))]">
            <div className="h-10 w-10 rounded-xl bg-success text-success-foreground flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="text-sm">
              <div className="font-extrabold text-neutral-900">Paid in full</div>
              <div className="text-muted-foreground text-xs mt-0.5">
                Thanks{firstName ? `, ${firstName}` : ""} — we appreciate your
                business.
              </div>
            </div>
          </section>
        )}

        {/* Deposit received (balance still outstanding) */}
        {!isPaid && depositPaid && depositAmount > 0 && (
          <section className="tp-card p-3.5 mt-4 text-sm text-brand-800 font-bold flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Deposit received — you're on the
            route.
          </section>
        )}

        <div className="grid grid-cols-1 gap-2 mt-4">
          <a
            href={`/invoice/${token}/print`}
            target="_blank"
            rel="noopener"
            className="h-12 rounded-[14px] border-[1.5px] border-border bg-card text-foreground font-bold text-sm flex items-center justify-center gap-2"
          >
            <Printer className="h-4 w-4" /> Save PDF
          </a>
        </div>

        <div className="text-center text-[11px] text-muted-foreground pt-6 pb-10">
          Powered by <span className="font-semibold text-brand-800">{vertical.brand.name}</span>
        </div>
      </main>
    </div>
  );
};

export default InvoiceView;
