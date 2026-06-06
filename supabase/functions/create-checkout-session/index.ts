// create-checkout-session
//
// Creates a Stripe Checkout Session in HOSTED mode (we redirect the browser
// to session.url). Two distinct callers go through this endpoint and the
// `kind` field distinguishes them:
//
//   1) `kind` undefined / 'app_subscription' (default)
//      The OPERATOR is buying TurfPro's own SaaS subscription (Solo / Pro /
//      Crew or PAYG). The operator IS the customer — payment goes to
//      TurfPro's platform account. NO Connect routing, NO application_fee,
//      NO transfer_data.
//
//   2) `kind` === 'maintenance_plan' OR 'plan_one_time' OR 'visit_charge'
//      A lawn-care customer is paying the OPERATOR. This must flow through
//      Stripe Connect: payment lands on the operator's Connect account, and
//      we deduct an application_fee based on the operator's tier (PAYG = 2%,
//      paid tiers = 0%). Requires the operator's profile to have
//      stripe_account_id set AND connect_ready=true. If Connect isn't
//      ready, we currently fall back to platform-account charging (v1
//      transition), but emit a warning.
//
// The TurfPro client calls this with:
//
//   { priceId, userId, customerEmail?, returnUrl, environment, kind?,
//     operatorUserId?, amountCents? }
//
// For app subscriptions: priceId is treated as a Stripe lookup_key — we
// resolve it to a real `price_xxx` ID via stripe.prices.list({ lookup_keys
// }) so the client can ship human-readable identifiers (turfpro_solo_monthly
// etc.) without leaking real Stripe IDs into the bundle.
//
// For Connect-routed checkouts (plan one-time / visit charges) the caller
// supplies amountCents directly (one-off payment, no Stripe Price needed)
// and `operatorUserId` identifies whose Connect account receives the funds
// — this lets the homeowner pay the operator from a public/portal link
// without the homeowner being authenticated as the operator.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { createStripeClient, type StripeEnv } from "../_shared/stripe.ts";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { loadOperatorConnect } from "../_shared/fees.ts";

type CheckoutKind =
  | "app_subscription"
  | "maintenance_plan"
  | "plan_one_time"
  | "visit_charge";

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
      kind,
      operatorUserId,
      amountCents: bodyAmountCents,
      productName: bodyProductName,
      metadata: extraMetadata,
    } = body as {
      priceId?: string;
      userId?: string;
      customerEmail?: string;
      returnUrl?: string;
      environment?: StripeEnv;
      kind?: CheckoutKind;
      operatorUserId?: string;
      amountCents?: number;
      productName?: string;
      metadata?: Record<string, string>;
    };

    if (!returnUrl || !environment) {
      return jsonResponse(
        { error: "Missing required fields (returnUrl, environment)" },
        { status: 400 },
      );
    }

    const checkoutKind: CheckoutKind = kind ?? "app_subscription";
    const isAppSubscription = checkoutKind === "app_subscription";
    const isConnectRouted = !isAppSubscription;

    const stripe = createStripeClient(environment);

    // -------------------------------------------------------------
    // App subscription path: operator buying their own SaaS plan.
    // Stays on platform account. NO Connect routing.
    // -------------------------------------------------------------
    if (isAppSubscription) {
      if (!priceId || !userId) {
        return jsonResponse(
          { error: "Missing required fields (priceId, userId)" },
          { status: 400 },
        );
      }
      // Defensive — lookup_keys come from constants in src/lib/stripe.ts but
      // we still validate so a tampered request can't smuggle SQL/markup.
      if (!/^[a-zA-Z0-9_-]+$/.test(priceId)) {
        return jsonResponse({ error: "Invalid priceId" }, { status: 400 });
      }

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
        success_url: returnUrl,
        cancel_url: returnUrl.replace(
          "session_id={CHECKOUT_SESSION_ID}",
          "canceled=1",
        ),
        ...(customerEmail && { customer_email: customerEmail }),
        // Metadata is mirrored to the resulting Subscription so the webhook
        // can find the userId without a round-trip to Supabase.
        metadata: {
          userId,
          priceId,
          environment,
          kind: "app_subscription",
          ...(extraMetadata ?? {}),
        },
        ...(isRecurring && {
          subscription_data: {
            trial_period_days: 14,
            metadata: {
              userId,
              priceId,
              environment,
              kind: "app_subscription",
              ...(extraMetadata ?? {}),
            },
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
    }

    // -------------------------------------------------------------
    // Connect-routed path: homeowner paying the operator.
    // Lawn-care customer is the payer; operator's Connect account is
    // the destination. We deduct application_fee_amount based on
    // operator tier (PAYG 2% / paid 0%).
    //
    // Caller supplies amountCents directly because these are one-off
    // charges that don't need a Stripe Price catalog entry.
    // -------------------------------------------------------------
    const opUserId = operatorUserId ?? userId;
    if (!opUserId) {
      return jsonResponse(
        { error: "operatorUserId required for Connect-routed checkout" },
        { status: 400 },
      );
    }
    const amount = Number(bodyAmountCents);
    if (!Number.isFinite(amount) || amount < 50) {
      return jsonResponse(
        { error: "amountCents must be a number >= 50" },
        { status: 400 },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const operator = await loadOperatorConnect(supabase, opUserId);

    // V1 fallback: if Connect isn't ready yet for this operator, log a
    // warning and route the charge to the platform account. This keeps
    // PAYG operators unblocked during the Connect rollout. Long-term we
    // want to refuse the charge so funds always settle to the operator.
    if (!operator.shouldRoute) {
      console.warn(
        `[create-checkout-session] Operator ${opUserId} is not Connect-ready; falling back to platform charge. tier=${operator.tier}`,
      );
    }

    // Checkout Sessions in `payment` mode use application_fee_amount
    // (fixed cents), NOT application_fee_percent. Convert percent → cents
    // off the line-item total.
    const feeAmountCents =
      operator.shouldRoute && operator.feePercent > 0
        ? Math.round((amount * operator.feePercent) / 100)
        : undefined;

    const productName = bodyProductName ?? "TurfPro charge";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: productName },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      success_url: returnUrl,
      cancel_url: returnUrl.replace(
        "session_id={CHECKOUT_SESSION_ID}",
        "canceled=1",
      ),
      ...(customerEmail && { customer_email: customerEmail }),
      metadata: {
        userId: opUserId,
        operatorUserId: opUserId,
        environment,
        kind: checkoutKind,
        tier_at_capture: operator.tier,
        fee_percent: String(operator.feePercent),
        ...(extraMetadata ?? {}),
      },
      payment_intent_data: {
        metadata: {
          userId: opUserId,
          operatorUserId: opUserId,
          environment,
          kind: checkoutKind,
          tier_at_capture: operator.tier,
          fee_percent: String(operator.feePercent),
          ...(extraMetadata ?? {}),
        },
        ...(operator.shouldRoute
          ? {
              transfer_data: { destination: operator.stripeAccountId! },
              ...(feeAmountCents !== undefined
                ? { application_fee_amount: feeAmountCents }
                : {}),
            }
          : {}),
      },
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
