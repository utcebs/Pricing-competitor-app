-- ============================================================
-- get_daily_metrics(days) — one call powering the Dashboard's Price Position
-- Trend AND the KPI sparklines. Per day it reconstructs the whole position mix
-- + headline metrics from competitor price/stock history (carried forward
-- as-of each day) and the product's CURRENT price.
--
-- Same approximation as get_position_trend: today's own-price applied backward
-- (until own product URLs are linked). Exact going forward. SECURITY INVOKER.
--
-- Returns one row per day:
--   monitored   — products with >=1 rival price that day
--   competitors — distinct competitors with a price that day
--   cheapest/matchp/above/below — position-bucket counts
--   at_risk     — Σ(your − cheapest) over above-market products (KD)
--   avg_gap     — mean (your − cheapest)/cheapest % over positioned products
--   oos         — competitor listings out of stock that day
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_daily_metrics(days integer DEFAULT 14)
RETURNS TABLE (
  day         date,
  monitored   integer,
  competitors integer,
  cheapest    integer,
  matchp      integer,
  above       integer,
  below       integer,
  at_risk     numeric,
  avg_gap     numeric,
  oos         integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH d AS (
    SELECT generate_series(current_date - (days - 1), current_date, interval '1 day')::date AS day
  ),
  ph AS (
    SELECT h.competitor_product_id, cp.product_id, cp.competitor_id, h.price,
           h.captured_at::date AS cdate
    FROM public.price_history h
    JOIN public.competitor_products cp ON cp.id = h.competitor_product_id
    WHERE cp.is_active AND cp.product_id IS NOT NULL
      AND COALESCE(h.is_suspect, false) = false
      AND h.captured_at >= current_date - (days + 45)
  ),
  cp_day AS (   -- latest price per cp as-of each day
    SELECT DISTINCT ON (ph.competitor_product_id, d.day)
           d.day, ph.product_id, ph.competitor_id, ph.price
    FROM d JOIN ph ON ph.cdate <= d.day
    ORDER BY ph.competitor_product_id, d.day, ph.cdate DESC
  ),
  prod_day AS (
    SELECT day, product_id, MIN(price) AS min_rival, AVG(price) AS avg_rival
    FROM cp_day GROUP BY day, product_id
  ),
  comp_day AS (
    SELECT day, COUNT(DISTINCT competitor_id) AS competitors FROM cp_day GROUP BY day
  ),
  m AS (
    SELECT pd.day, p.current_price, pd.min_rival,
      CASE
        WHEN p.current_price IS NULL OR pd.min_rival IS NULL OR pd.min_rival <= 0 THEN NULL
        WHEN (p.current_price - pd.min_rival) / pd.min_rival <= -0.001 THEN 'cheapest'
        WHEN (p.current_price - pd.min_rival) / pd.min_rival >  0.01  THEN 'above'
        WHEN ABS((p.current_price - pd.min_rival) / pd.min_rival) <= 0.01 THEN 'match'
        WHEN pd.avg_rival > 0 AND (p.current_price - pd.avg_rival) / pd.avg_rival < -0.01 THEN 'below'
        ELSE 'match'
      END AS pos
    FROM prod_day pd
    JOIN public.products p ON p.id = pd.product_id
  ),
  mm AS (
    SELECT day,
      COUNT(*) FILTER (WHERE pos IS NOT NULL) AS monitored,
      COUNT(*) FILTER (WHERE pos = 'cheapest') AS cheapest,
      COUNT(*) FILTER (WHERE pos = 'match')    AS matchp,
      COUNT(*) FILTER (WHERE pos = 'above')    AS above,
      COUNT(*) FILTER (WHERE pos = 'below')    AS below,
      COALESCE(SUM(current_price - min_rival) FILTER (WHERE pos = 'above'), 0) AS at_risk,
      AVG((current_price - min_rival) / min_rival * 100) FILTER (WHERE pos IS NOT NULL) AS avg_gap
    FROM m GROUP BY day
  ),
  sh AS (
    SELECT s.competitor_product_id, s.in_stock, s.captured_at::date AS cdate
    FROM public.stock_history s
    JOIN public.competitor_products cp ON cp.id = s.competitor_product_id
    WHERE cp.is_active AND s.captured_at >= current_date - (days + 45)
  ),
  stock_day AS (
    SELECT DISTINCT ON (sh.competitor_product_id, d.day) d.day, sh.in_stock
    FROM d JOIN sh ON sh.cdate <= d.day
    ORDER BY sh.competitor_product_id, d.day, sh.cdate DESC
  ),
  oos_day AS (
    SELECT day, COUNT(*) FILTER (WHERE in_stock = false) AS oos FROM stock_day GROUP BY day
  )
  SELECT d.day,
    COALESCE(mm.monitored, 0)::int,
    COALESCE(cd.competitors, 0)::int,
    COALESCE(mm.cheapest, 0)::int,
    COALESCE(mm.matchp, 0)::int,
    COALESCE(mm.above, 0)::int,
    COALESCE(mm.below, 0)::int,
    ROUND(COALESCE(mm.at_risk, 0), 3)::numeric,
    ROUND(COALESCE(mm.avg_gap, 0), 2)::numeric,
    COALESCE(od.oos, 0)::int
  FROM d
  LEFT JOIN mm ON mm.day = d.day
  LEFT JOIN comp_day cd ON cd.day = d.day
  LEFT JOIN oos_day od ON od.day = d.day
  ORDER BY d.day;
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_metrics(integer) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
