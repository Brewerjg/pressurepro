# Phase 1 slice 1c-1 — pressure catalog data-source seam design

Status: approved phase; this slice's design ready for planning.
Date: 2026-07-08.
Parent: `2026-07-08-pressure-vertical-phase1-design.md`.

## Purpose

Make the quote/plan service-catalog LOAD and SEED vertical-aware, so a pressure
build's quote editor is fed its `surface_pricing` rows (not the empty lawn
`catalog_items`). 1c was split (user decision): **1c-1 = the data-source seam
(this slice)**; **1c-2 = the pressure Settings surface-pricing editor (next)**.

## Problem (from the catalog machinery audit)

Every quote/plan catalog consumer hardcodes `catalog_items`:
- `QuoteForm.tsx:100-114` and `NewPlan.tsx:120-134` — identical query
  (`["catalog","service",user?.id]`; `.from("catalog_items").eq("app",APP_ID)
  .eq("kind",vertical.catalog.serviceKind).eq("archived",false).order("sort_order")`),
  feeding `vertical.quoteLine.LineEditor`'s `catalog` prop.
- `onboarding/seedCatalog.ts:13-36` — `rpc(seedRpcName)` then fallback insert of
  `vertical.catalog.defaultSeed` into `catalog_items`.

Pressure's quote catalog is `surface_pricing` (**7 rows** per user — one per
surface at its recommended mode, per PressurePro's `DEFAULT_SURFACES`; live count
84 = 7 × 12 users; the table has `UNIQUE(user_id, surface_type, mode)` so a second
mode row is possible but not seeded). Columns: `surface_type, mode, unit,
default_rate, min_charge, user_id`; **no `app` column**, user-scoped. Pressure's
1b `LineEditor` matches rates by `catalog.find(c => c.surface_type === surface &&
c.mode === mode)` and adds surfaces at their recommended mode, so the seeded
row is found. The live signup trigger (`handle_new_user`) already seeds
`surface_pricing` for new users (confirmed 1a).

## Design

**Add two methods to `CatalogModule`** (`src/verticals/catalog.ts`) — the vertical
owns its data access; consumers stop hardcoding the table:

```ts
import type { CatalogItem } from "./quote-line";

export interface CatalogModule {
  // ...existing fields unchanged (serviceKind, defaultUnit, defaultSeed,
  //    seedRpcName, copy)...
  /** Load this vertical's billable services for the quote/plan line editor. */
  loadServiceCatalog(userId: string, appId: string): Promise<CatalogItem[]>;
  /** Idempotently seed this vertical's starter catalog for a user. */
  seed(userId: string, appId: string): Promise<void>;
}
```

`appId` is passed IN by callers (never imported inside a vertical module — avoids
the app-context → vertical circular-import hazard). Pressure ignores `appId`
(`surface_pricing` has no `app` column). `CatalogItem` = the quote-line seam's
view type `{ id; name; default_rate; surface_type?; mode? }`.

**Widen `CatalogSeedItem`** (same file) with optional pressure fields:

```ts
export interface CatalogSeedItem {
  name: string; default_rate: number; min_charge: number; unit: PricingUnit; sort_order: number;
  surface_type?: string; // pressure: SurfaceKey
  mode?: string;         // pressure: "soft" | "power"
}
```

**New shared hook `src/hooks/useServiceCatalog.ts`** (mirrors
`useSubscriptionStatus.ts` placement):

```ts
export function useServiceCatalog() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["catalog", "service", user?.id], // unchanged key → lawn cache behavior identical
    enabled: !!user?.id,
    queryFn: () => vertical.catalog.loadServiceCatalog(user!.id, APP_ID),
  });
}
```

**Lawn impl** (`src/verticals/lawn/catalog.ts`) — `loadServiceCatalog` reproduces
the EXACT current query (`catalog_items`, `app`, `kind: serviceKind`, `archived:
false`, order `sort_order`) → returns rows as `CatalogItem[]`; `seed` ports
`seedCatalog.ts`'s current logic verbatim (`rpc(seedRpcName)` then fallback insert
of `defaultSeed` into `catalog_items` stamping `app`/`kind`). Imports `supabase`
from `@/integrations/supabase/client` (no cycle — client imports no vertical).
Behavior-identical for lawn.

**Pressure impl** (`src/verticals/pressure/catalog.ts`, NEW) — `pressureCatalog:
CatalogModule`:
- `loadServiceCatalog(userId)`: `supabase.from("surface_pricing").select("*")
  .eq("user_id", userId).order("surface_type")` → map each row via a pure,
  exported `surfaceRowToCatalogItem(row) → CatalogItem`
  (`{ id, name: `${SURFACE_LABEL[surface_type]} (${mode})`, default_rate,
  surface_type, mode }`). A small local `SURFACE_LABEL` map (7 entries).
- `seed(userId)`: idempotent — if `surface_pricing` rows exist for the user,
  return; else insert the 7 `defaultSeed` surfaces (as `surface_pricing` Insert
  rows: `user_id, surface_type, mode, unit, default_rate, min_charge`) with
  `upsert(..., { onConflict: "user_id,surface_type,mode", ignoreDuplicates: true })`.
  Mirrors PressurePro's `seedDefaultSurfaceCatalog` (belt-and-suspenders behind
  the live trigger). Ignores `appId`.
- Declarative fields: `serviceKind: "service"`, `defaultUnit: "sqft"`,
  `seedRpcName: ""` (unused; pressure seeds directly), `defaultSeed`: the 7
  surface rows (each with `surface_type`+`mode`; `sort_order` sequential),
  `copy`: pressure strings (`editorDescription` "Your per-surface wash rates…",
  `emptyStateHint`, `seedButtonLabel "Seed default surface pricing"`). These
  feed 1c-2's editor.

The 7 `defaultSeed` surfaces (verbatim from PressurePro `DEFAULT_SURFACES`, one
row per surface at its recommended mode):
concrete/power 0.20/min 150/sqft, siding/soft 0.15/200/sqft, roof/soft
0.40/350/sqft, deck/soft 1.50/200/sqft, fence/soft 3.00/150/linear_ft,
driveway/power 0.18/150/sqft, house/soft 0.25/250/sqft.

**Register `pressureCatalog`** — NOT here (register-last, 1e). `pressureVertical`
does not yet exist, so `pressureCatalog` is authored + tested but unreferenced.

**Consumer migration** (behavior-identical for lawn):
- `QuoteForm.tsx`: replace the inline catalog `useQuery` with
  `const { data: catalog } = useServiceCatalog();`.
- `NewPlan.tsx`: same replacement.
- `onboarding/seedCatalog.ts`: `seedDefaultCatalog(userId)` delegates to
  `vertical.catalog.seed(userId, APP_ID)` (keeps the public function name its
  callers — Onboarding, CatalogEditor — use).
- `InvoiceDetail.tsx` is LEFT as-is (its minimal `id,name,default_rate` query by
  name-order is an edge invoice→plan picker; for pressure it reads empty
  `catalog_items` — a minor gap noted for later, not this slice).

## Testing

`src/verticals/pressure/catalog.test.ts`:
- `pressureCatalog.defaultSeed` has 7 items; every item has `surface_type`,
  `mode ∈ {soft,power}`, numeric `default_rate`/`min_charge`, a `unit`; all 7
  surface_types present (concrete/siding/roof/deck/fence/driveway/house); fence
  is `linear_ft`, the rest `sqft`.
- `surfaceRowToCatalogItem`: maps `{ id:"r1", surface_type:"roof", mode:"soft",
  default_rate:0.4, min_charge:350, unit:"sqft", user_id:"u" }` →
  `{ id:"r1", name:"Roof (soft)", default_rate:0.4, surface_type:"roof",
  mode:"soft" }`.
- `serviceKind`/`defaultUnit`/`copy.seedButtonLabel` present.

`src/verticals/lawn/catalog.test.ts`: UNCHANGED — still green (only asserts
declarative fields, which are untouched).

Load/seed DB queries are NOT unit-tested (would require supabase mocking, a
pattern this repo's vertical tests avoid); they are exercised at the 1e boot
smoke-test. A pure mapper (`surfaceRowToCatalogItem`) is the tested unit.

## Testing gates

- `npx tsc --noEmit -p tsconfig.app.json` stays at the known 6-file baseline (no
  NEW file; `QuoteForm.tsx`/`NewPlan.tsx`/`seedCatalog.ts`/`catalog.ts`/lawn+
  pressure catalog are clean).
- `npm run build` (lawn) green. Full vitest suite green.

## Out of scope (1c-1)

- Pressure Settings surface-pricing editor (1c-2).
- Registering `pressureVertical` (1e).
- `InvoiceDetail` catalog query (minor edge gap, later).
- Pressure chemicals via `catalog_items`/`CatalogManager` (separate; not the quote
  service catalog).
- `seasonalRate` (deferred, 1b).
- Any lawn behavior change.
