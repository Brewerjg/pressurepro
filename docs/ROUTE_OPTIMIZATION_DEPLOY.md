# Route Optimization — Go-Live Runbook (Google Routes API)

**Feature:** Route optimization engine swapped from Mapbox + nearest-neighbor to
the **Google Routes API** (`computeRoutes` with `optimizeWaypointOrder: true`).
One call returns both the optimal stop order and per-leg drive time/miles.

**Status as of this runbook:** Code is COMMITTED (commit `304f69d`) and
type-checks clean (`npx tsc --noEmit` → exit 0). NOT yet live: migration not
applied, `GOOGLE_ROUTES_API_KEY` secret not set, `optimize-route` edge function
not deployed.

**Project ref:** `dkksryutecjbyuscpxdb`
**Project URL:** `https://dkksryutecjbyuscpxdb.supabase.co`

> ⚠️ **Migrations are applied with `db query -f`, NEVER `db push`.** The remote DB
> has no migration history table, so `db push` will misbehave. Apply migration
> SQL directly.

---

## Pre-flight (already verified by audit — no action needed)

- ✅ `optimize-route/index.ts`: reads `GOOGLE_ROUTES_API_KEY` via `Deno.env`;
  POSTs `computeRoutes` with `optimizeWaypointOrder:true`; correct field mask
  (`routes.optimizedIntermediateWaypointIndex,routes.legs.distanceMeters,routes.legs.duration`);
  handles missing key (500 "not configured"), >25 waypoints (400), empty
  waypoints (200 no-op), and Google errors (502 with body) gracefully.
- ✅ `src/lib/optimize-route.ts`: invokes the fn via `supabase.functions.invoke`,
  throws on infra/`{error}` so the caller can fall back.
- ✅ `Routes.tsx`: create-route calls `optimizeRoute`, wraps it in try/catch so a
  failure keeps plan order (non-blocking); Re-optimize + Undo wired; no
  references to deleted `drive-matrix` / `route-optimize` / `geocode` modules.
- ✅ `BusinessProfile.tsx`: reads/writes `profiles.route_start_address`.
- ✅ Migration `0025` valid + idempotent (`ADD COLUMN IF NOT EXISTS`); column
  name matches what the code reads.
- ✅ `properties.lat/lng` left intact (PropertyDetail.tsx uses it for the Google
  Maps link).
- ✅ `config.toml` has NO `verify_jwt = false` for `optimize-route` → JWT stays
  ON by default (correct — it's called from the app with the anon key, not an
  external webhook).

---

## Step 1 — Apply migration 0025 (adds `profiles.route_start_address`)

```bash
npx --yes supabase@latest db query --linked -f "supabase/migrations/0025_route_start_address.sql"
```
Expected: JSON with empty `rows` and no error.

Verify the column exists:
```bash
npx --yes supabase@latest db query --linked "select column_name from information_schema.columns where table_name='profiles' and column_name='route_start_address';"
```
Expected: one row, `route_start_address`.

> Note: the column is intentionally NOT in the generated `src/integrations/supabase/types.ts`.
> The client reads/writes it through `(supabase as any)` / type casts, so no type
> regeneration is required to ship. (Optional later: regenerate types.)

---

## Step 2 — Set the Google API key secret (USER ACTION)

The operator supplies their `AIza…` key. Run it yourself with a leading space or
via `!` so the key stays out of the transcript:

```bash
npx --yes supabase@latest secrets set GOOGLE_ROUTES_API_KEY=AIza...REALKEY --project-ref dkksryutecjbyuscpxdb
```
Expected: `Finished supabase secrets set.`

> 🔑 **CRITICAL — enable the API on the key.** In Google Cloud Console
> (APIs & Services → Library), enable **"Routes API"** for the project that owns
> this key, and make sure the key's API restrictions allow Routes API. If it's
> not enabled, every call returns `403 … REQUEST_DENIED` and the app silently
> falls back to plan order.
>
> 💲 Billing note: `optimizeWaypointOrder` bills on Google's **Advanced** Routes
> tier (higher per-call cost than basic routing). Expected, but be aware.

---

## Step 3 — Deploy the edge function (JWT ON — do NOT pass `--no-verify-jwt`)

```bash
npx --yes supabase@latest functions deploy optimize-route --project-ref dkksryutecjbyuscpxdb
```
Expected: `Deployed Functions on project dkksryutecjbyuscpxdb: optimize-route`

---

## Step 4 — Smoke test the deployed function (PowerShell)

Uses the project's anon/publishable key as both `apikey` and `Authorization`
(JWT is on, so the call must be authenticated; the anon key satisfies it).

```powershell
$key = "<VITE_SUPABASE_PUBLISHABLE_KEY from .env>"
$h = @{ apikey = $key; Authorization = "Bearer $key"; "Content-Type" = "application/json" }
$body = @{
  origin      = "Little Rock, AR"
  destination = "Little Rock, AR"
  waypoints   = @("Roland, AR", "Maumelle, AR", "Conway, AR")
} | ConvertTo-Json
Invoke-RestMethod -Uri "https://dkksryutecjbyuscpxdb.supabase.co/functions/v1/optimize-route" -Method Post -Headers $h -Body $body | ConvertTo-Json -Depth 4
```

Expected: `{ "order": [ ... ], "legs": [ { "minutes": N, "miles": N }, ... ] }`
with `order.length == 3` and `legs.length == 4` (origin→w, w→w, w→w, w→dest).

Troubleshooting:
- `Route optimization not configured yet.` → secret didn't propagate; wait ~30s
  and retry (or re-check Step 2).
- `Google 403 … REQUEST_DENIED` → Routes API not enabled on the key (see Step 2).
- 401 / "Invalid JWT" → use the publishable/anon key from `.env`
  (`VITE_SUPABASE_PUBLISHABLE_KEY`), not the service-role key.

---

## Step 5 — End-to-end verification in the app

1. **Optimization runs:** `npm run dev`, set a **Route start address** in
   Settings → Business Profile, then Start a route on a weekday that has active
   plans with addresses. Stops should render in an order that differs from raw
   plan order, with non-null drive times. The "Optimized for drive time" pill
   shows when ≥3 stops were reordered.
2. **Confirm persisted data** (replace `<route_id>` from the run URL):
   ```bash
   npx --yes supabase@latest db query --linked "select sort_order, customer_name_snapshot, drive_minutes_from_prev, drive_miles_from_prev from route_stops where route_id='<route_id>' order by sort_order;"
   ```
   Expected: `sort_order` 10,20,30…; `drive_minutes_from_prev` populated (first
   stop populated when a start address is set — base→stop1; null when no start
   address, matching the "–" convention).
3. **Re-optimize + Undo:** on a **planned** route with ≥2 pending stops, tap
   **Re-optimize** → order changes; tap **Undo** → reverts to prior order and
   drive metrics. Done / in_progress / skipped stops stay pinned.
4. **Graceful degrade:** temporarily rename the secret
   (`GOOGLE_ROUTES_API_KEY_OFF`), start a route, confirm it still creates with
   plan order + null drive times and a console warning (`[Routes] optimize-route
   failed; keeping plan order`) — NO crash, route creation not blocked. Restore
   the secret afterward.

---

## Step 6 — Clean up the retired Mapbox edge functions (after you're confident)

The local source for the old functions was deleted, but they may still be
deployed server-side. Once the new flow is verified in production, delete them:

```bash
npx --yes supabase@latest functions delete drive-matrix --project-ref dkksryutecjbyuscpxdb
npx --yes supabase@latest functions delete geocode-address --project-ref dkksryutecjbyuscpxdb
```

> Verify the exact deployed names first:
> `npx --yes supabase@latest functions list --project-ref dkksryutecjbyuscpxdb`
> (the geocode fn may be named `geocode` or `geocode-address`). Do NOT delete
> anything still referenced — `properties.lat/lng` is kept and used by
> PropertyDetail, but routing no longer needs the geocode/drive-matrix fns.

---

## What only the user / operator can do

- **Supply + secure the Google key** (Step 2) and **enable Routes API** in
  Google Cloud Console — this cannot be done from the repo.
- **Run the deploy commands** (Steps 1–3) — this agent does not run the Supabase
  CLI or deploy.
- **Tester clearance:** the route-optimization work was held pending a live
  tester. Get sign-off after Step 5 before announcing GA.
- **Delete the old edge functions** (Step 6) once confident.
