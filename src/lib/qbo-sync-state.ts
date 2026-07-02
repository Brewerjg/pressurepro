// qbo-sync-state.ts
//
// Derive a billable's QuickBooks sync state from its qbo_* columns. Pure; used
// by the row chip, the "Unsynced" list filter, and the Reports counts card.
// `synced` wins over a stale error because a successful re-sync sets
// qbo_synced_at and clears qbo_sync_error.

export type QboSyncState = "synced" | "error" | "unsynced";

export function qboSyncState(row: {
  qbo_synced_at: string | null;
  qbo_sync_error: string | null;
}): QboSyncState {
  if (row.qbo_synced_at) return "synced";
  if (row.qbo_sync_error) return "error";
  return "unsynced";
}
