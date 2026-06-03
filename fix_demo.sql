-- Add is_demo column if it doesn't exist
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

-- Update all existing profiles to ensure is_demo is false
UPDATE public.profiles
SET is_demo = false
WHERE is_demo IS NULL OR is_demo = true;

-- Add comment for clarity
COMMENT ON COLUMN public.profiles.is_demo IS 'Flag to indicate if this is a demo account for testing purposes';

-- Verify the changes
SELECT id, is_demo FROM profiles LIMIT 5;