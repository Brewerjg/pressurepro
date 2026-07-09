# Phase 1 slice 1e (assemble + register + bootable pressure build) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register `pressureVertical` and make `VITE_VERTICAL=pressure npm run build` a working pressure web build. Lawn behavior identical.

**Architecture:** Assemble the existing pressure seam modules into a `Vertical`, add a shell (`/mix` + nav + home tile) and the MixCalculator, add `brand.deepLinkScheme` + de-turfpro three shared runtime sites (lawn resolves to the same values). Native config deferred to 1f.

**Tech Stack:** React + TypeScript, vitest, Vite.

## Global Constraints

- **tsc gate:** `npx tsc --noEmit -p tsconfig.app.json` (NOT root). Baseline = 6 files: `AudienceStep.tsx`, `campaigns/templates.ts`, `BusinessProfile.tsx`, `iap.ts`, `Campaigns.tsx`, `Onboarding.tsx`. Gate = no NEW file; `Auth.tsx`/`auth-deep-link.ts`/`offline-cache.ts` must NOT become new errors.
- **Lawn identity:** every de-turfpro change resolves to the current value for lawn (`vertical.brand.deepLinkScheme` = "turfpro", `vertical.id` = "turfpro", `APP_ID` = "turfpro").
- **Cycle safety:** the MixCalculator route is `lazy` in shell.tsx; vertical config modules never eager-import a page.
- **Commit trailers on every commit:**
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QrF17kQNQsTPBTHee6C3br
  ```
- Full vitest suite green; BOTH `npm run build` and `VITE_VERTICAL=pressure npm run build` succeed.

---

### Task 1: brand.deepLinkScheme + de-turfpro shared runtime

**Files:** Modify `src/verticals/types.ts`, `src/verticals/lawn/index.ts`, `src/pages/Auth.tsx`, `src/lib/auth-deep-link.ts`, `src/lib/offline-cache.ts`.

- [ ] **Step 1: Contract + lawn brand**
  - `types.ts`: add `deepLinkScheme: string;` to the `brand` object type.
  - `lawn/index.ts`: add `deepLinkScheme: "turfpro",` to lawn's `brand`.

- [ ] **Step 2: Auth.tsx**
  - Ensure `import { vertical } from "@/vertical";` is present.
  - Replace each `"turfpro://auth-callback"` (3 sites) with `` `${vertical.brand.deepLinkScheme}://auth-callback` ``.
  - The demo-email domain: replace `@turfpro.demo` with `@${vertical.id}.demo` (keep the existing local-part; only the domain changes). Locate by grepping `@turfpro.demo`.

- [ ] **Step 3: auth-deep-link.ts**
  - Import `vertical`; replace the `"turfpro://auth-callback"` literal(s) in the `startsWith(...)` check(s) with `` `${vertical.brand.deepLinkScheme}://auth-callback` ``.

- [ ] **Step 4: offline-cache.ts**
  - Import `APP_ID` from `@/lib/app-context`; replace the hardcoded key prefixes `"turfpro_pending_mutations"` → `` `${APP_ID}_pending_mutations` `` and `"turfpro_cached_route_"` → `` `${APP_ID}_cached_route_` `` (make them template literals; if a `cached_route_` key is built with a suffix, prefix `${APP_ID}_` there). For lawn `APP_ID === "turfpro"` → identical keys.

- [ ] **Step 5: Gates + commit**
  - `npx tsc --noEmit -p tsconfig.app.json` → 6-baseline; the three shared files NOT new errors.
  - `npx vitest run` → green. `npm run build` → green.
  - `git add src/verticals/types.ts src/verticals/lawn/index.ts src/pages/Auth.tsx src/lib/auth-deep-link.ts src/lib/offline-cache.ts && git commit` (`feat(platform): brand.deepLinkScheme + vertical-derived deep-link/demo-email/cache keys` + trailers).

---

### Task 2: MixCalculator port (`/mix`)

**Files:** Create `src/verticals/pressure/mix-calc.ts`, `src/verticals/pressure/MixCalculator.tsx`, `src/verticals/pressure/mix-calc.test.ts`.

- [ ] **Step 1: Write the failing test** — `mix-calc.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeMix, SH_TARGETS, SURFACES } from "./mix-calc";

describe("mix-calc", () => {
  it("computes the soft-wash recipe", () => {
    const r = computeMix({ totalGallons: 50, targetPct: 1.0, stockPct: 12.5, surfactantOzPerGal: 1.0 });
    expect(r.stockGal).toBe(4);
    expect(r.waterGal).toBe(46);
    expect(r.surfactantOz).toBe(50);
  });
  it("has SH targets for all 7 surfaces", () => {
    expect(SURFACES).toHaveLength(7);
    for (const s of SURFACES) {
      expect(typeof SH_TARGETS[s].targetPct).toBe("number");
      expect(typeof SH_TARGETS[s].surfactantOzPerGal).toBe("number");
    }
    expect(SH_TARGETS.roof.targetPct).toBe(4.0);
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Create `mix-calc.ts`** (pure; values verbatim from PressurePro `store.ts`):

```ts
export type SurfaceKey = "house" | "siding" | "roof" | "driveway" | "concrete" | "deck" | "fence";

export const SURFACES: SurfaceKey[] = ["house", "roof", "siding", "driveway", "concrete", "deck", "fence"];

export const SURFACE_LABEL: Record<SurfaceKey, { label: string; emoji: string }> = {
  house: { label: "House Wash", emoji: "🏠" },
  siding: { label: "Siding", emoji: "🧱" },
  roof: { label: "Roof", emoji: "🛖" },
  driveway: { label: "Driveway", emoji: "🛣️" },
  concrete: { label: "Concrete", emoji: "🧊" },
  deck: { label: "Deck", emoji: "🪵" },
  fence: { label: "Fence", emoji: "🚧" },
};

// Per-surface soft-wash targets (SH % + surfactant oz/gal), verbatim from PressurePro.
export const SH_TARGETS: Record<SurfaceKey, { targetPct: number; surfactantOzPerGal: number }> = {
  house: { targetPct: 1.0, surfactantOzPerGal: 1.0 },
  siding: { targetPct: 1.0, surfactantOzPerGal: 1.0 },
  roof: { targetPct: 4.0, surfactantOzPerGal: 2.0 },
  fence: { targetPct: 1.5, surfactantOzPerGal: 1.0 },
  deck: { targetPct: 1.5, surfactantOzPerGal: 1.0 },
  concrete: { targetPct: 2.0, surfactantOzPerGal: 1.5 },
  driveway: { targetPct: 2.0, surfactantOzPerGal: 1.5 },
};

// Default chem costs for the estimate (turf has no per-user chem-cost settings;
// operator tuning is a deferred parity gap).
export const SH_COST_PER_GAL = 3.5;
export const SURFACTANT_COST_PER_OZ = 0.25;

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

export function computeMix(input: {
  totalGallons: number;
  targetPct: number;
  stockPct: number;
  surfactantOzPerGal: number;
}): { stockGal: number; waterGal: number; surfactantOz: number } {
  const { totalGallons, targetPct, stockPct, surfactantOzPerGal } = input;
  const stockGal = stockPct > 0 ? round((totalGallons * targetPct) / stockPct) : 0;
  const waterGal = round(Math.max(0, totalGallons - stockGal));
  const surfactantOz = round(surfactantOzPerGal * totalGallons, 1);
  return { stockGal, waterGal, surfactantOz };
}

export function estimateCost(stockGal: number, surfactantOz: number): number {
  return round(stockGal * SH_COST_PER_GAL + surfactantOz * SURFACTANT_COST_PER_OZ);
}
```

- [ ] **Step 4: Create `MixCalculator.tsx`** (default export; self-contained calc page).

Read `src/pages/ApplicationCalc.tsx` for the turf `AppShell` usage + header/styling idiom, then write a SIMPLER self-contained page (no weather/supabase). Requirements:
- Wrap in turf's `AppShell` (import from `@/components/AppShell`; match how a page uses it).
- Title "Mix calculator", eyebrow "SOFT-WASH", subtitle "Sodium hypochlorite recipe".
- A `grid grid-cols-4 gap-2` surface picker from `SURFACES`/`SURFACE_LABEL` (emoji + label buttons); selecting a surface sets `targetPct` + `surfactantOzPerGal` from `SH_TARGETS[surface]` into editable state.
- Number inputs (shared `tp-input`): total gallons (default 50), stock SH % (default 12.5), target % (from surface, editable).
- A recipe card (`tp-card`) showing `computeMix(...)` output: SH stock (gal), water (gal), surfactant (oz), and estimated cost via `estimateCost(...)` formatted inline as `` `$${n.toFixed(2)}` `` (turf has no shared currency util — format locally).
- Shared `tp-*`/theme classes ONLY (no `pp-*`). lucide icons (`FlaskConical`, `Droplets`, etc.).
- No supabase, no `useSettings`, no weather. Fully self-contained.

- [ ] **Step 5: Run test → pass.** tsc gate (mix files clean, no new file). `npx vitest run` green. `npm run build` green.

- [ ] **Step 6: Commit** — `git add src/verticals/pressure/mix-calc.ts src/verticals/pressure/MixCalculator.tsx src/verticals/pressure/mix-calc.test.ts && git commit` (`feat(platform): pressure MixCalculator (soft-wash SH recipe)` + trailers).

---

### Task 3: pressure/shell.tsx

**Files:** Create `src/verticals/pressure/shell.tsx`.

- [ ] **Step 1: Create the shell** (mirror `lawn/shell.tsx`):

```tsx
import { lazy } from "react";
import { Home, Users, FileText, Calendar, Settings as SettingsIcon, FlaskConical } from "lucide-react";
import type { VerticalRoute, NavEntry, HomeAction } from "@/verticals/shell";

const MixCalculator = lazy(() => import("./MixCalculator"));

export const pressureRoutes: VerticalRoute[] = [
  { path: "/mix", element: <MixCalculator />, guard: "protected" },
];

export const pressureNavEntries: NavEntry[] = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/quotes", label: "Quotes", icon: FileText },
  { to: "/schedule", label: "Schedule", icon: Calendar },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export const pressureHomeActions: HomeAction[] = [
  { icon: FlaskConical, label: "Mix Calc", sub: "Soft-wash SH recipe", accent: "text-accent-600", to: "/mix" },
];
```

- [ ] **Step 2: Gates + commit** — tsc 6-baseline (no new file — `shell.tsx` unreferenced until Task 4). `npx vitest run` green. `git add src/verticals/pressure/shell.tsx && git commit` (`feat(platform): pressure shell (/mix route + nav + home tile)` + trailers).

---

### Task 4: assemble pressure/index.ts + register

**Files:** Create `src/verticals/pressure/index.ts`; modify `src/verticals/registry.ts`; test `src/verticals/pressure/index.test.ts`.

- [ ] **Step 1: Create `pressure/index.ts`** (mirror `lawn/index.ts`):

```ts
import type { Vertical } from "@/verticals/types";
import { pressureQuoteLine } from "./quote-line";
import { pressureCatalog } from "./catalog";
import { pressureRoutes, pressureNavEntries, pressureHomeActions } from "./shell";
import { pressurePlanCadence } from "./plan-cadence";
import { pressureCampaigns } from "./campaigns";
import { pressurePropertyFields } from "./property-fields";
import { pressureCopy } from "./copy";
import { pressureBilling } from "./billing";

export const pressureVertical: Vertical = {
  id: "pressurepro",
  brand: {
    name: "PressurePro",
    tagline: "Pressure & soft-wash quoting, scheduling, and billing.",
    bundleId: "com.pressurepro.app",
    themeColor: "#11203F",
    fallbackBusinessName: "Pressure Washing",
    authTagline: "Quotes, plans, and recurring wash-route ops.",
    deepLinkScheme: "pressurepro",
  },
  billing: pressureBilling,
  quoteLine: pressureQuoteLine,
  catalog: pressureCatalog,
  extraRoutes: pressureRoutes,
  navEntries: pressureNavEntries,
  homeActions: pressureHomeActions,
  planCadence: pressurePlanCadence,
  campaigns: pressureCampaigns,
  propertyFields: pressurePropertyFields,
  copy: pressureCopy,
};
```

- [ ] **Step 2: Register** — in `src/verticals/registry.ts`, add `import { pressureVertical } from "@/verticals/pressure";` and `pressure: pressureVertical,` to `VERTICALS`.

- [ ] **Step 3: Conformance test** — create `src/verticals/pressure/index.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { VERTICALS } from "@/verticals/registry";

describe("pressure vertical registration", () => {
  it("is registered and complete", () => {
    const p = VERTICALS.pressure;
    expect(p).toBeDefined();
    expect(p.id).toBe("pressurepro");
    for (const k of ["brand","billing","quoteLine","catalog","extraRoutes","navEntries","homeActions","planCadence","campaigns","propertyFields","copy"] as const) {
      expect(p[k]).toBeDefined();
    }
    expect(p.brand.deepLinkScheme).toBe("pressurepro");
    expect(p.navEntries).toHaveLength(5);
  });
});
```

- [ ] **Step 4: Gates + commit** — `npx vitest run src/verticals/pressure/index.test.ts` → PASS. tsc 6-baseline. `npx vitest run` green. `npm run build` green. `git add src/verticals/pressure/index.ts src/verticals/registry.ts src/verticals/pressure/index.test.ts && git commit` (`feat(platform): assemble + register pressureVertical` + trailers).

---

### Task 5: bootable pressure build + verification

**Files:** none (verification only).

- [ ] **Step 1: Build both verticals**
  - `npm run build` (lawn) → succeeds.
  - `VITE_VERTICAL=pressure npm run build` → **succeeds** (proves pressure resolves via registry, every seam present, pressure theme loads via `@active-theme`, no import cycle, MixCalculator lazy-chunks).
  - If the pressure build fails, the error names the missing/mismatched piece — fix within the already-created pressure files (do NOT change lawn).

- [ ] **Step 2: tsc + suite** — `npx tsc --noEmit -p tsconfig.app.json` → 6-baseline. `npx vitest run` → full suite green.

- [ ] **Step 3: Record manual boot check** — note in the report that interactive verification (`VITE_VERTICAL=pressure npm run dev` → Home navy theme, 5 tabs, Mix Calc tile → `/mix`) is a MANUAL step for the user.

- [ ] **Step 4: Commit** only if a file/script was added; otherwise Task 5 is verification-only — record build results in the report.

---

## Self-Review notes (author)

- **Spec coverage:** deepLinkScheme + de-turfpro (T1); MixCalculator (T2); shell (T3); assemble+register (T4); build boot (T5).
- **Lawn identity:** deepLinkScheme "turfpro", `${vertical.id}.demo` = turfpro.demo, `${APP_ID}_` cache keys = turfpro_ — all identical for lawn.
- **Cycle safety:** MixCalculator lazy in shell; index imports only data/seam modules.
- **MixCalculator self-contained:** pure `mix-calc.ts` + a page with no supabase/weather/useSettings deps.
- **Register-last honored:** pressure resolvable only at T4; T5 proves the build.
- **Deferred:** native capacitor.config (1f), per-user chem-cost settings, the 1d-3 effectiveAmount nit.
