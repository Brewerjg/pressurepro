-- Fix demo flag for existing users

-- 1. Check all profiles and their demo status
SELECT
    auth.users.id as user_id,
    auth.users.email,
    profiles.is_demo,
    profiles.onboarded_at,
    profiles.created_at as profile_created,
    auth.users.created_at as user_created
FROM auth.users
LEFT JOIN profiles ON auth.users.id = profiles.id
ORDER BY auth.users.created_at DESC
LIMIT 10;

-- 2. Set all existing profiles to NOT demo
UPDATE profiles
SET is_demo = false
WHERE is_demo IS NULL OR is_demo = true;

-- 3. Check if using user_id column instead of id
SELECT
    column_name,
    data_type
FROM information_schema.columns
WHERE table_name = 'profiles'
AND column_name IN ('id', 'user_id')
ORDER BY column_name;

-- 4. Update profiles with user_id column if that's what's used
UPDATE profiles
SET is_demo = false
WHERE user_id IS NOT NULL
AND (is_demo IS NULL OR is_demo = true);

-- 5. Verify the update - show all profiles
SELECT
    COALESCE(id, user_id) as profile_id,
    is_demo,
    onboarded_at,
    business_name,
    created_at
FROM profiles
ORDER BY created_at DESC
LIMIT 20;

SELECT 'All profiles set to non-demo!' as status;