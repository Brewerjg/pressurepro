import { supabase } from "@/integrations/supabase/client";
import type { CatalogItem } from "@/verticals/quote-line";
import type { Database } from "@/integrations/supabase/types";
import type { CatalogModule, CatalogSeedItem } from "@/verticals/catalog";

// Canonical lawn-care starter catalog. The one client-side source of truth
// (previously duplicated in seedCatalog.ts and CatalogEditor.tsx). The SQL RPC
// seed_default_lawn_catalog keeps its own server-side copy.
export const LAWN_CATALOG_SEED: readonly CatalogSeedItem[] = [
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

type CatalogInsert = Database["public"]["Tables"]["catalog_items"]["Insert"];

async function lawnLoadServiceCatalog(_userId: string, appId: string): Promise<CatalogItem[]> {
  const { data, error } = await supabase
    .from("catalog_items")
    .select("*")
    .eq("app", appId)
    .eq("kind", "service")
    .eq("archived", false)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as unknown as CatalogItem[];
}

async function lawnSeed(userId: string, appId: string): Promise<void> {
  // Try the SECURITY DEFINER RPC first; fall back to a direct insert if EXECUTE
  // is revoked (the prod state). Ported verbatim from onboarding/seedCatalog.ts.
  const rpcResult = await (
    supabase.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>
  )("seed_default_lawn_catalog", { _user_id: userId });
  if (!rpcResult.error) return;

  const rows = LAWN_CATALOG_SEED.map((r) => ({
    user_id: userId,
    kind: "service",
    name: r.name,
    unit: r.unit,
    default_rate: r.default_rate,
    min_charge: r.min_charge,
    sort_order: r.sort_order,
    app: appId,
  })) as unknown as CatalogInsert[];
  const { error } = await supabase.from("catalog_items").insert(rows);
  if (error) throw error;
}

export const lawnCatalog: CatalogModule = {
  serviceKind: "service",
  defaultUnit: "flat",
  defaultSeed: LAWN_CATALOG_SEED,
  seedRpcName: "seed_default_lawn_catalog",
  copy: {
    editorDescription:
      "Lawn services you offer. Default rate and minimum charge prefill new plans & quotes.",
    emptyStateHint:
      "Get started with the canonical lawn-care services (weekly mow, fert steps, cleanups, snow). You can edit any of them after.",
    seedButtonLabel: "Seed default lawn catalog",
  },
  loadServiceCatalog: lawnLoadServiceCatalog,
  seed: lawnSeed,
};
