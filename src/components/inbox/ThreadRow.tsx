import { Link } from "react-router-dom";
import { ChevronRight, MessageSquare, HelpCircle } from "lucide-react";
import type { ThreadSummary } from "./types";

// One row in the Inbox list. Tappable card that routes to /inbox/:customerId
// (or /inbox/unknown for the "Unknown senders" pseudo-thread).
//
// Design notes:
//   - Unread count badge mirrors the bronze accent treatment used on the
//     tab bar elsewhere.
//   - Time is right-aligned in a tabular-nums column so a long list lines
//     up neatly.
//   - Unknown-sender threads use HelpCircle instead of an avatar so the
//     operator can spot them at a glance.

interface Props {
  thread: ThreadSummary;
  isFirst: boolean;
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((s) => s[0]!.toUpperCase())
    .slice(0, 2)
    .join("");
}

function fmtRelative(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  // Within the last week → "Mon", else short date.
  const ms = now.getTime() - d.getTime();
  if (ms < 7 * 24 * 60 * 60 * 1000) {
    return d.toLocaleDateString("en-US", { weekday: "short" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ThreadRow({ thread, isFirst }: Props) {
  const target = thread.customerId
    ? `/inbox/${thread.customerId}`
    : "/inbox/unknown";

  return (
    <Link
      to={target}
      className={`flex items-center gap-3 p-3 active:bg-neutral-100 transition-colors ${
        isFirst ? "" : "border-t border-neutral-200"
      }`}
    >
      {/* Avatar / icon. Unknown senders get a distinct treatment. */}
      {thread.customerId ? (
        <div className="h-10 w-10 rounded-[12px] bg-brand-100 text-brand-800 flex items-center justify-center font-extrabold text-xs shrink-0">
          {initials(thread.displayName)}
        </div>
      ) : (
        <div className="h-10 w-10 rounded-[12px] bg-accent-100 text-accent-700 flex items-center justify-center shrink-0">
          <HelpCircle className="h-5 w-5" strokeWidth={2} />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="font-bold text-sm text-neutral-900 truncate flex-1 min-w-0">
            {thread.displayName}
          </div>
          <div className="text-[11px] text-neutral-500 tp-num shrink-0">
            {fmtRelative(thread.lastActivityAt)}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <div className="text-[12px] text-neutral-700 truncate flex-1 min-w-0 flex items-center gap-1">
            {thread.lastDirection === "outbound" && (
              <MessageSquare
                className="h-3 w-3 shrink-0 text-neutral-400"
                strokeWidth={2}
              />
            )}
            <span className="truncate">{thread.preview}</span>
          </div>
          {thread.unreadCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-accent-500 text-white text-[10px] font-extrabold tp-num shrink-0">
              {thread.unreadCount}
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-neutral-400 shrink-0" strokeWidth={2} />
    </Link>
  );
}
