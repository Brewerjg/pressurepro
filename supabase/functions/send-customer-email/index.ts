// send-customer-email — generic transactional email dispatcher for TurfPro's
// customer comms layer. One endpoint, four kinds:
//
//   on_the_way         — fired when an operator hits "send on the way" on
//                        an active route stop
//   completed          — fired right after Mark done on a route stop
//   review_request     — manual or auto follow-up linking back to the quote
//                        or plan portal
//   plan_confirmation  — sent when a maintenance plan is created
//
// Ported from PressurePro's send-quote-email pattern — same Resend HTTP API,
// same RESEND_API_KEY / RESEND_FROM_ADDRESS env vars (shared Supabase project),
// same authenticated-user gate. We do NOT depend on the `resend` npm package
// because Edge Functions can hit Resend's REST endpoint with fetch().
//
// Every send writes one row to public.email_log:
//   - 'queued' is inserted up front
//   - promoted to 'sent' (with resend_message_id) on success
//   - or 'failed' (with error text) when Resend rejects the call
// That gives the operator a complete audit trail even on partial failures.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { corsHeaders } from "../_shared/cors.ts";
import {
  isValidEmail,
  renderCompleted,
  renderOnTheWay,
  renderPlanConfirmation,
  renderReviewRequest,
  type BusinessInfo,
  type EmailKind,
  type RenderedEmail,
} from "../_shared/email-templates.ts";

// ---------------------------------------------------------------------
// Inbound request shape
// ---------------------------------------------------------------------
interface Recipient {
  email: string;
  name?: string;
}

interface BasePayload {
  kind: EmailKind;
  recipient: Recipient;
  /** Optional foreign keys threaded through to email_log for traceability. */
  customer_id?: string | null;
  route_stop_id?: string | null;
}

interface OnTheWayPayload extends BasePayload {
  kind: "on_the_way";
  context: {
    address: string;
    drive_minutes?: number | null;
  };
}

interface CompletedPayload extends BasePayload {
  kind: "completed";
  context: {
    address: string;
    property_id?: string | null;
  };
}

interface ReviewRequestPayload extends BasePayload {
  kind: "review_request";
  context: {
    quote_id?: string | null;
    plan_token?: string | null;
  };
}

interface PlanConfirmationPayload extends BasePayload {
  kind: "plan_confirmation";
  context: {
    plan_id: string;
  };
}

type IncomingPayload =
  | OnTheWayPayload
  | CompletedPayload
  | ReviewRequestPayload
  | PlanConfirmationPayload;

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
    // PressurePro's send-quote-email.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);

    // Service-role client for all writes (email_log insert, etc.). RLS would
    // otherwise reject inserts initiated from the function context.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const payload = (await req.json()) as IncomingPayload;
    if (!payload?.kind) return json({ error: "Missing kind" }, 400);
    if (!payload?.recipient?.email || !isValidEmail(payload.recipient.email)) {
      return json({ error: "Invalid recipient email" }, 400);
    }

    const apiKey = Deno.env.get("RESEND_API_KEY");
    const fromAddress = Deno.env.get("RESEND_FROM_ADDRESS");
    if (!apiKey || !fromAddress) {
      return json(
        {
          error:
            "Email not configured. Set RESEND_API_KEY and RESEND_FROM_ADDRESS in function secrets.",
        },
        503,
      );
    }

    // Operator profile drives the business name + footer phone on every
    // template. Falls back to "your lawn crew" if not set yet.
    const { data: prof } = await supabase
      .from("profiles")
      .select("business_name, phone")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    const business: BusinessInfo = {
      name: (prof?.business_name as string) ?? "your lawn crew",
      phone: (prof?.phone as string) ?? undefined,
    };

    const origin =
      req.headers.get("origin") ||
      Deno.env.get("PUBLIC_APP_ORIGIN") ||
      "https://example.com";

    const recipientFirstName =
      payload.recipient.name?.trim().split(/\s+/)[0] || undefined;

    // -----------------------------------------------------------------
    // Build the rendered email for the requested kind. Each branch can
    // enrich its context from the DB (e.g. completed checks photo_pairs).
    // -----------------------------------------------------------------
    let rendered: RenderedEmail;
    switch (payload.kind) {
      case "on_the_way": {
        rendered = renderOnTheWay(business, {
          firstName: recipientFirstName,
          address: payload.context.address,
          driveMinutes: payload.context.drive_minutes ?? null,
        });
        break;
      }
      case "completed": {
        // Conditionally include the public gallery link only when there's
        // at least one photo pair on the property — sending a link that
        // 404s is worse than not sending one.
        let galleryUrl: string | null = null;
        if (payload.context.property_id) {
          const { data: pairs } = await supabase
            .from("photo_pairs")
            .select("id")
            .eq("property_id", payload.context.property_id)
            .limit(1);
          if (pairs && pairs.length > 0) {
            galleryUrl = `${origin}/g/${payload.context.property_id}`;
          }
        }
        rendered = renderCompleted(business, {
          firstName: recipientFirstName,
          address: payload.context.address,
          galleryUrl,
        });
        break;
      }
      case "review_request": {
        // Prefer the quote-scoped review entrypoint; fall back to the plan
        // portal which doubles as the review surface for plan-only customers.
        const reviewUrl = payload.context.quote_id
          ? `${origin}/review/${payload.context.quote_id}`
          : payload.context.plan_token
            ? `${origin}/plans/portal/${payload.context.plan_token}`
            : `${origin}/`;
        rendered = renderReviewRequest(business, {
          firstName: recipientFirstName,
          reviewUrl,
        });
        break;
      }
      case "plan_confirmation": {
        const { data: plan, error: pErr } = await supabase
          .from("maintenance_plans")
          .select(
            "id, customer_name, amount, interval_months, start_date, portal_token, day_of_week, frequency",
          )
          .eq("id", payload.context.plan_id)
          .eq("user_id", userData.user.id)
          .maybeSingle();
        if (pErr || !plan) return json({ error: "Plan not found" }, 404);
        rendered = renderPlanConfirmation(business, {
          firstName:
            recipientFirstName ||
            (plan.customer_name as string)?.split(/\s+/)[0],
          // PressurePro plans only have interval_months; TurfPro adds the
          // service-cadence frequency column in 0001 (weekly/biweekly/…).
          // Prefer frequency when present.
          cadence:
            ((plan as Record<string, unknown>).frequency as string) ||
            (plan.interval_months === 1
              ? "monthly"
              : plan.interval_months === 3
                ? "quarterly"
                : "monthly"),
          dayOfWeek:
            ((plan as Record<string, unknown>).day_of_week as number) ?? null,
          amountCents: Math.round(Number(plan.amount) * 100),
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
    // 1) Insert a 'queued' log row so we have a paper trail even if the
    //    Resend call below throws / 5xxs.
    // -----------------------------------------------------------------
    const { data: logRow, error: logInsertErr } = await supabase
      .from("email_log")
      .insert({
        user_id: userData.user.id,
        customer_id: payload.customer_id ?? null,
        route_stop_id: payload.route_stop_id ?? null,
        kind: payload.kind,
        recipient_email: payload.recipient.email,
        subject: rendered.subject,
        status: "queued",
      })
      .select("id")
      .single();
    if (logInsertErr) {
      console.error("email_log insert failed:", logInsertErr);
      // Don't bail — failing to log shouldn't block a customer email.
    }
    const logId = logRow?.id as string | undefined;

    // -----------------------------------------------------------------
    // 2) POST to Resend.
    // -----------------------------------------------------------------
    let resendStatus = 0;
    let resendBody: unknown = null;
    let messageId: string | null = null;
    let resendErrText: string | null = null;
    try {
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddress,
          to: payload.recipient.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        }),
      });
      resendStatus = resendRes.status;
      resendBody = await resendRes.json().catch(() => null);
      if (resendRes.ok) {
        messageId = (resendBody as { id?: string } | null)?.id ?? null;
      } else {
        resendErrText =
          typeof resendBody === "object" && resendBody
            ? JSON.stringify(resendBody)
            : `Resend ${resendStatus}`;
      }
    } catch (e) {
      resendErrText = e instanceof Error ? e.message : String(e);
    }

    // -----------------------------------------------------------------
    // 3) Promote the log row to its terminal status.
    // -----------------------------------------------------------------
    if (logId) {
      if (messageId) {
        await supabase
          .from("email_log")
          .update({
            status: "sent",
            resend_message_id: messageId,
            sent_at: new Date().toISOString(),
          })
          .eq("id", logId);
      } else {
        await supabase
          .from("email_log")
          .update({
            status: "failed",
            error: resendErrText ?? "Unknown Resend error",
          })
          .eq("id", logId);
      }
    }

    if (!messageId) {
      console.error("Resend error:", resendStatus, resendErrText);
      return json(
        {
          ok: false,
          error: "Email provider rejected the send",
          detail: resendErrText,
        },
        502,
      );
    }

    return json({ ok: true, message_id: messageId });
  } catch (e) {
    console.error("send-customer-email error:", e);
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
