// Season state for TurfPro snow swap mode.
//
// One source of truth (user_settings.season) drives:
//   - Home: Today's route vs. Today's storm card
//   - Routes: weekly cadence vs. storm-driven banner
//   - (future) Catalog filter, MRR reporting
//
// useSeason() returns a cached react-query subscription so multiple
// components can read it without each issuing a fresh DB call.
//
// swapSeason() is a mutation wrapper that prefers the swap-season edge
// function (atomic server-side bulk update) and falls back to direct DB
// calls if the function isn't deployed yet. The fallback path is best-
// effort — same result, fewer guarantees on partial-failure recovery.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { APP_ID } from "./app-context";

export type Season = "spring" | "summer" | "fall" | "winter";
export const ALL_SEASONS: Season[] = ["spring", "summer", "fall", "winter"];

const SEASON_LABELS: Record<Season, string> = {
  spring: "Spring",
  summer: "Summer",
  fall: "Fall",
  winter: "Winter",
};

export function seasonLabel(s: Season): string {
  return SEASON_LABELS[s];
}

interface UseSeasonResult {
  season: Season;
  isWinter: boolean;
  isLoading: boolean;
}

/**
 * Read the current operator's season from user_settings. Defaults to
 * 'summer' when:
 *   - the user isn't signed in
 *   - no user_settings row exists yet
 *   - the row exists but season is NULL (legacy rows; the column has a
 *     default but older rows wouldn't have been backfilled)
 */
export function useSeason(): UseSeasonResult {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["season", user?.id],
    enabled: !!user?.id,
    // Season changes are explicit user actions — we don't need to refetch
    // on focus. The mutation below invalidates this query directly.
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<Season> => {
      if (!user?.id) return "summer";
      const { data, error } = await (supabase as any)
        .from("user_settings")
        .select("season")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      const s = (data?.season ?? "summer") as Season;
      return s;
    },
  });

  const season: Season = q.data ?? "summer";
  return {
    season,
    isWinter: season === "winter",
    isLoading: !!user?.id && q.isLoading,
  };
}

/**
 * Count the plans that the next swap would affect. Used in the confirm
 * modal so the operator sees "this will pause N plans" before commiting.
 *
 *   - to === 'winter' : count active mow plans on weekly/biweekly/monthly
 *   - else            : count plans currently paused with reason='winter_swap'
 */
export async function countAffectedPlans(
  userId: string,
  to: Season,
): Promise<number> {
  if (to === "winter") {
    const { count, error } = await (supabase as any)
      .from("maintenance_plans")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("app", APP_ID)
      .eq("plan_kind", "mow")
      .eq("status", "active")
      .in("frequency", ["weekly", "biweekly", "monthly"]);
    if (error) throw error;
    return count ?? 0;
  }
  const { count, error } = await (supabase as any)
    .from("maintenance_plans")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("app", APP_ID)
    .eq("pause_reason", "winter_swap");
  if (error) throw error;
  return count ?? 0;
}

interface SwapResult {
  season: Season;
  affected: number;
}

/**
 * Direct-DB fallback when the swap-season edge function returns an error
 * (typically because it isn't deployed in this environment). Same logical
 * effect, just two round-trips instead of one transaction.
 */
async function swapSeasonFallback(
  userId: string,
  to: Season,
): Promise<SwapResult> {
  const now = new Date().toISOString();

  // 1) user_settings update-then-insert.
  const { data: existing } = await (supabase as any)
    .from("user_settings")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) {
    const { error } = await (supabase as any)
      .from("user_settings")
      .update({ season: to, season_changed_at: now })
      .eq("user_id", userId);
    if (error) throw error;
  } else {
    const { error } = await (supabase as any)
      .from("user_settings")
      .insert({ user_id: userId, season: to, season_changed_at: now });
    if (error) throw error;
  }

  // 2) Plan bulk update.
  let affected = 0;
  if (to === "winter") {
    const { data, error } = await (supabase as any)
      .from("maintenance_plans")
      .update({ status: "paused", pause_reason: "winter_swap" })
      .eq("user_id", userId)
      .eq("app", APP_ID)
      .eq("plan_kind", "mow")
      .eq("status", "active")
      .in("frequency", ["weekly", "biweekly", "monthly"])
      .select("id");
    if (error) throw error;
    affected = data?.length ?? 0;
  } else {
    const { data, error } = await (supabase as any)
      .from("maintenance_plans")
      .update({ status: "active", pause_reason: null })
      .eq("user_id", userId)
      .eq("app", APP_ID)
      .eq("pause_reason", "winter_swap")
      .select("id");
    if (error) throw error;
    affected = data?.length ?? 0;
  }
  return { season: to, affected };
}

/**
 * Hook that returns a mutation wrapping the swap-season edge function with
 * a direct-DB fallback. Invalidates the cached season + any plan queries
 * on success so the UI re-renders without a manual refetch.
 */
export function useSwapSeason() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (to: Season): Promise<SwapResult> => {
      if (!user?.id) throw new Error("Not signed in");
      // Try the edge function first.
      try {
        const { data, error } = await supabase.functions.invoke<SwapResult>(
          "swap-season",
          { method: "POST", body: { to } },
        );
        if (error) throw error;
        if (!data) throw new Error("Empty response from swap-season");
        return data;
      } catch (e) {
        // Function not deployed / network error — degrade gracefully.
        console.warn(
          "[season] swap-season edge fn failed, using DB fallback:",
          e instanceof Error ? e.message : e,
        );
        return swapSeasonFallback(user.id, to);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["season", user?.id] });
      // Plan queries may be keyed many ways across the app; invalidate the
      // common roots. Cheap operation — react-query refetches only what
      // is actively subscribed.
      qc.invalidateQueries({ queryKey: ["maintenance_plans"] });
      qc.invalidateQueries({ queryKey: ["plans"] });
    },
  });
}
