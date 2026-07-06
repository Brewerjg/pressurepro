import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getStripeEnvironment } from "@/lib/stripe";
import { Check, Phone, Loader2, Printer, ShieldCheck, Repeat, CreditCard } from "lucide-react";
import { BrandHeader } from "@/components/public/BrandHeader";
import { parseLines, describe, quoteTotal } from "@/components/quotes/types";

interface PublicQuote {
  id: string;
  customer_name: string;
  address: string;
  lines: unknown;
  status: string;
  recurring_months: number | null;
  total: number;
  deposit_amount: number | null;
  deposit_paid_at: string | null;
  expires_at: string | null;
  user_id: string;
  view_count: number | null;
}

interface BusinessInfo {
  business: string;
  phone: string;
}

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const MIN_NAME_CHARS = 2;
const MAX_NAME_CHARS = 120;
function validateName(input: string): { ok: boolean; value: string; reason: string } {
  const collapsed = input.trim().replace(/\s+/g, " ");
  if (collapsed.length === 0) return { ok: false, value: "", reason: "Type your name to sign." };
  if (collapsed.length < MIN_NAME_CHARS) return { ok: false, value: collapsed, reason: "Name is too short." };
  if (collapsed.length > MAX_NAME_CHARS) return { ok: false, value: collapsed, reason: "Name is too long." };
  if (!/[a-zA-Z]/.test(collapsed)) return { ok: false, value: collapsed, reason: "Type your name (letters required)." };
  return { ok: true, value: collapsed, reason: "" };
}

// Sentinel that QuoteDetail keys off to flag "customer wants recurring".
// We piggyback on the notes column to avoid a new schema migration; the
// operator's original notes are preserved verbatim after the sentinel.
const RECURRING_REQUESTED_SENTINEL = "[recurring_requested]";

const Accept = () => {
  const { id } = useParams();
  const [q, setQ] = useState<PublicQuote | null>(null);
  const [business, setBusiness] = useState<BusinessInfo>({ business: "", phone: "" });
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [signedName, setSignedName] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [payLoading, setPayLoading] = useState(false);
  // Customer's opt-in for recurring service. Surfaces after the quote is
  // accepted — the operator sees the request on QuoteDetail and uses the
  // Convert-to-plan CTA to actually mint the maintenance_plans row.
  const [recurringRequested, setRecurringRequested] = useState(false);
  const [recurringSaving, setRecurringSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      // Public lookup by UUID — app discriminator intentionally not filtered (see app-context.ts)
      const { data } = await supabase
        .from("quotes")
        .select(
          "id,customer_name,address,lines,status,recurring_months,total,deposit_amount,deposit_paid_at,expires_at,user_id,view_count,created_at",
        )
        .eq("id", id)
        .maybeSingle();
      if (!data) { setLoading(false); return; }
      const quote = data as unknown as PublicQuote;
      setQ(quote);

      const { data: prof } = await supabase.rpc("public_business_info", {
        p_user_id: quote.user_id,
      });
      const row = prof?.[0];
      if (row) setBusiness({ business: row.business_name ?? "", phone: row.phone ?? "" });

      // Best-effort view audit — RLS may block; ignore failures.
      await supabase.from("quote_views").insert({
        quote_id: id,
        user_agent: navigator.userAgent.slice(0, 500),
        referrer: document.referrer.slice(0, 500) || null,
      } as never);
      // Public update by UUID — app discriminator intentionally not filtered (see app-context.ts)
      await supabase
        .from("quotes")
        .update({
          viewed_at: new Date().toISOString(),
          view_count: (quote.view_count ?? 0) + 1,
        } as never)
        .eq("id", id);

      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-brand-800" />
      </div>
    );
  }

  if (!q) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div>
          <h1 className="font-display text-2xl">Quote not found</h1>
          <p className="text-muted-foreground text-sm mt-1">The link may have expired.</p>
        </div>
      </div>
    );
  }

  const isExpired =
    q.status === "expired" ||
    (q.expires_at !== null && new Date(q.expires_at).getTime() < Date.now());

  const accept = async () => {
    setErrorMsg(null);
    if (isExpired) {
      setErrorMsg("This quote has expired — please contact us for a new one.");
      return;
    }
    const validation = validateName(signedName);
    if (!validation.ok) {
      setErrorMsg(validation.reason);
      return;
    }
    setAccepting(true);
    try {
      // Prefer the shared edge function (records IP, sends notification).
      // Fall back to a direct insert + status update if the function isn't
      // available — keeps the public flow working in dev.
      const { data, error } = await supabase.functions.invoke("record-acceptance", {
        body: { quote_id: q.id, signed_name: validation.value },
      });
      if (error) throw error;
      const ack = data as { ok?: boolean; signed_name?: string; error?: string } | null;
      if (!ack?.ok) throw new Error(ack?.error || "Couldn't record acceptance");
      setQ({ ...q, status: "accepted" });
      setSignedName(ack.signed_name ?? validation.value);
    } catch (e) {
      // Fallback: try direct insert. Public RLS on quote_acceptances allows
      // anonymous INSERTs in the shared schema.
      try {
        const { error: insErr } = await supabase
          .from("quote_acceptances")
          .insert({
            quote_id: q.id,
            signed_name: validation.value,
            user_agent: navigator.userAgent.slice(0, 500),
          } as never);
        if (insErr) throw insErr;
        // Public update by UUID — app discriminator intentionally not filtered (see app-context.ts)
        await supabase
          .from("quotes")
          .update({ status: "accepted" } as never)
          .eq("id", q.id);
        setQ({ ...q, status: "accepted" });
      } catch (e2) {
        setErrorMsg(
          e2 instanceof Error
            ? e2.message
            : e instanceof Error
              ? e.message
              : "Couldn't accept — please call us.",
        );
      }
    } finally {
      setAccepting(false);
    }
  };

  // Toggle the "make this recurring" opt-in. We rewrite quotes.notes with
  // a `[recurring_requested]` sentinel prefix so QuoteDetail's CTA can
  // highlight it without a schema migration. Checking + unchecking is a
  // local-state flip and a single notes-column UPDATE — no rollback path
  // beyond surfacing the error to the customer.
  const toggleRecurring = async (next: boolean) => {
    if (!q) return;
    setRecurringSaving(true);
    setErrorMsg(null);
    try {
      // Strip any prior sentinel from notes before adding/removing it, so
      // double-clicks don't accumulate.
      const baseNotes = (
        await (async () => {
          // Public lookup by UUID — app discriminator intentionally not filtered (see app-context.ts)
          const { data } = await supabase
            .from("quotes")
            .select("notes")
            .eq("id", q.id)
            .maybeSingle();
          const current = (data?.notes as string | null) ?? "";
          return current.replace(/\[recurring_requested\]\s*/g, "").trim();
        })()
      );
      const newNotes = next
        ? `${RECURRING_REQUESTED_SENTINEL} ${baseNotes}`.trim()
        : baseNotes || null;
      // Public update by UUID — app discriminator intentionally not filtered (see app-context.ts)
      const { error } = await supabase
        .from("quotes")
        .update({ notes: newNotes } as never)
        .eq("id", q.id);
      if (error) throw error;
      setRecurringRequested(next);
    } catch (e) {
      setErrorMsg(
        e instanceof Error
          ? `Couldn't save your preference: ${e.message}`
          : "Couldn't save your preference.",
      );
    } finally {
      setRecurringSaving(false);
    }
  };

  const payDeposit = async () => {
    /* TODO: wire Stripe Checkout deposit. The create-checkout-session edge
       function being built in parallel exposes the API; once landed, redirect
       there with the quote_id. */
    setErrorMsg(null);
    setPayLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout-session", {
        body: { quote_id: q.id, kind: "deposit", environment: getStripeEnvironment() },
      });
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

  const lines = parseLines(q.lines);
  const computedTotal = quoteTotal(lines);
  const total = q.total ?? computedTotal;
  const accepted = q.status === "accepted";
  const firstName = q.customer_name.split(" ")[0];
  const issueDate = new Date(q.expires_at ?? Date.now()).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const shortId = q.id.slice(0, 4).toUpperCase();
  const hasDeposit = (q.deposit_amount ?? 0) > 0;
  const depositPaid = !!q.deposit_paid_at;

  return (
    <div className="min-h-screen bg-background">
      <BrandHeader business={business.business}>
        <div className="font-mono text-[11px] font-bold tracking-[0.12em] text-accent-400">
          QUOTE #{shortId} · {issueDate.toUpperCase()}
        </div>
        <h1 className="font-display text-[30px] text-white mt-1.5">Hi {firstName},</h1>
        <p className="text-white/75 text-sm mt-1.5">Here's your quote for {q.address}.</p>
        <div className="mt-5">
          <div className="tp-display tp-num text-[64px] leading-none text-accent-400 font-extrabold">
            {fmtUSD(total)}
          </div>
          <div className="text-white/70 text-xs mt-1.5">
            {accepted ? "Thanks — we've got it from here." : "Sign below to approve."}
          </div>
        </div>
        {isExpired && (
          <div className="mt-3 inline-block">
            <span className="px-2.5 py-1 rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold uppercase tracking-wider">
              Expired
            </span>
          </div>
        )}
      </BrandHeader>

      <main className="max-w-md mx-auto px-4 pt-5">
        {/* What's included */}
        <section>
          <h2 className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground mb-2.5">
            Your quote
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
                      <div className="text-[11px] text-muted-foreground mt-0.5">
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
              <div className="tp-num font-extrabold text-base text-brand-900">{fmtUSD(total)}</div>
            </div>
          </div>
        </section>

        {/* Recurring upsell */}
        {q.recurring_months && (
          <section
            className="tp-card p-3.5 mt-4"
            style={{ background: "linear-gradient(135deg, hsl(var(--brand-50)), hsl(var(--card)))" }}
          >
            <div className="flex items-center gap-2.5 mb-1.5">
              <Repeat className="h-[18px] w-[18px] text-brand-800" />
              <div className="font-extrabold text-sm">Keep it green year-round</div>
            </div>
            <div className="text-xs text-muted-foreground">
              Add a {q.recurring_months}-month maintenance plan at today's rates.
            </div>
          </section>
        )}

        {/* Sign & Accept */}
        {!accepted && !isExpired && (
          <section className="mt-5">
            <h2 className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground mb-2.5">
              Approve &amp; schedule
            </h2>
            <label className="block mb-2">
              <span className="block text-[10px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground mb-1.5">
                Type your full name to sign
              </span>
              <input
                type="text"
                value={signedName}
                onChange={e => setSignedName(e.target.value)}
                placeholder={q.customer_name}
                autoComplete="name"
                className="w-full h-14 px-3.5 rounded-xl border-[1.5px] border-border bg-card font-display text-[22px] font-bold text-foreground focus:border-brand-800 outline-none"
                style={{ fontFamily: "'Caveat', 'Archivo', cursive" }}
              />
              <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug flex items-center gap-1.5">
                <ShieldCheck className="h-3 w-3" />
                We'll record your signature with a timestamp.
              </p>
            </label>

            <button
              onClick={accept}
              disabled={accepting || !signedName.trim()}
              className="w-full h-14 rounded-2xl bg-accent-500 text-brand-900 font-bold text-[15px] shadow-accent flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.98] transition-transform"
            >
              {accepting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" strokeWidth={2.6} />}
              Approve &amp; schedule
            </button>

            {errorMsg && (
              <p className="mt-2 text-xs text-destructive text-center">{errorMsg}</p>
            )}

            <div className="grid grid-cols-2 gap-2 mt-2.5">
              {business.phone && (
                <a
                  href={`tel:${business.phone.replace(/[^\d+]/g, "")}`}
                  className="h-12 rounded-[14px] border-[1.5px] border-border bg-card text-foreground font-bold text-sm flex items-center justify-center gap-2"
                >
                  <Phone className="h-4 w-4" /> Call
                </a>
              )}
              <a
                href={`/accept/${q.id}/print`}
                target="_blank"
                rel="noopener"
                className="h-12 rounded-[14px] border-[1.5px] border-border bg-card text-foreground font-bold text-sm flex items-center justify-center gap-2"
              >
                <Printer className="h-4 w-4" /> Save PDF
              </a>
            </div>
          </section>
        )}

        {accepted && (
          <>
            <section className="tp-card p-4 mt-5 flex items-start gap-3 border-success bg-[hsl(var(--success-bg))]">
              <div className="h-10 w-10 rounded-xl bg-success text-success-foreground flex items-center justify-center shrink-0">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="text-sm">
                <div className="font-extrabold text-neutral-900">Quote approved</div>
                <div className="text-muted-foreground text-xs mt-0.5">
                  Thanks{signedName ? `, ${signedName.split(" ")[0]}` : ""} — we'll be in touch
                  to schedule your service.
                </div>
              </div>
            </section>

            {hasDeposit && !depositPaid && (
              <section className="mt-4">
                <h2 className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground mb-2.5">
                  Reserve your spot
                </h2>
                <div className="tp-card p-4">
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-sm font-bold text-neutral-900">Deposit</span>
                    <span className="tp-num font-extrabold text-lg text-brand-900">
                      {fmtUSD(q.deposit_amount ?? 0)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    A small deposit holds your spot on our route. The balance is due after the
                    work is done.
                  </p>
                  <button
                    onClick={payDeposit}
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

            {hasDeposit && depositPaid && (
              <section className="tp-card p-3.5 mt-4 text-sm text-brand-800 font-bold flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Deposit received — you're on the route.
              </section>
            )}

            {/* Recurring opt-in — surfaced after acceptance so it doesn't
                clutter the approval CTA. The operator sees the request on
                QuoteDetail and uses Convert-to-Plan to actually wire it up.
                We store the flag as a sentinel prefix in quote.notes; see
                toggleRecurring above. */}
            <section className="tp-card p-3.5 mt-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={recurringRequested}
                  onChange={(e) => toggleRecurring(e.target.checked)}
                  disabled={recurringSaving}
                  className="mt-0.5 h-4 w-4 rounded border-border accent-brand-800"
                />
                <span className="text-sm">
                  <span className="flex items-center gap-1.5 font-bold text-neutral-900">
                    <Repeat className="h-3.5 w-3.5 text-brand-800" />
                    Make this a recurring service
                  </span>
                  <span className="block text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
                    We'll be in touch to set up a regular schedule at the same
                    rates. You can cancel any time.
                  </span>
                </span>
              </label>
            </section>

            <div className="mt-4 text-center">
              <Link
                to={`/review/${q.id}`}
                className="text-sm font-semibold text-brand-800 hover:underline"
              >
                Leave a review after your service →
              </Link>
            </div>
          </>
        )}

        <div className="text-center text-[11px] text-muted-foreground pt-6 pb-10">
          {q.expires_at && !isExpired && !accepted && (
            <>Quote expires {new Date(q.expires_at).toLocaleDateString()}<br /></>
          )}
          Powered by <span className="font-semibold text-brand-800">TurfPro</span>
        </div>
      </main>
    </div>
  );
};

export default Accept;
