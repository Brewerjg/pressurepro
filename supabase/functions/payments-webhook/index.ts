// payments-webhook
//
// Stripe → TurfPro webhook handler. Validates the signature, deduplicates
// against `processed_stripe_events` (idempotency), and routes to one of
// three destinations:
//
//   * CONNECT events (event.account is set) — with DIRECT charges, ALL
//     operator↔customer money flows (deposits, balances, visit charges,
//     maintenance-plan subscriptions) are created on the operator's
//     connected account, so their events arrive here as Connect events. For
//     these we (a) write the `application_fees` cache for Reports, AND
//     (b) run the SAME deposit + plan-sync business routers used for
//     platform events, with Stripe reads scoped to the connected account.
//   * PLAN events (metadata.kind === 'maintenance_plan') → delegate to the
//     `sync-plan-status` edge function which mutates the `maintenance_plans`
//     row. (These now arrive as Connect events.)
//   * Platform APP-subscription events → upsert into `public.subscriptions`.
//     NOTE: operator SaaS subscriptions are sold via the mobile app store,
//     not Stripe, so this platform path is effectively legacy.
//
// ONE webhook endpoint handles both platform and Connect events. It MUST be
// registered with "Listen to events on Connected accounts" enabled so Stripe
// delivers the direct-charge events (see docs/STRIPE_PAYOUTS_SETUP.md).
// Stripe sends Connect events with `account: 'acct_xxx'` on the top-level
// event object; platform events don't have that field.
//
// Handled event types:
//   - checkout.session.completed
//   - customer.subscription.created / updated / deleted
//   - customer.subscription.paused / resumed
//   - invoice.payment_succeeded
//   - invoice.payment_failed
//   - charge.succeeded (Connect only — application_fees cache)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import {
  createStripeClient,
  getAppFromUrl,
  getStripeEnvFromUrl,
  getWebhookSecret,
  Stripe,
} from "../_shared/stripe.ts";

const UNIQUE_VIOLATION = "23505";

// ---------------------------------------------------------------------------
// Connect event handler
//
// Called for any Stripe event whose top-level `event.account` is set —
// meaning the event originated from a connected (operator) account, not
// TurfPro's platform account.
//
// What we do:
//   - charge.succeeded / invoice.payment_succeeded: write a row into
//     `application_fees` so Reports can compute "TurfPro fees this month"
//     and the Pro upgrade callout without round-tripping to Stripe.
//   - charge.failed: deliberately a no-op. The dunning push already fires
//     from the platform-side invoice.payment_failed handler via the
//     subscription's parent flow — duplicating it here would double-notify
//     the operator on every recurring decline.
//
// The webhook is the AUTHORITATIVE source for fee data — the local table
// is a cache used by the Reports UI.
// ---------------------------------------------------------------------------
async function handleConnectEvent(
  event: Stripe.Event,
  acctId: string,
  env: "live" | "sandbox",
  stripe: Stripe,
  supabase: ReturnType<typeof createClient>,
): Promise<void> {
  // Resolve the operator (user_id) from profiles.stripe_account_id. Without
  // this we can't link the fee back to a TurfPro user for Reports.
  let userId: string | null = null;
  try {
    const { data } = await supabase
      .from("profiles")
      .select("id")
      .eq("stripe_account_id", acctId)
      .maybeSingle();
    userId = data?.id ?? null;
  } catch (e) {
    console.warn("Connect: profile lookup failed", e);
  }
  if (!userId) {
    console.warn(`Connect event for unknown acct ${acctId}; skipping cache.`);
    return;
  }

  if (event.type === "charge.succeeded") {
    const charge = event.data.object as Stripe.Charge;
    // application_fee_amount is set on the charge by the direct-charge
    // application_fee at PI/sub create time. If it's null/0 the charge wasn't
    // fee-bearing (paid tier with no fee) and we can skip — but we still
    // record a 0 row so reports can show "0 fees on $X in revenue".
    const feeAmount = (charge as any).application_fee_amount ?? 0;
    const chargeAmount = charge.amount ?? 0;
    const meta = charge.metadata ?? {};
    const tier = (meta.tier_at_capture as string) ?? "payg";
    const feePercent = Number(meta.fee_percent ?? (chargeAmount > 0 ? (feeAmount / chargeAmount) * 100 : 0));

    const row: Record<string, unknown> = {
      user_id: userId,
      stripe_charge_id: charge.id,
      stripe_invoice_id: (charge as any).invoice as string | null ?? null,
      stripe_payment_intent_id:
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : null,
      plan_id: (meta.plan_id as string) ?? null,
      quote_id: (meta.quote_id as string) ?? null,
      customer_id: (meta.customer_id as string) ?? null,
      charge_amount_cents: chargeAmount,
      fee_amount_cents: feeAmount,
      fee_percent: Number.isFinite(feePercent) ? Number(feePercent.toFixed(2)) : 0,
      tier_at_capture: tier,
      collected_at: new Date(((charge.created ?? Math.floor(Date.now() / 1000))) * 1000).toISOString(),
    };
    const { error } = await supabase.from("application_fees").insert(row as never);
    if (error) {
      // Don't fail the webhook — a duplicate insert (Stripe retry) is fine
      // since we already deduped on event.id at the top of the handler.
      console.error("application_fees insert failed:", error);
    }
    return;
  }

  if (event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object as Stripe.Invoice;
    const feeAmount = (invoice as any).application_fee_amount ?? 0;
    const chargeAmount = invoice.amount_paid ?? 0;
    // Recurring subscription invoices: pull tier/plan metadata off the
    // parent subscription. Invoices don't carry sub-metadata directly.
    let tier = "payg";
    let feePercent = chargeAmount > 0 ? (feeAmount / chargeAmount) * 100 : 0;
    let planId: string | null = null;
    const subId = (invoice as any).subscription as string | null;
    if (subId) {
      try {
        const sub = await stripe.subscriptions.retrieve(subId, {
          stripeAccount: acctId,
        });
        tier = (sub.metadata?.tier_at_capture as string) ?? tier;
        feePercent = Number(sub.metadata?.fee_percent ?? feePercent);
        planId = (sub.metadata?.plan_id as string) ?? null;
      } catch (e) {
        console.warn("Connect invoice → sub retrieve failed", e);
      }
    }

    const row: Record<string, unknown> = {
      user_id: userId,
      stripe_charge_id: (invoice as any).charge as string | null ?? null,
      stripe_invoice_id: invoice.id,
      stripe_payment_intent_id: null,
      plan_id: planId,
      charge_amount_cents: chargeAmount,
      fee_amount_cents: feeAmount,
      fee_percent: Number.isFinite(feePercent) ? Number(feePercent.toFixed(2)) : 0,
      tier_at_capture: tier,
      collected_at: new Date(((invoice.created ?? Math.floor(Date.now() / 1000))) * 1000).toISOString(),
    };
    const { error } = await supabase.from("application_fees").insert(row as never);
    if (error) console.error("application_fees insert failed:", error);
    return;
  }

  if (event.type === "charge.failed") {
    // Intentional no-op. Dunning already triggers from the platform-side
    // invoice.payment_failed handler — duplicating it here would notify
    // the operator twice for every retry.
    console.log("Connect charge.failed — skipping (dunning runs from platform path)", acctId);
    return;
  }

  // Unhandled Connect event types: we acknowledge the event but don't do
  // anything. Stripe still considers them delivered.
  console.log("Unhandled Connect event type:", event.type);
}

Deno.serve(async (req) => {
  try {
    const env = getStripeEnvFromUrl(req);
    const app = getAppFromUrl(req);
    const stripe = createStripeClient(env, app);
    const secret = getWebhookSecret(env, app);

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
    // Connect vs platform.
    //   With DIRECT charges, the operator↔customer money flows (deposits,
    //   balances, maintenance-plan subscriptions) are created ON the
    //   operator's connected account, so their events arrive here with
    //   `event.account` set. For those we must run BOTH:
    //     1) the fee cache (application_fees) for money events, and
    //     2) the SAME business routers used for platform events (deposit
    //        recording + plan sync) — with every Stripe read scoped to the
    //        connected account via `acctOpts`.
    //   Platform events (event.account unset) are app-store / legacy SaaS
    //   subscription events and flow through the platform handlers below.
    // ----------------------------------------------------------------
    const acctId = (event as any).account as string | undefined;
    const acctOpts = acctId
      ? ({ stripeAccount: acctId } as { stripeAccount: string })
      : undefined;

    if (acctId) {
      // Fee cache — best-effort; must NOT block the business routing below.
      try {
        await handleConnectEvent(event, acctId, env, stripe, supabase);
      } catch (e) {
        console.error("Connect fee-cache handler failed:", e);
      }
    }

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

    // Fire-and-forget native push to the operator when a plan's card fails.
    // ONE-line addition per the Tier-2 spec — we deliberately don't touch
    // the idempotency / sync flow above. send-push is robust to "no tokens
    // registered" (it returns ok:true, sent:0) so this is safe to call
    // even before the operator has installed the native app.
    const dispatchPushOnPlanFailure = async (
      userId: string,
      planId: string | null,
    ) => {
      const url = `${Deno.env.get("SUPABASE_URL")!}/functions/v1/send-push`;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
          },
          body: JSON.stringify({
            user_id: userId,
            title: "Card declined on a plan",
            body: "Tap to send a retry link to the customer.",
            data: planId
              ? { kind: "dunning", plan_id: planId, route: `/plans/${planId}` }
              : { kind: "dunning" },
          }),
        });
        if (!res.ok) {
          console.error("send-push returned", res.status, await res.text());
        }
      } catch (e) {
        console.error("send-push invoke failed", e);
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
            stripeSub = await stripe.subscriptions.retrieve(
              subId,
              {
                expand: [
                  "default_payment_method",
                  "latest_invoice.payment_intent",
                ],
              },
              acctOpts,
            );
            // Ensure kind/plan_id are pinned to the subscription (Stripe
            // copies them via subscription_data.metadata on create — this
            // is a defensive re-write in case of older sessions).
            if (
              stripeSub.metadata?.kind !== "maintenance_plan" ||
              stripeSub.metadata?.plan_id !== planId
            ) {
              await stripe.subscriptions.update(
                subId,
                {
                  metadata: {
                    ...stripeSub.metadata,
                    kind: "maintenance_plan",
                    plan_id: planId,
                    user_id: session.metadata?.user_id ?? "",
                  },
                },
                acctOpts,
              );
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
          sub = await stripe.subscriptions.retrieve(subId, undefined, acctOpts);
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
            const charge = await stripe.charges.retrieve(
              chargeId,
              undefined,
              acctOpts,
            );
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

        // Dunning push: notify the operator on their phone that a plan
        // payment failed. Fire-and-forget — failing to push must not roll
        // back the sync above. We only fire on invoice.payment_failed (not
        // succeeded) to avoid notification spam on routine renewals.
        if (event.type === "invoice.payment_failed") {
          const operatorUserId = sub.metadata?.user_id ?? sub.metadata?.userId;
          if (operatorUserId) {
            await dispatchPushOnPlanFailure(
              operatorUserId,
              sub.metadata?.plan_id ?? null,
            );
          }
        }
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
    // Deposit router
    //   Deposits/balances taken from the public Accept/Invoice pages go
    //   through create-checkout-session (kind:'deposit'|'balance') as a
    //   DIRECT-charge `payment`-mode Checkout Session created ON the
    //   operator's connected account. So checkout.session.completed arrives
    //   as a CONNECT event (event.account set) — but this router reads only
    //   the session object (metadata/amount/payment_intent) so it works
    //   unchanged whether the event is platform or Connect. It runs after the
    //   Connect fee-cache above.
    //
    //   The invoice now OWNS deposits. When metadata.invoice_id is present
    //   we stamp invoices.deposit_paid_at, record a manual_payments row
    //   linked to the invoice, and recompute the invoice status to 'paid'
    //   once cumulative non-voided payments reach the invoice total.
    //
    //   We keep the legacy quote behavior (quotes.deposit_paid_at +
    //   quote-linked payment) intact for back-compat with quotes that don't
    //   yet have an invoice.
    // ----------------------------------------------------------------
    const routeIfDeposit = async (): Promise<boolean> => {
      if (event.type !== "checkout.session.completed") return false;
      const session = event.data.object as Stripe.Checkout.Session;
      const meta = session.metadata ?? {};
      if (meta.kind !== "deposit" && meta.kind !== "balance") return false;
      // A balance charge pays down the invoice but is NOT a deposit, so it must
      // not stamp deposit_paid_at — only record the payment + recompute status.
      const isBalance = meta.kind === "balance";

      // Only act on a fully-paid session. Stripe sends session.completed for
      // async/processing payments too; we wait for payment_status='paid'.
      if (session.payment_status && session.payment_status !== "paid") {
        console.log("Deposit session not paid yet:", session.id, session.payment_status);
        return true; // consumed — nothing more to do until it settles
      }

      const quoteId = (meta.quote_id as string) ?? null;
      const invoiceId = (meta.invoice_id as string) ?? null;
      const operatorUserId =
        (meta.userId as string) ?? (meta.operatorUserId as string) ?? null;
      const customerId = (meta.customer_id as string) ?? null;
      const amountCents = Number(session.amount_total ?? 0);
      const paidAt = new Date(
        (session.created ?? Math.floor(Date.now() / 1000)) * 1000,
      ).toISOString();
      // Stable id used to dedupe the recorded payment row across Stripe
      // retries / the parallel Connect charge.succeeded event.
      const stripeRef =
        (typeof session.payment_intent === "string"
          ? session.payment_intent
          : null) ?? session.id;
      const noteTag = `stripe ${meta.kind} ${stripeRef}`;

      // ---- Invoice-owned path (preferred) ----
      if (invoiceId) {
        if (!isBalance) {
          try {
            await supabase
              .from("invoices")
              .update({
                deposit_paid_at: paidAt,
                updated_at: new Date().toISOString(),
              } as never)
              .eq("id", invoiceId)
              .is("deposit_paid_at", null);
          } catch (e) {
            console.error("invoice deposit_paid_at update failed", e);
          }
        }

        // Record the payment against the invoice (idempotent on noteTag).
        if (operatorUserId && amountCents > 0) {
          try {
            const { data: existing } = await supabase
              .from("manual_payments")
              .select("id")
              .eq("invoice_id", invoiceId)
              .eq("notes", noteTag)
              .maybeSingle();
            if (!existing) {
              await supabase.from("manual_payments").insert({
                user_id: operatorUserId,
                invoice_id: invoiceId,
                quote_id: quoteId,
                customer_id: customerId,
                method: "other",
                amount_cents: amountCents,
                received_at: paidAt,
                notes: noteTag,
              } as never);
            }
          } catch (e) {
            console.error("invoice deposit payment insert failed", e);
          }
        }

        // Recompute status: mark 'paid' once cumulative non-voided payments
        // reach the invoice total.
        try {
          const { data: inv } = await supabase
            .from("invoices")
            .select("total,status")
            .eq("id", invoiceId)
            .maybeSingle();
          const total = Number((inv as any)?.total ?? 0);
          const status = (inv as any)?.status as string | undefined;
          if (inv && status !== "void" && status !== "paid" && total > 0) {
            const { data: pays } = await supabase
              .from("manual_payments")
              .select("amount_cents,status")
              .eq("invoice_id", invoiceId);
            const paidCents = (pays ?? [])
              .filter((p: any) => p.status !== "voided")
              .reduce((s: number, p: any) => s + Number(p.amount_cents ?? 0), 0);
            if (paidCents >= Math.round(total * 100)) {
              await supabase
                .from("invoices")
                .update({
                  status: "paid",
                  updated_at: new Date().toISOString(),
                } as never)
                .eq("id", invoiceId);
            }
          }
        } catch (e) {
          console.error("invoice status recompute failed", e);
        }
      }

      // ---- Legacy quote path (back-compat) ----
      // Stamp the quote's deposit_paid_at when we have a quote_id so existing
      // quote-centric UI keeps working — but only for an actual DEPOSIT; a
      // balance payment isn't a deposit.
      if (quoteId && !isBalance) {
        try {
          await supabase
            .from("quotes")
            .update({
              deposit_paid_at: paidAt,
              deposit_session_id: session.id,
              updated_at: new Date().toISOString(),
            } as never)
            .eq("id", quoteId)
            .is("deposit_paid_at", null);
        } catch (e) {
          console.error("quote deposit_paid_at update failed", e);
        }

        // When there is NO invoice yet, record the payment against the quote
        // so cumulative-paid logic on QuoteDetail still works. If an invoice
        // exists we already recorded it above (linked to the invoice) and
        // must not double-count.
        if (!invoiceId && operatorUserId && amountCents > 0) {
          try {
            const { data: existing } = await supabase
              .from("manual_payments")
              .select("id")
              .eq("quote_id", quoteId)
              .eq("notes", noteTag)
              .maybeSingle();
            if (!existing) {
              await supabase.from("manual_payments").insert({
                user_id: operatorUserId,
                quote_id: quoteId,
                customer_id: customerId,
                method: "other",
                amount_cents: amountCents,
                received_at: paidAt,
                notes: noteTag,
              } as never);
            }
          } catch (e) {
            console.error("quote deposit payment insert failed", e);
          }
        }
      }

      return true;
    };

    const consumedByDepositFlow = await routeIfDeposit();
    if (consumedByDepositFlow) {
      return new Response(
        JSON.stringify({ received: true, route: "deposit" }),
        { headers: { "Content-Type": "application/json" } },
      );
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
