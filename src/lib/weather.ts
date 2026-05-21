// Live weather hook for TurfPro — wraps the `forecast` edge function.
//
// The edge function is a thin pass-through over OpenWeather One Call 3.0 +
// `weather_cache` table; this file is the React-side adapter that decorates
// each day with a `derived_tone` lawn-care decision flag.
//
// derived_tone is what makes weather actionable for lawn care:
//   - rain     : skip the day (mowing wet turf rips it up; spray runs off)
//   - drought  : stretch to biweekly (mowing dormant grass is a waste)
//   - wind     : cutoff for spray applications (>15 mph = drift risk)
//   - frost    : herbicide cutoff (cold turf doesn't translocate chemistry)
//   - ok       : default
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type WeatherCondition = "sun" | "cloud" | "rain" | "snow";
export type DerivedTone = "ok" | "rain" | "drought" | "wind" | "frost";

export interface ForecastDay {
  date: string;            // YYYY-MM-DD (local-ish; edge function uses UTC slice)
  temp_high: number;       // °F
  temp_low: number;        // °F
  precipitation_pct: number; // 0-100
  wind_mph: number;        // mph
  condition: WeatherCondition;
  conditions_label: string; // human-readable like "Light rain"
  icon: string;             // OpenWeather icon code, e.g. "10d"
  derived_tone: DerivedTone;
}

interface EdgeDay {
  date: string;
  conditions: string;
  precipChance: number;
  high: number;
  low: number;
  rainExpected: boolean;
  icon: string;
  windMph?: number;
  condition?: WeatherCondition;
}

interface EdgeResponse {
  zip?: string;
  daily?: EdgeDay[];
  error?: string;
  cached?: boolean;
}

// Thresholds — tuned for North American cool/warm-season turf. Keep in this
// file so an operator-facing settings panel can override them later without
// touching the hook.
const RAIN_PCT_THRESHOLD = 60;
const WIND_MPH_THRESHOLD = 15;
const FROST_LOW_F = 35;

function deriveTone(d: EdgeDay, allDays: EdgeDay[], i: number): DerivedTone {
  if (d.precipChance >= RAIN_PCT_THRESHOLD || d.condition === "rain") return "rain";
  if (d.low < FROST_LOW_F) return "frost";
  if ((d.windMph ?? 0) > WIND_MPH_THRESHOLD) return "wind";
  // Drought heuristic — OpenWeather One Call gives only ~5 days of history,
  // which the edge fn doesn't currently fetch. Approximation: today + the
  // next two days have no real rain AND we're past the first index (so we've
  // seen a "this week so far" stretch already). This is intentionally
  // conservative; once the edge fn returns the past 5 days of rainfall we'll
  // wire the true "<0.25in over last 7 days AND none in next 3 days" rule.
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

function normalize(daily: EdgeDay[]): ForecastDay[] {
  return daily.map((d, i) => {
    // Fall back to deriving condition from the OpenWeather icon if the edge
    // function didn't ship the condition token (older deployments).
    let condition: WeatherCondition = d.condition ?? "sun";
    if (!d.condition) {
      const icon = d.icon ?? "";
      if (icon.startsWith("13")) condition = "snow";
      else if (icon.startsWith("09") || icon.startsWith("10") || icon.startsWith("11")) condition = "rain";
      else if (icon.startsWith("03") || icon.startsWith("04") || icon.startsWith("02")) condition = "cloud";
    }
    const enriched: EdgeDay = { ...d, condition, windMph: d.windMph ?? 0 };
    return {
      date: d.date,
      temp_high: d.high,
      temp_low: d.low,
      precipitation_pct: d.precipChance,
      wind_mph: enriched.windMph ?? 0,
      condition,
      conditions_label: d.conditions ?? "",
      icon: d.icon ?? "01d",
      derived_tone: deriveTone(enriched, daily, i),
    };
  });
}

export interface UseForecastResult {
  data: ForecastDay[] | null;
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
    // Forecast horizon is days-long; an in-memory cache of 10 minutes covers
    // a single session of navigating Home -> Routes -> Home.
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<ForecastDay[]> => {
      const { data, error } = await supabase.functions.invoke<EdgeResponse>(
        `forecast?zip=${encodeURIComponent((zip ?? "").trim())}`,
        { method: "GET" },
      );
      if (error) throw new Error(error.message ?? "forecast fetch failed");
      if (!data) throw new Error("Empty forecast response");
      if (data.error) throw new Error(data.error);
      const list = normalize(data.daily ?? []);
      return list.slice(0, days);
    },
  });

  return {
    data: hasZip ? (q.data ?? null) : null,
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
