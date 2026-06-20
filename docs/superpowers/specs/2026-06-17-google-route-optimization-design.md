# Google Routes API — route optimization engine swap

**Date:** 2026-06-17
**Status:** Approved design, pending spec review → implementation plan

## Problem

Route optimization already exists and works, but on a **Mapbox + local-heuristic**
stack:
- `geocode` edge fn → Mapbox geocoding → `properties.lat/lng`
- `drive-matrix` edge fn → Mapbox → per-leg drive time/miles
- `src/lib/route-optimize.ts` → `nearestNeighborOrder` (local heuristic) picks order
- Runs automatically in `Routes.tsx` when a route is started/created, filling
  `route_stops.sort_order` + `drive_minutes_from_prev` / `drive_miles_from_prev`.

The operator has a **Google Maps Platform API key** (`AIza…`, Routes API).
Google's `computeRoutes` with `optimizeWaypointOrder:true` does, in **one call**,
both jobs the current code splits across Mapbox + the heuristic: it returns the
optimal stop order *and* per-leg distance/duration, and it's a true optimizer
rather than nearest-neighbor. It also accepts plain addresses (geocodes
internally), so a separate geocode step isn't required for routing.

## Decisions (locked with the user)

1. **Replace the engine.** Google `computeRoutes(optimizeWaypointOrder)` becomes
   THE optimizer + drive-time source. Retire `lib/route-optimize.ts`
   (nearest-neighbor) and the Mapbox `drive-matrix` edge fn + `lib/drive-matrix.ts`.
2. **Home base (round trip).** Add an optional operator **start address** to the
   Business Profile. When set, optimize `base → … → base`. When unset, fall back
   to first-stop start, destination = last optimized stop.
3. **Auto-apply with Undo** for on-demand re-optimization (a "Re-optimize"
   button); route creation stays auto-optimized as it is today.
4. The Google key is a server-side secret; the browser never sees it.

## Components

### 1. New edge function `optimize-route`

A thin Google proxy (mirrors how `drive-matrix` wrapped Mapbox), so the API key
never reaches the client.

- **Input:** `{ origin: string, destination: string, waypoints: string[] }`
  (all addresses; `waypoints` are the intermediate stops in current order).
- **Call:** `POST https://routes.googleapis.com/directions/v2:computeRoutes`
  - Headers: `X-Goog-Api-Key: <GOOGLE_ROUTES_API_KEY>`,
    `X-Goog-FieldMask: routes.optimizedIntermediateWaypointIndex,routes.legs.distanceMeters,routes.legs.duration`
  - Body: `origin`/`destination` as `{ address }`, `intermediates` as
    `[{ address }]`, `travelMode: "DRIVE"`, `optimizeWaypointOrder: true`.
- **Output:** `{ order: number[], legs: Array<{ minutes: number, miles: number }> }`
  - `order` = `optimizedIntermediateWaypointIndex` (maps optimized position →
    original `waypoints` index).
  - `legs` = parsed from `routes[0].legs` (`distanceMeters` → miles,
    `duration` "123s" → minutes), aligned to the optimized sequence.
- **Auth:** invoked from the app with the anon key, so platform JWT verification
  stays **ON** (`verify_jwt` default true — do NOT add `--no-verify-jwt`; this is
  not an external webhook).
- **Secret:** `GOOGLE_ROUTES_API_KEY` set via `supabase secrets set`. Single
  platform key (not per-app); billed to the platform Google project.

### 2. Home base — operator start address

- Add `profiles.route_start_address TEXT` (nullable). (Optionally
  `route_start_lat/lng` later for map display; not required since Google geocodes
  the address string.)
- Surface a "Route start address (shop/home)" field in
  `src/components/settings/BusinessProfile.tsx`.
- This satisfies the existing `TODO(profiles.lat/lng)` in `Routes.tsx`.

### 3. `Routes.tsx` create-route flow

Replace the `nearestNeighborOrder` + `orderedCoords`/`fetchDriveMatrix` block
(~lines 439–530) with a single `optimize-route` call:
- Build `waypoints` from each stop's address (`address_snapshot` or the joined
  property address) in current plan order.
- `origin`/`destination`: the profile's `route_start_address` for a round trip;
  else origin = first stop, destination = last stop.
- Apply returned `order` to reorder the stops; persist `sort_order` in gaps of 10
  and `drive_minutes_from_prev` / `drive_miles_from_prev` from `legs` — exactly
  the existing persistence shape (no schema change to `route_stops`).

### 4. "Re-optimize" button

On the selected **planned** route in `Routes.tsx`:
- Calls `optimize-route` for the current pending stops, auto-applies the new order
  (bulk `sort_order` write), and shows an **Undo** snackbar that restores the prior
  order.
- Only **pending** stops reorder; `done` / `in_progress` / `skipped` stay pinned
  at their `sort_order` (matches the existing `computeReorderedSortOrders` rule).

## Retire / keep

- **Retire** (after confirming no other callers): `src/lib/route-optimize.ts`,
  `src/lib/drive-matrix.ts`, the `drive-matrix` edge function.
- **Geocode (`src/lib/geocode.ts` + `geocode` edge fn):** keep only if
  `properties.lat/lng` is consumed elsewhere (e.g., a map view). If nothing else
  uses it, retire it too. Verify during implementation before deleting.

## Edge cases & cost

- **> 25 stops:** `optimizeWaypointOrder` caps at 25 intermediate waypoints. Above
  that, skip optimization with a surfaced warning (keep default order). Lawn routes
  are typically 8–15 stops, so this is rare. (Chunking is a future enhancement.)
- **Google failure / missing key / unresolvable address:** degrade gracefully —
  keep the default plan order, leave drive times null, surface a non-blocking
  warning. No nearest-neighbor fallback (it's retired).
- **< 2 stops:** no-op (nothing to optimize).
- **Billing:** `optimizeWaypointOrder` is billed on Google's Advanced Routes tier
  (higher per-call cost than basic routing) — operator/platform cost awareness.

## Testing

- **Edge fn:** mocked Google response → correct `order` + `legs` mapping
  (meters→miles, "Ns"→minutes); Google error → graceful `{ error }` shape, 200-safe
  for the caller's degrade path.
- **Create-route:** stops persisted in Google's order with leg times; base-set
  (round trip) vs base-unset (first/last anchored); < 2 stops no-op; > 25 warning.
- **Re-optimize button:** pending-only reorder, pinned stops unchanged, Undo
  restores prior `sort_order`.

## Build order (for the implementation plan)

1. Migration: `profiles.route_start_address` column.
2. `optimize-route` edge function + `GOOGLE_ROUTES_API_KEY` secret; deploy.
3. `src/lib/optimize-route.ts` client wrapper (invoke edge fn, typed result).
4. `BusinessProfile.tsx`: start-address field.
5. `Routes.tsx`: swap create-route block to `optimize-route`; add Re-optimize
   button + Undo.
6. Retire Mapbox drive-matrix + nearest-neighbor (and geocode if unused); remove
   dead imports.
7. Tests + deploy.

## Out of scope (future)

- Multi-crew / fleet VRP (that's Google's Route Optimization API + a service
  account, not this Maps key).
- Chunking routes with > 25 stops.
- Time windows / per-stop service durations.
- Storing optimized polylines for an on-screen map.
