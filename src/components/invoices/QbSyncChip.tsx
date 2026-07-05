import { Check, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { qboSyncState } from "@/lib/qbo-sync-state";

// Compact QuickBooks sync indicator for a billable row. Renders nothing when
// the row has never been synced (absence = not synced); a green "QB" chip when
// synced, a red "QB" chip when the last sync errored.
export function QbSyncChip({
  row,
  className,
}: {
  row: { qbo_synced_at: string | null; qbo_sync_error: string | null };
  className?: string;
}) {
  const state = qboSyncState(row);
  if (state === "unsynced") return null;
  const synced = state === "synced";
  return (
    <span
      title={synced ? "Synced to QuickBooks" : "QuickBooks sync failed"}
      className={cn(
        "inline-flex items-center gap-0.5 px-2 py-[2px] rounded-full text-[10.5px] font-bold uppercase tracking-[0.4px] shrink-0",
        synced ? "bg-brand-100 text-brand-800" : "bg-destructive/15 text-destructive",
        className,
      )}
    >
      {synced ? (
        <Check className="h-3 w-3" strokeWidth={2.4} />
      ) : (
        <AlertTriangle className="h-3 w-3" strokeWidth={2.4} />
      )}
      QB
    </span>
  );
}
