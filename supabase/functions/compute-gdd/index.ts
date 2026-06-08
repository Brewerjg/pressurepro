// compute-gdd edge function — ZIP -> GDD timeline + crabgrass pre-emergent
// window decision.
//
// Growing Degree Days (GDD) is the standard agronomic measure for timing
// soil-temperature-driven applications. Daily GDD = max(0, (high + low)/2 -
// base). The seasonal cumulative sum drives the crabgrass pre-emergent
// window: open at ~100, closing at ~175, missed past ~250 (base 50°F).
//
// Inputs:
//   ?zip=<us-zip>          required
//   ?base=<int>            optional, default 50 (crabgrass)
//   ?country=<iso-2>       optional, default US
//
// Output (JSON):
//   {
//     zip, base_f,
//     today_gdd, cumulative_gdd_ytd,
//     pre_emergent: {
//       status: "too_early" | "open" | "closing" | "missed",
//       opens_eta_days, closes_eta_days, window_summary
//     }
//   }
//
// Caching: 6-hour TTL in public.gdd_cache, keyed by (zip, base_f).
//
// YTD APPROXIMATION (important):
//   OpenWeather One Call only ships a small history window (5 days), which
//   isn't enough to integrate true year-to-date GDD against. Until we wire a
//   real historical-weather source (NOAA Climate Data Online or Visual
//   Crossing), we approximate YTD cumulative GDD with a closed-form sinusoidal
//   estimate driven by latitude + day-of-year. This is "directionally
//   correct" for the alert use case — operators want to know roughly when
//   the window opens in their zip, and the approximation gets us to within a
//   few days for most of the continental US.
// TODO: replace approximateYtdCumulative() with a real integration against
//   NOAA CDO historical daily summaries (or a paid Visual Crossing API call
//   that returns the past N days). The forward projection (next 7 days) is
//   already real — only the YTD prefix is approximated.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Pre-emergent window thresholds, in cumulative GDD (base 50°F):
//   < 100   too_early       (window hasn't opened yet)
//   100..   open            (apply now)
//   175..   closing         (still actionable but narrowing)
//   200..   open ends at 200, anything past = late
//   250+    missed          (germination has already occurred — switch to
//                            post-emergent strategy)
const GDD_OPEN = 100;
const GDD_CLOSING = 175;
const GDD_CLOSED = 200;
const GDD_MISSED = 250;

interface OpenWeatherDaily {
  dt: number;
  temp: { min: number; max: number };
}

interface PreEmergent {
  status: "too_early" | "open" | "closing" | "missed";
  opens_eta_days: number | null;
  closes_eta_days: number | null;
  window_summary: string;
}

interface GddResponse {
  zip: string;
  base_f: number;
  today_gdd: number;
  cumulative_gdd_ytd: number;
  pre_emergent: PreEmergent;
  // Trailing series used for charts (best-effort: approximated YTD prefix +
  // 7-day forward). One entry per day, oldest to newest. `cumulative` is the
  // running sum through that day. `is_forecast` is true for the forward leg.
  series: Array<{
    date: string; // YYYY-MM-DD
    daily: number;
    cumulative: number;
    is_forecast: boolean;
  }>;
  cached: boolean;
  fetched_at: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const zipRaw = (url.searchParams.get("zip") || "").trim();
    const country = (url.searchParams.get("country") || "US").toUpperCase();
    const baseF = clamp(
      Number(url.searchParams.get("base") ?? 50) || 50,
      32,
      80,
    );
    if (!zipRaw) {
      return json({ error: "zip query param required" }, 400);
    }
    const zip = zipRaw.replace(/\s+/g, "").slice(0, 12);

    const apiKey = Deno.env.get("OPENWEATHER_API_KEY");
    if (!apiKey) return json({ error: "Weather not configured yet." }, 500);

    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supaUrl, serviceKey);

    // 1. Cache lookup
    const { data: cached } = await supabase
      .from("gdd_cache")
      .select("payload, created_at, expires_at")
      .eq("zip", zip)
      .eq("base_f", baseF)
      .maybeSingle();

    if (
      cached &&
      Date.now() - new Date(cached.created_at).getTime() < CACHE_TTL_MS
    ) {
      const payload = cached.payload as GddResponse;
      return json({ ...payload, cached: true });
    }

    // 2. Geocode ZIP -> lat/lng (OpenWeather geocoding)
    const geoRes = await fetch(
      `https://api.openweathermap.org/geo/1.0/zip?zip=${encodeURIComponent(zip)},${country}&appid=${apiKey}`,
    );
    if (!geoRes.ok) {
      const body = await geoRes.text();
      return json({ error: `Geocode failed [${geoRes.status}]: ${body}` }, 502);
    }
    const geo = (await geoRes.json()) as { lat: number; lon: number };
    if (typeof geo.lat !== "number" || typeof geo.lon !== "number") {
      return json({ error: "Invalid geocode response" }, 502);
    }

    // 3. One Call 4.0 — daily timeline (up to 10 days, imperial units).
    //    v4.0 has no single `/onecall` endpoint; daily lives at
    //    `/onecall/timeline/1day`. Response is an envelope wrapping the
    //    array (key is `list` or `data` depending on docs revision).
    const ocRes = await fetch(
      `https://api.openweathermap.org/data/4.0/onecall/timeline/1day?lat=${geo.lat}&lon=${geo.lon}&units=imperial&appid=${apiKey}`,
    );
    if (!ocRes.ok) {
      const body = await ocRes.text();
      return json({ error: `OneCall daily failed [${ocRes.status}]: ${body}` }, 502);
    }
    const ocJson = await ocRes.json() as {
      list?: OpenWeatherDaily[];
      data?: OpenWeatherDaily[];
    } | OpenWeatherDaily[];
    const dailyRaw: OpenWeatherDaily[] = Array.isArray(ocJson)
      ? ocJson
      : (ocJson.list ?? ocJson.data ?? []);

    // 4. Compute today's GDD from forecast index 0 (One Call returns today
    // first in the daily array).
    const todayDaily = dailyRaw[0];
    const todayGdd = todayDaily
      ? dailyGdd(todayDaily.temp.max, todayDaily.temp.min, baseF)
      : 0;

    // 5. YTD cumulative (approximated — see header comment).
    const now = new Date();
    const dayOfYear = doy(now);
    const ytdCumulative = approximateYtdCumulative(geo.lat, dayOfYear, baseF);

    // 6. Forward projection — append 7 days of daily GDD on top of YTD.
    const cumulativeNow = ytdCumulative; // through today
    const forwardSeries: GddResponse["series"] = [];
    let running = cumulativeNow;
    for (let i = 1; i < Math.min(8, dailyRaw.length); i++) {
      const d = dailyRaw[i];
      const dGdd = dailyGdd(d.temp.max, d.temp.min, baseF);
      running += dGdd;
      forwardSeries.push({
        date: new Date(d.dt * 1000).toISOString().slice(0, 10),
        daily: round1(dGdd),
        cumulative: round1(running),
        is_forecast: true,
      });
    }

    // 7. Trailing 14-day approximated history so chart has context. We
    // back-fill by reusing the same seasonal model and subtracting forward.
    const trailing: GddResponse["series"] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400 * 1000);
      const dDoy = doy(d);
      const cum = approximateYtdCumulative(geo.lat, dDoy, baseF);
      const prevCum =
        i === 13
          ? approximateYtdCumulative(geo.lat, dDoy - 1, baseF)
          : trailing[trailing.length - 1]?.cumulative ?? cum;
      trailing.push({
        date: d.toISOString().slice(0, 10),
        daily: round1(Math.max(0, cum - prevCum)),
        cumulative: round1(cum),
        is_forecast: false,
      });
    }
    // Today row in trailing already has the YTD value; replace its daily
    // with the real forecast-derived todayGdd for honesty in the chart.
    if (trailing.length > 0) {
      trailing[trailing.length - 1].daily = round1(todayGdd);
    }

    const series = [...trailing, ...forwardSeries];

    // 8. Pre-emergent decision.
    const pre_emergent = decidePreEmergent(series, ytdCumulative);

    const payload: GddResponse = {
      zip,
      base_f: baseF,
      today_gdd: round1(todayGdd),
      cumulative_gdd_ytd: round1(ytdCumulative),
      pre_emergent,
      series,
      cached: false,
      fetched_at: new Date().toISOString(),
    };

    // 9. Upsert cache
    await supabase.from("gdd_cache").upsert(
      {
        zip,
        base_f: baseF,
        payload,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
      },
      { onConflict: "zip,base_f" },
    );

    return json(payload);
  } catch (e) {
    console.error("compute-gdd error", e);
    return json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});

// =====================================================================
// Math helpers
// =====================================================================

function dailyGdd(highF: number, lowF: number, baseF: number): number {
  const avg = (highF + lowF) / 2;
  return Math.max(0, avg - baseF);
}

// Approximated YTD cumulative GDD using a sinusoidal seasonal model. This is
// a placeholder until we integrate historical weather. The shape:
//
//   T_avg(doy) = T_year_mean + amplitude * sin( 2π * (doy - 81) / 365 )
//
// We pick:
//   T_year_mean  ~ 60°F - 0.7°F per degree of latitude above 35°  (rough US)
//                  (so 35°N = ~60°F mean, 45°N = ~53°F mean)
//   amplitude    ~ 20°F at 35°N, scaling up ~0.6°F per degree north (winters
//                  are deeper farther from the equator)
//
// Daily GDD against base_f = max(0, T_avg - base_f). Integrate from doy=1 to
// today's doy. The closed-form integral of max(0, a sin x + b - base) is
// awkward, so we just sum day-by-day — 365 floats is trivial.
function approximateYtdCumulative(
  lat: number,
  todayDoy: number,
  baseF: number,
): number {
  const latAbs = Math.abs(lat);
  const yearMean = 60 - Math.max(0, latAbs - 35) * 0.7;
  const amplitude = 20 + Math.max(0, latAbs - 35) * 0.6;
  let total = 0;
  for (let d = 1; d <= todayDoy; d++) {
    const seasonal =
      yearMean + amplitude * Math.sin((2 * Math.PI * (d - 81)) / 365);
    total += Math.max(0, seasonal - baseF);
  }
  return total;
}

function decidePreEmergent(
  series: GddResponse["series"],
  ytd: number,
): PreEmergent {
  // Find the day in the forward series that crosses each threshold.
  const todayIdx = series.findIndex((s) => s.is_forecast) - 1;
  const forwardOnly = series.filter((s) => s.is_forecast);

  const findCrossing = (threshold: number): number | null => {
    if (ytd >= threshold) return 0;
    for (let i = 0; i < forwardOnly.length; i++) {
      if (forwardOnly[i].cumulative >= threshold) return i + 1;
    }
    return null;
  };

  const opensIn = findCrossing(GDD_OPEN);
  const closesIn = findCrossing(GDD_CLOSED);
  const missedIn = findCrossing(GDD_MISSED);

  let status: PreEmergent["status"];
  let window_summary: string;

  if (ytd >= GDD_MISSED) {
    status = "missed";
    window_summary =
      "Pre-emergent window has passed — switch to post-emergent strategy.";
  } else if (ytd >= GDD_CLOSING) {
    status = "closing";
    const closeMsg =
      closesIn === null
        ? "Window is closing soon — apply now."
        : closesIn === 0
          ? "Window is closing today — apply now."
          : `Window closing in ~${closesIn} day${closesIn === 1 ? "" : "s"} — apply now.`;
    window_summary = closeMsg;
  } else if (ytd >= GDD_OPEN) {
    status = "open";
    window_summary = "Pre-emergent window is open — apply now.";
  } else {
    status = "too_early";
    if (opensIn === null) {
      window_summary = "Window opens after this week's forecast horizon.";
    } else {
      window_summary = `Window opens in ~${opensIn} day${opensIn === 1 ? "" : "s"}.`;
    }
  }

  return {
    status,
    opens_eta_days: status === "too_early" ? opensIn : null,
    closes_eta_days:
      status === "open" || status === "closing" ? closesIn : null,
    window_summary,
  };

  // `todayIdx` is unused but left as a reminder that series indexing puts
  // today as the last non-forecast entry. The decision math operates on
  // ytd + forward-only entries, so the trailing chart prefix doesn't affect
  // the result.
  void todayIdx;
}

function doy(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
