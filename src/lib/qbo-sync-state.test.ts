import { describe, it, expect } from "vitest";
import { qboSyncState } from "./qbo-sync-state";

describe("qboSyncState", () => {
  it("synced when qbo_synced_at is set", () => {
    expect(qboSyncState({ qbo_synced_at: "2026-07-01T00:00:00Z", qbo_sync_error: null })).toBe("synced");
  });
  it("error when only qbo_sync_error is set", () => {
    expect(qboSyncState({ qbo_synced_at: null, qbo_sync_error: "boom" })).toBe("error");
  });
  it("unsynced when neither is set", () => {
    expect(qboSyncState({ qbo_synced_at: null, qbo_sync_error: null })).toBe("unsynced");
  });
  it("synced wins when both are set (stale error after a successful resync)", () => {
    expect(qboSyncState({ qbo_synced_at: "2026-07-01T00:00:00Z", qbo_sync_error: "old" })).toBe("synced");
  });
});
