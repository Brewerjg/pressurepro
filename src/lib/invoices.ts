// invoices.ts
//
// Typed client wrappers around the invoices table. The table doesn't exist in
// the generated Database type yet (added in the quotes-to-invoices migration);
// we cast at the boundary with `any` so callers get a strongly-typed surface
// without bypassing the supabase client entirely. This mirrors the pattern in
// src/lib/manual-payments.ts.
//
// Use cases:
//  - Operator converts an accepted quote into an invoice and works it on the
//    Invoices list / InvoiceDetail surfaces.
//  - Public/anon viewer opens an invoice by its public_token (no auth) to view
//    and pay.

import { supabase } from "@/integrations/supabase/client";

export interface Invoice {
  id: string;
  user_id: string;
  app: string;
  quote_id: string;
  invoice_number: number;
  public_token: string;
  customer_id: string | null;
  customer_name: string;
  address: string | null;
  phone: string | null;
  customer_email: string | null;
  lines: unknown;
  total: number;
  deposit_amount: number | null;
  deposit_paid_at: string | null;
  status: "open" | "paid" | "void";
  completed_at: string | null;
  issued_at: string;
  created_at: string;
  updated_at: string;
}

/** Human-facing invoice number, e.g. INV-1001. */
export const formatInvoiceNumber = (n: number) => `INV-${n}`;

/**
 * List all invoices for the currently-authenticated operator scoped to the
 * given app, newest first.
 */
export async function listInvoices(app: string): Promise<Invoice[]> {
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const userId = userRes.user?.id;
  if (!userId) throw new Error("Not signed in");

  // invoices isn't in the generated Database type yet — cast at the boundary
  // using `any` to match the manual_payments pattern.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("invoices")
    .select("*")
    .eq("user_id", userId)
    .eq("app", app)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as Invoice[]) ?? [];
}

/**
 * Fetch a single invoice by id for the current operator (RLS scopes it to
 * user_id = auth.uid()). Returns null when not found.
 */
export async function getInvoice(id: string): Promise<Invoice | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Invoice | null) ?? null;
}

/**
 * Fetch the invoice linked to a given quote id (quote_id is unique). Used by
 * QuoteDetail to decide whether a quote has already been converted. Returns
 * null when the quote hasn't been invoiced.
 */
export async function getInvoiceByQuote(quoteId: string): Promise<Invoice | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("invoices")
    .select("*")
    .eq("quote_id", quoteId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Invoice | null) ?? null;
}

/**
 * Public/anon read of an invoice by its public_token. No getUser() — the RLS
 * policy allows anonymous select by public_token so a customer can open and
 * pay a shared invoice link. Returns null when not found.
 */
export async function getInvoiceByToken(token: string): Promise<Invoice | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("invoices")
    .select("*")
    .eq("public_token", token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Invoice | null) ?? null;
}

/**
 * Patch an existing invoice row. RLS scopes the update to the current
 * operator. updated_at is left to the table's trigger/default.
 */
export async function updateInvoice(id: string, patch: Partial<Invoice>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("invoices")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);
}
