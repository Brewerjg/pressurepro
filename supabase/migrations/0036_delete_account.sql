-- 0036_delete_account.sql
--
-- Atomic per-user data wipe backing the delete-account edge function (Google
-- Play account-deletion requirement). One SECURITY DEFINER function deletes
-- every row the operator owns, in one transaction, and returns per-table
-- delete counts for the function's audit log.
--
-- Why a DB function instead of table-by-table deletes from the edge function:
--   * NOTHING in this schema cascades from auth.users or profiles (verified
--     live 2026-09-18: zero FKs reference either), so deletion must name every
--     table explicitly — and a partial failure mid-sweep would strand a
--     half-deleted account. A single function body is transactional.
--   * quote_views has no user_id AND no FK to quotes, so it can only be
--     cleaned via a subquery against the user's quotes — awkward over
--     PostgREST, trivial here.
--
-- Storage is NOT handled here: deleting storage.objects rows would orphan the
-- underlying S3 files. The edge function empties job-photos/{user_id}/** via
-- the Storage API before calling this.
--
-- SECURITY: definer function in an exposed schema. Postgres grants EXECUTE to
-- PUBLIC by default on new functions — revoke it and grant service_role only.
-- The edge function (service role) is the sole caller; a client can never
-- reach this even though it lives in `public`.

CREATE OR REPLACE FUNCTION public.delete_user_data(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  counts jsonb := '{}'::jsonb;
  n bigint;
BEGIN
  -- quote_views: no user_id, no FK — must go before the user's quotes.
  DELETE FROM public.quote_views
   WHERE quote_id IN (SELECT id FROM public.quotes WHERE user_id = p_user_id);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('quote_views', n);

  -- Leaf/child tables first so parent deletes don't spend time on SET NULLs.
  -- (quote_acceptances / quote_reviews cascade from quotes.)
  DELETE FROM public.application_fees      WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('application_fees', n);
  DELETE FROM public.chemical_applications WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('chemical_applications', n);
  DELETE FROM public.email_log             WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('email_log', n);
  DELETE FROM public.sms_log               WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('sms_log', n);
  DELETE FROM public.sms_inbound           WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('sms_inbound', n);
  DELETE FROM public.sms_opt_outs          WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('sms_opt_outs', n);
  DELETE FROM public.manual_payments       WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('manual_payments', n);
  DELETE FROM public.photo_pairs           WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('photo_pairs', n);
  DELETE FROM public.route_stops           WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('route_stops', n);
  DELETE FROM public.routes                WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('routes', n);

  -- Documents. invoices before quotes (quotes.invoice_id SET NULLs away);
  -- quotes cascade-delete quote_acceptances + quote_reviews.
  DELETE FROM public.invoices              WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('invoices', n);
  DELETE FROM public.quotes                WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('quotes', n);
  DELETE FROM public.maintenance_plans     WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('maintenance_plans', n);
  DELETE FROM public.properties            WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('properties', n);
  DELETE FROM public.customers             WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('customers', n);
  DELETE FROM public.crews                 WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('crews', n);

  -- Everything else keyed directly on user_id.
  DELETE FROM public.campaigns             WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('campaigns', n);
  DELETE FROM public.catalog_items         WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('catalog_items', n);
  DELETE FROM public.invoice_counters      WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('invoice_counters', n);
  DELETE FROM public.push_tokens           WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('push_tokens', n);
  DELETE FROM public.quickbooks_connections WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('quickbooks_connections', n);
  DELETE FROM public.quickbooks_oauth_states WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('quickbooks_oauth_states', n);
  DELETE FROM public.short_links           WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('short_links', n);
  DELETE FROM public.subscriptions         WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('subscriptions', n);
  DELETE FROM public.surface_pricing       WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('surface_pricing', n);
  DELETE FROM public.user_roles            WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('user_roles', n);
  DELETE FROM public.user_settings         WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('user_settings', n);
  DELETE FROM public.user_storage_usage    WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('user_storage_usage', n);

  -- Profile last. PressurePro-shaped rows have id <> user_id, so key on
  -- user_id (the auth uid) — same lesson as the connect-onboarding persist bug.
  DELETE FROM public.profiles              WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('profiles', n);

  RETURN counts;
END;
$$;

-- Definer functions in `public` are callable by PUBLIC unless revoked.
REVOKE EXECUTE ON FUNCTION public.delete_user_data(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_user_data(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_user_data(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_data(uuid) TO service_role;
