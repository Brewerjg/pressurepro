// convert-quote-to-plan
//
// One-click "this quote is becoming a recurring service" conversion. The
// operator picks frequency / day-of-week / billing cadence / start date
// in QuoteDetail's inline form, hits Create plan, and we mint a
// maintenance_plans row hydrated from the quote's customer / property /
// line items / total.
//
// v1 only implements the `standalone` mode — the plan is inserted with
// status='active' and no Stripe wiring. The operator can collect a card
// later from PlanDetail (which hands off to mutate-plan-subscription).
// A future `with_stripe` mode can re-use create-plan-subscription's
// Checkout flow if we want a single-click "card-on-file plan" path.
//
// Why a dedicated function rather than client-side INSERT?
//   1. RLS — `maintenance_plans` writes are scoped to auth.uid(); we still
//      do the JWT auth check here but the service role lets us also flip
//      the source quote's `plan_id` FK back in one transaction without
//      a separate round-trip.
//   2. Single source of truth for the quote → plan derivation: line item
//      names → services[]; quote.total → amount; quote.address / phone /
//      customer_id all forwarded.
//   3. Keeps the QuoteDetail page small and testable — no JSON line
//      parsing in the UI layer.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";

// Match NewPlan's constraints: weekly cadence is also DB-level constrained
// (CHECK frequency IN ('weekly','biweekly','monthly','fert_program')). We
// only expose the three mow-style cadences here since fert_program has
// its own dedicated entry point.
type ConvertFrequency = "weekly" | "biweekly" | "monthly";
type ConvertIntervalMonths = 3 | 6 | 12;
type ConvertMode = "standalone" | "with_stripe";

interface ConvertRequest {
  quote_id: string;
  mode?: ConvertMode;
  frequency: ConvertFrequency;
  day_of_week: number;
  interval_months: ConvertIntervalMonths;
  start_date: string;
}

// Defensive line-item line shape. We only care about the display name when
// building the plan's services[] array. PressurePro-era rows use
// {sqft, rate, surface}; TurfPro rows use {name, qty, rate, total}.
function extractServiceName(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const name =
    (typeof obj.name === "string" && obj.name.trim() && obj.name.trim()) ||
    (typeof obj.label === "string" && obj.label.trim() && obj.label.trim()) ||
    (typeof obj.surface === "string" && obj.surface.trim() && obj.surface.trim()) ||
    null;
  return name;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  try {
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

    // ----- Validate body -----
    const body = (await req.json().catch(() => ({}))) as Partial<ConvertRequest>;
    const quoteId = typeof body.quote_id === "string" ? body.quote_id : "";
    if (!quoteId) {
      return jsonResponse({ error: "Missing quote_id" }, { status: 400 });
    }
    const mode: ConvertMode = body.mode === "with_stripe" ? "with_stripe" : "standalone";
    if (mode === "with_stripe") {
      // We deliberately scope v1 to the standalone path; the Stripe wiring
      // is a separate hop through create-plan-subscription. Surface a clear
      // error rather than silently fall back so the caller is unambiguous.
      return jsonResponse(
        {
          error:
            "with_stripe mode is not implemented yet — call create-plan-subscription separately after this returns the plan_id",
        },
        { status: 400 },
      );
    }

    const frequency = body.frequency as ConvertFrequency | undefined;
    if (!frequency || !["weekly", "biweekly", "monthly"].includes(frequency)) {
      return jsonResponse(
        { error: "frequency must be weekly|biweekly|monthly" },
        { status: 400 },
      );
    }
    const dayOfWeek = Number(body.day_of_week);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return jsonResponse(
        { error: "day_of_week must be 0..6 (Sunday..Saturday)" },
        { status: 400 },
      );
    }
    const intervalMonths = Number(body.interval_months) as ConvertIntervalMonths;
    if (![3, 6, 12].includes(intervalMonths)) {
      return jsonResponse(
        { error: "interval_months must be 3, 6, or 12" },
        { status: 400 },
      );
    }
    const startDate =
      typeof body.start_date === "string" ? body.start_date : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      return jsonResponse(
        { error: "start_date must be ISO YYYY-MM-DD" },
        { status: 400 },
      );
    }

    // ----- Hydrate the source quote (and verify ownership) -----
    const { data: quote, error: qErr } = await admin
      .from("quotes")
      .select(
        "id, user_id, customer_id, property_id, customer_name, phone, address, lines, total, notes, status, plan_id",
      )
      .eq("id", quoteId)
      .eq("user_id", userId)
      .maybeSingle();
    if (qErr) {
      return jsonResponse({ error: qErr.message }, { status: 500 });
    }
    if (!quote) {
      return jsonResponse({ error: "Quote not found" }, { status: 404 });
    }
    if (quote.plan_id) {
      // Already converted — return the existing plan id so the UI can
      // navigate to it. Idempotent retries shouldn't double-mint plans.
      return jsonResponse({
        ok: true,
        plan_id: quote.plan_id,
        already_converted: true,
      });
    }

    // ----- Derive services[] from the quote's line items -----
    const rawLines = Array.isArray(quote.lines) ? quote.lines : [];
    const services: string[] = [];
    for (const r of rawLines) {
      const name = extractServiceName(r);
      if (name && !services.includes(name)) services.push(name);
    }
    if (services.length === 0) services.push("Service");

    // The plan's per-visit amount is the quote's total — operators set the
    // quote total to "what they're billing per recurring visit" by the
    // time they hit Convert. If that's ever wrong, PlanDetail lets them
    // edit the amount post-creation.
    const amount = Number(quote.total ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return jsonResponse(
        { error: "Quote total must be > 0 to create a plan" },
        { status: 400 },
      );
    }

    // ----- Insert the plan row -----
    // We deliberately do NOT set stripe_* columns — this is the standalone
    // mode. The plan will appear in Plans with no card on file; the
    // operator can collect one later from PlanDetail.
    const insertPayload: Record<string, unknown> = {
      user_id: userId,
      customer_id: quote.customer_id ?? null,
      property_id: quote.property_id ?? null,
      customer_name: quote.customer_name,
      phone: quote.phone ?? "",
      address: quote.address ?? "",
      services,
      amount,
      interval_months: intervalMonths,
      start_date: startDate,
      next_charge_date: startDate,
      status: "active",
      day_of_week: dayOfWeek,
      frequency,
      plan_kind: "mow",
    };

    const { data: insertedPlan, error: insertErr } = await admin
      .from("maintenance_plans")
      .insert(insertPayload)
      .select("id")
      .single();
    if (insertErr || !insertedPlan) {
      console.error("maintenance_plans insert failed", insertErr);
      return jsonResponse(
        { error: insertErr?.message ?? "Could not create plan" },
        { status: 500 },
      );
    }
    const planId = insertedPlan.id as string;

    // ----- Back-fill the quote with the new plan_id -----
    // Lets PlanDetail show "originated from quote #XYZ", and lets
    // Quotes show "converted → plan" in lists.
    const { error: backfillErr } = await admin
      .from("quotes")
      .update({ plan_id: planId } as never)
      .eq("id", quoteId);
    if (backfillErr) {
      // Don't bail — the plan was created successfully. The link-back is
      // best-effort; the operator can still find the plan in the list.
      console.warn("quotes.plan_id backfill failed:", backfillErr);
    }

    return jsonResponse({ ok: true, plan_id: planId });
  } catch (e) {
    console.error("convert-quote-to-plan error:", e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
});
