import { Clock, AlertCircle, MoonStar } from "lucide-react";
import type { ThreadMessage } from "./types";

// One message in the thread view. Inbound on the left in ink, outbound
// on the right tinted green. Outbound bubbles also surface the send
// status — failed messages get an inline error, quiet-hours holds get
// a moon icon so the operator knows it's pending the next window.
//
// We don't show the kind ("on_the_way" vs "freeform") in the bubble —
// from the customer's perspective they're all just messages from the
// business, and the operator can tell from the body what was sent.

interface Props {
  message: ThreadMessage;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function MessageBubble({ message }: Props) {
  const isInbound = message.direction === "inbound";
  const failed = message.status === "failed";
  const queued = message.status === "queued";

  return (
    <div className={`flex ${isInbound ? "justify-start" : "justify-end"}`}>
      <div className="max-w-[80%] flex flex-col gap-0.5">
        <div
          className={[
            "rounded-2xl px-3 py-2 text-[14px] leading-relaxed whitespace-pre-wrap break-words",
            isInbound
              ? "bg-ink-100 text-ink-900 rounded-bl-sm"
              : failed
                ? "bg-red-100 text-red-900 rounded-br-sm border border-red-200"
                : queued
                  ? "bg-bronze-100 text-bronze-900 rounded-br-sm border border-bronze-200"
                  : "bg-green-700 text-white rounded-br-sm",
          ].join(" ")}
        >
          {message.body}
        </div>
        <div
          className={`flex items-center gap-1 text-[10px] text-ink-500 tp-num ${
            isInbound ? "self-start" : "self-end"
          }`}
        >
          {!isInbound && queued && message.deferredByQuietHours && (
            <span className="flex items-center gap-0.5 text-bronze-700">
              <MoonStar className="h-3 w-3" strokeWidth={2} />
              quiet hours
            </span>
          )}
          {!isInbound && queued && !message.deferredByQuietHours && (
            <span className="flex items-center gap-0.5">
              <Clock className="h-3 w-3" strokeWidth={2} />
              queued
            </span>
          )}
          {!isInbound && failed && (
            <span className="flex items-center gap-0.5 text-red-700">
              <AlertCircle className="h-3 w-3" strokeWidth={2} />
              failed{message.error ? `: ${message.error}` : ""}
            </span>
          )}
          <span>{fmtTime(message.at)}</span>
        </div>
      </div>
    </div>
  );
}
