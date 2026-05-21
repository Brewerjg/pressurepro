// create-plan-portal-session
//
// PUBLIC endpoint — no JWT required. The maintenance customer (homeowner)
// landed on /plans/portal/:token, tapped "Update payment method", and now
// needs a Stripe Billing Portal session minted for THEIR Stripe Customer.
//
// The `portal_token` (uuid stored on maintenance_plans.portal_token) IS
// the bearer credential. Possessing it grants access to a portal scoped
// to that one customer's subscriptions; Stripe's portal does the actual
// authorization (the customer can only manage their own card / sub).
//
// Returns `{ url }`; PlanPortal.tsx redirects the browser there.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import {
  createStripeClient,
  getStripeEnvFromUrl,
} from "../_shared/stripe.ts";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const env = getStripeEnvFromUrl(req);

    // Allow `portal_token` from either JSON body or query string. Body is
    // the common path (PlanPortal posts JSON); the query param exists for
    // direct link debugging.
    const body = await req.json().catch(() => ({}));
    const url = new URL(req.url);
    const portalToken =
      (body as { portal_token?: string }).portal_token ??
      url.searchParams.get("portal_token") ??
      undefined;

    if (!portalToken || !/^[0-9a-f-]{36}$/i.test(portalToken)) {
      return jsonResponse({ error: "Invalid token" }, { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: plan, error: pErr } = await supabase
      .from("maintenance_plans")
      .select("id, status, stripe_customer_id")
      .eq("portal_token", portalToken)
      .maybeSingle();

    if (pErr || !plan) {
      return jsonResponse({ error: "Plan not found" }, { status: 404 });
    }
    if (!plan.stripe_customer_id) {
      // Plan exists but Stripe Customer hasn't been provisioned yet — the
      // initial Checkout hasn't completed. Surface as 409 so the client
      // can show a "your subscription isn't ready yet" message.
      return jsonResponse(
        { error: "Subscription not active yet" },
        { status: 409 },
      );
    }
    if (plan.status === "canceled") {
      return jsonResponse(
        { error: "This plan has been canceled" },
        { status: 410 },
      );
    }

    const stripe = createStripeClient(env);
    const origin = req.headers.get("origin") || "https://example.com";
    const portal = await stripe.billingPortal.sessions.create({
      customer: plan.stripe_customer_id,
      return_url: `${origin}/plans/portal/${portalToken}/done?action=card`,
    });

    return jsonResponse({ url: portal.url });
  } catch (e) {
    console.error("create-plan-portal-session error:", e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
});
