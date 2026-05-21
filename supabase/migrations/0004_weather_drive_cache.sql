-- 0004_weather_drive_cache.sql
--
-- Adds the drive_matrix_cache table backing the drive-matrix edge function.
-- The weather_cache table already exists in the shared Supabase project
-- (created by PressurePro migration 20260502014522), so this migration only
-- adds the drive cache.
--
-- Cache semantics: keyed by SHA-256 hash of the ordered sequence
-- "lat,lng|lat,lng|...". Rows expire after 7 days (driving conditions are
-- structurally stable on that horizon — congestion is captured per-day by
-- Mapbox traffic, which we deliberately do not subscribe to here).
--
-- Access: service-role only. No RLS policies are defined, and with RLS
-- enabled that means authenticated/anon roles cannot read or write — exactly
-- the desired posture since the edge function uses the service role key.

BEGIN;

CREATE TABLE IF NOT EXISTS public.drive_matrix_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_hash TEXT NOT NULL UNIQUE,
  legs JSONB NOT NULL,  -- array of {from_idx, to_idx, minutes, miles}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE INDEX IF NOT EXISTS idx_drive_matrix_expires
  ON public.drive_matrix_cache(expires_at);

ALTER TABLE public.drive_matrix_cache ENABLE ROW LEVEL SECURITY;
-- Cache is service-role only. RLS denies all by default (no policies = no
-- access for authenticated/anon).

COMMIT;
