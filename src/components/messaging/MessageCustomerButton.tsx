import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
} from "lucide-react";
import {
  composeCustomerMessage,
  type ComposeKind,
} from "@/lib/compose-message";
import { cn } from "@/lib/utils";

// MessageCustomerButton — the unified operator-side affordance for the
// "deep-link copy/paste" model across SMS + email. The flow:
//
//   1) Operator taps the labeled button (e.g. "Message customer 'on the way'").
//   2) We POST the kind + source row id to compose-customer-message, which
//      returns { phone, email, subject, body, sms_url, mailto_url }.
//   3) The button transitions into a small Ready state that exposes up to
//      three actions side-by-side:
//        a. "Text" — an <a href={sms_url}> with a phone icon. Mobile-only
//           (sms: URLs don't open native Messages on most desktops).
//        b. "Email" — an <a href={mailto_url}>. Works on both mobile and
//           desktop because every platform has a default mail handler.
//        c. "Copy" — copies body to clipboard via the Web Clipboard API.
//           Always available as the universal fallback.
//
// We never auto-fire the send. The operator's own phone/mail app is the
// transport.

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

// Default labels per kind. Caller can override via the per-channel props.
const DEFAULT_TEXT_LABEL: Record<ComposeKind, string> = {
  on_the_way: "Text 'on the way'",
  completed: "Text the wrap-up",
  review_request: "Text for a review",
  plan_confirmation: "Text the plan link",
  quote_send: "Text the quote link",
  payment_retry: "Text card-update link",
};

const DEFAULT_EMAIL_LABEL: Record<ComposeKind, string> = {
  on_the_way: "Email 'on the way'",
  completed: "Email the wrap-up",
  review_request: "Email for a review",
  plan_confirmation: "Email the plan link",
  quote_send: "Email the quote link",
  payment_retry: "Email card-update link",
};

// Idle headline shown when the operator hasn't tapped Compose yet. We
// frame it as "Message" because once we hit Compose we don't yet know
// which channel(s) will be available.
const DEFAULT_IDLE_LABEL: Record<ComposeKind, string> = {
  on_the_way: "Message customer 'on the way'",
  completed: "Message customer the wrap-up",
  review_request: "Message customer for a review",
  plan_confirmation: "Message customer the plan link",
  quote_send: "Message customer the quote link",
  payment_retry: "Message customer to update card",
};

export type MessageCustomerButtonVariant = "primary" | "secondary" | "inline";

export type MessageChannel = "text" | "email" | "copy";

export interface MessageCustomerButtonProps {
  kind: ComposeKind;
  routeStopId?: string;
  quoteId?: string;
  planId?: string;
  variant?: MessageCustomerButtonVariant;
  /** Overrides the idle-state headline. */
  label?: string;
  /** Per-channel label overrides for the Ready state. */
  textLabel?: string;
  emailLabel?: string;
  /**
   * Which channels to surface. Defaults to all three. Pass a narrower
   * list when a call site is channel-specific (e.g. ['email','copy'] on
   * a Resend-only surface).
   */
  channels?: MessageChannel[];
}

type UiState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "ready";
      body: string;
      sms_url: string | null;
      mailto_url: string | null;
      phone: string | null;
      email: string | null;
    }
  | { kind: "error"; message: string };

// =====================================================================
// Component
// =====================================================================
export default function MessageCustomerButton({
  kind,
  routeStopId,
  quoteId,
  planId,
  variant = "primary",
  label,
  textLabel,
  emailLabel,
  channels = ["text", "email", "copy"],
}: MessageCustomerButtonProps) {
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

  const idleLabel = label ?? DEFAULT_IDLE_LABEL[kind];
  const resolvedTextLabel = textLabel ?? DEFAULT_TEXT_LABEL[kind];
  const resolvedEmailLabel = emailLabel ?? DEFAULT_EMAIL_LABEL[kind];

  const wantsText = channels.includes("text");
  const wantsEmail = channels.includes("email");
  const wantsCopy = channels.includes("copy");

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
      mailto_url: res.mailto_url,
      phone: res.phone,
      email: res.email,
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
        {idleLabel}
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
  // Ready: side-by-side buttons. Text (mobile only when phone present) +
  // Email (any device when email present) + Copy (always).
  //
  // Visibility rules:
  //   - Text:  channels.includes('text') AND isMobile AND phone AND sms_url
  //   - Email: channels.includes('email') AND email AND mailto_url
  //   - Copy:  channels.includes('copy') — always (universal fallback)
  //
  // When the customer has neither phone nor email on file, we render
  // Copy alone with a hint telling the operator to add contact info.
  // -----------------------------------------------------------------
  const showText =
    wantsText && isMobile && Boolean(state.phone) && Boolean(state.sms_url);
  const showEmail =
    wantsEmail && Boolean(state.email) && Boolean(state.mailto_url);
  const showCopy = wantsCopy;

  const noPhone = wantsText && !state.phone;
  const noEmail = wantsEmail && !state.email;
  const noContact = !state.phone && !state.email;

  return (
    <div className="flex flex-col gap-1.5 self-start">
      <div className="flex flex-wrap items-center gap-2">
        {showText && state.sms_url && (
          <a
            href={state.sms_url}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-accent-500 text-white text-[12.5px] font-semibold shadow-accent hover:bg-accent-600 transition-colors"
          >
            <Phone className="h-3.5 w-3.5" strokeWidth={2.2} />
            {resolvedTextLabel}
          </a>
        )}
        {showEmail && state.mailto_url && (
          <a
            href={state.mailto_url}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-800 text-white text-[12.5px] font-semibold shadow-accent hover:bg-brand-700 transition-colors"
          >
            <Mail className="h-3.5 w-3.5" strokeWidth={2.2} />
            {resolvedEmailLabel}
          </a>
        )}
        {showCopy && (
          <button
            type="button"
            onClick={() => handleCopy(state.body)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-[12.5px] font-semibold transition-colors",
              copied
                ? "bg-brand-100 border-brand-300 text-brand-800"
                : "bg-card border-neutral-200 text-neutral-700 hover:bg-neutral-100",
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
        )}
      </div>
      {noContact ? (
        <div className="text-[11px] text-neutral-500 inline-flex items-center gap-1">
          <AlertCircle className="h-3 w-3" strokeWidth={2} />
          Add phone or email to customer record
        </div>
      ) : (
        <>
          {noPhone && (
            <div className="text-[11px] text-neutral-500 inline-flex items-center gap-1">
              <AlertCircle className="h-3 w-3" strokeWidth={2} />
              No phone on file
            </div>
          )}
          {noEmail && (
            <div className="text-[11px] text-neutral-500 inline-flex items-center gap-1">
              <AlertCircle className="h-3 w-3" strokeWidth={2} />
              No email on file
            </div>
          )}
        </>
      )}
    </div>
  );
}

// =====================================================================
// Visual variants
// =====================================================================
const IDLE_BUTTON_CLASS: Record<MessageCustomerButtonVariant, string> = {
  primary:
    "inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-brand-800 text-white text-[13.5px] font-semibold shadow-accent hover:bg-brand-700 transition-colors",
  secondary:
    "inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl border border-brand-800 bg-card text-brand-800 text-[13px] font-semibold hover:bg-brand-50 transition-colors",
  inline:
    "inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-card border border-neutral-200 text-neutral-700 text-[12.5px] font-semibold hover:bg-neutral-100 transition-colors",
};
