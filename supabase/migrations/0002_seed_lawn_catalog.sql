-- TurfPro — seed lawn-service catalog rows for a new user.
--
-- The catalog_items table already exists from PressurePro (it's the same DB).
-- This adds a helper that seeds lawn-care services for any user who doesn't
-- already have a populated catalog. Idempotent — re-running won't duplicate.

CREATE OR REPLACE FUNCTION private.seed_default_lawn_catalog(_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Skip if user already has any catalog rows (operator may have customized).
  IF EXISTS (SELECT 1 FROM public.catalog_items WHERE user_id = _user_id AND kind = 'service') THEN
    RETURN;
  END IF;

  INSERT INTO public.catalog_items (user_id, kind, name, unit, default_rate, min_charge, sort_order) VALUES
    -- Mow bundle — flat fee per visit is standard for residential lawn.
    (_user_id, 'service', 'Weekly mow',         'flat', 45,  45,  10),
    (_user_id, 'service', 'Biweekly mow',       'flat', 55,  55,  20),
    (_user_id, 'service', 'Edge',               'flat', 10,  10,  30),
    (_user_id, 'service', 'Trim',               'flat', 10,  10,  40),
    (_user_id, 'service', 'Blow',               'flat', 8,   8,   50),
    -- Seasonal one-offs.
    (_user_id, 'service', 'Spring cleanup',     'flat', 175, 175, 100),
    (_user_id, 'service', 'Fall cleanup',       'flat', 195, 195, 110),
    (_user_id, 'service', 'Leaf removal',       'flat', 145, 145, 120),
    (_user_id, 'service', 'Aeration',           'flat', 125, 125, 200),
    (_user_id, 'service', 'Overseed',           'flat', 165, 165, 210),
    (_user_id, 'service', 'Dethatching',        'flat', 145, 145, 220),
    (_user_id, 'service', 'Mulch install',      'flat', 75,  75,  230),
    -- Fert program — operators usually charge per visit; the 5-step is the round.
    (_user_id, 'service', 'Fert step 1 (pre-emergent)', 'flat', 85, 85, 300),
    (_user_id, 'service', 'Fert step 2 (weed + feed)',  'flat', 85, 85, 310),
    (_user_id, 'service', 'Fert step 3 (summer feed)',  'flat', 85, 85, 320),
    (_user_id, 'service', 'Fert step 4 (fall feed)',    'flat', 85, 85, 330),
    (_user_id, 'service', 'Fert step 5 (winterize)',    'flat', 85, 85, 340),
    -- Spot treatments.
    (_user_id, 'service', 'Weed control (spot)', 'flat', 65,  65,  400),
    (_user_id, 'service', 'Grub control',        'flat', 95,  95,  410),
    (_user_id, 'service', 'Lime application',    'flat', 75,  75,  420),
    -- Winter swap (northern markets).
    (_user_id, 'service', 'Snow plow (per visit)', 'flat', 75,  75,  900),
    (_user_id, 'service', 'Snow shovel (per visit)','flat', 55,  55,  910);
END;
$$;
REVOKE EXECUTE ON FUNCTION private.seed_default_lawn_catalog(UUID) FROM PUBLIC, anon, authenticated;
