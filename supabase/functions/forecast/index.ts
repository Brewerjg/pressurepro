// Forecast edge function — ZIP -> geocode -> OpenWeather One Call 3.0 -> DB cache.
// Returns 7-day daily forecast. Cached per ZIP for 6 hours.
//
// Ported verbatim from PressurePro's supabase/functions/forecast/index.ts so
// the cache row shape matches the existing weather_cache table in the shared
// Supabase project. Secrets (OPENWEATHER_API_KEY) are configured at the
// project level.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface DailyForecast {
  date: string; // YYYY-MM-DD
  conditions: string;
  precipChance: number; // 0-100
  high: number; // °F
  low: number; // °F
  rainExpected: boolean;
  icon: string;
  windMph: number; // mph
  // Convenience tokens for the client's derived_tone math — kept on the
  // server so every caller sees the same condition bucket.
  condition: "sun" | "cloud" | "rain" | "snow";
}

interface OpenWeatherDaily {
  dt: number;
  temp: { min: number; max: number };
  weather: Array<{ main: string; description: string; icon: string }>;
  pop: number; // 0..1
  wind_speed?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const zipRaw = (url.searchParams.get("zip") || "").trim();
    const country = (url.searchParams.get("country") || "US").toUpperCase();
    if (!zipRaw) {
      return json({ error: "zip query param required" }, 400);
    }
    // Basic ZIP cleaning — accept "12345" or "12345-6789" (US) or alphanumeric (other).
    const zip = zipRaw.replace(/\s+/g, "").slice(0, 12);

    const apiKey = Deno.env.get("OPENWEATHER_API_KEY");
    if (!apiKey) return json({ error: "Weather not configured yet." }, 500);

    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supaUrl, serviceKey);

    // 1. Try cache
    const { data: cached } = await supabase
      .from("weather_cache")
      .select("*")
      .eq("zip", zip)
      .eq("country", country)
      .maybeSingle();

    const fresh = cached && (Date.now() - new Date(cached.fetched_at).getTime() < CACHE_TTL_MS);
    if (fresh) {
      return json({
        zip, country,
        lat: Number(cached.lat), lng: Number(cached.lng),
        daily: cached.daily as DailyForecast[],
        cached: true,
        fetched_at: cached.fetched_at,
      });
    }

    // 2. Geocode ZIP -> lat/lng (OpenWeather geocoding by zip)
    const geoRes = await fetch(`https://api.openweathermap.org/geo/1.0/zip?zip=${encodeURIComponent(zip)},${country}&appid=${apiKey}`);
    if (!geoRes.ok) {
      const body = await geoRes.text();
      return json({ error: `Geocode failed [${geoRes.status}]: ${body}` }, 502);
    }
    const geo = await geoRes.json() as { lat: number; lon: number; name?: string };
    if (typeof geo.lat !== "number" || typeof geo.lon !== "number") {
      return json({ error: "Invalid geocode response" }, 502);
    }

    // 3. One Call 4.0 — daily timeline endpoint, imperial units.
    //
    // OpenWeather released v4.0 as a separate product from v3.0 sometime
    // in 2026. The "One Call by Call" subscription now grants access to
    // v4.0 only — NOT v3.0 — so this function targets v4.0. Endpoint shape:
    //
    //   /data/4.0/onecall/timeline/1day?lat=&lon=&units=imperial&appid=
    //
    // Response wraps days in a `data[]` array (vs v3.0's `daily[]`).
    // Per-day field shape (temp.min/max, weather[], pop, wind_speed) is
    // unchanged from v3.0, so the mapping below stays the same.
    // A single call returns up to 10 days; we slice to 7.
    const ocRes = await fetch(
      `https://api.openweathermap.org/data/4.0/onecall/timeline/1day?lat=${geo.lat}&lon=${geo.lon}&units=imperial&appid=${apiKey}`,
    );
    if (!ocRes.ok) {
      const body = await ocRes.text();
      return json({ error: `OneCall failed [${ocRes.status}]: ${body}` }, 502);
    }
    const oc = await ocRes.json() as { data?: OpenWeatherDaily[]; daily?: OpenWeatherDaily[] };
    // Prefer v4.0's `data[]`; fall back to v3.0's `daily[]` in case OpenWeather
    // ever changes the shape back, or if an older endpoint slips through.
    const dailyRaw = oc.data ?? oc.daily ?? [];

    const daily: DailyForecast[] = dailyRaw.slice(0, 7).map((d) => {
      const date = new Date(d.dt * 1000).toISOString().slice(0, 10);
      const precipChance = Math.round((d.pop ?? 0) * 100);
      const w = d.weather?.[0];
      const main = (w?.main ?? "").toLowerCase();
      let condition: DailyForecast["condition"] = "sun";
      if (main.includes("snow")) condition = "snow";
      else if (main.includes("rain") || main.includes("drizzle") || main.includes("thunder")) condition = "rain";
      else if (main.includes("cloud")) condition = "cloud";
      return {
        date,
        conditions: w?.description ? capitalize(w.description) : (w?.main ?? "Unknown"),
        precipChance,
        high: Math.round(d.temp?.max ?? 0),
        low: Math.round(d.temp?.min ?? 0),
        rainExpected: precipChance >= 50,
        icon: w?.icon ?? "01d",
        windMph: Math.round(d.wind_speed ?? 0),
        condition,
      };
    });

    // 4. Upsert cache
    await supabase.from("weather_cache").upsert({
      zip,
      country,
      lat: geo.lat,
      lng: geo.lon,
      daily,
      fetched_at: new Date().toISOString(),
    }, { onConflict: "zip,country" });

    return json({
      zip, country, lat: geo.lat, lng: geo.lon, daily, cached: false,
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("forecast error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
