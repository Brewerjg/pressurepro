import { useEffect, useState } from "react";
import { Calculator, Check, Loader2 } from "lucide-react";
import {
  claimQuickBooks,
  connectQuickBooks,
  disconnectQuickBooks,
  getQuickBooksStatus,
  type QuickBooksStatus,
} from "@/lib/quickbooks";

// QuickBooksCard — QuickBooks Online connect/disconnect card for the Settings
// "Integrations" section. Matches the Stripe payouts / Subscription card look
// (tp-card, bronze CTA, green "Connected ✓").
//
// On mount we fetch the connection status from the `quickbooks-oauth` edge fn.
// After Intuit redirects the operator back to /settings?quickbooks=connected
// (or =error), we read that query param to show a one-line note and clean the
// URL so a refresh doesn't re-show it.
export default function QuickBooksCard() {
  const [status, setStatus] = useState<QuickBooksStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [redirectNote, setRedirectNote] = useState<
    "connected" | "error" | null
  >(null);

  const refresh = async () => {
    try {
      const s = await getQuickBooksStatus();
      setStatus(s);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load QuickBooks status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      let note: "connected" | "error" | null = null;
      try {
        const params = new URLSearchParams(window.location.search);
        const qb = params.get("quickbooks");
        const token = params.get("token");
        if (qb === "claim" && token) {
          try {
            await claimQuickBooks(token);
            note = "connected";
          } catch {
            note = "error";
          }
        } else if (qb === "connected" || qb === "error") {
          note = qb;
        }
        if (qb) {
          params.delete("quickbooks");
          params.delete("token");
          const next =
            window.location.pathname +
            (params.toString() ? `?${params.toString()}` : "");
          window.history.replaceState({}, "", next);
        }
      } catch {
        // ignore — non-browser env
      }
      if (note) setRedirectNote(note);
      refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onConnect = async () => {
    setErr(null);
    setBusy(true);
    try {
      await connectQuickBooks();
      // Browser navigates away (web) or opens the in-app browser (native);
      // we don't reach here on web.
    } catch (e) {
      setBusy(false);
      setErr(e instanceof Error ? e.message : "Could not start QuickBooks");
    }
  };

  const onDisconnect = async () => {
    setErr(null);
    setBusy(true);
    try {
      await disconnectQuickBooks();
      setStatus({ connected: false, company_name: null, realm_id: null });
      setRedirectNote(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not disconnect QuickBooks");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="tp-card p-4 flex items-center gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-ink-400" />
        <span className="text-[12px] text-ink-500">Loading QuickBooks…</span>
      </div>
    );
  }

  // Connected state — green check, company name, disconnect button.
  if (status?.connected) {
    return (
      <div className="tp-card p-4 space-y-2.5">
        <div className="flex items-center gap-3">
          <span className="h-9 w-9 rounded-lg bg-green-100 text-green-800 grid place-items-center shrink-0">
            <Check className="h-4 w-4" strokeWidth={2.6} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold text-green-800">
              Connected ✓
            </div>
            <div className="text-[11.5px] text-ink-500 leading-snug mt-0.5 truncate">
              {status.company_name
                ? `Linked to ${status.company_name}.`
                : "Your QuickBooks company is linked."}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onDisconnect}
          disabled={busy}
          className="w-full h-10 rounded-xl border border-ink-200 text-sm font-semibold text-ink-700 hover:bg-ink-100 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Disconnect"}
        </button>
        {err && (
          <p className="text-[11px] font-semibold text-destructive">{err}</p>
        )}
      </div>
    );
  }

  // Not connected — bronze connect CTA.
  return (
    <div className="tp-card p-4 space-y-2.5">
      <div className="flex items-start gap-3">
        <span className="h-9 w-9 rounded-lg bg-bronze-100 text-bronze-700 grid place-items-center shrink-0">
          <Calculator className="h-4 w-4" strokeWidth={2.2} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold text-ink-900">
            QuickBooks Online
          </div>
          <div className="text-[11.5px] text-ink-500 leading-snug mt-0.5">
            Connect your QuickBooks company so invoices and payments can sync
            automatically.
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onConnect}
        disabled={busy}
        className="w-full h-10 rounded-xl bg-bronze-500 hover:bg-bronze-600 text-white font-semibold text-sm shadow-bronze disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <Calculator className="h-4 w-4" strokeWidth={2.2} />
            Connect QuickBooks
          </>
        )}
      </button>
      {redirectNote === "connected" && (
        <p className="text-[11px] font-semibold text-green-700">
          QuickBooks connected.
        </p>
      )}
      {redirectNote === "error" && (
        <p className="text-[11px] font-semibold text-destructive">
          QuickBooks connection failed. Please try again.
        </p>
      )}
      {err && <p className="text-[11px] font-semibold text-destructive">{err}</p>}
    </div>
  );
}
