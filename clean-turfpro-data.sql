-- Clean up all TurfPro-specific data while preserving PressurePro data
-- Run this in your Supabase SQL editor

BEGIN;

-- 1. Delete all TurfPro-specific tables data
DELETE FROM public.route_stops;
DELETE FROM public.routes;
DELETE FROM public.chemical_applications;
DELETE FROM public.chemical_inventory;
DELETE FROM public.photo_pairs_lawn;
DELETE FROM public.campaigns;
DELETE FROM public.sms_messages;
DELETE FROM public.sms_conversations;
DELETE FROM public.sms_templates;
DELETE FROM public.email_log;
DELETE FROM public.weather_cache;
DELETE FROM public.gdd_accumulation;
DELETE FROM public.snow_swap;

-- 2. Reset TurfPro-specific columns in shared tables
-- Reset properties table TurfPro columns
UPDATE public.properties
SET
  turf_sqft = NULL,
  grass_type = NULL,
  mow_height_in = NULL,
  pet_safe_only = false,
  irrigation_present = false,
  slope_warning = false,
  bag_clippings = false
WHERE turf_sqft IS NOT NULL
   OR grass_type IS NOT NULL
   OR mow_height_in IS NOT NULL;

-- Reset maintenance_plans TurfPro columns
UPDATE public.maintenance_plans
SET
  day_of_week = NULL,
  frequency = 'weekly',
  season_pause = NULL,
  plan_kind = NULL
WHERE day_of_week IS NOT NULL
   OR frequency != 'weekly'
   OR season_pause IS NOT NULL
   OR plan_kind IS NOT NULL;

-- 3. Clean up catalog items that are lawn-specific
-- This assumes catalog items with certain names are TurfPro-specific
DELETE FROM public.catalog_items
WHERE name IN (
  'Weekly mow',
  'Biweekly mow',
  'Edge',
  'Trim',
  'Blow',
  'Spring cleanup',
  'Fall cleanup',
  'Leaf removal',
  'Aeration',
  'Overseed',
  'Dethatching',
  'Mulch install',
  'Fert step 1 (pre-emergent)',
  'Fert step 2 (weed + feed)',
  'Fert step 3 (summer feed)',
  'Fert step 4 (fall feed)',
  'Fert step 5 (winterize)',
  'Weed control (spot)',
  'Grub control',
  'Lime application',
  'Snow plow (per visit)',
  'Snow shovel (per visit)'
);

-- 4. Reset profiles onboarding status for TurfPro
-- Keep the profile but reset onboarded_at so user goes through TurfPro onboarding
UPDATE public.profiles
SET
  onboarded_at = NULL,
  is_demo = false
WHERE user_id IN (SELECT auth.uid());

-- 5. Clean up any TurfPro-specific crews
DELETE FROM public.crews
WHERE color IN ('#1f7a44', '#b08236', '#3b6fb0', '#a23c5b', '#5b6b3a', '#7a4b1f', '#3a6b6b', '#6b3a6b');

COMMIT;

SELECT 'TurfPro data cleaned successfully!' as status;