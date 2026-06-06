// manual-payments.ts
//
// Typed client wrappers around the manual_payments table. The table doesn't
// exist in the generated Database type yet (added in
// supabase/migrations/0015_manual_payments.sql); we cast at the boundary so
// callers get a strongly-typed surface without bypassing the supabase client
// entirely.
//
// Use cases:
//  - Operator records cash/check/Venmo/Zelle taken at a route stop
//    (RouteMode "+ Payment" button → links route_stop_id + customer_id).
//  - Operator records an off-cycle plan payment (PlanDetail "Record payment"
//    → links plan_id).
//  - Operator records payment against a quote (QuoteDetail "Record payment"
//    → links quote_id).
//
// Reads also live here so the Reports page can pull a 30d window in one call.

import { supabase } from "@/integrations/supabase/client";

export type ManualPaymentMethod =
  | "cash"
  | "check"
  | "venmo"
  | "cashapp"
  | "zelle"
  | "ach_offline"
  | "other";

export type ManualPaymentStatus = "recorded" | "deposited" | "voided";

export interface ManualPayment {
  id: string;
  user_id: string;
  customer_id: string | null;
  plan_id: string | null;
  route_stop_id: string | null;
  quote_id: string | null;
  method: ManualPaymentMethod;
  amount_cents: number;
  check_number: string | null;
  received_at: string;
  notes: string | null;
  status: ManualPaymentStatus;
  deposited_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecordPaymentInput {
  customer_id?: string | null;
  plan_id?: string | null;
  route_stop_id?: string | null;
  quote_id?: string | null;
  method: ManualPaymentMethod;
  amount_cents: number;
  check_number?: string | null;
  notes?: string | null;
}

/**
 * Insert a new manual payment row for the currently-authenticated operator.
 * The RLS policy enforces user_id = auth.uid(); we set it explicitly here so
 * the insert succeeds even when the row's defaults haven't been wired into a
 * server-side trigger.
 *
 * Returns the inserted row.
 */
export async function recordPayment(
  input: RecordPaymentInput,
): Promise<ManualPayment> {
  if (input.amount_cents <= 0) {
    throw new Error("Amount must be greater than zero");
  }
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const userId = userRes.user?.id;
  if (!userId) throw new Error("Not signed in");

  const row = {
    user_id: userId,
    customer_id: input.customer_id ?? null,
    plan_id: input.plan_id ?? null,
    route_stop_id: input.route_stop_id ?? null,
    quote_id: input.quote_id ?? null,
    method: input.method,
    amount_cents: input.amount_cents,
    check_number: input.check_number ?? null,
    notes: input.notes ?? null,
  };

  // manual_payments isn't in the generated Database type yet — cast at the
  // boundary using `any` to match the pattern used for routes / route_stops
  // in Reports.tsx and RouteMode.tsx.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("manual_payments")
    .insert(row)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as ManualPayment;
}

/**
 * Pull all manual payments for the current operator received within the
 * last `days` days. Used by the Reports "Cash + checks" card and the
 * lifetime-customer aggregation.
 */
export async function listManualPaymentsSince(days: number): Promise<ManualPayment[]> {
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("manual_payments")
    .select("*")
    .gte("received_at", sinceIso)
    .order("received_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as ManualPayment[]) ?? [];
}

/**
 * Pull ALL manual payments for the current operator. Used for the lifetime
 * customer revenue rollup in Reports. Pages in 1000-row chunks so we don't
 * silently truncate for long-running accounts.
 */
export async function listManualPaymentsLifetime(): Promise<ManualPayment[]> {
  const PAGE = 1000;
  const out: ManualPayment[] = [];
  for (let offset = 0; ; offset += PAGE) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("manual_payments")
      .select("*")
      .order("received_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data as ManualPayment[]) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
    if (offset > 50_000) break; // defensive ceiling
  }
  return out;
}

/**
 * Pull manual payments linked to a specific plan id (for the PlanDetail
 * charge-history surface).
 */
export async function listManualPaymentsForPlan(planId: string): Promise<ManualPayment[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("manual_payments")
    .select("*")
    .eq("plan_id", planId)
    .order("received_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as ManualPayment[]) ?? [];
}

/**
 * Pull manual payments linked to a specific quote id (for QuoteDetail to
 * decide whether cumulative payments meet the total / deposit_amount).
 */
export async function listManualPaymentsForQuote(quoteId: string): Promise<ManualPayment[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("manual_payments")
    .select("*")
    .eq("quote_id", quoteId)
    .order("received_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as ManualPayment[]) ?? [];
}

// Label maps for UI rendering — keeping them next to the type so callers
// don't have to redefine.
export const METHOD_LABEL: Record<ManualPaymentMethod, string> = {
  cash: "Cash",
  check: "Check",
  venmo: "Venmo",
  cashapp: "CashApp",
  zelle: "Zelle",
  ach_offline: "ACH",
  other: "Other",
};
