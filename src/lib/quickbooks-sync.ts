// quickbooks-sync.ts
//
// Client wrapper around the `quickbooks-sync` edge function. Pushes a TurfPro
// invoice (and its payments) into the operator's connected QuickBooks company.
// Throws on failure, matching src/lib/quickbooks.ts.

import { supabase } from "@/integrations/supabase/client";

export interface SyncInvoiceResult {
  ok: true;
  qbo_invoice_id: string;
  payments_synced: number;
}

export async function syncInvoiceToQuickBooks(
  invoiceId: string,
): Promise<SyncInvoiceResult> {
  const { data, error } = await supabase.functions.invoke("quickbooks-sync", {
    body: { action: "sync_invoice", invoice_id: invoiceId },
  });
  if (error) throw new Error(error.message);
  const payload = data as {
    ok?: boolean;
    qbo_invoice_id?: string;
    payments_synced?: number;
    error?: string;
  };
  if (payload?.error || !payload?.ok) {
    throw new Error(payload?.error || "QuickBooks sync failed");
  }
  return {
    ok: true,
    qbo_invoice_id: payload.qbo_invoice_id ?? "",
    payments_synced: payload.payments_synced ?? 0,
  };
}
