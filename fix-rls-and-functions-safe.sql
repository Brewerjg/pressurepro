-- Fix RLS policies and missing functions for TurfPro (safe version)

BEGIN;

-- 1. Fix RLS policies for profiles table
-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;

-- Create proper RLS policies that work with both id and user_id columns
-- First check which column exists
DO $$
BEGIN
    -- For tables using 'id' as primary key (PressurePro style)
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'profiles' AND column_name = 'id'
               AND column_name NOT IN ('user_id')) THEN

        EXECUTE 'CREATE POLICY "Users can view own profile" ON profiles
                FOR SELECT USING (auth.uid() = id)';

        EXECUTE 'CREATE POLICY "Users can update own profile" ON profiles
                FOR UPDATE USING (auth.uid() = id)';

        EXECUTE 'CREATE POLICY "Users can insert own profile" ON profiles
                FOR INSERT WITH CHECK (auth.uid() = id)';

    -- For tables using 'user_id' (alternative style)
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'profiles' AND column_name = 'user_id') THEN

        EXECUTE 'CREATE POLICY "Users can view own profile" ON profiles
                FOR SELECT USING (auth.uid() = user_id)';

        EXECUTE 'CREATE POLICY "Users can update own profile" ON profiles
                FOR UPDATE USING (auth.uid() = user_id)';

        EXECUTE 'CREATE POLICY "Users can insert own profile" ON profiles
                FOR INSERT WITH CHECK (auth.uid() = user_id)';
    END IF;
END $$;

-- 2. Create the missing seed_default_lawn_catalog RPC function
CREATE OR REPLACE FUNCTION public.seed_default_lawn_catalog(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Check if catalog_items table exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_name = 'catalog_items' AND table_schema = 'public') THEN
        RAISE NOTICE 'catalog_items table does not exist, skipping seed';
        RETURN;
    END IF;

    -- Insert default catalog items for the user
    INSERT INTO catalog_items (user_id, name, unit, default_rate, min_charge, sort_order)
    VALUES
        (p_user_id, 'Weekly mow', 'flat', 45, 45, 10),
        (p_user_id, 'Biweekly mow', 'flat', 55, 55, 20),
        (p_user_id, 'Edge', 'flat', 10, 10, 30),
        (p_user_id, 'Trim', 'flat', 10, 10, 40),
        (p_user_id, 'Blow', 'flat', 8, 8, 50),
        (p_user_id, 'Spring cleanup', 'flat', 175, 175, 100),
        (p_user_id, 'Fall cleanup', 'flat', 195, 195, 110),
        (p_user_id, 'Leaf removal', 'flat', 145, 145, 120),
        (p_user_id, 'Aeration', 'flat', 125, 125, 200),
        (p_user_id, 'Overseed', 'flat', 165, 165, 210),
        (p_user_id, 'Dethatching', 'flat', 145, 145, 220),
        (p_user_id, 'Mulch install', 'flat', 75, 75, 230),
        (p_user_id, 'Fert step 1 (pre-emergent)', 'flat', 85, 85, 300),
        (p_user_id, 'Fert step 2 (weed + feed)', 'flat', 85, 85, 310),
        (p_user_id, 'Fert step 3 (summer feed)', 'flat', 85, 85, 320),
        (p_user_id, 'Fert step 4 (fall feed)', 'flat', 85, 85, 330),
        (p_user_id, 'Fert step 5 (winterize)', 'flat', 85, 85, 340),
        (p_user_id, 'Weed control (spot)', 'flat', 65, 65, 400),
        (p_user_id, 'Grub control', 'flat', 95, 95, 410),
        (p_user_id, 'Lime application', 'flat', 75, 75, 420),
        (p_user_id, 'Snow plow (per visit)', 'flat', 75, 75, 900),
        (p_user_id, 'Snow shovel (per visit)', 'flat', 55, 55, 910)
    ON CONFLICT DO NOTHING;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.seed_default_lawn_catalog(uuid) TO authenticated;

-- 3. Ensure the profiles table has all needed columns
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS business_name TEXT,
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS zip TEXT,
    ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT false;

-- 4. Show current profile structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'profiles'
ORDER BY ordinal_position;

-- 5. Check existing RLS policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'profiles';

COMMIT;

-- Note: To create/update your profile, sign in to the app and go through onboarding
-- The app will create the profile with the correct user ID

SELECT 'RLS policies and functions fixed! Sign in to the app to create your profile.' as status;