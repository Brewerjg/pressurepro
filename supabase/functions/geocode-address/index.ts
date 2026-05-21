// Geocode edge function — street address -> { lat, lng, formatted_address } via Mapbox.
//
// Ported verbatim from PressurePro's supabase/functions/geocode-address/index.ts.
// Secret MAPBOX_ACCESS_TOKEN is configured at the project level.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { address } = await req.json();
    if (!address || typeof address !== "string" || address.length > 500) {
      return new Response(JSON.stringify({ error: "Invalid address" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = Deno.env.get("MAPBOX_ACCESS_TOKEN");
    if (!token) {
      return new Response(JSON.stringify({ error: "Geocoding not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${token}&limit=1&country=us`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Mapbox ${r.status}`);
    const data = await r.json();
    const f = data.features?.[0];
    if (!f) {
      return new Response(
        JSON.stringify({ lat: null, lng: null, formatted_address: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const [lng, lat] = f.center as [number, number];
    return new Response(
      // PressurePro returned { place }, TurfPro client expects { formatted_address }.
      // Keep both for backwards compatibility with any PP callers.
      JSON.stringify({ lat, lng, formatted_address: f.place_name, place: f.place_name }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
