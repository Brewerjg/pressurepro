-- Check profiles table structure
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'profiles'
ORDER BY ordinal_position;

-- Check if is_demo column exists
SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'profiles'
    AND column_name = 'is_demo'
) as has_is_demo_column;

-- Show sample profiles data (limit 5)
SELECT id, created_at, is_demo
FROM profiles
LIMIT 5;