-- 0025_route_start_address.sql
-- Optional operator start location (shop/home). Used by route optimization as
-- the round-trip origin/destination. Plain address string — Google geocodes it.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS route_start_address TEXT;

COMMENT ON COLUMN public.profiles.route_start_address IS
  'Operator shop/home address; route optimization uses it as the round-trip start/end. Null = fall back to the first stop.';
