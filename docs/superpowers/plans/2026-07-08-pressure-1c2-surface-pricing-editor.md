# Phase 1 slice 1c-2 (pressure Settings surface-pricing editor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Settings "Service catalog" slot vertical-aware — add a lazy `CatalogModule.SettingsEditor`, ship a pressure `SurfacePricingEditor` (pricing matrix over `surface_pricing`), and render `vertical.catalog.SettingsEditor` from `Settings.tsx`. Lawn keeps its editor (now lazy-loaded).

**Architecture:** Task ordering avoids a mid-slice tsc break — the pressure editor component is created first (Task 1, unreferenced), then Task 2 adds the required `SettingsEditor` contract field and wires BOTH `lawnCatalog` and `pressureCatalog` in the same commit (so both satisfy `CatalogModule` at once). `SettingsEditor` is a `React.lazy` component: editors import `vertical`, so a direct reference from a vertical module would cycle (`registry → lawn/index → lawn/catalog → editor → vertical`); lazy defers the import past module-init (the 0c-3 pattern).

**Tech Stack:** React (+ `lazy`/`Suspense`), @tanstack/react-query, Supabase, vitest.

## Global Constraints

- **tsc gate:** `npx tsc --noEmit -p tsconfig.app.json` (NOT root). Baseline = exactly 6 files: `AudienceStep.tsx`, `campaigns/templates.ts`, `BusinessProfile.tsx`, `iap.ts`, `Campaigns.tsx`, `Onboarding.tsx`. Gate = no NEW file. **`Settings.tsx` must NOT become a new error** (remove the now-unused `CatalogEditor` import).
- **Vertical-module cycle safety:** `SettingsEditor` is `lazy(() => import(...))` in `lawn/catalog.ts` and `pressure/catalog.ts` (deferred import — no load-time cycle). The pressure editor COMPONENT file (`SurfacePricingEditor.tsx`) is NOT a vertical config module, so it may import `vertical`/`APP_ID` freely.
- **Test env:** any test importing a vertical catalog/index needs `vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }))` at the top (established in 1c-1).
- **Shared classes only** (`tp-input`, `tp-card`, `text-neutral-*`, `bg-card`, `text-brand-*`) — NO `pp-*`.
- **Commit trailers on every commit:**
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QrF17kQNQsTPBTHee6C3br
  ```
- Full vitest suite green; `npm run build` succeeds.

---

### Task 1: pressure SurfacePricingEditor component

**Files:**
- Create: `src/verticals/pressure/SurfacePricingEditor.tsx`

**Interfaces:**
- Produces: `export default function SurfacePricingEditor()` — a no-props component. Consumed (lazily) by `pressureCatalog.SettingsEditor` in Task 2. Reads/writes `surface_pricing`; empty-state seed via `vertical.catalog.seed` + `copy` (from 1c-1).

- [ ] **Step 1: Create the component**

Create `src/verticals/pressure/SurfacePricingEditor.tsx`:

```tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Droplets, Zap, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { APP_ID } from "@/lib/app-context";
import { vertical } from "@/vertical";
import type { Database } from "@/integrations/supabase/types";

type SurfacePricingRow = Database["public"]["Tables"]["surface_pricing"]["Row"];
type JobMode = "soft" | "power";
type SurfaceKey = "concrete" | "siding" | "roof" | "deck" | "fence" | "driveway" | "house";

const SURFACE_META: Record<SurfaceKey, { label: string; emoji: string }> = {
  house: { label: "House Wash", emoji: "🏠" },
  siding: { label: "Siding", emoji: "🧱" },
  roof: { label: "Roof", emoji: "🛖" },
  driveway: { label: "Driveway", emoji: "🛣️" },
  concrete: { label: "Concrete", emoji: "🧊" },
  deck: { label: "Deck", emoji: "🪵" },
  fence: { label: "Fence", emoji: "🚧" },
};
const SURFACE_ORDER: SurfaceKey[] = ["house", "roof", "siding", "driveway", "concrete", "deck", "fence"];

function ModeToggle({ value, onChange }: { value: JobMode; onChange: (m: JobMode) => void }) {
  const isSoft = value === "soft";
  const btn = (active: boolean) =>
    `relative z-10 flex items-center gap-1 px-3 py-1 font-semibold rounded-full text-[12px] ${
      active ? "text-brand-800" : "text-neutral-500"
    }`;
  return (
    <div className="relative inline-flex items-center rounded-full bg-neutral-100 p-1 select-none">
      <span
        aria-hidden
        className={`absolute top-1 bottom-1 w-1/2 rounded-full bg-card shadow-card transition-transform duration-200 ${
          isSoft ? "translate-x-0" : "translate-x-full"
        }`}
      />
      <button type="button" onClick={() => onChange("soft")} className={btn(isSoft)}>
        <Droplets className="h-3.5 w-3.5" /> Soft
      </button>
      <button type="button" onClick={() => onChange("power")} className={btn(!isSoft)}>
        <Zap className="h-3.5 w-3.5" /> Power
      </button>
    </div>
  );
}

export default function SurfacePricingEditor() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [activeMode, setActiveMode] = useState<JobMode>("soft");

  const { data: rows, isLoading } = useQuery({
    queryKey: ["surface_pricing", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("surface_pricing")
        .select("*")
        .eq("user_id", user!.id)
        .order("surface_type");
      if (error) throw error;
      return (data ?? []) as SurfacePricingRow[];
    },
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: { default_rate?: number; min_charge?: number } }) => {
      const { error } = await supabase.from("surface_pricing").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["surface_pricing", user?.id] });
      qc.invalidateQueries({ queryKey: ["catalog", "service", user?.id] });
    },
  });

  const seedMut = useMutation({
    mutationFn: async () => {
      if (!user) return;
      await vertical.catalog.seed(user.id, APP_ID);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["surface_pricing", user?.id] }),
  });

  if (isLoading) {
    return (
      <div className="text-sm text-neutral-500 py-2 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div className="tp-card p-4 text-center space-y-3">
        <p className="text-sm text-neutral-500">{vertical.catalog.copy.emptyStateHint}</p>
        <button
          type="button"
          onClick={() => seedMut.mutate()}
          disabled={seedMut.isPending}
          className="h-10 px-4 rounded-xl bg-brand-800 text-white font-semibold text-sm disabled:opacity-60"
        >
          {seedMut.isPending ? "Seeding…" : vertical.catalog.copy.seedButtonLabel}
        </button>
      </div>
    );
  }

  const rowFor = (s: SurfaceKey): SurfacePricingRow | undefined =>
    rows.find((r) => r.surface_type === s && r.mode === activeMode) ??
    rows.find((r) => r.surface_type === s);

  return (
    <div className="tp-card p-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold">Pricing matrix</h3>
        <ModeToggle value={activeMode} onChange={setActiveMode} />
      </div>
      <p className="text-xs text-neutral-500 mb-3">{vertical.catalog.copy.editorDescription}</p>
      <ul className="space-y-3">
        {SURFACE_ORDER.map((s) => {
          const row = rowFor(s);
          if (!row) return null;
          const unitLabel = row.unit === "linear_ft" ? "lin ft" : row.unit === "flat" ? "flat" : "sqft";
          return (
            <li key={s} className="flex items-center gap-2">
              <span className="text-xl">{SURFACE_META[s].emoji}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold truncate">{SURFACE_META[s].label}</span>
                <span className="text-[10px] uppercase tracking-wider text-neutral-500">${"/"}{unitLabel}</span>
              </span>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">$</span>
                <input
                  key={`${row.id}-rate`}
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  defaultValue={row.default_rate}
                  onBlur={(e) => updateMut.mutate({ id: row.id, patch: { default_rate: Number(e.target.value) || 0 } })}
                  className="tp-input w-20 pl-5"
                />
              </div>
              <div className="relative">
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-neutral-500 text-[9px] font-bold">MIN</span>
                <input
                  key={`${row.id}-min`}
                  type="number"
                  step="1"
                  inputMode="numeric"
                  defaultValue={row.min_charge}
                  onBlur={(e) => updateMut.mutate({ id: row.id, patch: { min_charge: Number(e.target.value) || 0 } })}
                  className="tp-input w-20 pl-9"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Verify gates (component compiles, unreferenced)**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: error set unchanged (6 baseline; `SurfacePricingEditor.tsx` clean). It is unreferenced (that is fine — a default export imported by nothing yet).

Run: `npx vitest run` → full suite green (unchanged; nothing imports the new file).

- [ ] **Step 3: Commit**

```bash
git add src/verticals/pressure/SurfacePricingEditor.tsx
git commit
```
(`feat(platform): pressure SurfacePricingEditor (pricing matrix over surface_pricing)` + trailers.)

---

### Task 2: contract SettingsEditor + wire lawn/pressure + Settings.tsx + tests

**Files:**
- Modify: `src/verticals/catalog.ts` (add `SettingsEditor`)
- Modify: `src/verticals/lawn/catalog.ts` (lazy CatalogEditor)
- Modify: `src/verticals/pressure/catalog.ts` (lazy SurfacePricingEditor)
- Modify: `src/pages/Settings.tsx` (render `vertical.catalog.SettingsEditor` in Suspense)
- Test: `src/verticals/lawn/catalog.test.ts`, `src/verticals/pressure/catalog.test.ts` (conformance)

**Interfaces:**
- Consumes: `SurfacePricingEditor` (Task 1); the existing `CatalogEditor` component.
- Produces: `CatalogModule.SettingsEditor: LazyExoticComponent<ComponentType>`.

- [ ] **Step 1: Extend the contract**

In `src/verticals/catalog.ts`, add the import and the field:

```ts
import type { LazyExoticComponent, ComponentType } from "react";
```
```ts
  /** Settings > catalog editor for this vertical (lazy — editors import
   *  `vertical`, so a lazy ref avoids the app-context→vertical load cycle). */
  SettingsEditor: LazyExoticComponent<ComponentType>;
```

- [ ] **Step 2: Wire lawn**

In `src/verticals/lawn/catalog.ts`: add `import { lazy } from "react";` and, in the `lawnCatalog` object:

```ts
  SettingsEditor: lazy(() => import("@/components/settings/CatalogEditor")),
```
(If tsc rejects the assignment on the inferred default-export type, append `as LazyExoticComponent<ComponentType>` — import the type — but try the clean form first.)

- [ ] **Step 3: Wire pressure**

In `src/verticals/pressure/catalog.ts`: add `import { lazy } from "react";` and, in the `pressureCatalog` object:

```ts
  SettingsEditor: lazy(() => import("./SurfacePricingEditor")),
```

- [ ] **Step 4: Render from Settings**

In `src/pages/Settings.tsx`:
- Add `import { Suspense } from "react";` and `import { vertical } from "@/vertical";`
- Remove `import CatalogEditor from "@/components/settings/CatalogEditor";`
- Replace `<CatalogEditor />` (inside the `<Section … label="Service catalog">`) with:

```tsx
        <Suspense fallback={<div className="text-sm text-neutral-500 py-2">Loading…</div>}>
          <vertical.catalog.SettingsEditor />
        </Suspense>
```

- [ ] **Step 5: Conformance tests**

Append to `src/verticals/lawn/catalog.test.ts` (inside the describe):

```ts
  it("provides a Settings editor component", () => {
    expect(lawnCatalog.SettingsEditor).toBeTruthy();
  });
```

Append to `src/verticals/pressure/catalog.test.ts` (inside the describe):

```ts
  it("provides a Settings editor component", () => {
    expect(pressureCatalog.SettingsEditor).toBeTruthy();
  });
```

(Both test files already have the `vi.mock("@/integrations/supabase/client", …)` shim from 1c-1. Do NOT render the lazy component in the unit test — just assert it is defined.)

- [ ] **Step 6: Gates**

Run: `npx vitest run src/verticals/lawn/catalog.test.ts src/verticals/pressure/catalog.test.ts` → PASS.
Run: `npx tsc --noEmit -p tsconfig.app.json` → error set unchanged (6 baseline; `catalog.ts`/`lawn`+`pressure` catalog/`Settings.tsx` clean — verify `Settings.tsx` is NOT a new error, i.e. the `CatalogEditor` import was removed and `vertical`/`Suspense` are used).
Run: `npx vitest run` → full suite green.
Run: `npm run build` → succeeds (a new lazy chunk for the editor(s) is expected).

- [ ] **Step 7: Commit**

```bash
git add src/verticals/catalog.ts src/verticals/lawn/catalog.ts src/verticals/pressure/catalog.ts src/pages/Settings.tsx src/verticals/lawn/catalog.test.ts src/verticals/pressure/catalog.test.ts
git commit
```
(`feat(platform): vertical-aware Settings catalog editor (lazy SettingsEditor)` + trailers.)

---

## Self-Review notes (author)

- **Ordering** prevents a mid-slice tsc break: the component exists (Task 1) before `SettingsEditor` becomes a required field wired on both verticals (Task 2, single commit).
- **Cycle safety:** `SettingsEditor` is lazy in both vertical modules; the component file (not a config module) may import `vertical`/`APP_ID`.
- **Lawn behavior:** same `CatalogEditor`, now lazy behind Suspense — functionally identical (a deliberate code-split). Flagged for the whole-branch review.
- **No placeholders:** full component + wiring + tests. Type escape (`as LazyExoticComponent<ComponentType>`) noted only as a fallback.
- **tsc noUnusedLocals:** `Settings.tsx` (not in baseline) — the removed `CatalogEditor` import + added `vertical`/`Suspense` (both used) keep it clean.
- **Pressure editor tested only for existence** (DB/react-query/auth component — deep-render is out of scope, verified at 1e boot), consistent with `CatalogEditor` having no unit test.
