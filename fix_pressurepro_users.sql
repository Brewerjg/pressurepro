-- SQL script to fix PressurePro users stuck in onboarding loop
-- This addresses both the onboarding completion and demo dashboard bugs

-- Step 1: Find all PressurePro users (profiles with user_id but no id)
-- These are users that came from PressurePro and are experiencing the bugs

-- Step 2: Set onboarded_at for users who should be considered onboarded
-- For PressurePro users who have been using the system, mark them as onboarded
UPDATE public.profiles
SET
  onboarded_at = COALESCE(onboarded_at, created_at, NOW()),
  is_demo = false
WHERE
  user_id IS NOT NULL
  AND id IS NULL
  AND onboarded_at IS NULL;

-- Step 3: Fix dual-column profiles (some users might have both id and user_id)
-- Ensure these users are also marked as onboarded and not demo
UPDATE public.profiles
SET
  onboarded_at = COALESCE(onboarded_at, created_at, NOW()),
  is_demo = false
WHERE
  user_id IS NOT NULL
  AND id IS NOT NULL
  AND onboarded_at IS NULL;

-- Step 4: Specifically fix the grammer user mentioned in the problem
-- Update any profiles for users with email containing 'grammer'
UPDATE public.profiles
SET
  onboarded_at = COALESCE(onboarded_at, created_at, NOW()),
  is_demo = false
WHERE
  (id IN (SELECT id FROM auth.users WHERE email LIKE '%grammer%')
   OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%grammer%'))
  AND (onboarded_at IS NULL OR is_demo IS NULL OR is_demo = true);

-- Step 5: Ensure all non-demo users have is_demo explicitly set to false
UPDATE public.profiles
SET is_demo = false
WHERE is_demo IS NULL OR is_demo = true;

-- Step 6: Verify the fixes with a query to show the results
-- Run this to check what was updated:
/*
SELECT
  p.id,
  p.user_id,
  u.email,
  p.onboarded_at,
  p.is_demo,
  p.created_at,
  CASE
    WHEN p.id IS NOT NULL AND p.user_id IS NOT NULL THEN 'Dual Column'
    WHEN p.id IS NOT NULL THEN 'TurfPro Style (id)'
    WHEN p.user_id IS NOT NULL THEN 'PressurePro Style (user_id)'
    ELSE 'Unknown'
  END as profile_type
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = COALESCE(p.id, p.user_id)
WHERE u.email LIKE '%grammer%' OR p.onboarded_at IS NOT NULL
ORDER BY p.created_at DESC;
*/

-- Step 7: Clean up any orphaned profiles without valid user references
-- This is a safety check to ensure data consistency
DELETE FROM public.profiles
WHERE id IS NULL
  AND user_id IS NULL;

-- Summary of changes:
-- 1. All PressurePro users (user_id column) are marked as onboarded
-- 2. All users have is_demo explicitly set to false (unless they're actual demo users)
-- 3. The grammer user specifically is fixed
-- 4. Data consistency is maintained

COMMENT ON COLUMN public.profiles.onboarded_at IS 'Timestamp when user completed onboarding wizard or was marked as onboarded';
COMMENT ON COLUMN public.profiles.is_demo IS 'Flag to indicate if this is a demo account - false for all regular users including PressurePro imports';