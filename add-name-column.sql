-- Add name column to profiles table for personalized greetings
BEGIN;

-- 1. Add the name column if it doesn't exist
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS name TEXT;

-- 2. Update the upsertProfile function type in the Onboarding component needs this column
COMMENT ON COLUMN profiles.name IS 'User''s personal name for greetings (e.g., "John Smith")';

-- 3. For existing users, try to extract a name from their email as a default
-- This is optional - you can skip this if you want users to set it themselves
UPDATE profiles
SET name = SPLIT_PART(SPLIT_PART(auth.users.email, '@', 1), '.', 1)
FROM auth.users
WHERE (profiles.id = auth.users.id OR profiles.user_id = auth.users.id)
  AND profiles.name IS NULL
  AND auth.users.email IS NOT NULL;

-- 4. Capitalize the first letter of extracted names (optional)
UPDATE profiles
SET name = CONCAT(UPPER(SUBSTRING(name FROM 1 FOR 1)), LOWER(SUBSTRING(name FROM 2)))
WHERE name IS NOT NULL AND name != '';

-- 5. Verify the column was added
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'profiles'
  AND column_name = 'name';

-- 6. Show some sample data
SELECT
  COALESCE(p.id, p.user_id)::text as profile_id,
  u.email,
  p.name,
  p.business_name,
  p.is_demo,
  p.onboarded_at
FROM profiles p
LEFT JOIN auth.users u ON (u.id = p.id OR u.id = p.user_id)
LIMIT 10;

COMMIT;

SELECT 'Name column added successfully! Users can now have personalized greetings.' as message;