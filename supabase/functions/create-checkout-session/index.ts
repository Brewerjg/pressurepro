// create-checkout-session
//
// Creates a Stripe Checkout Session in HOSTED mode (we redirect the browser
// to session.url). The TurfPro client calls this with:
//
//   { priceId, userId, customerEmail?, returnUrl, environment }
//
// `priceId` is treated as a Stripe lookup_key — we resolve it to a real
// `price_xxx` ID via stripe.prices.list({ lookup_keys: [...] }) so the
// client can ship human-readable identifiers (turfpro_solo_monthly, etc.)
// without leaking real Stripe IDs into the bundle.

import { createStripeClient, type StripeEnv } from "../_shared/stripe.ts";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await req.json();
    const {
      priceId,
      userId,
      customerEmail,
      returnUrl,
      environment,
    } = body as {
      priceId?: string;
      userId?: string;
      customerEmail?: string;
      returnUrl?: string;
      environment?: StripeEnv;
    };

    if (!priceId || !returnUrl || !userId || !environment) {
      return jsonResponse(
        { error: "Missing required fields (priceId, userId, returnUrl, environment)" },
        { status: 400 },
      );
    }
    // Defensive — lookup_keys come from constants in src/lib/stripe.ts but
    // we still validate so a tampered request can't smuggle SQL/markup.
    if (!/^[a-zA-Z0-9_-]+$/.test(priceId)) {
      return jsonResponse({ error: "Invalid priceId" }, { status: 400 });
    }

    const stripe = createStripeClient(environment);
    const prices = await stripe.prices.list({
      lookup_keys: [priceId],
      limit: 1,
      active: true,
    });
    if (!prices.data.length) {
      return jsonResponse(
        { error: `No active Stripe price with lookup_key "${priceId}"` },
        { status: 404 },
      );
    }
    const price = prices.data[0];
    const isRecurring = price.type === "recurring";

    const session = await stripe.checkout.sessions.create({
      mode: isRecurring ? "subscription" : "payment",
      line_items: [{ price: price.id, quantity: 1 }],
      // Hosted page — TurfPro redirects the browser to session.url. The
      // {CHECKOUT_SESSION_ID} placeholder is interpolated by Stripe.
      success_url: returnUrl,
      cancel_url: returnUrl.replace(
        "session_id={CHECKOUT_SESSION_ID}",
        "canceled=1",
      ),
      ...(customerEmail && { customer_email: customerEmail }),
      // Metadata is mirrored to the resulting Subscription so the webhook
      // can find the userId without a round-trip to Supabase.
      metadata: { userId, priceId, environment },
      ...(isRecurring && {
        subscription_data: {
          trial_period_days: 14,
          metadata: { userId, priceId, environment },
        },
      }),
      allow_promotion_codes: true,
    });

    if (!session.url) {
      return jsonResponse(
        { error: "Stripe did not return a session URL" },
        { status: 502 },
      );
    }

    return jsonResponse({ url: session.url, sessionId: session.id });
  } catch (e) {
    console.error("create-checkout-session error:", e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
});
