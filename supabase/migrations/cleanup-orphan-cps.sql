-- ============================================================
-- One-shot cleanup: remove competitor_products rows that were
-- orphaned by prior product deletes (their product_id is NULL
-- because the FK was ON DELETE SET NULL).
--
-- price_history for these CPs cascades away via its own FK
-- (competitor_products ON DELETE CASCADE).
--
-- After this + the client-side delete-first-then-CASCADE flow +
-- the worker's product_id IS NOT NULL filter, the scraper will
-- never touch a deleted product's URLs again.
-- ============================================================

DELETE FROM public.competitor_products
WHERE product_id IS NULL;

-- Optional: report what was left
SELECT
  (SELECT COUNT(*) FROM public.competitor_products WHERE product_id IS NULL) AS remaining_orphans,
  (SELECT COUNT(*) FROM public.competitor_products WHERE is_active = TRUE) AS active_cps;
