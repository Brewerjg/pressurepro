// quickbooks-sync
//
// QuickBooks Online Phase 2 — push a TurfPro invoice and its payments into the
// operator's connected QBO company. One op: sync_invoice { invoice_id }.
//
// Auth: resolves the operator from the Authorization header (JWT-scoped
// client), like quickbooks-oauth. All QBO/token work uses the service-role
// client via the shared module. Idempotent by persisted QBO ids:
//   invoices.qbo_invoice_id (create-once) and manual_payments.qbo_payment_id
//   (one QBO Payment per non-voided row, skipped once posted).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  serviceClient,
  loadConnection,
  refreshIfNeeded,
  qboFetch,
  type QbConnection,
} from "../_shared/quickbooks.ts";
import {
  parseInvoiceLines,
  buildInvoiceLines,
  buildPaymentPayload,
} from "../_shared/quickbooks-map.ts";

const DEFAULT_ITEM_NAME = "Landscaping Services";

async function resolveUser(req: Request): Promise<{ id: string } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const anonKey =
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    "";
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id };
}

// Escape a value for a QBO SQL-ish query string (single quotes doubled).
const q = (s: string) => s.replace(/'/g, "''");

/** Resolve (and cache) the default service item id for this connection. */
async function resolveDefaultItem(
  conn: QbConnection,
  svc: ReturnType<typeof serviceClient>,
): Promise<string> {
  if (conn.qbo_default_item_id) return conn.qbo_default_item_id;

  // 1) Reuse an existing item with our name if present.
  const found = await qboFetch(
    conn,
    `/query?query=${encodeURIComponent(
      `select Id from Item where Name = '${q(DEFAULT_ITEM_NAME)}'`,
    )}&minorversion=65`,
  );
  let itemId: string | undefined = found?.QueryResponse?.Item?.[0]?.Id;

  // 2) Otherwise create it, referencing the first Income account.
  if (!itemId) {
    const acct = await qboFetch(
      conn,
      `/query?query=${encodeURIComponent(
        "select Id from Account where AccountType = 'Income'",
      )}&minorversion=65`,
    );
    const incomeAccountId: string | undefined =
      acct?.QueryResponse?.Account?.[0]?.Id;
    if (!incomeAccountId) {
      throw new Error("No Income account found in QuickBooks to back the service item");
    }
    const created = await qboFetch(conn, `/item?minorversion=65`, {
      method: "POST",
      body: JSON.stringify({
        Name: DEFAULT_ITEM_NAME,
        Type: "Service",
        IncomeAccountRef: { value: incomeAccountId },
      }),
    });
    itemId = created?.Item?.Id;
    if (!itemId) throw new Error("Failed to create default QuickBooks service item");
  }

  const { error: itemCacheErr } = await svc
    .from("quickbooks_connections")
    .update({ qbo_default_item_id: itemId } as never)
    .eq("user_id", conn.user_id);
  if (itemCacheErr) console.warn("Failed to cache qbo_default_item_id:", itemCacheErr.message);
  return itemId;
}

interface InvoiceRow {
  id: string;
  user_id: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string | null;
  phone: string | null;
  address: string | null;
  lines: unknown;
  qbo_invoice_id: string | null;
}

/** Find-or-create the QBO Customer for this invoice; cache id when possible. */
async function resolveCustomer(
  conn: QbConnection,
  svc: ReturnType<typeof serviceClient>,
  invoice: InvoiceRow,
): Promise<string> {
  // Cached on the customers row?
  if (invoice.customer_id) {
    const { data: cust } = await svc
      .from("customers")
      .select("qbo_customer_id")
      .eq("id", invoice.customer_id)
      .maybeSingle();
    const cached = (cust as { qbo_customer_id?: string } | null)?.qbo_customer_id;
    if (cached) return cached;
  }

  // Match by DisplayName, then email.
  const name = invoice.customer_name?.trim() || "Customer";
  let match = await qboFetch(
    conn,
    `/query?query=${encodeURIComponent(
      `select Id from Customer where DisplayName = '${q(name)}'`,
    )}&minorversion=65`,
  );
  let customerId: string | undefined = match?.QueryResponse?.Customer?.[0]?.Id;

  if (!customerId && invoice.customer_email) {
    match = await qboFetch(
      conn,
      `/query?query=${encodeURIComponent(
        `select Id from Customer where PrimaryEmailAddr = '${q(invoice.customer_email)}'`,
      )}&minorversion=65`,
    );
    customerId = match?.QueryResponse?.Customer?.[0]?.Id;
  }

  // Create if still not found.
  if (!customerId) {
    const body: Record<string, unknown> = { DisplayName: name };
    if (invoice.customer_email) body.PrimaryEmailAddr = { Address: invoice.customer_email };
    if (invoice.phone) body.PrimaryPhone = { FreeFormNumber: invoice.phone };
    if (invoice.address) body.BillAddr = { Line1: invoice.address };
    const created = await qboFetch(conn, `/customer?minorversion=65`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    customerId = created?.Customer?.Id;
    if (!customerId) throw new Error("Failed to create QuickBooks customer");
  }

  if (invoice.customer_id) {
    const { error: custCacheErr } = await svc
      .from("customers")
      .update({ qbo_customer_id: customerId } as never)
      .eq("id", invoice.customer_id);
    if (custCacheErr) console.warn("Failed to cache qbo_customer_id:", custCacheErr.message);
  }
  return customerId;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await req.json().catch(() => ({}));

  const user = await resolveUser(req);
  if (!user) return jsonResponse({ error: "Unauthorized" }, { status: 401 });

  if (body?.action !== "sync_invoice" || typeof body?.invoice_id !== "string") {
    return jsonResponse({ error: "Expected { action: 'sync_invoice', invoice_id }" }, { status: 400 });
  }
  const invoiceId = body.invoice_id as string;

  const svc = serviceClient();

  // Load the invoice, scoped to this operator.
  const { data: invData, error: invErr } = await svc
    .from("invoices")
    .select("id, user_id, customer_id, customer_name, customer_email, phone, address, lines, qbo_invoice_id")
    .eq("id", invoiceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (invErr) return jsonResponse({ error: invErr.message }, { status: 500 });
  if (!invData) return jsonResponse({ error: "Invoice not found" }, { status: 404 });
  const invoice = invData as InvoiceRow;

  try {
    let conn = await loadConnection(svc, user.id);
    if (!conn) return jsonResponse({ error: "QuickBooks is not connected" }, { status: 400 });
    conn = await refreshIfNeeded(conn, svc);

    const itemId = await resolveDefaultItem(conn, svc);
    const customerRef = await resolveCustomer(conn, svc, invoice);

    // Create the QBO invoice once.
    let qboInvoiceId = invoice.qbo_invoice_id ?? null;
    if (!qboInvoiceId) {
      const lines = buildInvoiceLines(parseInvoiceLines(invoice.lines), itemId);
      if (lines.length === 0) throw new Error("Invoice has no line items to sync");
      const createdInv = await qboFetch(conn, `/invoice?minorversion=65`, {
        method: "POST",
        body: JSON.stringify({ CustomerRef: { value: customerRef }, Line: lines }),
      });
      qboInvoiceId = createdInv?.Invoice?.Id ?? null;
      if (!qboInvoiceId) throw new Error("Failed to create QuickBooks invoice");
      const { error: invWriteErr } = await svc
        .from("invoices")
        .update({ qbo_invoice_id: qboInvoiceId } as never)
        .eq("id", invoice.id);
      if (invWriteErr) throw new Error(`Failed to persist qbo_invoice_id: ${invWriteErr.message}`);
    }

    // Mirror each non-voided, not-yet-synced payment.
    const { data: pays, error: payErr } = await svc
      .from("manual_payments")
      .select("id, amount_cents")
      .eq("invoice_id", invoice.id)
      .neq("status", "voided")
      .is("qbo_payment_id", null);
    if (payErr) throw new Error(payErr.message);

    let paymentsSynced = 0;
    for (const p of (pays ?? []) as { id: string; amount_cents: number }[]) {
      const payload = buildPaymentPayload(p.amount_cents, qboInvoiceId, customerRef);
      const createdPay = await qboFetch(conn, `/payment?minorversion=65`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const paymentId = createdPay?.Payment?.Id;
      if (!paymentId) throw new Error("Failed to create QuickBooks payment");
      const { error: payWriteErr } = await svc
        .from("manual_payments")
        .update({ qbo_payment_id: paymentId } as never)
        .eq("id", p.id);
      if (payWriteErr) throw new Error(`Failed to persist qbo_payment_id for payment ${p.id}: ${payWriteErr.message}`);
      paymentsSynced += 1;
    }

    await svc
      .from("invoices")
      .update({ qbo_synced_at: new Date().toISOString(), qbo_sync_error: null } as never)
      .eq("id", invoice.id);

    return jsonResponse({ ok: true, qbo_invoice_id: qboInvoiceId, payments_synced: paymentsSynced });
  } catch (e) {
    const message = e instanceof Error ? e.message : "QuickBooks sync failed";
    await svc
      .from("invoices")
      .update({ qbo_sync_error: message } as never)
      .eq("id", invoice.id);
    console.error("quickbooks-sync error:", message);
    return jsonResponse({ error: message }, { status: 500 });
  }
});
