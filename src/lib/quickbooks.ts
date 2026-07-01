// quickbooks.ts
//
// Client-side helpers for the QuickBooks Online connect flow. Talks to the
// `quickbooks-oauth` edge function, which owns the OAuth2 handshake and stores
// the tokens server-side. The browser never sees tokens — it only kicks off
// the consent redirect and reads back connection status.
//
// Contract:
//   - connectQuickBooks() — asks the edge fn for the Intuit consent URL and
//     redirects the browser to it (full-page on web, in-app browser on
//     native). Caller does NOT await navigation. Intuit redirects back to
//     /settings?quickbooks=connected once the operator approves.
//   - getQuickBooksStatus() — returns { connected, company_name, realm_id }
//     for the signed-in operator. Never returns tokens.
//   - disconnectQuickBooks() — drops the connection (revokes at Intuit
//     best-effort, deletes the stored row).
//
// All helpers throw on edge-function failure, matching connect-onboarding.ts.

import { supabase } from "@/integrations/supabase/client";
import { openInAppBrowser } from "@/lib/native-browser";

export interface QuickBooksStatus {
  connected: boolean;
  company_name: string | null;
  realm_id: string | null;
}

/**
 * Start the QuickBooks Online connect flow for the signed-in operator.
 *
 * Invokes `quickbooks-oauth` with `action=authorize`, receives the Intuit
 * hosted consent URL, then redirects the browser to it. After the operator
 * approves, Intuit redirects to the edge fn's callback, which in turn
 * redirects back to /settings?quickbooks=connected.
 *
 * Throws on edge-function failure; the caller surfaces the error inline.
 */
export async function connectQuickBooks(): Promise<void> {
  const { data, error } = await supabase.functions.invoke("quickbooks-oauth", {
    body: { action: "authorize" },
  });
  if (error) throw new Error(error.message);
  const payload = data as { url?: string; error?: string };
  if (payload?.error) throw new Error(payload.error);
  if (!payload?.url) {
    throw new Error("QuickBooks did not return a consent URL");
  }
  // Web: full-page redirect. Native: in-app browser tab so the operator
  // returns to TurfPro after consenting.
  await openInAppBrowser(payload.url);
}

/**
 * Fetch the operator's QuickBooks connection status. Returns a normalized
 * shape so callers can render Connected vs Connect uniformly.
 */
export async function getQuickBooksStatus(): Promise<QuickBooksStatus> {
  const { data, error } = await supabase.functions.invoke("quickbooks-oauth", {
    body: { action: "status" },
  });
  if (error) throw new Error(error.message);
  const payload = data as {
    connected?: boolean;
    company_name?: string | null;
    realm_id?: string | null;
    error?: string;
  };
  if (payload?.error) throw new Error(payload.error);
  return {
    connected: Boolean(payload?.connected),
    company_name: payload?.company_name ?? null,
    realm_id: payload?.realm_id ?? null,
  };
}

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

/**
 * Disconnect the operator's QuickBooks company. Best-effort revokes the token
 * at Intuit and deletes the stored connection. Throws on failure.
 */
export async function disconnectQuickBooks(): Promise<void> {
  const { data, error } = await supabase.functions.invoke("quickbooks-oauth", {
    body: { action: "disconnect" },
  });
  if (error) throw new Error(error.message);
  const payload = data as { ok?: boolean; error?: string };
  if (payload?.error) throw new Error(payload.error);
  if (!payload?.ok) throw new Error("Could not disconnect QuickBooks");
}
