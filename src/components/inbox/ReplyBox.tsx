import { useEffect, useRef, useState } from "react";
import { Send, Loader2, AlertCircle } from "lucide-react";
import { sendFreeformSms } from "@/lib/customer-sms";

// Reply box for the thread view. Sticky at the bottom of the thread on
// desktop; sits inline below the messages on mobile (the page handles
// layout).
//
// Validation:
//   - Empty body / whitespace-only → disabled Send button.
//   - No phone on file → inline error, Send disabled.
//
// Quiet hours UX:
//   We post to send-customer-sms which already applies the quiet-hours
//   gate. If it returns `deferred: true, reason: 'quiet_hours'`, we
//   surface a confirm dialog ("It's outside your quiet-hours window —
//   send anyway?"). Confirming re-fires the send with a `force=true`
//   marker; the edge function ignores the gate when that flag is set.
//
//   Note: the v1 edge function doesn't actually read `force` yet — the
//   quiet-hours decision is hard-coded against user_settings. So the
//   "send anyway" path will currently re-queue the same row. That's the
//   right behavior until we extend send-customer-sms; the operator at
//   least gets a clear "held until window opens" signal instead of a
//   silent no-op. Documented as a TODO at the call site.

interface Props {
  customerId: string | null;
  recipientPhone: string | null;
  recipientName: string | null;
  onSent: () => void;
}

const MAX_LEN = 320; // 2 segments worth — soft cap, we warn at > 160.

export default function ReplyBox({
  customerId,
  recipientPhone,
  recipientName,
  onSent,
}: Props) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow up to ~5 lines, then scroll.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [body]);

  const noPhone = !recipientPhone;
  const canSend = !sending && body.trim().length > 0 && !noPhone;

  const handleSend = async (force: boolean = false) => {
    if (!recipientPhone) return;
    setSending(true);
    setError(null);
    setInfo(null);
    try {
      const result = await sendFreeformSms({
        phone: recipientPhone,
        body: body.trim(),
        name: recipientName ?? undefined,
        customer_id: customerId,
      });
      if (result.ok) {
        setBody("");
        onSent();
      } else if (result.deferred && result.reason === "quiet_hours" && !force) {
        // Outside quiet hours window — confirm dialog. Native confirm is
        // ugly but unambiguous; a fancier modal can come later.
        const hh = new Date().toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        });
        const ok = window.confirm(
          `It's ${hh} — outside your quiet-hours window. The reply will be held until the window opens. Send anyway?`,
        );
        if (ok) {
          // TODO(force-send): send-customer-sms doesn't read a force flag
          // yet. For v1 the row will just stay queued; the drainer will
          // fire it when the window opens. Surface a clearer "held"
          // message instead of pretending we sent.
          setInfo("Held until quiet-hours window opens.");
          setBody("");
          onSent();
        }
      } else if (result.deferred) {
        setInfo(result.error ?? "Held");
        setBody("");
        onSent();
      } else {
        setError(result.error ?? "Send failed");
      }
    } finally {
      setSending(false);
    }
  };

  if (noPhone) {
    return (
      <div className="tp-card p-3 flex items-center gap-2 text-sm text-red-700">
        <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={2} />
        <span>
          This customer has no phone number on file. Add one on the customer
          record to reply.
        </span>
      </div>
    );
  }

  const segments = Math.max(1, Math.ceil((body.length + 25) / 160)); // +25 ≈ STOP suffix
  const overLength = body.length > MAX_LEN;

  return (
    <div className="tp-card p-2.5 flex flex-col gap-2">
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setError(null);
          setInfo(null);
        }}
        placeholder="Type a reply…"
        rows={2}
        maxLength={500}
        className="w-full resize-none bg-transparent outline-none text-[14px] leading-relaxed text-ink-900 placeholder:text-ink-500 px-1 py-1 max-h-[140px]"
      />
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] text-ink-500 tp-num">
          {body.length} chars · {segments} segment{segments === 1 ? "" : "s"}
          {segments > 1 && (
            <span className="ml-1 text-bronze-700 font-semibold">
              (billed as {segments})
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => handleSend(false)}
          disabled={!canSend || overLength}
          className="inline-flex items-center gap-1.5 bg-green-700 text-white px-3.5 py-1.5 rounded-full font-bold text-sm shadow-bronze disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-800 transition-colors"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
          ) : (
            <Send className="h-4 w-4" strokeWidth={2.4} />
          )}
          Send
        </button>
      </div>
      {error && (
        <div className="flex items-start gap-1.5 text-[12px] text-red-700">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" strokeWidth={2} />
          <span>{error}</span>
        </div>
      )}
      {info && (
        <div className="text-[12px] text-bronze-700">{info}</div>
      )}
    </div>
  );
}
