-- ============================================================
-- Latest-value RPCs — move "latest price/stock per competitor_product"
-- OUT of the browser and INTO Postgres.
--
-- Before: the Comparison page paged the ENTIRE 60-day price_history
-- (up to 50k rows) + stock_history (another 50k) to the client on every
-- load and deduped in JS. The Dashboard sent a 1500-UUID `.in()` filter
-- (multi-KB URL, 414 risk) and could still miss competitors.
--
-- After: two DISTINCT ON functions return exactly ONE row per
-- competitor_product — a few thousand rows, one round trip, served by the
-- existing (competitor_product_id, captured_at DESC) index. 10-100× less
-- data over the wire and constant regardless of how much history accrues.
--
-- SECURITY: SECURITY INVOKER (the default) — the caller's RLS on
-- price_history / stock_history still applies, exactly as when the client
-- queried those tables directly. No privilege escalation.
-- ============================================================

-- Matching index for the stock dedup (price side already exists in phase1-perf).
CREATE INDEX IF NOT EXISTS idx_stock_history_cp_captured
  ON public.stock_history(competitor_product_id, captured_at DESC);

-- ── Latest price per competitor_product ─────────────────────
-- Returns the latest NON-suspect price per cp, plus is_suspect = whether the
-- single most-recent reading (suspect or not) was flagged — so the UI can show
-- the ⚠ marker without downloading history.
CREATE OR REPLACE FUNCTION public.get_latest_prices(days integer DEFAULT 60)
RETURNS TABLE (
  competitor_product_id bigint,
  price                 numeric,
  currency_code         text,
  captured_at           timestamptz,
  is_suspect            boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH win AS (
    SELECT competitor_product_id, price, currency_code, captured_at,
           COALESCE(is_suspect, false) AS is_suspect
    FROM public.price_history
    WHERE captured_at >= now() - make_interval(days => days)
  ),
  good AS (   -- latest reading that was NOT flagged suspect
    SELECT DISTINCT ON (competitor_product_id)
           competitor_product_id, price, currency_code, captured_at
    FROM win
    WHERE is_suspect = false
    ORDER BY competitor_product_id, captured_at DESC
  ),
  newest AS ( -- was the single most-recent reading flagged?
    SELECT DISTINCT ON (competitor_product_id)
           competitor_product_id, is_suspect
    FROM win
    ORDER BY competitor_product_id, captured_at DESC
  )
  SELECT g.competitor_product_id, g.price, g.currency_code, g.captured_at,
         COALESCE(n.is_suspect, false)
  FROM good g
  LEFT JOIN newest n USING (competitor_product_id);
$$;

-- ── Latest stock status per competitor_product ──────────────
CREATE OR REPLACE FUNCTION public.get_latest_stock(days integer DEFAULT 60)
RETURNS TABLE (
  competitor_product_id bigint,
  in_stock              boolean,
  captured_at           timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT ON (competitor_product_id)
         competitor_product_id, in_stock, captured_at
  FROM public.stock_history
  WHERE captured_at >= now() - make_interval(days => days)
  ORDER BY competitor_product_id, captured_at DESC;
$$;

-- Expose to the same roles that already read the tables directly.
GRANT EXECUTE ON FUNCTION public.get_latest_prices(integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_latest_stock(integer)  TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
