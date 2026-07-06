# Catalog Config Seam (Phase 0c-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `vertical.catalog` config module that owns the catalog seed items, the service `kind`, the default unit, and the editor copy — unifying the 5 hardcoded kind sites and DRYing the 22-item seed from 3 client copies to 1.

**Architecture:** New `src/verticals/catalog.ts` contract; `src/verticals/lawn/catalog.ts` implements it (holds `LAWN_CATALOG_SEED` + `lawnCatalog`); the shared `seedCatalog.ts` becomes a generic `seedDefaultCatalog` reading the active vertical; `CatalogEditor`/`QuoteForm`/`NewPlan`/`InvoiceDetail` read `vertical.catalog.serviceKind`; `catalogKindFilter` is removed from `QuoteLineModule`.

**Tech Stack:** React + TypeScript + Vite + @tanstack/react-query + Supabase + vitest.

## Global Constraints

- **Phase 0c-2** of the multi-vertical platform (spec: `2026-07-06-catalog-config-seam-design.md`).
- **Behavior-identical for TurfPro:** same 22 seed items, same editor, same catalog queries/results. This is a config relocation, not a redesign.
- **Preserve seeding behavior exactly:** RPC-first (`seedRpcName`) then client-insert fallback of `defaultSeed`. Same control flow, same error handling, same `Promise<void>` return.
- **Ordering:** `catalogKindFilter` is removed from `QuoteLineModule` LAST (Task 4), after its only consumer (`QuoteForm`) switches to `vertical.catalog.serviceKind`. Never leave a task with a red tsc/build.
- Verify tsc with the STRICT app config: `npx tsc --noEmit -p tsconfig.app.json`. There is a KNOWN PRE-EXISTING baseline of errors in 6 UNRELATED files — `src/components/campaigns/AudienceStep.tsx`, `src/components/campaigns/templates.ts`, `src/components/settings/BusinessProfile.tsx`, `src/lib/iap.ts`, `src/pages/Campaigns.tsx`, `src/pages/Onboarding.tsx`. Success = the error set stays EXACTLY that baseline (no NEW file). NOTE: `Onboarding.tsx` is in the baseline — after Task 2's rename it must not gain any NEW error beyond its pre-existing ones (compare error text if unsure).
- Tests: `npm test -- --run`. Build: `npm run build`.
- Base branch: `feature/catalog-config-seam` (spec committed there). Commit trailers on every commit:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` /
  `Claude-Session: https://claude.ai/code/session_01QrF17kQNQsTPBTHee6C3br`.

---

### Task 1: The `catalog` contract + lawn impl + registration + tests

**Files:**
- Create: `src/verticals/catalog.ts`
- Create: `src/verticals/lawn/catalog.ts`
- Create (test): `src/verticals/lawn/catalog.test.ts`
- Modify: `src/verticals/types.ts` (add `catalog` to `Vertical`)
- Modify: `src/verticals/lawn/index.ts` (register `catalog`)

**Interfaces:**
- Produces (used by Tasks 2–4): `CatalogModule`, `CatalogSeedItem`, `PricingUnit`, `CatalogKind` (`@/verticals/catalog`); `lawnCatalog`, `LAWN_CATALOG_SEED` (`@/verticals/lawn/catalog`); `vertical.catalog` (via `@/vertical`).

- [ ] **Step 1: Create the contract**

Create `src/verticals/catalog.ts`:

```ts
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
```

- [ ] **Step 2: Add `catalog` to the `Vertical` contract**

In `src/verticals/types.ts`, add the import and the field. After the existing `import type { QuoteLineModule } from "./quote-line";`, add:
```ts
import type { CatalogModule } from "./catalog";
```
and inside `interface Vertical { … }`, after `quoteLine: QuoteLineModule;`, add:
```ts
  catalog: CatalogModule;
```

- [ ] **Step 3: Write the lawn catalog test (TDD)**

Create `src/verticals/lawn/catalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { lawnCatalog } from "@/verticals/lawn/catalog";

describe("lawnCatalog", () => {
  it("serves the 'service' kind and defaults to the flat unit", () => {
    expect(lawnCatalog.serviceKind).toBe("service");
    expect(lawnCatalog.defaultUnit).toBe("flat");
  });
  it("names the seed RPC and the seed button", () => {
    expect(lawnCatalog.seedRpcName).toBe("seed_default_lawn_catalog");
    expect(lawnCatalog.copy.seedButtonLabel).toBe("Seed default lawn catalog");
  });
  it("carries all 22 starter items, each well-formed", () => {
    expect(lawnCatalog.defaultSeed).toHaveLength(22);
    for (const item of lawnCatalog.defaultSeed) {
      expect(item.name.trim().length).toBeGreaterThan(0);
      expect(typeof item.default_rate).toBe("number");
      expect(typeof item.min_charge).toBe("number");
      expect(["flat", "sqft", "linear_ft"]).toContain(item.unit);
      expect(typeof item.sort_order).toBe("number");
    }
  });
  it("lists seed items in strictly ascending sort_order", () => {
    const orders = lawnCatalog.defaultSeed.map((i) => i.sort_order);
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThan(orders[i - 1]);
    }
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- --run catalog`
Expected: FAIL — `@/verticals/lawn/catalog` does not exist yet.

- [ ] **Step 5: Implement the lawn catalog module**

Create `src/verticals/lawn/catalog.ts` (the seed array is relocated verbatim from `src/components/onboarding/seedCatalog.ts`; the copy strings are the exact text currently in `CatalogEditor.tsx`):

```ts
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
};
```

- [ ] **Step 6: Register `catalog` on the lawn vertical**

In `src/verticals/lawn/index.ts`, add the import and the field:
```ts
import { lawnCatalog } from "./catalog";
```
and inside `lawnVertical`, after `quoteLine: lawnQuoteLine,`, add:
```ts
  catalog: lawnCatalog,
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- --run catalog`
Expected: PASS — all `lawnCatalog` cases green.

- [ ] **Step 8: Typecheck, build, full suite**

Run: `npx tsc --noEmit -p tsconfig.app.json` (error set == the 6-file baseline, no NEW file — `Vertical` now requires `catalog` and `lawnVertical` provides it), then `npm run build` (succeeds), then `npm test -- --run` (green).

- [ ] **Step 9: Commit**

```bash
git add src/verticals/catalog.ts src/verticals/lawn/catalog.ts src/verticals/lawn/catalog.test.ts src/verticals/types.ts src/verticals/lawn/index.ts
git commit -m "feat(platform): add vertical.catalog config module (lawn impl + seed)"
```

---

### Task 2: DRY the seed — generic `seedDefaultCatalog` + Onboarding rename

**Files:**
- Modify: `src/components/onboarding/seedCatalog.ts`
- Modify: `src/pages/Onboarding.tsx`

**Interfaces:**
- Consumes: `vertical.catalog` (`defaultSeed`, `serviceKind`, `seedRpcName`).
- Produces (used by Task 3): `seedDefaultCatalog(userId: string): Promise<void>`.

- [ ] **Step 1: Rewrite `seedCatalog.ts` to read the active vertical**

Replace the entire contents of `src/components/onboarding/seedCatalog.ts` with:

```ts
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
```

(Note: `LAWN_CATALOG_SEED` is intentionally gone from this file — it now lives in `@/verticals/lawn/catalog`. Confirm nothing else imports it from here: `grep -rn "from \"@/components/onboarding/seedCatalog\"" src` should show only imports of the seed FUNCTION.)

- [ ] **Step 2: Update the Onboarding import + call site**

In `src/pages/Onboarding.tsx`:
- Change the import `import { seedDefaultLawnCatalog } from "@/components/onboarding/seedCatalog";` to `import { seedDefaultCatalog } from "@/components/onboarding/seedCatalog";`.
- Change the call `await seedDefaultLawnCatalog(user.id);` to `await seedDefaultCatalog(user.id);`.

- [ ] **Step 3: Typecheck, build, test**

Run: `npx tsc --noEmit -p tsconfig.app.json`. Expected: error set == the 6-file baseline. IMPORTANT: `Onboarding.tsx` is already in the baseline — confirm it has no NEW error introduced by the rename (its pre-existing errors are unrelated to the seed call). Then `npm run build` (succeeds), `npm test -- --run` (green).

- [ ] **Step 4: Commit**

```bash
git add src/components/onboarding/seedCatalog.ts src/pages/Onboarding.tsx
git commit -m "feat(platform): seedDefaultCatalog reads vertical.catalog (DRY the seed)"
```

---

### Task 3: CatalogEditor reads `vertical.catalog` (kind, copy, defaultUnit, shared seed)

**Files:**
- Modify: `src/components/settings/CatalogEditor.tsx`

**Interfaces:**
- Consumes: `vertical.catalog` (`serviceKind`, `defaultUnit`, `copy.*`); `seedDefaultCatalog` (`@/components/onboarding/seedCatalog`).

- [ ] **Step 1: Swap imports + delete the inlined seed copy**

In `src/components/settings/CatalogEditor.tsx`:
- Add imports:
  ```ts
  import { vertical } from "@/vertical";
  import { seedDefaultCatalog } from "@/components/onboarding/seedCatalog";
  ```
- DELETE the local `const LAWN_CATALOG_SEED: ReadonlyArray<…> = [ … ];` block (the 22-item array and its leading comment). Keep `UNIT_LABEL`, `fmtUSD`, the `CatalogRow`/`CatalogInsert`/`PricingUnit` type aliases, and `APP_ID` (still used by the add-item insert).

- [ ] **Step 2: Use the vertical's `serviceKind` in the query + insert**

- In the list query, change `.eq("kind", "service")` to `.eq("kind", vertical.catalog.serviceKind)`.
- In `addMutation`'s `payload`, change `kind: "service",` to `kind: vertical.catalog.serviceKind,`.

- [ ] **Step 3: Delegate seeding to the shared function**

Replace the `seedMutation` `mutationFn` body (the inline RPC-try + client-insert fallback) so it calls the shared function:

```tsx
  const seedMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      await seedDefaultCatalog(user.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
```

- [ ] **Step 4: Verticalize the copy**

- Replace the description paragraph text (`Lawn services you offer. Default rate and minimum charge prefill new plans &amp; quotes.`) with `{vertical.catalog.copy.editorDescription}`.
- Replace the empty-state hint text (`Get started with the canonical lawn-care services (weekly mow, fert steps, cleanups, snow). You can edit any of them after.`) with `{vertical.catalog.copy.emptyStateHint}`.
- Replace the seed button label text `Seed default lawn catalog` with `{vertical.catalog.copy.seedButtonLabel}`.

- [ ] **Step 5: Default the new-item unit from the vertical**

`NewItemForm` currently hardcodes `useState<PricingUnit>("flat")`. Thread the default through a prop:
- In `NewItemForm`'s props type, add `defaultUnit: PricingUnit;`.
- Change its state init to `const [unit, setUnit] = useState<PricingUnit>(defaultUnit);` and add `defaultUnit` to the destructured params.
- At the `<NewItemForm … />` render site, pass `defaultUnit={vertical.catalog.defaultUnit}`.

The `EditItemForm` unit state (`useState<PricingUnit>(item.unit ?? "flat")`) stays — editing an existing item reflects that row's stored unit, not the vertical default.

- [ ] **Step 6: Typecheck, build, test**

Run: `npx tsc --noEmit -p tsconfig.app.json` (error set == baseline; `CatalogEditor.tsx` must NOT appear), then `npm run build` (succeeds), then `npm test -- --run` (green).

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/CatalogEditor.tsx
git commit -m "feat(platform): CatalogEditor reads vertical.catalog for kind/copy/unit/seed"
```

---

### Task 4: Unify remaining kind sites + remove `catalogKindFilter`

**Files:**
- Modify: `src/components/quotes/QuoteForm.tsx`
- Modify: `src/pages/NewPlan.tsx`
- Modify: `src/pages/InvoiceDetail.tsx`
- Modify: `src/verticals/quote-line.ts` (remove `catalogKindFilter` from `QuoteLineModule`)
- Modify: `src/verticals/lawn/quote-line.tsx` (remove `catalogKindFilter` from `lawnQuoteLine`)
- Modify (test): `src/verticals/lawn/quote-line.test.ts` (remove the `catalogKindFilter` assertion)

**Interfaces:**
- Consumes: `vertical.catalog.serviceKind`.

- [ ] **Step 1: QuoteForm reads `vertical.catalog.serviceKind`**

In `src/components/quotes/QuoteForm.tsx`, change the catalog query line
```tsx
        .eq("kind", vertical.quoteLine.catalogKindFilter as CatalogItem["kind"])
```
to
```tsx
        .eq("kind", vertical.catalog.serviceKind)
```
(No cast needed — `serviceKind` is typed `CatalogKind`, exactly the column's enum. `vertical` is already imported.)

- [ ] **Step 2: NewPlan reads `vertical.catalog.serviceKind`**

In `src/pages/NewPlan.tsx`:
- Add `import { vertical } from "@/vertical";` (alongside the existing imports).
- Change the catalog query `.eq("kind", "service")` to `.eq("kind", vertical.catalog.serviceKind)`.

- [ ] **Step 3: InvoiceDetail reads `vertical.catalog.serviceKind`**

In `src/pages/InvoiceDetail.tsx`:
- Add `import { vertical } from "@/vertical";` (alongside the existing imports).
- Change the catalog query `.eq("kind", "service")` to `.eq("kind", vertical.catalog.serviceKind)`.

- [ ] **Step 4: Remove `catalogKindFilter` from the contract + lawn impl**

- In `src/verticals/quote-line.ts`, delete the `catalogKindFilter` member and its doc comment from `interface QuoteLineModule` (the lines:
  ```ts
    /** The `kind` value this vertical's services use in the catalog_items query. */
    catalogKindFilter: string;
  ```
  ).
- In `src/verticals/lawn/quote-line.tsx`, delete the `catalogKindFilter: "service",` line from the `lawnQuoteLine` object literal.

- [ ] **Step 5: Remove the stale `catalogKindFilter` test**

In `src/verticals/lawn/quote-line.test.ts`, delete the test block:
```ts
  it("catalogKindFilter is 'service'", () => {
    expect(lawnQuoteLine.catalogKindFilter).toBe("service");
  });
```

- [ ] **Step 6: Typecheck (enforcement), build, test**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: error set == the 6-file baseline, no NEW file. In particular, no `QuoteForm`/`NewPlan`/`InvoiceDetail`/`quote-line` file appears — if one does, a `catalogKindFilter` reference was missed (grep `catalogKindFilter` across `src` should return ZERO hits after this task). Then `npm run build` (succeeds) and `npm test -- --run` (full suite green — the quote-line suite drops the removed assertion but all others pass).

- [ ] **Step 7: Commit**

```bash
git add src/components/quotes/QuoteForm.tsx src/pages/NewPlan.tsx src/pages/InvoiceDetail.tsx src/verticals/quote-line.ts src/verticals/lawn/quote-line.tsx src/verticals/lawn/quote-line.test.ts
git commit -m "feat(platform): unify catalog kind on vertical.catalog.serviceKind; drop catalogKindFilter"
```

---

## Human verification (deferred — after deploy)

Not an implementer task (needs the running app):
- **Onboarding** step 3 seeds the 22 lawn services into the catalog.
- **Settings → Service catalog:** with an empty catalog, the "Seed default lawn catalog" button seeds the 22 items; the description + empty-state copy read correctly; adding a new custom item defaults its unit to `flat`; editing an item preserves its stored unit.
- **Quote / Plan / Invoice** catalog pickers still list the service catalog items.

## Notes for the implementer

- Behavior-identical: the seed list, editor, and all catalog queries produce the same results for TurfPro. If a catalog list renders differently or the seed inserts different rows, something changed — stop and report.
- The 22-item `LAWN_CATALOG_SEED` in `verticals/lawn/catalog.ts` must match the old arrays byte-for-byte (same names, rates, min_charges, sort_orders, all `unit: "flat"`).
- `vertical.catalog.serviceKind` is typed `CatalogKind` (the `catalog_items.kind` enum), so `.eq("kind", vertical.catalog.serviceKind)` needs no cast — unlike the old `catalogKindFilter: string` which required `as CatalogItem["kind"]`.
- Leave each catalog query's react-query `queryKey` as-is (e.g. `["catalog", "service", …]`) — the literal is harmless and out of scope; `serviceKind` is a build-time constant equal to `"service"` for lawn.
- After Task 4, `grep -rn catalogKindFilter src` must return nothing.
- Task 1 adds a REQUIRED `catalog` field to the `Vertical` interface. There is an existing `src/verticals/*.test.ts` conformance test — the full-suite run in Task 1 Step 8 will catch any break. If that test enumerates required fields (rather than just checking `brand`/`id`), add a `catalog` assertion there; if it just imports `lawnVertical` and checks a few fields, it needs no change (an extra field is fine).
