// Drive-matrix edge function — given an ordered list of {lat,lng} stops,
// returns per-leg {from_idx, to_idx, minutes, miles} using Mapbox Directions.
//
// Uses Mapbox's /directions endpoint with `overview=false` and `steps=false`
// for compactness. We hash the input sequence so identical "today's route"
// requests come back from `drive_matrix_cache` instead of round-tripping Mapbox.
//
// Cache strategy: rows live ~7 days (see migration 0004). On cache miss we
// fetch + upsert. On configuration miss (no MAPBOX_ACCESS_TOKEN) we return
// 500 with a clean `error` field so the client can render a soft fallback.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Stop {
  lat: number;
  lng: number;
}
interface Leg {
  from_idx: number;
  to_idx: number;
  minutes: number;
  miles: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const { stops } = (await req.json()) as { stops?: Stop[] };
    if (!Array.isArray(stops) || stops.length < 2) {
      return json({ legs: [] satisfies Leg[] });
    }
    // Mapbox Directions supports up to 25 waypoints per request.
    if (stops.length > 25) {
      return json({ error: "Too many stops (max 25)" }, 400);
    }
    for (const s of stops) {
      if (typeof s?.lat !== "number" || typeof s?.lng !== "number") {
        return json({ error: "stops must be [{lat:number, lng:number}, ...]" }, 400);
      }
    }

    const token = Deno.env.get("MAPBOX_ACCESS_TOKEN");
    if (!token) return json({ error: "Drive matrix not configured yet." }, 500);

    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supaUrl, serviceKey);

    // Hash the rounded coords sequence so trivially-different floats don't
    // miss cache. 5 decimals ~= 1.1m precision — way finer than driving
    // distance accuracy.
    const seq = stops
      .map((s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`)
      .join("|");
    const hash = await sha256Hex(seq);

    // 1. Cache lookup
    const { data: cached } = await supabase
      .from("drive_matrix_cache")
      .select("legs, expires_at")
      .eq("sequence_hash", hash)
      .maybeSingle();
    if (cached && new Date(cached.expires_at).getTime() > Date.now()) {
      return json({ legs: cached.legs as Leg[], cached: true });
    }

    // 2. Mapbox Directions — single request for the whole ordered sequence.
    // We use `driving` profile (not `driving-traffic`) because today's
    // forecasted traffic doesn't help — caching for 7 days does.
    const coords = stops.map((s) => `${s.lng},${s.lat}`).join(";");
    const url =
      `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}` +
      `?access_token=${token}&overview=false&steps=false&annotations=duration,distance`;
    const r = await fetch(url);
    if (!r.ok) {
      const body = await r.text();
      return json({ error: `Mapbox ${r.status}: ${body}` }, 502);
    }
    const data = await r.json() as {
      routes?: Array<{ legs?: Array<{ duration?: number; distance?: number }> }>;
    };
    const apiLegs = data.routes?.[0]?.legs ?? [];
    const legs: Leg[] = apiLegs.map((L, i) => ({
      from_idx: i,
      to_idx: i + 1,
      // duration is seconds, distance is meters.
      minutes: Math.round((L.duration ?? 0) / 60),
      miles: Math.round(((L.distance ?? 0) / 1609.344) * 100) / 100,
    }));

    // 3. Upsert cache
    await supabase.from("drive_matrix_cache").upsert(
      { sequence_hash: hash, legs },
      { onConflict: "sequence_hash" },
    );

    return json({ legs, cached: false });
  } catch (e) {
    console.error("drive-matrix error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
