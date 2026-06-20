# Google Routes API Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Mapbox + nearest-neighbor route engine with Google Routes API `computeRoutes(optimizeWaypointOrder)`, so a single call produces both the optimal stop order and per-leg drive time/miles.

**Architecture:** A thin `optimize-route` edge function proxies Google's `computeRoutes` (hiding the API key). `Routes.tsx` calls it during route creation and via a new "Re-optimize" button, then persists `sort_order` + `drive_minutes/miles_from_prev` exactly as today. An optional operator "start address" (`profiles.route_start_address`) anchors the route as a round trip. The Mapbox `drive-matrix` and the `nearestNeighborOrder` heuristic are retired.

**Tech Stack:** Supabase Edge Functions (Deno), React + react-query (Vite), Google Maps Platform Routes API, PostgreSQL. **No unit-test runner exists** — verification is `npx tsc --noEmit`, `npm run build`, edge-function smoke tests via PowerShell, and `supabase db query --linked` checks. Project ref: `dkksryutecjbyuscpxdb`. Migrations are applied with `db query -f` (NOT `db push` — remote has no migration history).

---

## File Structure

- **Create** `supabase/migrations/0025_route_start_address.sql` — adds `profiles.route_start_address`.
- **Create** `supabase/functions/optimize-route/index.ts` — Google `computeRoutes` proxy.
- **Create** `src/lib/optimize-route.ts` — typed client wrapper for the edge fn.
- **Modify** `src/components/settings/BusinessProfile.tsx` — add the start-address field.
- **Modify** `src/pages/Routes.tsx` — swap the create-route optimization block; add Re-optimize button + Undo.
- **Delete (after confirming no other callers)** `src/lib/drive-matrix.ts`, `src/lib/route-optimize.ts`, `supabase/functions/drive-matrix/index.ts`.

---

## Task 1: Add `profiles.route_start_address` column

**Files:**
- Create: `supabase/migrations/0025_route_start_address.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0025_route_start_address.sql
-- Optional operator start location (shop/home). Used by route optimization as
-- the round-trip origin/destination. Plain address string — Google geocodes it.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS route_start_address TEXT;

COMMENT ON COLUMN public.profiles.route_start_address IS
  'Operator shop/home address; route optimization uses it as the round-trip start/end. Null = fall back to the first stop.';
```

- [ ] **Step 2: Apply to the linked remote DB**

Run:
```
npx --yes supabase@latest db query --linked -f "supabase/migrations/0025_route_start_address.sql"
```
Expected: JSON with empty `rows` and no error.

- [ ] **Step 3: Verify the column exists**

Run:
```
npx --yes supabase@latest db query --linked "select column_name from information_schema.columns where table_name='profiles' and column_name='route_start_address';"
```
Expected: one row, `route_start_address`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0025_route_start_address.sql
git commit -m "feat(routes): add profiles.route_start_address for route optimization start point"
```

---

## Task 2: `optimize-route` edge function

**Files:**
- Create: `supabase/functions/optimize-route/index.ts`

Mirrors the structure of `supabase/functions/drive-matrix/index.ts` (CORS, `json()` helper, graceful `{ error }` on misconfig).

- [ ] **Step 1: Write the edge function**

```ts
// optimize-route edge function — Google Routes API computeRoutes proxy.
//
// Given an origin, destination, and intermediate waypoints (all addresses),
// returns the optimized visit order for the waypoints plus per-leg drive
// time/miles. One call replaces the Mapbox drive-matrix + nearest-neighbor
// heuristic. Key is server-side only (GOOGLE_ROUTES_API_KEY).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  origin?: string;
  destination?: string;
  waypoints?: string[];
}
interface Leg {
  minutes: number;
  miles: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const { origin, destination, waypoints } = (await req.json()) as Body;
    if (!origin || !destination || !Array.isArray(waypoints)) {
      return json({ error: "origin, destination, and waypoints[] are required" }, 400);
    }
    // optimizeWaypointOrder supports up to 25 intermediate waypoints.
    if (waypoints.length > 25) {
      return json({ error: "Too many stops (max 25 intermediate waypoints)" }, 400);
    }
    if (waypoints.length === 0) {
      return json({ order: [], legs: [] satisfies Leg[] });
    }

    const key = Deno.env.get("GOOGLE_ROUTES_API_KEY");
    if (!key) return json({ error: "Route optimization not configured yet." }, 500);

    const reqBody = {
      origin: { address: origin },
      destination: { address: destination },
      intermediates: waypoints.map((address) => ({ address })),
      travelMode: "DRIVE",
      optimizeWaypointOrder: true,
    };
    const r = await fetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask":
            "routes.optimizedIntermediateWaypointIndex,routes.legs.distanceMeters,routes.legs.duration",
        },
        body: JSON.stringify(reqBody),
      },
    );
    if (!r.ok) {
      const body = await r.text();
      return json({ error: `Google ${r.status}: ${body}` }, 502);
    }
    const data = (await r.json()) as {
      routes?: Array<{
        optimizedIntermediateWaypointIndex?: number[];
        legs?: Array<{ distanceMeters?: number; duration?: string }>;
      }>;
    };
    const route = data.routes?.[0];
    if (!route) return json({ error: "Google returned no route" }, 502);

    // Optimized order of the intermediate waypoints (maps optimized position
    // -> original waypoints[] index). Fall back to identity if absent.
    const order = route.optimizedIntermediateWaypointIndex ?? waypoints.map((_, i) => i);

    // legs[k] is the drive arriving at the k-th point AFTER origin:
    //   legs[0] = origin -> first optimized waypoint
    //   legs[order.length] = last optimized waypoint -> destination
    const legs: Leg[] = (route.legs ?? []).map((L) => ({
      minutes: Math.round(parseDurationSeconds(L.duration) / 60),
      miles: Math.round((Number(L.distanceMeters ?? 0) / 1609.344) * 100) / 100,
    }));

    return json({ order, legs });
  } catch (e) {
    console.error("optimize-route error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// Google durations are strings like "123s". Returns seconds (0 if unparseable).
function parseDurationSeconds(d?: string): number {
  if (!d) return 0;
  const n = Number(String(d).replace(/s$/, ""));
  return Number.isFinite(n) ? n : 0;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 2: Set the Google key secret**

The user supplies their `AIza…` key. Run (user runs this themselves via `!` to keep the key out of the transcript, or paste-and-set):
```
npx --yes supabase@latest secrets set GOOGLE_ROUTES_API_KEY=AIza...realkey --project-ref dkksryutecjbyuscpxdb
```
Expected: `Finished supabase secrets set.`

- [ ] **Step 3: Deploy the function (JWT stays ON — it's called from the app with the anon key, not an external webhook)**

Run:
```
npx --yes supabase@latest functions deploy optimize-route --project-ref dkksryutecjbyuscpxdb
```
Expected: `Deployed Functions on project dkksryutecjbyuscpxdb: optimize-route`

- [ ] **Step 4: Smoke-test with real addresses (PowerShell)**

```powershell
$key = "sb_publishable_yJrk3OzDV3xtEOqDcd7l5w_TfPpEexP"
$h = @{ apikey = $key; Authorization = "Bearer $key"; "Content-Type" = "application/json" }
$body = @{
  origin = "Little Rock, AR"
  destination = "Little Rock, AR"
  waypoints = @("Roland, AR", "Maumelle, AR", "Conway, AR")
} | ConvertTo-Json
Invoke-RestMethod -Uri "https://dkksryutecjbyuscpxdb.supabase.co/functions/v1/optimize-route" -Method Post -Headers $h -Body $body | ConvertTo-Json -Depth 4
```
Expected: `{ "order": [ ... ], "legs": [ { "minutes": N, "miles": N }, ... ] }` with `order.length == 3` and `legs.length == 4` (origin→w, w→w, w→w, w→destination). If it returns `Route optimization not configured yet.`, the secret didn't propagate — wait ~30s and retry. If `Google 403 … REQUEST_DENIED`, the Routes API isn't enabled on the key — enable "Routes API" in Google Cloud Console.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/optimize-route/index.ts
git commit -m "feat(routes): add optimize-route edge function (Google computeRoutes proxy)"
```

---

## Task 3: Client wrapper `src/lib/optimize-route.ts`

**Files:**
- Create: `src/lib/optimize-route.ts`

Mirrors `src/lib/drive-matrix.ts` (raw async call form).

- [ ] **Step 1: Write the wrapper**

```ts
// optimize-route helper — wraps the `optimize-route` edge function (Google
// Routes API). Returns the optimized order of the supplied waypoints plus
// per-leg drive time/miles. Server hides the Google key.
import { supabase } from "@/integrations/supabase/client";

export interface OptimizeLeg {
  minutes: number;
  miles: number;
}

export interface OptimizeResult {
  /** Optimized order: each entry is an index into the input `waypoints`. */
  order: number[];
  /**
   * Per-leg drive metrics along the optimized path. legs[0] is origin -> first
   * optimized waypoint; legs[order.length] is last waypoint -> destination.
   */
  legs: OptimizeLeg[];
}

interface EdgePayload {
  order?: number[];
  legs?: OptimizeLeg[];
  error?: string;
}

/**
 * Optimize the visit order of `waypoints` (addresses) between `origin` and
 * `destination` (addresses). Throws on infrastructure/config failure so the
 * caller can fall back to the unoptimized order.
 */
export async function optimizeRoute(args: {
  origin: string;
  destination: string;
  waypoints: string[];
}): Promise<OptimizeResult> {
  if (args.waypoints.length === 0) return { order: [], legs: [] };
  const { data, error } = await supabase.functions.invoke<EdgePayload>(
    "optimize-route",
    { body: args },
  );
  if (error) throw new Error(error.message ?? "optimize-route failed");
  if (!data) throw new Error("Empty optimize-route response");
  if (data.error) throw new Error(data.error);
  return { order: data.order ?? [], legs: data.legs ?? [] };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/optimize-route.ts
git commit -m "feat(routes): add optimize-route client wrapper"
```

---

## Task 4: Business Profile start-address field

**Files:**
- Modify: `src/components/settings/BusinessProfile.tsx`

- [ ] **Step 1: Add `route_start_address` to the Draft type and empty draft**

Replace:
```ts
type Draft = {
  business_name: string;
  phone: string;
  zip: string;
};

const emptyDraft: Draft = { business_name: "", phone: "", zip: "" };
```
with:
```ts
type Draft = {
  business_name: string;
  phone: string;
  zip: string;
  route_start_address: string;
};

const emptyDraft: Draft = { business_name: "", phone: "", zip: "", route_start_address: "" };
```

- [ ] **Step 2: Hydrate it from the profile**

In the `useEffect` that calls `setDraft`, replace the object with:
```ts
    setDraft({
      business_name: profile.business_name ?? "",
      phone: profile.phone ?? "",
      zip: profile.zip ?? "",
      route_start_address: (profile as { route_start_address?: string | null }).route_start_address ?? "",
    });
```
(The `route_start_address` cast is needed until Supabase types are regenerated; the codebase already uses `(supabase as any)` for new columns.)

- [ ] **Step 3: Persist it in the save payload**

In `saveMutation`, replace the `payload` object with:
```ts
      const payload = {
        business_name: next.business_name.trim() || null,
        phone: next.phone.trim() || null,
        zip: next.zip.trim() || null,
        route_start_address: next.route_start_address.trim() || null,
      };
```

- [ ] **Step 4: Extend the change-detection in `handleBlur`**

Replace the `changed` expression with:
```ts
    const changed =
      (profile.business_name ?? "") !== draft.business_name ||
      (profile.phone ?? "") !== draft.phone ||
      (profile.zip ?? "") !== draft.zip ||
      ((profile as { route_start_address?: string | null }).route_start_address ?? "") !== draft.route_start_address;
```
And in the `!profile` branch of `handleBlur`, replace the condition with:
```ts
      if (draft.business_name || draft.phone || draft.zip || draft.route_start_address) {
```

- [ ] **Step 5: Add the input field to the JSX**

Immediately after the closing `</div>` of the `grid grid-cols-2` block (the Phone/ZIP row), insert:
```tsx
          <Field label="Route start address (shop/home)">
            <input
              value={draft.route_start_address}
              onChange={(e) =>
                setDraft((d) => ({ ...d, route_start_address: e.target.value }))
              }
              onBlur={handleBlur}
              placeholder="123 Main St, Roland, AR 72135"
              className={inputCls}
            />
          </Field>
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/BusinessProfile.tsx
git commit -m "feat(routes): add route start address field to Business Profile"
```

---

## Task 5: Swap the create-route optimization block in `Routes.tsx`

**Files:**
- Modify: `src/pages/Routes.tsx` (imports ~line 30; create-route block ~lines 390–555)

Goal: replace the geocode loop + `nearestNeighborOrder` + `fetchDriveMatrix` block with one `optimizeRoute` call. The `plans` array, `routeId`, and `stopRows` insert remain.

- [ ] **Step 1: Update imports**

Remove:
```ts
import { fetchDriveMatrix, type DriveStop } from "@/lib/drive-matrix";
```
(and the `nearestNeighborOrder` / `geocodeAddress` imports — find their exact import lines near the top of the file and delete them).
Add:
```ts
import { optimizeRoute } from "@/lib/optimize-route";
```

- [ ] **Step 2: Fetch the operator's start address alongside the existing data**

Near the top of `startRouteMutation`'s `mutationFn` (after `if (!user) throw …`), add:
```ts
      // Operator start/home address for round-trip optimization (null = fall
      // back to the first stop as the pivot).
      const { data: profileRow } = await (supabase as any)
        .from("profiles")
        .select("route_start_address")
        .eq("user_id", user.id)
        .maybeSingle();
      const startAddress: string | null = profileRow?.route_start_address ?? null;
```

- [ ] **Step 3: Replace the whole block from the geocode comment through the `stopRows` build**

Delete everything from the comment `// Resolve property coordinates...` (~line 391) down to and including the `const stopRows = orderedPlans.map(...)` assignment (~line 551), and replace with:

```ts
        // -------------------------------------------------------------
        // Google Routes optimization. Build waypoint addresses from each
        // plan's address, optimize between a pivot (operator start address
        // if set, else the first stop), and persist the returned order +
        // per-leg drive metrics. All failures are non-fatal — on error we
        // keep the plan order and leave drive times null.
        // -------------------------------------------------------------
        const addrOf = (p: any): string | null => (p.address ?? null);
        const pivot = (startAddress && startAddress.trim()) || null;

        // waypointPlans = the plans Google reorders. With a pivot (base) all
        // plans are waypoints; without one, the first plan is the fixed
        // start/end pivot and the rest are reordered.
        const firstPlan = plans[0];
        const waypointPlans: any[] = pivot ? plans : plans.slice(1);
        const originAddr = pivot ?? addrOf(firstPlan);
        const destAddr = originAddr;

        // legByPlanId: plan id -> { minutes, miles } drive arriving at it.
        const legByPlanId = new Map<string, { minutes: number; miles: number }>();
        let orderedPlans: any[] = plans;

        const waypointAddrs = waypointPlans.map(addrOf);
        const allHaveAddrs = originAddr != null && waypointAddrs.every((a) => !!a);

        if (originAddr && waypointPlans.length >= 2 && allHaveAddrs) {
          try {
            const { order, legs } = await optimizeRoute({
              origin: originAddr,
              destination: destAddr!,
              waypoints: waypointAddrs as string[],
            });
            // order permutes waypointPlans. legs[k] arrives at optimized
            // waypoint k (legs[0] = origin -> first waypoint).
            const orderedWaypoints = order.map((i) => waypointPlans[i]);
            // Defensive: if Google dropped/duplicated indices, fall back.
            if (orderedWaypoints.length === waypointPlans.length && orderedWaypoints.every(Boolean)) {
              orderedPlans = pivot ? orderedWaypoints : [firstPlan, ...orderedWaypoints];
              for (let k = 0; k < orderedWaypoints.length; k++) {
                const leg = legs[k];
                if (leg) legByPlanId.set(orderedWaypoints[k].id, leg);
              }
            }
          } catch (e) {
            console.warn("[Routes] optimize-route failed; keeping plan order", e);
          }
        }

        // Persist with sort_order in gaps of 10 (10, 20, 30...). Drive metrics
        // come from legByPlanId; the first stop has no arriving leg when there
        // is no pivot (base), matching the prior "–" convention.
        const stopRows = orderedPlans.map((p: any, i: number) => {
          const leg = legByPlanId.get(p.id) ?? null;
          return {
            user_id: user.id,
            route_id: routeId,
            plan_id: p.id,
            property_id: p.property_id,
            customer_id: p.customer_id,
            address_snapshot: p.address ?? null,
            customer_name_snapshot: p.customer_name ?? null,
            services: p.services ?? [],
            fee_cents: p.amount != null ? Math.round(Number(p.amount) * 100) : null,
            sort_order: (i + 1) * 10,
            status: "pending",
            drive_minutes_from_prev: leg ? leg.minutes : null,
            drive_miles_from_prev: leg ? leg.miles : null,
          };
        });
```

(Leave the existing `const { error: stopsErr } = await (supabase as any).from("route_stops").insert(stopRows);` line and everything after it unchanged.)

- [ ] **Step 4: Keep the "just optimized" pill working**

If the code sets `setJustOptimizedRouteId(routeId)` in `onSuccess` for freshly-created routes, leave it. (It's display-only; no change needed.) Verify nothing else in the mutation references the deleted `propsById`, `orderedCoords`, `legMinutes`, `legMiles`, `coordStops`, `DriveStop`, or `nearestNeighborOrder` symbols — remove any stragglers.

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.
Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Routes.tsx
git commit -m "feat(routes): optimize new routes via Google computeRoutes (replaces Mapbox+NN)"
```

---

## Task 6: "Re-optimize" button + Undo on a planned route

**Files:**
- Modify: `src/pages/Routes.tsx` (the selected-route UI region + a new mutation)

Reorders only **pending** stops; `done`/`in_progress`/`skipped` stay pinned. Auto-applies, with an Undo that restores prior `sort_order`.

- [ ] **Step 1: Add a re-optimize mutation inside the component**

After the existing `startRouteMutation` definition, add:
```ts
  // Snapshot for Undo: previous (id -> sort_order) before a re-optimize.
  const [undoOrder, setUndoOrder] = useState<Map<string, number> | null>(null);

  const reoptimizeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRoute) throw new Error("No route selected");
      // Only pending stops are reorderable.
      const pending = [...(selectedRoute.route_stops ?? [])]
        .filter((s: any) => s.status === "pending")
        .sort((a: any, b: any) => a.sort_order - b.sort_order);
      if (pending.length < 2) throw new Error("Need at least 2 pending stops to optimize");

      const { data: profileRow } = await (supabase as any)
        .from("profiles")
        .select("route_start_address")
        .eq("user_id", user!.id)
        .maybeSingle();
      const pivot: string | null = (profileRow?.route_start_address ?? "").trim() || null;

      const addrOf = (s: any): string | null => s.address_snapshot ?? null;
      const firstStop = pending[0];
      const waypointStops: any[] = pivot ? pending : pending.slice(1);
      const originAddr = pivot ?? addrOf(firstStop);
      const waypointAddrs = waypointStops.map(addrOf);
      if (!originAddr || !waypointAddrs.every(Boolean)) {
        throw new Error("Some stops are missing an address");
      }

      const { order, legs } = await optimizeRoute({
        origin: originAddr,
        destination: originAddr,
        waypoints: waypointAddrs as string[],
      });
      const orderedWaypoints = order.map((i) => waypointStops[i]);
      if (orderedWaypoints.length !== waypointStops.length || !orderedWaypoints.every(Boolean)) {
        throw new Error("Optimizer returned an inconsistent order");
      }
      const orderedStops = pivot ? orderedWaypoints : [firstStop, ...orderedWaypoints];

      // Snapshot prior order for Undo.
      const prev = new Map<string, number>();
      for (const s of pending) prev.set(s.id, s.sort_order);

      // Persist new sort_order (gaps of 10) + drive metrics. Pending stops only.
      await Promise.all(
        orderedStops.map((s: any, i: number) => {
          const leg = pivot ? legs[i] : i === 0 ? null : legs[i - 1];
          return (supabase as any)
            .from("route_stops")
            .update({
              sort_order: (i + 1) * 10,
              drive_minutes_from_prev: leg ? leg.minutes : null,
              drive_miles_from_prev: leg ? leg.miles : null,
            })
            .eq("id", s.id);
        }),
      );
      return prev;
    },
    onSuccess: (prev) => {
      setUndoOrder(prev);
      queryClient.invalidateQueries({ queryKey: ["routes-week"] });
    },
  });

  const undoReoptimize = useMutation({
    mutationFn: async () => {
      if (!undoOrder) return;
      await Promise.all(
        Array.from(undoOrder.entries()).map(([id, sort_order]) =>
          (supabase as any).from("route_stops").update({ sort_order }).eq("id", id),
        ),
      );
    },
    onSuccess: () => {
      setUndoOrder(null);
      queryClient.invalidateQueries({ queryKey: ["routes-week"] });
    },
  });
```
NOTE: confirm the routes query key — it is defined where `useQuery({ queryKey: [...] })` fetches `"*, route_stops(*)"` (search for `route_stops(*)` near line 173). Use that exact key in both `invalidateQueries` calls instead of `["routes-week"]` if it differs.

- [ ] **Step 2: Add the button + Undo snackbar to the selected-route UI**

Find where the selected route's header/actions render (search for `selectedRoute` in JSX, near the "Start"/"Resume" button). Add, only when `selectedRoute?.status === "planned"`:
```tsx
            <button
              type="button"
              onClick={() => reoptimizeMutation.mutate()}
              disabled={reoptimizeMutation.isPending}
              className="h-9 px-3 rounded-xl border border-ink-200 bg-card text-ink-700 text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {reoptimizeMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="h-3.5 w-3.5" />
              )}
              Re-optimize
            </button>
```
And render an Undo affordance when `undoOrder` is set (place near the route header):
```tsx
            {undoOrder && (
              <div className="mx-4 mb-2 flex items-center justify-between rounded-xl bg-green-50 px-3 py-2 text-[12px] text-green-800">
                <span>Route re-optimized.</span>
                <button
                  type="button"
                  onClick={() => undoReoptimize.mutate()}
                  disabled={undoReoptimize.isPending}
                  className="font-bold underline disabled:opacity-60"
                >
                  Undo
                </button>
              </div>
            )}
```
Add `Wand2` and (if not already imported) `Loader2` to the `lucide-react` import at the top of the file.

- [ ] **Step 3: Handle errors visibly**

Below the button, surface failures:
```tsx
            {reoptimizeMutation.isError && (
              <p className="mx-4 mb-2 text-[12px] text-destructive">
                {reoptimizeMutation.error instanceof Error
                  ? reoptimizeMutation.error.message
                  : "Couldn't optimize the route."}
              </p>
            )}
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit -p tsconfig.json` → exit 0.
Run: `npm run build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Routes.tsx
git commit -m "feat(routes): add Re-optimize button with Undo on planned routes"
```

---

## Task 7: Retire the Mapbox drive-matrix + nearest-neighbor engine

**Files:**
- Delete: `src/lib/drive-matrix.ts`, `src/lib/route-optimize.ts`, `supabase/functions/drive-matrix/index.ts`

- [ ] **Step 1: Confirm no remaining callers**

Run:
```
npx --yes rg -n "drive-matrix|fetchDriveMatrix|useDriveMatrix|nearestNeighborOrder|route-optimize" src/ supabase/functions/ || echo "NO REFERENCES"
```
Expected: only matches inside the files being deleted (and the `useDriveMatrix` hook if it is unused). If any OTHER file imports them, STOP and migrate that caller first — do not delete.

- [ ] **Step 2: Decide on geocode**

Run:
```
npx --yes rg -n "geocodeAddress|lib/geocode|from\\(\"properties\"\\).*lat|properties.*lat" src/ || echo "NO GEOCODE/LAT USAGE"
```
If `geocodeAddress` / `properties.lat` are used ONLY by the now-deleted Routes block, also delete `src/lib/geocode.ts` and `supabase/functions/geocode/index.ts`. If used elsewhere (e.g., a map view), KEEP them. Record the decision in the commit message.

- [ ] **Step 3: Delete the retired files**

```bash
git rm src/lib/drive-matrix.ts src/lib/route-optimize.ts
git rm -r supabase/functions/drive-matrix
```

- [ ] **Step 4: Typecheck + build to prove nothing broke**

Run: `npx tsc --noEmit -p tsconfig.json` → exit 0.
Run: `npm run build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(routes): retire Mapbox drive-matrix + nearest-neighbor engine (replaced by Google)"
```

---

## Task 8: End-to-end verification

- [ ] **Step 1: Optimization runs on a real route**

Start the dev server (`npm run dev`), set a Route start address in Settings → Business Profile, and Start a route for a weekday that has active plans with addresses. Confirm the stops render in an order that differs from raw plan order and show non-null drive times.

- [ ] **Step 2: Confirm persisted data**

Run (replace `<route_id>` with the new route's id, visible in the URL or via a recent-routes query):
```
npx --yes supabase@latest db query --linked "select sort_order, customer_name_snapshot, drive_minutes_from_prev, drive_miles_from_prev from route_stops where route_id='<route_id>' order by sort_order;"
```
Expected: stops ordered by `sort_order` (10,20,30…), with `drive_minutes_from_prev` populated (first stop null unless a start address was set).

- [ ] **Step 3: Re-optimize + Undo**

Manually drag a stop (if drag exists) or just tap Re-optimize, confirm order changes, tap Undo, confirm it reverts.

- [ ] **Step 4: Graceful degrade**

Temporarily rename the secret (`GOOGLE_ROUTES_API_KEY_OFF`), start a route, confirm it still creates with plan order + null drive times and a console warning (no crash). Restore the secret afterward.

---

## Self-review notes (for the implementer)

- **Spec coverage:** Task 1 = start address column; Task 2 = edge fn + key; Task 3 = client wrapper; Task 4 = Settings field; Task 5 = create-route swap; Task 6 = Re-optimize + Undo; Task 7 = retire Mapbox/NN; Task 8 = verification + degrade. All spec sections covered.
- **>25 waypoints:** handled by the edge fn (400 "Too many stops"); the create-route caller treats any throw as "keep plan order" (graceful), satisfying the spec's skip-with-warning intent. If you want an explicit operator-facing warning above 25, add it in Task 6's error display.
- **Type consistency:** `optimizeRoute({origin,destination,waypoints})` → `{order:number[],legs:{minutes,miles}[]}` is used identically in Tasks 3, 5, 6. `route_start_address` column name is identical in Tasks 1, 4, 5, 6.
