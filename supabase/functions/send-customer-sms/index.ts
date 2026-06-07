// send-customer-sms — generic transactional SMS dispatcher for TurfPro's
// customer comms layer. Mirrors send-customer-email exactly (same four
// kinds, same authenticated-caller gate, same queued→sent/failed log row
// promotion) but talks to Twilio's Programmable Messaging API instead of
// Resend.
//
//   on_the_way         — fired when an operator hits "on the way" in
//                        RouteMode and the SMS toggle is on
//   completed          — fired right after Mark done on a route stop
//   review_request     — manual or auto follow-up linking to the quote
//                        review surface or plan portal
//   plan_confirmation  — sent when a maintenance plan is created
//
// We do NOT depend on the `twilio` npm package — Edge Functions can hit
// Twilio's REST endpoint with a plain fetch + Basic Auth. Required env
// vars (Supabase function secrets):
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM_NUMBER       (E.164, e.g. +15551234567)
//
// Quiet-hours behavior:
//   The operator's user_settings.sms_quiet_start_hour / sms_quiet_end_hour
//   define the only window in which we'll actually dispatch. Outside that
//   window we still write an sms_log row but with status='queued' and
//   error='quiet_hours' — never call Twilio. A future scheduler can scan
//   for those rows and dispatch them when the window opens.
//
//   TODO(quiet-hours): for v1 we use the operator's machine local time
//   (i.e., the edge function host) as a stand-in for customer-local time.
//   This is approximate — real per-customer timezone resolution would key
//   off the customer's address ZIP. Acceptable trade-off for the first
//   release since most operators serve a small geo footprint.
//
//   TODO(scheduler): there's no background job yet that drains queued rows
//   when the window opens. For v1 a queued row stays queued forever; the
//   operator can re-fire the action manually if they really want it sent.
//   A pg_cron + supabase cron job is the obvious next step.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { corsHeaders } from "../_shared/cors.ts";

// Mirrors APP_ID in src/lib/app-context.ts. Keep in sync.
const APP_ID = "turfpro";

import {
  isValidPhone,
  normalizePhone,
  renderCompletedSms,
  renderFreeformSms,
  renderOnTheWaySms,
  renderPaymentRetrySms,
  renderPlanConfirmationSms,
  renderQuoteSendSms,
  renderReviewRequestSms,
  type RenderedSms,
  type SmsBusinessInfo,
  type SmsKind,
} from "../_shared/sms-templates.ts";

// ---------------------------------------------------------------------
// Inbound request shape — identical to send-customer-email except for
// `phone` instead of `email` on the recipient.
// ---------------------------------------------------------------------
interface Recipient {
  phone: string;
  name?: string;
}

interface BasePayload {
  kind: SmsKind;
  /**
   * quote_send hydrates {phone, name} server-side from the quote row when
   * omitted; every other kind requires it up-front.
   */
  recipient?: Recipient;
  customer_id?: string | null;
  route_stop_id?: string | null;
}

interface RequiredRecipientBasePayload extends BasePayload {
  recipient: Recipient;
}

interface OnTheWayPayload extends RequiredRecipientBasePayload {
  kind: "on_the_way";
  context: {
    address: string;
    drive_minutes?: number | null;
  };
}

interface CompletedPayload extends RequiredRecipientBasePayload {
  kind: "completed";
  context: {
    address: string;
    property_id?: string | null;
  };
}

interface ReviewRequestPayload extends RequiredRecipientBasePayload {
  kind: "review_request";
  context: {
    quote_id?: string | null;
    plan_token?: string | null;
  };
}

interface PlanConfirmationPayload extends RequiredRecipientBasePayload {
  kind: "plan_confirmation";
  context: {
    plan_id: string;
  };
}

interface QuoteSendPayload extends BasePayload {
  kind: "quote_send";
  context: {
    quote_id: string;
  };
}

// freeform = operator-typed reply from the Inbox UI. Body is whatever
// they typed; we only append the STOP footer if missing.
interface FreeformPayload extends RequiredRecipientBasePayload {
  kind: "freeform";
  context: {
    body: string;
  };
}

// payment_retry hydrates {phone, name, portal_token} from the plan row +
// the linked customer (for phone). Caller threads plan_id only.
interface PaymentRetryPayload extends BasePayload {
  kind: "payment_retry";
  context: {
    plan_id: string;
  };
}

type IncomingPayload =
  | OnTheWayPayload
  | CompletedPayload
  | ReviewRequestPayload
  | PlanConfirmationPayload
  | QuoteSendPayload
  | FreeformPayload
  | PaymentRetryPayload;

// ---------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    // Identify the caller against the publishable key — same pattern as
    // send-customer-email.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);

    // Service-role client for all writes (sms_log insert, etc.). RLS would
    // otherwise reject inserts initiated from the function context.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const payload = (await req.json()) as IncomingPayload;
    if (!payload?.kind) return json({ error: "Missing kind" }, 400);

    // quote_send + payment_retry are allowed to omit the recipient — we
    // hydrate phone + first name from the quote / plan row below. Every
    // other kind requires a valid recipient.phone up front because there's
    // no DB row to resolve it from.
    let toPhone: string | null = null;
    if (payload.kind !== "quote_send" && payload.kind !== "payment_retry") {
      if (
        !payload?.recipient?.phone ||
        !isValidPhone(payload.recipient.phone)
      ) {
        return json({ error: "Invalid recipient phone" }, 400);
      }
      toPhone = normalizePhone(payload.recipient.phone);
      if (!toPhone) {
        return json({ error: "Could not normalize phone to E.164" }, 400);
      }
    }

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const fromNumber = Deno.env.get("TWILIO_FROM_NUMBER");
    if (!accountSid || !authToken || !fromNumber) {
      return json(
        {
          error:
            "SMS not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER in function secrets.",
        },
        503,
      );
    }

    // Operator profile drives the business name in every SMS.
    const { data: prof } = await supabase
      .from("profiles")
      .select("business_name")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    const business: SmsBusinessInfo = {
      name: (prof?.business_name as string) ?? "your lawn crew",
    };

    // Quiet-hours window from user_settings. Defaults match the column
    // defaults from 0008_sms.sql (8–20).
    const { data: prefs } = await supabase
      .from("user_settings")
      .select("sms_quiet_start_hour, sms_quiet_end_hour")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    const quietStart = (prefs?.sms_quiet_start_hour as number | undefined) ?? 8;
    const quietEnd = (prefs?.sms_quiet_end_hour as number | undefined) ?? 20;

    const origin =
      req.headers.get("origin") ||
      Deno.env.get("PUBLIC_APP_ORIGIN") ||
      "https://example.com";

    // Mutable for quote_send — the case branch hydrates these from the
    // quotes row when the caller didn't supply them.
    let recipientFirstName =
      payload.recipient?.name?.trim().split(/\s+/)[0] || undefined;
    let customerIdForLog = payload.customer_id ?? null;

    // -----------------------------------------------------------------
    // Build the rendered SMS for the requested kind. Each branch can
    // enrich its context from the DB (e.g. completed checks photo_pairs
    // before including a gallery link).
    // -----------------------------------------------------------------
    let rendered: RenderedSms;
    switch (payload.kind) {
      case "on_the_way": {
        rendered = renderOnTheWaySms(business, {
          firstName: recipientFirstName,
          address: payload.context.address,
          driveMinutes: payload.context.drive_minutes ?? null,
        });
        break;
      }
      case "completed": {
        // Only include the public gallery link when there's at least one
        // photo pair on the property. Sending a link that 404s is worse
        // than not including one.
        let galleryUrl: string | null = null;
        if (payload.context.property_id) {
          const { data: pairs } = await supabase
            .from("photo_pairs")
            .select("id")
            .eq("property_id", payload.context.property_id)
            .eq("app", APP_ID)
            .limit(1);
          if (pairs && pairs.length > 0) {
            galleryUrl = `${origin}/g/${payload.context.property_id}`;
          }
        }
        rendered = renderCompletedSms(business, {
          firstName: recipientFirstName,
          address: payload.context.address,
          galleryUrl,
        });
        break;
      }
      case "review_request": {
        const reviewUrl = payload.context.quote_id
          ? `${origin}/review/${payload.context.quote_id}`
          : payload.context.plan_token
            ? `${origin}/plans/portal/${payload.context.plan_token}`
            : `${origin}/`;
        rendered = renderReviewRequestSms(business, {
          firstName: recipientFirstName,
          reviewUrl,
        });
        break;
      }
      case "freeform": {
        // Operator-typed reply from the Inbox. We don't render templates,
        // just normalize / footer-append. Segment count is logged but we
        // don't bail on > 1 segment; the UI already warned the operator.
        if (
          typeof payload.context?.body !== "string" ||
          payload.context.body.trim().length === 0
        ) {
          return json({ error: "Freeform body is required" }, 400);
        }
        const freeform = renderFreeformSms(business, {
          body: payload.context.body,
        });
        if (freeform.segments > 1) {
          console.log(
            `freeform send is ${freeform.segments} segments (${freeform.body.length} chars)`,
          );
        }
        rendered = { body: freeform.body };
        break;
      }
      case "quote_send": {
        // Hydrate the quote row — caller only passes us a quote_id; we
        // derive phone + first-name from the row so the operator doesn't
        // have to re-thread them. Caller-supplied recipient.phone wins
        // when present (lets the operator override "text a different
        // number").
        const { data: quote, error: qErr } = await supabase
          .from("quotes")
          .select("id, customer_id, customer_name, phone")
          .eq("id", payload.context.quote_id)
          .eq("user_id", userData.user.id)
          .eq("app", APP_ID)
          .maybeSingle();
        if (qErr || !quote) return json({ error: "Quote not found" }, 404);

        const callerPhone = payload.recipient?.phone;
        const rawPhone =
          (callerPhone && isValidPhone(callerPhone)
            ? callerPhone
            : (quote.phone as string | null) ?? "") || "";
        if (!rawPhone || !isValidPhone(rawPhone)) {
          return json({ error: "No phone on the quote" }, 400);
        }
        const normalized = normalizePhone(rawPhone);
        if (!normalized) {
          return json({ error: "Could not normalize phone to E.164" }, 400);
        }
        toPhone = normalized;
        recipientFirstName =
          recipientFirstName ||
          (quote.customer_name as string | null)?.split(/\s+/)[0] ||
          undefined;
        customerIdForLog =
          customerIdForLog ?? (quote.customer_id as string | null);
        rendered = renderQuoteSendSms(business, {
          firstName: recipientFirstName,
          acceptUrl: `${origin}/accept/${quote.id}`,
        });
        break;
      }
      case "payment_retry": {
        // Hydrate phone + name from the plan row's linked customer. Plan
        // row also carries a `phone` column as a fallback (PressurePro-era
        // rows didn't always denormalize customer rows).
        const { data: plan, error: pErr } = await supabase
          .from("maintenance_plans")
          .select(
            "id, customer_id, customer_name, phone, portal_token",
          )
          .eq("id", payload.context.plan_id)
          .eq("user_id", userData.user.id)
          .eq("app", APP_ID)
          .maybeSingle();
        if (pErr || !plan) return json({ error: "Plan not found" }, 404);

        const callerPhone = payload.recipient?.phone;
        let candidatePhone: string | null = null;
        if (callerPhone && isValidPhone(callerPhone)) {
          candidatePhone = callerPhone;
        } else if (plan.customer_id) {
          const { data: cust } = await supabase
            .from("customers")
            .select("phone, name")
            .eq("id", plan.customer_id)
            .maybeSingle();
          if (cust?.phone && isValidPhone(cust.phone as string)) {
            candidatePhone = cust.phone as string;
          }
          if (!recipientFirstName) {
            recipientFirstName =
              (cust?.name as string | null)?.trim().split(/\s+/)[0] ||
              undefined;
          }
        }
        if (!candidatePhone && plan.phone && isValidPhone(plan.phone as string)) {
          candidatePhone = plan.phone as string;
        }
        if (!candidatePhone) {
          return json({ error: "No phone on file for this plan" }, 400);
        }
        const normalized = normalizePhone(candidatePhone);
        if (!normalized) {
          return json({ error: "Could not normalize phone to E.164" }, 400);
        }
        toPhone = normalized;
        recipientFirstName =
          recipientFirstName ||
          (plan.customer_name as string | null)?.split(/\s+/)[0] ||
          undefined;
        customerIdForLog =
          customerIdForLog ?? (plan.customer_id as string | null);
        rendered = renderPaymentRetrySms(business, {
          firstName: recipientFirstName,
          portalUrl: `${origin}/plans/portal/${plan.portal_token}`,
        });
        break;
      }
      case "plan_confirmation": {
        const { data: plan, error: pErr } = await supabase
          .from("maintenance_plans")
          .select(
            "id, customer_name, interval_months, start_date, portal_token, frequency",
          )
          .eq("id", payload.context.plan_id)
          .eq("user_id", userData.user.id)
          .eq("app", APP_ID)
          .maybeSingle();
        if (pErr || !plan) return json({ error: "Plan not found" }, 404);
        rendered = renderPlanConfirmationSms(business, {
          firstName:
            recipientFirstName ||
            (plan.customer_name as string)?.split(/\s+/)[0],
          // TurfPro plans carry a service-cadence column (weekly/biweekly/…);
          // fall back to interval_months semantics for older PressurePro rows.
          cadence:
            ((plan as Record<string, unknown>).frequency as string) ||
            (plan.interval_months === 1
              ? "monthly"
              : plan.interval_months === 3
                ? "quarterly"
                : "monthly"),
          firstVisitDate: plan.start_date as string,
          portalUrl: `${origin}/plans/portal/${plan.portal_token}`,
        });
        break;
      }
      default: {
        return json({ error: "Unknown kind" }, 400);
      }
    }

    // -----------------------------------------------------------------
    // 1) Insert a 'queued' log row up front. We need the row even if the
    //    Twilio call below throws / 5xxs, and we also need it for the
    //    quiet-hours-blocked branch.
    // -----------------------------------------------------------------
    // toPhone is guaranteed non-null here — every case branch either
    // accepts the up-front-validated recipient (in which case it was
    // set before the switch) or hydrates + sets it (quote_send).
    if (!toPhone) {
      return json({ error: "Could not resolve recipient phone" }, 400);
    }
    const { data: logRow, error: logInsertErr } = await supabase
      .from("sms_log")
      .insert({
        user_id: userData.user.id,
        customer_id: customerIdForLog,
        route_stop_id: payload.route_stop_id ?? null,
        kind: payload.kind,
        recipient_phone: toPhone,
        body: rendered.body,
        status: "queued",
      })
      .select("id")
      .single();
    if (logInsertErr) {
      console.error("sms_log insert failed:", logInsertErr);
      // Don't bail — failing to log shouldn't block a customer SMS.
    }
    const logId = logRow?.id as string | undefined;

    // -----------------------------------------------------------------
    // 2) Quiet-hours gate. If we're outside the operator's configured
    //    window, leave the row in 'queued' with error='quiet_hours' and
    //    return early. The future scheduler picks this up.
    //
    //    TODO: use the customer's local timezone (derived from address
    //    ZIP) instead of the edge function host's clock. Good enough for
    //    v1 since most operators serve one geo region anyway.
    // -----------------------------------------------------------------
    if (!isWithinQuietHoursWindow(new Date(), quietStart, quietEnd)) {
      if (logId) {
        await supabase
          .from("sms_log")
          .update({ error: "quiet_hours" })
          .eq("id", logId);
      }
      return json({
        ok: false,
        deferred: true,
        reason: "quiet_hours",
        quiet_start_hour: quietStart,
        quiet_end_hour: quietEnd,
      });
    }

    // -----------------------------------------------------------------
    // 3) POST to Twilio. Programmable Messaging is form-urlencoded, not
    //    JSON — `Body` and `To` and `From` are the only required fields.
    //    Auth is Basic Auth with SID:Token base64 in the header.
    // -----------------------------------------------------------------
    let twilioStatus = 0;
    let twilioBody: unknown = null;
    let messageSid: string | null = null;
    let twilioErrText: string | null = null;
    try {
      const form = new URLSearchParams();
      form.set("To", toPhone);
      form.set("From", fromNumber);
      form.set("Body", rendered.body);

      const basic = btoa(`${accountSid}:${authToken}`);
      const twilioRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
        },
      );
      twilioStatus = twilioRes.status;
      twilioBody = await twilioRes.json().catch(() => null);
      if (twilioRes.ok) {
        messageSid = (twilioBody as { sid?: string } | null)?.sid ?? null;
      } else {
        twilioErrText =
          typeof twilioBody === "object" && twilioBody
            ? JSON.stringify(twilioBody)
            : `Twilio ${twilioStatus}`;
      }
    } catch (e) {
      twilioErrText = e instanceof Error ? e.message : String(e);
    }

    // -----------------------------------------------------------------
    // 4) Promote the log row to its terminal status.
    // -----------------------------------------------------------------
    if (logId) {
      if (messageSid) {
        await supabase
          .from("sms_log")
          .update({
            status: "sent",
            twilio_message_sid: messageSid,
            sent_at: new Date().toISOString(),
          })
          .eq("id", logId);
      } else {
        await supabase
          .from("sms_log")
          .update({
            status: "failed",
            error: twilioErrText ?? "Unknown Twilio error",
          })
          .eq("id", logId);
      }
    }

    if (!messageSid) {
      console.error("Twilio error:", twilioStatus, twilioErrText);
      return json(
        {
          ok: false,
          error: "SMS provider rejected the send",
          detail: twilioErrText,
        },
        502,
      );
    }

    return json({ ok: true, message_sid: messageSid, body: rendered.body });
  } catch (e) {
    console.error("send-customer-sms error:", e);
    return json(
      { error: e instanceof Error ? e.message : "Unknown" },
      500,
    );
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * True if `now`'s hour falls within [startHour, endHour). Handles the
 * normal forward window (e.g. 8..20) and the wrap-around window
 * (e.g. 22..6 meaning "10pm through 6am"). If start === end, treat it
 * as "always closed" — safer default than "always open".
 */
function isWithinQuietHoursWindow(
  now: Date,
  startHour: number,
  endHour: number,
): boolean {
  const h = now.getHours();
  if (startHour === endHour) return false;
  if (startHour < endHour) return h >= startHour && h < endHour;
  // Wrap-around (e.g. 22..6) — "in window" if we're past start OR before end.
  return h >= startHour || h < endHour;
}
