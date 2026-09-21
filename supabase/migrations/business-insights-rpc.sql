-- ============================================================
-- get_business_insights() — one call that returns EVERYTHING the Business
-- Insights page needs, computed in Postgres.
--
-- KEY PERF DECISION: the "current price per competitor_product" is now stored
-- ON competitor_products (last_price), maintained by the worker each scrape,
-- so this function NEVER scans the large/growing price_history table for latest
-- state. It reads ~1500 small cp rows instead. Only the 7-day "moves" feed
-- still touches price_history (bounded window + captured_at index).
--
-- Returns jsonb { products: [...], drivers: [...] }. Suggestion math stays in
-- the client (computeSuggestion). SECURITY INVOKER — caller's RLS applies.
-- ============================================================

-- 1. Materialized "current price" columns on competitor_products.
ALTER TABLE public.competitor_products
  ADD COLUMN IF NOT EXISTS last_price    numeric,
  ADD COLUMN IF NOT EXISTS last_price_at timestamptz;

-- 2. One-time backfill: latest non-suspect price per cp. DISTINCT ON uses the
--    (competitor_product_id, captured_at) index, so this is fast even on a big
--    history. (Re-runnable; the WHERE skips no-op writes.)
UPDATE public.competitor_products cp
SET last_price = lp.price, last_price_at = lp.captured_at
FROM (
  SELECT DISTINCT ON (competitor_product_id) competitor_product_id, price, captured_at
  FROM public.price_history
  WHERE COALESCE(is_suspect, false) = false
  ORDER BY competitor_product_id, captured_at DESC
) lp
WHERE cp.id = lp.competitor_product_id
  AND cp.last_price IS DISTINCT FROM lp.price;

-- 3. captured_at index for the 7-day moves scan (date-only range the composite
--    (cp, captured_at) index can't serve).
CREATE INDEX IF NOT EXISTS idx_price_history_captured
  ON public.price_history(captured_at DESC);

-- 4. The function — reads last_price directly, no latest-price history scan.
CREATE OR REPLACE FUNCTION public.get_business_insights()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH links AS (   -- active linked cps + their MATERIALIZED latest price
  SELECT cp.id AS cp_id, cp.product_id, cp.competitor_id, cp.last_price AS price
  FROM public.competitor_products cp
  WHERE cp.is_active AND cp.product_id IS NOT NULL
),
agg AS (          -- per product: cheapest/avg rival + cheapest competitor
  SELECT p.id, p.name, p.sku,
    p.current_price::numeric AS your_price,
    p.cost_price::numeric    AS cost,
    p.target_margin::numeric AS margin,
    p.min_price::numeric     AS min_price,
    MIN(lk.price)   AS min_rival,
    AVG(lk.price)   AS avg_rival,
    COUNT(lk.price) AS rival_count,
    (ARRAY_AGG(lk.competitor_id ORDER BY lk.price ASC NULLS LAST)
       FILTER (WHERE lk.price IS NOT NULL))[1] AS cheapest_id
  FROM public.products p
  JOIN links lk ON lk.product_id = p.id
  GROUP BY p.id
  HAVING COUNT(lk.price) > 0
),
intel AS (        -- + market position bucket (mirrors the client logic)
  SELECT a.*, c.name AS cheapest_name,
    CASE
      WHEN a.your_price IS NULL THEN NULL
      WHEN (a.your_price - a.min_rival) / a.min_rival <= -0.001 THEN 'cheapest'
      WHEN (a.your_price - a.min_rival) / a.min_rival >  0.01  THEN 'above'
      WHEN abs((a.your_price - a.min_rival) / a.min_rival) <= 0.01 THEN 'match'
      WHEN a.avg_rival > 0 AND (a.your_price - a.avg_rival) / a.avg_rival < -0.01 THEN 'below'
      ELSE 'match'
    END AS position
  FROM agg a
  LEFT JOIN public.competitors c ON c.id = a.cheapest_id
),
mv AS (           -- last two readings per cp in the past 7 days
  SELECT competitor_product_id,
    (ARRAY_AGG(price ORDER BY captured_at DESC))[1] AS latest_p,
    (ARRAY_AGG(price ORDER BY captured_at DESC))[2] AS prior_p
  FROM public.price_history
  WHERE captured_at >= now() - interval '7 days'
  GROUP BY competitor_product_id
  HAVING COUNT(*) >= 2
),
moves AS (
  SELECT cp.competitor_id, COUNT(*) AS moves7d
  FROM mv JOIN public.competitor_products cp ON cp.id = mv.competitor_product_id
  WHERE mv.latest_p IS DISTINCT FROM mv.prior_p
  GROUP BY cp.competitor_id
),
wins AS (
  SELECT cheapest_id AS competitor_id, COUNT(*) AS wins
  FROM intel WHERE cheapest_id IS NOT NULL GROUP BY cheapest_id
),
cov AS (
  SELECT competitor_id, COUNT(*) AS coverage FROM links GROUP BY competitor_id
)
SELECT jsonb_build_object(
  'products', (
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
      SELECT id, name, sku, your_price, min_rival, avg_rival, rival_count,
             cheapest_id, cheapest_name, position, cost, margin, min_price
      FROM intel WHERE position IS NOT NULL
    ) t
  ),
  'drivers', (
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
      SELECT c.id, c.name, c.domain, c.logo_url,
        COALESCE(w.wins, 0)      AS wins,
        COALESCE(m.moves7d, 0)   AS moves7d,
        COALESCE(cv.coverage, 0) AS coverage
      FROM public.competitors c
      LEFT JOIN wins  w  ON w.competitor_id  = c.id
      LEFT JOIN moves m  ON m.competitor_id  = c.id
      LEFT JOIN cov   cv ON cv.competitor_id = c.id
      WHERE c.is_active AND (COALESCE(w.wins, 0) > 0 OR COALESCE(m.moves7d, 0) > 0)
      ORDER BY (COALESCE(w.wins, 0) * 2 + COALESCE(m.moves7d, 0)) DESC
      LIMIT 5
    ) t
  )
);
$$;

GRANT EXECUTE ON FUNCTION public.get_business_insights() TO anon, authenticated;
ALTER FUNCTION public.get_business_insights() SET statement_timeout = '25s';

NOTIFY pgrst, 'reload schema';
