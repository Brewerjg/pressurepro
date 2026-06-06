// Typed front-end helpers around the send-customer-sms edge function.
// Mirrors src/lib/customer-email.ts one-for-one — same four call shapes,
// same non-throwing `{ ok: false, error }` failure mode, same fire-and-
// forget semantics from RouteMode.
//
// Why these aren't just "email but with phone"? The recipient resolution
// is different: customer rows store phone in a separate column, and the
// edge function needs an E.164 string (or close enough that the server
// can normalize it). We resolve from `customers.phone` only — there's no
// secondary fallback like there is for email.

import { supabase } from "@/integrations/supabase/client";
import type { RouteStop } from "@/components/routes/types";

export type SmsKind =
  | "on_the_way"
  | "completed"
  | "review_request"
  | "plan_confirmation"
  // quote_send = operator hit Send on a quote. Phone is hydrated server-
  // side from the quote row when omitted.
  | "quote_send"
  // freeform = operator-typed reply from the Inbox UI. The body is
  // verbatim (the edge function only appends the STOP footer if missing).
  | "freeform"
  // payment_retry = the plan's card-on-file declined; nudge the customer
  // to update it from the portal. Phone is hydrated server-side from the
  // plan's linked customer.
  | "payment_retry";

export interface CustomerSmsResult {
  ok: boolean;
  message_sid?: string;
  /** If quiet hours blocked the send, `deferred: true` and `reason: 'quiet_hours'`. */
  deferred?: boolean;
  reason?: string;
  error?: string;
}

interface InvokeArgs {
  kind: SmsKind;
  /**
   * quote_send hydrates {phone, name} server-side from the quote row when
   * omitted; every other kind requires it up-front.
   */
  recipient?: { phone: string; name?: string };
  customer_id?: string | null;
  route_stop_id?: string | null;
  context: Record<string, unknown>;
}

async function invokeSms(args: InvokeArgs): Promise<CustomerSmsResult> {
  try {
    const { data, error } = await supabase.functions.invoke(
      "send-customer-sms",
      { body: args },
    );
    if (error) {
      return { ok: false, error: error.message };
    }
    const payload = (data ?? {}) as {
      ok?: boolean;
      message_sid?: string;
      deferred?: boolean;
      reason?: string;
      error?: string;
      detail?: string;
    };
    if (payload.deferred) {
      return {
        ok: false,
        deferred: true,
        reason: payload.reason,
        // Surface a friendly reason for the UI; the caller can still inspect
        // `deferred` to distinguish a true failure from a quiet-hours hold.
        error: payload.reason === "quiet_hours"
          ? "Held until quiet-hours window opens"
          : payload.reason || "Deferred",
      };
    }
    if (payload.ok === false || payload.error) {
      return {
        ok: false,
        error: payload.error || payload.detail || "SMS send failed",
      };
    }
    return { ok: true, message_sid: payload.message_sid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown" };
  }
}

/**
 * Resolve a recipient `{ phone, name }` for a route stop. Pulls from the
 * customer row using customer_id since the stop snapshot doesn't include
 * phone. Returns null if no phone on file.
 */
async function resolveStopPhone(
  stop: RouteStop,
): Promise<{ phone: string; name?: string } | null> {
  if (!stop.customer_id) return null;
  const { data, error } = await supabase
    .from("customers")
    .select("phone, name")
    .eq("id", stop.customer_id)
    .maybeSingle();
  if (error || !data?.phone) return null;
  return {
    phone: data.phone as string,
    name:
      (data.name as string | null) ??
      stop.customer_name_snapshot ??
      undefined,
  };
}

/** Auto-trigger: customer is on the way. Fired from the active stop card. */
export async function sendOnTheWaySms(
  stop: RouteStop,
): Promise<CustomerSmsResult> {
  const recipient = await resolveStopPhone(stop);
  if (!recipient) {
    return { ok: false, error: "No phone on file for this customer" };
  }
  return invokeSms({
    kind: "on_the_way",
    recipient,
    customer_id: stop.customer_id,
    route_stop_id: stop.id,
    context: {
      address: stop.address_snapshot ?? "",
      drive_minutes: stop.drive_minutes_from_prev,
    },
  });
}

/** Auto-trigger: route stop just marked done. */
export async function sendCompletedSms(
  stop: RouteStop,
): Promise<CustomerSmsResult> {
  const recipient = await resolveStopPhone(stop);
  if (!recipient) {
    return { ok: false, error: "No phone on file for this customer" };
  }
  return invokeSms({
    kind: "completed",
    recipient,
    customer_id: stop.customer_id,
    route_stop_id: stop.id,
    context: {
      address: stop.address_snapshot ?? "",
      property_id: stop.property_id,
    },
  });
}

/**
 * Send a review-ask SMS tied to either a quote_id (post-quote) or a plan
 * portal_token (plan-only customers). The signature matches sendReviewRequest
 * in customer-email.ts.
 */
export async function sendReviewRequestSms(
  args:
    | {
        quoteId: string;
        recipient: { phone: string; name?: string };
        customerId?: string | null;
      }
    | {
        planToken: string;
        recipient: { phone: string; name?: string };
        customerId?: string | null;
      },
): Promise<CustomerSmsResult> {
  const context =
    "quoteId" in args
      ? { quote_id: args.quoteId }
      : { plan_token: args.planToken };
  return invokeSms({
    kind: "review_request",
    recipient: args.recipient,
    customer_id: args.customerId ?? null,
    context,
  });
}

/**
 * Send the customer their quote as a short text — body is
 * "Hi {first_name}, here's your quote from {business}: /accept/{id}".
 * Phone + first-name are hydrated server-side from the quote row, so
 * callers don't have to re-thread them.
 *
 * Returns the standard non-throwing `{ ok, error }` shape — Send is fire-
 * and-forget on the quote pages; UI shouldn't roll back state on a 5xx.
 */
export async function sendQuoteSms(
  quoteId: string,
): Promise<CustomerSmsResult> {
  return invokeSms({
    kind: "quote_send",
    context: { quote_id: quoteId },
  });
}

/**
 * Sent after a maintenance plan is created. The edge function pulls
 * cadence + first-visit + portal token from the plan row using plan_id.
 */
export async function sendPlanConfirmationSms(
  planId: string,
  recipient: { phone: string; name?: string },
  customerId?: string | null,
): Promise<CustomerSmsResult> {
  return invokeSms({
    kind: "plan_confirmation",
    recipient,
    customer_id: customerId ?? null,
    context: { plan_id: planId },
  });
}

/**
 * Send a "your card was declined, please update it" SMS tied to a plan.
 *
 * Symmetric to sendPaymentRetryLink in customer-email.ts — caller only
 * threads plan_id; the edge function hydrates phone (from the linked
 * customer row) and the portal URL from the plan row.
 *
 * Non-throwing — the operator's PlanDetail UI fires this in parallel with
 * the email helper; we don't want one transport's failure to derail the
 * other. Quiet-hours still applies and may come back as `deferred: true`.
 */
export async function sendPaymentRetryLinkSms(
  planId: string,
): Promise<CustomerSmsResult> {
  return invokeSms({
    kind: "payment_retry",
    context: { plan_id: planId },
  });
}

/**
 * Operator-typed reply from the Inbox UI. Unlike the four transactional
 * kinds, `freeform` carries a body string the operator just wrote; the
 * edge function only normalizes (appends the STOP footer if missing) and
 * dispatches.
 *
 * Quiet-hours still applies — if it's currently outside the operator's
 * configured window, the result will have `deferred: true` and the row
 * will sit queued for the pg_cron drainer. The Inbox UI inspects the
 * `deferred` flag to surface a "Send anyway?" confirmation.
 */
export async function sendFreeformSms(args: {
  phone: string;
  body: string;
  name?: string;
  customer_id?: string | null;
}): Promise<CustomerSmsResult> {
  return invokeSms({
    kind: "freeform",
    recipient: { phone: args.phone, name: args.name },
    customer_id: args.customer_id ?? null,
    context: { body: args.body },
  });
}
