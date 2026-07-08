import { supabase } from "@/integrations/supabase/client";
import type { CatalogModule, CatalogSeedItem } from "@/verticals/catalog";
import type { CatalogItem } from "@/verticals/quote-line";
import type { Database } from "@/integrations/supabase/types";

type SurfacePricingRow = Database["public"]["Tables"]["surface_pricing"]["Row"];
type SurfacePricingInsert = Database["public"]["Tables"]["surface_pricing"]["Insert"];

// Human labels for the CatalogItem name (the quote LineEditor matches on
// surface_type+mode, not name; NewPlan/pickers show the name).
const SURFACE_LABEL: Record<string, string> = {
  house: "House Wash", siding: "Siding", roof: "Roof", driveway: "Driveway",
  concrete: "Concrete", deck: "Deck", fence: "Fence",
};

// Starter surface pricing — verbatim from PressurePro DEFAULT_SURFACES (one row
// per surface at its recommended mode). Seeded into surface_pricing.
const PRESSURE_SURFACE_SEED: readonly CatalogSeedItem[] = [
  { name: "Concrete", surface_type: "concrete", mode: "power", default_rate: 0.2, min_charge: 150, unit: "sqft", sort_order: 10 },
  { name: "Siding", surface_type: "siding", mode: "soft", default_rate: 0.15, min_charge: 200, unit: "sqft", sort_order: 20 },
  { name: "Roof", surface_type: "roof", mode: "soft", default_rate: 0.4, min_charge: 350, unit: "sqft", sort_order: 30 },
  { name: "Deck", surface_type: "deck", mode: "soft", default_rate: 1.5, min_charge: 200, unit: "sqft", sort_order: 40 },
  { name: "Fence", surface_type: "fence", mode: "soft", default_rate: 3.0, min_charge: 150, unit: "linear_ft", sort_order: 50 },
  { name: "Driveway", surface_type: "driveway", mode: "power", default_rate: 0.18, min_charge: 150, unit: "sqft", sort_order: 60 },
  { name: "House Wash", surface_type: "house", mode: "soft", default_rate: 0.25, min_charge: 250, unit: "sqft", sort_order: 70 },
];

export function surfaceRowToCatalogItem(row: SurfacePricingRow): CatalogItem {
  const label = SURFACE_LABEL[row.surface_type] ?? row.surface_type;
  return {
    id: row.id,
    name: `${label} (${row.mode})`,
    default_rate: Number(row.default_rate),
    surface_type: row.surface_type,
    mode: row.mode,
  };
}

async function pressureLoadServiceCatalog(userId: string, _appId: string): Promise<CatalogItem[]> {
  const { data, error } = await supabase
    .from("surface_pricing")
    .select("*")
    .eq("user_id", userId)
    .order("surface_type");
  if (error) throw error;
  return (data ?? []).map(surfaceRowToCatalogItem);
}

async function pressureSeed(userId: string, _appId: string): Promise<void> {
  const { data: existing } = await supabase
    .from("surface_pricing")
    .select("id")
    .eq("user_id", userId);
  if ((existing?.length ?? 0) > 0) return; // idempotent — trigger usually seeds first
  const rows = PRESSURE_SURFACE_SEED.map((s) => ({
    user_id: userId,
    surface_type: s.surface_type as string,
    mode: s.mode as string,
    unit: s.unit,
    default_rate: s.default_rate,
    min_charge: s.min_charge,
  })) as unknown as SurfacePricingInsert[];
  const { error } = await supabase
    .from("surface_pricing")
    .upsert(rows, { onConflict: "user_id,surface_type,mode", ignoreDuplicates: true });
  if (error) throw error;
}

export const pressureCatalog: CatalogModule = {
  serviceKind: "service",
  defaultUnit: "sqft",
  defaultSeed: PRESSURE_SURFACE_SEED,
  seedRpcName: "", // unused — pressure seeds surface_pricing directly
  copy: {
    editorDescription:
      "Your per-surface wash rates. Default rate and minimum charge prefill new quotes.",
    emptyStateHint:
      "Seed the standard seven surfaces (house, roof, siding, driveway, concrete, deck, fence). You can tune every rate after.",
    seedButtonLabel: "Seed default surface pricing",
  },
  loadServiceCatalog: pressureLoadServiceCatalog,
  seed: pressureSeed,
};
