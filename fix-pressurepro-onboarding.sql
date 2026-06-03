-- CRITICAL FIX: Enable PressurePro users to complete TurfPro onboarding
-- Run this in your Supabase SQL Editor

BEGIN;

-- 1. Ensure all PressurePro users (with user_id column) are marked as NOT demo
UPDATE profiles
SET
  is_demo = false,
  onboarded_at = COALESCE(onboarded_at, NOW())  -- Mark as onboarded if not already
WHERE
  user_id IS NOT NULL
  AND (is_demo IS NULL OR is_demo = true OR onboarded_at IS NULL);

-- 2. Fix any profiles that have id column but missing is_demo
UPDATE profiles
SET
  is_demo = false
WHERE
  id IS NOT NULL
  AND (is_demo IS NULL OR is_demo = true);

-- 3. Specifically fix the grammer user
UPDATE profiles
SET
  is_demo = false,
  onboarded_at = COALESCE(onboarded_at, NOW())
WHERE
  (id IN (SELECT id FROM auth.users WHERE email LIKE '%grammer%')
   OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%grammer%'));

-- 4. Verify the fix
SELECT
  COALESCE(p.id, p.user_id)::text as profile_id,
  u.email,
  p.is_demo,
  p.onboarded_at,
  p.business_name,
  CASE
    WHEN p.id IS NOT NULL AND p.user_id IS NOT NULL THEN 'Both columns'
    WHEN p.id IS NOT NULL THEN 'TurfPro (id)'
    WHEN p.user_id IS NOT NULL THEN 'PressurePro (user_id)'
  END as profile_type
FROM profiles p
LEFT JOIN auth.users u ON (u.id = p.id OR u.id = p.user_id)
WHERE u.email LIKE '%grammer%'
   OR u.email IS NOT NULL
ORDER BY u.email;

COMMIT;

-- If you still see issues after running this, check RLS policies:
SELECT * FROM pg_policies WHERE tablename = 'profiles';