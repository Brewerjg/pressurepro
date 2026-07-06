# Phase 0c-3 — route/nav composition seam design

Status: approved design, ready for implementation planning.
Date: 2026-07-06.

## Context

Part of the multi-vertical platform (spec:
`2026-07-04-multi-vertical-platform-design.md`). **Phase 0c** extracts the lawn
domain behind the `Vertical` contract. **0c-1/0c-2** built the quote-line and
catalog seams. **0c-3** (this) makes the shared app shell stop hardcoding lawn
routes, tabs, and home tiles — it composes whatever the active vertical supplies.

### What the audit established

- **`src/App.tsx`** hardcodes every route in one `<Routes>` block. Four are
  lawn-domain-specific:
  - `/calc` → `<Protected>` (ApplicationCalc, lazy) — NPK/agronomy calculator.
  - `/chem-log` → `<Protected>` (ChemicalLog, lazy) — pesticide compliance log.
  - `/routes` → `<Paid>` (RoutesPage, **eager**) — maintenance-plan route scheduler.
  - `/routes/run/:routeId` → `<ProtectedFullBleed>` (RouteMode, lazy) — route
    execution, no AppShell/TabBar.
  These are lawn-specific (built on `maintenance_plans` recurrence, season gating,
  property flags); PressurePro schedules quote-dated jobs with an entirely
  different model. ~4,650 lines of page code — but this slice does NOT rewrite or
  relocate them, only moves their **route registration** behind the seam.
- The three route guards already exist in `App.tsx`: `Protected`
  (ProtectedRoute → RequireOnboarded → AppShell), `Paid` (adds
  RequireSubscription), `ProtectedFullBleed` (ProtectedRoute only, no AppShell).
- **`src/components/TabBar.tsx`** hardcodes a 5-tab `const tabs` (Home, Customers,
  Routes, Plans, Settings) in a `grid-cols-5`.
- **`src/pages/Home.tsx`** hardcodes a 7-tile `quickActions` array; two tiles are
  lawn-specific: Application (`/calc`) and Chemical log (`/chem-log`).
- The `Vertical` interface (`id`, `brand`, `quoteLine`, `catalog`) has NO route/
  nav/home seam yet.

## Decisions

1. **Add three fields to `Vertical`:** `extraRoutes: VerticalRoute[]`,
   `navEntries: NavEntry[]`, `homeActions: HomeAction[]`.
2. **Leave the page files in `src/pages/`.** The vertical registers them by
   reference; physical relocation into `verticals/lawn/` is deferred (out of scope).
3. **Encode the guard per route.** `VerticalRoute.guard` is `"protected" | "paid"
   | "fullBleed"`; `App.tsx` maps it to the existing wrapper component.
4. **All four route components are `lazy`** in `lawn/shell.tsx`. `Routes` is eager
   in `App.tsx` today, but eagerly importing it from `lawn/shell` (which sits in the
   vertical-registry import chain `vertical.ts → registry → lawn/index → lawn/shell`)
   would pull `Routes.tsx → @/lib/app-context`, whose top-level
   `export const APP_ID = vertical.id` reads `vertical` while `vertical.ts` is still
   mid-evaluation — a startup circular-import that throws. Making `Routes` `lazy`
   defers the `import()` and breaks the cycle. Net effect: `/routes` moves to its own
   chunk with a brief suspense spinner on first navigation (a minor, deliberate change
   that also trims the initial bundle). The other three were already `lazy`.
5. **`homeActions` append after the generic tiles.** The two lawn tiles move from
   their current mid-grid position to the end of the quick-action grid (a small,
   deliberate cosmetic reorder — Reports now precedes the lawn tools). Everything
   else is behavior-identical.
6. **GDD/season stays 0c-5.** Routes/RouteMode keep their internal `useSeason`/
   `isWinter`/property-flag imports untouched; only routing/nav/tiles move here.
7. **Behavior-identical for TurfPro** apart from decision 5's tile order.

## The contract

New file `src/verticals/shell.ts` (types only — the vertical's app-shell composition):

```ts
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

// A route the vertical injects into the shared router. `element` is the page
// element (e.g. <ApplicationCalc/>); App.tsx wraps it in the named guard.
export type RouteGuard = "protected" | "paid" | "fullBleed";
export interface VerticalRoute {
  path: string;
  element: ReactNode;
  guard: RouteGuard;
}

// A bottom tab-bar entry.
export interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

// A Home quick-action tile.
export interface HomeAction {
  icon: LucideIcon;
  label: string;
  sub: string;
  accent: string; // tailwind text-color class, e.g. "text-accent-600"
  to: string;
}
```

The `Vertical` interface (`src/verticals/types.ts`) gains:
```ts
  extraRoutes: VerticalRoute[];
  navEntries: NavEntry[];
  homeActions: HomeAction[];
```

## Architecture / mechanics

- **`src/verticals/lawn/shell.tsx`** — owns the page imports and the three arrays:
  ```tsx
  import { lazy } from "react";
  import { Home, Users, Route, ClipboardList, Settings as SettingsIcon,
           Calculator, StickyNote } from "lucide-react";
  import type { VerticalRoute, NavEntry, HomeAction } from "@/verticals/shell";

  // All lazy — see decision 4 (eager RoutesPage here would create a startup
  // circular import through @/lib/app-context).
  const RoutesPage = lazy(() => import("@/pages/Routes"));
  const RouteMode = lazy(() => import("@/pages/RouteMode"));
  const ApplicationCalc = lazy(() => import("@/pages/ApplicationCalc"));
  const ChemicalLog = lazy(() => import("@/pages/ChemicalLog"));

  export const lawnRoutes: VerticalRoute[] = [
    { path: "/routes", element: <RoutesPage />, guard: "paid" },
    { path: "/routes/run/:routeId", element: <RouteMode />, guard: "fullBleed" },
    { path: "/calc", element: <ApplicationCalc />, guard: "protected" },
    { path: "/chem-log", element: <ChemicalLog />, guard: "protected" },
  ];
  export const lawnNavEntries: NavEntry[] = [
    { to: "/", label: "Home", icon: Home, end: true },
    { to: "/customers", label: "Customers", icon: Users },
    { to: "/routes", label: "Routes", icon: Route },
    { to: "/plans", label: "Plans", icon: ClipboardList },
    { to: "/settings", label: "Settings", icon: SettingsIcon },
  ];
  export const lawnHomeActions: HomeAction[] = [
    { icon: Calculator, label: "Application", sub: "NPK · per 1000ft²", accent: "text-accent-600", to: "/calc" },
    { icon: StickyNote, label: "Chemical log", sub: "Compliance record", accent: "text-brand-700", to: "/chem-log" },
  ];
  ```
- **`src/verticals/lawn/index.ts`** — register `extraRoutes: lawnRoutes`,
  `navEntries: lawnNavEntries`, `homeActions: lawnHomeActions`.
- **`src/App.tsx`** — remove the four lawn `<Route>`s and the now-unused page
  imports (`RoutesPage`, `RouteMode`, `ApplicationCalc`, `ChemicalLog`); add a
  guard map and render the vertical's routes inside `<Routes>`:
  ```tsx
  import { vertical } from "@/vertical";
  const GUARDS = { protected: Protected, paid: Paid, fullBleed: ProtectedFullBleed } as const;
  // inside <Routes>:
  {vertical.extraRoutes.map(({ path, element, guard }) => {
    const Guard = GUARDS[guard];
    return <Route key={path} path={path} element={<Guard>{element}</Guard>} />;
  })}
  ```
  (React Router v6 ranks routes, so declaration order relative to the static
  routes does not affect matching.)
- **`src/components/TabBar.tsx`** — delete the hardcoded `tabs` const and its
  lucide icon imports; `import { vertical } from "@/vertical"`; map
  `vertical.navEntries`. Replace `grid-cols-5` with an inline
  `style={{ gridTemplateColumns: \`repeat(${vertical.navEntries.length}, minmax(0, 1fr))\` }}`
  so the bar supports any tab count (5 for lawn — visually identical).
- **`src/pages/Home.tsx`** — remove the two lawn tiles (`/calc`, `/chem-log`) from
  the local `quickActions`; remove the now-unused `Calculator`/`StickyNote` icon
  imports; `import { vertical } from "@/vertical"`; render
  `[...quickActions, ...vertical.homeActions]` through the existing
  `.filter(inbox).map(...)` (the lawn tiles append after the generic ones).

## Testing

- **Unit (vitest)** `src/verticals/lawn/shell.test.tsx`: `lawnRoutes` has exactly
  the four paths `/routes`, `/routes/run/:routeId`, `/calc`, `/chem-log` with
  guards `paid`, `fullBleed`, `protected`, `protected`; `lawnNavEntries` has 5
  entries and the first is `{ to: "/", label: "Home", end: true }`;
  `lawnHomeActions` has 2 entries with `to` = `/calc` and `/chem-log`.
- **Conformance:** `lawnVertical.extraRoutes`/`.navEntries`/`.homeActions` are
  defined (extend the existing vertical conformance test if it enumerates fields).
- **Build + tsc:** `npx tsc --noEmit -p tsconfig.app.json` at the known 6-file
  pre-existing baseline (AudienceStep, campaigns/templates, BusinessProfile, iap,
  Campaigns, Onboarding) — no NEW file. `npm run build` succeeds (note: the build
  now includes `vertical.navEntries` in the TabBar chunk — verify no new chunk
  warning beyond the pre-existing one). Full vitest suite green.
- **Manual (deferred, human):** all four routes reachable with the same guards —
  `/calc` + `/chem-log` (tab bar present), `/routes` (paid gate), `/routes/run/:id`
  (full-bleed, NO tab bar); the bottom tab bar shows the same 5 tabs; Home's quick
  actions all work, with Application + Chemical log now at the end of the grid.

## Out of scope (0c-3)

- Physically relocating the page files into `verticals/lawn/` (deferred cleanup).
- The GDD/season/weather seam — `PreEmergentAlert`, `WinterHomeCard`,
  `WinterRoutesBanner`, `useSeason`, `useGddForecast` (Phase 0c-5).
- The plan-cadence seam (0c-4).
- Any pressure routes/nav/home tiles — Phase 1 (this seam makes them config-only).
- `AppShell.tsx` (it just renders `<TabBar/>` — TabBar reads the vertical itself,
  so AppShell is untouched).
