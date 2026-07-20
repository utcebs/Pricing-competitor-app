-- ============================================================
-- One-shot cleanup: remove alert_rules whose scope_ref_id points
-- to a product, category, or competitor that no longer exists.
--
-- alert_rules.scope_ref_id is a polymorphic pointer (no real FK)
-- so Postgres never cleaned these up when the target was deleted.
-- The new client-side delete handlers wipe matching rules going
-- forward — this script clears the historical leftovers.
-- ============================================================

-- Orphan product-scoped rules
DELETE FROM public.alert_rules
WHERE scope = 'specific_product'
  AND scope_ref_id NOT IN (SELECT id FROM public.products);

-- Orphan competitor-scoped rules
DELETE FROM public.alert_rules
WHERE scope = 'specific_competitor'
  AND scope_ref_id NOT IN (SELECT id FROM public.competitors);

-- Orphan category-scoped rules
DELETE FROM public.alert_rules
WHERE scope = 'specific_category'
  AND scope_ref_id NOT IN (SELECT id FROM public.categories);

-- Report what's left
SELECT
  scope,
  COUNT(*) AS remaining_rules,
  COUNT(*) FILTER (WHERE scope_ref_id IS NOT NULL) AS with_target
FROM public.alert_rules
GROUP BY scope
ORDER BY scope;
