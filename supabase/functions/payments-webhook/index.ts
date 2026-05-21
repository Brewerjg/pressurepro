// payments-webhook
//
// Stripe → TurfPro webhook handler. Validates the signature, deduplicates
// against `processed_stripe_events` (idempotency), and processes the six
// canonical SaaS-subscription events:
//
//   - checkout.session.completed
//   - customer.subscription.created
//   - customer.subscription.updated
//   - customer.subscription.deleted
//   - invoice.payment_succeeded
//   - invoice.payment_failed
//
// All subscription writes upsert into `public.subscriptions` keyed on
// stripe_subscription_id. Maintenance-plan (custom plan) syncing is NOT
// handled here yet — that's a follow-up; the existing Plans.tsx / PlanDetail
// flow has TODO comments noting it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import {
  createStripeClient,
  getStripeEnvFromUrl,
  getWebhookSecret,
  Stripe,
} from "../_shared/stripe.ts";

const UNIQUE_VIOLATION = "23505";

Deno.serve(async (req) => {
  try {
    const env = getStripeEnvFromUrl(req);
    const stripe = createStripeClient(env);
    const secret = getWebhookSecret(env);

    const sig = req.headers.get("stripe-signature");
    if (!sig) return new Response("Missing signature", { status: 400 });

    const raw = await req.text();
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(
        raw,
        sig,
        secret,
        undefined,
        Stripe.createSubtleCryptoProvider(),
      );
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      return new Response("Invalid signature", { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ----------------------------------------------------------------
    // Idempotency — short-circuit if Stripe is retrying an event we've
    // already processed. Stripe retries with the same event.id on any
    // non-2xx response, so without dedup we'd double-write rows.
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
      // Unknown DB error — return 500 so Stripe retries. We'd rather double
      // up at the dedup table than miss an event.
      console.error("Idempotency insert failed:", insertErr);
      return new Response("Idempotency error", { status: 500 });
    }

    console.log("Processing event", event.type, "env:", env);

    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------
    const resolveLookupKey = async (priceId: string): Promise<string | null> => {
      try {
        const price = await stripe.prices.retrieve(priceId);
        return price.lookup_key || null;
      } catch {
        return null;
      }
    };

    const upsertSubscription = async (sub: Stripe.Subscription) => {
      const userId = sub.metadata?.userId;
      if (!userId) {
        console.warn("Subscription missing userId metadata", sub.id);
        return;
      }
      const item = sub.items.data[0];
      const lookupKey = item ? await resolveLookupKey(item.price.id) : null;
      // dahlia API: period fields live on items.
      const periodStart =
        (item as any)?.current_period_start ?? (sub as any).current_period_start;
      const periodEnd =
        (item as any)?.current_period_end ?? (sub as any).current_period_end;

      const row = {
        user_id: userId,
        environment: env,
        stripe_customer_id: sub.customer as string,
        stripe_subscription_id: sub.id,
        price_id: lookupKey,
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
      };

      const { error } = await supabase
        .from("subscriptions")
        .upsert(row, { onConflict: "stripe_subscription_id" });
      if (error) console.error("Subscription upsert failed:", error);
    };

    // ----------------------------------------------------------------
    // checkout.session.completed
    //   Fires once when the user finishes Checkout. We use it as a
    //   defensive write-path so the row exists even if
    //   customer.subscription.created arrives moments later.
    // ----------------------------------------------------------------
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      if (userId && session.mode === "subscription" && session.subscription) {
        const subId = session.subscription as string;
        const sub = await stripe.subscriptions.retrieve(subId);
        // Make sure userId is on the subscription itself so future
        // subscription.* events can find it.
        if (!sub.metadata?.userId) {
          await stripe.subscriptions.update(subId, {
            metadata: { ...sub.metadata, userId },
          });
          sub.metadata = { ...sub.metadata, userId };
        }
        await upsertSubscription(sub);
      }
    }

    // ----------------------------------------------------------------
    // customer.subscription.created / updated / deleted
    //   Lifecycle events — re-upsert on every change so cancel-at-end,
    //   trial transitions, plan changes, etc. all flow through.
    // ----------------------------------------------------------------
    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const sub = event.data.object as Stripe.Subscription;
      await upsertSubscription(sub);
    }

    // ----------------------------------------------------------------
    // invoice.payment_succeeded
    //   Renewal landed. Re-fetch the subscription to pick up the fresh
    //   period_end. We ignore the invoice fields themselves because the
    //   subscription is the source of truth for period boundaries.
    // ----------------------------------------------------------------
    if (event.type === "invoice.payment_succeeded") {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = (invoice as any).subscription as string | null;
      if (subId) {
        try {
          const sub = await stripe.subscriptions.retrieve(subId);
          if (sub.metadata?.userId) await upsertSubscription(sub);
        } catch (e) {
          console.error("Failed to refresh sub on invoice.payment_succeeded", e);
        }
      }
    }

    // ----------------------------------------------------------------
    // invoice.payment_failed
    //   Card declined or other failure. We don't downgrade the sub
    //   ourselves — Stripe will transition it to past_due / unpaid /
    //   canceled and re-fire a subscription.updated. But we DO surface
    //   the status promptly by retrieving the subscription so the UI
    //   gates accordingly.
    // ----------------------------------------------------------------
    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = (invoice as any).subscription as string | null;
      if (subId) {
        try {
          const sub = await stripe.subscriptions.retrieve(subId);
          if (sub.metadata?.userId) await upsertSubscription(sub);
        } catch (e) {
          console.error("Failed to refresh sub on invoice.payment_failed", e);
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("payments-webhook error:", e);
    return new Response("Server error", { status: 500 });
  }
});
