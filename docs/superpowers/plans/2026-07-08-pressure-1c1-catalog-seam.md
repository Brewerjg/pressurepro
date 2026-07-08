# Phase 1 slice 1c-1 (pressure catalog data-source seam) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the quote/plan service-catalog LOAD + SEED vertical-aware (`CatalogModule.loadServiceCatalog` + `seed`, a shared `useServiceCatalog` hook), add `pressureCatalog` (maps `surface_pricing` → the shared `CatalogItem`), and migrate `QuoteForm`/`NewPlan` — all behavior-identical for lawn.

**Architecture:** The vertical owns its catalog data access via two new `CatalogModule` methods that take `appId` as a parameter (never imported inside a vertical module — avoids the app-context→vertical circular-import hazard). A shared hook delegates to the active vertical. `pressureCatalog` is authored + tested but NOT registered (register-last, 1e).

**Tech Stack:** React + TypeScript, @tanstack/react-query, Supabase, vitest.

## Global Constraints

- **tsc gate:** `npx tsc --noEmit -p tsconfig.app.json` (NOT root). Baseline = exactly 6 files: `AudienceStep.tsx`, `campaigns/templates.ts`, `BusinessProfile.tsx`, `iap.ts`, `Campaigns.tsx`, `Onboarding.tsx`. Gate = no NEW file. **`QuoteForm.tsx`/`NewPlan.tsx` must NOT become new errors** — after migrating, remove any import/type-alias that becomes unused (`noUnusedLocals` is on).
- **Behavior-identical for lawn:** lawn's `loadServiceCatalog`/`seed` reproduce the current queries EXACTLY; `useServiceCatalog` keeps the query key `["catalog","service",user?.id]`.
- **No vertical module imports `APP_ID`** (cycle risk). `appId` is passed in by callers (the hook, `seedCatalog`).
- **Commit trailers on every commit:**
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QrF17kQNQsTPBTHee6C3br
  ```
- Full vitest suite green; `npm run build` succeeds.

---

### Task 1: contract methods + lawn impl + shared hook + seed delegation

**Files:**
- Modify: `src/verticals/catalog.ts` (widen `CatalogSeedItem`; add 2 methods to `CatalogModule`)
- Modify: `src/verticals/lawn/catalog.ts` (implement `loadServiceCatalog` + `seed`)
- Create: `src/hooks/useServiceCatalog.ts`
- Modify: `src/components/onboarding/seedCatalog.ts` (delegate to `vertical.catalog.seed`)
- Test: `src/verticals/lawn/catalog.test.ts` (add conformance for the 2 methods)

**Interfaces:**
- Produces: `CatalogModule.loadServiceCatalog(userId: string, appId: string): Promise<CatalogItem[]>` and `CatalogModule.seed(userId: string, appId: string): Promise<void>` (CatalogItem from `@/verticals/quote-line`); `useServiceCatalog()` returning a react-query result of `CatalogItem[]`.

- [ ] **Step 1: Extend the contract**

In `src/verticals/catalog.ts`, add the import and widen/extend:

```ts
import type { CatalogItem } from "./quote-line";
```

Widen `CatalogSeedItem` (add two optional fields after `sort_order`):

```ts
export interface CatalogSeedItem {
  name: string;
  default_rate: number;
  min_charge: number;
  unit: PricingUnit;
  sort_order: number;
  surface_type?: string; // pressure: SurfaceKey (e.g. "roof")
  mode?: string;         // pressure: "soft" | "power"
}
```

Add two methods to `CatalogModule` (after `copy`):

```ts
  /** Load this vertical's billable services for the quote/plan line editor. */
  loadServiceCatalog(userId: string, appId: string): Promise<CatalogItem[]>;
  /** Idempotently seed this vertical's starter catalog for a user. */
  seed(userId: string, appId: string): Promise<void>;
```

- [ ] **Step 2: Implement on the lawn vertical**

In `src/verticals/lawn/catalog.ts`, add imports at top:

```ts
import { supabase } from "@/integrations/supabase/client";
import type { CatalogItem } from "@/verticals/quote-line";
import type { Database } from "@/integrations/supabase/types";
```

Add these two functions above the `lawnCatalog` export (they reproduce the current `QuoteForm`/`seedCatalog` behavior verbatim):

```ts
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
```

Add the two methods to the `lawnCatalog` object (after `copy: {...}`):

```ts
  loadServiceCatalog: lawnLoadServiceCatalog,
  seed: lawnSeed,
```

- [ ] **Step 3: Create the shared hook**

Create `src/hooks/useServiceCatalog.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { APP_ID } from "@/lib/app-context";
import { vertical } from "@/vertical";
import type { CatalogItem } from "@/verticals/quote-line";

/** Vertical-aware service catalog for the quote/plan line editor.
 *  Lawn → catalog_items; pressure → surface_pricing. */
export function useServiceCatalog() {
  const { user } = useAuth();
  return useQuery<CatalogItem[]>({
    queryKey: ["catalog", "service", user?.id],
    enabled: !!user?.id,
    queryFn: () => vertical.catalog.loadServiceCatalog(user!.id, APP_ID),
  });
}
```

- [ ] **Step 4: Delegate the seed**

Replace the body of `src/components/onboarding/seedCatalog.ts` entirely with:

```ts
import { APP_ID } from "@/lib/app-context";
import { vertical } from "@/vertical";

// Seeds the active vertical's starter catalog. The trade-specific data access
// (table, RPC, idempotency) lives in vertical.catalog.seed.
export async function seedDefaultCatalog(userId: string): Promise<void> {
  await vertical.catalog.seed(userId, APP_ID);
}
```

- [ ] **Step 5: Add lawn-catalog conformance test**

Append to `src/verticals/lawn/catalog.test.ts` (inside the `describe`):

```ts
  it("exposes vertical-aware data-access methods", () => {
    expect(typeof lawnCatalog.loadServiceCatalog).toBe("function");
    expect(typeof lawnCatalog.seed).toBe("function");
  });
```

- [ ] **Step 6: Verify gates**

Run: `npx vitest run src/verticals/lawn/catalog.test.ts` → PASS (existing + new case).
Run: `npx tsc --noEmit -p tsconfig.app.json` → error set unchanged (6 baseline files; `catalog.ts`/`lawn/catalog.ts`/`useServiceCatalog.ts`/`seedCatalog.ts` clean).
Run: `npx vitest run` → full suite green.

- [ ] **Step 7: Commit**

```bash
git add src/verticals/catalog.ts src/verticals/lawn/catalog.ts src/verticals/lawn/catalog.test.ts src/hooks/useServiceCatalog.ts src/components/onboarding/seedCatalog.ts
git commit
```
(`feat(platform): vertical-aware catalog load+seed (CatalogModule methods + useServiceCatalog)` + trailers.)

---

### Task 2: pressure catalog module + tests

**Files:**
- Create: `src/verticals/pressure/catalog.ts`
- Test: `src/verticals/pressure/catalog.test.ts`

**Interfaces:**
- Consumes: `CatalogModule`, `CatalogSeedItem` from `@/verticals/catalog`; `CatalogItem` from `@/verticals/quote-line`; `supabase`; `Database` types.
- Produces: `export const pressureCatalog: CatalogModule` and `export function surfaceRowToCatalogItem(row): CatalogItem` (consumed by 1e assembly + 1c-2 editor).

- [ ] **Step 1: Write the failing test**

Create `src/verticals/pressure/catalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pressureCatalog, surfaceRowToCatalogItem } from "./catalog";

describe("pressureCatalog", () => {
  it("seeds all 7 surfaces, one row each, well-formed", () => {
    expect(pressureCatalog.defaultSeed).toHaveLength(7);
    const surfaces = pressureCatalog.defaultSeed.map((s) => s.surface_type).sort();
    expect(surfaces).toEqual(
      ["concrete", "deck", "driveway", "fence", "house", "roof", "siding"],
    );
    for (const item of pressureCatalog.defaultSeed) {
      expect(["soft", "power"]).toContain(item.mode);
      expect(typeof item.default_rate).toBe("number");
      expect(typeof item.min_charge).toBe("number");
      expect(["sqft", "linear_ft", "flat"]).toContain(item.unit);
    }
  });

  it("prices fence per linear_ft and the rest per sqft", () => {
    const fence = pressureCatalog.defaultSeed.find((s) => s.surface_type === "fence");
    expect(fence?.unit).toBe("linear_ft");
    const roof = pressureCatalog.defaultSeed.find((s) => s.surface_type === "roof");
    expect(roof).toMatchObject({ mode: "soft", default_rate: 0.4, min_charge: 350, unit: "sqft" });
  });

  it("maps a surface_pricing row to the shared CatalogItem", () => {
    const item = surfaceRowToCatalogItem({
      id: "r1", surface_type: "roof", mode: "soft", default_rate: 0.4,
      min_charge: 350, unit: "sqft", user_id: "u", created_at: "", updated_at: "",
    });
    expect(item).toEqual({
      id: "r1", name: "Roof (soft)", default_rate: 0.4, surface_type: "roof", mode: "soft",
    });
  });

  it("declares serviceKind, defaultUnit, and seed copy", () => {
    expect(pressureCatalog.serviceKind).toBe("service");
    expect(pressureCatalog.defaultUnit).toBe("sqft");
    expect(pressureCatalog.copy.seedButtonLabel).toBe("Seed default surface pricing");
    expect(typeof pressureCatalog.loadServiceCatalog).toBe("function");
    expect(typeof pressureCatalog.seed).toBe("function");
  });
});
```

- [ ] **Step 2: Run test → fail**

Run: `npx vitest run src/verticals/pressure/catalog.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the module**

Create `src/verticals/pressure/catalog.ts`:

```ts
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
```

- [ ] **Step 4: Run test → pass**

Run: `npx vitest run src/verticals/pressure/catalog.test.ts` → PASS.

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit -p tsconfig.app.json` → 6-file baseline, no new file.
Run: `npx vitest run` → full suite green.

- [ ] **Step 6: Commit**

```bash
git add src/verticals/pressure/catalog.ts src/verticals/pressure/catalog.test.ts
git commit
```
(`feat(platform): pressureCatalog (surface_pricing load/seed + row mapper)` + trailers.)

---

### Task 3: migrate QuoteForm + NewPlan to the shared hook

**Files:**
- Modify: `src/components/quotes/QuoteForm.tsx`
- Modify: `src/pages/NewPlan.tsx`

**Interfaces:**
- Consumes: `useServiceCatalog` from `@/hooks/useServiceCatalog` (Task 1).

- [ ] **Step 1: QuoteForm**

Add import: `import { useServiceCatalog } from "@/hooks/useServiceCatalog";`

Replace the catalog `useQuery` block (the `// Catalog (services only)` comment + the `const { data: catalog } = useQuery({ queryKey: ["catalog","service",...], ... })`) with:

```tsx
  // Catalog (services only) — vertical-aware (lawn: catalog_items; pressure: surface_pricing)
  const { data: catalog } = useServiceCatalog();
```

`catalog` is passed only to `<vertical.quoteLine.LineEditor ... catalog={catalog ?? []} />`, which expects `CatalogItem[]` — no other change. Then DELETE the now-unused local `type CatalogItem = Database["public"]["Tables"]["catalog_items"]["Row"];` alias. Run tsc; if `APP_ID` (or any other) import is now unused in this file, remove it too.

- [ ] **Step 2: NewPlan**

Add import: `import { useServiceCatalog } from "@/hooks/useServiceCatalog";`

Replace the catalog `useQuery` block (`const { data: catalog } = useQuery({ queryKey: ["catalog","service",...], ... })`) with:

```tsx
  const { data: catalog } = useServiceCatalog();
```

`catalog` is used only at the service-chips `catalog.map((item) => …)` reading `item.name`/`item.id` — both on `CatalogItem`, no change. DELETE the now-unused `type CatalogItem = Database["public"]["Tables"]["catalog_items"]["Row"];` alias. Run tsc; remove `APP_ID` import if it is now unused in this file (check: it may still be used by the plan insert — only remove if tsc flags it unused).

- [ ] **Step 3: Gates**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: error set unchanged — the 6 baseline files ONLY. `QuoteForm.tsx` and `NewPlan.tsx` must NOT appear (verify unused imports/aliases were removed).

Run: `npx vitest run` → full suite green.
Run: `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/quotes/QuoteForm.tsx src/pages/NewPlan.tsx
git commit
```
(`refactor(platform): QuoteForm + NewPlan load catalog via useServiceCatalog` + trailers.)

---

## Self-Review notes (author)

- **Spec coverage:** contract methods + widen (Task 1); lawn impl behavior-identical (Task 1); hook (Task 1); seed delegation (Task 1); pressureCatalog + mapper + 7-surface seed (Task 2); consumer migration (Task 3). InvoiceDetail intentionally untouched (spec out-of-scope).
- **No placeholders:** full code for every file.
- **Type consistency:** `loadServiceCatalog`/`seed` signatures match across contract, lawn, pressure, and the hook; `CatalogItem` is the quote-line view type everywhere; `surfaceRowToCatalogItem` returns exactly `{id,name,default_rate,surface_type,mode}`.
- **Cycle safety:** no vertical module imports `APP_ID`; callers pass `appId`. lawn/pressure catalog import only `supabase` + types (no vertical/app-context).
- **tsc noUnusedLocals hazard** explicitly handled in Task 3 (remove the dead `CatalogItem` Row aliases + any newly-unused `APP_ID`), since `QuoteForm`/`NewPlan` are not in the baseline and must stay clean.
- **Lawn behavior identical:** lawn loader/seed reproduce the exact prior queries; hook keeps the same query key.
