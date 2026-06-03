-- Clean up all TurfPro-specific data while preserving PressurePro data
-- This version checks if tables exist before trying to delete from them

BEGIN;

-- Helper function to check if table exists
DO $$
BEGIN

-- 1. Delete from TurfPro-specific tables (only if they exist)
IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'route_stops' AND table_schema = 'public') THEN
    DELETE FROM public.route_stops;
END IF;

IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'routes' AND table_schema = 'public') THEN
    DELETE FROM public.routes;
END IF;

IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chemical_applications' AND table_schema = 'public') THEN
    DELETE FROM public.chemical_applications;
END IF;

IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chemical_inventory' AND table_schema = 'public') THEN
    DELETE FROM public.chemical_inventory;
END IF;

IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'photo_pairs_lawn' AND table_schema = 'public') THEN
    DELETE FROM public.photo_pairs_lawn;
END IF;

IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'campaigns' AND table_schema = 'public') THEN
    DELETE FROM public.campaigns;
END IF;

IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sms_messages' AND table_schema = 'public') THEN
    DELETE FROM public.sms_messages;
END IF;

IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sms_conversations' AND table_schema = 'public') THEN
    DELETE FROM public.sms_conversations;
END IF;

IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sms_templates' AND table_schema = 'public') THEN
    DELETE FROM public.sms_templates;
END IF;

IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'email_log' AND table_schema = 'public') THEN
    DELETE FROM public.email_log;
END IF;

IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'weather_cache' AND table_schema = 'public') THEN
    DELETE FROM public.weather_cache;
END IF;

IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gdd_accumulation' AND table_schema = 'public') THEN
    DELETE FROM public.gdd_accumulation;
END IF;

IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'snow_swap' AND table_schema = 'public') THEN
    DELETE FROM public.snow_swap;
END IF;

END $$;

-- 2. Reset TurfPro-specific columns in shared tables (only if columns exist)
DO $$
BEGIN
    -- Check and reset properties columns
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'properties' AND column_name = 'turf_sqft') THEN
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
    END IF;

    -- Check and reset maintenance_plans columns
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'maintenance_plans' AND column_name = 'day_of_week') THEN
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
    END IF;
END $$;

-- 3. Clean up catalog items that are lawn-specific (if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'catalog_items' AND table_schema = 'public') THEN
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
    END IF;
END $$;

-- 4. Reset profiles onboarding status for TurfPro (if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'profiles' AND table_schema = 'public') THEN
        -- Add is_demo column if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'is_demo') THEN
            ALTER TABLE public.profiles ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT false;
        END IF;

        -- Reset onboarding for current user
        UPDATE public.profiles
        SET
            onboarded_at = NULL,
            is_demo = false
        WHERE user_id = auth.uid();
    END IF;
END $$;

-- 5. Clean up any TurfPro-specific crews (if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'crews' AND table_schema = 'public') THEN
        DELETE FROM public.crews
        WHERE color IN ('#1f7a44', '#b08236', '#3b6fb0', '#a23c5b', '#5b6b3a', '#7a4b1f', '#3a6b6b', '#6b3a6b');
    END IF;
END $$;

COMMIT;

SELECT 'TurfPro data cleaned successfully!' as status;