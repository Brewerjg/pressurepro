// sync-plan-status
//
// Internal helper called by payments-webhook when a Stripe subscription
// event targets a TurfPro maintenance_plan (i.e. the subscription's
// metadata.kind === 'maintenance_plan'). The webhook does the signature
// check + idempotency dedup itself; this function ONLY mutates the plan
// row from a trusted server-to-server caller (same Supabase project,
// service role auth).
//
// Supported events:
//   - customer.subscription.deleted   → status='canceled'
//   - customer.subscription.paused    → status='paused'
//   - customer.subscription.resumed   → status='active'
//   - customer.subscription.updated   → status mapped from sub.status
//   - invoice.payment_succeeded       → append to charge_history, advance
//                                       next_charge_date, refresh card_last4
//
// The function expects a JSON body shaped like:
//   { event_type: string, plan_id?: string, subscription?: Subscription,
//     invoice?: Invoice }
// The webhook hands us the already-parsed Stripe payloads so we don't
// re-fetch from Stripe here.
//
// Idempotency lives in payments-webhook (processed_stripe_events) — this
// helper assumes it is only called once per logical event.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";

type PlanStatus = "active" | "paused" | "canceled";

function authorize(req: Request): boolean {
  // Accept either the service-role key or the SUPABASE_ANON_KEY (sigh)
  // via Authorization: Bearer. In practice the webhook calls us with the
  // service-role key. Reject everything else.
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  return (
    token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    token === Deno.env.get("SUPABASE_ANON_KEY")
  );
}

function mapStripeStatusToPlan(s: string): PlanStatus | null {
  switch (s) {
    case "active":
    case "trialing":
      return "active";
    case "paused":
      return "paused";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }
  if (!authorize(req)) {
    return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      event_type,
      plan_id,
      subscription,
      invoice,
    } = body as {
      event_type?: string;
      plan_id?: string;
      // Loose typing — we only touch the fields we know about.
      subscription?: {
        id?: string;
        status?: string;
        pause_collection?: { behavior?: string } | null;
        items?: {
          data?: Array<{
            current_period_end?: number | null;
          }>;
        };
      };
      invoice?: {
        id?: string;
        amount_paid?: number;
        subscription?: string | null;
        // Stripe represents the card on file under charge.payment_method_details
        // OR via expanded payment_intent; we accept a pre-flattened
        // `card_last4` from the webhook to keep this function dumb.
        card_last4?: string | null;
      };
    };

    if (!event_type) {
      return jsonResponse({ error: "Missing event_type" }, { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // We accept either an explicit plan_id (preferred — read from metadata
    // by the webhook) or look up by subscription id as a fallback.
    let resolvedPlanId: string | null = plan_id ?? null;
    if (!resolvedPlanId && subscription?.id) {
      const { data: row } = await supabase
        .from("maintenance_plans")
        .select("id")
        .eq("stripe_subscription_id", subscription.id)
        .maybeSingle();
      resolvedPlanId = row?.id ?? null;
    }
    if (!resolvedPlanId && invoice?.subscription) {
      const { data: row } = await supabase
        .from("maintenance_plans")
        .select("id")
        .eq("stripe_subscription_id", invoice.subscription)
        .maybeSingle();
      resolvedPlanId = row?.id ?? null;
    }
    if (!resolvedPlanId) {
      // Not a plan-backed subscription — nothing to do. Return 200 so the
      // webhook treats this as a successful no-op.
      return jsonResponse({ ok: true, skipped: true });
    }

    const now = new Date().toISOString();

    if (event_type === "customer.subscription.deleted") {
      await supabase
        .from("maintenance_plans")
        .update({ status: "canceled", updated_at: now } as never)
        .eq("id", resolvedPlanId);
      return jsonResponse({ ok: true, status: "canceled" });
    }

    if (event_type === "customer.subscription.paused") {
      await supabase
        .from("maintenance_plans")
        .update({ status: "paused", updated_at: now } as never)
        .eq("id", resolvedPlanId);
      return jsonResponse({ ok: true, status: "paused" });
    }

    if (event_type === "customer.subscription.resumed") {
      await supabase
        .from("maintenance_plans")
        .update({ status: "active", updated_at: now } as never)
        .eq("id", resolvedPlanId);
      return jsonResponse({ ok: true, status: "active" });
    }

    if (event_type === "customer.subscription.updated" && subscription) {
      // Stripe may signal pause via pause_collection rather than status.
      const isPaused = !!subscription.pause_collection;
      const mapped = isPaused
        ? "paused"
        : (mapStripeStatusToPlan(subscription.status ?? "") ?? null);
      if (mapped) {
        await supabase
          .from("maintenance_plans")
          .update({ status: mapped, updated_at: now } as never)
          .eq("id", resolvedPlanId);
      }
      return jsonResponse({ ok: true, status: mapped ?? "unchanged" });
    }

    if (event_type === "invoice.payment_succeeded" && invoice) {
      // Pull the current row to merge charge_history (jsonb).
      const { data: row } = await supabase
        .from("maintenance_plans")
        .select("charge_history, interval_months, next_charge_date")
        .eq("id", resolvedPlanId)
        .maybeSingle();
      const history = Array.isArray(row?.charge_history)
        ? (row!.charge_history as Array<Record<string, unknown>>)
        : [];
      history.push({
        date: now,
        amount: (invoice.amount_paid ?? 0) / 100,
        status: "paid",
        invoice_id: invoice.id ?? null,
      });
      // Advance next_charge_date by interval_months. Source of truth for
      // the next period is Stripe (sub.items.data[0].current_period_end),
      // but the webhook may not always expand items — so we compute
      // locally as a fallback.
      let nextChargeISO: string | null = null;
      const periodEnd = subscription?.items?.data?.[0]?.current_period_end;
      if (periodEnd) {
        nextChargeISO = new Date(periodEnd * 1000).toISOString().slice(0, 10);
      } else if (row?.next_charge_date) {
        const d = new Date(row.next_charge_date);
        d.setMonth(d.getMonth() + (row.interval_months || 1));
        nextChargeISO = d.toISOString().slice(0, 10);
      }

      const updates: Record<string, unknown> = {
        charge_history: history,
        updated_at: now,
      };
      if (nextChargeISO) updates.next_charge_date = nextChargeISO;
      if (invoice.card_last4) updates.card_last4 = invoice.card_last4;

      await supabase
        .from("maintenance_plans")
        .update(updates as never)
        .eq("id", resolvedPlanId);
      return jsonResponse({ ok: true, charged: true });
    }

    // Unknown event — no-op, but log so we can spot misses in production.
    console.log("sync-plan-status: unhandled event_type", event_type);
    return jsonResponse({ ok: true, skipped: true });
  } catch (e) {
    console.error("sync-plan-status error:", e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
});
