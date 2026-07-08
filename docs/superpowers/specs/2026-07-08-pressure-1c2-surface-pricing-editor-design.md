# Phase 1 slice 1c-2 — pressure Settings surface-pricing editor design

Status: approved phase; this slice's design ready for planning.
Date: 2026-07-08.
Parent: `2026-07-08-pressure-vertical-phase1-design.md`. Follows 1c-1 (catalog seam).

## Purpose

Make the Settings "Service catalog" slot vertical-aware so a pressure build shows
its per-surface **pricing matrix** (edit rate + min charge, write `surface_pricing`)
instead of the lawn `catalog_items` list editor. Second half of the 1c split.

## Design

**Contract** — `CatalogModule` (`src/verticals/catalog.ts`) gains:

```ts
import type { LazyExoticComponent, ComponentType } from "react";
// ...
  /** The Settings > catalog editor for this vertical (lazy — avoids the
   *  app-context→vertical import cycle, since editors import `vertical`). */
  SettingsEditor: LazyExoticComponent<ComponentType>;
```

Lazy is required: `CatalogEditor` (and the pressure editor) import `vertical`
(for copy/seed), so a direct reference from a vertical module would create a
load-time cycle (`registry → lawn/index → lawn/catalog → CatalogEditor →
vertical`). `React.lazy` defers the import past module-init — the same pattern
0c-3 used for lawn routes.

**Lawn** (`src/verticals/lawn/catalog.ts`):

```ts
import { lazy } from "react";
// ...
  SettingsEditor: lazy(() => import("@/components/settings/CatalogEditor")),
```

Behavior effectively identical — the same `CatalogEditor`, now loaded as a lazy
chunk behind a Suspense boundary (a deliberate, negligible code-split).

**Pressure** (`src/verticals/pressure/catalog.ts`):

```ts
  SettingsEditor: lazy(() => import("./SurfacePricingEditor")),
```

**New `src/verticals/pressure/SurfacePricingEditor.tsx`** — the pressure pricing
matrix (ports PressurePro `Settings.tsx` "Pricing matrix" + `useSurfacePricing`):
- Loads the user's `surface_pricing` rows: `useQuery(["surface_pricing", user?.id],
  () => supabase.from("surface_pricing").select("*").eq("user_id", user.id)
  .order("surface_type"))`.
- Header: title (e.g. "Pricing matrix") + a **soft/power `ModeToggle`** (local
  `activeMode` state).
- One row per surface (iterate a local 7-entry `SURFACE_META` = label+emoji):
  find the row for `(surface, activeMode)`, falling back to the surface's any-mode
  row (mirrors PressurePro — off-mode rows aren't seeded). Show emoji + label +
  `$/{unit}` hint + a `$`-prefixed **rate** input and a `MIN`-prefixed **min
  charge** input, both `defaultValue` + `onBlur` → mutation.
- **Mutation**: `useMutation` updating `surface_pricing` by row `id`
  (`{ default_rate }` or `{ min_charge }`), then `invalidateQueries(["surface_pricing",
  user?.id])`. Also invalidate `["catalog","service",user?.id]` so the quote
  editor's rates refresh.
- **Empty state** (no rows): render `vertical.catalog.copy.emptyStateHint` + a
  button labelled `vertical.catalog.copy.seedButtonLabel` that calls
  `vertical.catalog.seed(user.id, APP_ID)` then refetches. (Reuses 1c-1 copy +
  seed. `APP_ID` is imported here — this is a shared component file, NOT a vertical
  module, so no cycle.)
- Uses shared `tp-*`/theme classes + `Field` (NO `pp-*`). A minimal inline
  soft/power toggle (or a small local `ModeToggle`, `Droplets`/`Zap`), styled with
  shared classes.

**`src/pages/Settings.tsx`**: replace the direct editor mount with the
vertical's, inside Suspense; keep the surrounding `<Section icon label="Service
catalog">`:

```tsx
import { Suspense } from "react";
import { vertical } from "@/vertical";
// remove: import CatalogEditor from "@/components/settings/CatalogEditor";
// ...
<Section icon={<Wrench …/>} label="Service catalog">
  <Suspense fallback={<div className="text-sm text-neutral-500 py-2">Loading…</div>}>
    <vertical.catalog.SettingsEditor />
  </Suspense>
</Section>
```

**Register** `pressureCatalog.SettingsEditor` is set in `pressure/catalog.ts`, but
`pressureVertical` itself is not registered until 1e — the pressure editor is
authored + unreferenced by any running build.

## Testing

- **Conformance** (extend `src/verticals/pressure/catalog.test.ts` + lawn's):
  `pressureCatalog.SettingsEditor` and `lawnCatalog.SettingsEditor` are defined
  (truthy lazy components — `expect(...).toBeTruthy()` / has `$$typeof`). Keep the
  `vi.mock("@/integrations/supabase/client", …)` shim (the module imports supabase
  transitively). Do NOT deep-render the lazy component in unit tests (jsdom/env +
  supabase — out of scope; verified at 1e boot smoke).
- **tsc:** `npx tsc --noEmit -p tsconfig.app.json` stays at the 6-file baseline;
  `Settings.tsx` must NOT become a new error (remove the now-unused `CatalogEditor`
  import; add `vertical`/`Suspense`).
- **Build:** `npm run build` green (a new lazy chunk for the editor(s) is fine).
- Full vitest suite green.

## Out of scope (1c-2)

- Registering `pressureVertical` (1e).
- A pressure-specific Settings section LABEL ("Surface pricing") — trivial copy
  follow-up; label stays "Service catalog" for both.
- Extracting a shared pressure `surfaces.ts` (SURFACE_META duplicated in
  quote-line/catalog/editor) — future DRY pass.
- Editing `surface_pricing` `unit` or adding/removing surfaces (PressurePro's
  editor only edits rate + min charge for the fixed 7).
- Chemicals catalog (`catalog_items` kind='chemical') — separate, not the quote
  service catalog.
- Any lawn behavior change beyond the lazy-load of the (unchanged) CatalogEditor.
