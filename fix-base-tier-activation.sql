-- Fix Base tier activation by adding RLS policies for subscriptions table
-- This allows users to insert and update their own subscription records
-- specifically for Base (PAYG) tier activation

BEGIN;

-- Policy to allow users to insert their own subscription
CREATE POLICY "Users can insert own subscription"
  ON public.subscriptions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy to allow users to update their own subscription
CREATE POLICY "Users can update own subscription"
  ON public.subscriptions
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMIT;