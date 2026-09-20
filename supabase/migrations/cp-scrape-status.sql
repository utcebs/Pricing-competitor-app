-- ============================================================
-- competitor_products.scrape_status — the DEFINITIVE outcome of the last
-- scrape, written by the worker, so the UI stops GUESSING a product's state
-- from indirect signals (price row + stock row + last_seen_at). That guessing
-- is what made valid out-of-stock / discontinued items read as "invalid link".
--
-- Values written by the worker:
--   'priced'        — a current price was found
--   'out_of_stock'  — valid product page, no price (in-stock flag false)
--   'discontinued'  — valid product, explicitly discontinued by the retailer
--   'not_found'     — the URL is dead / no product on the page (truly invalid)
-- NULL = never scraped since this column existed → UI falls back to the old
--        inference until the next scrape fills it in.
-- ============================================================
ALTER TABLE public.competitor_products
  ADD COLUMN IF NOT EXISTS scrape_status text;

NOTIFY pgrst, 'reload schema';
