-- ============================================================
-- Compatibility probe — test whether a competitor URL can be scraped
-- browser-free, and by which method (Shopify / JSON-LD / meta / a tuned
-- fast-path), before you commit to adding the competitor. The worker polls
-- this table, runs probeUrl(), and writes the report back to `result`.
-- ============================================================

CREATE TABLE IF NOT EXISTS probe_jobs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  url            TEXT        NOT NULL,
  competitor_id  BIGINT      REFERENCES competitors(id) ON DELETE CASCADE,   -- optional
  status         TEXT        NOT NULL DEFAULT 'queued'
                             CHECK (status IN ('queued','done','error')),
  result         JSONB,      -- { ok, method, price, inStock, outOfStock, invalid, needsBrowser, name, error }
  triggered_by   UUID        REFERENCES profiles(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_probe_jobs_status ON probe_jobs(status);

ALTER TABLE probe_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_probe_read ON probe_jobs;
CREATE POLICY p_probe_read ON probe_jobs FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS p_probe_write ON probe_jobs;
CREATE POLICY p_probe_write ON probe_jobs FOR ALL
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());

NOTIFY pgrst, 'reload schema';
