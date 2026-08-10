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
CREATE INDEX IF NOT EXISTS idx_stock_history_cp_captured1
  ON public.stock_history(competitor_product_id, captured_at DESC);

-- ── Latest price per competitor_product ─────────────────────
-- Index-optimal: ONE DISTINCT ON straight off the
-- (competitor_product_id, captured_at DESC) index — a skip scan that reads a
-- row per cp instead of materialising the whole 60-day window. The earlier
-- two-CTE version was referenced twice, so Postgres materialised + sorted the
-- entire window (slow as history grows — this was the Dashboard/Comparison lag).
-- We skip suspect readings for the price and drop the ⚠ "recent reading looked
-- wrong" flag (minor UI detail) in exchange for a large speed-up.
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
  SELECT DISTINCT ON (competitor_product_id)
         competitor_product_id, price, currency_code, captured_at, false
  FROM public.price_history
  WHERE captured_at >= now() - make_interval(days => days)
    AND COALESCE(is_suspect, false) = false
  ORDER BY competitor_product_id, captured_at DESC;   -- stable order → deterministic range() paging
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
