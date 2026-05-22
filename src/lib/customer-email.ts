// Typed front-end helpers around the send-customer-email edge function.
//
// All four wrappers are non-throwing — failures come back as
// `{ ok: false, error }`. Email is a fire-and-forget side effect (especially
// from RouteMode where we keep moving regardless), so callers shouldn't have
// to wrap every call in try/catch.

import { supabase } from "@/integrations/supabase/client";
import type { RouteStop } from "@/components/routes/types";

export type EmailKind =
  | "on_the_way"
  | "completed"
  | "review_request"
  | "plan_confirmation";

export interface CustomerEmailResult {
  ok: boolean;
  message_id?: string;
  error?: string;
}

interface InvokeArgs {
  kind: EmailKind;
  recipient: { email: string; name?: string };
  customer_id?: string | null;
  route_stop_id?: string | null;
  context: Record<string, unknown>;
}

async function invokeEmail(args: InvokeArgs): Promise<CustomerEmailResult> {
  try {
    const { data, error } = await supabase.functions.invoke(
      "send-customer-email",
      { body: args },
    );
    if (error) {
      return { ok: false, error: error.message };
    }
    const payload = (data ?? {}) as {
      ok?: boolean;
      message_id?: string;
      error?: string;
      detail?: string;
    };
    if (payload.ok === false || payload.error) {
      return {
        ok: false,
        error: payload.error || payload.detail || "Email send failed",
      };
    }
    return { ok: true, message_id: payload.message_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown" };
  }
}

/**
 * Resolve a recipient `{ email, name }` for a route stop. Pulls from the
 * customer row using customer_id (or property_id → customer) since the
 * stop snapshot doesn't include email. Returns null if no email on file.
 */
async function resolveStopRecipient(
  stop: RouteStop,
): Promise<{ email: string; name?: string } | null> {
  if (!stop.customer_id) return null;
  const { data, error } = await supabase
    .from("customers")
    .select("email, name")
    .eq("id", stop.customer_id)
    .maybeSingle();
  if (error || !data?.email) return null;
  return {
    email: data.email,
    name: data.name ?? stop.customer_name_snapshot ?? undefined,
  };
}

/** Auto-trigger: customer is on the way. Fired from the active stop card. */
export async function sendOnTheWay(
  stop: RouteStop,
): Promise<CustomerEmailResult> {
  const recipient = await resolveStopRecipient(stop);
  if (!recipient) {
    return { ok: false, error: "No email on file for this customer" };
  }
  return invokeEmail({
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
export async function sendCompleted(
  stop: RouteStop,
): Promise<CustomerEmailResult> {
  const recipient = await resolveStopRecipient(stop);
  if (!recipient) {
    return { ok: false, error: "No email on file for this customer" };
  }
  return invokeEmail({
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
 * Send a review-ask email tied to either a quote_id (post-quote) or a plan
 * portal_token (plan-only customers — the portal serves as the review entry).
 */
export async function sendReviewRequest(
  args:
    | { quoteId: string; recipient: { email: string; name?: string }; customerId?: string | null }
    | { planToken: string; recipient: { email: string; name?: string }; customerId?: string | null },
): Promise<CustomerEmailResult> {
  const context =
    "quoteId" in args
      ? { quote_id: args.quoteId }
      : { plan_token: args.planToken };
  return invokeEmail({
    kind: "review_request",
    recipient: args.recipient,
    customer_id: args.customerId ?? null,
    context,
  });
}

/**
 * Sent after a maintenance plan is created. The edge function pulls cadence
 * + amount + portal token from the plan row using plan_id.
 */
export async function sendPlanConfirmation(
  planId: string,
  recipient: { email: string; name?: string },
  customerId?: string | null,
): Promise<CustomerEmailResult> {
  return invokeEmail({
    kind: "plan_confirmation",
    recipient,
    customer_id: customerId ?? null,
    context: { plan_id: planId },
  });
}
