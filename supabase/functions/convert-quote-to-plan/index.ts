// convert-quote-to-plan (v2 — rebuilt from scratch)
//
// One-click "this quote becomes a recurring service" conversion. The
// operator picks services, per-visit rate, frequency, day-of-week,
// billing cadence, and start date from QuoteDetail's convert form; we
// mint a `maintenance_plans` row hydrated from the quote.
//
// v1 only implements the `standalone` mode: the plan is inserted with
// status='active' and NO Stripe wiring. The operator collects a card
// later from PlanDetail (which hands off to mutate-plan-subscription).
// This keeps the function functional even when Stripe isn't configured.
//
// -------------------------------------------------------------------
// New contract (replaces the old one — old optional fields are gone):
//
//   POST /functions/v1/convert-quote-to-plan
//   Authorization: Bearer <user JWT>
//   {
//     "quote_id": "<uuid>",
//     "mode": "standalone",                // optional, default standalone
//     "services": ["Mow", "Edge"],         // required, non-empty
//     "per_visit_rate": 55,                // required, > 0
//     "frequency": "weekly"|"biweekly"|"monthly"|"fert_program",
//     "day_of_week": 0..6,                 // Sunday=0
//     "interval_months": 1|3|6|12,
//     "start_date": "YYYY-MM-DD"
//   }
//
//   amount = per_visit_rate × VISITS_PER_MONTH[frequency] × interval_months
//
// -------------------------------------------------------------------
// Defensive against partial migration state (0021_plan_billing_math):
//
//   * If the per_visit_rate column doesn't exist yet (Postgres 42703),
//     we retry the insert WITHOUT that field and log a warning.
//   * If interval_months=1 trips the old CHECK constraint (Postgres
//     23514), we return a clear, actionable error telling the operator
//     to run migration 0021.
//
// -------------------------------------------------------------------
// How to verify after deploy:
//
//   Function URL pattern:
//     https://<project-ref>.supabase.co/functions/v1/convert-quote-to-plan
//
//   Example curl:
//     curl -X POST \
//       "https://<project-ref>.supabase.co/functions/v1/convert-quote-to-plan" \
//       -H "Authorization: Bearer <user JWT>" \
//       -H "Content-Type: application/json" \
//       -d '{
//             "quote_id":      "<existing quote uuid>",
//             "services":      ["Mow"],
//             "per_visit_rate": 55,
//             "frequency":     "weekly",
//             "day_of_week":   3,
//             "interval_months": 1,
//             "start_date":    "2026-06-10"
//           }'
//
//   Success (HTTP 200):
//     {
//       "ok": true,
//       "plan_id": "<uuid>",
//       "amount": 220,
//       "plan": {
//         "services": ["Mow"],
//         "per_visit_rate": 55,
//         "frequency": "weekly",
//         "interval_months": 1,
//         "day_of_week": 3,
//         "start_date": "2026-06-10",
//         "amount": 220
//       }
//     }
//
//   "Migration not applied" (HTTP 400) when interval_months=1 hits the
//   old CHECK constraint:
//     {
//       "ok": false,
//       "error": "Database migration 0021 hasn't been applied — interval_months=1 not allowed yet. Run supabase/migrations/0021_plan_billing_math.sql in your Supabase SQL editor.",
//       "field": "interval_months"
//     }
//
//   Idempotent retry on an already-converted quote (HTTP 200):
//     { "ok": true, "plan_id": "<existing uuid>", "already_converted": true }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { handleOptions, jsonResponse } from "../_shared/cors.ts";

// Mirrors APP_ID in src/lib/app-context.ts. Keep in sync.
const APP_ID = "turfpro";

// ---------- Types ----------

type ConvertFrequency = "weekly" | "biweekly" | "monthly" | "fert_program";
type ConvertIntervalMonths = 1 | 3 | 6 | 12;
type ConvertMode = "standalone" | "with_stripe";

interface ConvertRequest {
  quote_id: string;
  mode?: ConvertMode;
  services: string[];
  per_visit_rate: number;
  frequency: ConvertFrequency;
  day_of_week: number;
  interval_months: ConvertIntervalMonths;
  start_date: string;
}

// ---------- Constants ----------

// Operator-simplified visit counts. Mirrors VISITS_PER_MONTH in NewPlan.tsx;
// keep these in sync. weekly=4 (not the calendar-precise 4.33) since
// that's what operators actually quote. fert_program = 5 visits / year
// = 5/12 per month.
const VISITS_PER_MONTH: Record<ConvertFrequency, number> = {
  weekly: 4,
  biweekly: 2,
  monthly: 1,
  fert_program: 5 / 12,
};

const ALLOWED_FREQUENCIES: ConvertFrequency[] = [
  "weekly",
  "biweekly",
  "monthly",
  "fert_program",
];
const ALLOWED_INTERVALS: ConvertIntervalMonths[] = [1, 3, 6, 12];

// Stripe's minimum charge is $0.50 (50 cents). Even though we don't call
// Stripe in standalone mode, we enforce the same floor so the plan row
// stays compatible with the with_stripe path that will eventually consume
// it.
const STRIPE_MIN_CENTS = 50;

// ---------- Structured logging ----------
//
// Single shape so logs are greppable in the Supabase dashboard. Never
// include customer PII (name, phone, address) — only ids, counts, and
// shape.
function log(step: string, data: Record<string, unknown> = {}) {
  try {
    console.log(JSON.stringify({ event: "convert-quote-to-plan.step", step, ...data }));
  } catch {
    console.log("convert-quote-to-plan.step", step);
  }
}

// ---------- Error helper ----------

function errorResponse(
  message: string,
  status: number,
  field?: string,
): Response {
  const body: Record<string, unknown> = { ok: false, error: message };
  if (field) body.field = field;
  return jsonResponse(body, { status });
}

// ---------- Validation ----------

interface ValidatedBody {
  quoteId: string;
  mode: ConvertMode;
  services: string[];
  perVisitRate: number;
  frequency: ConvertFrequency;
  dayOfWeek: number;
  intervalMonths: ConvertIntervalMonths;
  startDate: string;
}

type ValidationResult =
  | { ok: true; value: ValidatedBody }
  | { ok: false; error: string; field?: string };

function validateBody(raw: Partial<ConvertRequest>): ValidationResult {
  const quoteId = typeof raw.quote_id === "string" ? raw.quote_id.trim() : "";
  if (!quoteId) {
    return { ok: false, error: "quote_id is required", field: "quote_id" };
  }

  const mode: ConvertMode =
    raw.mode === "with_stripe" ? "with_stripe" : "standalone";
  if (mode === "with_stripe") {
    return {
      ok: false,
      error:
        "with_stripe mode is not implemented yet — call create-plan-subscription separately after this returns the plan_id",
      field: "mode",
    };
  }

  if (!Array.isArray(raw.services) || raw.services.length === 0) {
    return {
      ok: false,
      error: "services must be a non-empty array of strings",
      field: "services",
    };
  }
  const seen = new Set<string>();
  const services: string[] = [];
  for (const s of raw.services) {
    const trimmed = typeof s === "string" ? s.trim() : "";
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    services.push(trimmed);
  }
  if (services.length === 0) {
    return {
      ok: false,
      error: "services must contain at least one non-empty string",
      field: "services",
    };
  }

  const perVisitRate = Number(raw.per_visit_rate);
  if (!Number.isFinite(perVisitRate) || perVisitRate <= 0) {
    return {
      ok: false,
      error: "per_visit_rate must be a positive number",
      field: "per_visit_rate",
    };
  }

  const frequency = raw.frequency as ConvertFrequency | undefined;
  if (!frequency || !ALLOWED_FREQUENCIES.includes(frequency)) {
    return {
      ok: false,
      error: `frequency must be one of ${ALLOWED_FREQUENCIES.join(", ")}`,
      field: "frequency",
    };
  }

  const dayOfWeek = Number(raw.day_of_week);
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    return {
      ok: false,
      error: "day_of_week must be an integer 0..6 (Sunday=0)",
      field: "day_of_week",
    };
  }

  const intervalMonths = Number(raw.interval_months) as ConvertIntervalMonths;
  if (!ALLOWED_INTERVALS.includes(intervalMonths)) {
    return {
      ok: false,
      error: "interval_months must be 1, 3, 6, or 12",
      field: "interval_months",
    };
  }

  const startDate = typeof raw.start_date === "string" ? raw.start_date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return {
      ok: false,
      error: "start_date must match YYYY-MM-DD",
      field: "start_date",
    };
  }

  return {
    ok: true,
    value: {
      quoteId,
      mode,
      services,
      perVisitRate,
      frequency,
      dayOfWeek,
      intervalMonths,
      startDate,
    },
  };
}

// ---------- Amount math ----------

function computeAmount(
  perVisitRate: number,
  frequency: ConvertFrequency,
  intervalMonths: ConvertIntervalMonths,
): number {
  const raw = perVisitRate * VISITS_PER_MONTH[frequency] * intervalMonths;
  return Math.round(raw * 100) / 100;
}

// ---------- Insert with defensive retry ----------
//
// Returns the inserted plan's id, or an error response describing the
// migration / DB issue. The two known partial-migration failure modes
// are:
//
//   * 42703 (undefined_column) on per_visit_rate — column hasn't been
//     added yet. Retry without that field, log a warning.
//   * 23514 (check_violation) on interval_months=1 — old CHECK constraint
//     hasn't been widened yet. No retry; return an actionable error.
//
// Any other DB error bubbles up as a 500 with the Postgres message.
async function insertPlan(
  // deno-lint-ignore no-explicit-any
  admin: any,
  basePayload: Record<string, unknown>,
  perVisitRate: number,
  intervalMonths: ConvertIntervalMonths,
): Promise<
  | { ok: true; planId: string; perVisitRatePersisted: boolean }
  | { ok: false; response: Response }
> {
  // Attempt 1: with per_visit_rate.
  const withRate = { ...basePayload, per_visit_rate: perVisitRate };
  log("insert.attempt", {
    with_per_visit_rate: true,
    interval_months: intervalMonths,
  });

  const first = await admin
    .from("maintenance_plans")
    .insert(withRate)
    .select("id")
    .single();

  if (!first.error && first.data?.id) {
    return {
      ok: true,
      planId: first.data.id as string,
      perVisitRatePersisted: true,
    };
  }

  const err = first.error;
  const code = (err && typeof err === "object" && "code" in err)
    ? String((err as { code?: unknown }).code ?? "")
    : "";
  const message = err?.message ?? "";

  // Failure mode A: per_visit_rate column doesn't exist (migration 0021
  // partially applied). Retry without it.
  const missingColumn =
    code === "42703" ||
    /column .*per_visit_rate.* does not exist/i.test(message);

  if (missingColumn) {
    log("insert.retry_without_per_visit_rate", {
      reason: "per_visit_rate column missing",
      pg_code: code,
      pg_message: message,
    });

    const second = await admin
      .from("maintenance_plans")
      .insert(basePayload)
      .select("id")
      .single();

    if (!second.error && second.data?.id) {
      return {
        ok: true,
        planId: second.data.id as string,
        perVisitRatePersisted: false,
      };
    }

    // The retry can still hit the interval_months check, so re-classify.
    return {
      ok: false,
      response: classifyDbError(second.error, intervalMonths),
    };
  }

  // Failure mode B: interval_months CHECK constraint hasn't been widened.
  return { ok: false, response: classifyDbError(err, intervalMonths) };
}

function classifyDbError(
  // deno-lint-ignore no-explicit-any
  err: any,
  intervalMonths: ConvertIntervalMonths,
): Response {
  const code = (err && typeof err === "object" && "code" in err)
    ? String((err as { code?: unknown }).code ?? "")
    : "";
  const message = err?.message ?? "Unknown database error";

  // CHECK violation. If the operator picked interval_months=1, it's
  // almost certainly the un-widened constraint from migration 0021.
  if (code === "23514" && intervalMonths === 1) {
    log("insert.check_violation_interval_months_1", {
      pg_code: code,
      pg_message: message,
    });
    return errorResponse(
      "Database migration 0021 hasn't been applied — interval_months=1 not allowed yet. Run supabase/migrations/0021_plan_billing_math.sql in your Supabase SQL editor.",
      400,
      "interval_months",
    );
  }

  log("insert.error", { pg_code: code, pg_message: message });
  return errorResponse(message, 500);
}

// ---------- Handler ----------

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    // ----- Auth: resolve user from JWT -----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse("Unauthorized — missing Authorization header", 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey =
      Deno.env.get("SUPABASE_ANON_KEY") ??
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
      "";
    if (!supabaseUrl || !serviceKey) {
      log("env.missing", {
        has_url: Boolean(supabaseUrl),
        has_service_key: Boolean(serviceKey),
      });
      return errorResponse(
        "Server misconfigured — SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set",
        500,
      );
    }

    // user-scoped client (RLS respected) for the quote lookup.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    // service-role client for the maintenance_plans insert (RLS bypassed —
    // we set user_id from the JWT-validated id, so this stays safe).
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return errorResponse("Unauthorized — invalid or expired token", 401);
    }
    const userId = userData.user.id;

    // ----- Parse + validate body -----
    let rawBody: Partial<ConvertRequest>;
    try {
      rawBody = (await req.json()) as Partial<ConvertRequest>;
    } catch {
      return errorResponse("Request body must be valid JSON", 400);
    }

    log("request.received", {
      quote_id: typeof rawBody.quote_id === "string" ? rawBody.quote_id : null,
      services_count: Array.isArray(rawBody.services) ? rawBody.services.length : 0,
      frequency: rawBody.frequency ?? null,
      interval_months: rawBody.interval_months ?? null,
      mode: rawBody.mode ?? "standalone",
    });

    const validated = validateBody(rawBody);
    if (!validated.ok) {
      log("validation.failed", { error: validated.error, field: validated.field });
      return errorResponse(validated.error, 400, validated.field);
    }
    const {
      quoteId,
      services,
      perVisitRate,
      frequency,
      dayOfWeek,
      intervalMonths,
      startDate,
    } = validated.value;

    log("validation.passed", {
      services_count: services.length,
      frequency,
      interval_months: intervalMonths,
      day_of_week: dayOfWeek,
    });

    // ----- Compute amount -----
    const amount = computeAmount(perVisitRate, frequency, intervalMonths);
    if (!Number.isFinite(amount) || amount <= 0) {
      return errorResponse(
        "Computed amount must be greater than 0",
        400,
        "per_visit_rate",
      );
    }
    if (Math.round(amount * 100) < STRIPE_MIN_CENTS) {
      return errorResponse(
        `Computed amount $${amount.toFixed(2)} is below the $0.50 minimum`,
        400,
        "per_visit_rate",
      );
    }

    // ----- Hydrate quote (RLS-respecting, via userClient) -----
    // We deliberately do NOT filter by app here — the function works for
    // both TurfPro and PressurePro and propagates the source quote's `app`
    // value onto the new plan row below (so the plan stays siloed to the
    // app that owned the quote).
    const { data: quote, error: qErr } = await userClient
      .from("quotes")
      .select(
        "id, user_id, customer_id, property_id, customer_name, phone, address, plan_id, app",
      )
      .eq("id", quoteId)
      .maybeSingle();

    if (qErr) {
      log("quote.lookup_failed", { message: qErr.message });
      return errorResponse(qErr.message, 500);
    }
    if (!quote) {
      // Could be missing OR not owned — RLS conflates the two intentionally.
      return errorResponse("Quote not found", 404);
    }

    log("quote.resolved", {
      quote_id: quoteId,
      has_customer_id: Boolean(quote.customer_id),
      has_property_id: Boolean(quote.property_id),
      already_has_plan: Boolean(quote.plan_id),
    });

    // Idempotency: already converted — BUT only if the referenced plan
    // is still ACTIVE or PAUSED. We treat three cases as "no usable plan
    // exists, mint a fresh one":
    //
    //   1. Plan row was deleted (orphan pointer). quote.plan_id points
    //      at thin air.
    //   2. Plan row exists with status='canceled'. The customer (or
    //      operator) ended the prior plan; calling Convert again means
    //      they want a NEW plan, not a dead-end pointer.
    //
    // Active and paused plans return the idempotent shortcut — paused
    // is recoverable from PlanDetail without re-converting.
    if (quote.plan_id) {
      const { data: existingPlan, error: existingErr } = await admin
        .from("maintenance_plans")
        .select("id, status")
        .eq("id", quote.plan_id)
        .maybeSingle();

      if (existingErr) {
        log("idempotent.lookup_failed", {
          plan_id: quote.plan_id,
          pg_message: existingErr.message,
        });
      }

      const planStatus = existingPlan?.status as string | undefined;
      const usable = existingPlan?.id &&
        (planStatus === "active" || planStatus === "paused");

      if (usable) {
        log("idempotent.already_converted", {
          plan_id: quote.plan_id,
          status: planStatus,
        });
        return jsonResponse(
          {
            ok: true,
            plan_id: quote.plan_id,
            already_converted: true,
            status: planStatus,
          },
          { status: 200 },
        );
      }

      // No usable plan — orphan or canceled. Clear the pointer (best-effort)
      // and fall through to a fresh mint.
      const reason = existingPlan?.id
        ? "canceled"   // row exists but status='canceled'
        : "deleted";   // no row found
      log("idempotent.stale_plan_id_cleared", {
        stale_plan_id: quote.plan_id,
        reason,
        status: planStatus ?? null,
      });
      const { error: clearErr } = await admin
        .from("quotes")
        .update({ plan_id: null } as never)
        .eq("id", quoteId);
      if (clearErr) {
        log("idempotent.stale_clear_failed", {
          pg_message: clearErr.message,
        });
        return errorResponse(
          "Quote references a " + reason + " plan (id: " + quote.plan_id +
          "). Couldn't auto-clear the reference. Run: " +
          "UPDATE public.quotes SET plan_id = NULL WHERE id = '" + quoteId +
          "'; then retry.",
          500,
          "plan_id",
        );
      }
    }

    // ----- Build insert payload -----
    // Propagate the source quote's app discriminator so the plan stays in
    // the same silo. Falls back to APP_ID when the quote row predates the
    // discriminator (column NOT NULL default 'turfpro' guarantees a value
    // post-migration 0022, but we belt-and-suspenders here).
    const quoteApp =
      typeof (quote as { app?: unknown }).app === "string" &&
      (quote as { app: string }).app.length > 0
        ? (quote as { app: string }).app
        : APP_ID;
    const basePayload: Record<string, unknown> = {
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
      plan_kind: frequency === "fert_program" ? "fert_program" : "mow",
      app: quoteApp,
    };

    // ----- Insert (with defensive retry on missing per_visit_rate) -----
    const inserted = await insertPlan(
      admin,
      basePayload,
      perVisitRate,
      intervalMonths,
    );
    if (!inserted.ok) {
      return inserted.response;
    }
    const planId = inserted.planId;

    log("insert.success", {
      plan_id: planId,
      amount,
      per_visit_rate_persisted: inserted.perVisitRatePersisted,
    });

    // ----- Backfill quotes.plan_id (best-effort) -----
    const { error: backfillErr } = await admin
      .from("quotes")
      .update({ plan_id: planId } as never)
      .eq("id", quoteId);
    if (backfillErr) {
      log("backfill.failed", { message: backfillErr.message });
    } else {
      log("backfill.success", { quote_id: quoteId, plan_id: planId });
    }

    // ----- Success response -----
    const responseBody = {
      ok: true as const,
      plan_id: planId,
      amount,
      plan: {
        services,
        per_visit_rate: perVisitRate,
        frequency,
        interval_months: intervalMonths,
        day_of_week: dayOfWeek,
        start_date: startDate,
        amount,
      },
    };
    log("return.success", {
      plan_id: planId,
      amount,
      per_visit_rate_persisted: inserted.perVisitRatePersisted,
    });
    return jsonResponse(responseBody, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    log("handler.exception", { message: msg });
    return errorResponse(msg, 500);
  }
});
