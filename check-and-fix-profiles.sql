-- Check and fix the profiles table structure issue

-- 1. First, let's see the actual structure
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'profiles'
ORDER BY ordinal_position;

-- 2. Check if there's a profile for the current user
SELECT * FROM profiles WHERE id = auth.uid();

-- 3. If PressurePro uses 'id' as primary key but TurfPro expects 'user_id',
-- we need to ensure the profile is properly set up
-- Let's update the profile to work with TurfPro's expectations
UPDATE profiles
SET
    onboarded_at = NULL,  -- Force re-onboarding
    is_demo = false       -- Ensure not marked as demo
WHERE id = auth.uid();

-- 4. Show the updated profile
SELECT * FROM profiles WHERE id = auth.uid();