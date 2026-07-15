// connect-onboarding.ts
//
// Client-side helpers for the Stripe Connect Express onboarding flow.
// Talks to the `connect-onboarding` edge function, which handles the two
// operations needed: minting a hosted onboarding URL and confirming
// completion on return.
//
// Contract:
//   - startConnectOnboarding() — asks the edge function for a hosted URL
//     and redirects the browser. Caller does NOT await navigation; the
//     browser is gone after window.location.assign() resolves.
//   - refreshConnectStatus() — called once the operator lands back at
//     /onboarding?connect=return. Reports whether Stripe says the account
//     is fully onboarded. On success the edge function persists
//     connect_ready=true + connect_completed_at=now() so subsequent reads
//     can rely on the profile column alone.
//   - isConnectComplete(profile) — pure helper, no I/O. Used by Settings,
//     the wizard, and any future "can this operator take a payment yet?"
//     gate to decide whether to show "Connected ✓" vs the Connect button.

import { supabase } from "@/integrations/supabase/client";
import { openInAppBrowser } from "@/lib/native-browser";
import { getStripeEnvironment } from "@/lib/stripe";

/** Minimal shape of profiles needed to evaluate Connect readiness. */
export type ConnectableProfile = {
  stripe_account_id?: string | null;
  connect_ready?: boolean | null;
};

export interface RefreshConnectStatusResult {
  ready: boolean;
  // Stripe's requirements object is loosely typed (capability deadlines,
  // missing fields, etc.). We surface it raw so callers can render
  // "needs more info" cues if desired without us locking the shape.
  requirements: Record<string, unknown>;
}

/**
 * Kick off Stripe Connect Express onboarding for the signed-in operator.
 *
 * Calls the `connect-onboarding` edge function with `op=create_account_link`,
 * receives a hosted Stripe URL, then redirects the browser to it. The
 * AccountLink expires in ~5 minutes — callers should mint a fresh one
 * each time the operator clicks "Connect", never cache the URL.
 *
 * Throws on edge-function failure. The caller is responsible for surfacing
 * errors (the wizard catches and renders inline).
 */
export async function startConnectOnboarding(): Promise<void> {
  const { data, error } = await supabase.functions.invoke(
    "connect-onboarding",
    { body: { action: "create_account_link", environment: getStripeEnvironment() } },
  );
  if (error) throw new Error(error.message);
  const payload = data as {
    url?: string;
    account_id?: string;
    error?: string;
  };
  if (payload?.error) throw new Error(payload.error);
  if (!payload?.url) {
    throw new Error("Stripe did not return an onboarding URL");
  }
  // On web this leaves the SPA (full-page redirect); on native it opens
  // an in-app browser tab so the operator returns to the app afterward.
  await openInAppBrowser(payload.url);
}

/**
 * Re-check the operator's Connect account status after they return from
 * Stripe. The edge function flips profiles.connect_ready + writes
 * connect_completed_at when ready becomes true, so callers should refetch
 * the profile query after this resolves to pick up the new flag.
 *
 * If the operator has no stripe_account_id yet (i.e. they never started),
 * the edge function returns `{ ready: false, requirements: {} }` rather
 * than 404 — easier for the wizard to treat uniformly.
 */
export async function refreshConnectStatus(): Promise<RefreshConnectStatusResult> {
  const { data, error } = await supabase.functions.invoke(
    "connect-onboarding",
    { body: { action: "refresh_status", environment: getStripeEnvironment() } },
  );
  if (error) throw new Error(error.message);
  const payload = data as {
    ready?: boolean;
    requirements?: Record<string, unknown>;
    error?: string;
  };
  if (payload?.error) throw new Error(payload.error);
  return {
    ready: Boolean(payload?.ready),
    requirements: payload?.requirements ?? {},
  };
}

/**
 * Pure helper: is this operator ready to take Connect-routed payments?
 *
 * Both fields must agree:
 *   - stripe_account_id is set (the Express account exists)
 *   - connect_ready is true (Stripe confirmed details_submitted &&
 *     charges_enabled at the time of the last refresh_status call)
 *
 * We deliberately require BOTH instead of just the boolean — a stripe_account_id
 * with connect_ready=false means the operator started onboarding but
 * abandoned partway through (needs to finish). A null stripe_account_id
 * with connect_ready=true is impossible by construction, but the AND
 * guards against schema drift / manual db edits.
 */
export function isConnectComplete(profile: ConnectableProfile | null | undefined): boolean {
  if (!profile) return false;
  return Boolean(profile.stripe_account_id) && Boolean(profile.connect_ready);
}
