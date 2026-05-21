// Stripe client init + env helpers, shared by every Stripe-touching edge
// function in TurfPro. Mirrors PressurePro's shared helpers so we read the
// same secrets out of the Supabase project:
//
//   STRIPE_LIVE_API_KEY           → live secret key
//   STRIPE_SANDBOX_API_KEY        → test secret key
//   PAYMENTS_LIVE_WEBHOOK_SECRET  → live webhook signing secret
//   PAYMENTS_SANDBOX_WEBHOOK_SECRET → test webhook signing secret
//
// `environment` is selected per request — clients send it in the body for
// browser-initiated calls, and webhooks send it as a ?env=live|sandbox query
// param on the Stripe-configured webhook URL.

import Stripe from "https://esm.sh/stripe@17.5.0?target=denonext";

export type StripeEnv = "sandbox" | "live";

function getEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`${key} is not configured`);
  return value;
}

export function getStripeEnvFromUrl(req: Request): StripeEnv {
  const url = new URL(req.url);
  const env = url.searchParams.get("env");
  return env === "live" ? "live" : "sandbox";
}

export function getApiKey(env: StripeEnv): string {
  return env === "live"
    ? getEnv("STRIPE_LIVE_API_KEY")
    : getEnv("STRIPE_SANDBOX_API_KEY");
}

export function createStripeClient(env: StripeEnv): Stripe {
  return new Stripe(getApiKey(env), {
    // dahlia keeps period fields on subscription items, which the webhook
    // handler accounts for. Match PressurePro's pinned version.
    apiVersion: "2026-03-25.dahlia" as any,
    httpClient: Stripe.createFetchHttpClient() as any,
  });
}

export function getWebhookSecret(env: StripeEnv): string {
  const secret =
    env === "live"
      ? Deno.env.get("PAYMENTS_LIVE_WEBHOOK_SECRET")
      : Deno.env.get("PAYMENTS_SANDBOX_WEBHOOK_SECRET");
  if (!secret) throw new Error(`Missing webhook secret for env=${env}`);
  return secret;
}

export { Stripe };
