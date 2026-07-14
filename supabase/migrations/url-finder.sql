-- ============================================================
-- URL finder — auto-discover competitor product URLs from a product name.
-- Worker polls this table and uses Playwright + a search engine
-- (DuckDuckGo site: search by default, competitor-specific if configured)
-- to find the URL for each active competitor.
-- ============================================================

CREATE TABLE IF NOT EXISTS url_find_jobs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     BIGINT      NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  competitor_id  BIGINT      REFERENCES competitors(id) ON DELETE CASCADE,   -- null = search all active competitors
  status         TEXT        NOT NULL DEFAULT 'queued'
                             CHECK (status IN ('queued','running','completed','failed')),
  urls_found     INTEGER     DEFAULT 0,
  results        JSONB       DEFAULT '[]'::jsonb,   -- [{competitor_id, competitor_name, url, title, confidence, status}]
  error_summary  TEXT,
  triggered_by   UUID        REFERENCES profiles(id),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_url_find_jobs_status ON url_find_jobs(status);
CREATE INDEX IF NOT EXISTS idx_url_find_jobs_product ON url_find_jobs(product_id);

ALTER TABLE url_find_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_uf_read ON url_find_jobs;
CREATE POLICY p_uf_read ON url_find_jobs FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS p_uf_write ON url_find_jobs;
CREATE POLICY p_uf_write ON url_find_jobs FOR ALL
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());

NOTIFY pgrst, 'reload schema';
