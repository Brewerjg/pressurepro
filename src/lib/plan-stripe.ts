// plan-stripe.ts
//
// Thin client-side wrapper around the maintenance-plan ↔ Stripe edge
// functions. Each export does ONE thing: call the function, narrow the
// response into a typed result, and surface a sensible error. Callers
// (NewPlan, PlanDetail) handle UX (redirects, toasts, optimistic state).
//
// We keep the response shapes here so the components don't have to do
// duck-typing on `any` payloads.

import { supabase } from "@/integrations/supabase/client";

export interface NewPlanInput {
  user_id: string;
  customer_id: string | null;
  property_id: string | null;
  customer_name: string;
  phone: string;
  address: string;
  services: string[];
  amount: number;
  interval_months: number;
  start_date: string;
  next_charge_date: string;
  status: "active";
  day_of_week?: number | null;
  frequency?: string | null;
  season_pause?: string[] | null;
  plan_kind?: string | null;
}

/**
 * Result of `create-plan-subscription`.
 *
 * - When the homeowner already has a Stripe customer + card on file we
 *   create the subscription server-side and return `{ planId }`. The UI
 *   can navigate straight to /plans/:id — billing is live.
 * - When there's no card yet we return a hosted Checkout URL. The UI
 *   should redirect the browser to it; Stripe will collect the card and
 *   bounce back to /checkout/return?kind=plan&plan_id=...
 */
export type CreatePlanSubscriptionResult =
  | { kind: "checkout"; checkoutUrl: string; planId: string }
  | { kind: "existing"; planId: string };

export async function createPlanSubscription(
  input: NewPlanInput,
): Promise<CreatePlanSubscriptionResult> {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const { data, error } = await supabase.functions.invoke(
    "create-plan-subscription",
    { body: { plan: input, origin } },
  );
  if (error) throw new Error(error.message);
  const payload = data as {
    checkoutUrl?: string;
    planId?: string;
    error?: string;
  };
  if (payload?.error) throw new Error(payload.error);
  if (payload?.checkoutUrl && payload.planId) {
    return {
      kind: "checkout",
      checkoutUrl: payload.checkoutUrl,
      planId: payload.planId,
    };
  }
  if (payload?.planId) {
    return { kind: "existing", planId: payload.planId };
  }
  throw new Error("create-plan-subscription returned no actionable payload");
}

export type PlanAction = "pause" | "resume" | "cancel";

export interface MutatePlanSubscriptionResult {
  ok: boolean;
  status?: string;
}

export async function mutatePlanSubscription(
  plan_id: string,
  action: PlanAction,
): Promise<MutatePlanSubscriptionResult> {
  const { data, error } = await supabase.functions.invoke(
    "mutate-plan-subscription",
    { body: { plan_id, action } },
  );
  if (error) throw new Error(error.message);
  const payload = data as { ok?: boolean; status?: string; error?: string };
  if (payload?.error) throw new Error(payload.error);
  return { ok: !!payload?.ok, status: payload?.status };
}

export interface OpenPlanPortalResult {
  url: string;
}

/**
 * Used by the public PlanPortal (the homeowner-facing page). The token is
 * the portal_token UUID stored on the plan row.
 */
export async function openPlanPortal(
  portal_token: string,
): Promise<OpenPlanPortalResult> {
  const { data, error } = await supabase.functions.invoke(
    "create-plan-portal-session",
    { body: { portal_token } },
  );
  if (error) throw new Error(error.message);
  const payload = data as { url?: string; error?: string };
  if (payload?.error) throw new Error(payload.error);
  if (!payload?.url) throw new Error("Billing portal session unavailable");
  return { url: payload.url };
}
