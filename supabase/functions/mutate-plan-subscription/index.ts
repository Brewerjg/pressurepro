// mutate-plan-subscription
//
// Pause / resume / cancel a Stripe Subscription that backs a TurfPro
// maintenance_plan. PlanDetail.tsx calls this in addition to its
// optimistic local DB update so the actual card-on-file is correctly
// honored on the next billing cycle.
//
// Actions:
//   - pause   → set pause_collection={ behavior: 'mark_uncollectible' }
//   - resume  → clear pause_collection (pass null per Stripe API)
//   - cancel  → set cancel_at_period_end=true (the customer keeps the
//               benefit through the current period, then auto-cancels)
//
// Auth: contractor-facing — must be the plan's owner (user_id match).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import {
  createStripeClient,
  getStripeEnvFromUrl,
  type StripeEnv,
} from "../_shared/stripe.ts";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";

type Action = "pause" | "resume" | "cancel";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const env: StripeEnv = getStripeEnvFromUrl(req);
    const stripe = createStripeClient(env);

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

    const body = await req.json().catch(() => ({}));
    const { plan_id, action } = body as { plan_id?: string; action?: Action };
    if (!plan_id) {
      return jsonResponse({ error: "Missing plan_id" }, { status: 400 });
    }
    if (action !== "pause" && action !== "resume" && action !== "cancel") {
      return jsonResponse({ error: "Invalid action" }, { status: 400 });
    }

    const { data: plan, error: pErr } = await admin
      .from("maintenance_plans")
      .select("id, user_id, stripe_subscription_id, status")
      .eq("id", plan_id)
      .maybeSingle();
    if (pErr || !plan) {
      return jsonResponse({ error: "Plan not found" }, { status: 404 });
    }
    if (plan.user_id !== userId) {
      return jsonResponse({ error: "Forbidden" }, { status: 403 });
    }
    if (!plan.stripe_subscription_id) {
      // No Stripe sub means we never finished provisioning. The DB-side
      // status update from the client is the only thing we can do; return
      // OK so the caller doesn't error out.
      return jsonResponse({ ok: true, status: action, note: "no_stripe_sub" });
    }

    if (action === "pause") {
      await stripe.subscriptions.update(plan.stripe_subscription_id, {
        pause_collection: { behavior: "mark_uncollectible" },
      });
      return jsonResponse({ ok: true, status: "paused" });
    }
    if (action === "resume") {
      // Stripe wants pause_collection set to '' / null to clear it. The
      // SDK accepts null via the typed shape.
      await stripe.subscriptions.update(plan.stripe_subscription_id, {
        pause_collection: null as never,
      });
      return jsonResponse({ ok: true, status: "active" });
    }
    // cancel
    await stripe.subscriptions.update(plan.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
    return jsonResponse({ ok: true, status: "canceling_at_period_end" });
  } catch (e) {
    console.error("mutate-plan-subscription error:", e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
});
