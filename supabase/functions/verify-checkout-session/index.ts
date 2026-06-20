// verify-checkout-session
//
// Called from /checkout/return after Stripe redirects the user back. Given a
// session_id, we fetch the Checkout Session from Stripe and (defensively)
// upsert a `subscriptions` row for the user so the UI sees an active row
// even if the webhook hasn't yet fired. The webhook is still the source of
// truth — this function is just a "no spinner stuck for 30 seconds" hedge.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { createStripeClient, type AppId, type StripeEnv } from "../_shared/stripe.ts";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";

const APP_ID: AppId = "turfpro";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await req.json();
    const { sessionId, environment } = body as {
      sessionId?: string;
      environment?: StripeEnv;
    };
    if (!sessionId || !environment) {
      return jsonResponse(
        { error: "Missing sessionId or environment" },
        { status: 400 },
      );
    }

    const stripe = createStripeClient(environment, APP_ID);
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription", "subscription.items.data.price"],
    });

    const userId = session.metadata?.userId;
    const meta_priceId = session.metadata?.priceId ?? null;

    // For subscription mode, also write the row defensively so the UI sees
    // it. If the webhook lands first or after, the upsert by
    // stripe_subscription_id (or by user_id when there's no sub yet) keeps
    // things consistent.
    let writtenPriceId: string | null = meta_priceId;
    if (session.mode === "subscription" && userId && session.subscription) {
      const sub = typeof session.subscription === "string"
        ? await stripe.subscriptions.retrieve(session.subscription)
        : session.subscription;

      const item = sub.items?.data?.[0];
      let lookupKey: string | null = null;
      if (item) {
        try {
          const price = await stripe.prices.retrieve(item.price.id);
          lookupKey = price.lookup_key || null;
        } catch {
          lookupKey = null;
        }
      }
      writtenPriceId = lookupKey ?? meta_priceId;

      const periodStart =
        (item as any)?.current_period_start ?? (sub as any).current_period_start;
      const periodEnd =
        (item as any)?.current_period_end ?? (sub as any).current_period_end;

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      await supabase.from("subscriptions").upsert(
        {
          user_id: userId,
          environment,
          stripe_customer_id: sub.customer as string,
          stripe_subscription_id: sub.id,
          price_id: writtenPriceId,
          product_id: (item?.price.product as string | null) ?? null,
          status: sub.status,
          current_period_start: periodStart
            ? new Date(periodStart * 1000).toISOString()
            : null,
          current_period_end: periodEnd
            ? new Date(periodEnd * 1000).toISOString()
            : null,
          trial_end: sub.trial_end
            ? new Date(sub.trial_end * 1000).toISOString()
            : null,
          cancel_at_period_end: sub.cancel_at_period_end,
          canceled_at: sub.canceled_at
            ? new Date(sub.canceled_at * 1000).toISOString()
            : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "stripe_subscription_id" },
      );
    }

    return jsonResponse({
      status: session.status,
      payment_status: session.payment_status,
      mode: session.mode,
      priceId: writtenPriceId,
    });
  } catch (e) {
    console.error("verify-checkout-session error:", e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
});
