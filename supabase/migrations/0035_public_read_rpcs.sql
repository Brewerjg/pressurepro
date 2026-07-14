-- 0035: SECURITY HOTFIX (step 2 of 2) — remove anonymous ENUMERATION of
-- quotes / quote_views / short_links via the public anon key.
--
-- After 0034, authenticated operators are scoped to their own quotes, but the
-- "Public can read quotes by id" policy is still qual=true for `anon`, so
-- anyone with the public anon key (shipped in the browser bundle) can
-- `select * from quotes` and read EVERY operator's customer PII. RLS cannot
-- express "readable only when filtered by id" (it is per-row, not per-query),
-- so the fix is to remove the blanket policy and serve the one legitimate
-- unauthenticated read — the customer accept/print page fetching ONE quote by
-- its UUID — through a SECURITY DEFINER function that hard-limits to that id.
--
-- Same pattern for short_links (public /s/:code redirect) and quote_views
-- (drop the blanket read; operators read their own via an owner policy).
--
-- Idempotent. Apply with
--   supabase db query -f supabase/migrations/0035_public_read_rpcs.sql --linked
-- Mirror this FILE to Brewerjg/pressurepro (shared DB — applies once).

-- ── quotes: by-id reader, then drop the blanket policy ──────────────────────
CREATE OR REPLACE FUNCTION public.public_quote_by_id(p_id uuid)
RETURNS SETOF public.quotes
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.quotes WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION public.public_quote_by_id(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.public_quote_by_id(uuid) TO anon, authenticated;

DROP POLICY IF EXISTS "Public can read quotes by id" ON public.quotes;

-- ── short_links: code resolver, then drop the blanket policy ────────────────
CREATE OR REPLACE FUNCTION public.resolve_short_link(p_code text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT target_url FROM public.short_links WHERE code = p_code;
$$;

REVOKE ALL ON FUNCTION public.resolve_short_link(text) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_short_link(text) TO anon, authenticated;

DROP POLICY IF EXISTS "Public can read short links" ON public.short_links;

-- ── quote_views: drop blanket read; operators read their own ────────────────
DROP POLICY IF EXISTS "Anyone can read quote views" ON public.quote_views;

DROP POLICY IF EXISTS "Owners read their quote views" ON public.quote_views;
CREATE POLICY "Owners read their quote views" ON public.quote_views
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = quote_views.quote_id AND q.user_id = auth.uid()
  ));
