# Phase 1 slice 1e — assemble + register + bootable pressure build design

Status: approved phase + scope (5 tasks, native deferred to 1f). Ready for planning.
Date: 2026-07-08.
Parent: `2026-07-08-pressure-vertical-phase1-design.md`. The assembly slice —
where the pressure vertical first boots.

## Purpose

Wire the (already-built) pressure seam modules into a registered `pressureVertical`
with a shell (`/mix` route + nav + home tile), a brand block, and a de-turfpro-ed
shared runtime, so `VITE_VERTICAL=pressure npm run build` produces a working
pressure web build. Lawn behavior identical. Native `capacitor.config` wiring is
deferred to 1f (cutover).

## What already exists (slices 1a–1d)

`src/verticals/pressure/`: `quote-line.tsx`, `catalog.ts`, `SurfacePricingEditor.tsx`,
`plan-cadence.ts`, `campaigns.ts`, `property-fields.ts`, `copy.ts`, `billing.ts`,
`theme.css`. Missing: `shell.tsx`, `index.ts`, `MixCalculator.tsx`, `mix-calc.ts`.

## Tasks

### Task 1 — `brand.deepLinkScheme` + de-turfpro the shared runtime (lawn-preserving)

The `Vertical.brand` gains `deepLinkScheme: string`; three shared runtime sites
that hardcode `turfpro` are made vertical-derived (lawn resolves to the SAME
value, so lawn is identical):
- `src/verticals/types.ts`: add `deepLinkScheme: string;` to `brand`.
- `src/verticals/lawn/index.ts`: add `deepLinkScheme: "turfpro"` to lawn brand.
- `src/pages/Auth.tsx`: the three `"turfpro://auth-callback"` sites (~129/175/199)
  → `` `${vertical.brand.deepLinkScheme}://auth-callback` ``; the demo-email domain
  (~72) `demo-${id}@turfpro.demo` → `` `demo-${id}@${vertical.id}.demo` `` (lawn =
  `turfpro.demo`, identical; pressure = `pressurepro.demo`). **The demo-email fix
  is a web-boot blocker.**
- `src/lib/auth-deep-link.ts`: the `startsWith("turfpro://auth-callback")` checks
  (~85/87) → `vertical.brand.deepLinkScheme`.
- `src/lib/offline-cache.ts`: the key prefixes (~65/66) `turfpro_pending_mutations`
  / `turfpro_cached_route_` → `` `${APP_ID}_pending_mutations` `` /
  `` `${APP_ID}_cached_route_` `` (APP_ID = vertical.id = "turfpro" for lawn →
  identical key, no orphaned cache). **Web-boot-relevant.**
- Cycle safety: `Auth.tsx`/`auth-deep-link.ts`/`offline-cache.ts` are NOT vertical
  config modules — importing `vertical`/`APP_ID` at runtime is fine (they're not in
  the registry init chain). `lawn/index.ts` just adds a string field.

### Task 2 — port the MixCalculator (pressure `/mix` route)

- `src/verticals/pressure/mix-calc.ts` (pure): `computeMix({ totalGallons,
  targetPct, stockPct })` → `{ stockGal, waterGal, surfactantOz }` (from
  PressurePro `store.ts:885-900`); `SH_TARGETS` (per-surface targetPct +
  surfactantOzPerGal + note, `store.ts:870`); `SURFACE_META` (7 surfaces label+emoji;
  may import from `pressure/quote-line`'s SURFACE_META if exported, else a local
  copy). Plus default cost constants `SH_COST_PER_GAL` / `SURFACTANT_COST_PER_OZ`
  for the estimate (turf has no per-user chem-cost settings — use sensible
  defaults; operator tuning is a deferred parity gap).
- `src/verticals/pressure/MixCalculator.tsx` (default export): a self-contained
  calc page MIRRORING the structure of lawn's `src/pages/ApplicationCalc.tsx` (the
  turf precedent for a self-contained calc `extraRoute`): use turf's `AppShell` +
  its existing header/section components + its currency formatter (find the one
  `ApplicationCalc`/other pages use). Surface picker (emoji grid) → sets target%;
  inputs for total gallons + stock SH%; output recipe card (SH gal, water gal,
  surfactant oz) + estimated cost via the default constants. Shared `tp-*`/theme
  classes only (NO `pp-*`). The `--gradient-hero-deep` var it may use is already in
  `pressure/theme.css`.

### Task 3 — `pressure/shell.tsx`

Mirror `lawn/shell.tsx`:
```ts
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
(icons from lucide-react. The MixCalculator route MUST be `lazy` — eager would pull
its `vertical` import into the registry chain and cycle, per 0c-3.)

### Task 4 — assemble `pressure/index.ts` + register

`src/verticals/pressure/index.ts` — `pressureVertical: Vertical` mirroring
`lawn/index.ts`, importing every pressure module:
```ts
brand: {
  name: "PressurePro",
  tagline: "Pressure & soft-wash quoting, scheduling, and billing.",
  bundleId: "com.pressurepro.app",
  themeColor: "#11203F",
  fallbackBusinessName: "Pressure Washing",
  authTagline: "Quotes, plans, and recurring wash-route ops.",
  deepLinkScheme: "pressurepro",
},
id: "pressurepro",
billing: pressureBilling, quoteLine: pressureQuoteLine, catalog: pressureCatalog,
extraRoutes: pressureRoutes, navEntries: pressureNavEntries, homeActions: pressureHomeActions,
planCadence: pressurePlanCadence, campaigns: pressureCampaigns,
propertyFields: pressurePropertyFields, copy: pressureCopy,
```
`src/verticals/registry.ts`: import `pressureVertical`, add `pressure:
pressureVertical` to `VERTICALS`.

### Task 5 — bootable build + verification

Gate: `VITE_VERTICAL=pressure npm run build` succeeds (proves the vertical
resolves, every seam is present, no import cycle / missing module). AND the
default `npm run build` (lawn) still succeeds. tsc at the 6-file baseline.
Interactive browser boot (`VITE_VERTICAL=pressure npm run dev` → Home renders,
Mix Calc tile → `/mix`, 5 nav tabs, navy theme) is a MANUAL check noted for the
user (not automatable in the subagent flow).

## Testing

- `pressure/mix-calc.test.ts`: `computeMix` — e.g. `{ totalGallons: 50, targetPct:
  1.0, stockPct: 12.5 }` → `stockGal 4`, `waterGal 46`; `SH_TARGETS` has all 7
  surfaces.
- Conformance: registering pressure — a test asserting `VERTICALS.pressure` is
  defined with `id === "pressurepro"` and all seams present (import the registry).
  Keep the `vi.mock("@/integrations/supabase/client", …)` shim (the index pulls
  supabase transitively via catalog/billing).
- Extend the existing vertical conformance test if present (assert both verticals
  satisfy the contract).
- **tsc** 6-file baseline (no NEW file; `Auth.tsx`/`auth-deep-link.ts`/
  `offline-cache.ts` must NOT become new errors). **Both builds green.**

## Out of scope (1e)

- Native `capacitor.config.ts` (appId/scheme/prefs) — 1f.
- Production deploy / cutover / applying migration 0032 — 1f.
- Per-user chemical-cost settings for the mix estimate (default constants; noted gap).
- NewPlan summary `effectiveAmount "$—"` cosmetic (from 1d-3, deferred).
- Any lawn behavior change.
