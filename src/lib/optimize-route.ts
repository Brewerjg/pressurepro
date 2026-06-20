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
