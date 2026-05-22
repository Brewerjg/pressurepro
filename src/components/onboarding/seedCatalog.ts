import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

// Canonical lawn-care catalog rows — kept in sync with
// supabase/migrations/0002_seed_lawn_catalog.sql AND
// src/components/settings/CatalogEditor.tsx (LAWN_CATALOG_SEED). When the SQL
// helper is unavailable to authenticated clients (its EXECUTE is revoked by
// design), we fall back to a client-side bulk insert that produces the same
// rows.

type CatalogInsert = Database["public"]["Tables"]["catalog_items"]["Insert"];
type PricingUnit = Database["public"]["Enums"]["pricing_unit"];

export const LAWN_CATALOG_SEED: ReadonlyArray<{
  name: string;
  unit: PricingUnit;
  default_rate: number;
  min_charge: number;
  sort_order: number;
}> = [
  { name: "Weekly mow", unit: "flat", default_rate: 45, min_charge: 45, sort_order: 10 },
  { name: "Biweekly mow", unit: "flat", default_rate: 55, min_charge: 55, sort_order: 20 },
  { name: "Edge", unit: "flat", default_rate: 10, min_charge: 10, sort_order: 30 },
  { name: "Trim", unit: "flat", default_rate: 10, min_charge: 10, sort_order: 40 },
  { name: "Blow", unit: "flat", default_rate: 8, min_charge: 8, sort_order: 50 },
  { name: "Spring cleanup", unit: "flat", default_rate: 175, min_charge: 175, sort_order: 100 },
  { name: "Fall cleanup", unit: "flat", default_rate: 195, min_charge: 195, sort_order: 110 },
  { name: "Leaf removal", unit: "flat", default_rate: 145, min_charge: 145, sort_order: 120 },
  { name: "Aeration", unit: "flat", default_rate: 125, min_charge: 125, sort_order: 200 },
  { name: "Overseed", unit: "flat", default_rate: 165, min_charge: 165, sort_order: 210 },
  { name: "Dethatching", unit: "flat", default_rate: 145, min_charge: 145, sort_order: 220 },
  { name: "Mulch install", unit: "flat", default_rate: 75, min_charge: 75, sort_order: 230 },
  { name: "Fert step 1 (pre-emergent)", unit: "flat", default_rate: 85, min_charge: 85, sort_order: 300 },
  { name: "Fert step 2 (weed + feed)", unit: "flat", default_rate: 85, min_charge: 85, sort_order: 310 },
  { name: "Fert step 3 (summer feed)", unit: "flat", default_rate: 85, min_charge: 85, sort_order: 320 },
  { name: "Fert step 4 (fall feed)", unit: "flat", default_rate: 85, min_charge: 85, sort_order: 330 },
  { name: "Fert step 5 (winterize)", unit: "flat", default_rate: 85, min_charge: 85, sort_order: 340 },
  { name: "Weed control (spot)", unit: "flat", default_rate: 65, min_charge: 65, sort_order: 400 },
  { name: "Grub control", unit: "flat", default_rate: 95, min_charge: 95, sort_order: 410 },
  { name: "Lime application", unit: "flat", default_rate: 75, min_charge: 75, sort_order: 420 },
  { name: "Snow plow (per visit)", unit: "flat", default_rate: 75, min_charge: 75, sort_order: 900 },
  { name: "Snow shovel (per visit)", unit: "flat", default_rate: 55, min_charge: 55, sort_order: 910 },
];

// Try the SECURITY DEFINER RPC first; if EXECUTE is revoked (the prod state),
// fall back to inserting the canonical rows directly under the user's RLS.
export async function seedDefaultLawnCatalog(userId: string): Promise<void> {
  const rpcResult = await (
    supabase.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>
  )("seed_default_lawn_catalog", { _user_id: userId });
  if (!rpcResult.error) return;

  const rows: CatalogInsert[] = LAWN_CATALOG_SEED.map((r) => ({
    user_id: userId,
    kind: "service" as const,
    name: r.name,
    unit: r.unit,
    default_rate: r.default_rate,
    min_charge: r.min_charge,
    sort_order: r.sort_order,
  }));
  const { error } = await supabase.from("catalog_items").insert(rows);
  if (error) throw error;
}
