// Forecast edge function — ZIP -> geocode -> OpenWeather One Call 4.0 -> DB cache.
//
// Returns:
//   - `current`  : right-now observation
//   - `daily[]`  : next 7 days (sliced from OW's 8) with per-day workConditions
//   - `hourly[]` : next 24 hours (sliced from OW's 48)
//   - `alerts[]` : active NWS-issued advisories/warnings/watches (when present)
//
// Cache TTL is 6 hours. The cache column `weather_cache.daily` (jsonb) now
// stores the FULL ForecastResponse payload (not just the daily array) — the
// column name is misleading but kept for backward compat to avoid a schema
// migration. The client reads `cached.daily as ForecastResponse`.
//
// Switched from `/data/4.0/onecall/timeline/1day` to `/data/4.0/onecall` so
// one call surfaces current + hourly + daily + alerts. Same OneCall
// subscription, same auth, just a richer endpoint.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MM_TO_INCHES = 0.0393701;

// ---------------------------------------------------------------------------
// Response contract — kept in sync with src/lib/weather.ts. If you edit one
// side, edit the other. (Deno edge fn + browser hook can't share types.)
// ---------------------------------------------------------------------------
type WeatherCondition = "sun" | "cloud" | "rain" | "snow";
type DerivedTone = "ok" | "rain" | "drought" | "wind" | "frost";
type WorkVerdict = "good" | "caution" | "block";

interface WorkWarning {
  kind: "wind" | "frost" | "heat" | "wet_ground" | "rain_today" | "uv" | "humidity";
  severity: "info" | "warn" | "block";
  message: string;
  affects: Array<"mowing" | "spraying" | "fertilizing">;
}

interface WorkConditions {
  mowing: WorkVerdict;
  spraying: WorkVerdict;
  fertilizing: WorkVerdict;
  warnings: WorkWarning[];
}

interface DailyForecast {
  date: string;

  high: number;
  low: number;
  feelsLikeDay: number;
  feelsLikeMorn: number;
  feelsLikeNight: number;

  conditions: string;
  summary: string | null;
  icon: string;
  condition: WeatherCondition;

  precipChance: number;
  rainExpected: boolean;
  rainInches: number;
  snowInches: number;

  windMph: number;
  windGustMph: number;
  windDeg: number;
  windDir: string;

  humidity: number;
  dewPoint: number;
  pressure: number;
  cloudCover: number;
  uvi: number;

  derived_tone: DerivedTone;
  workConditions: WorkConditions;
}

interface CurrentObservation {
  temp: number;
  feelsLike: number;
  conditions: string;
  icon: string;
  condition: WeatherCondition;
  windMph: number;
  windGustMph: number;
  humidity: number;
  dewPoint: number;
  uvi: number;
  cloudCover: number;
}

interface HourlyForecast {
  dt: number;
  hour: string;
  temp: number;
  feelsLike: number;
  condition: WeatherCondition;
  icon: string;
  precipChance: number;
  windMph: number;
}

interface WeatherAlert {
  sender: string;
  event: string;
  start: number;
  end: number;
  description: string;
  severity: "watch" | "warning" | "advisory" | "statement";
}

interface ForecastResponse {
  zip: string;
  country: string;
  lat: number;
  lng: number;
  current: CurrentObservation | null;
  daily: DailyForecast[];
  hourly: HourlyForecast[];
  alerts: WeatherAlert[];
  cached: boolean;
  fetched_at: string;
}

// ---------------------------------------------------------------------------
// OpenWeather OneCall 4.0 raw response shapes (subset of what we consume).
// ---------------------------------------------------------------------------
interface OWWeather { id: number; main: string; description: string; icon: string }
interface OWCurrent {
  dt: number;
  temp: number;
  feels_like: number;
  pressure: number;
  humidity: number;
  dew_point: number;
  uvi: number;
  clouds: number;
  wind_speed: number;
  wind_gust?: number;
  wind_deg: number;
  weather: OWWeather[];
}
interface OWHourly {
  dt: number;
  temp: number;
  feels_like: number;
  humidity: number;
  pop: number;
  wind_speed: number;
  wind_gust?: number;
  weather: OWWeather[];
}
interface OWDaily {
  dt: number;
  summary?: string;
  temp: { min: number; max: number; day: number; night: number; eve: number; morn: number };
  feels_like: { day: number; night: number; eve: number; morn: number };
  pressure: number;
  humidity: number;
  dew_point: number;
  wind_speed: number;
  wind_gust?: number;
  wind_deg: number;
  weather: OWWeather[];
  clouds: number;
  pop: number;
  rain?: number;   // mm
  snow?: number;   // mm
  uvi: number;
}
interface OWAlert {
  sender_name: string;
  event: string;
  start: number;
  end: number;
  description: string;
  tags?: string[];
}
interface OWOneCallResponse {
  lat: number;
  lon: number;
  timezone: string;
  timezone_offset: number;
  current?: OWCurrent;
  hourly?: OWHourly[];
  daily?: OWDaily[];
  alerts?: OWAlert[];
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
    const zip = zipRaw.replace(/\s+/g, "").slice(0, 12);

    const apiKey = Deno.env.get("OPENWEATHER_API_KEY");
    if (!apiKey) return json({ error: "Weather not configured yet." }, 500);

    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supaUrl, serviceKey);

    // 1. Try cache. `weather_cache.daily` jsonb column now stores the WHOLE
    //    ForecastResponse (column name is legacy; kept to avoid migration).
    const { data: cached } = await supabase
      .from("weather_cache")
      .select("*")
      .eq("zip", zip)
      .eq("country", country)
      .maybeSingle();

    const fresh = cached && (Date.now() - new Date(cached.fetched_at).getTime() < CACHE_TTL_MS);
    if (fresh) {
      const payload = cached.daily as Partial<ForecastResponse> | DailyForecast[];
      // Back-compat: previous cache rows stored only DailyForecast[]. If we
      // see an array we wrap it minimally so the client never breaks; the
      // shape will heal on the next miss.
      if (Array.isArray(payload)) {
        return json({
          zip, country,
          lat: Number(cached.lat), lng: Number(cached.lng),
          current: null,
          daily: payload as DailyForecast[],
          hourly: [],
          alerts: [],
          cached: true,
          fetched_at: cached.fetched_at,
        } satisfies ForecastResponse);
      }
      return json({
        ...payload,
        zip, country,
        lat: Number(cached.lat), lng: Number(cached.lng),
        cached: true,
        fetched_at: cached.fetched_at,
      });
    }

    // 2. Geocode ZIP -> lat/lng.
    const geoRes = await fetch(`https://api.openweathermap.org/geo/1.0/zip?zip=${encodeURIComponent(zip)},${country}&appid=${apiKey}`);
    if (!geoRes.ok) {
      const body = await geoRes.text();
      return json({ error: `Geocode failed [${geoRes.status}]: ${body}` }, 502);
    }
    const geo = await geoRes.json() as { lat: number; lon: number; name?: string };
    if (typeof geo.lat !== "number" || typeof geo.lon !== "number") {
      return json({ error: "Invalid geocode response" }, 502);
    }

    // 3. OneCall 4.0 — full endpoint. Excludes only `minutely`; everything
    //    else (current + hourly + daily + alerts) is what we want.
    //
    //    /data/4.0/onecall?lat=&lon=&units=imperial&exclude=minutely&appid=
    //
    //    Units are imperial so temps come back as °F and wind as mph. Rain
    //    and snow stay in mm regardless of units; we convert at parse time.
    const ocUrl =
      `https://api.openweathermap.org/data/4.0/onecall` +
      `?lat=${geo.lat}&lon=${geo.lon}` +
      `&units=imperial` +
      `&exclude=minutely` +
      `&appid=${apiKey}`;
    const ocRes = await fetch(ocUrl);
    if (!ocRes.ok) {
      const body = await ocRes.text();
      return json({ error: `OneCall failed [${ocRes.status}]: ${body}` }, 502);
    }
    const oc = await ocRes.json() as OWOneCallResponse;

    // 4. Parse current.
    const current: CurrentObservation | null = oc.current
      ? mapCurrent(oc.current)
      : null;

    // 5. Parse hourly — slice to next 24 from the API's 48.
    const hourly: HourlyForecast[] = (oc.hourly ?? [])
      .slice(0, 24)
      .map((h) => mapHourly(h, oc.timezone_offset));

    // 6. Parse daily — slice to 7 (OW returns 8). Compute derived_tone and
    //    workConditions per day. derived_tone needs the full window so we
    //    map raw -> base shape first, then enrich in a second pass.
    const dailyRaw = (oc.daily ?? []).slice(0, 7);
    const dailyBase = dailyRaw.map((d) => mapDailyBase(d, oc.timezone_offset));
    const daily: DailyForecast[] = dailyBase.map((d, i) => ({
      ...d,
      derived_tone: deriveTone(d, dailyBase, i),
      workConditions: computeWorkConditions(d),
    }));

    // 7. Alerts — empty array when none.
    const alerts: WeatherAlert[] = (oc.alerts ?? []).map(mapAlert);

    const fetched_at = new Date().toISOString();
    const response: ForecastResponse = {
      zip,
      country,
      lat: geo.lat,
      lng: geo.lon,
      current,
      daily,
      hourly,
      alerts,
      cached: false,
      fetched_at,
    };

    // 8. Cache the FULL response in `weather_cache.daily` (jsonb).
    await supabase.from("weather_cache").upsert({
      zip,
      country,
      lat: geo.lat,
      lng: geo.lon,
      daily: response,
      fetched_at,
    }, { onConflict: "zip,country" });

    return json(response);
  } catch (e) {
    console.error("forecast error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// ---------------------------------------------------------------------------
// Mapping helpers — raw OW shape -> our contract.
// ---------------------------------------------------------------------------

function mapCurrent(c: OWCurrent): CurrentObservation {
  const w = c.weather?.[0];
  return {
    temp: Math.round(c.temp),
    feelsLike: Math.round(c.feels_like),
    conditions: w?.description ? capitalize(w.description) : (w?.main ?? "Unknown"),
    icon: w?.icon ?? "01d",
    condition: bucketCondition(w?.main ?? ""),
    windMph: Math.round(c.wind_speed ?? 0),
    windGustMph: Math.round(c.wind_gust ?? c.wind_speed ?? 0),
    humidity: Math.round(c.humidity ?? 0),
    dewPoint: Math.round(c.dew_point ?? 0),
    uvi: Math.round((c.uvi ?? 0) * 10) / 10,
    cloudCover: Math.round(c.clouds ?? 0),
  };
}

function mapHourly(h: OWHourly, tzOffsetSec: number): HourlyForecast {
  const w = h.weather?.[0];
  return {
    dt: h.dt,
    hour: formatHour(h.dt, tzOffsetSec),
    temp: Math.round(h.temp),
    feelsLike: Math.round(h.feels_like),
    condition: bucketCondition(w?.main ?? ""),
    icon: w?.icon ?? "01d",
    precipChance: Math.round((h.pop ?? 0) * 100),
    windMph: Math.round(h.wind_speed ?? 0),
  };
}

// Base daily mapping — no derived_tone/workConditions yet.
type DailyBase = Omit<DailyForecast, "derived_tone" | "workConditions">;
function mapDailyBase(d: OWDaily, tzOffsetSec: number): DailyBase {
  const w = d.weather?.[0];
  const precipChance = Math.round((d.pop ?? 0) * 100);
  const rainInches = d.rain != null ? round2(d.rain * MM_TO_INCHES) : 0;
  const snowInches = d.snow != null ? round2(d.snow * MM_TO_INCHES) : 0;
  const windDeg = Math.round(d.wind_deg ?? 0);
  return {
    date: formatLocalDate(d.dt, tzOffsetSec),
    high: Math.round(d.temp?.max ?? 0),
    low: Math.round(d.temp?.min ?? 0),
    feelsLikeDay: Math.round(d.feels_like?.day ?? 0),
    feelsLikeMorn: Math.round(d.feels_like?.morn ?? 0),
    feelsLikeNight: Math.round(d.feels_like?.night ?? 0),
    conditions: w?.description ? capitalize(w.description) : (w?.main ?? "Unknown"),
    summary: d.summary ?? null,
    icon: w?.icon ?? "01d",
    condition: bucketCondition(w?.main ?? ""),
    precipChance,
    rainExpected: precipChance >= 50,
    rainInches,
    snowInches,
    windMph: Math.round(d.wind_speed ?? 0),
    windGustMph: Math.round(d.wind_gust ?? d.wind_speed ?? 0),
    windDeg,
    windDir: degToCompass(windDeg),
    humidity: Math.round(d.humidity ?? 0),
    dewPoint: Math.round(d.dew_point ?? 0),
    pressure: Math.round(d.pressure ?? 0),
    cloudCover: Math.round(d.clouds ?? 0),
    uvi: Math.round((d.uvi ?? 0) * 10) / 10,
  };
}

function mapAlert(a: OWAlert): WeatherAlert {
  // Tags from NWS look like ["Extreme temperature value", "Wind"] etc.
  // The event string itself is more useful for severity bucketing.
  const ev = (a.event ?? "").toLowerCase();
  let severity: WeatherAlert["severity"] = "statement";
  if (ev.includes("warning")) severity = "warning";
  else if (ev.includes("watch")) severity = "watch";
  else if (ev.includes("advisory")) severity = "advisory";
  return {
    sender: a.sender_name ?? "Weather service",
    event: a.event ?? "Weather alert",
    start: a.start,
    end: a.end,
    description: a.description ?? "",
    severity,
  };
}

// ---------------------------------------------------------------------------
// Derivations — derived_tone (Home strip color) + workConditions (lawn ops).
// ---------------------------------------------------------------------------

const RAIN_PCT_THRESHOLD = 60;
const WIND_MPH_THRESHOLD = 15;
const FROST_LOW_F = 35;

function deriveTone(d: DailyBase, all: DailyBase[], i: number): DerivedTone {
  if (d.precipChance >= RAIN_PCT_THRESHOLD || d.condition === "rain") return "rain";
  if (d.low < FROST_LOW_F) return "frost";
  if ((d.windMph ?? 0) > WIND_MPH_THRESHOLD) return "wind";
  // Drought heuristic — see comment in src/lib/weather.ts for context.
  const lookahead = all.slice(i, Math.min(i + 3, all.length));
  const lookbehind = all.slice(Math.max(0, i - 3), i);
  const dryAhead = lookahead.every((x) => x.precipChance < 30 && x.condition !== "rain");
  const dryBehind =
    lookbehind.length >= 2 &&
    lookbehind.every((x) => x.precipChance < 30 && x.condition !== "rain");
  if (dryAhead && dryBehind && d.high >= 75) return "drought";
  return "ok";
}

// Per-day work verdicts + warnings. Rules are defensible per the spec block
// in the task — keep them in lockstep with the docs.
function computeWorkConditions(d: DailyBase): WorkConditions {
  const warnings: WorkWarning[] = [];

  // -----------------------------------------------------------------
  // Mowing
  // -----------------------------------------------------------------
  let mowing: WorkVerdict = "good";
  if (d.rainInches > 0.25 && d.precipChance > 60) {
    mowing = "block";
    warnings.push({
      kind: "wet_ground",
      severity: "block",
      message: `Wet ground — ${d.rainInches.toFixed(2)}" rain expected, skip mowing`,
      affects: ["mowing"],
    });
  } else if (d.precipChance > 50) {
    mowing = "caution";
    warnings.push({
      kind: "rain_today",
      severity: "warn",
      message: `Rain ${d.precipChance}% — might rain mid-route`,
      affects: ["mowing"],
    });
  }
  if (d.feelsLikeDay > 95) {
    if (mowing === "good") mowing = "caution";
    warnings.push({
      kind: "heat",
      severity: "warn",
      message: `Heat index ${d.feelsLikeDay}°F — schedule morning routes`,
      affects: ["mowing"],
    });
  }

  // -----------------------------------------------------------------
  // Spraying (most regulated)
  // -----------------------------------------------------------------
  let spraying: WorkVerdict = "good";
  if (d.windMph > 10 || d.windGustMph > 15) {
    spraying = "block";
    warnings.push({
      kind: "wind",
      severity: "block",
      message: `Wind gusts to ${d.windGustMph} mph — no spray work`,
      affects: ["spraying"],
    });
  }
  if (d.precipChance > 30 && d.rainExpected) {
    spraying = "block";
    warnings.push({
      kind: "rain_today",
      severity: "block",
      message: `Rain ${d.precipChance}% — herbicide will wash off`,
      affects: ["spraying"],
    });
  }
  if (d.low < 45) {
    spraying = "block";
    warnings.push({
      kind: "frost",
      severity: "block",
      message: `Frost overnight (${d.low}°F low) — herbicide ineffective`,
      affects: ["spraying"],
    });
  }
  if (d.humidity < 30) {
    if (spraying === "good") spraying = "caution";
    warnings.push({
      kind: "humidity",
      severity: "warn",
      message: `Low humidity (${d.humidity}%) — drift risk increases`,
      affects: ["spraying"],
    });
  }
  if (spraying !== "block" && d.windGustMph > 10) {
    if (spraying === "good") spraying = "caution";
    warnings.push({
      kind: "wind",
      severity: "warn",
      message: `Gusts to ${d.windGustMph} mph — safe for select chems only`,
      affects: ["spraying"],
    });
  }

  // -----------------------------------------------------------------
  // Fertilizing (granular)
  // -----------------------------------------------------------------
  let fertilizing: WorkVerdict = "good";
  if (d.precipChance > 80) {
    fertilizing = "block";
    warnings.push({
      kind: "rain_today",
      severity: "block",
      message: `Heavy rain ${d.precipChance}% — granular fert will wash off`,
      affects: ["fertilizing"],
    });
  } else if (d.precipChance > 50) {
    fertilizing = "caution";
    warnings.push({
      kind: "rain_today",
      severity: "warn",
      message: `Rain expected ${d.precipChance}% — water in fert immediately`,
      affects: ["fertilizing"],
    });
  }
  if (d.windGustMph > 20) {
    if (fertilizing === "good") fertilizing = "caution";
    warnings.push({
      kind: "wind",
      severity: "warn",
      message: `Gusts to ${d.windGustMph} mph — spreader pattern degrades`,
      affects: ["fertilizing"],
    });
  }

  // UV info-level for crew awareness — doesn't shift any verdict.
  if (d.uvi >= 8) {
    warnings.push({
      kind: "uv",
      severity: "info",
      message: `UV index ${d.uvi} — crew needs sun protection`,
      affects: ["mowing", "spraying", "fertilizing"],
    });
  }

  // Sort warnings by severity descending (block > warn > info) so callers
  // can show the most-impactful one first without re-sorting.
  warnings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  return { mowing, spraying, fertilizing, warnings };
}

function severityRank(s: WorkWarning["severity"]): number {
  return s === "block" ? 2 : s === "warn" ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Tiny utils.
// ---------------------------------------------------------------------------

function bucketCondition(main: string): WeatherCondition {
  const m = main.toLowerCase();
  if (m.includes("snow")) return "snow";
  if (m.includes("rain") || m.includes("drizzle") || m.includes("thunder")) return "rain";
  if (m.includes("cloud")) return "cloud";
  return "sun";
}

function degToCompass(deg: number): string {
  const pts = [
    "N", "NNE", "NE", "ENE",
    "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW",
    "W", "WNW", "NW", "NNW",
  ];
  return pts[Math.round(deg / 22.5) % 16];
}

// Format a unix ts as YYYY-MM-DD in the location's local timezone using the
// OneCall timezone_offset (seconds). Avoids the UTC-slice TZ off-by-one
// that the old timeline endpoint code exhibited.
function formatLocalDate(unixSec: number, tzOffsetSec: number): string {
  const d = new Date((unixSec + tzOffsetSec) * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// "2pm" / "12am" — short hour label, local TZ.
function formatHour(unixSec: number, tzOffsetSec: number): string {
  const d = new Date((unixSec + tzOffsetSec) * 1000);
  let h = d.getUTCHours();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}${ampm}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
