-- ============================================================
-- get_position_trend(days) — powers the Dashboard "Price Position Trend".
--
-- For each of the last N days, reconstructs your market position mix
-- (cheapest / match / above / below) across all tracked products, using:
--   • competitor prices AS-OF that day (latest reading on or before the day,
--     carried forward — how a competitor's shelf price actually behaves), and
--   • your CURRENT price (products.current_price) — the manual price today.
--
-- This is an approximation of the PAST (it applies today's own-price backward),
-- which is the agreed behaviour until you link your own product URLs and we can
-- track your price history too. It is EXACT going forward as new scrapes land.
--
-- Position buckets mirror the client productIntel logic exactly:
--   cheapest = your price <= cheapest rival
--   above    = your price > cheapest rival by more than 1%
--   match    = within +/-1% of the cheapest rival
--   below    = cheaper than the AVERAGE rival by >1% (but not the cheapest)
--
-- SECURITY INVOKER — respects the caller's RLS, same as a direct read.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_position_trend(days integer DEFAULT 14)
RETURNS TABLE (
  day       date,
  cheapest  integer,
  matchp    integer,
  above     integer,
  below     integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH d AS (
    SELECT generate_series(current_date - (days - 1), current_date, interval '1 day')::date AS day
  ),
  ph AS (   -- linked, active competitor prices within a bounded window
    SELECT h.competitor_product_id, cp.product_id, h.price,
           h.captured_at::date AS cdate
    FROM public.price_history h
    JOIN public.competitor_products cp ON cp.id = h.competitor_product_id
    WHERE cp.is_active AND cp.product_id IS NOT NULL
      AND COALESCE(h.is_suspect, false) = false
      AND h.captured_at >= current_date - (days + 45)
  ),
  cp_day AS (   -- latest price per competitor_product AS-OF each day (carry forward)
    SELECT DISTINCT ON (ph.competitor_product_id, d.day)
           d.day, ph.product_id, ph.price
    FROM d
    JOIN ph ON ph.cdate <= d.day
    ORDER BY ph.competitor_product_id, d.day, ph.cdate DESC
  ),
  prod_day AS (   -- per product per day: cheapest + average rival
    SELECT day, product_id, MIN(price) AS min_rival, AVG(price) AS avg_rival
    FROM cp_day
    GROUP BY day, product_id
  ),
  bucket AS (
    SELECT pd.day,
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
  )
  SELECT day,
         COUNT(*) FILTER (WHERE pos = 'cheapest')::int,
         COUNT(*) FILTER (WHERE pos = 'match')::int,
         COUNT(*) FILTER (WHERE pos = 'above')::int,
         COUNT(*) FILTER (WHERE pos = 'below')::int
  FROM bucket
  WHERE pos IS NOT NULL
  GROUP BY day
  ORDER BY day;
$$;

GRANT EXECUTE ON FUNCTION public.get_position_trend(integer) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
