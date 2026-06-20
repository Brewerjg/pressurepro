// create-plan-subscription
//
// Wires a TurfPro maintenance_plan to a real Stripe Subscription that will
// actually charge the customer's card on the agreed cadence. There are two
// shapes of caller depending on whether the contractor (the TurfPro user)
// has previously created a maintenance_plan for THIS lawn-care customer
// (looked up by phone within the user's namespace):
//
//   1) First time billing this homeowner — no Stripe Customer exists yet,
//      so we mint a Checkout Session in mode='subscription' which (a) makes
//      the Stripe Customer, (b) collects + attaches the card as the default
//      payment method, and (c) creates the Subscription. The returned
//      session.url is the next stop the browser must visit. After payment
//      Stripe redirects to /checkout/return?kind=plan&plan_id=...
//
//   2) Returning homeowner with a card on file — we already know the
//      stripe_customer_id (from an earlier plan row); we just create the
//      Subscription server-side using `default_payment_method` and skip
//      Checkout entirely. The plan is immediately active.
//
// The plan row is created BEFORE talking to Stripe so we can carry the
// `plan_id` through to subscription metadata; if Stripe fails we delete
// the row to avoid orphans. Each plan gets its own ad-hoc Stripe Price
// (recurring monthly, interval_count = interval_months) — this matches
// PressurePro's strategy and avoids maintaining a price catalog.
//
// Auth: this is called from the contractor's signed-in app; we resolve
// the user from the bearer token and reject if the requested plan belongs
// to anyone else.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import {
  createStripeClient,
  getStripeEnvFromUrl,
  type AppId,
  type StripeEnv,
  Stripe,
} from "../_shared/stripe.ts";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { loadOperatorConnect } from "../_shared/fees.ts";

const APP_ID: AppId = "turfpro";

// Mirrors APP_ID in src/lib/app-context.ts. Keep in sync.
const APP_ID = "turfpro";

// Stripe rejects subscription unit_amount values below 50 cents. We mirror
// that check up-front so the operator sees a clear error before bouncing.
const STRIPE_MIN_CENTS = 50;

type PlanInsert = {
  user_id: string;
  customer_id: string | null;
  property_id: string | null;
  customer_name: string;
  phone: string;
  address: string;
  services: string[];
  amount: number;
  interval_months: number;
  start_date: string;
  next_charge_date: string;
  status: "active";
  day_of_week?: number | null;
  frequency?: string | null;
  season_pause?: string[] | null;
  plan_kind?: string | null;
};

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const env: StripeEnv = getStripeEnvFromUrl(req);
    // Stripe may not be configured yet (no STRIPE_*_API_KEY secret). In
    // that case we fall back to a "standalone" plan — the row is inserted
    // with status='active' and no Stripe wiring, and the operator can
    // collect a card later from PlanDetail. This keeps NewPlan usable
    // BEFORE Stripe is wired up, instead of failing with "plan disappeared".
    let stripe: Stripe | null = null;
    let stripeConfigured = false;
    try {
      stripe = createStripeClient(env, APP_ID);
      stripeConfigured = true;
    } catch (e) {
      console.warn(
        "[create-plan-subscription] Stripe not configured — falling back to standalone insert.",
        e instanceof Error ? e.message : e,
      );
    }

    // ----- Auth: resolve user from JWT -----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Unauthorized" }, { status: 401 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey =
      Deno.env.get("SUPABASE_ANON_KEY") ??
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
      "";

    const admin = createClient(supabaseUrl, serviceKey);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return jsonResponse({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = userData.user.id;
    const userEmail = userData.user.email ?? undefined;

    // ----- Validate body -----
    const body = await req.json().catch(() => ({}));
    const {
      plan,
      origin: originBody,
    } = body as { plan?: PlanInsert; origin?: string };
    if (!plan || typeof plan !== "object") {
      return jsonResponse({ error: "Missing plan payload" }, { status: 400 });
    }
    if (!plan.customer_name || !plan.address) {
      return jsonResponse(
        { error: "customer_name and address are required" },
        { status: 400 },
      );
    }
    const intervalMonths = Number(plan.interval_months) || 3;
    if (![1, 3, 6, 12].includes(intervalMonths)) {
      return jsonResponse(
        { error: "interval_months must be 1, 3, 6, or 12" },
        { status: 400 },
      );
    }
    const amountCents = Math.round(Number(plan.amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents < STRIPE_MIN_CENTS) {
      return jsonResponse({ error: "Plan amount too small" }, { status: 400 });
    }

    // ----- Look up the customer's prior Stripe customer id, if any -----
    // We scope the lookup to the contractor's own plans (user_id) so a
    // shared phone number across operators won't accidentally cross-link
    // billing. Most ergonomic match key is the customer_id (FK); we fall
    // back to phone for legacy rows.
    let existingCustomerId: string | null = null;
    let existingCardLast4: string | null = null;
    if (plan.customer_id) {
      const { data: priorPlans } = await admin
        .from("maintenance_plans")
        .select("stripe_customer_id, card_last4")
        .eq("user_id", userId)
        .eq("app", APP_ID)
        .eq("customer_id", plan.customer_id)
        .not("stripe_customer_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);
      if (priorPlans && priorPlans.length > 0) {
        existingCustomerId = priorPlans[0].stripe_customer_id ?? null;
        existingCardLast4 = priorPlans[0].card_last4 ?? null;
      }
    }
    if (!existingCustomerId && plan.phone) {
      const { data: byPhone } = await admin
        .from("maintenance_plans")
        .select("stripe_customer_id, card_last4")
        .eq("user_id", userId)
        .eq("app", APP_ID)
        .eq("phone", plan.phone)
        .not("stripe_customer_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);
      if (byPhone && byPhone.length > 0) {
        existingCustomerId = byPhone[0].stripe_customer_id ?? null;
        existingCardLast4 = byPhone[0].card_last4 ?? null;
      }
    }

    // ----- Insert the plan row up front so we have its UUID -----
    // We force user_id from the JWT — never trust the body.
    const insertPayload: Record<string, unknown> = {
      ...plan,
      user_id: userId,
      stripe_customer_id: existingCustomerId,
      card_last4: existingCardLast4,
      status: "active",
      app: APP_ID,
    };
    const { data: insertedRows, error: insertErr } = await admin
      .from("maintenance_plans")
      .insert(insertPayload as never)
      .select("id, portal_token")
      .single();
    if (insertErr || !insertedRows) {
      console.error("maintenance_plans insert failed", insertErr);
      return jsonResponse(
        { error: insertErr?.message || "Could not create plan" },
        { status: 500 },
      );
    }
    const planId = insertedRows.id as string;

    // ----- Stripe-not-configured short-circuit -----
    // If we couldn't construct a Stripe client up front (no API key set),
    // we still inserted the plan row. Return success so the operator's
    // plan exists in the DB; they can wire Stripe later and collect a
    // card from PlanDetail. No rollback — the row is fine standalone.
    if (!stripeConfigured || !stripe) {
      return jsonResponse({ planId, mode: "standalone_no_stripe" });
    }

    // Local helper — if Stripe blows up we need to remove the orphan plan
    // row so the operator can retry without a half-baked record sitting
    // there.
    const rollback = async () => {
      try {
        await admin.from("maintenance_plans").delete().eq("id", planId);
      } catch (e) {
        console.error("rollback failed", e);
      }
    };

    const productName = `Maintenance Plan – ${plan.customer_name}`;
    const baseMetadata: Record<string, string> = {
      plan_id: planId,
      user_id: userId,
      kind: "maintenance_plan",
      environment: env,
    };

    // ----- Stripe Connect routing -----
    // Look up the operator's stripe_account_id + connect_ready, plus their
    // current tier (PAYG vs Solo/Pro/Crew) to derive the application-fee
    // percentage. `shouldRoute` is true only when:
    //   STRIPE_CONNECT_ENABLED is truthy (dev escape hatch)
    //   AND profiles.connect_ready is true
    //   AND profiles.stripe_account_id is set
    //
    // V1 transition: if Connect is NOT ready we fall back to the current
    // behavior — charge on the platform account. This unblocks operators
    // who haven't done Connect onboarding yet. The long-term path is to
    // REQUIRE Connect before allowing card-on-file plan billing (so funds
    // settle to the operator, not TurfPro), but we can't enforce that
    // until every operator has completed Express onboarding.
    const operator = await loadOperatorConnect(admin, userId);
    baseMetadata.tier_at_capture = operator.tier;
    baseMetadata.fee_percent = String(operator.feePercent);

    // application_fee_percent on subscriptions is IMMUTABLE once set, and
    // transfer_data.destination is also pinned at create. Decide once here.
    // For fee==0 paid tiers we still set transfer_data so the operator gets
    // 100% routed to their Connect account.
    const transferData = operator.shouldRoute
      ? { destination: operator.stripeAccountId! }
      : undefined;
    const applicationFeePercent =
      operator.shouldRoute && operator.feePercent > 0
        ? operator.feePercent
        : undefined;

    // ----- Branch: existing customer with card on file vs new -----
    if (existingCustomerId) {
      // Direct server-side subscription. Confirm the customer has a usable
      // default payment method — if not, we still fall back to Checkout
      // because billing a customer without a PM will just dunning-loop.
      let hasDefaultPm = false;
      try {
        const customer = await stripe.customers.retrieve(existingCustomerId);
        if (
          customer &&
          !(customer as Stripe.DeletedCustomer).deleted &&
          (customer as Stripe.Customer).invoice_settings?.default_payment_method
        ) {
          hasDefaultPm = true;
        }
      } catch (e) {
        console.warn("customer retrieve failed", e);
      }

      if (hasDefaultPm) {
        try {
          // Build the recurring price inline as price_data on the sub
          // item — same approach as PressurePro.
          //
          // Connect routing: when shouldRoute is true we set
          // transfer_data.destination at create time (it is immutable
          // afterwards). For PAYG (fee > 0) we also set
          // application_fee_percent so Stripe deducts our cut on each
          // recurring invoice. For paid tiers (fee == 0) we set
          // transfer_data but NOT application_fee_percent — the operator
          // keeps 100%.
          const sub = await stripe.subscriptions.create({
            customer: existingCustomerId,
            items: [
              {
                price_data: {
                  currency: "usd",
                  product_data: { name: productName },
                  unit_amount: amountCents,
                  recurring: {
                    interval: "month",
                    interval_count: intervalMonths,
                  },
                },
                quantity: 1,
              },
            ],
            metadata: baseMetadata,
            // Surface the same metadata on the invoice so any out-of-band
            // tooling can route them too.
            payment_behavior: "allow_incomplete",
            ...(transferData ? { transfer_data: transferData } : {}),
            ...(applicationFeePercent !== undefined
              ? { application_fee_percent: applicationFeePercent }
              : {}),
          });

          await admin
            .from("maintenance_plans")
            .update({
              stripe_subscription_id: sub.id,
              stripe_customer_id: existingCustomerId,
              stripe_price_id: sub.items.data[0]?.price.id ?? null,
              status: "active",
              updated_at: new Date().toISOString(),
            } as never)
            .eq("id", planId);

          return jsonResponse({ planId, mode: "existing_card" });
        } catch (e) {
          console.error("server-side subscription create failed", e);
          // Fall through to Checkout as a safety net.
        }
      }
    }

    // ----- Checkout fallback (new customer OR no usable PM on file) -----
    const origin =
      originBody || req.headers.get("origin") || "https://example.com";
    const successUrl =
      `${origin}/checkout/return?kind=plan&plan_id=${planId}` +
      `&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}/checkout/return?kind=plan&plan_id=${planId}&canceled=1`;

    try {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        // If we already have a Stripe Customer for this homeowner, reuse
        // it so card-on-file logic stays consistent.
        ...(existingCustomerId
          ? { customer: existingCustomerId }
          : userEmail
            ? { customer_email: userEmail }
            : {}),
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: productName },
              unit_amount: amountCents,
              recurring: {
                interval: "month",
                interval_count: intervalMonths,
              },
            },
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: baseMetadata,
        subscription_data: {
          metadata: baseMetadata,
          // For Checkout-created subscriptions the only way to attach
          // Connect routing is via subscription_data — transfer_data and
          // application_fee_percent get copied onto the resulting sub
          // and are immutable thereafter.
          ...(transferData ? { transfer_data: transferData } : {}),
          ...(applicationFeePercent !== undefined
            ? { application_fee_percent: applicationFeePercent }
            : {}),
        },
      });

      if (!session.url) {
        await rollback();
        return jsonResponse(
          { error: "Stripe did not return a session URL" },
          { status: 502 },
        );
      }
      return jsonResponse({ checkoutUrl: session.url, planId });
    } catch (e) {
      console.error("checkout session create failed", e);
      await rollback();
      return jsonResponse(
        { error: e instanceof Error ? e.message : "Stripe error" },
        { status: 502 },
      );
    }
  } catch (e) {
    console.error("create-plan-subscription error:", e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
});
