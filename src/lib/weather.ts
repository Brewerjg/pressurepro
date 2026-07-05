// Live weather hook for TurfPro — wraps the `forecast` edge function.
//
// The edge function is a thin pass-through over OpenWeather One Call 4.0 +
// `weather_cache` table; this file is the React-side adapter that:
//   1. Re-exports the rich ForecastResponse contract for new consumers.
//   2. Preserves the legacy normalized field names (temp_high, temp_low,
//      wind_mph, precipitation_pct, conditions_label) so existing pages
//      (Home, Routes, WinterHomeCard) keep rendering without changes.
//   3. Tracks `derived_tone` per day for the Home strip color logic.
//   4. Exposes verdict helpers (`mostSevereVerdict`, `verdictColor`) for
//      the new work-conditions badge UI.
//
// derived_tone — operator-facing lawn-care decision flag:
//   - rain     : skip the day (mowing wet turf rips it up; spray runs off)
//   - drought  : stretch to biweekly (mowing dormant grass is a waste)
//   - wind     : cutoff for spray applications (>15 mph = drift risk)
//   - frost    : herbicide cutoff (cold turf doesn't translocate chemistry)
//   - ok       : default
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Type contracts. Kept in sync with supabase/functions/forecast/index.ts.
// ---------------------------------------------------------------------------

export type WeatherCondition = "sun" | "cloud" | "rain" | "snow";
export type DerivedTone = "ok" | "rain" | "drought" | "wind" | "frost";
export type WorkVerdict = "good" | "caution" | "block";

export interface WorkWarning {
  kind: "wind" | "frost" | "heat" | "wet_ground" | "rain_today" | "uv" | "humidity";
  severity: "info" | "warn" | "block";
  message: string;
  affects: Array<"mowing" | "spraying" | "fertilizing">;
}

export interface WorkConditions {
  mowing: WorkVerdict;
  spraying: WorkVerdict;
  fertilizing: WorkVerdict;
  warnings: WorkWarning[];
}

export interface DailyForecast {
  date: string;             // YYYY-MM-DD (local TZ)

  // Temperature (°F)
  high: number;
  low: number;
  feelsLikeDay: number;
  feelsLikeMorn: number;
  feelsLikeNight: number;

  // Conditions
  conditions: string;       // Capitalized OW description, e.g. "Light rain"
  summary: string | null;   // OneCall daily.summary (may be null on older data)
  icon: string;             // OW icon code, e.g. "10d"
  condition: WeatherCondition;

  // Precipitation
  precipChance: number;     // 0-100
  rainExpected: boolean;    // precipChance >= 50
  rainInches: number;       // 0 if absent
  snowInches: number;

  // Wind (mph)
  windMph: number;
  windGustMph: number;
  windDeg: number;
  windDir: string;          // 16-point compass

  // Atmospheric
  humidity: number;
  dewPoint: number;
  pressure: number;
  cloudCover: number;
  uvi: number;

  // Lawn-care derivations
  derived_tone: DerivedTone;
  workConditions: WorkConditions;

  // ---- Legacy aliases ----
  // Older callers (Home, Routes, WinterHomeCard) read these names. We mirror
  // the new fields onto them in `normalize()` below so the rest of the app
  // doesn't have to change in this wave.
  temp_high: number;
  temp_low: number;
  precipitation_pct: number;
  wind_mph: number;
  conditions_label: string;
}

export interface CurrentObservation {
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

export interface HourlyForecast {
  dt: number;
  hour: string;
  temp: number;
  feelsLike: number;
  condition: WeatherCondition;
  icon: string;
  precipChance: number;
  windMph: number;
}

export interface WeatherAlert {
  sender: string;
  event: string;
  start: number;
  end: number;
  description: string;
  severity: "watch" | "warning" | "advisory" | "statement";
}

export interface ForecastResponse {
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
// Back-compat aliases. The old hook exposed a `ForecastDay` type as the
// per-day shape; the new code uses `DailyForecast`. Re-export the alias so
// existing imports (`import { type ForecastDay } from "@/lib/weather"`)
// keep compiling. New code should prefer DailyForecast.
// ---------------------------------------------------------------------------
export type ForecastDay = DailyForecast;

// ---------------------------------------------------------------------------
// Thresholds & deriveTone — kept on the client so the Home strip can recompute
// if we ever want to override edge-computed values. The edge function ships
// derived_tone already; this client copy is the same logic, used as a fallback
// when an older cached payload doesn't carry it.
// ---------------------------------------------------------------------------
const RAIN_PCT_THRESHOLD = 60;
const WIND_MPH_THRESHOLD = 15;
const FROST_LOW_F = 35;

export function deriveTone(d: DailyForecast, allDays: DailyForecast[], i: number): DerivedTone {
  if (d.precipChance >= RAIN_PCT_THRESHOLD || d.condition === "rain") return "rain";
  if (d.low < FROST_LOW_F) return "frost";
  if ((d.windMph ?? 0) > WIND_MPH_THRESHOLD) return "wind";
  // Drought heuristic — OpenWeather One Call gives only ~5 days of history,
  // which the edge fn doesn't currently fetch. Approximation: today + the
  // next two days have no real rain AND we've seen ≥2 dry days behind us.
  // TODO: replace with real precipitation history once forecast edge fn
  // exposes past-5-days from OpenWeather One Call.
  const lookahead = allDays.slice(i, Math.min(i + 3, allDays.length));
  const lookbehind = allDays.slice(Math.max(0, i - 3), i);
  const dryAhead = lookahead.every(
    (x) => x.precipChance < 30 && x.condition !== "rain",
  );
  const dryBehind =
    lookbehind.length >= 2 &&
    lookbehind.every((x) => x.precipChance < 30 && x.condition !== "rain");
  if (dryAhead && dryBehind && d.high >= 75) return "drought";
  return "ok";
}

// ---------------------------------------------------------------------------
// Wire-shape normalization. Old cache rows / older deployments may ship
// partial payloads — fill in defaults so consumers don't have to guard every
// field. Also mirrors the new fields onto the legacy aliases.
// ---------------------------------------------------------------------------

// Anything the edge fn might send for a day. We accept partials so a stale
// cache row (or a v0 deployment) doesn't crash the client.
interface EdgeDayPartial {
  date?: string;
  high?: number;
  low?: number;
  feelsLikeDay?: number;
  feelsLikeMorn?: number;
  feelsLikeNight?: number;
  conditions?: string;
  summary?: string | null;
  icon?: string;
  condition?: WeatherCondition;
  precipChance?: number;
  rainExpected?: boolean;
  rainInches?: number;
  snowInches?: number;
  windMph?: number;
  windGustMph?: number;
  windDeg?: number;
  windDir?: string;
  humidity?: number;
  dewPoint?: number;
  pressure?: number;
  cloudCover?: number;
  uvi?: number;
  derived_tone?: DerivedTone;
  workConditions?: WorkConditions;
}

interface EdgeResponse {
  zip?: string;
  country?: string;
  lat?: number;
  lng?: number;
  current?: CurrentObservation | null;
  daily?: EdgeDayPartial[];
  hourly?: HourlyForecast[];
  alerts?: WeatherAlert[];
  cached?: boolean;
  fetched_at?: string;
  error?: string;
}

function inferConditionFromIcon(icon: string): WeatherCondition {
  if (icon.startsWith("13")) return "snow";
  if (icon.startsWith("09") || icon.startsWith("10") || icon.startsWith("11")) return "rain";
  if (icon.startsWith("03") || icon.startsWith("04") || icon.startsWith("02")) return "cloud";
  return "sun";
}

function emptyWorkConditions(): WorkConditions {
  return { mowing: "good", spraying: "good", fertilizing: "good", warnings: [] };
}

function normalizeDay(raw: EdgeDayPartial): DailyForecast {
  const icon = raw.icon ?? "01d";
  const condition: WeatherCondition = raw.condition ?? inferConditionFromIcon(icon);
  const high = raw.high ?? 0;
  const low = raw.low ?? 0;
  const precipChance = raw.precipChance ?? 0;
  const windMph = raw.windMph ?? 0;
  const conditions = raw.conditions ?? "";
  return {
    date: raw.date ?? "",
    high,
    low,
    feelsLikeDay: raw.feelsLikeDay ?? high,
    feelsLikeMorn: raw.feelsLikeMorn ?? low,
    feelsLikeNight: raw.feelsLikeNight ?? low,
    conditions,
    summary: raw.summary ?? null,
    icon,
    condition,
    precipChance,
    rainExpected: raw.rainExpected ?? precipChance >= 50,
    rainInches: raw.rainInches ?? 0,
    snowInches: raw.snowInches ?? 0,
    windMph,
    windGustMph: raw.windGustMph ?? windMph,
    windDeg: raw.windDeg ?? 0,
    windDir: raw.windDir ?? "N",
    humidity: raw.humidity ?? 0,
    dewPoint: raw.dewPoint ?? 0,
    pressure: raw.pressure ?? 0,
    cloudCover: raw.cloudCover ?? 0,
    uvi: raw.uvi ?? 0,
    derived_tone: raw.derived_tone ?? "ok",
    workConditions: raw.workConditions ?? emptyWorkConditions(),
    // Legacy aliases
    temp_high: high,
    temp_low: low,
    precipitation_pct: precipChance,
    wind_mph: windMph,
    conditions_label: conditions,
  };
}

function normalizeResponse(r: EdgeResponse): ForecastResponse {
  // First pass: shallow normalize each day so the deriveTone fallback has
  // a uniform shape to operate on.
  const partials = (r.daily ?? []).map(normalizeDay);
  // Second pass: fill derived_tone if the server didn't supply it (older
  // cache rows). The server's value wins when present.
  const daily = partials.map((d, i) => {
    if (d.derived_tone && d.derived_tone !== "ok") return d;
    // If server explicitly sent "ok" we still keep it — only recompute when
    // the field was completely missing and our normalizer defaulted to "ok".
    // To detect that, look at the raw input:
    const rawHadTone = (r.daily?.[i] as EdgeDayPartial | undefined)?.derived_tone != null;
    if (rawHadTone) return d;
    return { ...d, derived_tone: deriveTone(d, partials, i) };
  });
  return {
    zip: r.zip ?? "",
    country: r.country ?? "US",
    lat: r.lat ?? 0,
    lng: r.lng ?? 0,
    current: r.current ?? null,
    daily,
    hourly: r.hourly ?? [],
    alerts: r.alerts ?? [],
    cached: r.cached ?? false,
    fetched_at: r.fetched_at ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Hook. Returns the FULL ForecastResponse so new consumers can read current /
// hourly / alerts. Existing consumers that only used `data` as a day array
// still work because `forecast.data` is now the rich object — the small
// migration is `.data ?? []` -> `.data?.daily ?? []`. The two existing pages
// (Home, Routes) read `forecast.data` as an array though, so we expose the
// `daily` array directly via .data for ergonomic back-compat.
// ---------------------------------------------------------------------------

export interface UseForecastResult {
  /** Per-day forecast list — back-compat array of DailyForecast. */
  data: DailyForecast[] | null;
  /** Full response (current/hourly/alerts/daily). Use for new surfaces. */
  full: ForecastResponse | null;
  isLoading: boolean;
  error: string | null;
  hasZip: boolean;
}

/**
 * Fetches a 7-day forecast for the given ZIP from the `forecast` edge fn.
 * - If `zip` is falsy the hook is disabled and returns null without erroring
 *   (UI must prompt the user to set a ZIP in Settings).
 * - Two-tier cache: HTTP-level `weather_cache` (6 hours, server-side) +
 *   react-query staleTime (10 minutes, client-side). Second visit renders
 *   instantly off react-query's in-memory cache.
 */
export function useForecast(zip?: string | null, days = 7): UseForecastResult {
  const hasZip = !!zip && zip.trim().length > 0;
  const q = useQuery({
    queryKey: ["forecast", zip],
    enabled: hasZip,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<ForecastResponse> => {
      // `?refresh=1` if URL carries ?refreshWeather=1 — operator-facing
      // escape hatch right after an edge-fn deploy when a stale-shape cache
      // row would otherwise serve zeros for 6 hours.
      const refresh = typeof window !== "undefined"
        && new URLSearchParams(window.location.search).get("refreshWeather") === "1"
        ? "&refresh=1" : "";
      const { data, error } = await supabase.functions.invoke<EdgeResponse>(
        `forecast?zip=${encodeURIComponent((zip ?? "").trim())}${refresh}`,
        { method: "GET" },
      );
      if (error) throw new Error(error.message ?? "forecast fetch failed");
      if (!data) throw new Error("Empty forecast response");
      if (data.error) throw new Error(data.error);
      const full = normalizeResponse(data);
      // Apply caller's `days` cap to the daily array.
      return { ...full, daily: full.daily.slice(0, days) };
    },
  });

  const full = hasZip ? (q.data ?? null) : null;
  return {
    data: full ? full.daily : null,
    full,
    isLoading: hasZip && q.isLoading,
    error: q.error instanceof Error ? q.error.message : null,
    hasZip,
  };
}

/**
 * Pulls the current user's `zip` off `profiles`. Returns null if the user
 * hasn't set one. Cached for the session so Home + Routes share one query.
 */
export function useUserZip() {
  return useQuery({
    queryKey: ["user-zip"],
    staleTime: 60 * 60 * 1000, // 1 hour — zip rarely changes mid-session
    queryFn: async (): Promise<string | null> => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("zip")
        .eq("user_id", uid)
        .maybeSingle();
      if (error) throw error;
      return (data?.zip ?? null) || null;
    },
  });
}

// ---------------------------------------------------------------------------
// Work-condition helpers — used by the new badge UI on the forecast strip
// and (eventually) the day-detail sheet.
// ---------------------------------------------------------------------------

/**
 * Reduces a day's three verdicts to the most-severe single one. Used for
 * a one-glance badge on the strip: block > caution > good.
 */
export function mostSevereVerdict(wc: WorkConditions): WorkVerdict {
  if (wc.mowing === "block" || wc.spraying === "block" || wc.fertilizing === "block") {
    return "block";
  }
  if (wc.mowing === "caution" || wc.spraying === "caution" || wc.fertilizing === "caution") {
    return "caution";
  }
  return "good";
}

/**
 * Tailwind class string for a verdict pill. Background + text color combos
 * match the existing rain/drought/ok palette so the strip stays coherent.
 */
export function verdictColor(verdict: WorkVerdict): string {
  switch (verdict) {
    case "block":
      return "bg-[hsl(var(--rain-bg))] text-[hsl(var(--rain))]";
    case "caution":
      return "bg-[hsl(var(--drought-bg))] text-[hsl(36_80%_35%)]";
    case "good":
    default:
      return "bg-brand-50 text-brand-800";
  }
}
