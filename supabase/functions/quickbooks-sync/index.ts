// quickbooks-sync
//
// QuickBooks Online Phase 2 — push a billable (a TurfPro invoice OR a
// PressurePro quote) and its payments into the operator's connected QBO
// company. Ops: sync_invoice { invoice_id }, sync_quote { quote_id }.
//
// Auth: resolves the operator from the Authorization header. All QBO/token work
// uses the service-role client. Idempotent by persisted QBO ids: the billable's
// qbo_invoice_id (create-once) and manual_payments.qbo_payment_id (one QBO
// Payment per non-voided row, skipped once posted).

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
  buildQuoteInvoiceLine,
  buildPaymentPayload,
  type QboInvoiceLine,
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

  const found = await qboFetch(
    conn,
    `/query?query=${encodeURIComponent(
      `select Id from Item where Name = '${q(DEFAULT_ITEM_NAME)}'`,
    )}&minorversion=65`,
  );
  let itemId: string | undefined = found?.QueryResponse?.Item?.[0]?.Id;

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

// Fields shared by both billables (invoice + quote) needed for customer resolution.
interface BillableRow {
  id: string;
  user_id: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string | null;
  phone: string | null;
  address: string | null;
}

/** Find-or-create the QBO Customer for this billable; cache id when possible. */
async function resolveCustomer(
  conn: QbConnection,
  svc: ReturnType<typeof serviceClient>,
  billable: BillableRow,
): Promise<string> {
  if (billable.customer_id) {
    const { data: cust } = await svc
      .from("customers")
      .select("qbo_customer_id")
      .eq("id", billable.customer_id)
      .maybeSingle();
    const cached = (cust as { qbo_customer_id?: string } | null)?.qbo_customer_id;
    if (cached) return cached;
  }

  const name = billable.customer_name?.trim() || "Customer";
  let match = await qboFetch(
    conn,
    `/query?query=${encodeURIComponent(
      `select Id from Customer where DisplayName = '${q(name)}'`,
    )}&minorversion=65`,
  );
  let customerId: string | undefined = match?.QueryResponse?.Customer?.[0]?.Id;

  if (!customerId && billable.customer_email) {
    match = await qboFetch(
      conn,
      `/query?query=${encodeURIComponent(
        `select Id from Customer where PrimaryEmailAddr = '${q(billable.customer_email)}'`,
      )}&minorversion=65`,
    );
    customerId = match?.QueryResponse?.Customer?.[0]?.Id;
  }

  if (!customerId) {
    const body: Record<string, unknown> = { DisplayName: name };
    if (billable.customer_email) body.PrimaryEmailAddr = { Address: billable.customer_email };
    if (billable.phone) body.PrimaryPhone = { FreeFormNumber: billable.phone };
    if (billable.address) body.BillAddr = { Line1: billable.address };
    const created = await qboFetch(conn, `/customer?minorversion=65`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    customerId = created?.Customer?.Id;
    if (!customerId) throw new Error("Failed to create QuickBooks customer");
  }

  if (billable.customer_id) {
    const { error: custCacheErr } = await svc
      .from("customers")
      .update({ qbo_customer_id: customerId } as never)
      .eq("id", billable.customer_id);
    if (custCacheErr) console.warn("Failed to cache qbo_customer_id:", custCacheErr.message);
  }
  return customerId;
}

/**
 * Shared orchestration for both ops. Create-once QBO invoice (guarded by the
 * billable's existing qbo_invoice_id), mirror non-voided unsynced payments, and
 * finalize. On any failure, persists the message to `${table}.qbo_sync_error`
 * and rethrows. Idempotency comes from persisting ids at each step.
 */
async function syncBillable(
  conn: QbConnection,
  svc: ReturnType<typeof serviceClient>,
  opts: {
    table: "invoices" | "quotes";
    row: BillableRow;
    existingQboInvoiceId: string | null;
    paymentMatchColumn: "invoice_id" | "quote_id";
    buildLines: (itemId: string) => QboInvoiceLine[];
  },
): Promise<{ qbo_invoice_id: string; payments_synced: number }> {
  const { table, row, paymentMatchColumn, buildLines } = opts;
  try {
    const itemId = await resolveDefaultItem(conn, svc);
    const customerRef = await resolveCustomer(conn, svc, row);

    let qboInvoiceId = opts.existingQboInvoiceId ?? null;
    if (!qboInvoiceId) {
      const lines = buildLines(itemId);
      if (lines.length === 0) throw new Error("Nothing to sync (no line items)");
      const createdInv = await qboFetch(conn, `/invoice?minorversion=65`, {
        method: "POST",
        body: JSON.stringify({ CustomerRef: { value: customerRef }, Line: lines }),
      });
      qboInvoiceId = createdInv?.Invoice?.Id ?? null;
      if (!qboInvoiceId) throw new Error("Failed to create QuickBooks invoice");
      const { error: invWriteErr } = await svc
        .from(table)
        .update({ qbo_invoice_id: qboInvoiceId } as never)
        .eq("id", row.id);
      if (invWriteErr) throw new Error(`Failed to persist qbo_invoice_id: ${invWriteErr.message}`);
    }

    const { data: pays, error: payErr } = await svc
      .from("manual_payments")
      .select("id, amount_cents")
      .eq(paymentMatchColumn, row.id)
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
      .from(table)
      .update({ qbo_synced_at: new Date().toISOString(), qbo_sync_error: null } as never)
      .eq("id", row.id);

    return { qbo_invoice_id: qboInvoiceId, payments_synced: paymentsSynced };
  } catch (e) {
    const message = e instanceof Error ? e.message : "QuickBooks sync failed";
    await svc.from(table).update({ qbo_sync_error: message } as never).eq("id", row.id);
    throw new Error(message);
  }
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

  const svc = serviceClient();

  try {
    if (body?.action === "sync_invoice") {
      if (typeof body?.invoice_id !== "string") {
        return jsonResponse({ error: "Expected { action: 'sync_invoice', invoice_id }" }, { status: 400 });
      }
      const { data, error } = await svc
        .from("invoices")
        .select("id, user_id, customer_id, customer_name, customer_email, phone, address, lines, qbo_invoice_id")
        .eq("id", body.invoice_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) return jsonResponse({ error: error.message }, { status: 500 });
      if (!data) return jsonResponse({ error: "Invoice not found" }, { status: 404 });
      const row = data as BillableRow & { lines: unknown; qbo_invoice_id: string | null };

      let conn = await loadConnection(svc, user.id);
      if (!conn) return jsonResponse({ error: "QuickBooks is not connected" }, { status: 400 });
      conn = await refreshIfNeeded(conn, svc);

      const result = await syncBillable(conn, svc, {
        table: "invoices",
        row,
        existingQboInvoiceId: row.qbo_invoice_id,
        paymentMatchColumn: "invoice_id",
        buildLines: (itemId) => buildInvoiceLines(parseInvoiceLines(row.lines), itemId),
      });
      return jsonResponse({ ok: true, ...result });
    }

    if (body?.action === "sync_quote") {
      if (typeof body?.quote_id !== "string") {
        return jsonResponse({ error: "Expected { action: 'sync_quote', quote_id }" }, { status: 400 });
      }
      const { data, error } = await svc
        .from("quotes")
        .select("id, user_id, customer_id, customer_name, customer_email, phone, address, total, lines, qbo_invoice_id")
        .eq("id", body.quote_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) return jsonResponse({ error: error.message }, { status: 500 });
      if (!data) return jsonResponse({ error: "Quote not found" }, { status: 404 });
      const row = data as BillableRow & { total: number; lines: unknown; qbo_invoice_id: string | null };

      let conn = await loadConnection(svc, user.id);
      if (!conn) return jsonResponse({ error: "QuickBooks is not connected" }, { status: 400 });
      conn = await refreshIfNeeded(conn, svc);

      const result = await syncBillable(conn, svc, {
        table: "quotes",
        row,
        existingQboInvoiceId: row.qbo_invoice_id,
        paymentMatchColumn: "quote_id",
        buildLines: (itemId) =>
          buildQuoteInvoiceLine({ total: Number(row.total ?? 0), lines: row.lines }, itemId),
      });
      return jsonResponse({ ok: true, ...result });
    }

    return jsonResponse({ error: "Unknown op (expected sync_invoice or sync_quote)" }, { status: 400 });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : "QuickBooks sync failed" }, { status: 500 });
  }
});
