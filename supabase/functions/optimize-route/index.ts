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
      // Bias geocoding of incomplete addresses toward the US. Without it, a
      // bare street like "7501 Guenther rd" resolved to San Antonio TX and
      // produced a 687-mile leg on an Arkansas route (2026-09-23). The
      // client additionally flags any leg > 120 mi so a bad geocode is
      // visible instead of silently inflating totals.
      regionCode: "US",
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
    // -> original waypoints[] index). Google returns the sentinel [-1] when
    // there's nothing to optimize (single waypoint) — and the client treats
    // any out-of-range index as corrupt and DROPS the legs with it, so
    // single-stop routes silently lost their drive metrics. Normalize: any
    // response that isn't a valid permutation of [0..n-1] becomes identity,
    // keeping the legs (which are correct regardless).
    const raw = route.optimizedIntermediateWaypointIndex;
    const identity = waypoints.map((_, i) => i);
    const isValidPermutation =
      Array.isArray(raw) &&
      raw.length === waypoints.length &&
      [...raw].sort((a, b) => a - b).every((v, i) => v === i);
    const order = isValidPermutation ? (raw as number[]) : identity;

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
