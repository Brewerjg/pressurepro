ALTER TABLE public.photo_pairs
  ADD COLUMN IF NOT EXISTS route_stop_id UUID REFERENCES public.route_stops(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS public_gallery BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_photo_pairs_route_stop
  ON public.photo_pairs(route_stop_id) WHERE route_stop_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_photo_pairs_property_public
  ON public.photo_pairs(property_id) WHERE public_gallery = true;
