// payments-webhook
//
// Stripe → TurfPro webhook handler. Validates the signature, deduplicates
// against `processed_stripe_events` (idempotency), and routes to one of
// two destinations based on the subscription's metadata.kind:
//
//   * App-level SaaS subscriptions (the default) → upsert into
//     `public.subscriptions` keyed on stripe_subscription_id.
//   * Maintenance-plan subscriptions (metadata.kind === 'maintenance_plan')
//     → delegate to the `sync-plan-status` edge function which mutates the
//     `maintenance_plans` row instead.
//
// Handled event types:
//   - checkout.session.completed
//   - customer.subscription.created / updated / deleted
//   - customer.subscription.paused / resumed
//   - invoice.payment_succeeded
//   - invoice.payment_failed

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
    // Plan-subscription router
    //   Subscriptions created by create-plan-subscription carry
    //   metadata.kind='maintenance_plan' and a plan_id. We forward those
    //   events to sync-plan-status via an HTTP invoke. App-level SaaS
    //   subs (no kind, or kind!='maintenance_plan') fall through to the
    //   existing handlers below.
    // ----------------------------------------------------------------
    const dispatchPlanSync = async (payload: Record<string, unknown>) => {
      const url = `${Deno.env.get("SUPABASE_URL")!}/functions/v1/sync-plan-status`;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          console.error("sync-plan-status returned", res.status, await res.text());
        }
      } catch (e) {
        console.error("sync-plan-status invoke failed", e);
      }
    };

    // Returns true when the event was consumed by the plan flow and the
    // caller should NOT also run the SaaS-subscription handlers.
    const routeIfPlan = async (): Promise<boolean> => {
      // checkout.session.completed: read metadata off the session itself.
      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        const kind = session.metadata?.kind;
        const planId = session.metadata?.plan_id;
        if (kind !== "maintenance_plan" || !planId) return false;

        // Mark the plan row active and stash the subscription + customer.
        // We mirror userId onto the subscription's metadata for future
        // events (Stripe sub-level metadata is sticky and survives portal
        // edits, where session-level metadata wouldn't).
        if (session.subscription) {
          const subId = session.subscription as string;
          let stripeSub: Stripe.Subscription | null = null;
          try {
            stripeSub = await stripe.subscriptions.retrieve(subId, {
              expand: ["default_payment_method", "latest_invoice.payment_intent"],
            });
            // Ensure kind/plan_id are pinned to the subscription (Stripe
            // copies them via subscription_data.metadata on create — this
            // is a defensive re-write in case of older sessions).
            if (
              stripeSub.metadata?.kind !== "maintenance_plan" ||
              stripeSub.metadata?.plan_id !== planId
            ) {
              await stripe.subscriptions.update(subId, {
                metadata: {
                  ...stripeSub.metadata,
                  kind: "maintenance_plan",
                  plan_id: planId,
                  user_id: session.metadata?.user_id ?? "",
                },
              });
            }
          } catch (e) {
            console.error("retrieve sub after checkout failed", e);
          }

          // Extract last4 from the default_payment_method if present so
          // the plan card-on-file display is accurate immediately.
          let cardLast4: string | null = null;
          const pm = stripeSub?.default_payment_method;
          if (pm && typeof pm !== "string") {
            cardLast4 = pm.card?.last4 ?? null;
          }

          const updates: Record<string, unknown> = {
            stripe_subscription_id: subId,
            stripe_customer_id:
              (session.customer as string | null) ??
              (stripeSub?.customer as string | null) ??
              null,
            stripe_price_id:
              stripeSub?.items.data[0]?.price.id ?? null,
            status: "active",
            updated_at: new Date().toISOString(),
          };
          if (cardLast4) updates.card_last4 = cardLast4;

          await supabase
            .from("maintenance_plans")
            .update(updates as never)
            .eq("id", planId);
        }
        return true;
      }

      // subscription.* events: inspect the subscription metadata.
      if (
        event.type === "customer.subscription.created" ||
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.deleted" ||
        event.type === "customer.subscription.paused" ||
        event.type === "customer.subscription.resumed"
      ) {
        const sub = event.data.object as Stripe.Subscription;
        if (sub.metadata?.kind !== "maintenance_plan") return false;
        await dispatchPlanSync({
          event_type: event.type,
          plan_id: sub.metadata?.plan_id ?? null,
          subscription: sub,
        });
        return true;
      }

      // invoice.* events: load the subscription to read metadata. We have
      // to retrieve because Stripe doesn't denormalize sub-metadata onto
      // the invoice object.
      if (
        event.type === "invoice.payment_succeeded" ||
        event.type === "invoice.payment_failed"
      ) {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = (invoice as any).subscription as string | null;
        if (!subId) return false;
        let sub: Stripe.Subscription | null = null;
        try {
          sub = await stripe.subscriptions.retrieve(subId);
        } catch (e) {
          console.error("invoice → sub retrieve failed", e);
          return false;
        }
        if (sub.metadata?.kind !== "maintenance_plan") return false;

        // Extract last4 from the invoice's charge if available.
        let cardLast4: string | null = null;
        try {
          const chargeId = (invoice as any).charge as string | null;
          if (chargeId) {
            const charge = await stripe.charges.retrieve(chargeId);
            cardLast4 = charge.payment_method_details?.card?.last4 ?? null;
          }
        } catch (e) {
          console.warn("charge last4 lookup failed", e);
        }

        await dispatchPlanSync({
          event_type: event.type,
          plan_id: sub.metadata?.plan_id ?? null,
          subscription: sub,
          invoice: {
            id: invoice.id,
            amount_paid: invoice.amount_paid,
            subscription: subId,
            card_last4: cardLast4,
          },
        });
        return true;
      }

      return false;
    };

    const consumedByPlanFlow = await routeIfPlan();
    if (consumedByPlanFlow) {
      return new Response(JSON.stringify({ received: true, route: "plan" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

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
