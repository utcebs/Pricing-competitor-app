-- ============================================================
-- (1) Price sanity flag — the worker sets is_suspect=true when a scraped
--     price swings implausibly vs the last known price, so the UI can flag
--     it instead of trusting a bad reading.
-- (2) Repricing checklist — the user's Done / Ignore decision per product,
--     so actioned/dismissed suggestions don't keep reappearing.
-- ============================================================

-- (1) ---------------------------------------------------------
ALTER TABLE price_history ADD COLUMN IF NOT EXISTS is_suspect BOOLEAN NOT NULL DEFAULT FALSE;

-- (2) ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS reprice_actions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      BIGINT      NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  status          TEXT        NOT NULL CHECK (status IN ('done','ignored')),
  suggested_price NUMERIC,
  your_price      NUMERIC,
  cheapest_price  NUMERIC,
  note            TEXT,
  acted_by        UUID        REFERENCES profiles(id),
  acted_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (product_id)          -- one standing decision per product (upserted)
);
CREATE INDEX IF NOT EXISTS idx_reprice_actions_status ON reprice_actions(status);

ALTER TABLE reprice_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_reprice_read ON reprice_actions;
CREATE POLICY p_reprice_read ON reprice_actions FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS p_reprice_write ON reprice_actions;
CREATE POLICY p_reprice_write ON reprice_actions FOR ALL
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());

NOTIFY pgrst, 'reload schema';
