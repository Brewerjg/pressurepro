-- CRITICAL FIX: RLS and Profile Issues for PressurePro Users in TurfPro
-- This fixes the onboarding loop by ensuring profiles can be read and updated

BEGIN;

-- 1. First, check current profile state for the grammer user
SELECT 'Current Profile State:' as status;
SELECT
  p.*,
  u.email
FROM profiles p
JOIN auth.users u ON (u.id = p.id OR u.id = p.user_id)
WHERE u.id = '2b87cfb8-fab2-4fcc-848c-983d6e2de04a'
   OR u.email LIKE '%grammer%';

-- 2. Ensure the profile has BOTH id and user_id columns set to the same value
-- This is critical for compatibility between TurfPro and PressurePro
UPDATE profiles
SET
  id = COALESCE(id, user_id),
  user_id = COALESCE(user_id, id),
  onboarded_at = COALESCE(onboarded_at, NOW()),
  is_demo = false
WHERE
  (id = '2b87cfb8-fab2-4fcc-848c-983d6e2de04a'
   OR user_id = '2b87cfb8-fab2-4fcc-848c-983d6e2de04a')
  AND (id IS NULL OR user_id IS NULL OR id != user_id);

-- 3. Drop ALL existing RLS policies on profiles table
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Users view own profile" ON profiles;
DROP POLICY IF EXISTS "Users update own profile" ON profiles;
DROP POLICY IF EXISTS "Users insert own profile" ON profiles;
DROP POLICY IF EXISTS "Enable read access for users based on user_id" ON profiles;
DROP POLICY IF EXISTS "Enable insert for users based on user_id" ON profiles;
DROP POLICY IF EXISTS "Enable update for users based on user_id" ON profiles;
DROP POLICY IF EXISTS "Enable delete for users based on user_id" ON profiles;

-- 4. Create new comprehensive RLS policies that work with BOTH column strategies
CREATE POLICY "Users can select own profile"
ON profiles FOR SELECT
USING (
  auth.uid() = id
  OR auth.uid() = user_id
);

CREATE POLICY "Users can insert own profile"
ON profiles FOR INSERT
WITH CHECK (
  auth.uid() = id
  OR auth.uid() = user_id
);

CREATE POLICY "Users can update own profile"
ON profiles FOR UPDATE
USING (
  auth.uid() = id
  OR auth.uid() = user_id
)
WITH CHECK (
  auth.uid() = id
  OR auth.uid() = user_id
);

CREATE POLICY "Users can delete own profile"
ON profiles FOR DELETE
USING (
  auth.uid() = id
  OR auth.uid() = user_id
);

-- 5. Ensure RLS is enabled on the profiles table
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 6. Create the missing RPC function for seeding catalog
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

    -- Only seed if user has no catalog items
    IF EXISTS (SELECT 1 FROM catalog_items WHERE user_id = p_user_id LIMIT 1) THEN
        RAISE NOTICE 'User already has catalog items, skipping seed';
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
        (p_user_id, 'Mulch install', 'flat', 75, 75, 230, NOW())
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Lawn catalog seeded for user %', p_user_id;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.seed_default_lawn_catalog(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_default_lawn_catalog(uuid) TO anon;

-- 7. Verify the fix
SELECT 'After Fix - Profile State:' as status;
SELECT
  p.id,
  p.user_id,
  p.id = p.user_id as "columns_match",
  u.email,
  p.onboarded_at,
  p.is_demo,
  p.business_name
FROM profiles p
JOIN auth.users u ON (u.id = p.id OR u.id = p.user_id)
WHERE u.id = '2b87cfb8-fab2-4fcc-848c-983d6e2de04a'
   OR u.email LIKE '%grammer%';

-- 8. Show active RLS policies
SELECT 'Active RLS Policies:' as status;
SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  permissive
FROM pg_policies
WHERE tablename = 'profiles'
ORDER BY policyname;

COMMIT;

-- Test query that RequireOnboarded will run
SELECT 'Test query (what RequireOnboarded sees):' as status;
SELECT onboarded_at
FROM profiles
WHERE id = '2b87cfb8-fab2-4fcc-848c-983d6e2de04a';

SELECT 'Fix complete! Sign out and sign back in.' as message;