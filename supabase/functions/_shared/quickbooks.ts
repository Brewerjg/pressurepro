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
