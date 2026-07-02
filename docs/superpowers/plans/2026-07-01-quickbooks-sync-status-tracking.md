# QuickBooks Sync-Status Tracking (lists + reports) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show which billables are synced to QuickBooks — a per-row chip + an "Unsynced" filter on the invoices/quotes lists, and an all-time counts card in Reports — in both TurfPro (invoices) and PressurePro (quotes).

**Architecture:** Pure read of existing `qbo_synced_at`/`qbo_sync_error` columns. A tiny `qboSyncState` deriver (synced|error|unsynced) drives a compact chip and the list filter; a Reports card counts states across all billables. All QB UI is gated on `getQuickBooksStatus().connected`. No backend/DB changes.

**Tech Stack:** React + TypeScript; TurfPro uses @tanstack/react-query, PressurePro uses a local store + a small hook; vitest (turf repo only).

## Global Constraints

- **Two repos.** turf: `C:\Users\Jason\Desktop\turf` (branch `feature/qb-sync-status`, the spec is already committed there). PressurePro: `C:\Users\Jason\Desktop\pressure-pro-quoter` (branch `feature/qb-sync-status`, create it off `main`).
- **No backend/DB/migration/edge-function changes.** Columns already exist (`invoices.qbo_*`, `quotes.qbo_*`).
- **Sync state:** `qbo_synced_at` set → `synced`; else `qbo_sync_error` set → `error`; else `unsynced`. `synced` wins when both are set.
- **Gate all QB UI on connected** (`getQuickBooksStatus()` from `@/lib/quickbooks`): turf via `useQuery({ queryKey: ["quickbooks-status"], queryFn: getQuickBooksStatus, staleTime: 5*60*1000 })`; PressurePro via a `useQuickBooksConnected()` hook (module-cached, one call/session).
- **Chip:** `synced` → green "QB ✓"; `error` → red "QB !"; `unsynced` → render nothing.
- **Reports counts:** all-time; TurfPro across all invoices, PressurePro across all non-draft quotes.
- **PressurePro qbo fields are READ-ONLY on the client** — map them in `rowToQuote`, and do NOT add them to `quoteToRow` (the edge function owns those columns; the upsert must not clobber them).
- Commit trailers (both repos): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01QrF17kQNQsTPBTHee6C3br`.

---

### Task 1: `qboSyncState` deriver + test (turf repo)

**Files:**
- Create: `C:\Users\Jason\Desktop\turf\src\lib\qbo-sync-state.ts`
- Create (test): `C:\Users\Jason\Desktop\turf\src\lib\qbo-sync-state.test.ts`

**Interfaces:**
- Produces (used by Tasks 2–3): `type QboSyncState = "synced" | "error" | "unsynced"`; `qboSyncState(row: { qbo_synced_at: string | null; qbo_sync_error: string | null }): QboSyncState`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/qbo-sync-state.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run (turf repo): `npm test -- qbo-sync-state`
Expected: FAIL — module not found / `qboSyncState` not exported.

- [ ] **Step 3: Implement**

Create `src/lib/qbo-sync-state.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- qbo-sync-state`
Expected: PASS — 4/4.

- [ ] **Step 5: Commit**

```bash
git add src/lib/qbo-sync-state.ts src/lib/qbo-sync-state.test.ts
git commit -m "feat(quickbooks): qboSyncState deriver + tests"
```

---

### Task 2: Invoices list — chip + Unsynced tab (turf repo)

**Files:**
- Create: `C:\Users\Jason\Desktop\turf\src\components\invoices\QbSyncChip.tsx`
- Modify: `C:\Users\Jason\Desktop\turf\src\pages\Invoices.tsx`

**Interfaces:**
- Consumes: `qboSyncState` / `QboSyncState` (Task 1); `getQuickBooksStatus` (`@/lib/quickbooks`).
- Produces: `<QbSyncChip row={{ qbo_synced_at, qbo_sync_error }} />` (used by Task 3 is NOT required — chip is Invoices-only; Reports uses counts).

- [ ] **Step 1: Create the chip component**

Create `src/components/invoices/QbSyncChip.tsx`:

```tsx
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
        synced ? "bg-green-100 text-green-800" : "bg-destructive/15 text-destructive",
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
```

- [ ] **Step 2: Add the connected query + extend the filter type/tabs**

In `src/pages/Invoices.tsx`:

Add imports:
```ts
import { getQuickBooksStatus } from "@/lib/quickbooks";
import { qboSyncState } from "@/lib/qbo-sync-state";
import { QbSyncChip } from "@/components/invoices/QbSyncChip";
```

Change the filter type to include `"unsynced"`:
```ts
type StatusFilter = "unpaid" | "paid" | "all" | "unsynced";
```

Inside the `Invoices` component, after the existing `invoices` query, add the connected query:
```tsx
  const { data: qbStatus } = useQuery({
    queryKey: ["quickbooks-status"],
    queryFn: getQuickBooksStatus,
    staleTime: 5 * 60 * 1000,
  });
  const qbConnected = !!qbStatus?.connected;
```

Build the tabs so the "Unsynced" segment appears only when connected (replace the module-level `STATUS_TABS` usage in the render with a computed list). Where the tabs are rendered (`STATUS_TABS.map(...)`), map over this instead:
```tsx
  const tabs: { key: StatusFilter; label: string }[] = [
    ...STATUS_TABS,
    ...(qbConnected ? [{ key: "unsynced" as const, label: "Unsynced" }] : []),
  ];
```
and change the render to `tabs.map(...)`.

Extend the `filtered` memo to handle the new filter (add the branch, keep the others):
```tsx
    if (filter === "unsynced") return invoices.filter((inv) => qboSyncState(inv) === "unsynced");
```
Add `qbConnected` to the memo's dependency array along with `invoices, filter`.

- [ ] **Step 3: Render the chip in the invoice row**

In the row's status-pill flex container (next to the `{invoice.status}` pill and the completed chip), add — gated on connected:
```tsx
                {qbConnected && <QbSyncChip row={invoice} />}
```

If the row is a separate `InvoiceRow` sub-component that doesn't receive `qbConnected`, pass it down as a prop (`<InvoiceRow ... qbConnected={qbConnected} />` and add `qbConnected: boolean` to its props). Render the chip inside the existing `flex items-center gap-1.5` status group.

- [ ] **Step 4: Typecheck + build**

Run (turf repo): `npx tsc --noEmit` then `npm run build`
Expected: no type errors; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/invoices/QbSyncChip.tsx src/pages/Invoices.tsx
git commit -m "feat(quickbooks): sync chip + Unsynced filter on Invoices list"
```

---

### Task 3: Reports QuickBooks card (turf repo)

**Files:**
- Modify: `C:\Users\Jason\Desktop\turf\src\pages\Reports.tsx`

**Interfaces:**
- Consumes: `qboSyncState` (Task 1); `getQuickBooksStatus` (`@/lib/quickbooks`); `listInvoices` (`@/lib/invoices`); `APP_ID` (`@/lib/app-context`).

- [ ] **Step 1: Add the connected query + counts**

In `src/pages/Reports.tsx`, add imports (if not present):
```ts
import { getQuickBooksStatus } from "@/lib/quickbooks";
import { qboSyncState } from "@/lib/qbo-sync-state";
import { listInvoices } from "@/lib/invoices";
import { APP_ID } from "@/lib/app-context";
```

Inside the `Reports` component, alongside the other queries:
```tsx
  const { data: qbStatus } = useQuery({
    queryKey: ["quickbooks-status"],
    queryFn: getQuickBooksStatus,
    staleTime: 5 * 60 * 1000,
  });
  const qbConnected = !!qbStatus?.connected;

  const { data: qbInvoices } = useQuery({
    queryKey: ["invoices"],
    queryFn: () => listInvoices(APP_ID),
    enabled: qbConnected,
  });
  const qbCounts = useMemo(() => {
    const c = { synced: 0, error: 0, unsynced: 0 };
    for (const inv of qbInvoices ?? []) c[qboSyncState(inv)]++;
    return c;
  }, [qbInvoices]);
```
(`useMemo`/`useQuery` are already imported in this file.)

- [ ] **Step 2: Render the card**

Add this card among the other Reports cards (following the existing `tp-card` pattern), gated on connected:
```tsx
      {qbConnected && (
        <div className="mx-4 tp-card p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.4px] text-ink-500">
            QuickBooks
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="tp-num text-2xl font-bold text-ink-900">{qbCounts.synced}</span>
            <span className="text-[13px] text-ink-500">synced</span>
            <span className="text-ink-300">·</span>
            <span className="tp-num text-2xl font-bold text-ink-900">{qbCounts.unsynced}</span>
            <span className="text-[13px] text-ink-500">not synced</span>
          </div>
          {qbCounts.error > 0 && (
            <div className="mt-1 text-[12px] font-semibold text-destructive">
              {qbCounts.error} sync {qbCounts.error === 1 ? "error" : "errors"}
            </div>
          )}
        </div>
      )}
```
Place it in the cards column near the other financial cards (e.g., after the "Cash + checks (30d)" card). Match the surrounding spacing (`mx-4`, card gap).

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: no type errors; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Reports.tsx
git commit -m "feat(quickbooks): all-time sync counts card in Reports"
```

---

### Task 4: PressurePro store plumbing + deriver + connected hook (PressurePro repo)

**Files:**
- Modify: `C:\Users\Jason\Desktop\pressure-pro-quoter\src\lib\store.ts` (`DbQuote` type, `Quote` interface, `rowToQuote`)
- Create: `C:\Users\Jason\Desktop\pressure-pro-quoter\src\lib\qbo-sync-state.ts`
- Create: `C:\Users\Jason\Desktop\pressure-pro-quoter\src\hooks\useQuickBooksConnected.ts`

**Interfaces:**
- Produces (used by Tasks 5–6):
  - `Quote` gains `qboSyncedAt?: string | null; qboSyncError?: string | null`.
  - `qboSyncState(row: { qboSyncedAt?: string | null; qboSyncError?: string | null }): "synced" | "error" | "unsynced"`.
  - `useQuickBooksConnected(): boolean`.

- [ ] **Step 1: Thread qbo fields through the store**

In `src/lib/store.ts`:

Add to the `DbQuote` type (after `crew_id: string | null;`):
```ts
  qbo_synced_at: string | null; qbo_sync_error: string | null;
```

Add to the `Quote` interface (after `crewId?: string;`):
```ts
  // QuickBooks sync state — READ-ONLY on the client (edge function owns these).
  qboSyncedAt?: string | null;
  qboSyncError?: string | null;
```

Add to the `rowToQuote` return object (after `crewId: r.crew_id ?? undefined,`):
```ts
    qboSyncedAt: r.qbo_synced_at,
    qboSyncError: r.qbo_sync_error,
```

Do NOT add anything to `quoteToRow` — leaving these columns out of the upsert preserves the edge-function-written values (supabase-js upsert only SETs the columns present in the object).

- [ ] **Step 2: Add the deriver**

Create `src/lib/qbo-sync-state.ts`:

```ts
// qbo-sync-state.ts
//
// Derive a quote's QuickBooks sync state from its qbo* fields (camelCase, as the
// store exposes them). Pure; used by the row chip, the "Unsynced" filter, and
// the Reports counts card. `synced` wins over a stale error.

export type QboSyncState = "synced" | "error" | "unsynced";

export function qboSyncState(row: {
  qboSyncedAt?: string | null;
  qboSyncError?: string | null;
}): QboSyncState {
  if (row.qboSyncedAt) return "synced";
  if (row.qboSyncError) return "error";
  return "unsynced";
}
```

- [ ] **Step 3: Add the connected hook**

Create `src/hooks/useQuickBooksConnected.ts`:

```ts
// useQuickBooksConnected — one-shot, session-cached QuickBooks connection check.
// PressurePro has no react-query for this; a module-level cached promise ensures
// getQuickBooksStatus() runs once per session no matter how many components ask.

import { useEffect, useState } from "react";
import { getQuickBooksStatus } from "@/lib/quickbooks";

let cached: Promise<boolean> | null = null;

function fetchConnected(): Promise<boolean> {
  if (!cached) {
    cached = getQuickBooksStatus()
      .then((s) => s.connected)
      .catch(() => false);
  }
  return cached;
}

export function useQuickBooksConnected(): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchConnected().then((v) => {
      if (alive) setConnected(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return connected;
}
```

- [ ] **Step 4: Typecheck**

Run (PressurePro repo): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.ts src/lib/qbo-sync-state.ts src/hooks/useQuickBooksConnected.ts
git commit -m "feat(quickbooks): thread quote qbo sync state through store + deriver + connected hook"
```

---

### Task 5: Quotes list — chip + Unsynced toggle (PressurePro repo)

**Files:**
- Create: `C:\Users\Jason\Desktop\pressure-pro-quoter\src\components\QbSyncChip.tsx`
- Modify: `C:\Users\Jason\Desktop\pressure-pro-quoter\src\pages\Quotes.tsx`

**Interfaces:**
- Consumes: `qboSyncState` (Task 4), `useQuickBooksConnected` (Task 4), the `Quote` fields `qboSyncedAt`/`qboSyncError` (Task 4).

- [ ] **Step 1: Create the chip (PressurePro tokens)**

Create `src/components/QbSyncChip.tsx`:

```tsx
import { Check, AlertTriangle } from "lucide-react";
import { qboSyncState } from "@/lib/qbo-sync-state";

// Compact QuickBooks sync indicator for a quote row. Nothing when unsynced;
// green "QB" when synced; red "QB" when the last sync errored.
export function QbSyncChip({
  row,
}: {
  row: { qboSyncedAt?: string | null; qboSyncError?: string | null };
}) {
  const state = qboSyncState(row);
  if (state === "unsynced") return null;
  const synced = state === "synced";
  return (
    <span
      title={synced ? "Synced to QuickBooks" : "QuickBooks sync failed"}
      className={`inline-flex items-center gap-0.5 px-2 py-[2px] rounded-full text-[10px] font-bold uppercase tracking-[0.02em] shrink-0 ${
        synced ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
      }`}
    >
      {synced ? (
        <Check className="h-3 w-3" strokeWidth={2.6} />
      ) : (
        <AlertTriangle className="h-3 w-3" strokeWidth={2.6} />
      )}
      QB
    </span>
  );
}
```

- [ ] **Step 2: Wire the toggle + chip into Quotes**

In `src/pages/Quotes.tsx`:

Add imports:
```ts
import { useQuickBooksConnected } from "@/hooks/useQuickBooksConnected";
import { qboSyncState } from "@/lib/qbo-sync-state";
import { QbSyncChip } from "@/components/QbSyncChip";
```
(and add `Calculator` to the existing `lucide-react` import if you want an icon on the toggle — optional.)

Inside the `Quotes` component (with the other hooks, unconditional — not after any early return):
```tsx
  const qbConnected = useQuickBooksConnected();
  const [unsyncedOnly, setUnsyncedOnly] = useState(false);
```
(`useState` is already imported.)

Derive the displayed list from `sorted` (apply the unsynced filter when the toggle is on):
```tsx
  const visible = unsyncedOnly
    ? sorted.filter((q) => q.status !== "draft" && qboSyncState(q) === "unsynced")
    : sorted;
```
Change the list render from `sorted.map(...)` to `visible.map(...)`.

Render the toggle above the list, only when connected:
```tsx
        {qbConnected && (
          <button
            type="button"
            onClick={() => setUnsyncedOnly((v) => !v)}
            className={`mb-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold ${
              unsyncedOnly
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            Unsynced only
          </button>
        )}
```

In the row's chip group (the `mt-1.5 flex items-center gap-1.5 flex-wrap` div, next to `<QStatus />`), add — gated on connected:
```tsx
                      {qbConnected && <QbSyncChip row={q} />}
```

- [ ] **Step 3: Typecheck + build**

Run (PressurePro repo): `npx tsc --noEmit` then `npm run build`
Expected: no type errors; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/QbSyncChip.tsx src/pages/Quotes.tsx
git commit -m "feat(quickbooks): sync chip + Unsynced toggle on Quotes list"
```

---

### Task 6: PressurePro Reports QuickBooks card (PressurePro repo)

**Files:**
- Modify: `C:\Users\Jason\Desktop\pressure-pro-quoter\src\pages\Reports.tsx`

**Interfaces:**
- Consumes: `useQuickBooksConnected` (Task 4), `qboSyncState` (Task 4), `useQuotes` (`@/lib/store`).

- [ ] **Step 1: Add connected + counts**

In `src/pages/Reports.tsx`, add imports:
```ts
import { useQuickBooksConnected } from "@/hooks/useQuickBooksConnected";
import { qboSyncState } from "@/lib/qbo-sync-state";
import { useQuotes } from "@/lib/store";
```
(If `useQuotes` is already imported, don't duplicate.)

Inside the `Reports` component (unconditional hooks):
```tsx
  const qbConnected = useQuickBooksConnected();
  const [qbQuotes] = useQuotes();
  const qbCounts = useMemo(() => {
    const c = { synced: 0, error: 0, unsynced: 0 };
    for (const q of qbQuotes) {
      if (q.status === "draft") continue;
      c[qboSyncState(q)]++;
    }
    return c;
  }, [qbQuotes]);
```
(`useMemo` is already imported; if not, add it.)

- [ ] **Step 2: Render the card**

Add among the existing Reports cards (follow the `pp-card` pattern), gated on connected:
```tsx
      {qbConnected && (
        <div className="pp-card p-4">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
            QuickBooks
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold">{qbCounts.synced}</span>
            <span className="text-[13px] text-muted-foreground">synced</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-2xl font-bold">{qbCounts.unsynced}</span>
            <span className="text-[13px] text-muted-foreground">not synced</span>
          </div>
          {qbCounts.error > 0 && (
            <div className="mt-1 text-[12px] font-bold text-destructive">
              {qbCounts.error} sync {qbCounts.error === 1 ? "error" : "errors"}
            </div>
          )}
        </div>
      )}
```
Place it in the cards flow near the other financial cards; match the surrounding spacing.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: no type errors; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Reports.tsx
git commit -m "feat(quickbooks): all-time sync counts card in PressurePro Reports"
```

---

## Human verification (deferred — after deploy)

Not implementer tasks (need the running apps + a connected QB):
1. With QB connected: a synced invoice/quote shows the green "QB" chip; a failed one shows the red chip; the Unsynced tab/toggle lists only unsynced; the Reports card counts match.
2. With QB disconnected: none of the QB UI (chips, filter, card) appears.

## Notes for the implementer

- Only `qbo-sync-state.ts` (turf) is unit-tested. Everything else is verified by tsc + build; the chip/filter/card behavior is confirmed in the deferred human check.
- Do NOT add the qbo fields to PressurePro's `quoteToRow` — that would clobber the edge-function-owned columns on the next client quote save.
- Turf Tasks 1–3 and PressurePro Tasks 4–6 are separate branches in separate repos.
