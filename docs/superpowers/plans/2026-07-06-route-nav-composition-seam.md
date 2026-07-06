# Route/Nav Composition Seam (Phase 0c-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shared app shell compose the active vertical's routes, tab-bar entries, and Home quick-action tiles instead of hardcoding lawn's — so a future pressure vertical omits/replaces them via config.

**Architecture:** New `src/verticals/shell.ts` contract (`VerticalRoute`+guard, `NavEntry`, `HomeAction`); `src/verticals/lawn/shell.tsx` owns the lawn route/nav/tile arrays (lazy page imports); `App.tsx` maps `vertical.extraRoutes` through a guard→wrapper map; `TabBar` reads `vertical.navEntries`; `Home` appends `vertical.homeActions`.

**Tech Stack:** React + React Router v6 + TypeScript + Vite + vitest.

## Global Constraints

- **Phase 0c-3** of the multi-vertical platform (spec: `2026-07-06-route-nav-composition-seam-design.md`).
- **Behavior-identical for TurfPro**, with ONE deliberate cosmetic change: the two lawn Home tiles (Application, Chemical log) move to the END of the quick-action grid (they append after the generic tiles).
- **All four lawn route components are `lazy`** in `lawn/shell.tsx` (including `Routes`, which is eager in App.tsx today). Eager-importing `Routes` from the vertical chain causes a startup circular import via `@/lib/app-context`'s top-level `vertical.id` read. `lazy` defers the `import()` and breaks the cycle. Do NOT eager-import any page in `lawn/shell.tsx`.
- **Guards:** `/calc`,`/chem-log` → `protected`; `/routes` → `paid`; `/routes/run/:routeId` → `fullBleed`. These map to App.tsx's existing `Protected`/`Paid`/`ProtectedFullBleed` wrappers.
- Verify tsc with the STRICT app config: `npx tsc --noEmit -p tsconfig.app.json`. Known PRE-EXISTING baseline of errors in 6 UNRELATED files — `src/components/campaigns/AudienceStep.tsx`, `src/components/campaigns/templates.ts`, `src/components/settings/BusinessProfile.tsx`, `src/lib/iap.ts`, `src/pages/Campaigns.tsx`, `src/pages/Onboarding.tsx`. Success = error set stays EXACTLY that baseline (no NEW file).
- Tests: `npm test -- --run`. Build: `npm run build`.
- Base branch: `feature/route-nav-composition-seam` (spec committed there). Commit trailers on every commit:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` /
  `Claude-Session: https://claude.ai/code/session_01QrF17kQNQsTPBTHee6C3br`.

---

### Task 1: The shell contract + lawn arrays + registration + tests

**Files:**
- Create: `src/verticals/shell.ts`
- Create: `src/verticals/lawn/shell.tsx`
- Create (test): `src/verticals/lawn/shell.test.ts`
- Modify: `src/verticals/types.ts` (add 3 fields to `Vertical`)
- Modify: `src/verticals/lawn/index.ts` (register the 3 arrays)

**Interfaces:**
- Produces (used by Tasks 2–4): `VerticalRoute`, `RouteGuard`, `NavEntry`, `HomeAction` (`@/verticals/shell`); `lawnRoutes`, `lawnNavEntries`, `lawnHomeActions` (`@/verticals/lawn/shell`); `vertical.extraRoutes`/`.navEntries`/`.homeActions` (via `@/vertical`).

- [ ] **Step 1: Create the contract**

Create `src/verticals/shell.ts`:

```ts
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

// How a vertical composes into the shared app shell: the routes it injects, its
// bottom-tab entries, and its Home quick-action tiles.

// `element` is the page element (e.g. <ApplicationCalc/>); App.tsx wraps it in
// the named guard, which maps to the existing Protected/Paid/ProtectedFullBleed.
export type RouteGuard = "protected" | "paid" | "fullBleed";
export interface VerticalRoute {
  path: string;
  element: ReactNode;
  guard: RouteGuard;
}

export interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export interface HomeAction {
  icon: LucideIcon;
  label: string;
  sub: string;
  accent: string; // tailwind text-color class, e.g. "text-accent-600"
  to: string;
}
```

- [ ] **Step 2: Add the 3 fields to the `Vertical` contract**

In `src/verticals/types.ts`, add the import and the fields. After the existing `import type { CatalogModule } from "./catalog";`, add:
```ts
import type { VerticalRoute, NavEntry, HomeAction } from "./shell";
```
and inside `interface Vertical { … }`, after `catalog: CatalogModule;`, add:
```ts
  /** Routes this vertical injects into the shared router (lawn: calc, chem-log, routes). */
  extraRoutes: VerticalRoute[];
  /** Bottom tab-bar entries for this vertical. */
  navEntries: NavEntry[];
  /** Home quick-action tiles specific to this vertical. */
  homeActions: HomeAction[];
```

- [ ] **Step 3: Write the lawn shell test (TDD)**

Create `src/verticals/lawn/shell.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { lawnRoutes, lawnNavEntries, lawnHomeActions } from "@/verticals/lawn/shell";

describe("lawn shell config", () => {
  it("registers the four lawn routes with the correct guards", () => {
    const byPath = Object.fromEntries(lawnRoutes.map((r) => [r.path, r.guard]));
    expect(byPath).toEqual({
      "/routes": "paid",
      "/routes/run/:routeId": "fullBleed",
      "/calc": "protected",
      "/chem-log": "protected",
    });
    for (const r of lawnRoutes) expect(r.element).toBeTruthy();
  });
  it("has the 5 lawn tab entries, Home first", () => {
    expect(lawnNavEntries).toHaveLength(5);
    expect(lawnNavEntries[0]).toMatchObject({ to: "/", label: "Home", end: true });
    expect(lawnNavEntries.map((n) => n.to)).toEqual([
      "/", "/customers", "/routes", "/plans", "/settings",
    ]);
  });
  it("exposes the calc + chem-log home tiles", () => {
    expect(lawnHomeActions.map((a) => a.to)).toEqual(["/calc", "/chem-log"]);
    for (const a of lawnHomeActions) {
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.icon).toBeTruthy();
    }
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- --run shell`
Expected: FAIL — `@/verticals/lawn/shell` does not exist yet.

- [ ] **Step 5: Implement the lawn shell arrays**

Create `src/verticals/lawn/shell.tsx` (page imports relocated from `App.tsx`; nav entries from `TabBar.tsx`; home tiles from `Home.tsx` — all verbatim values):

```tsx
import { lazy } from "react";
import {
  Home,
  Users,
  Route,
  ClipboardList,
  Settings as SettingsIcon,
  Calculator,
  StickyNote,
} from "lucide-react";
import type { VerticalRoute, NavEntry, HomeAction } from "@/verticals/shell";

// All lazy — see spec decision 4. Eager-importing RoutesPage here would create a
// startup circular import through @/lib/app-context's top-level vertical.id read.
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

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- --run shell`
Expected: PASS — all lawn shell cases green.

- [ ] **Step 7: Register the 3 arrays on the lawn vertical**

In `src/verticals/lawn/index.ts`, add the import and the fields:
```ts
import { lawnRoutes, lawnNavEntries, lawnHomeActions } from "./shell";
```
and inside `lawnVertical`, after `catalog: lawnCatalog,`, add:
```ts
  extraRoutes: lawnRoutes,
  navEntries: lawnNavEntries,
  homeActions: lawnHomeActions,
```

- [ ] **Step 8: Typecheck, build, full suite**

Run: `npx tsc --noEmit -p tsconfig.app.json` (error set == 6-file baseline — `Vertical` now requires the 3 fields and `lawnVertical` provides them; `App.tsx` still hardcodes the routes but that's fine, it doesn't consume `extraRoutes` yet), then `npm run build` (succeeds), then `npm test -- --run` (green).

- [ ] **Step 9: Commit**

```bash
git add src/verticals/shell.ts src/verticals/lawn/shell.tsx src/verticals/lawn/shell.test.ts src/verticals/types.ts src/verticals/lawn/index.ts
git commit -m "feat(platform): add vertical shell seam (routes/nav/home tiles) + lawn impl"
```

---

### Task 2: App.tsx composes `vertical.extraRoutes`

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `vertical.extraRoutes` (`@/vertical`), the existing `Protected`/`Paid`/`ProtectedFullBleed` wrappers.

- [ ] **Step 1: Import `vertical`, remove the four lawn page imports**

In `src/App.tsx`:
- Add `import { vertical } from "@/vertical";` (with the other top imports, e.g. after the `AppShell` import on line 7).
- DELETE the eager import `import RoutesPage from "./pages/Routes";` (line 18).
- DELETE the three lazy consts `RouteMode`, `ApplicationCalc`, `ChemicalLog` (lines 32–34).

- [ ] **Step 2: Add the guard map**

After the `Paid` wrapper definition (immediately before `RouteSuspense`), add:
```tsx
// Maps a vertical route's guard name to the wrapper that enforces it.
const GUARDS = { protected: Protected, paid: Paid, fullBleed: ProtectedFullBleed } as const;
```

- [ ] **Step 3: Remove the four hardcoded lawn routes**

In the `<Routes>` block, DELETE these four lines:
```tsx
          <Route path="/routes" element={<Paid><RoutesPage /></Paid>} />
          <Route path="/routes/run/:routeId" element={<ProtectedFullBleed><RouteMode /></ProtectedFullBleed>} />
          <Route path="/calc" element={<Protected><ApplicationCalc /></Protected>} />
          <Route path="/chem-log" element={<Protected><ChemicalLog /></Protected>} />
```
(They are at lines 127, 128, 141, 142 — not adjacent.)

- [ ] **Step 4: Render the vertical's routes**

Immediately before the catch-all `<Route path="*" element={<NotFound />} />`, add:
```tsx
          {vertical.extraRoutes.map(({ path, element, guard }) => {
            const Guard = GUARDS[guard];
            return <Route key={path} path={path} element={<Guard>{element}</Guard>} />;
          })}
```
(React Router v6 ranks routes, so placement relative to the static routes doesn't affect matching.)

- [ ] **Step 5: Typecheck, build, test**

Run: `npx tsc --noEmit -p tsconfig.app.json` (error set == baseline — `App.tsx` must NOT appear; if it does, a removed page import is still referenced or a guard key is wrong), then `npm run build` (succeeds — `/routes` now emits its own lazy chunk), then `npm test -- --run` (green).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(platform): App composes vertical.extraRoutes via guard map"
```

---

### Task 3: TabBar reads `vertical.navEntries`

**Files:**
- Modify: `src/components/TabBar.tsx`

**Interfaces:**
- Consumes: `vertical.navEntries` (`@/vertical`).

- [ ] **Step 1: Swap the hardcoded tabs for the vertical's**

Replace the top of `src/components/TabBar.tsx` — the lucide icon import, the comment, and the `const tabs = […]` block — with:
```tsx
import { NavLink } from "react-router-dom";
import { vertical } from "@/vertical";
import { cn } from "@/lib/utils";
```
(Delete the `import { Home, Users, Route, ClipboardList, Settings as SettingsIcon } from "lucide-react";` line and the entire `const tabs = [ … ];` block — the entries now live in `vertical.navEntries`.)

- [ ] **Step 2: Render `vertical.navEntries` with a variable-column grid**

In the JSX, change the `<ul>` to size its columns to the entry count, and map over `vertical.navEntries`:
- Change `<ul className="grid grid-cols-5 max-w-md mx-auto px-2 py-2">` to:
  ```tsx
      <ul
        className="grid max-w-md mx-auto px-2 py-2"
        style={{ gridTemplateColumns: `repeat(${vertical.navEntries.length}, minmax(0, 1fr))` }}
      >
  ```
- Change `{tabs.map(({ to, label, icon: Icon, end }) => (` to `{vertical.navEntries.map(({ to, label, icon: Icon, end }) => (`.

(The inner `<NavLink>`/`<Icon>` markup is unchanged. For lawn, 5 entries → `repeat(5, …)`, visually identical to `grid-cols-5`.)

- [ ] **Step 3: Typecheck, build, test**

Run: `npx tsc --noEmit -p tsconfig.app.json` (error set == baseline — `TabBar.tsx` must NOT appear; the old lucide icon imports must be fully removed or `noUnusedLocals` flags them), then `npm run build` (succeeds), then `npm test -- --run` (green).

- [ ] **Step 4: Commit**

```bash
git add src/components/TabBar.tsx
git commit -m "feat(platform): TabBar renders vertical.navEntries"
```

---

### Task 4: Home appends `vertical.homeActions`

**Files:**
- Modify: `src/pages/Home.tsx`

**Interfaces:**
- Consumes: `vertical.homeActions` (`@/vertical`).

- [ ] **Step 1: Import `vertical`, drop the two lawn tiles + their icons**

In `src/pages/Home.tsx`:
- Add `import { vertical } from "@/vertical";` with the other imports.
- In the lucide import block, DELETE the `Calculator,` line and the `StickyNote,` line (they move to `lawn/shell.tsx`; they are used only by the two tiles being removed).
- In the `const quickActions = [ … ]` array, DELETE the two lawn entries:
  ```tsx
    { icon: Calculator,   label: "Application",   sub: "NPK · per 1000ft²",  accent: "text-accent-600", to: "/calc" },
    { icon: StickyNote,   label: "Chemical log",  sub: "Compliance record",  accent: "text-brand-700",  to: "/chem-log" },
  ```
  (The remaining 5 generic tiles — Quotes, Invoices, Inbox, Photo pair, Reports — stay.)

- [ ] **Step 2: Render generic tiles + the vertical's tiles**

In the quick-actions JSX, change the source array from `quickActions` to the concatenation:
```tsx
          {[...quickActions, ...vertical.homeActions]
            .filter((t) => t.to !== "/inbox" || TWILIO_ENABLED)
            .map(({ icon: Icon, label, sub, accent, to }) => {
```
(Everything else in the map body — `inner`, the `Link`/`button` branch — is unchanged. The lawn tiles now render after Reports.)

- [ ] **Step 3: Typecheck, build, test**

Run: `npx tsc --noEmit -p tsconfig.app.json` (error set == baseline — `Home.tsx` must NOT appear; if it does, `Calculator`/`StickyNote` are still imported unused, or a tile field is mistyped), then `npm run build` (succeeds), then `npm test -- --run` (green).

- [ ] **Step 4: Commit**

```bash
git add src/pages/Home.tsx
git commit -m "feat(platform): Home renders vertical.homeActions tiles"
```

---

## Human verification (deferred — after deploy)

Not an implementer task (needs the running app):
- Navigate to `/calc`, `/chem-log` (tab bar visible), `/routes` (paid gate), `/routes/run/<id>` (full-bleed — NO tab bar). All load as before (first `/routes` visit now shows a brief spinner while its chunk loads).
- The bottom tab bar shows the same 5 tabs (Home / Customers / Routes / Plans / Settings), evenly spaced.
- Home → Quick actions: all tiles work; Application + Chemical log now appear at the END of the grid (after Reports).

## Notes for the implementer

- Behavior-identical except the deliberate Home tile reorder (lawn tiles move to the end) and `/routes` becoming a lazy chunk. If anything else renders or routes differently, stop and report.
- Do NOT eager-import any page component in `lawn/shell.tsx` — all four are `lazy` to avoid a startup circular import (spec decision 4).
- Each task's `tsc` gate is "the error set equals the known 6-file baseline, and the file you edited is NOT in it." The 6 baseline files are pre-existing and unrelated; do not try to fix them.
- The `<Suspense>` that wraps `<Routes>` in `App.tsx` already covers the vertical's lazy routes — no per-route Suspense needed.
