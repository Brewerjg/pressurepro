# QuickBooks Phase 2 Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator push a TurfPro invoice — and each of its payments — into their connected QuickBooks Online company via a manual "Sync to QuickBooks" button.

**Architecture:** A new Deno edge function `quickbooks-sync` (op `sync_invoice`) orchestrates the push using a new shared `_shared/quickbooks.ts` (token refresh + authed QBO fetch) and a pure, unit-tested `_shared/quickbooks-map.ts` (line/payment mapping). Idempotency is by persisted QBO ids: `invoices.qbo_invoice_id` and per-row `manual_payments.qbo_payment_id`. A client wrapper `src/lib/quickbooks-sync.ts` and a button in `InvoiceDetail.tsx` drive it.

**Tech Stack:** Supabase edge functions (Deno, `esm.sh` supabase-js), React + TypeScript + @tanstack/react-query client, QuickBooks Online v3 REST API, vitest (new — for the pure mapper only).

## Global Constraints

- Migrations are **NOT** tracked by `supabase db push`. Apply with `supabase db query --linked -f <file>`. Every migration is idempotent (`IF NOT EXISTS`).
- Deploy functions with `supabase functions deploy <name>` (project already linked: `dkksryutecjbyuscpxdb`).
- Tokens/`qbo_*` columns are written **only** by service-role edge functions. `quickbooks_connections` / `quickbooks_oauth_states` have RLS on with no policies — never read them from the browser.
- QBO env is selected by the `QUICKBOOKS_ENV` secret (`sandbox` default). Data-API base: sandbox `https://sandbox-quickbooks.api.intuit.com/v3/company/{realm}`, production `https://quickbooks.api.intuit.com/v3/company/{realm}`.
- QBO OAuth token refresh: access ~1h, refresh ~100 days and **rotates** on each refresh — the new refresh_token MUST be persisted.
- Default QBO service item name: **"Landscaping Services"**.
- Money: `invoices.total` is NUMERIC dollars; `manual_payments.amount_cents` is integer cents (divide by 100 for QBO `TotalAmt`).
- Branch: `feature/quickbooks-sync` (already created). Commit messages end with the repo's `Co-Authored-By` / `Claude-Session` trailers.

---

### Task 1: Migration 0030 — sync id columns

**Files:**
- Create: `supabase/migrations/0030_quickbooks_sync.sql`

**Interfaces:**
- Produces (new columns later tasks rely on): `customers.qbo_customer_id TEXT`, `invoices.qbo_invoice_id TEXT` / `qbo_synced_at TIMESTAMPTZ` / `qbo_sync_error TEXT`, `manual_payments.qbo_payment_id TEXT`, `quickbooks_connections.qbo_default_item_id TEXT`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0030_quickbooks_sync.sql`:

```sql
-- 0030_quickbooks_sync.sql
--
-- QuickBooks Online Phase 2 (invoice + payment SYNC) support columns. Adds the
-- QBO entity-id caches that make the manual "Sync to QuickBooks" action
-- idempotent, plus the invoice-level sync state the button reads.
--
-- All columns are written ONLY by the service-role `quickbooks-sync` edge
-- function. No RLS changes: the qbo_* columns inherit each table's existing
-- policies (customers/invoices/manual_payments are operator-scoped; the client
-- never needs to write these).
--
-- APPLY (migrations are NOT tracked by `supabase db push`):
--   supabase db query --linked -f supabase/migrations/0030_quickbooks_sync.sql
-- Idempotent (ADD COLUMN IF NOT EXISTS) — safe to re-run.

-- Cache of the matched/created QBO Customer id (per operator's connected realm).
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS qbo_customer_id TEXT;

-- Invoice sync state + idempotency.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS qbo_invoice_id TEXT,
  ADD COLUMN IF NOT EXISTS qbo_synced_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qbo_sync_error TEXT;

-- Per-payment idempotency: which QBO Payment this row was posted as.
ALTER TABLE public.manual_payments
  ADD COLUMN IF NOT EXISTS qbo_payment_id TEXT;

-- Cache of the default "Landscaping Services" QBO Item id for this connection.
ALTER TABLE public.quickbooks_connections
  ADD COLUMN IF NOT EXISTS qbo_default_item_id TEXT;

-- ---------------------------------------------------------------------------
-- OAuth account-linking hardening (see Task 4). Two changes:
--   1) State rows get a TTL so a leaked state can't be replayed later.
--   2) A pending-grant table: the callback stores exchanged tokens keyed by a
--      claim_token delivered ONLY to the approving browser; an authenticated
--      `claim` call promotes the grant into quickbooks_connections under the
--      caller's user_id. This binds the connection to whoever actually
--      approved at Intuit, closing the account-linking hijack. Service-role
--      only (RLS on, no policies), matching the other quickbooks_* tables.
-- ---------------------------------------------------------------------------
ALTER TABLE public.quickbooks_oauth_states
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.quickbooks_pending_connections (
  claim_token      TEXT PRIMARY KEY,
  realm_id         TEXT NOT NULL,
  access_token     TEXT NOT NULL,
  refresh_token    TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes')
);
ALTER TABLE public.quickbooks_pending_connections ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply it against the linked project**

Run: `supabase db query --linked -f supabase/migrations/0030_quickbooks_sync.sql`
Expected: JSON with `"rows": []` and no `error` key.

- [ ] **Step 3: Verify the columns exist**

Run:
```bash
supabase db query --linked "select table_name, column_name from information_schema.columns where table_schema='public' and column_name like 'qbo_%' order by table_name, column_name;"
supabase db query --linked "select column_name from information_schema.columns where table_schema='public' and table_name='quickbooks_oauth_states' and column_name='expires_at'; select tablename, rowsecurity from pg_tables where tablename='quickbooks_pending_connections';"
```
Expected: first query → 6 rows (`customers.qbo_customer_id`, `invoices.qbo_invoice_id`, `invoices.qbo_sync_error`, `invoices.qbo_synced_at`, `manual_payments.qbo_payment_id`, `quickbooks_connections.qbo_default_item_id`). Second → `expires_at` present on `quickbooks_oauth_states`, and `quickbooks_pending_connections` exists with `rowsecurity = true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0030_quickbooks_sync.sql
git commit -m "feat(quickbooks): migration 0030 — sync id + state columns"
```

---

### Task 2: Pure mapping module + vitest

Sets up vitest (project has none) and the pure, network-free mapping logic. TDD.

**Files:**
- Create: `supabase/functions/_shared/quickbooks-map.ts`
- Create: `supabase/functions/_shared/quickbooks-map.test.ts`
- Create: `vitest.config.ts`
- Modify: `package.json` (add `test` script + vitest devDependency)

**Interfaces:**
- Produces (used by Task 4):
  - `type QboInvoiceLine = { Amount: number; DetailType: "SalesItemLineDetail"; Description: string; SalesItemLineDetail: { ItemRef: { value: string }; Qty: number; UnitPrice: number } }`
  - `parseInvoiceLines(raw: unknown): { name: string; qty: number; rate: number; total: number }[]`
  - `buildInvoiceLines(lines: ReturnType<typeof parseInvoiceLines>, itemId: string): QboInvoiceLine[]`
  - `buildPaymentPayload(amountCents: number, qboInvoiceId: string, customerRef: string): { CustomerRef: { value: string }; TotalAmt: number; Line: { Amount: number; LinkedTxn: { TxnId: string; TxnType: "Invoice" }[] }[] }`

- [ ] **Step 1: Add vitest to package.json**

Add to `devDependencies`: `"vitest": "^2.1.9"`. Add to `scripts`: `"test": "vitest run"`.

Run: `npm install`
Expected: installs vitest; `node_modules/.bin/vitest` exists.

- [ ] **Step 2: Create vitest config scoped to the pure test**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

// Scope vitest to our unit tests only. The edge functions are Deno modules
// (remote esm.sh imports, Deno globals) that vitest must never try to load;
// our one test imports only the pure, dependency-free quickbooks-map module.
export default defineConfig({
  test: {
    include: [
      "src/**/*.{test,spec}.ts",
      "supabase/functions/_shared/quickbooks-map.test.ts",
    ],
    environment: "node",
  },
});
```

- [ ] **Step 3: Write the failing test**

Create `supabase/functions/_shared/quickbooks-map.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseInvoiceLines,
  buildInvoiceLines,
  buildPaymentPayload,
} from "./quickbooks-map.ts";

describe("parseInvoiceLines", () => {
  it("normalizes the standard { name, qty, rate, total } shape", () => {
    const raw = [{ id: "a", name: "Spring cleanup", qty: 1, rate: 250, total: 250 }];
    expect(parseInvoiceLines(raw)).toEqual([
      { name: "Spring cleanup", qty: 1, rate: 250, total: 250 },
    ]);
  });

  it("synthesizes qty/rate/total from a legacy sqft × rate row", () => {
    const raw = [{ label: "Driveway", sqft: 100, rate: 0.5 }];
    expect(parseInvoiceLines(raw)).toEqual([
      { name: "Driveway", qty: 100, rate: 0.5, total: 50 },
    ]);
  });

  it("returns [] for non-array input", () => {
    expect(parseInvoiceLines(null)).toEqual([]);
    expect(parseInvoiceLines({})).toEqual([]);
  });
});

describe("buildInvoiceLines", () => {
  it("maps each line onto the default item with the name as description", () => {
    const lines = [{ name: "Mulch install", qty: 2, rate: 90, total: 180 }];
    expect(buildInvoiceLines(lines, "ITEM7")).toEqual([
      {
        Amount: 180,
        DetailType: "SalesItemLineDetail",
        Description: "Mulch install",
        SalesItemLineDetail: {
          ItemRef: { value: "ITEM7" },
          Qty: 2,
          UnitPrice: 90,
        },
      },
    ]);
  });
});

describe("buildPaymentPayload", () => {
  it("converts cents to dollars and links the payment to the invoice", () => {
    expect(buildPaymentPayload(15000, "INV42", "CUST9")).toEqual({
      CustomerRef: { value: "CUST9" },
      TotalAmt: 150,
      Line: [
        { Amount: 150, LinkedTxn: [{ TxnId: "INV42", TxnType: "Invoice" }] },
      ],
    });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./quickbooks-map.ts` (module not created yet).

- [ ] **Step 5: Write the pure mapping module**

Create `supabase/functions/_shared/quickbooks-map.ts`:

```ts
// quickbooks-map.ts
//
// PURE mapping helpers: TurfPro invoice data → QuickBooks Online request
// payloads. No Deno APIs, no remote imports, no network — so this module is
// unit-testable with vitest (see quickbooks-map.test.ts) and importable from
// the Deno `quickbooks-sync` edge function alike.

/** Normalized TurfPro line: what the mapper needs from invoices.lines. */
export interface ParsedLine {
  name: string;
  qty: number;
  rate: number;
  total: number;
}

/** A single QBO Invoice.Line (SalesItemLineDetail). */
export interface QboInvoiceLine {
  Amount: number;
  DetailType: "SalesItemLineDetail";
  Description: string;
  SalesItemLineDetail: {
    ItemRef: { value: string };
    Qty: number;
    UnitPrice: number;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Defensive parse of the invoices.lines JSONB into ParsedLine[]. Mirrors the
 * client parseLines (src/components/quotes/types.ts) but lives Deno-side so the
 * edge function is self-contained. Handles the standard { name, qty, rate,
 * total } rows and legacy PressurePro { label/surface, sqft, rate } rows.
 */
export function parseInvoiceLines(raw: unknown): ParsedLine[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedLine[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const isLegacy =
      typeof row.sqft === "number" &&
      typeof row.rate === "number" &&
      !("qty" in row);
    if (isLegacy) {
      const qty = Number(row.sqft) || 0;
      const rate = Number(row.rate) || 0;
      out.push({
        name: String(row.label ?? row.surface ?? "Line"),
        qty,
        rate,
        total: round2(qty * rate),
      });
      continue;
    }
    const qty = Number(row.qty) || 0;
    const rate = Number(row.rate) || 0;
    out.push({
      name: typeof row.name === "string" ? row.name : "Line",
      qty,
      rate,
      total: typeof row.total === "number" ? row.total : round2(qty * rate),
    });
  }
  return out;
}

/** Map parsed lines onto QBO invoice lines using one shared service item. */
export function buildInvoiceLines(
  lines: ParsedLine[],
  itemId: string,
): QboInvoiceLine[] {
  return lines.map((l) => ({
    Amount: round2(l.total),
    DetailType: "SalesItemLineDetail",
    Description: l.name,
    SalesItemLineDetail: {
      ItemRef: { value: itemId },
      Qty: l.qty,
      UnitPrice: l.rate,
    },
  }));
}

/** Build a QBO Payment payload applying `amountCents` to a QBO invoice. */
export function buildPaymentPayload(
  amountCents: number,
  qboInvoiceId: string,
  customerRef: string,
) {
  const amount = round2(amountCents / 100);
  return {
    CustomerRef: { value: customerRef },
    TotalAmt: amount,
    Line: [
      {
        Amount: amount,
        LinkedTxn: [{ TxnId: qboInvoiceId, TxnType: "Invoice" as const }],
      },
    ],
  };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all 5 tests green.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts supabase/functions/_shared/quickbooks-map.ts supabase/functions/_shared/quickbooks-map.test.ts
git commit -m "feat(quickbooks): pure line/payment mapper + vitest setup"
```

---

### Task 3: Shared QBO client module + refactor oauth

Extract token/fetch plumbing so `quickbooks-sync` and `quickbooks-oauth` share it.

**Files:**
- Create: `supabase/functions/_shared/quickbooks.ts`
- Modify: `supabase/functions/quickbooks-oauth/index.ts` (import `refreshIfNeeded` from shared; delete the local copy)

**Interfaces:**
- Consumes: `QUICKBOOKS_ENV`, `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` env.
- Produces (used by Task 4 and the refactored oauth):
  - `interface QbConnection { user_id; realm_id; access_token; refresh_token; token_expires_at: string | null; company_name: string | null; qbo_default_item_id?: string | null }`
  - `serviceClient(): SupabaseClient`
  - `loadConnection(svc, userId): Promise<QbConnection | null>`
  - `refreshIfNeeded(conn, svc): Promise<QbConnection>` (moved verbatim from oauth)
  - `qboApiBase(realmId: string): string`
  - `qboFetch(conn, path, init?): Promise<any>` — authed JSON call, throws on QBO `fault`/non-2xx.

- [ ] **Step 1: Create the shared module**

Create `supabase/functions/_shared/quickbooks.ts`:

```ts
// quickbooks.ts (shared)
//
// QBO connection + token + data-API plumbing shared by the quickbooks-oauth
// (Phase 1) and quickbooks-sync (Phase 2) edge functions. All DB access uses
// the service-role client so it can touch the RLS-locked quickbooks_connections
// table and the qbo_* columns.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

const INTUIT_TOKEN_URL =
  "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

export interface QbConnection {
  user_id: string;
  realm_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string | null;
  company_name: string | null;
  qbo_default_item_id?: string | null;
}

export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

function getClientCreds(): { clientId: string; clientSecret: string } {
  const clientId = Deno.env.get("QUICKBOOKS_CLIENT_ID");
  const clientSecret = Deno.env.get("QUICKBOOKS_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error(
      "QuickBooks is not configured — set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET",
    );
  }
  return { clientId, clientSecret };
}

/** QBO data-API base for the given realm, selected by QUICKBOOKS_ENV. */
export function qboApiBase(realmId: string): string {
  const env = (Deno.env.get("QUICKBOOKS_ENV") ?? "sandbox").toLowerCase();
  const host =
    env === "production"
      ? "https://quickbooks.api.intuit.com"
      : "https://sandbox-quickbooks.api.intuit.com";
  return `${host}/v3/company/${realmId}`;
}

/** Load the operator's connection row (service-role). Null when absent. */
export async function loadConnection(
  svc: ReturnType<typeof serviceClient>,
  userId: string,
): Promise<QbConnection | null> {
  const { data, error } = await svc
    .from("quickbooks_connections")
    .select(
      "user_id, realm_id, access_token, refresh_token, token_expires_at, company_name, qbo_default_item_id",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as QbConnection | null) ?? null;
}

async function intuitTokenRequest(
  params: Record<string, string>,
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const { clientId, clientSecret } = getClientCreds();
  const basic = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(INTUIT_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    throw new Error(`Intuit token request failed (${res.status}): ${await res.text()}`);
  }
  return await res.json();
}

/**
 * Guarantee a live access token. Refreshes when expired or within a 5-min
 * window, persisting the ROTATED refresh_token. Returns the fresh connection.
 */
export async function refreshIfNeeded(
  conn: QbConnection,
  svc: ReturnType<typeof serviceClient>,
): Promise<QbConnection> {
  const SKEW_MS = 5 * 60 * 1000;
  const expiresAt = conn.token_expires_at
    ? new Date(conn.token_expires_at).getTime()
    : 0;
  if (expiresAt - SKEW_MS > Date.now()) return conn;

  const tokens = await intuitTokenRequest({
    grant_type: "refresh_token",
    refresh_token: conn.refresh_token,
  });
  const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const updated: QbConnection = {
    ...conn,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expires_at: tokenExpiresAt,
  };
  await svc
    .from("quickbooks_connections")
    .update({
      access_token: updated.access_token,
      refresh_token: updated.refresh_token,
      token_expires_at: updated.token_expires_at,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("user_id", conn.user_id);
  return updated;
}

/**
 * Authenticated JSON call against the QBO data API. `path` is relative to the
 * company base (e.g. "/invoice" or "/query?query=..."). Throws a clean Error
 * carrying the QBO fault message on any non-2xx.
 */
export async function qboFetch(
  conn: QbConnection,
  path: string,
  init: RequestInit = {},
): Promise<any> {
  const url = `${qboApiBase(conn.realm_id)}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${conn.access_token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = j?.Fault?.Error?.[0]?.Message
        ? `${j.Fault.Error[0].Message}${j.Fault.Error[0].Detail ? ` — ${j.Fault.Error[0].Detail}` : ""}`
        : text;
    } catch {
      // keep raw text
    }
    throw new Error(`QBO ${res.status}: ${msg}`);
  }
  return text ? JSON.parse(text) : {};
}
```

- [ ] **Step 2: Refactor `quickbooks-oauth` to use the shared refresh helper**

In `supabase/functions/quickbooks-oauth/index.ts`:

Delete the local `refreshIfNeeded` function (the block from `async function refreshIfNeeded(` through its closing `}`) and the trailing `void refreshIfNeeded;` line at the end of the file. Keep the local `QbConnection` interface only if still referenced; if the only remaining use is the refresh helper, delete it too.

Add to the imports at the top (after the existing `_shared/cors.ts` import):

```ts
import { refreshIfNeeded } from "../_shared/quickbooks.ts";
```

> Note: `refreshIfNeeded` is currently only referenced via `void refreshIfNeeded;` (kept for Phase 2). After importing from shared and removing both the local copy and the `void` line, there are no remaining callers in this file — that is expected; Phase 2 (`quickbooks-sync`) is the caller. Keep the import out if it would be unused; instead simply delete the local copy and the `void` line, and do NOT add the import here. (The shared module stands alone.)

Concretely: **delete** the local `refreshIfNeeded` definition and the `void refreshIfNeeded;` line; do **not** add an import. Leave everything else unchanged.

- [ ] **Step 3: Deploy the refactored oauth function**

Run: `supabase functions deploy quickbooks-oauth`
Expected: `Deployed Functions.` with no bundling error (proves the shared module import graph still bundles).

- [ ] **Step 4: Smoke-test that oauth still works**

Run:
```bash
curl -s -i "https://dkksryutecjbyuscpxdb.supabase.co/functions/v1/quickbooks-oauth?op=callback" | grep -iE "^HTTP|^location:"
```
Expected: `HTTP/1.1 302 Found` and `Location: https://turf-jade.vercel.app/settings?quickbooks=error` (unchanged behavior).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/quickbooks.ts supabase/functions/quickbooks-oauth/index.ts
git commit -m "refactor(quickbooks): extract shared QBO client module"
```

---

### Task 3B: OAuth account-linking hardening (claim flow + state TTL)

Closes the account-linking hijack flagged by security review. The `callback` no
longer writes `quickbooks_connections` directly; it stores a **pending** grant
keyed by a `claim_token` and redirects with that token. Only an authenticated
`claim` call promotes the grant into the caller's connection — binding it to
whoever actually approved at Intuit. State rows also get a 10-min TTL.

**Files:**
- Modify: `supabase/functions/quickbooks-oauth/index.ts`
- Modify: `src/lib/quickbooks.ts` (add `claimQuickBooks`)
- Modify: `src/components/settings/QuickBooksCard.tsx` (handle `?quickbooks=claim`)

**Interfaces:**
- Depends on Task 1 schema (`quickbooks_oauth_states.expires_at`, `quickbooks_pending_connections`).
- Produces: `claim` op — POST `{ action: "claim", claim_token }` (auth required) → `{ ok: true, connected: true }`; client `claimQuickBooks(token: string): Promise<void>`.

- [ ] **Step 1: Add `claim` to the op union**

In `supabase/functions/quickbooks-oauth/index.ts`, update the `Op` type and the `getOp` guard to include `"claim"`:

```ts
type Op = "authorize" | "callback" | "status" | "disconnect" | "claim";
```

and in `getOp`, add `candidate === "claim" ||` to the accepted list.

- [ ] **Step 2: Give the CSRF state a TTL at `authorize`**

In the `authorize` op, change the state insert to stamp `expires_at`:

```ts
      const { error: stateErr } = await svc
        .from("quickbooks_oauth_states")
        .insert({
          state,
          user_id: userId,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        } as never);
```

- [ ] **Step 3: Rework `callback` to store a pending grant + redirect with a claim token**

In the `callback` op, after deleting the state row, add a TTL check, and replace the `quickbooks_connections` upsert with a `quickbooks_pending_connections` insert. Replace the state lookup + exchange + upsert block with:

```ts
      // Look up state → validate TTL → delete (single-use CSRF token).
      const { data: stateRow, error: stateErr } = await svc
        .from("quickbooks_oauth_states")
        .select("user_id, expires_at")
        .eq("state", state)
        .maybeSingle();
      if (stateErr || !stateRow) {
        console.error("QuickBooks callback: unknown state", stateErr);
        return redirectToApp(origin, "quickbooks=error");
      }
      const expiresAt = (stateRow as { expires_at: string | null }).expires_at;
      await svc.from("quickbooks_oauth_states").delete().eq("state", state);
      if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
        console.error("QuickBooks callback: state expired");
        return redirectToApp(origin, "quickbooks=error");
      }

      // Exchange the authorization code for tokens.
      const tokens = await intuitTokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: getRedirectUri(),
      });
      const tokenExpiresAt = new Date(
        Date.now() + tokens.expires_in * 1000,
      ).toISOString();

      // Store as a PENDING grant keyed by a claim_token. The connection is NOT
      // active until an authenticated `claim` call promotes it — binding it to
      // whoever approved at Intuit (this browser), not the state initiator.
      const claimToken =
        crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
      const { error: pendErr } = await svc
        .from("quickbooks_pending_connections")
        .insert({
          claim_token: claimToken,
          realm_id: realmId,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: tokenExpiresAt,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        } as never);
      if (pendErr) {
        console.error("QuickBooks callback: pending insert failed", pendErr);
        return redirectToApp(origin, "quickbooks=error");
      }

      return redirectToApp(
        origin,
        `quickbooks=claim&token=${encodeURIComponent(claimToken)}`,
      );
```

> Note: the old block referenced `userId` from the state row for the direct
> upsert. It is intentionally gone — the pending grant carries no user; the
> claiming session supplies the user.

- [ ] **Step 4: Add the `claim` op**

In the auth-required section (after the `disconnect` op block, before the final `return jsonResponse({ error: "Unhandled op" }...)`), add:

```ts
    // -------------------------------------------------------------------
    // OP: claim — promote a pending grant into this user's connection.
    // Binds the QBO company to whoever approved at Intuit (holds the token).
    // -------------------------------------------------------------------
    if (op === "claim") {
      const claimToken =
        typeof body.claim_token === "string" ? body.claim_token : "";
      if (!claimToken) {
        return jsonResponse({ error: "Missing claim token" }, { status: 400 });
      }
      const { data: pending, error: pendErr } = await svc
        .from("quickbooks_pending_connections")
        .select("realm_id, access_token, refresh_token, token_expires_at, expires_at")
        .eq("claim_token", claimToken)
        .maybeSingle();
      if (pendErr) {
        return jsonResponse({ error: "Could not load pending connection" }, { status: 500 });
      }
      if (!pending) {
        return jsonResponse({ error: "Connection request not found or already used" }, { status: 400 });
      }
      const p = pending as {
        realm_id: string;
        access_token: string;
        refresh_token: string;
        token_expires_at: string | null;
        expires_at: string;
      };
      // Consume it regardless of outcome (single-use).
      await svc
        .from("quickbooks_pending_connections")
        .delete()
        .eq("claim_token", claimToken);
      if (new Date(p.expires_at).getTime() < Date.now()) {
        return jsonResponse({ error: "Connection request expired — please reconnect" }, { status: 400 });
      }

      const { error: upsertErr } = await svc
        .from("quickbooks_connections")
        .upsert(
          {
            user_id: userId,
            realm_id: p.realm_id,
            access_token: p.access_token,
            refresh_token: p.refresh_token,
            token_expires_at: p.token_expires_at,
            connected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: "user_id" },
        );
      if (upsertErr) {
        console.error("QuickBooks claim upsert failed:", upsertErr);
        return jsonResponse({ error: "Could not finish connecting QuickBooks" }, { status: 500 });
      }
      return jsonResponse({ ok: true, connected: true });
    }
```

- [ ] **Step 5: Deploy and smoke-test**

Run: `supabase functions deploy quickbooks-oauth`
Then: `curl -s -i "https://dkksryutecjbyuscpxdb.supabase.co/functions/v1/quickbooks-oauth?op=callback" | grep -iE "^HTTP|^location:"`
Expected: still `302` → `…/settings?quickbooks=error` (no code/state → error path unchanged).

- [ ] **Step 6: Add the client `claimQuickBooks` helper**

In `src/lib/quickbooks.ts`, add:

```ts
/**
 * Finish a QuickBooks connection by spending the one-time claim token the
 * callback delivered to this browser. Binds the connection to the signed-in
 * operator. Throws on failure.
 */
export async function claimQuickBooks(token: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("quickbooks-oauth", {
    body: { action: "claim", claim_token: token },
  });
  if (error) throw new Error(error.message);
  const payload = data as { ok?: boolean; error?: string };
  if (payload?.error || !payload?.ok) {
    throw new Error(payload?.error || "Could not finish connecting QuickBooks");
  }
}
```

- [ ] **Step 7: Handle `?quickbooks=claim` in the settings card**

In `src/components/settings/QuickBooksCard.tsx`, import `claimQuickBooks` and rework the mount effect so that a `claim` param spends the token before refreshing status. Replace the URL-param handling inside the existing `useEffect` with:

```tsx
    (async () => {
      let note: "connected" | "error" | null = null;
      try {
        const params = new URLSearchParams(window.location.search);
        const qb = params.get("quickbooks");
        const token = params.get("token");
        if (qb === "claim" && token) {
          try {
            await claimQuickBooks(token);
            note = "connected";
          } catch {
            note = "error";
          }
        } else if (qb === "connected" || qb === "error") {
          note = qb;
        }
        if (qb) {
          params.delete("quickbooks");
          params.delete("token");
          const next =
            window.location.pathname +
            (params.toString() ? `?${params.toString()}` : "");
          window.history.replaceState({}, "", next);
        }
      } catch {
        // ignore — non-browser env
      }
      if (note) setRedirectNote(note);
      refresh();
    })();
```

(Keep the `// eslint-disable-next-line react-hooks/exhaustive-deps` and `[]` deps.)

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: End-to-end re-test of connect (the flow the hardening changes)**

Run `npm run dev`, sign in, Settings → Integrations → Connect QuickBooks. Approve at Intuit. Expected: redirected back with `?quickbooks=claim&token=…`, the card spends it, flips to **Connected ✓**, and a `quickbooks_connections` row exists for your user:

```bash
supabase db query --linked "select user_id, realm_id from public.quickbooks_connections;"
supabase db query --linked "select count(*) from public.quickbooks_pending_connections;"
```
Expected: your connection row present; pending count `0` (claim consumed it).

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/quickbooks-oauth/index.ts src/lib/quickbooks.ts src/components/settings/QuickBooksCard.tsx
git commit -m "fix(quickbooks): bind OAuth connection to approver via claim token + state TTL"
```

---

### Task 4: `quickbooks-sync` edge function

**Files:**
- Create: `supabase/functions/quickbooks-sync/index.ts`

**Interfaces:**
- Consumes: `_shared/cors.ts` (`handleOptions`, `jsonResponse`), `_shared/quickbooks.ts` (`serviceClient`, `loadConnection`, `refreshIfNeeded`, `qboFetch`, `QbConnection`), `_shared/quickbooks-map.ts` (`parseInvoiceLines`, `buildInvoiceLines`, `buildPaymentPayload`).
- Produces (client contract, used by Task 5): POST body `{ action: "sync_invoice", invoice_id: string }` → `{ ok: true, qbo_invoice_id: string, payments_synced: number }` on success; `{ error: string }` with a non-2xx status on failure.

- [ ] **Step 1: Write the function**

Create `supabase/functions/quickbooks-sync/index.ts`:

```ts
// quickbooks-sync
//
// QuickBooks Online Phase 2 — push a TurfPro invoice and its payments into the
// operator's connected QBO company. One op: sync_invoice { invoice_id }.
//
// Auth: resolves the operator from the Authorization header (JWT-scoped
// client), like quickbooks-oauth. All QBO/token work uses the service-role
// client via the shared module. Idempotent by persisted QBO ids:
//   invoices.qbo_invoice_id (create-once) and manual_payments.qbo_payment_id
//   (one QBO Payment per non-voided row, skipped once posted).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  serviceClient,
  loadConnection,
  refreshIfNeeded,
  qboFetch,
  type QbConnection,
} from "../_shared/quickbooks.ts";
import {
  parseInvoiceLines,
  buildInvoiceLines,
  buildPaymentPayload,
} from "../_shared/quickbooks-map.ts";

const DEFAULT_ITEM_NAME = "Landscaping Services";

async function resolveUser(req: Request): Promise<{ id: string } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const anonKey =
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    "";
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id };
}

// Escape a value for a QBO SQL-ish query string (single quotes doubled).
const q = (s: string) => s.replace(/'/g, "''");

/** Resolve (and cache) the default service item id for this connection. */
async function resolveDefaultItem(
  conn: QbConnection,
  svc: ReturnType<typeof serviceClient>,
): Promise<string> {
  if (conn.qbo_default_item_id) return conn.qbo_default_item_id;

  // 1) Reuse an existing item with our name if present.
  const found = await qboFetch(
    conn,
    `/query?query=${encodeURIComponent(
      `select Id from Item where Name = '${q(DEFAULT_ITEM_NAME)}'`,
    )}&minorversion=65`,
  );
  let itemId: string | undefined = found?.QueryResponse?.Item?.[0]?.Id;

  // 2) Otherwise create it, referencing the first Income account.
  if (!itemId) {
    const acct = await qboFetch(
      conn,
      `/query?query=${encodeURIComponent(
        "select Id from Account where AccountType = 'Income'",
      )}&minorversion=65`,
    );
    const incomeAccountId: string | undefined =
      acct?.QueryResponse?.Account?.[0]?.Id;
    if (!incomeAccountId) {
      throw new Error("No Income account found in QuickBooks to back the service item");
    }
    const created = await qboFetch(conn, `/item?minorversion=65`, {
      method: "POST",
      body: JSON.stringify({
        Name: DEFAULT_ITEM_NAME,
        Type: "Service",
        IncomeAccountRef: { value: incomeAccountId },
      }),
    });
    itemId = created?.Item?.Id;
    if (!itemId) throw new Error("Failed to create default QuickBooks service item");
  }

  await svc
    .from("quickbooks_connections")
    .update({ qbo_default_item_id: itemId } as never)
    .eq("user_id", conn.user_id);
  return itemId;
}

interface InvoiceRow {
  id: string;
  user_id: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string | null;
  phone: string | null;
  address: string | null;
  lines: unknown;
  qbo_invoice_id: string | null;
}

/** Find-or-create the QBO Customer for this invoice; cache id when possible. */
async function resolveCustomer(
  conn: QbConnection,
  svc: ReturnType<typeof serviceClient>,
  invoice: InvoiceRow,
): Promise<string> {
  // Cached on the customers row?
  if (invoice.customer_id) {
    const { data: cust } = await svc
      .from("customers")
      .select("qbo_customer_id")
      .eq("id", invoice.customer_id)
      .maybeSingle();
    const cached = (cust as { qbo_customer_id?: string } | null)?.qbo_customer_id;
    if (cached) return cached;
  }

  // Match by DisplayName, then email.
  const name = invoice.customer_name?.trim() || "Customer";
  let match = await qboFetch(
    conn,
    `/query?query=${encodeURIComponent(
      `select Id from Customer where DisplayName = '${q(name)}'`,
    )}&minorversion=65`,
  );
  let customerId: string | undefined = match?.QueryResponse?.Customer?.[0]?.Id;

  if (!customerId && invoice.customer_email) {
    match = await qboFetch(
      conn,
      `/query?query=${encodeURIComponent(
        `select Id from Customer where PrimaryEmailAddr = '${q(invoice.customer_email)}'`,
      )}&minorversion=65`,
    );
    customerId = match?.QueryResponse?.Customer?.[0]?.Id;
  }

  // Create if still not found.
  if (!customerId) {
    const body: Record<string, unknown> = { DisplayName: name };
    if (invoice.customer_email) body.PrimaryEmailAddr = { Address: invoice.customer_email };
    if (invoice.phone) body.PrimaryPhone = { FreeFormNumber: invoice.phone };
    if (invoice.address) body.BillAddr = { Line1: invoice.address };
    const created = await qboFetch(conn, `/customer?minorversion=65`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    customerId = created?.Customer?.Id;
    if (!customerId) throw new Error("Failed to create QuickBooks customer");
  }

  if (invoice.customer_id) {
    await svc
      .from("customers")
      .update({ qbo_customer_id: customerId } as never)
      .eq("id", invoice.customer_id);
  }
  return customerId;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await req.json().catch(() => ({}));
  if (body?.action !== "sync_invoice" || typeof body?.invoice_id !== "string") {
    return jsonResponse({ error: "Expected { action: 'sync_invoice', invoice_id }" }, { status: 400 });
  }
  const invoiceId = body.invoice_id as string;

  const user = await resolveUser(req);
  if (!user) return jsonResponse({ error: "Unauthorized" }, { status: 401 });

  const svc = serviceClient();

  // Load the invoice, scoped to this operator.
  const { data: invData, error: invErr } = await svc
    .from("invoices")
    .select("id, user_id, customer_id, customer_name, customer_email, phone, address, lines, qbo_invoice_id")
    .eq("id", invoiceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (invErr) return jsonResponse({ error: invErr.message }, { status: 500 });
  if (!invData) return jsonResponse({ error: "Invoice not found" }, { status: 404 });
  const invoice = invData as InvoiceRow;

  try {
    let conn = await loadConnection(svc, user.id);
    if (!conn) return jsonResponse({ error: "QuickBooks is not connected" }, { status: 400 });
    conn = await refreshIfNeeded(conn, svc);

    const itemId = await resolveDefaultItem(conn, svc);
    const customerRef = await resolveCustomer(conn, svc, invoice);

    // Create the QBO invoice once.
    let qboInvoiceId = invoice.qbo_invoice_id ?? null;
    if (!qboInvoiceId) {
      const lines = buildInvoiceLines(parseInvoiceLines(invoice.lines), itemId);
      if (lines.length === 0) throw new Error("Invoice has no line items to sync");
      const createdInv = await qboFetch(conn, `/invoice?minorversion=65`, {
        method: "POST",
        body: JSON.stringify({ CustomerRef: { value: customerRef }, Line: lines }),
      });
      qboInvoiceId = createdInv?.Invoice?.Id ?? null;
      if (!qboInvoiceId) throw new Error("Failed to create QuickBooks invoice");
      await svc
        .from("invoices")
        .update({ qbo_invoice_id: qboInvoiceId } as never)
        .eq("id", invoice.id);
    }

    // Mirror each non-voided, not-yet-synced payment.
    const { data: pays, error: payErr } = await svc
      .from("manual_payments")
      .select("id, amount_cents")
      .eq("invoice_id", invoice.id)
      .neq("status", "voided")
      .is("qbo_payment_id", null);
    if (payErr) throw new Error(payErr.message);

    let paymentsSynced = 0;
    for (const p of (pays ?? []) as { id: string; amount_cents: number }[]) {
      const payload = buildPaymentPayload(p.amount_cents, qboInvoiceId, customerRef);
      const createdPay = await qboFetch(conn, `/payment?minorversion=65`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const paymentId = createdPay?.Payment?.Id;
      if (!paymentId) throw new Error("Failed to create QuickBooks payment");
      await svc
        .from("manual_payments")
        .update({ qbo_payment_id: paymentId } as never)
        .eq("id", p.id);
      paymentsSynced += 1;
    }

    await svc
      .from("invoices")
      .update({ qbo_synced_at: new Date().toISOString(), qbo_sync_error: null } as never)
      .eq("id", invoice.id);

    return jsonResponse({ ok: true, qbo_invoice_id: qboInvoiceId, payments_synced: paymentsSynced });
  } catch (e) {
    const message = e instanceof Error ? e.message : "QuickBooks sync failed";
    await svc
      .from("invoices")
      .update({ qbo_sync_error: message } as never)
      .eq("id", invoice.id);
    console.error("quickbooks-sync error:", message);
    return jsonResponse({ error: message }, { status: 500 });
  }
});
```

- [ ] **Step 2: Deploy the function**

Run: `supabase functions deploy quickbooks-sync`
Expected: `Deployed Functions.` with no bundling error.

- [ ] **Step 3: Smoke-test the auth gate (no JWT → 401)**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://dkksryutecjbyuscpxdb.supabase.co/functions/v1/quickbooks-sync" -H "Content-Type: application/json" -d '{"action":"sync_invoice","invoice_id":"00000000-0000-0000-0000-000000000000"}'
```
Expected: `401` (function is reachable; unauthenticated request rejected). If Supabase's gateway rejects the missing JWT before the function runs, `401` is still the expected code.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/quickbooks-sync/index.ts
git commit -m "feat(quickbooks): quickbooks-sync edge function (sync_invoice)"
```

---

### Task 5: Client sync wrapper + Invoice type fields

**Files:**
- Create: `src/lib/quickbooks-sync.ts`
- Modify: `src/lib/invoices.ts` (add `qbo_*` fields to the `Invoice` interface)

**Interfaces:**
- Consumes: `@/integrations/supabase/client` (`supabase.functions.invoke`).
- Produces (used by Task 6):
  - `Invoice` gains `qbo_invoice_id: string | null; qbo_synced_at: string | null; qbo_sync_error: string | null`
  - `syncInvoiceToQuickBooks(invoiceId: string): Promise<{ ok: true; qbo_invoice_id: string; payments_synced: number }>` (throws `Error` on failure)

- [ ] **Step 1: Extend the Invoice interface**

In `src/lib/invoices.ts`, add these fields to the `Invoice` interface (after `updated_at: string;`):

```ts
  qbo_invoice_id: string | null;
  qbo_synced_at: string | null;
  qbo_sync_error: string | null;
```

- [ ] **Step 2: Write the client wrapper**

Create `src/lib/quickbooks-sync.ts`:

```ts
// quickbooks-sync.ts
//
// Client wrapper around the `quickbooks-sync` edge function. Pushes a TurfPro
// invoice (and its payments) into the operator's connected QuickBooks company.
// Throws on failure, matching src/lib/quickbooks.ts.

import { supabase } from "@/integrations/supabase/client";

export interface SyncInvoiceResult {
  ok: true;
  qbo_invoice_id: string;
  payments_synced: number;
}

export async function syncInvoiceToQuickBooks(
  invoiceId: string,
): Promise<SyncInvoiceResult> {
  const { data, error } = await supabase.functions.invoke("quickbooks-sync", {
    body: { action: "sync_invoice", invoice_id: invoiceId },
  });
  if (error) throw new Error(error.message);
  const payload = data as {
    ok?: boolean;
    qbo_invoice_id?: string;
    payments_synced?: number;
    error?: string;
  };
  if (payload?.error || !payload?.ok) {
    throw new Error(payload?.error || "QuickBooks sync failed");
  }
  return {
    ok: true,
    qbo_invoice_id: payload.qbo_invoice_id ?? "",
    payments_synced: payload.payments_synced ?? 0,
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/quickbooks-sync.ts src/lib/invoices.ts
git commit -m "feat(quickbooks): client sync wrapper + Invoice qbo_* fields"
```

---

### Task 6: "Sync to QuickBooks" button in InvoiceDetail

**Files:**
- Modify: `src/pages/InvoiceDetail.tsx`

**Interfaces:**
- Consumes: `syncInvoiceToQuickBooks` (Task 5), `getQuickBooksStatus` (`src/lib/quickbooks.ts`), the invoice's `qbo_invoice_id` / `qbo_synced_at` / `qbo_sync_error`.

- [ ] **Step 1: Add imports**

In `src/pages/InvoiceDetail.tsx`, add after the existing `@/lib/quickbooks`-adjacent imports:

```ts
import { getQuickBooksStatus } from "@/lib/quickbooks";
import { syncInvoiceToQuickBooks } from "@/lib/quickbooks-sync";
```

Ensure `Calculator` is imported from `lucide-react` (add it to the existing lucide import list if absent).

- [ ] **Step 2: Add the QB-connected query and the sync mutation**

Inside the `InvoiceDetail` component, alongside the other `useQuery`/`useMutation` hooks (after the existing `update` mutation), add:

```tsx
  const { data: qbStatus } = useQuery({
    queryKey: ["quickbooks-status"],
    queryFn: getQuickBooksStatus,
    staleTime: 5 * 60 * 1000,
  });

  const [qbError, setQbError] = useState<string | null>(null);
  const syncQb = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("Missing invoice id");
      return syncInvoiceToQuickBooks(id);
    },
    onSuccess: () => {
      setQbError(null);
      queryClient.invalidateQueries({ queryKey: ["invoice", id] });
    },
    onError: (e: unknown) => {
      setQbError(e instanceof Error ? e.message : "QuickBooks sync failed");
      queryClient.invalidateQueries({ queryKey: ["invoice", id] });
    },
  });
```

(`useState` and `useMutation`/`useQuery`/`queryClient` are already imported/available in this file — reuse them.)

- [ ] **Step 3: Render the button**

In the actions `section` (the grid that holds "Customer link" and "Print"), add a full-width row below the grid, shown only when QB is connected:

```tsx
      {qbStatus?.connected && (
        <section className="mx-4 mb-3">
          <button
            type="button"
            onClick={() => syncQb.mutate()}
            disabled={syncQb.isPending}
            className="w-full rounded-[14px] border border-ink-200 bg-card text-ink-700 font-semibold text-[13px] py-3 hover:bg-ink-100 transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            <Calculator className="h-3.5 w-3.5" />
            {syncQb.isPending
              ? "Syncing to QuickBooks…"
              : invoice.qbo_synced_at
                ? "Synced to QuickBooks ✓ — sync again"
                : "Sync to QuickBooks"}
          </button>
          {invoice.qbo_synced_at && !qbError && (
            <p className="mt-1 text-[11px] text-ink-500">
              Last synced {fmtDate(invoice.qbo_synced_at)}.
            </p>
          )}
          {(qbError || invoice.qbo_sync_error) && (
            <p className="mt-1 text-[11px] font-semibold text-destructive">
              {qbError || invoice.qbo_sync_error}
            </p>
          )}
        </section>
      )}
```

(`fmtDate` is the existing date formatter in this file — reuse it. If its name differs, use the local formatter already used for `issued_at`.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/InvoiceDetail.tsx
git commit -m "feat(quickbooks): Sync to QuickBooks button on invoice screen"
```

---

### Task 7: End-to-end sandbox verification + docs

**Files:**
- Modify: `docs/QUICKBOOKS_SETUP.md` (mark Phase 2 built; add sync/apply notes)

**Interfaces:** none (verification + docs).

- [ ] **Step 1: Run the dev app and do a full sandbox pass**

Run: `npm run dev`, sign in as the operator whose QBO sandbox is connected, open an invoice.

Verify, in order:
1. With QB connected, the "Sync to QuickBooks" button is visible; tap it → button shows "Syncing…", then "Synced to QuickBooks ✓".
2. In the QBO sandbox company (Sales → Invoices), the invoice appears with the correct customer, line descriptions, and total.
3. Record a cash payment on the invoice (existing "Record payment" flow), then tap Sync again → in QBO the invoice shows the payment applied / status Paid.
4. Tap Sync a third time → no duplicate invoice and no duplicate payment appear in QBO (idempotency), button still reads Synced ✓.

- [ ] **Step 2: Verify persisted ids in the database**

Run:
```bash
supabase db query --linked "select id, qbo_invoice_id, qbo_synced_at, qbo_sync_error from public.invoices where qbo_invoice_id is not null order by qbo_synced_at desc limit 5;"
```
Expected: the synced invoice has a non-null `qbo_invoice_id`, a recent `qbo_synced_at`, and `qbo_sync_error` null.

- [ ] **Step 3: Update the setup doc**

In `docs/QUICKBOOKS_SETUP.md`, change the Phase 2 section heading from "NOT built yet" to built, and add an "Apply / deploy" note:

```markdown
## Phase 2 — invoice / payment sync (BUILT)

Implemented as the `quickbooks-sync` edge function (op `sync_invoice`). The
operator taps **Sync to QuickBooks** on an invoice; the function find-or-creates
the QB customer and a single "Landscaping Services" service item, creates the QB
invoice once (`invoices.qbo_invoice_id`), and mirrors each non-voided
`manual_payments` row as a QB Payment (`manual_payments.qbo_payment_id`) —
idempotent on re-sync.

**Apply / deploy:**

    supabase db query --linked -f supabase/migrations/0030_quickbooks_sync.sql
    supabase functions deploy quickbooks-sync

Known limitations (v1): voiding an already-synced payment is not reversed in QB;
editing invoice lines after first sync does not update the QB invoice
(create-once); cached qbo_* ids are realm-specific and are not cleared on
disconnect.
```

- [ ] **Step 4: Commit**

```bash
git add docs/QUICKBOOKS_SETUP.md
git commit -m "docs(quickbooks): mark Phase 2 sync built + apply/deploy notes"
```

---

## Notes for the implementer

- **QBO `minorversion=65`** is pinned on data-API calls for a stable field set; leave it as written.
- **Do not** attempt to unit-test the edge function or client — the project has no Deno/browser test harness. Only `quickbooks-map.ts` is unit-tested (Task 2). Everything else is verified via the sandbox pass (Task 7).
- If `supabase functions deploy` warns `config section [inbucket] is deprecated`, ignore it — pre-existing and harmless.
- The uncommitted Phase-1 frontend + the localhost link fix already present in the working tree are unrelated to these tasks; leave them for a separate commit unless the reviewer says otherwise.
