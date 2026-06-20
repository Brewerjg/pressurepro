// Stripe client init + env helpers, shared by every Stripe-touching edge
// function in TurfPro. Mirrors PressurePro's shared helpers so we read the
// same secrets out of the Supabase project.
//
// App selection
// -------------
// Both TurfPro and PressurePro share one Supabase project but run on TWO
// separate Stripe platform accounts (one per app). Every Stripe-touching
// edge function passes its `AppId` to `createStripeClient` so the right
// secret is selected.
//
// Env vars read (per app × per env)
// ---------------------------------
//   STRIPE_LIVE_API_KEY_TURFPRO       → TurfPro live secret key
//   STRIPE_SANDBOX_API_KEY_TURFPRO    → TurfPro test secret key
//   STRIPE_LIVE_API_KEY_PRESSUREPRO   → PressurePro live secret key
//   STRIPE_SANDBOX_API_KEY_PRESSUREPRO → PressurePro test secret key
//   PAYMENTS_LIVE_WEBHOOK_SECRET_TURFPRO       → TurfPro live webhook signing secret
//   PAYMENTS_SANDBOX_WEBHOOK_SECRET_TURFPRO    → TurfPro test webhook signing secret
//   PAYMENTS_LIVE_WEBHOOK_SECRET_PRESSUREPRO   → PressurePro live webhook signing secret
//   PAYMENTS_SANDBOX_WEBHOOK_SECRET_PRESSUREPRO → PressurePro test webhook signing secret
//
// Back-compat fallbacks (single-account migration window)
// -------------------------------------------------------
// During the migration both new (app-scoped) and old (single-account) env
// var names are tolerated. If the app-scoped var is missing we fall back to
// the legacy STRIPE_LIVE_API_KEY / STRIPE_SANDBOX_API_KEY (same for webhook
// secrets). Once both accounts are provisioned and the per-app vars are
// populated in Supabase, the legacy ones can be removed.
//
// `environment` is selected per request — clients send it in the body for
// browser-initiated calls, and webhooks send it as a ?env=live|sandbox query
// param on the Stripe-configured webhook URL. App is now also a per-request
// concern: clients pass it from APP_ID, webhooks read it from the ?app=
// query param.

import Stripe from "https://esm.sh/stripe@17.5.0?target=denonext";

export type StripeEnv = "sandbox" | "live";
export type AppId = "turfpro" | "pressurepro";

function getEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`${key} is not configured`);
  return value;
}

// Try the app-scoped env var first; fall back to the legacy single-account
// name during migration. Throw only if neither is set.
function getEnvWithFallback(primary: string, legacy: string): string {
  return Deno.env.get(primary) ?? getEnv(legacy);
}

export function getStripeEnvFromUrl(req: Request): StripeEnv {
  const url = new URL(req.url);
  const env = url.searchParams.get("env");
  return env === "live" ? "live" : "sandbox";
}

/**
 * Resolve the app from the request. Reads `?app=turfpro|pressurepro` from
 * the URL; defaults to `"turfpro"` when unset so existing single-account
 * webhook URLs continue to work during migration.
 */
export function getAppFromUrl(req: Request): AppId {
  const url = new URL(req.url);
  const app = url.searchParams.get("app");
  return app === "pressurepro" ? "pressurepro" : "turfpro";
}

export function getApiKey(env: StripeEnv, app: AppId): string {
  const suffix = app === "pressurepro" ? "PRESSUREPRO" : "TURFPRO";
  const primary =
    env === "live"
      ? `STRIPE_LIVE_API_KEY_${suffix}`
      : `STRIPE_SANDBOX_API_KEY_${suffix}`;
  const legacy =
    env === "live" ? "STRIPE_LIVE_API_KEY" : "STRIPE_SANDBOX_API_KEY";
  return getEnvWithFallback(primary, legacy);
}

export function createStripeClient(env: StripeEnv, app: AppId): Stripe {
  return new Stripe(getApiKey(env, app), {
    // dahlia keeps period fields on subscription items, which the webhook
    // handler accounts for. Match PressurePro's pinned version.
    apiVersion: "2026-03-25.dahlia" as any,
    httpClient: Stripe.createFetchHttpClient() as any,
  });
}

export function getWebhookSecret(env: StripeEnv, app: AppId): string {
  const suffix = app === "pressurepro" ? "PRESSUREPRO" : "TURFPRO";
  const primary =
    env === "live"
      ? `PAYMENTS_LIVE_WEBHOOK_SECRET_${suffix}`
      : `PAYMENTS_SANDBOX_WEBHOOK_SECRET_${suffix}`;
  const legacy =
    env === "live"
      ? "PAYMENTS_LIVE_WEBHOOK_SECRET"
      : "PAYMENTS_SANDBOX_WEBHOOK_SECRET";
  const secret = Deno.env.get(primary) ?? Deno.env.get(legacy);
  if (!secret) {
    throw new Error(
      `Missing webhook secret for env=${env} app=${app} (looked for ${primary} then ${legacy})`,
    );
  }
  return secret;
}

export { Stripe };
