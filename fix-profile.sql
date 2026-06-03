-- Fix profile table structure and data for current user

BEGIN;

-- 1. First check the structure of the profiles table
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'profiles'
ORDER BY ordinal_position;

-- 2. Check if user_id column exists (TurfPro uses user_id, PressurePro might use id)
DO $$
BEGIN
    -- If the table uses 'id' as primary key instead of 'user_id', we need to update our queries
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'user_id') THEN
        -- Check if we have 'id' column that references auth.users
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'id') THEN
            RAISE NOTICE 'Profiles table uses id column as primary key';
        END IF;
    END IF;
END $$;

-- 3. Ensure profile exists for current user and is not demo
-- First try with 'id' column (PressurePro style)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'id') THEN
        -- Check if profile exists
        IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()) THEN
            -- Insert new profile
            INSERT INTO profiles (id, created_at)
            VALUES (auth.uid(), now());
            RAISE NOTICE 'Created new profile for user';
        END IF;

        -- Update the profile to ensure proper state
        UPDATE profiles
        SET
            onboarded_at = NULL,  -- Reset to trigger onboarding
            is_demo = false       -- Ensure not demo
        WHERE id = auth.uid();

        RAISE NOTICE 'Updated profile with id column';
    END IF;
END $$;

-- 4. Try with 'user_id' column (TurfPro style)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'user_id') THEN
        -- Check if profile exists
        IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid()) THEN
            -- Insert new profile
            INSERT INTO profiles (user_id, created_at)
            VALUES (auth.uid(), now());
            RAISE NOTICE 'Created new profile for user';
        END IF;

        -- Update the profile to ensure proper state
        UPDATE profiles
        SET
            onboarded_at = NULL,  -- Reset to trigger onboarding
            is_demo = false       -- Ensure not demo
        WHERE user_id = auth.uid();

        RAISE NOTICE 'Updated profile with user_id column';
    END IF;
END $$;

-- 5. Add is_demo column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'is_demo') THEN
        ALTER TABLE profiles ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT false;
        RAISE NOTICE 'Added is_demo column';
    END IF;
END $$;

-- 6. Show current profile status
SELECT
    CASE
        WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'id')
        THEN (SELECT row_to_json(p) FROM profiles p WHERE p.id = auth.uid())
        ELSE (SELECT row_to_json(p) FROM profiles p WHERE p.user_id = auth.uid())
    END as current_profile;

COMMIT;

SELECT 'Profile fixed! You should now be able to complete onboarding.' as status;