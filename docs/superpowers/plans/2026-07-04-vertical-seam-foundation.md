# Vertical Seam Foundation (Phase 0a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the config-driven "vertical" seam in the TurfPro repo — a `Vertical` interface, a `verticals/` registry, `VITE_VERTICAL` build selection, and `APP_ID` derived from the active vertical — with **zero behavior change** (TurfPro still builds and runs identically).

**Architecture:** A new `src/verticals/` module defines a `Vertical` contract and registers the lawn vertical (`id: "turfpro"`). `src/vertical.ts` resolves the active vertical from `VITE_VERTICAL` (default `lawn`). `src/lib/app-context.ts` now derives `APP_ID` from `vertical.id` instead of a hard-coded constant — the single seam through which the app learns its identity.

**Tech Stack:** React + TypeScript + Vite + vitest.

## Global Constraints

- This is **Phase 0a of the multi-vertical platform** (spec: `docs/superpowers/specs/2026-07-04-multi-vertical-platform-design.md`). Scope is ONLY the seam + identity. Theme-token normalization (Phase 0b) and the full lawn-domain extraction — quoteLine, catalog, calculators, weather/season/GDD, campaign templates, property fields (Phase 0c) — are SEPARATE later plans. Do not start them here.
- **Behavior-identical:** `APP_ID` must remain `"turfpro"` for the default (`lawn`) build. The existing app must build and pass its full vitest suite unchanged.
- The `Vertical` contract in THIS phase is intentionally minimal (`id`, `brand`). Later phases widen it (quoteLine, catalog, theme, calculators…). Leave a comment saying so; do NOT add unused seams now (YAGNI).
- `vertical.id` is typed `AppId` (`"turfpro" | "pressurepro"`) and equals the DB `app` discriminator — no DB change.
- Base branch: `feature/multi-vertical-platform` (the spec is already committed there).
- Commit trailers: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01QrF17kQNQsTPBTHee6C3br`.

---

### Task 1: Vertical contract, registry, and build selection

**Files:**
- Create: `src/verticals/types.ts`
- Create: `src/verticals/lawn/index.ts`
- Create: `src/verticals/registry.ts`
- Create: `src/vertical.ts`
- Create (test): `src/vertical.test.ts`
- Modify: `vitest.config.ts` (add the `@` path alias so tests resolve `@/…` imports)
- Modify: `src/vite-env.d.ts` (type `VITE_VERTICAL`)

**Interfaces:**
- Produces (used by Task 2): `AppId`, `Vertical` (from `@/verticals/types`); `VERTICALS` (from `@/verticals/registry`); `vertical` (the active `Vertical`, from `@/vertical`).

- [ ] **Step 1: Add the `@` alias to vitest config**

The new modules import via `@/…`. The current `vitest.config.ts` has no alias, so tests importing them would fail to resolve. Replace `vitest.config.ts` with:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Scope vitest to our unit tests. The `@` alias mirrors vite.config so tests
// can import application modules by `@/…` (the same specifier the app uses).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: [
      "src/**/*.{test,spec}.ts",
      "supabase/functions/_shared/quickbooks-map.test.ts",
    ],
    environment: "node",
  },
});
```

- [ ] **Step 2: Type `VITE_VERTICAL`**

In `src/vite-env.d.ts`, add an `ImportMetaEnv` augmentation (keep the existing `/// <reference types="vite/client" />` line at the top if present):

```ts
interface ImportMetaEnv {
  readonly VITE_VERTICAL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 3: Write the failing test**

Create `src/vertical.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { vertical } from "@/vertical";
import { VERTICALS } from "@/verticals/registry";

describe("vertical selection", () => {
  it("defaults to the lawn vertical (id turfpro) when VITE_VERTICAL is unset", () => {
    expect(vertical.id).toBe("turfpro");
  });
  it("every registered vertical has a valid id and brand", () => {
    for (const [slug, v] of Object.entries(VERTICALS)) {
      expect(typeof slug).toBe("string");
      expect(["turfpro", "pressurepro"]).toContain(v.id);
      expect(v.brand.name.length).toBeGreaterThan(0);
      expect(v.brand.bundleId.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm test -- vertical`
Expected: FAIL — `@/vertical` / `@/verticals/registry` don't exist yet.

- [ ] **Step 5: Create the contract**

Create `src/verticals/types.ts`:

```ts
// The Vertical contract — the per-trade configuration the shared core reads.
//
// Phase 0a is intentionally minimal (identity + brand). Later phases WIDEN this
// interface with the domain seams (quoteLine, catalog, theme, calculators,
// plan cadence, weather semantics, property fields, copy, extraRoutes) as those
// pieces are extracted out of the shared core. Do not add unused seams early.

export type AppId = "turfpro" | "pressurepro";

export interface Vertical {
  /** Trade identity — equals the DB `app` discriminator for this trade. */
  id: AppId;
  brand: {
    /** Display name, e.g. "TurfPro". */
    name: string;
    /** One-line positioning shown in marketing/settings surfaces. */
    tagline: string;
    /** Capacitor appId / bundle identifier, e.g. "com.turfpro.beta". */
    bundleId: string;
    /** Native status-bar / web theme-color hex. */
    themeColor: string;
  };
}
```

- [ ] **Step 6: Register the lawn vertical**

Create `src/verticals/lawn/index.ts`:

```ts
import type { Vertical } from "@/verticals/types";

// Lawn-care vertical (TurfPro). Phase 0a holds identity only; the lawn domain
// (catalog seed, calculators, GDD/season/weather, quote-line model, theme) is
// extracted here in Phase 0c.
export const lawnVertical: Vertical = {
  id: "turfpro",
  brand: {
    name: "TurfPro",
    tagline: "Lawn care quoting, scheduling, and billing.",
    bundleId: "com.turfpro.beta",
    themeColor: "#f5f1e8",
  },
};
```

- [ ] **Step 7: Create the registry + selection**

Create `src/verticals/registry.ts`:

```ts
import type { Vertical } from "@/verticals/types";
import { lawnVertical } from "@/verticals/lawn";

// Slug (VITE_VERTICAL value) → Vertical. New trades register here.
export const VERTICALS: Record<string, Vertical> = {
  lawn: lawnVertical,
};
```

Create `src/vertical.ts`:

```ts
import { VERTICALS } from "@/verticals/registry";
import type { Vertical } from "@/verticals/types";

// Resolve the active vertical from the build-time VITE_VERTICAL env (default
// "lawn"). Fails fast on an unknown slug so a misconfigured build never ships
// silently against the wrong trade.
const slug = import.meta.env.VITE_VERTICAL ?? "lawn";
const active: Vertical | undefined = VERTICALS[slug];
if (!active) {
  throw new Error(
    `Unknown VITE_VERTICAL "${slug}". Known verticals: ${Object.keys(VERTICALS).join(", ")}`,
  );
}

export const vertical: Vertical = active;
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test -- vertical`
Expected: PASS — 2/2.

- [ ] **Step 9: Commit**

```bash
git add vitest.config.ts src/vite-env.d.ts src/vertical.ts src/vertical.test.ts src/verticals/
git commit -m "feat(platform): vertical contract, registry, and VITE_VERTICAL selection"
```

---

### Task 2: Derive APP_ID from the active vertical + docs

**Files:**
- Modify: `src/lib/app-context.ts`
- Modify: `.env` (document `VITE_VERTICAL`)
- Create: `src/verticals/README.md`

**Interfaces:**
- Consumes: `vertical` (`@/vertical`), `AppId` (`@/verticals/types`).
- Produces: `APP_ID` (now `= vertical.id`), `AppId` re-export, `APP_DISCRIMINATED_TABLES` — unchanged public surface for the 23 existing importers.

- [ ] **Step 1: Rewire `app-context.ts`**

Replace the `APP_ID` / `AppId` declarations in `src/lib/app-context.ts` (keep the file's header comment and `APP_DISCRIMINATED_TABLES`). The new body:

```ts
import { vertical } from "@/vertical";
export type { AppId } from "@/verticals/types";

// APP_ID is the single source of truth for "which trade is this build?" — now
// derived from the active vertical (VITE_VERTICAL) rather than a hard-coded
// constant. Equals the DB `app` discriminator. Behaviour is unchanged for the
// default (lawn) build: APP_ID === "turfpro".
export const APP_ID = vertical.id;

export const APP_DISCRIMINATED_TABLES = [
  "quotes",
  "maintenance_plans",
  "catalog_items",
  "photo_pairs",
  "campaigns",
] as const;
```

(The 23 files importing `APP_ID` / `AppId` from `@/lib/app-context` keep working — the public surface is identical.)

- [ ] **Step 2: Typecheck (confirm all consumers still compile)**

Run: `npx tsc --noEmit`
Expected: no errors — `APP_ID` is still typed `"turfpro"` (a literal, since `vertical.id` for the lawn build narrows to `"turfpro"`)... note: `vertical.id` is typed `AppId` (union), so `APP_ID` is now `AppId`, not the literal `"turfpro"`. If any consumer relied on the literal type and this produces a type error, report it — but expected: no consumer constrains on the literal, so tsc is clean.

- [ ] **Step 3: Run the full test suite (behaviour-identical guard)**

Run: `npm test`
Expected: PASS — the entire existing suite is green (mapper, qbo-sync-state, quickbooks-map, vertical) plus the new `vertical.test.ts`. The `vertical` test asserts `APP_ID`'s source resolves to `turfpro`.

- [ ] **Step 4: Build (confirm the default vertical build works)**

Run: `npm run build`
Expected: build succeeds. (This is the `VITE_VERTICAL=lawn` default build = today's TurfPro.)

- [ ] **Step 5: Add the env var + docs**

In `.env`, add near the top:

```
# ---------- Vertical (which trade this build is) ----------
# Selects the active vertical from src/verticals/registry.ts at build time.
# Default (unset) = "lawn" (TurfPro). A pressure-washing vertical is added in a
# later phase. Per-trade builds run e.g. `VITE_VERTICAL=lawn npm run build`.
VITE_VERTICAL=lawn
```

Create `src/verticals/README.md`:

```markdown
# Verticals

Each trade app is one `Vertical` config (see `types.ts`) selected at build time
via `VITE_VERTICAL` (default `lawn`). The shared core reads the active vertical
from `@/vertical` and delegates trade-specific behaviour to it.

## Adding a vertical (later phases)
1. Create `src/verticals/<slug>/index.ts` exporting a `Vertical`.
2. Register it in `registry.ts` under its `<slug>`.
3. Build with `VITE_VERTICAL=<slug> npm run build`; ship with its own Capacitor
   `appId` (`brand.bundleId`) and icons.

## Status
- Phase 0a (this): identity + brand only.
- Phase 0b: theme-token normalization (semantic tokens) so palettes swap per vertical.
- Phase 0c: extract the lawn domain (quote-line, catalog, calculators, GDD/season/weather, campaign copy, property fields) behind the contract.
- Phase 1+: add the pressure-washing vertical; then new trades are config-only.
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/app-context.ts .env src/verticals/README.md
git commit -m "feat(platform): derive APP_ID from the active vertical + verticals docs"
```

---

## Scope note / what comes next

This plan delivers ONLY the seam foundation (behaviour-identical). It does NOT:
- normalize the ~2,173 `green`/`bronze`/`ink` theme-token usages to semantic
  tokens — that is **Phase 0b** (its own spec/plan cycle; large but mechanical),
  and is the prerequisite for a second vertical's palette to swap cleanly.
- extract the lawn domain (quote-line editor `QuoteForm.tsx`, catalog seed,
  ApplicationCalc/ChemicalLog, GDD/season/weather, campaign templates, property
  fields) into `verticals/lawn` — that is **Phase 0c**.
- add the pressure-washing vertical — that is **Phase 1**.

Each is planned separately once this foundation lands.

## Notes for the implementer

- Keep the `Vertical` interface minimal (id + brand). Do NOT pre-add quoteLine/
  theme/catalog seams — they arrive with their extraction phases (YAGNI).
- `APP_ID` MUST resolve to `"turfpro"` for the default build; the whole point is
  zero behaviour change. If anything makes the app behave differently, stop and
  report it.
- Watch for import cycles: `app-context → vertical → registry → lawn → types`;
  `types` imports nothing. Do not make `verticals/*` import from `app-context`.
