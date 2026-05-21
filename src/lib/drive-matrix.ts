// Drive-matrix helper — wraps the `drive-matrix` edge function.
//
// Hook form for routes-day display; raw-call form for the "Start route"
// mutation that needs the legs synchronously inside an existing async block.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface DriveStop {
  lat: number;
  lng: number;
}

export interface DriveLeg {
  from_idx: number;
  to_idx: number;
  minutes: number;
  miles: number;
}

interface EdgePayload {
  legs?: DriveLeg[];
  error?: string;
  cached?: boolean;
}

/**
 * Compute drive legs between consecutive stops via the `drive-matrix` edge fn.
 * Server caches by sequence hash for 7 days, so calling this with the same
 * ordered stops is effectively free.
 */
export async function fetchDriveMatrix(stops: DriveStop[]): Promise<DriveLeg[]> {
  if (stops.length < 2) return [];
  const { data, error } = await supabase.functions.invoke<EdgePayload>(
    "drive-matrix",
    { body: { stops } },
  );
  if (error) throw new Error(error.message ?? "drive-matrix failed");
  if (!data) return [];
  if (data.error) throw new Error(data.error);
  return data.legs ?? [];
}

/**
 * React-query wrapper. Returns null until at least 2 stops with coords
 * are supplied. Sequence-based key means re-ordering invalidates correctly.
 */
export function useDriveMatrix(stops: DriveStop[]) {
  // Stable cache key from rounded coords + order.
  const key = stops
    .map((s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`)
    .join("|");
  return useQuery({
    queryKey: ["drive-matrix", key],
    enabled: stops.length >= 2,
    staleTime: 60 * 60 * 1000, // 1 hour client-side; server caches 7 days
    queryFn: () => fetchDriveMatrix(stops),
  });
}
