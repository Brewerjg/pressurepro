// Geocoding helper — wraps the `geocode-address` edge function.
//
// The edge fn proxies Mapbox so the access token never reaches the browser.
// Returns null when the address can't be resolved instead of throwing — most
// callers want to fall back to "missing coordinates" UI rather than blow up
// the entire mutation chain.
import { supabase } from "@/integrations/supabase/client";

export interface GeocodeResult {
  lat: number;
  lng: number;
  formatted_address: string;
}

interface EdgePayload {
  lat?: number | null;
  lng?: number | null;
  formatted_address?: string | null;
  place?: string | null; // PressurePro legacy shape
  error?: string;
}

/**
 * Geocode a free-form street address. Returns null if the address can't be
 * resolved by Mapbox; throws only on infrastructure failures (network, auth,
 * misconfigured token) so callers can distinguish "bad address" from
 * "service down".
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const cleaned = address.trim();
  if (!cleaned) return null;
  const { data, error } = await supabase.functions.invoke<EdgePayload>(
    "geocode-address",
    { body: { address: cleaned } },
  );
  if (error) throw new Error(error.message ?? "geocode failed");
  if (!data) throw new Error("Empty geocode response");
  if (data.error) throw new Error(data.error);
  if (typeof data.lat !== "number" || typeof data.lng !== "number") {
    return null;
  }
  return {
    lat: data.lat,
    lng: data.lng,
    formatted_address: data.formatted_address ?? data.place ?? cleaned,
  };
}
