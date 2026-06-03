-- ULTIMATE FIX FOR PRESSUREPRO USER ONBOARDING ISSUE
-- This comprehensive script ensures PressurePro users can properly use TurfPro

BEGIN;

-- Step 1: Show the current state
SELECT 'BEFORE FIX:' as status;
SELECT
  p.id,
  p.user_id,
  u.email,
  p.onboarded_at,
  p.is_demo,
  CASE
    WHEN p.id IS NOT NULL AND p.user_id IS NULL THEN 'TurfPro profile (id only)'
    WHEN p.id IS NULL AND p.user_id IS NOT NULL THEN 'PressurePro profile (user_id only)'
    WHEN p.id IS NOT NULL AND p.user_id IS NOT NULL THEN 'Both columns set'
    ELSE 'Unknown'
  END as profile_type
FROM auth.users u
LEFT JOIN profiles p ON (u.id = p.id OR u.id = p.user_id)
WHERE u.email LIKE '%grammer%';

-- Step 2: Fix all PressurePro profiles (those with user_id but no id)
UPDATE profiles
SET
  id = user_id,  -- Add the id column for TurfPro compatibility
  onboarded_at = COALESCE(onboarded_at, NOW()),
  is_demo = false
WHERE
  user_id IS NOT NULL
  AND id IS NULL;

-- Step 3: Fix any profiles that have id but missing critical fields
UPDATE profiles
SET
  user_id = COALESCE(user_id, id),  -- Ensure both columns are set
  onboarded_at = COALESCE(onboarded_at, NOW()),
  is_demo = false
WHERE
  id IS NOT NULL
  AND (user_id IS NULL OR onboarded_at IS NULL OR is_demo IS NULL OR is_demo = true);

-- Step 4: Specifically fix the grammer user
UPDATE profiles
SET
  id = COALESCE(id, user_id, (SELECT id FROM auth.users WHERE email LIKE '%grammer%' LIMIT 1)),
  user_id = COALESCE(user_id, id, (SELECT id FROM auth.users WHERE email LIKE '%grammer%' LIMIT 1)),
  onboarded_at = COALESCE(onboarded_at, NOW()),
  is_demo = false
WHERE
  (id IN (SELECT id FROM auth.users WHERE email LIKE '%grammer%')
   OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%grammer%'));

-- Step 5: Ensure no profiles have is_demo = true
UPDATE profiles
SET is_demo = false
WHERE is_demo = true;

-- Step 6: Create missing profiles for any auth users without profiles
INSERT INTO profiles (id, user_id, onboarded_at, is_demo, created_at)
SELECT
  u.id,
  u.id,
  NOW(),
  false,
  NOW()
FROM auth.users u
LEFT JOIN profiles p ON (u.id = p.id OR u.id = p.user_id)
WHERE p.id IS NULL AND p.user_id IS NULL
ON CONFLICT DO NOTHING;

-- Step 7: Show the fixed state
SELECT 'AFTER FIX:' as status;
SELECT
  p.id,
  p.user_id,
  u.email,
  p.onboarded_at,
  p.is_demo,
  CASE
    WHEN p.id = p.user_id THEN 'Both columns match (GOOD)'
    WHEN p.id IS NOT NULL AND p.user_id IS NOT NULL THEN 'Both columns set'
    WHEN p.id IS NOT NULL THEN 'Only id set'
    WHEN p.user_id IS NOT NULL THEN 'Only user_id set'
    ELSE 'No profile'
  END as profile_type
FROM auth.users u
LEFT JOIN profiles p ON (u.id = p.id OR u.id = p.user_id)
WHERE u.email LIKE '%grammer%';

-- Step 8: Verify RLS policies exist
SELECT 'RLS Policies:' as status;
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'profiles';

COMMIT;

-- Final message
SELECT 'Fix complete! Sign out and sign back in. You should NOT see onboarding again.' as message;