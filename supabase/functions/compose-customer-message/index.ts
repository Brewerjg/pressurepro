// compose-customer-message — server-trusted builder for the operator-self-
// sends-via-sms: model. We hydrate the recipient + body from the source
// row (route_stops / quotes / maintenance_plans) and return the rendered
// SMS body together with a phone number and a pre-built `sms:` URL the
// client hands to <a href>.
//
// The existing send-customer-sms function (Twilio path) stays intact and
// untouched — this function exists alongside it so both modes can co-exist
// behind a feature flag. The renderer modules in _shared/sms-templates.ts
// are reused verbatim so the body text is identical between the two paths.
//
// -------------------------------------------------------------------
// Request:
//   POST /functions/v1/compose-customer-message
//   Authorization: Bearer <user JWT>
//   {
//     "kind": "on_the_way" | "completed" | "review_request"
//           | "plan_confirmation" | "quote_send" | "payment_retry",
//     // Exactly one of these depending on kind:
//     "route_stop_id"?: string,   // on_the_way | completed
//     "quote_id"?: string,        // quote_send | review_request
//     "plan_id"?: string,         // plan_confirmation | payment_retry
//     // Optional: client passes window.location.origin so the link in
//     // the body matches the operator's deployed app URL.
//     "origin"?: string
//   }
//
// Success (HTTP 200):
//   {
//     "ok": true,
//     "phone": "+15551234567" | null,
//     "body": "Hi Sam, ... Reply STOP to opt out.",
//     "sms_url": "sms:+15551234567?body=Hi%20Sam..." | null
//   }
//
// Failure (4xx/5xx):
//   { "ok": false, "error": "..." }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { handleOptions, jsonResponse } from "../_shared/cors.ts";

// Mirrors APP_ID in src/lib/app-context.ts. Keep in sync.
const APP_ID = "turfpro";

import {
  renderCompletedSms,
  renderOnTheWaySms,
  renderPaymentRetrySms,
  renderPlanConfirmationSms,
  renderQuoteSendSms,
  renderReviewRequestSms,
  type RenderedSms,
  type SmsBusinessInfo,
} from "../_shared/sms-templates.ts";

// ---------- Types ----------

type ComposeKind =
  | "on_the_way"
  | "completed"
  | "review_request"
  | "plan_confirmation"
  | "quote_send"
  | "payment_retry";

interface ComposeRequest {
  kind: ComposeKind;
  route_stop_id?: string;
  quote_id?: string;
  plan_id?: string;
  origin?: string;
}

// ---------- Structured logging (matches convert-quote-to-plan) ----------

function log(step: string, data: Record<string, unknown> = {}) {
  try {
    console.log(
      JSON.stringify({ event: "compose-customer-message.step", step, ...data }),
    );
  } catch {
    console.log("compose-customer-message.step", step);
  }
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ ok: false, error: message }, { status });
}

// ---------- Phone + URL helpers ----------

// Strip everything but digits and a leading +. The sms: URL handler is
// happy with either bare digits or E.164.
function cleanPhoneForSmsUrl(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

function buildSmsUrl(phone: string | null, body: string): string | null {
  if (!phone) return null;
  const clean = cleanPhoneForSmsUrl(phone);
  if (!clean) return null;
  return `sms:${clean}?body=${encodeURIComponent(body)}`;
}

// ---------- Handler ----------

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    // ----- Auth -----
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

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return errorResponse("Unauthorized — invalid or expired token", 401);
    }
    const userId = userData.user.id;

    // ----- Parse body -----
    let raw: Partial<ComposeRequest>;
    try {
      raw = (await req.json()) as Partial<ComposeRequest>;
    } catch {
      return errorResponse("Request body must be valid JSON", 400);
    }

    const kind = raw.kind as ComposeKind | undefined;
    if (!kind) {
      return errorResponse("kind is required", 400);
    }

    log("request.received", {
      kind,
      has_route_stop_id: Boolean(raw.route_stop_id),
      has_quote_id: Boolean(raw.quote_id),
      has_plan_id: Boolean(raw.plan_id),
    });

    // ----- Resolve operator business name (used by every renderer) -----
    const { data: prof } = await admin
      .from("profiles")
      .select("business_name, name")
      .or(`id.eq.${userId},user_id.eq.${userId}`)
      .maybeSingle();

    const business: SmsBusinessInfo = {
      name:
        ((prof as Record<string, unknown> | null)?.business_name as string) ||
        ((prof as Record<string, unknown> | null)?.name as string) ||
        "your lawn crew",
    };

    // ----- Resolve origin for any links rendered in the body -----
    const origin =
      (typeof raw.origin === "string" && raw.origin.trim()) ||
      req.headers.get("origin") ||
      Deno.env.get("PUBLIC_APP_ORIGIN") ||
      "https://example.com";

    // ----- Hydrate per-kind -----
    let phone: string | null = null;
    let rendered: RenderedSms | null = null;

    switch (kind) {
      case "on_the_way":
      case "completed": {
        if (!raw.route_stop_id) {
          return errorResponse(
            `route_stop_id is required for kind=${kind}`,
            400,
          );
        }
        // Pull the stop snapshot + joined property (address fallback) +
        // joined customer (name, phone). We use the service-role client so
        // we don't have to thread RLS for this lookup; we still scope to
        // the JWT's user_id explicitly.
        const { data: stop, error: stopErr } = await admin
          .from("route_stops")
          .select(
            "id, user_id, customer_id, property_id, address_snapshot, customer_name_snapshot, drive_minutes_from_prev",
          )
          .eq("id", raw.route_stop_id)
          .maybeSingle();
        if (stopErr || !stop) {
          log("route_stop.lookup_failed", {
            message: stopErr?.message ?? "not found",
          });
          return errorResponse("Route stop not found", 404);
        }
        if ((stop as Record<string, unknown>).user_id !== userId) {
          return errorResponse("Route stop not found", 404);
        }

        // Resolve customer's phone + name (snapshot is fine if no row).
        let customerName: string | null =
          ((stop as Record<string, unknown>).customer_name_snapshot as
            | string
            | null) ?? null;
        let customerPhone: string | null = null;
        const stopCustomerId =
          (stop as Record<string, unknown>).customer_id as string | null;
        if (stopCustomerId) {
          const { data: cust } = await admin
            .from("customers")
            .select("name, phone")
            .eq("id", stopCustomerId)
            .maybeSingle();
          if (cust) {
            customerName =
              (cust.name as string | null) || customerName || null;
            customerPhone = (cust.phone as string | null) ?? null;
          }
        }
        phone = customerPhone;
        const firstName = customerName?.trim().split(/\s+/)[0] || undefined;
        const address =
          ((stop as Record<string, unknown>).address_snapshot as
            | string
            | null) ?? "";

        if (kind === "on_the_way") {
          rendered = renderOnTheWaySms(business, {
            firstName,
            address,
            driveMinutes:
              ((stop as Record<string, unknown>).drive_minutes_from_prev as
                | number
                | null) ?? null,
          });
        } else {
          // Optional public gallery URL when there's at least one photo
          // pair on the property.
          let galleryUrl: string | null = null;
          const propertyId =
            (stop as Record<string, unknown>).property_id as string | null;
          if (propertyId) {
            const { data: pairs } = await admin
              .from("photo_pairs")
              .select("id")
              .eq("property_id", propertyId)
              .eq("app", APP_ID)
              .limit(1);
            if (pairs && pairs.length > 0) {
              galleryUrl = `${origin}/g/${propertyId}`;
            }
          }
          rendered = renderCompletedSms(business, {
            firstName,
            address,
            galleryUrl,
          });
        }
        log("route_stop.resolved", {
          kind,
          has_phone: Boolean(phone),
        });
        break;
      }

      case "quote_send":
      case "review_request": {
        if (!raw.quote_id) {
          return errorResponse(
            `quote_id is required for kind=${kind}`,
            400,
          );
        }
        const { data: quote, error: qErr } = await admin
          .from("quotes")
          .select(
            "id, user_id, customer_id, customer_name, phone, address",
          )
          .eq("id", raw.quote_id)
          .eq("app", APP_ID)
          .maybeSingle();
        if (qErr || !quote) {
          log("quote.lookup_failed", {
            message: qErr?.message ?? "not found",
          });
          return errorResponse("Quote not found", 404);
        }
        if ((quote as Record<string, unknown>).user_id !== userId) {
          return errorResponse("Quote not found", 404);
        }

        phone = ((quote as Record<string, unknown>).phone as string | null) ??
          null;
        const firstName =
          (((quote as Record<string, unknown>).customer_name as
            | string
            | null) ?? "")
            .trim()
            .split(/\s+/)[0] || undefined;

        if (kind === "quote_send") {
          rendered = renderQuoteSendSms(business, {
            firstName,
            acceptUrl: `${origin}/accept/${quote.id}`,
          });
        } else {
          rendered = renderReviewRequestSms(business, {
            firstName,
            reviewUrl: `${origin}/review/${quote.id}`,
          });
        }
        log("quote.resolved", {
          kind,
          has_phone: Boolean(phone),
        });
        break;
      }

      case "plan_confirmation":
      case "payment_retry": {
        if (!raw.plan_id) {
          return errorResponse(
            `plan_id is required for kind=${kind}`,
            400,
          );
        }
        const { data: plan, error: pErr } = await admin
          .from("maintenance_plans")
          .select(
            "id, user_id, customer_id, customer_name, phone, portal_token, start_date, interval_months, frequency",
          )
          .eq("id", raw.plan_id)
          .eq("app", APP_ID)
          .maybeSingle();
        if (pErr || !plan) {
          log("plan.lookup_failed", {
            message: pErr?.message ?? "not found",
          });
          return errorResponse("Plan not found", 404);
        }
        if ((plan as Record<string, unknown>).user_id !== userId) {
          return errorResponse("Plan not found", 404);
        }

        // Phone resolution. Try the plan row, then fall back to the linked
        // customer row (PressurePro-era plans don't always have the
        // denormalized phone).
        let candidatePhone: string | null =
          ((plan as Record<string, unknown>).phone as string | null) ?? null;
        let firstName: string | undefined =
          (((plan as Record<string, unknown>).customer_name as
            | string
            | null) ?? "")
            .trim()
            .split(/\s+/)[0] || undefined;
        const planCustomerId =
          (plan as Record<string, unknown>).customer_id as string | null;
        if ((!candidatePhone || !firstName) && planCustomerId) {
          const { data: cust } = await admin
            .from("customers")
            .select("name, phone")
            .eq("id", planCustomerId)
            .maybeSingle();
          if (cust) {
            candidatePhone =
              candidatePhone || ((cust.phone as string | null) ?? null);
            firstName =
              firstName ||
              ((cust.name as string | null)?.trim().split(/\s+/)[0] ||
                undefined);
          }
        }
        phone = candidatePhone;

        const portalToken =
          ((plan as Record<string, unknown>).portal_token as string | null) ??
          "";
        const portalUrl = `${origin}/plans/portal/${portalToken}`;

        if (kind === "plan_confirmation") {
          // cadence: prefer the explicit `frequency` column; fall back to
          // the interval_months semantics for older rows.
          const intervalMonths =
            ((plan as Record<string, unknown>).interval_months as
              | number
              | null) ?? 1;
          const cadence =
            (((plan as Record<string, unknown>).frequency as
              | string
              | null) ??
              (intervalMonths === 1
                ? "monthly"
                : intervalMonths === 3
                  ? "quarterly"
                  : "monthly"));
          rendered = renderPlanConfirmationSms(business, {
            firstName,
            cadence,
            firstVisitDate:
              ((plan as Record<string, unknown>).start_date as
                | string
                | null) ?? null,
            portalUrl,
          });
        } else {
          rendered = renderPaymentRetrySms(business, {
            firstName,
            portalUrl,
          });
        }
        log("plan.resolved", {
          kind,
          has_phone: Boolean(phone),
        });
        break;
      }

      default:
        return errorResponse(`Unknown kind: ${kind}`, 400);
    }

    if (!rendered) {
      // Shouldn't happen — every case branch above either returns or sets it.
      return errorResponse("Failed to render message body", 500);
    }

    const body = rendered.body;
    const sms_url = buildSmsUrl(phone, body);

    log("return.success", {
      kind,
      has_phone: Boolean(phone),
      body_length: body.length,
    });

    return jsonResponse(
      {
        ok: true,
        phone: phone ?? null,
        body,
        sms_url,
      },
      { status: 200 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    log("handler.exception", { message: msg });
    return errorResponse(msg, 500);
  }
});
