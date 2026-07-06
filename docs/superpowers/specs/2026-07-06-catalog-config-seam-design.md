# Phase 0c-2 — catalog config seam design

Status: approved design, ready for implementation planning.
Date: 2026-07-06.

## Context

Part of the multi-vertical platform (spec:
`2026-07-04-multi-vertical-platform-design.md`). **Phase 0c** extracts the lawn
domain behind the `Vertical` contract, one seam at a time. **0c-1a/0c-1b** built
the quote-line seam. **0c-2** (this) adds a `vertical.catalog` config module that
owns everything trade-specific about the service catalog: the starter seed items,
the catalog `kind` this trade's billable services live under, the new-item default
unit, and the editor copy.

### What the audit established

- **`catalog_items`** (shared table, `app` discriminator) columns:
  `app, archived, cost_per_unit, cost_unit, created_at, default_rate, description,
  id, kind, min_charge, mode, name, sort_order, surface_type, unit, updated_at,
  user_id`. Enums: `catalog_kind = 'service' | 'chemical'`;
  `pricing_unit = 'sqft' | 'linear_ft' | 'flat'`. Lawn rows only ever use
  `service` kind and `flat` unit; `cost_per_unit/cost_unit/mode/surface_type` are
  PressurePro-origin and null in every TurfPro row.
- **Seed list = 22 lawn services**, duplicated in THREE places: the SQL RPC
  `private.seed_default_lawn_catalog` (`supabase/migrations/0002_seed_lawn_catalog.sql`),
  the client array `LAWN_CATALOG_SEED` (`src/components/onboarding/seedCatalog.ts`),
  and an **inlined verbatim copy** in `src/components/settings/CatalogEditor.tsx`
  (a known "keep in sync" smell). Seed is user-triggered from two entry points:
  Onboarding wizard step 3, and the CatalogEditor empty-state button.
- **Seed function** `seedDefaultLawnCatalog(userId)` (`seedCatalog.ts`): tries the
  RPC first; on error (EXECUTE is revoked in prod) falls back to a direct
  `catalog_items` INSERT with `app: APP_ID`. Both entry points use it EXCEPT the
  CatalogEditor button, which inserts its own inlined copy.
- **5 sites choose the catalog kind.** `QuoteForm` already reads
  `vertical.quoteLine.catalogKindFilter`. Four hardcode `kind: "service"`:
  `CatalogEditor` (query + insert), `NewPlan` (query), `InvoiceDetail` (query).
- **Editor copy is lawn-specific:** description "Lawn services you offer. …",
  empty-state "…canonical lawn-care services (weekly mow, fert steps, cleanups,
  snow)", seed button "Seed default lawn catalog".
- **Chemicals are NOT catalog items in TurfPro.** Chemical tracking lives in a
  separate `chemical_applications` table. `catalog_items.kind='chemical'` is a
  PressurePro concept, unused by lawn (no chemical seed rows, no chemical catalog
  query, chemical editor tab suppressed). So `vertical.catalog` does NOT model
  chemical catalog items for lawn.

## Decisions

1. **Add `catalog: CatalogModule` to the `Vertical` contract** — the config seam
   for all trade-specific catalog behavior.
2. **Unify the kind filter** on `vertical.catalog.serviceKind` (single source):
   route ALL 5 sites through it and **remove `catalogKindFilter` from
   `QuoteLineModule`** (+ `lawnQuoteLine`).
3. **DRY the seed to one client copy:** `defaultSeed` lives in
   `verticals/lawn/catalog.ts`; the inlined `CatalogEditor` copy is deleted; both
   entry points call one shared `seedDefaultCatalog`. (The SQL RPC keeps its own
   server-side copy of the list — unchanged; out of scope to alter without a
   migration. Documented as an accepted residual.)
4. **Verticalize the editor copy + default unit** (`copy.*`, `defaultUnit`).
5. **Preserve seeding behavior exactly** — RPC-first-then-client-insert; only the
   data source (`defaultSeed`) and RPC name (`seedRpcName`) move to the config.
6. **Behavior-identical** for TurfPro: same seed items, same editor, same catalog
   queries. This is a config relocation, not a redesign.

## The contract

New file `src/verticals/catalog.ts`:

```ts
import type { Database } from "@/integrations/supabase/types";

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
```

The `Vertical` interface (`src/verticals/types.ts`) gains `catalog: CatalogModule`.

## Architecture / mechanics

- **`src/verticals/lawn/catalog.ts`** — `export const LAWN_CATALOG_SEED:
  readonly CatalogSeedItem[]` (the 22 items, relocated verbatim from
  `seedCatalog.ts`) and `export const lawnCatalog: CatalogModule` with
  `serviceKind: "service"`, `defaultUnit: "flat"`, `defaultSeed: LAWN_CATALOG_SEED`,
  `seedRpcName: "seed_default_lawn_catalog"`, and the three lawn copy strings.
- **`src/verticals/lawn/index.ts`** — add `catalog: lawnCatalog` to `lawnVertical`.
- **`src/components/onboarding/seedCatalog.ts`** — rename `seedDefaultLawnCatalog`
  → `seedDefaultCatalog(userId: string)`, **preserving its current return contract
  exactly** (whatever its two callers — Onboarding step 3 and the CatalogEditor
  button — depend on; the plan pins the precise signature from the current source).
  It reads `vertical.catalog`: call
  `supabase.rpc(vertical.catalog.seedRpcName, { _user_id: userId })`; on error,
  INSERT `vertical.catalog.defaultSeed` mapped to rows with
  `{ ...item, app: APP_ID, user_id: userId, kind: vertical.catalog.serviceKind }`.
  Remove the local `LAWN_CATALOG_SEED` (now in the vertical). Keep the exact
  RPC-first-then-fallback control flow and error handling.
- **`src/components/settings/CatalogEditor.tsx`** — delete the inlined seed copy;
  the empty-state button calls `seedDefaultCatalog`. Query + insert use
  `vertical.catalog.serviceKind`. The description, empty-state hint, and seed
  button label read `vertical.catalog.copy.*`. New-item `unit` state initializes
  to `vertical.catalog.defaultUnit`. (The `UNIT_LABEL` map and the unit `<select>`
  options stay in the editor — pricing units are generic, not trade-specific.)
- **`src/components/quotes/QuoteForm.tsx`** — the `catalog_items` query changes
  `vertical.quoteLine.catalogKindFilter` → `vertical.catalog.serviceKind`.
- **`src/pages/NewPlan.tsx`** and **`src/pages/InvoiceDetail.tsx`** — the
  `catalog_items` queries change `kind: "service"` →
  `vertical.catalog.serviceKind`.
- **`src/verticals/quote-line.ts`** — remove `catalogKindFilter` from
  `QuoteLineModule`. **`src/verticals/lawn/quote-line.tsx`** — remove
  `catalogKindFilter` from `lawnQuoteLine`.

## Testing

- **Unit (vitest)** `src/verticals/lawn/catalog.test.ts`: `lawnCatalog.serviceKind
  === "service"`; `defaultUnit === "flat"`; `defaultSeed.length === 22`; every seed
  item has non-empty `name`, numeric `default_rate`/`min_charge`, a valid `unit`,
  numeric `sort_order`; `sort_order` values are strictly ascending; `seedRpcName
  === "seed_default_lawn_catalog"`; `copy.seedButtonLabel === "Seed default lawn
  catalog"`.
- **Conformance:** `lawnVertical.catalog` is defined (extend the existing vertical
  conformance test if present).
- **Build + tsc:** `npx tsc --noEmit -p tsconfig.app.json` clean (note the
  pre-existing 6-file error baseline — Campaigns/AudienceStep/BusinessProfile/
  iap/Onboarding/templates — is unrelated; success = no NEW file in the error set,
  and `Onboarding.tsx` must not gain a NEW error from the seed-fn rename).
  `npm run build` succeeds; `npm test -- --run` full suite green.
- **Manual (deferred, human):** onboarding step 3 seeds the 22 items; the
  CatalogEditor empty-state button seeds them; editor copy renders; a new custom
  item defaults to `flat`; quote/plan/invoice catalog pickers still list services.

## Out of scope (0c-2)

- Multi-`kind` catalog tabs / chemical catalog items — Phase 1 (pressure).
- The `chemical_applications` calculators (ApplicationCalc/ChemicalLog/
  SaveApplicationForm) — that is 0c-3.
- The SQL RPC body (server-side seed copy) — left as-is; the client no longer
  needs to mirror it beyond passing `seedRpcName`.
- Shared `unitLabels` / the unit `<select>` — pricing units are generic.
- Any pressure `catalog` config — Phase 1 (this seam is what makes it
  config-only).
