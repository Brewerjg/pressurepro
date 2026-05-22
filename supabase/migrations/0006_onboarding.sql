-- TurfPro — first-run onboarding marker.
--
-- The wizard at /onboarding writes profiles.onboarded_at on completion (or on
-- "Skip for now") so RequireOnboarded knows not to re-prompt. NULL = the user
-- has never finished (or skipped) the wizard and should be sent there before
-- they see any gated app surface. The column is added if-missing so this
-- migration is safe to re-run.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;
