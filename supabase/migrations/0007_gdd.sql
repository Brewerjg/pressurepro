-- 0007_gdd.sql
--
-- Adds the gdd_cache table backing the compute-gdd edge function.
--
-- Growing-Degree-Days is the agronomic measure that decides when crabgrass
-- pre-emergent herbicide should be applied. The compute-gdd edge function
-- composes today's GDD + an approximated YTD running total + a 7-day forward
-- projection, and stamps the resulting payload here keyed by ZIP. TTL is 6
-- hours which matches the upstream `weather_cache` cadence (forecast inputs
-- only refresh that often anyway).
--
-- We deliberately keep this table separate from `weather_cache` because:
--   1. The payload shape is computed (pre_emergent status, cumulative_gdd_ytd),
--      not raw weather, and we don't want to invalidate it whenever the
--      forecast cache turns over.
--   2. Keying includes base_f so a future "fungicide GDD" variant (base 65°F)
--      can coexist without a schema change.
--
-- Access: service-role only. No RLS policies are defined, and with RLS
-- enabled that means authenticated/anon roles cannot read or write — exactly
-- the desired posture since the edge function uses the service role key.

BEGIN;

CREATE TABLE IF NOT EXISTS public.gdd_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zip TEXT NOT NULL,
  base_f INTEGER NOT NULL DEFAULT 50,
  payload JSONB NOT NULL,            -- full response object
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '6 hours'),
  UNIQUE (zip, base_f)
);

CREATE INDEX IF NOT EXISTS idx_gdd_cache_expires
  ON public.gdd_cache(expires_at);

ALTER TABLE public.gdd_cache ENABLE ROW LEVEL SECURITY;
-- Service-role only — no policies = no access for authenticated/anon.

COMMIT;
