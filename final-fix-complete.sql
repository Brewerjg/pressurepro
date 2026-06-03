-- COMPREHENSIVE FIX FOR TURFPRO AUTHENTICATION AND ONBOARDING
-- This script fixes all database issues preventing PressurePro users from using TurfPro

BEGIN;

-- =====================================================================
-- 1. ENSURE PROFILES TABLE HAS ALL REQUIRED COLUMNS
-- =====================================================================
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT false;

-- Add TurfPro-specific columns if they don't exist
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS business_name TEXT,
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS zip TEXT;

-- =====================================================================
-- 2. FIX RLS POLICIES - HANDLE BOTH ID AND USER_ID COLUMNS
-- =====================================================================

-- Drop all existing policies
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Users view own profile" ON profiles;
DROP POLICY IF EXISTS "Users update own profile" ON profiles;
DROP POLICY IF EXISTS "Users insert own profile" ON profiles;

-- Create new unified policies that work with EITHER column
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT
    USING (auth.uid() = id OR auth.uid() = user_id);

CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE
    USING (auth.uid() = id OR auth.uid() = user_id)
    WITH CHECK (auth.uid() = id OR auth.uid() = user_id);

CREATE POLICY "Users can insert own profile" ON profiles
    FOR INSERT
    WITH CHECK (auth.uid() = id OR auth.uid() = user_id);

-- =====================================================================
-- 3. CREATE MISSING RPC FUNCTION FOR CATALOG SEEDING
-- =====================================================================
CREATE OR REPLACE FUNCTION public.seed_default_lawn_catalog(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Check if catalog_items table exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'catalog_items' AND table_schema = 'public'
    ) THEN
        RAISE NOTICE 'catalog_items table does not exist, skipping seed';
        RETURN;
    END IF;

    -- Insert default lawn care catalog items
    INSERT INTO catalog_items (user_id, name, unit, default_rate, min_charge, sort_order, created_at)
    VALUES
        (p_user_id, 'Weekly mow', 'flat', 45, 45, 10, NOW()),
        (p_user_id, 'Biweekly mow', 'flat', 55, 55, 20, NOW()),
        (p_user_id, 'Edge', 'flat', 10, 10, 30, NOW()),
        (p_user_id, 'Trim', 'flat', 10, 10, 40, NOW()),
        (p_user_id, 'Blow', 'flat', 8, 8, 50, NOW()),
        (p_user_id, 'Spring cleanup', 'flat', 175, 175, 100, NOW()),
        (p_user_id, 'Fall cleanup', 'flat', 195, 195, 110, NOW()),
        (p_user_id, 'Leaf removal', 'flat', 145, 145, 120, NOW()),
        (p_user_id, 'Aeration', 'flat', 125, 125, 200, NOW()),
        (p_user_id, 'Overseed', 'flat', 165, 165, 210, NOW()),
        (p_user_id, 'Dethatching', 'flat', 145, 145, 220, NOW()),
        (p_user_id, 'Mulch install', 'flat', 75, 75, 230, NOW()),
        (p_user_id, 'Fert step 1 (pre-emergent)', 'flat', 85, 85, 300, NOW()),
        (p_user_id, 'Fert step 2 (weed + feed)', 'flat', 85, 85, 310, NOW()),
        (p_user_id, 'Fert step 3 (summer feed)', 'flat', 85, 85, 320, NOW()),
        (p_user_id, 'Fert step 4 (fall feed)', 'flat', 85, 85, 330, NOW()),
        (p_user_id, 'Fert step 5 (winterize)', 'flat', 85, 85, 340, NOW()),
        (p_user_id, 'Weed control (spot)', 'flat', 65, 65, 400, NOW()),
        (p_user_id, 'Grub control', 'flat', 95, 95, 410, NOW()),
        (p_user_id, 'Lime application', 'flat', 75, 75, 420, NOW()),
        (p_user_id, 'Snow plow (per visit)', 'flat', 75, 75, 900, NOW()),
        (p_user_id, 'Snow shovel (per visit)', 'flat', 55, 55, 910, NOW())
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Lawn catalog seeded for user %', p_user_id;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.seed_default_lawn_catalog(uuid) TO authenticated;

-- =====================================================================
-- 4. FIX ALL EXISTING PROFILES - ENSURE NOT DEMO
-- =====================================================================
-- Set all existing profiles to NOT be demo accounts
UPDATE profiles
SET is_demo = false
WHERE is_demo IS NULL OR is_demo = true;

-- For PressurePro users who haven't onboarded to TurfPro yet
UPDATE profiles
SET onboarded_at = NULL
WHERE onboarded_at IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM catalog_items
        WHERE catalog_items.user_id = profiles.id
            OR catalog_items.user_id = profiles.user_id
    );

-- =====================================================================
-- 5. VERIFY THE FIX
-- =====================================================================
-- Check table structure
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=== VERIFICATION ===';
    RAISE NOTICE '';

    -- Check if critical columns exist
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'profiles' AND column_name = 'is_demo') THEN
        RAISE NOTICE '✅ is_demo column exists';
    ELSE
        RAISE WARNING '❌ is_demo column missing';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'profiles' AND column_name = 'onboarded_at') THEN
        RAISE NOTICE '✅ onboarded_at column exists';
    ELSE
        RAISE WARNING '❌ onboarded_at column missing';
    END IF;

    -- Check RLS policies
    IF EXISTS (SELECT 1 FROM pg_policies
               WHERE tablename = 'profiles' AND policyname = 'Users can view own profile') THEN
        RAISE NOTICE '✅ RLS policies configured';
    ELSE
        RAISE WARNING '❌ RLS policies missing';
    END IF;

    -- Check RPC function
    IF EXISTS (SELECT 1 FROM pg_proc
               WHERE proname = 'seed_default_lawn_catalog') THEN
        RAISE NOTICE '✅ seed_default_lawn_catalog function exists';
    ELSE
        RAISE WARNING '❌ seed_default_lawn_catalog function missing';
    END IF;

    RAISE NOTICE '';
    RAISE NOTICE '=== FIX COMPLETE ===';
END $$;

COMMIT;

-- Show current profiles status
SELECT
    COALESCE(p.id::text, p.user_id::text) as profile_id,
    CASE
        WHEN u.email IS NOT NULL THEN u.email
        ELSE 'Unknown'
    END as user_email,
    p.is_demo,
    p.onboarded_at,
    p.business_name,
    p.created_at
FROM profiles p
LEFT JOIN auth.users u ON (u.id = p.id OR u.id = p.user_id)
ORDER BY p.created_at DESC
LIMIT 20;

SELECT 'Database fixed! Sign out and sign back in to test.' as message;