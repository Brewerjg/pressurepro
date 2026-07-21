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

// Mirrors APP_ID in src/lib/app-context.ts. Keep in sync.
const APP_ID = "turfpro";

import {
  isValidEmail,
  renderCompleted,
  renderInvoiceSend,
  renderOnTheWay,
  renderPaymentRetry,
  renderPlanConfirmation,
  renderQuoteSend,
  renderReviewRequest,
  type BusinessInfo,
  type EmailKind,
  type QuoteSendLine,
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
  /**
   * For most kinds the caller supplies the recipient. quote_send is an
   * exception — it hydrates {email, name} from the quote row when omitted,
   * so the operator doesn't have to re-derive what's already on the quote.
   */
  recipient?: Recipient;
  /** Optional foreign keys threaded through to email_log for traceability. */
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

interface InvoiceSendPayload extends BasePayload {
  kind: "invoice_send";
  context: {
    invoice_id: string;
  };
}

// payment_retry hydrates {email, name, amount, card_last4, portal_token} from
// the plan row. The caller (PlanDetail UI, or the payments-webhook on
// invoice.payment_failed) only has to thread the plan_id.
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
  | InvoiceSendPayload
  | PaymentRetryPayload;

// Coerce the JSON `lines` column (shared shape between quotes and the invoices
// cloned from them) into QuoteSendLine[]. Handles legacy PressurePro rows
// ({ sqft, rate, surface }) and native rows ({ name, qty, rate, total }).
function normalizeLines(raw: unknown): QuoteSendLine[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((r: unknown): QuoteSendLine | null => {
      if (!r || typeof r !== "object") return null;
      const obj = r as Record<string, unknown>;
      if (
        typeof obj.sqft === "number" &&
        typeof obj.rate === "number" &&
        !("qty" in obj)
      ) {
        const qty = Number(obj.sqft) || 0;
        const rate = Number(obj.rate) || 0;
        const name =
          (typeof obj.label === "string" && obj.label) ||
          (typeof obj.surface === "string" && obj.surface) ||
          "Service";
        return {
          name: String(name),
          qty,
          rate,
          total:
            typeof obj.total === "number"
              ? Number(obj.total)
              : Math.round(qty * rate * 100) / 100,
        };
      }
      const qty = Number(obj.qty) || 0;
      const rate = Number(obj.rate) || 0;
      const total =
        typeof obj.total === "number"
          ? Number(obj.total)
          : Math.round(qty * rate * 100) / 100;
      const name =
        (typeof obj.name === "string" && obj.name) ||
        (typeof obj.label === "string" && obj.label) ||
        "Line";
      return { name: String(name), qty, rate, total };
    })
    .filter((l): l is QuoteSendLine => l !== null);
}

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

    // Identify the caller against an anon-level key. Supabase auto-injects
    // SUPABASE_ANON_KEY into every function; SUPABASE_PUBLISHABLE_KEY is a
    // custom secret that isn't guaranteed to be set — fall back to the anon
    // key (both are anon-tier, fine for getUser). Without this fallback
    // createClient throws "supabaseKey is required" before the auth check.
    // Mirrors compose-customer-message's key resolution.
    const anonKey =
      Deno.env.get("SUPABASE_ANON_KEY") ??
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
      "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      anonKey,
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
    // quote_send + payment_retry are allowed to omit the recipient — we
    // hydrate it from the quote / plan row below. Every other kind must
    // supply a valid recipient.email up-front because there's no DB row
    // we can resolve it from.
    if (
      payload.kind !== "quote_send" &&
      payload.kind !== "invoice_send" &&
      payload.kind !== "payment_retry"
    ) {
      if (
        !payload?.recipient?.email ||
        !isValidEmail(payload.recipient.email)
      ) {
        return json({ error: "Invalid recipient email" }, 400);
      }
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

    // For quote_send, the recipient is hydrated from the quote row in its
    // case branch — until then it may legitimately be undefined. Every other
    // kind already passed the up-front validation that requires a recipient,
    // so the optional-chain here is just narrowing for the type system.
    let recipientEmail = payload.recipient?.email ?? "";
    let recipientName = payload.recipient?.name;
    let recipientFirstName =
      recipientName?.trim().split(/\s+/)[0] || undefined;
    let customerIdForLog = payload.customer_id ?? null;

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
            .eq("app", APP_ID)
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
      case "quote_send": {
        // Hydrate the quote row — the operator only passes us a quote_id;
        // we derive customer name/email/address/lines from the row so the
        // caller doesn't have to redundantly thread them through.
        const { data: quote, error: qErr } = await supabase
          .from("quotes")
          .select(
            "id, customer_id, customer_name, customer_email, address, lines, total, notes, expires_at",
          )
          .eq("id", payload.context.quote_id)
          .eq("user_id", userData.user.id)
          .eq("app", APP_ID)
          .maybeSingle();
        if (qErr || !quote) return json({ error: "Quote not found" }, 404);

        // Caller-provided recipient takes precedence (lets the operator
        // override "send to a different address" without editing the row);
        // otherwise we pull customer_email straight off the quote.
        const targetEmail =
          (recipientEmail && isValidEmail(recipientEmail)
            ? recipientEmail
            : (quote.customer_email as string | null) ?? "") || "";
        if (!targetEmail || !isValidEmail(targetEmail)) {
          return json(
            { error: "No customer_email on the quote" },
            400,
          );
        }
        recipientEmail = targetEmail;
        recipientName = recipientName || (quote.customer_name as string);
        recipientFirstName =
          recipientFirstName ||
          (recipientName?.trim().split(/\s+/)[0] || undefined);
        customerIdForLog =
          customerIdForLog ?? (quote.customer_id as string | null);

        // Defensively coerce the JSON lines column into the
        // QuoteSendLine[] shape (shared with invoice_send below).
        const lines = normalizeLines(quote.lines);

        rendered = renderQuoteSend(business, {
          firstName: recipientFirstName,
          shortId: (quote.id as string).slice(0, 4).toUpperCase(),
          address: (quote.address as string | null) ?? null,
          lines,
          totalAmount: Number(quote.total ?? 0),
          notes: (quote.notes as string | null) ?? null,
          acceptUrl: `${origin}/accept/${quote.id}`,
          expiresAt: (quote.expires_at as string | null) ?? null,
        });
        break;
      }
      case "invoice_send": {
        // Hydrate the invoice row — caller passes only invoice_id. Mirrors
        // quote_send: recipient/name/lines/total all come off the row. The
        // customer CTA points at the public invoice page (/invoice/{token}).
        const { data: invoice, error: invErr } = await supabase
          .from("invoices")
          .select(
            "id, customer_id, customer_name, customer_email, address, lines, total, deposit_amount, deposit_paid_at, invoice_number, public_token, status",
          )
          .eq("id", payload.context.invoice_id)
          .eq("user_id", userData.user.id)
          .eq("app", APP_ID)
          .maybeSingle();
        if (invErr || !invoice) {
          return json({ error: "Invoice not found" }, 404);
        }

        const targetEmail =
          (recipientEmail && isValidEmail(recipientEmail)
            ? recipientEmail
            : (invoice.customer_email as string | null) ?? "") || "";
        if (!targetEmail || !isValidEmail(targetEmail)) {
          return json({ error: "No customer_email on the invoice" }, 400);
        }
        recipientEmail = targetEmail;
        recipientName = recipientName || (invoice.customer_name as string);
        recipientFirstName =
          recipientFirstName ||
          (recipientName?.trim().split(/\s+/)[0] || undefined);
        customerIdForLog =
          customerIdForLog ?? (invoice.customer_id as string | null);

        const depositPaid =
          invoice.deposit_paid_at && invoice.deposit_amount
            ? Number(invoice.deposit_amount)
            : 0;

        rendered = renderInvoiceSend(business, {
          firstName: recipientFirstName,
          invoiceNumber: `INV-${invoice.invoice_number}`,
          address: (invoice.address as string | null) ?? null,
          lines: normalizeLines(invoice.lines),
          totalAmount: Number(invoice.total ?? 0),
          depositPaid,
          invoiceUrl: `${origin}/invoice/${invoice.public_token}`,
          paid: invoice.status === "paid",
        });
        break;
      }
      case "payment_retry": {
        // Hydrate from the plan row. Caller (PlanDetail UI or
        // payments-webhook) only passes us plan_id — we pull amount,
        // card_last4, portal_token, and the most-recent failed charge date
        // out of the plan, and the email/name out of the linked customer.
        const { data: plan, error: pErr } = await supabase
          .from("maintenance_plans")
          .select(
            "id, customer_id, customer_name, amount, portal_token, card_last4, charge_history",
          )
          .eq("id", payload.context.plan_id)
          .eq("user_id", userData.user.id)
          .eq("app", APP_ID)
          .maybeSingle();
        if (pErr || !plan) return json({ error: "Plan not found" }, 404);

        // Customer-side hydration. The plan can carry a customer_id; if it
        // doesn't (older row), fall back to whatever the caller passed in.
        let resolvedEmail = recipientEmail;
        let resolvedName = recipientName;
        if ((!resolvedEmail || !isValidEmail(resolvedEmail)) && plan.customer_id) {
          const { data: cust } = await supabase
            .from("customers")
            .select("email, name")
            .eq("id", plan.customer_id)
            .maybeSingle();
          if (cust?.email && isValidEmail(cust.email as string)) {
            resolvedEmail = cust.email as string;
          }
          if (!resolvedName) {
            resolvedName =
              (cust?.name as string | null) ??
              (plan.customer_name as string | null) ??
              undefined;
          }
        }
        if (!resolvedEmail || !isValidEmail(resolvedEmail)) {
          return json(
            { error: "No customer email on file for this plan" },
            400,
          );
        }
        recipientEmail = resolvedEmail;
        recipientName = resolvedName;
        recipientFirstName =
          recipientFirstName ||
          (resolvedName?.trim().split(/\s+/)[0]) ||
          (plan.customer_name as string | null)?.split(/\s+/)[0] ||
          undefined;
        customerIdForLog =
          customerIdForLog ?? (plan.customer_id as string | null);

        // Best-effort: scrape the most recent failed entry off charge_history
        // so the body can say "we tried to charge on May 21". The webhook
        // appends entries with status='failed' on invoice.payment_failed.
        let failedOnIso: string | null = null;
        if (Array.isArray(plan.charge_history)) {
          const history = plan.charge_history as Array<{
            date?: string;
            status?: string;
          }>;
          const failed = history.find(
            (h) => h && (h.status === "failed" || h.status === "payment_failed"),
          );
          failedOnIso = failed?.date ?? null;
        }

        rendered = renderPaymentRetry(business, {
          firstName: recipientFirstName,
          amountCents: Math.round(Number(plan.amount) * 100),
          failedOn: failedOnIso,
          cardLast4: (plan.card_last4 as string | null) ?? null,
          portalUrl: `${origin}/plans/portal/${plan.portal_token}`,
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
          .eq("app", APP_ID)
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
        customer_id: customerIdForLog,
        route_stop_id: payload.route_stop_id ?? null,
        kind: payload.kind,
        recipient_email: recipientEmail,
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
          to: recipientEmail,
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
