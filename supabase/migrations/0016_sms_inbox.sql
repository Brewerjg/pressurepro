-- TurfPro — inbound SMS storage for the two-way customer comms inbox.
--
-- Background: send-customer-sms (0008_sms.sql) already records outbound
-- transactional SMS in public.sms_log. Customers REPLY to those messages
-- and today their replies vanish — Twilio receives them but nothing in the
-- app surfaces them. Operators end up taking phone calls of the form
-- "did you get my text?" because there's no inbox.
--
-- This migration:
--   1. Adds public.sms_inbound — one row per inbound message, written by
--      the twilio-inbound edge function (service role only, since Twilio
--      authenticates via X-Twilio-Signature, not a user JWT).
--   2. Adds public.sms_opt_outs — separate table (not a column on
--      customers) so we can record opt-outs from unknown phone numbers
--      too (i.e. inbound STOP from a sender we can't match to a customer).
--      Per-operator scoping mirrors the rest of the comms layer.
--
-- Threading: a "conversation" with a customer is built by UNIONing
-- public.sms_log (outbound) and public.sms_inbound (inbound), filtered
-- by customer_id, and ordered by:
--   - sms_log:     COALESCE(sent_at, created_at)   ASC
--   - sms_inbound: received_at                     ASC
-- The Inbox UI handles this client-side (two queries, merge in memory).
-- Doing the UNION here as a view is tempting but the column shapes
-- diverge enough that the cast cost outweighs the convenience.
--
-- Unknown senders (inbound rows with customer_id IS NULL) are grouped
-- under a single "Unknown senders" pseudo-thread in the UI.
--
-- All changes are additive. Idempotent — safe to re-run.

BEGIN;

-- =====================================================================
-- 1. sms_inbound — audit + display source for inbound customer SMS
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.sms_inbound (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Nullable: an inbound from a phone we can't match to a customers row
  -- (wrong number, ex-customer deleted, etc.) still gets recorded.
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  from_phone TEXT NOT NULL,
  to_phone TEXT NOT NULL,
  body TEXT NOT NULL,
  twilio_message_sid TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL = unread; non-NULL = the moment the operator opened the thread.
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Inbox list query: most-recent-activity-first, scoped to user.
CREATE INDEX IF NOT EXISTS idx_sms_inbound_user_received
  ON public.sms_inbound(user_id, received_at DESC);

-- Thread view query: all messages for a single customer.
CREATE INDEX IF NOT EXISTS idx_sms_inbound_customer
  ON public.sms_inbound(customer_id);

-- Unread badge query — partial index keeps it tiny because the long-term
-- distribution is mostly read rows.
CREATE INDEX IF NOT EXISTS idx_sms_inbound_unread
  ON public.sms_inbound(user_id) WHERE read_at IS NULL;

ALTER TABLE public.sms_inbound ENABLE ROW LEVEL SECURITY;

-- View: operator sees their own inbound, admins see everything (mirrors
-- sms_log policy from 0008_sms.sql).
DROP POLICY IF EXISTS "Users view own inbound" ON public.sms_inbound;
CREATE POLICY "Users view own inbound"
  ON public.sms_inbound
  FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Update: only to flip read_at. No general column writes from clients.
DROP POLICY IF EXISTS "Users update own inbound" ON public.sms_inbound;
CREATE POLICY "Users update own inbound"
  ON public.sms_inbound
  FOR UPDATE
  USING (auth.uid() = user_id);

-- INSERT is intentionally service-role only — Twilio's webhook is not an
-- authenticated user request. The twilio-inbound edge function uses the
-- service-role key which bypasses RLS, so no INSERT policy is defined.

-- =====================================================================
-- 2. sms_opt_outs — STOP / UNSUBSCRIBE handling
-- =====================================================================
-- Why a separate table (not a column on customers):
--   * STOP can arrive from a phone that DOESN'T match any customer row
--     (wrong-number reply, ex-customer who's already been deleted, an
--     unknown opt-out we want to honor anyway). A column on customers
--     can't represent that.
--   * Per-operator scoping: the same physical phone number could in
--     theory hit two different operators' Twilio numbers; each operator
--     gets their own opt-out record.
--   * It's a simple key-value log — we never need to "un-opt-out" by
--     editing a customer record; the operator can delete the row.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.sms_opt_outs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- E.164-normalized phone of the customer who opted out.
  phone TEXT NOT NULL,
  -- The exact keyword they sent (STOP, STOPALL, UNSUBSCRIBE, etc.) so we
  -- can audit what triggered the opt-out.
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_sms_opt_outs_user_phone
  ON public.sms_opt_outs(user_id, phone);

ALTER TABLE public.sms_opt_outs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own opt outs" ON public.sms_opt_outs;
CREATE POLICY "Users view own opt outs"
  ON public.sms_opt_outs
  FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users delete own opt outs" ON public.sms_opt_outs;
CREATE POLICY "Users delete own opt outs"
  ON public.sms_opt_outs
  FOR DELETE
  USING (auth.uid() = user_id);

-- INSERT is service-role only (twilio-inbound writes through service role).

COMMIT;
