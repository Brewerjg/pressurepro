-- TurfPro — additive migration on top of PressurePro's schema.
--
-- TurfPro shares the PressurePro Supabase project (see TURFPRO_SPEC.md
-- "Concrete near-term moves"), so this file ADDs new tables/columns rather
-- than redefining anything. Apply once in the shared project's SQL editor;
-- existing PressurePro behavior is unaffected because:
--   - new columns are nullable or have defaults
--   - new tables are namespaced by intent (routes / route_stops / chemical_applications)
--   - RLS policies are scoped to auth.uid() just like the existing tables
--
-- Order matters: properties + maintenance_plans columns first, then new tables
-- that reference them.

BEGIN;

-- =====================================================================
-- 1. properties — lawn-specific fields
--    The base table (id, customer_id, address, sqft, gate_code, dog_warning)
--    is reused verbatim from PressurePro.
-- =====================================================================
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS turf_sqft INTEGER,
  -- Cool-season vs warm-season drives mow height + fert schedule. Free text
  -- so operators can write 'bermuda/fescue mix' or regional names.
  ADD COLUMN IF NOT EXISTS grass_type TEXT,
  -- Decimal inches (3.5 = three-and-a-half-inch deck height).
  ADD COLUMN IF NOT EXISTS mow_height_in NUMERIC(3,1),
  -- Pet-safe chem only — gates which products show in the application calc.
  ADD COLUMN IF NOT EXISTS pet_safe_only BOOLEAN NOT NULL DEFAULT false,
  -- Has irrigation? If yes, drought-stretch logic should NOT auto-skip
  -- (their grass keeps growing during dry spells).
  ADD COLUMN IF NOT EXISTS irrigation_present BOOLEAN NOT NULL DEFAULT false,
  -- Crew safety / mower selection hint.
  ADD COLUMN IF NOT EXISTS slope_warning BOOLEAN NOT NULL DEFAULT false,
  -- Default disposition for clippings on this property.
  ADD COLUMN IF NOT EXISTS bag_clippings BOOLEAN NOT NULL DEFAULT false;

-- =====================================================================
-- 2. maintenance_plans — lawn-specific scheduling fields
--    interval_months CHECK from PressurePro is (3, 6, 12) and stays as-is
--    for billing cadence. Frequency below is the SERVICE cadence which is
--    independent — a customer can be on a 12-month billing plan that's
--    delivered weekly.
-- =====================================================================
ALTER TABLE public.maintenance_plans
  -- 0 = Sunday ... 6 = Saturday. Default route day for this property.
  ADD COLUMN IF NOT EXISTS day_of_week SMALLINT CHECK (day_of_week BETWEEN 0 AND 6),
  -- Service cadence — separate from billing cadence.
  ADD COLUMN IF NOT EXISTS frequency TEXT NOT NULL DEFAULT 'weekly'
    CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'fert_program')),
  -- Northern markets pause winter ('winter') or summer-vacation drops.
  -- Stored as a TEXT[] of season tokens: 'winter' | 'summer' | 'fall' | 'spring'.
  ADD COLUMN IF NOT EXISTS season_pause TEXT[] NOT NULL DEFAULT '{}',
  -- Distinguishes a recurring-mow plan from a fert-program plan.
  -- 'mow' is the default and matches today's PressurePro plans behavior.
  ADD COLUMN IF NOT EXISTS plan_kind TEXT NOT NULL DEFAULT 'mow'
    CHECK (plan_kind IN ('mow', 'fert_program', 'other'));

CREATE INDEX IF NOT EXISTS idx_plans_day_of_week
  ON public.maintenance_plans(day_of_week) WHERE status = 'active';

-- =====================================================================
-- 3. routes — an ordered list of property stops for one crew on one day
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  crew_id UUID REFERENCES public.crews(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_progress', 'complete', 'skipped')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  -- Snapshot at end-of-route so historical reports don't have to re-aggregate
  -- against constantly-changing route_stops. Optional; backfilled by an edge
  -- function or trigger when the route is marked complete.
  total_stops INTEGER,
  completed_stops INTEGER,
  total_miles NUMERIC(6,1),
  total_minutes INTEGER,
  total_collected_cents BIGINT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_routes_user_date ON public.routes(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_routes_crew_date ON public.routes(crew_id, date DESC);
ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own routes"   ON public.routes FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users insert own routes" ON public.routes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own routes" ON public.routes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own routes" ON public.routes FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER routes_updated_at BEFORE UPDATE ON public.routes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =====================================================================
-- 4. route_stops — the ordered visits on a route
--    A stop ties a route to a property and (optionally) the plan that
--    spawned it. Per-stop status is independent of route status so a route
--    can be 'in_progress' with 3 done / 1 skipped / 7 pending.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.route_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  route_id UUID NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES public.maintenance_plans(id) ON DELETE SET NULL,
  property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  -- Denormalized snapshot — survives plan/customer deletion so historical
  -- routes remain readable.
  address_snapshot TEXT,
  customer_name_snapshot TEXT,
  -- Display services from the plan at scheduling time, e.g. {'mow','edge','blow'}.
  services TEXT[] NOT NULL DEFAULT '{}',
  -- Expected fee in cents (avoids floating-point drift on bookkeeping math).
  fee_cents BIGINT,
  sort_order INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'done', 'skipped')),
  -- Why was it skipped? 'rain' | 'drought' | 'customer_travel' | 'gate_locked' | 'no_show' | 'other'
  skip_reason TEXT,
  arrived_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  -- Drive-time/miles FROM the previous stop. Populated by routing logic.
  drive_minutes_from_prev INTEGER,
  drive_miles_from_prev NUMERIC(5,2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (route_id, sort_order)
);
CREATE INDEX IF NOT EXISTS idx_stops_route_sort  ON public.route_stops(route_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_stops_user        ON public.route_stops(user_id);
CREATE INDEX IF NOT EXISTS idx_stops_plan        ON public.route_stops(plan_id);
CREATE INDEX IF NOT EXISTS idx_stops_property    ON public.route_stops(property_id);
ALTER TABLE public.route_stops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own stops"   ON public.route_stops FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users insert own stops" ON public.route_stops FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own stops" ON public.route_stops FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own stops" ON public.route_stops FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER stops_updated_at BEFORE UPDATE ON public.route_stops
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =====================================================================
-- 5. chemical_applications — pesticide/herbicide/fertilizer compliance log
--    Most US states require licensed applicators to log: product, EPA reg #,
--    rate, date/time/weather, applicator, customer notified. This is the
--    structured record; an export function can roll it up for annual reports.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.chemical_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  route_stop_id UUID REFERENCES public.route_stops(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applicator_name TEXT,
  applicator_license TEXT,
  -- Product details.
  product_name TEXT NOT NULL,
  epa_reg_number TEXT,
  active_ingredient TEXT,
  application_type TEXT NOT NULL
    CHECK (application_type IN ('fertilizer', 'herbicide', 'pesticide', 'fungicide', 'lime', 'other')),
  -- Rate as applied: e.g. "1.0 lb N / 1000 sqft" or "2 oz / gal".
  rate_amount NUMERIC(8,3),
  rate_unit TEXT,
  -- Total used across the application (bags / oz / gal).
  total_amount NUMERIC(10,3),
  total_unit TEXT,
  -- Area covered in sqft.
  area_sqft INTEGER,
  -- Weather at application time (regulatory requirement in many states).
  temperature_f NUMERIC(4,1),
  wind_mph NUMERIC(4,1),
  conditions TEXT, -- 'sunny' / 'cloudy' / 'after-rain' free text
  -- Notification of customer (required for some pesticides).
  customer_notified BOOLEAN NOT NULL DEFAULT false,
  signs_posted BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chem_user_applied ON public.chemical_applications(user_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_chem_property     ON public.chemical_applications(property_id);
CREATE INDEX IF NOT EXISTS idx_chem_route_stop   ON public.chemical_applications(route_stop_id);
ALTER TABLE public.chemical_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own chem apps"   ON public.chemical_applications FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users insert own chem apps" ON public.chemical_applications FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own chem apps" ON public.chemical_applications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own chem apps" ON public.chemical_applications FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER chem_updated_at BEFORE UPDATE ON public.chemical_applications
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMIT;
