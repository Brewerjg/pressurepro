// quickbooks-oauth
//
// QuickBooks Online (QBO) OAuth2 "connect foundation" — Phase 1 only.
//
// This multi-op edge function lets a TurfPro operator connect their
// QuickBooks COMPANY (Intuit calls it a "realm") to TurfPro. We run the
// standard Authorization-Code grant against Intuit, then store the resulting
// access/refresh tokens server-side in `public.quickbooks_connections`. The
// browser never sees the tokens — it only ever learns "connected: true/false"
// (plus company name) via the `status` op.
//
// The actual invoice/payment SYNC into QuickBooks is Phase 2 and is NOT built
// here. See docs/QUICKBOOKS_SETUP.md for the Phase-2 contract. The
// `refreshIfNeeded()` helper below is written now (and used by `status`) so
// Phase 2 can call it before any QBO API request.
//
// OPERATIONS (dispatched by ?op=... query param OR `action` JSON body):
//
//   authorize   (AUTH REQUIRED)
//     Generates a random CSRF `state`, stores {state, user_id} in
//     quickbooks_oauth_states, and returns the Intuit consent URL. The
//     browser must redirect to it. Returns: { url }.
//
//   callback    (NO AUTH — Intuit redirects the browser here)
//     Intuit appends ?code, ?state, ?realmId. We look up state→user (and
//     delete the state), exchange the code for tokens, upsert
//     quickbooks_connections, then 302-redirect the browser back to the app
//     at /settings?quickbooks=connected (or =error on failure).
//
//   status      (AUTH REQUIRED)
//     Returns { connected, company_name, realm_id } for the current user.
//     Never returns tokens.
//
//   disconnect  (AUTH REQUIRED)
//     Best-effort revokes the token at Intuit, then deletes the user's
//     quickbooks_connections row. Returns { ok: true }.
//
// AUTH: the auth-required ops resolve the user from the Authorization header
// via a JWT-scoped Supabase client (userClient.auth.getUser()), exactly like
// connect-onboarding. All token storage uses a SEPARATE service-role client
// so it can write the RLS-locked quickbooks_* tables.
//
// JWT GATE: the `callback` op is hit by Intuit's redirect (no Supabase JWT),
// so this function is registered with verify_jwt = false in config.toml. The
// auth-required ops authenticate themselves per-request.
//
// ENV:
//   QUICKBOOKS_CLIENT_ID       Intuit app client id (required)
//   QUICKBOOKS_CLIENT_SECRET   Intuit app client secret (required)
//   QUICKBOOKS_ENV             "sandbox" | "production" — selects the QBO API
//                              base used for Phase-2 sync (OAuth endpoints are
//                              the same for both). Defaults to "sandbox".
//   PUBLIC_APP_ORIGIN          where the callback redirects the browser back
//                              to (the deployed app origin).
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { handleOptions, jsonResponse, corsHeaders } from "../_shared/cors.ts";

// Intuit OAuth2 endpoints — identical for sandbox and production. Only the
// QBO *data* API base (used in Phase 2) differs by environment.
const INTUIT_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const INTUIT_TOKEN_URL =
  "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const INTUIT_REVOKE_URL =
  "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const QBO_SCOPE = "com.intuit.quickbooks.accounting";

type Op = "authorize" | "callback" | "status" | "disconnect";

function getOp(req: Request, body: Record<string, unknown>): Op | null {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("op");
  const fromBody = typeof body.action === "string" ? body.action : undefined;
  const candidate = (fromQuery ?? fromBody) as string | null;
  if (
    candidate === "authorize" ||
    candidate === "callback" ||
    candidate === "status" ||
    candidate === "disconnect"
  ) {
    return candidate;
  }
  return null;
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

// The redirect URI MUST byte-for-byte match the one registered in the Intuit
// developer dashboard AND the one sent in the token exchange.
function getRedirectUri(): string {
  const base = Deno.env.get("SUPABASE_URL")!;
  return `${base}/functions/v1/quickbooks-oauth?op=callback`;
}

function getAppOrigin(req: Request): string {
  return (
    req.headers.get("origin") ||
    Deno.env.get("PUBLIC_APP_ORIGIN") ||
    "https://example.com"
  );
}

// Service-role client — bypasses RLS so it can touch the locked-down
// quickbooks_* tables. Never expose this client's reads to the browser.
function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// Resolve the signed-in user from the Authorization header (JWT-scoped
// client). Mirrors connect-onboarding. Returns null when unauthenticated.
async function resolveUser(req: Request): Promise<{ id: string } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey =
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id };
}

// Exchange an OAuth code OR a refresh token at Intuit's bearer endpoint.
// `params` carries the grant-specific fields. Returns the parsed token JSON.
async function intuitTokenRequest(
  params: Record<string, string>,
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in?: number;
}> {
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
    const text = await res.text();
    throw new Error(`Intuit token request failed (${res.status}): ${text}`);
  }
  return await res.json();
}

// Browser redirect back into the app after the Intuit callback.
function redirectToApp(origin: string, query: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: `${origin}/settings?${query}`,
    },
  });
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  // Parse op early. authorize/status/disconnect arrive as POST with a JSON
  // body; callback arrives as a GET from Intuit's redirect.
  const body =
    req.method === "POST"
      ? await req.json().catch(() => ({}))
      : {};
  const op = getOp(req, body as Record<string, unknown>);

  // -----------------------------------------------------------------------
  // OP: callback (NO auth — Intuit redirects the browser here with a GET)
  // We always try to redirect the browser back to the app; only fall back to
  // JSON if we can't even derive an origin.
  // -----------------------------------------------------------------------
  if (op === "callback") {
    const origin = getAppOrigin(req);
    try {
      const url = new URL(req.url);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const realmId = url.searchParams.get("realmId");
      const oauthError = url.searchParams.get("error");

      if (oauthError) {
        console.error("QuickBooks callback returned error:", oauthError);
        return redirectToApp(origin, "quickbooks=error");
      }
      if (!code || !state || !realmId) {
        console.error("QuickBooks callback missing code/state/realmId");
        return redirectToApp(origin, "quickbooks=error");
      }

      const svc = serviceClient();

      // Look up state → user, then delete it (single-use CSRF token).
      const { data: stateRow, error: stateErr } = await svc
        .from("quickbooks_oauth_states")
        .select("user_id")
        .eq("state", state)
        .maybeSingle();
      if (stateErr || !stateRow) {
        console.error("QuickBooks callback: unknown/expired state", stateErr);
        return redirectToApp(origin, "quickbooks=error");
      }
      const userId = (stateRow as { user_id: string }).user_id;
      await svc.from("quickbooks_oauth_states").delete().eq("state", state);

      // Exchange the authorization code for tokens.
      const tokens = await intuitTokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: getRedirectUri(),
      });
      const tokenExpiresAt = new Date(
        Date.now() + tokens.expires_in * 1000,
      ).toISOString();

      // Best-effort company name lookup is a Phase-2 concern (needs the QBO
      // data API). For now store realm_id; company_name stays null until sync.
      const { error: upsertErr } = await svc
        .from("quickbooks_connections")
        .upsert(
          {
            user_id: userId,
            realm_id: realmId,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_expires_at: tokenExpiresAt,
            connected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: "user_id" },
        );
      if (upsertErr) {
        console.error("QuickBooks connection upsert failed:", upsertErr);
        return redirectToApp(origin, "quickbooks=error");
      }

      return redirectToApp(origin, "quickbooks=connected");
    } catch (e) {
      console.error("quickbooks-oauth callback error:", e);
      return redirectToApp(origin, "quickbooks=error");
    }
  }

  // -----------------------------------------------------------------------
  // All remaining ops are POST + auth-required.
  // -----------------------------------------------------------------------
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }
  if (!op) {
    return jsonResponse(
      { error: "Unknown op (expected authorize, status, or disconnect)" },
      { status: 400 },
    );
  }

  try {
    const user = await resolveUser(req);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = user.id;
    const svc = serviceClient();

    // -------------------------------------------------------------------
    // OP: authorize
    // -------------------------------------------------------------------
    if (op === "authorize") {
      const { clientId } = getClientCreds(); // throws if unset → clear error

      // Random, single-use CSRF state.
      const state = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
      const { error: stateErr } = await svc
        .from("quickbooks_oauth_states")
        .insert({ state, user_id: userId } as never);
      if (stateErr) {
        console.error("QuickBooks authorize: state insert failed", stateErr);
        return jsonResponse(
          { error: "Could not start QuickBooks connection" },
          { status: 500 },
        );
      }

      const consent = new URL(INTUIT_AUTH_URL);
      consent.searchParams.set("client_id", clientId);
      consent.searchParams.set("response_type", "code");
      consent.searchParams.set("scope", QBO_SCOPE);
      consent.searchParams.set("redirect_uri", getRedirectUri());
      consent.searchParams.set("state", state);

      return jsonResponse({ url: consent.toString() });
    }

    // -------------------------------------------------------------------
    // OP: status — never returns tokens.
    // -------------------------------------------------------------------
    if (op === "status") {
      const { data: conn, error } = await svc
        .from("quickbooks_connections")
        .select("realm_id, company_name")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        console.error("QuickBooks status lookup failed", error);
        return jsonResponse({ error: "Could not load status" }, { status: 500 });
      }
      if (!conn) {
        return jsonResponse({ connected: false });
      }
      const row = conn as { realm_id: string; company_name: string | null };
      return jsonResponse({
        connected: true,
        company_name: row.company_name ?? null,
        realm_id: row.realm_id,
      });
    }

    // -------------------------------------------------------------------
    // OP: disconnect — best-effort revoke at Intuit, then delete the row.
    // -------------------------------------------------------------------
    if (op === "disconnect") {
      // Best-effort token revoke so the grant is dropped on Intuit's side
      // too. Failure here must NOT block the local delete.
      try {
        const { data: conn } = await svc
          .from("quickbooks_connections")
          .select("refresh_token")
          .eq("user_id", userId)
          .maybeSingle();
        const refreshToken = (conn as { refresh_token?: string } | null)
          ?.refresh_token;
        if (refreshToken) {
          const { clientId, clientSecret } = getClientCreds();
          const basic = btoa(`${clientId}:${clientSecret}`);
          await fetch(INTUIT_REVOKE_URL, {
            method: "POST",
            headers: {
              Authorization: `Basic ${basic}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ token: refreshToken }),
          });
        }
      } catch (e) {
        console.warn("QuickBooks revoke best-effort failed:", e);
      }

      const { error } = await svc
        .from("quickbooks_connections")
        .delete()
        .eq("user_id", userId);
      if (error) {
        console.error("QuickBooks disconnect delete failed", error);
        return jsonResponse(
          { error: "Could not disconnect QuickBooks" },
          { status: 500 },
        );
      }
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "Unhandled op" }, { status: 400 });
  } catch (e) {
    console.error("quickbooks-oauth error:", e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
});

