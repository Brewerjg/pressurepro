// Growing-Degree-Days hook — wraps the `compute-gdd` edge function.
//
// GDD is the agronomic measure that tells us when the crabgrass pre-emergent
// window opens (cumulative GDD ~100, base 50°F) and when it closes (~200).
// The edge fn does the heavy lifting (seasonal YTD approximation + forward
// projection from OpenWeather One Call); this file is the React-side adapter.
//
// Two-tier cache:
//   - server-side: `gdd_cache` table, 6 hours TTL
//   - client-side: react-query staleTime 10 minutes
//
// The hook is disabled when zip is falsy — Home / consumer components should
// render nothing (or a soft "set ZIP" prompt that lives elsewhere).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PreEmergentStatus = "too_early" | "open" | "closing" | "missed";

export interface GddSeriesPoint {
  date: string;        // YYYY-MM-DD
  daily: number;       // that day's GDD value
  cumulative: number;  // running YTD total through that day
  is_forecast: boolean; // true for forward-projected days
}

export interface PreEmergentInfo {
  status: PreEmergentStatus;
  opens_eta_days: number | null;
  closes_eta_days: number | null;
  window_summary: string;
}

export interface GddPayload {
  zip: string;
  base_f: number;
  today_gdd: number;
  cumulative_gdd_ytd: number;
  pre_emergent: PreEmergentInfo;
  series: GddSeriesPoint[];
  cached?: boolean;
  fetched_at?: string;
  error?: string;
}

export interface UseGddResult {
  data: GddPayload | null;
  isLoading: boolean;
  error: string | null;
  hasZip: boolean;
}

/**
 * Fetches the GDD payload + pre-emergent window decision for the given ZIP.
 * - Falsy `zip` disables the query and returns null (no error).
 * - `base_f` defaults to 50°F (crabgrass). Override to 65 for a hypothetical
 *   fungicide variant once we add product profiles.
 */
export function useGddForecast(
  zip?: string | null,
  base_f: number = 50,
): UseGddResult {
  const hasZip = !!zip && zip.trim().length > 0;
  const q = useQuery({
    queryKey: ["gdd-forecast", zip, base_f],
    enabled: hasZip,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<GddPayload> => {
      const path = `compute-gdd?zip=${encodeURIComponent((zip ?? "").trim())}&base=${base_f}`;
      const { data, error } = await supabase.functions.invoke<GddPayload>(
        path,
        { method: "GET" },
      );
      if (error) throw new Error(error.message ?? "GDD fetch failed");
      if (!data) throw new Error("Empty GDD response");
      if (data.error) throw new Error(data.error);
      return data;
    },
  });

  return {
    data: hasZip ? (q.data ?? null) : null,
    isLoading: hasZip && q.isLoading,
    error: q.error instanceof Error ? q.error.message : null,
    hasZip,
  };
}
