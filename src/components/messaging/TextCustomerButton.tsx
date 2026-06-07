import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Loader2,
  MessageSquare,
  Phone,
} from "lucide-react";
import {
  composeCustomerMessage,
  type ComposeKind,
} from "@/lib/compose-message";
import { cn } from "@/lib/utils";

// TextCustomerButton — the operator-side affordance for the "sms: deep-link
// copy/paste" model. The flow:
//
//   1) Operator taps the labeled button (e.g. "Text customer 'on the way'").
//   2) We POST the kind + source row id to compose-customer-message, which
//      returns { phone, body, sms_url }.
//   3) The button transitions into a small Ready state that exposes two
//      actions side-by-side:
//        a. "Open Messages" — an <a href={sms_url}> with a phone icon.
//           Only rendered on mobile (sms: URLs don't open native Messages
//           on most desktops).
//        b. "Copy text" — copies body to clipboard via the Web Clipboard
//           API. Shows a "Copied" flash for 2 sec.
//
// We never auto-fire the send. The operator's own phone is the transport.

// ---------------------------------------------------------------------
// Mobile detection. Two signals: (a) ontouchstart on window (every iOS
// + Android browser sets this), and (b) a coarse-grained UA sniff for the
// platforms whose Messages app actually handles sms: URLs. We OR them so
// touch laptops without a Messages app fall back to Copy-only.
// ---------------------------------------------------------------------
function detectMobile(): boolean {
  if (typeof window === "undefined") return false;
  const hasTouch =
    "ontouchstart" in window || (navigator as Navigator).maxTouchPoints > 0;
  const ua = navigator.userAgent || "";
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  // macOS Continuity also handles sms: URLs (forwards to a paired iPhone),
  // but we don't try to detect Continuity availability from the browser —
  // operators on a Mac who want to send via their phone can still hit Copy
  // and paste into their own Messages thread.
  return hasTouch || mobileUa;
}

// Default labels per kind. Caller can override via the `label` prop.
const DEFAULT_LABEL: Record<ComposeKind, string> = {
  on_the_way: "Text customer 'on the way'",
  completed: "Text customer the wrap-up",
  review_request: "Text customer for a review",
  plan_confirmation: "Text customer the plan link",
  quote_send: "Text customer the quote link",
  payment_retry: "Text customer to update card",
};

export type TextCustomerButtonVariant = "primary" | "secondary" | "inline";

export interface TextCustomerButtonProps {
  kind: ComposeKind;
  routeStopId?: string;
  quoteId?: string;
  planId?: string;
  variant?: TextCustomerButtonVariant;
  label?: string;
}

type UiState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; body: string; sms_url: string | null; phone: string | null }
  | { kind: "error"; message: string };

// =====================================================================
// Component
// =====================================================================
export default function TextCustomerButton({
  kind,
  routeStopId,
  quoteId,
  planId,
  variant = "primary",
  label,
}: TextCustomerButtonProps) {
  const [state, setState] = useState<UiState>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const isMobile = useMemo(() => detectMobile(), []);

  // Clear the "Copied" flash after 2 sec. Stored on its own piece of state
  // so re-tapping Copy immediately re-triggers the flash.
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  const buttonLabel = label ?? DEFAULT_LABEL[kind];

  const handleCompose = async () => {
    setState({ kind: "loading" });
    const res = await composeCustomerMessage({
      kind,
      route_stop_id: routeStopId,
      quote_id: quoteId,
      plan_id: planId,
    });
    if (!res.ok) {
      setState({
        kind: "error",
        message: res.error ?? "Couldn't build message",
      });
      return;
    }
    setState({
      kind: "ready",
      body: res.body,
      sms_url: res.sms_url,
      phone: res.phone,
    });
  };

  const handleCopy = async (body: string) => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
    } catch {
      // Fallback for browsers that gate clipboard behind permissions —
      // a native prompt with the message preselected.
      window.prompt("Copy this text:", body);
      setCopied(true);
    }
  };

  // -----------------------------------------------------------------
  // Idle: single primary-style button. Tap to compose.
  // -----------------------------------------------------------------
  if (state.kind === "idle") {
    return (
      <button
        type="button"
        onClick={handleCompose}
        className={cn(IDLE_BUTTON_CLASS[variant])}
      >
        <MessageSquare className="h-4 w-4" strokeWidth={2.2} />
        {buttonLabel}
      </button>
    );
  }

  // -----------------------------------------------------------------
  // Loading: spinner inside the same button frame.
  // -----------------------------------------------------------------
  if (state.kind === "loading") {
    return (
      <button
        type="button"
        disabled
        className={cn(IDLE_BUTTON_CLASS[variant], "opacity-70")}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        Preparing…
      </button>
    );
  }

  // -----------------------------------------------------------------
  // Error: inline message + retry.
  // -----------------------------------------------------------------
  if (state.kind === "error") {
    return (
      <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2.5 inline-flex flex-col gap-1.5">
        <div className="text-[12px] font-semibold text-red-700 inline-flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" strokeWidth={2} />
          {state.message}
        </div>
        <button
          type="button"
          onClick={handleCompose}
          className="self-start text-[11.5px] font-semibold text-red-700 underline underline-offset-2"
        >
          Try again
        </button>
      </div>
    );
  }

  // -----------------------------------------------------------------
  // Ready: side-by-side buttons. Open Messages (mobile only) + Copy.
  // -----------------------------------------------------------------
  const showOpenMessages = isMobile && Boolean(state.sms_url);
  return (
    <div className="flex flex-col gap-1.5 self-start">
      <div className="flex flex-wrap items-center gap-2">
        {showOpenMessages && state.sms_url && (
          <a
            href={state.sms_url}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-bronze-500 text-white text-[12.5px] font-semibold shadow-bronze hover:bg-bronze-600 transition-colors"
          >
            <Phone className="h-3.5 w-3.5" strokeWidth={2.2} />
            Open Messages
          </a>
        )}
        <button
          type="button"
          onClick={() => handleCopy(state.body)}
          className={cn(
            "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-[12.5px] font-semibold transition-colors",
            copied
              ? "bg-green-100 border-green-300 text-green-800"
              : "bg-card border-ink-200 text-ink-700 hover:bg-ink-100",
          )}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" strokeWidth={2} />
              Copy text
            </>
          )}
        </button>
      </div>
      {!state.phone && (
        <div className="text-[11px] text-ink-500 inline-flex items-center gap-1">
          <AlertCircle className="h-3 w-3" strokeWidth={2} />
          No phone on file
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Visual variants
// =====================================================================
const IDLE_BUTTON_CLASS: Record<TextCustomerButtonVariant, string> = {
  primary:
    "inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-green-800 text-white text-[13.5px] font-semibold shadow-bronze hover:bg-green-700 transition-colors",
  secondary:
    "inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl border border-green-800 bg-card text-green-800 text-[13px] font-semibold hover:bg-green-50 transition-colors",
  inline:
    "inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-card border border-ink-200 text-ink-700 text-[12.5px] font-semibold hover:bg-ink-100 transition-colors",
};
