# QuickBooks Online setup (connect foundation)

How a TurfPro operator connects their **QuickBooks Online (QBO) company** so
TurfPro can (eventually) push invoices and payments into QuickBooks.

This is **Phase 1 — the OAuth2 connection only**. The operator connects their
QB company from **Settings → Integrations**; the access/refresh tokens are
stored server-side; status and disconnect work. The actual invoice/payment
**sync is Phase 2** (sketched at the bottom of this doc) and is intentionally
not built yet.

## The model

- The operator runs the standard Intuit **Authorization-Code** OAuth2 flow.
  They approve TurfPro against **their** QuickBooks company ("realm").
- TurfPro stores the resulting `access_token` / `refresh_token` /
  `token_expires_at` / `realm_id` in `public.quickbooks_connections`,
  keyed by `user_id`.
- The browser **never sees the tokens**. Both `quickbooks_*` tables have RLS
  enabled with **no policies**, so only the service-role edge function can
  read/write them. The client learns connection status only via the
  `quickbooks-oauth` function's `status` op.
- Tokens are touched exclusively by the `quickbooks-oauth` edge function.

## 1. Create an Intuit Developer app

1. Sign in at <https://developer.intuit.com> and create an app under
   **QuickBooks Online and Payments**.
2. From the app's **Keys & credentials**, copy the **Client ID** and
   **Client Secret** (there are separate sandbox and production keysets —
   start with the **Development/sandbox** keys).
3. Under **Redirect URIs**, register **exactly** this URL (byte-for-byte —
   Intuit rejects mismatches):

   ```
   {SUPABASE_URL}/functions/v1/quickbooks-oauth?op=callback
   ```

   e.g. `https://abcdxyz.supabase.co/functions/v1/quickbooks-oauth?op=callback`

4. Scope used by TurfPro: **`com.intuit.quickbooks.accounting`**.

## 2. Set edge-function secrets (Supabase)

Set these on the Supabase project (Dashboard → Edge Functions → Secrets, or
`supabase secrets set`):

| Secret | Value |
| --- | --- |
| `QUICKBOOKS_CLIENT_ID` | Intuit app Client ID |
| `QUICKBOOKS_CLIENT_SECRET` | Intuit app Client Secret |
| `QUICKBOOKS_ENV` | `sandbox` (use `production` when you switch to live keys) — selects the QBO **data** API base for Phase 2; OAuth endpoints are identical for both |
| `PUBLIC_APP_ORIGIN` | the deployed app origin the callback redirects back to, e.g. `https://app.turfpro.example` (already used by other functions) |

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` are
provided by the platform automatically. If `QUICKBOOKS_CLIENT_ID`/`SECRET` are
unset, the `authorize` op fails fast with a clear error.

## 3. Apply the migration

The repo's migrations are **not** tracked by `supabase db push`. Apply 0029
directly:

```
supabase db query -f supabase/migrations/0029_quickbooks.sql
```

It is idempotent (safe to re-run). It creates `quickbooks_connections` and
`quickbooks_oauth_states` with RLS enabled and **no** policies.

## 4. Deploy the edge function

```
supabase functions deploy quickbooks-oauth
```

`supabase/config.toml` sets `[functions.quickbooks-oauth] verify_jwt = false`
because the **callback** op is a browser redirect from Intuit (no Supabase
JWT). The auth-required ops (`authorize`/`status`/`disconnect`) authenticate
per-request by resolving the user from the `Authorization` header, so the open
gate does not weaken security.

## 5. Sandbox test

1. In the Intuit developer dashboard, create a **sandbox company** (Intuit
   provides one free).
2. In TurfPro (signed in as an operator), go to **Settings → Integrations →
   QuickBooks Online** and tap **Connect QuickBooks**.
3. You're redirected to Intuit's consent screen. Approve, and pick the sandbox
   company.
4. Intuit redirects back to `…/quickbooks-oauth?op=callback`, which exchanges
   the code for tokens, upserts `quickbooks_connections`, then redirects you to
   `/settings?quickbooks=connected`. The card flips to **Connected ✓**.
5. Tap **Disconnect** — the row is deleted (and the token is best-effort
   revoked at Intuit) and the card returns to the Connect CTA.

### OAuth flow (what the function does)

```
authorize (POST, auth)   → store CSRF state→user, return Intuit consent URL
   ↓ browser redirects to Intuit, operator approves
callback  (GET, no auth) → look up state→user (delete it), exchange ?code for
                           tokens, upsert quickbooks_connections, 302 →
                           /settings?quickbooks=connected (or =error)
status    (POST, auth)    → { connected, company_name, realm_id }  (no tokens)
disconnect(POST, auth)    → best-effort Intuit revoke + delete row → { ok }
```

### Native note (known limitation)

On native (Capacitor) the Connect button opens the Intuit consent screen in
the in-app browser, and the callback redirects to the **web** app origin
(`PUBLIC_APP_ORIGIN`). A full native deep-link return into the app is the same
known limitation as `src/lib/auth-deep-link.ts` — not solved here. The
connection still completes server-side; the operator can return to the app and
the status card will read **Connected ✓** on next load.

---

## Phase 2 — invoice / payment sync (NOT built yet)

This is the contract for the next phase, to be implemented as a new
`quickbooks-sync` edge function. It is **not** part of this change.

**Token freshness.** Phase 2 must call the existing `refreshIfNeeded()` helper
in `quickbooks-oauth/index.ts` (refresh_token grant against the same Intuit
token endpoint, persisting the **rotated** refresh_token) before every QBO API
request. Access tokens last ~1h; refresh tokens last ~100 days and rotate on
each refresh.

**API base.** QBO data API calls use, per `QUICKBOOKS_ENV`:

- sandbox: `https://sandbox-quickbooks.api.intuit.com/v3/company/{realm_id}/...`
- production: `https://quickbooks.api.intuit.com/v3/company/{realm_id}/...`

**Sync, given a TurfPro invoice:**

1. Load the operator's `quickbooks_connections` row; `refreshIfNeeded()`.
2. **Find or create the QB Customer** — match the TurfPro customer to a QBO
   `Customer` (by display name/email; create one if missing). Cache the QBO
   customer id on the TurfPro customer for future syncs.
3. **Create the QB Invoice** — map TurfPro line items to QBO `Invoice.Line`
   entries (service items → QBO `Item` refs; create/cache items as needed).
4. **Record payment** — when the TurfPro invoice is paid, create a QBO
   `Payment` linked to the QBO invoice so the books reconcile.
5. Persist the QBO entity ids (invoice id, payment id) back onto the TurfPro
   rows for idempotency and to avoid duplicate creates on re-sync.

**Webhooks (optional, later).** Intuit can push entity-change webhooks; a
Phase-2+ enhancement could subscribe to keep TurfPro in sync with edits made
directly in QuickBooks.
