# Track QuickBooks sync status in lists + reports (both apps) — design

Status: approved design, ready for implementation planning.
Date: 2026-07-01.

## Context

QuickBooks sync (Phase 2) is shipped: TurfPro syncs `invoices`, PressurePro syncs
`quotes`, both via the shared `quickbooks-sync` edge function. Each billable row
already carries the sync-state columns:
- TurfPro `invoices`: `qbo_invoice_id`, `qbo_synced_at`, `qbo_sync_error`
  (migration 0030; the `Invoice` type in `turf/src/lib/invoices.ts` already
  includes them, and `listInvoices` does `select("*")`).
- PressurePro `quotes`: same columns (migration 0031). BUT PressurePro loads
  quotes through a local store (`useQuotes()` in `pp/src/lib/store.ts`) whose
  `Quote` interface does NOT yet include the `qbo_*` fields, so they are dropped
  in the row→Quote mapping.

Operators want to see, at a glance, which billables have been pushed to
QuickBooks — in the list views and in Reports. No backend/DB changes needed;
this is a display + filter feature reading existing columns.

## Sync state

A single derivation, used everywhere:

```
qboSyncState(row): "synced" | "error" | "unsynced"
  synced   ← row.qbo_synced_at is set
  error    ← row.qbo_sync_error is set AND row.qbo_synced_at is null
  unsynced ← otherwise
```

(`synced` wins over a stale error: a successful re-sync sets `qbo_synced_at` and
clears `qbo_sync_error`, so `qbo_synced_at` set is authoritative.)

## Gating: only when QuickBooks is connected

All QuickBooks UI (row chips, the Unsynced filter, the Reports card) renders
ONLY when the operator has QuickBooks connected, via `getQuickBooksStatus()`
(`src/lib/quickbooks.ts`). This keeps lists/reports unchanged for non-users.
Resolve connection status once and share it:
- TurfPro: a `useQuery({ queryKey: ["quickbooks-status"], … })` (already the key
  used in InvoiceDetail — react-query dedupes across Invoices + Reports).
- PressurePro (no react-query for this): a small `useQuickBooksConnected()` hook
  backed by a module-level cached promise so `getQuickBooksStatus()` is called
  once per session, not once per component.

## Components

### 1. Pure state helper (per repo)

`qboSyncState(row: { qbo_synced_at: string | null; qbo_sync_error: string | null })`
returning `"synced" | "error" | "unsynced"`. Trivial and pure.
- TurfPro: `turf/src/lib/qbo-sync-state.ts` + a vitest test (turf has vitest).
- PressurePro: `pp/src/lib/qbo-sync-state.ts` (identical copy; PressurePro has no
  test runner, so it is verified by tsc/build — the logic is a 3-line ternary).

### 2. Row chip (per repo, rethemed)

A small chip component rendered on each list row:
- `synced` → subtle green chip, label "QB ✓" (title "Synced to QuickBooks").
- `error` → red chip, label "QB !" (title "QuickBooks sync failed").
- `unsynced` → renders nothing.

TurfPro: `turf/src/components/invoices/QbSyncChip.tsx` (ink/bronze/green tokens),
placed next to the existing status pill in the invoice row (`Invoices.tsx`).
PressurePro: `pp/src/components/QbSyncChip.tsx` (pp tokens — `success`/
`destructive`), placed near the `QStatus` chip in the quote row (`Quotes.tsx`).

### 3. Unsynced filter

A way to view only not-yet-synced billables (`qboSyncState === "unsynced"`).
- **TurfPro Invoices**: add an `"Unsynced"` segment to the existing
  `[All | Unpaid | Paid]` tab control (`STATUS_TABS` in `Invoices.tsx`). The
  segment appears only when connected. When active, show invoices whose
  `qboSyncState` is `"unsynced"` (regardless of payment status).
- **PressurePro Quotes**: add an equivalent "Unsynced" filter affordance matching
  that list's existing filter pattern (details in the plan after inspecting
  `Quotes.tsx`'s filter structure); appears only when connected; filters the
  sorted quote list to `unsynced` non-draft quotes.

### 4. Reports card (per repo)

A "QuickBooks" card in each app's Reports, shown only when connected:
- Content: **all-time** counts — "N synced · M not synced" plus an error count
  when any (`K sync error(s)`).
- TurfPro: across all of the operator's invoices. PressurePro: across all
  non-draft quotes.
- Styling matches the existing Reports cards (`tp-card` / `pp-card`).

### 5. PressurePro store plumbing

Add `qbo_synced_at: string | null` and `qbo_sync_error: string | null` to the
store's `Quote` interface (`pp/src/lib/store.ts`) and carry them in the row→Quote
mapping (the load path already does `select("*")`, so the columns arrive — they
just need to be mapped through). Do NOT write them from the client (the edge
function owns those columns); read-only on the client side. `quoteToRow` (the
upsert mapper) must NOT include them, so client quote saves never clobber the
edge-function-owned values.

## Data flow

- **Lists** already have the rows in hand: TurfPro `listInvoices` returns the
  `qbo_*` fields; PressurePro's store carries them after §5. Chips + the filter
  read them directly — no new fetch.
- **Reports counts** (all-time):
  - TurfPro: a lightweight query selecting `qbo_synced_at, qbo_sync_error` for all
    of the operator's invoices, counted client-side into synced/error/unsynced.
  - PressurePro: count from the quotes the store already holds (all non-draft
    quotes), client-side — no extra query.

## Error handling

- Connection-status fetch failure → treat as "not connected" (hide all QB UI);
  never block the list/report render.
- Reports count-query failure → hide the card (don't error the page).

## Testing

- Unit (vitest, turf): `qboSyncState` — synced (synced_at set), error (error set,
  no synced_at), unsynced (neither), and synced-wins (both set → synced).
- Manual: with QB connected, a synced invoice/quote shows the green chip; a
  failed one shows the red chip; the Unsynced tab/filter lists only unsynced; the
  Reports card counts match; with QB disconnected, none of the QB UI appears.

## Out of scope

- No backend, edge-function, or DB/migration changes (columns already exist).
- No auto-sync or bulk-sync action from the list (this is display + filter only).
- Time-windowed sync metrics (counts are all-time by decision).
- A PressurePro test runner (the one pure helper is trivially verified by build).

## Cross-repo note

- **turf repo**: `qbo-sync-state.ts` + test, `QbSyncChip`, Invoices list chip +
  Unsynced tab, Reports card.
- **PressurePro repo**: `qbo-sync-state.ts`, `QbSyncChip`, `useQuickBooksConnected`,
  store `Quote` plumbing, Quotes list chip + Unsynced filter, Reports card.
