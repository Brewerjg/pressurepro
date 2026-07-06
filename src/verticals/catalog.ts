import type { Database } from "@/integrations/supabase/types";

// The catalog seam — everything trade-specific about the service catalog:
// the starter seed, the `kind` this trade's billable services live under, the
// new-item default unit, and the editor copy.

export type PricingUnit = Database["public"]["Enums"]["pricing_unit"]; // 'sqft'|'linear_ft'|'flat'
export type CatalogKind = Database["public"]["Enums"]["catalog_kind"]; // 'service'|'chemical'

// One starter catalog item, pre-insert. app/user_id/kind are added at seed time.
export interface CatalogSeedItem {
  name: string;
  default_rate: number;
  min_charge: number;
  unit: PricingUnit;
  sort_order: number;
}

export interface CatalogModule {
  /** The catalog `kind` this vertical's billable services live under. */
  serviceKind: CatalogKind;
  /** Default pricing unit for a newly-added catalog item. */
  defaultUnit: PricingUnit;
  /** Starter catalog items offered on first run / the editor empty state. */
  defaultSeed: readonly CatalogSeedItem[];
  /** Server RPC that idempotently seeds the starter catalog (tried first). */
  seedRpcName: string;
  /** Trade-specific editor copy. */
  copy: {
    editorDescription: string;
    emptyStateHint: string;
    seedButtonLabel: string;
  };
}
