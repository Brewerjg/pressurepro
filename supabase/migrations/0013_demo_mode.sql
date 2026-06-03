-- Add demo mode flag to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

-- Add comment for clarity
COMMENT ON COLUMN public.profiles.is_demo IS 'Flag to indicate if this is a demo account for testing purposes';