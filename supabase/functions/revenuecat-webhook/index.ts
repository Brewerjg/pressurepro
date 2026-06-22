// revenuecat-webhook
//
// RevenueCat → TurfPro webhook handler for operator SaaS subscriptions, which
// are now sold through the mobile app stores (Apple / Google) via RevenueCat
// rather than Stripe Checkout. This function receives RevenueCat webhook
// events and writes the operator's entitlement into the existing
// `public.subscriptions` table — the SINGLE SOURCE OF TRUTH the app reads to
// gate features (via tierFromPriceId()/resolveTier()).
//
// Key contract details:
//   * RevenueCat is configured client-side with `appUserID = supabase auth
//     user.id`, so `event.app_user_id` IS the TurfPro `user_id`.
//   * IMPORTANT: the RevenueCat PRODUCT IDENTIFIERS must be created to EXACTLY
//     MATCH the Stripe `lookup_key`s used elsewhere in the app:
//       turfpro_solo_monthly, turfpro_solo_yearly,
//       turfpro_crew_monthly, turfpro_crew_yearly
//     We write `subscriptions.price_id = event.product_id` directly so the
//     app's existing tierFromPriceId() resolves the tier with NO extra
//     mapping here. If those identifiers ever drift from the lookup_keys, the
//     app will fail to resolve the tier — keep them in sync. Unrecognized
//     product_ids are still upserted (with a warning) using the raw value.
//   * environment: RevenueCat sends "SANDBOX" | "PRODUCTION"; we map
//     SANDBOX→"sandbox" and PRODUCTION→"live" to match the `environment`
//     column the app filters on.
//   * Stripe columns don't apply to RC. We set stripe_subscription_id to a
//     STABLE per-operator id ("rc_" + app_user_id) so the upsert has a
//     conflict key (one active SaaS sub per operator), and
//     stripe_customer_id to null.
//
// Security:
//   * RevenueCat sends an `Authorization` header equal to a secret configured
//     in the RC dashboard. We compare it to REVENUECAT_WEBHOOK_AUTH and reject
//     with 401 on mismatch. If the env var is unset we reject with 500
//     (misconfigured) — we never allow unauthenticated writes.
//   * Idempotency: we dedupe on `event.id` via the existing
//     `processed_stripe_events` table exactly like payments-webhook does.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

const UNIQUE_VIOLATION = "23505";

// event.type → how to translate into the subscriptions row. "active" means the
// operator currently has access. CANCELLATION keeps access until expiration
// (RC cancellation = auto-renew off), so we keep status active but flag
// cancel_at_period_end. EXPIRATION is the real end of access.
const ACTIVE_TYPES = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
  "NON_RENEWING_PURCHASE",
  "SUBSCRIPTION_EXTENDED",
]);

interface RevenueCatEvent {
  id?: string;
  type?: string;
  app_user_id?: string;
  product_id?: string;
  environment?: string; // "SANDBOX" | "PRODUCTION"
  expiration_at_ms?: number | null;
  purchased_at_ms?: number | null;
  original_transaction_id?: string | null;
  entitlement_id?: string | null;
}

const msToIso = (ms: number | null | undefined): string | null =>
  ms ? new Date(ms).toISOString() : null;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // ----------------------------------------------------------------
    // Auth — RC sends a static Authorization header we configure in the
    // dashboard. Without REVENUECAT_WEBHOOK_AUTH set we MUST refuse to write
    // (treat as misconfigured) rather than accept anonymous events.
    // ----------------------------------------------------------------
    const expectedAuth = Deno.env.get("REVENUECAT_WEBHOOK_AUTH");
    if (!expectedAuth) {
      console.error("REVENUECAT_WEBHOOK_AUTH is not set — refusing to process.");
      return new Response("Webhook auth not configured", { status: 500 });
    }
    const providedAuth = req.headers.get("Authorization");
    if (providedAuth !== expectedAuth) {
      console.warn("RevenueCat webhook: Authorization mismatch.");
      return new Response("Unauthorized", { status: 401 });
    }

    // RevenueCat wraps the payload as { event: {...}, api_version: "1.0" }.
    const body = await req.json();
    const event: RevenueCatEvent = (body?.event ?? body) as RevenueCatEvent;

    if (!event?.id || !event?.type) {
      return new Response("Missing event id/type", { status: 400 });
    }

    const env: "sandbox" | "live" =
      event.environment === "PRODUCTION" ? "live" : "sandbox";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ----------------------------------------------------------------
    // Idempotency — RevenueCat retries with the same event.id on any non-2xx
    // response, so dedupe before writing. We reuse the processed_stripe_events
    // table (it's just an event-id ledger; the column names are Stripe-era).
    // ----------------------------------------------------------------
    const { error: insertErr } = await supabase
      .from("processed_stripe_events")
      .insert({ event_id: event.id, event_type: event.type, environment: env });
    if (insertErr) {
      if (
        insertErr.code === UNIQUE_VIOLATION ||
        /duplicate key|already exists/i.test(insertErr.message ?? "")
      ) {
        console.log("Skipping duplicate event", event.id, event.type);
        return new Response(
          JSON.stringify({ received: true, duplicate: true }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      // Unknown DB error — return 500 so RevenueCat retries. We'd rather
      // double up at the dedup table than miss an entitlement change.
      console.error("Idempotency insert failed:", insertErr);
      return new Response("Idempotency error", { status: 500 });
    }

    console.log("Processing RC event", event.type, "env:", env);

    // ----------------------------------------------------------------
    // Status mapping. Unknown/unhandled types are acknowledged with 200 but
    // produce no write (e.g. TRANSFER, TEST, etc.).
    // ----------------------------------------------------------------
    let status: string;
    let cancelAtPeriodEnd = false;
    let canceledAt: string | null = null;

    if (ACTIVE_TYPES.has(event.type)) {
      status = "active";
    } else if (event.type === "CANCELLATION") {
      // Auto-renew turned off — access continues until expiration_at_ms.
      status = "active";
      cancelAtPeriodEnd = true;
      canceledAt = new Date().toISOString();
    } else if (event.type === "EXPIRATION") {
      status = "canceled";
      canceledAt = new Date().toISOString();
    } else if (event.type === "BILLING_ISSUE") {
      status = "past_due";
    } else {
      console.log("Acknowledging unhandled RC event type:", event.type);
      return new Response(
        JSON.stringify({ received: true, ignored: true }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    const userId = event.app_user_id;
    if (!userId) {
      console.warn("RC event missing app_user_id; cannot map to a user.", event.id);
      // Acknowledge so RC doesn't retry forever; nothing to write.
      return new Response(
        JSON.stringify({ received: true, skipped: "no app_user_id" }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // price_id is written RAW from the RC product identifier. The app's
    // tierFromPriceId() expects it to equal a Stripe lookup_key
    // (turfpro_solo_monthly, etc.). Warn — but still upsert — on a mismatch
    // so the operator at least gets an active row.
    const priceId = event.product_id ?? null;
    const KNOWN_PRODUCTS = new Set([
      "turfpro_solo_monthly",
      "turfpro_solo_yearly",
      "turfpro_crew_monthly",
      "turfpro_crew_yearly",
    ]);
    if (priceId && !KNOWN_PRODUCTS.has(priceId)) {
      console.warn(
        "RC product_id does not match a known lookup_key:",
        priceId,
        "— tier resolution may fail in the app.",
      );
    }

    const row = {
      user_id: userId,
      environment: env,
      stripe_customer_id: null,
      // Stable per-operator conflict key. One active SaaS sub per operator.
      stripe_subscription_id: `rc_${userId}`,
      price_id: priceId,
      // Stash a RC reference for traceability. Prefer the original
      // transaction / entitlement id, falling back to the product id.
      product_id:
        event.original_transaction_id ??
        event.entitlement_id ??
        priceId ??
        null,
      status,
      current_period_start: msToIso(event.purchased_at_ms),
      current_period_end: msToIso(event.expiration_at_ms),
      trial_end: null,
      cancel_at_period_end: cancelAtPeriodEnd,
      canceled_at: canceledAt,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("subscriptions")
      .upsert(row, { onConflict: "stripe_subscription_id" });
    if (error) {
      console.error("Subscription upsert failed:", error);
      // Return 500 so RC retries — the dedup row will short-circuit any
      // accidental double-processing on a later success.
      return new Response("Upsert error", { status: 500 });
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("revenuecat-webhook error:", e);
    return new Response("Server error", { status: 500 });
  }
});
