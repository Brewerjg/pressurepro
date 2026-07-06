import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { APP_ID } from "@/lib/app-context";
import { vertical } from "@/vertical";

// Seeds the active vertical's starter catalog. Tries the SECURITY DEFINER RPC
// first; if EXECUTE is revoked (the prod state), falls back to inserting the
// vertical's defaultSeed directly under the user's RLS. The seed data + RPC name
// live in vertical.catalog — this function is trade-agnostic.

type CatalogInsert = Database["public"]["Tables"]["catalog_items"]["Insert"];

export async function seedDefaultCatalog(userId: string): Promise<void> {
  const rpcResult = await (
    supabase.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>
  )(vertical.catalog.seedRpcName, { _user_id: userId });
  if (!rpcResult.error) return;

  // `app` field added in migration 0022; generated types may not include
  // it yet — widen and cast.
  const rows = vertical.catalog.defaultSeed.map((r) => ({
    user_id: userId,
    kind: vertical.catalog.serviceKind,
    name: r.name,
    unit: r.unit,
    default_rate: r.default_rate,
    min_charge: r.min_charge,
    sort_order: r.sort_order,
    app: APP_ID,
  })) as unknown as CatalogInsert[];
  const { error } = await supabase.from("catalog_items").insert(rows);
  if (error) throw error;
}
