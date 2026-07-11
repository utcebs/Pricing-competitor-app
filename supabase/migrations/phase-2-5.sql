-- ============================================================
-- PHASES 2–5 additions
-- Run AFTER supabase/schema.sql. Idempotent (IF NOT EXISTS).
-- ============================================================


-- ═══════════════════════════════════════════════════════════
-- PHASE 2 — Scraper infrastructure
-- ═══════════════════════════════════════════════════════════

-- One row per batch scrape (typically one competitor per run).
CREATE TABLE IF NOT EXISTS scrape_runs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id  BIGINT      REFERENCES competitors(id) ON DELETE CASCADE,
  status         TEXT        NOT NULL DEFAULT 'queued'
                             CHECK (status IN ('queued','running','completed','failed','cancelled')),
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  items_scraped  INTEGER     DEFAULT 0,
  items_failed   INTEGER     DEFAULT 0,
  error_summary  TEXT,
  triggered_by   UUID        REFERENCES profiles(id),
  triggered_kind TEXT        DEFAULT 'manual' CHECK (triggered_kind IN ('manual','cron','api')),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_competitor ON scrape_runs(competitor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_status ON scrape_runs(status);

-- One row per (product URL) attempt within a run.
CREATE TABLE IF NOT EXISTS scrape_jobs (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  scrape_run_id          UUID        NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
  competitor_product_id  BIGINT      REFERENCES competitor_products(id) ON DELETE CASCADE,
  status                 TEXT        NOT NULL DEFAULT 'queued'
                                     CHECK (status IN ('queued','running','ok','blocked','not_found','error')),
  price_extracted        NUMERIC(14,4),
  in_stock_extracted     BOOLEAN,
  raw_html_sample        TEXT,       -- first 500 chars for debugging
  error_message          TEXT,
  duration_ms            INTEGER,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_run ON scrape_jobs(scrape_run_id);
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_cp  ON scrape_jobs(competitor_product_id);


-- ═══════════════════════════════════════════════════════════
-- PHASE 3 — Alerts + matching
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alert_rules (
  id                 BIGSERIAL   PRIMARY KEY,
  owner_id           UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name               TEXT        NOT NULL,
  scope              TEXT        NOT NULL DEFAULT 'any_product'
                                CHECK (scope IN ('any_product','specific_product','specific_category','specific_competitor')),
  scope_ref_id       BIGINT,     -- FK into products/categories/competitors depending on scope
  trigger            TEXT        NOT NULL
                                CHECK (trigger IN (
                                  'price_dropped', 'price_increased',
                                  'went_out_of_stock', 'came_back_in_stock',
                                  'gap_pct_over', 'gap_pct_under'
                                )),
  threshold_pct      NUMERIC(6,2),  -- used by 'gap_*' and '*_over' variants
  delivery           TEXT        NOT NULL DEFAULT 'digest'
                                CHECK (delivery IN ('instant','digest')),
  is_active          BOOLEAN     DEFAULT TRUE,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alert_rules_owner ON alert_rules(owner_id);
DROP TRIGGER IF EXISTS alert_rules_updated_at ON alert_rules;
CREATE TRIGGER alert_rules_updated_at BEFORE UPDATE ON alert_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Log every time a rule fires + delivery status.
CREATE TABLE IF NOT EXISTS alert_deliveries (
  id                      BIGSERIAL   PRIMARY KEY,
  alert_rule_id           BIGINT      NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  competitor_product_id   BIGINT      REFERENCES competitor_products(id) ON DELETE SET NULL,
  event                   TEXT,       -- human-readable summary
  old_value               NUMERIC(14,4),
  new_value               NUMERIC(14,4),
  delivered_at            TIMESTAMPTZ,
  delivery_status         TEXT        DEFAULT 'pending'
                                     CHECK (delivery_status IN ('pending','sent','failed','skipped')),
  delivery_error          TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alert_deliveries_rule ON alert_deliveries(alert_rule_id, created_at DESC);

-- Auto-match suggestions (Phase 3 will fill these via name similarity).
CREATE TABLE IF NOT EXISTS match_suggestions (
  id                    BIGSERIAL   PRIMARY KEY,
  competitor_product_id BIGINT      NOT NULL REFERENCES competitor_products(id) ON DELETE CASCADE,
  product_id            BIGINT      NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  confidence            NUMERIC(3,2) NOT NULL,
  method                TEXT        NOT NULL DEFAULT 'name_similarity',
  reviewed              BOOLEAN     DEFAULT FALSE,
  accepted              BOOLEAN,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (competitor_product_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_match_suggestions_cp ON match_suggestions(competitor_product_id);


-- ═══════════════════════════════════════════════════════════
-- PHASE 4 — Saved reports
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS saved_reports (
  id           BIGSERIAL   PRIMARY KEY,
  owner_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  description  TEXT,
  config       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    -- config shape:
    -- {
    --   metric: 'avg_price' | 'min_price' | 'max_price' | 'gap_pct' | 'in_stock_rate' | 'price_change_count',
    --   scope: 'all' | 'category' | 'competitor',
    --   scope_id: number|null,
    --   groupBy: 'competitor' | 'category' | 'product' | 'day' | 'week' | 'month',
    --   dateFrom: 'YYYY-MM-DD' | null,
    --   dateTo:   'YYYY-MM-DD' | null,
    --   chart: 'table' | 'bar' | 'line' | 'pie'
    -- }
  is_shared    BOOLEAN     DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_saved_reports_owner ON saved_reports(owner_id);
DROP TRIGGER IF EXISTS saved_reports_updated_at ON saved_reports;
CREATE TRIGGER saved_reports_updated_at BEFORE UPDATE ON saved_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ═══════════════════════════════════════════════════════════
-- PHASE 5 — Repricing + integrations
-- ═══════════════════════════════════════════════════════════

-- Repricing rules — rule engine evaluates these on each new price scrape.
CREATE TABLE IF NOT EXISTS pricing_rules (
  id                    BIGSERIAL   PRIMARY KEY,
  name                  TEXT        NOT NULL,
  is_active             BOOLEAN     DEFAULT TRUE,
  scope                 TEXT        NOT NULL DEFAULT 'all_products'
                                    CHECK (scope IN ('all_products','specific_category','specific_product')),
  scope_ref_id          BIGINT,
  strategy              TEXT        NOT NULL
                                    CHECK (strategy IN (
                                      'match_lowest', 'beat_lowest_by_pct', 'beat_lowest_by_amt',
                                      'match_average', 'stay_x_pct_above', 'stay_x_pct_below'
                                    )),
  strategy_value        NUMERIC(10,4),   -- pct or amount depending on strategy
  respect_min_price     BOOLEAN     DEFAULT TRUE,
  respect_target_margin BOOLEAN     DEFAULT TRUE,
  only_if_competitor_in_stock BOOLEAN DEFAULT TRUE,
  auto_apply            BOOLEAN     DEFAULT FALSE,  -- false = create proposal for approval
  priority              INTEGER     DEFAULT 100,    -- lower = higher priority
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
DROP TRIGGER IF EXISTS pricing_rules_updated_at ON pricing_rules;
CREATE TRIGGER pricing_rules_updated_at BEFORE UPDATE ON pricing_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Proposed price changes — approval queue.
CREATE TABLE IF NOT EXISTS pricing_proposals (
  id                  BIGSERIAL   PRIMARY KEY,
  product_id          BIGINT      NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  rule_id             BIGINT      REFERENCES pricing_rules(id) ON DELETE SET NULL,
  current_price       NUMERIC(14,4),
  suggested_price     NUMERIC(14,4) NOT NULL,
  reason              TEXT,             -- "Competitor X dropped 5% below your price"
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','approved','rejected','applied','skipped')),
  reviewed_by         UUID        REFERENCES profiles(id),
  reviewed_at         TIMESTAMPTZ,
  applied_at          TIMESTAMPTZ,
  external_sync_id    UUID,       -- links to integration_sync_log if pushed to Dynamics
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pricing_proposals_status ON pricing_proposals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pricing_proposals_product ON pricing_proposals(product_id);

-- External integrations config (D365, Shopify, WooCommerce, BigCommerce, Magento, GA).
CREATE TABLE IF NOT EXISTS integrations (
  id           BIGSERIAL   PRIMARY KEY,
  kind         TEXT        NOT NULL
                           CHECK (kind IN ('dynamics_365','shopify','woocommerce','bigcommerce','magento','google_analytics')),
  name         TEXT        NOT NULL,
  is_active    BOOLEAN     DEFAULT FALSE,
  -- config JSONB per kind. e.g. Dynamics 365:
  --   { tenantId, clientId, clientSecret, resourceUrl }
  -- Shopify:
  --   { shopDomain, accessToken }
  -- ...
  config       JSONB       DEFAULT '{}'::jsonb,
  last_sync_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
DROP TRIGGER IF EXISTS integrations_updated_at ON integrations;
CREATE TRIGGER integrations_updated_at BEFORE UPDATE ON integrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every sync attempt with an external system.
CREATE TABLE IF NOT EXISTS integration_sync_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id  BIGINT      NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  operation       TEXT        NOT NULL,   -- 'push_price', 'pull_product', etc.
  status          TEXT        NOT NULL DEFAULT 'running'
                              CHECK (status IN ('running','ok','failed')),
  request_payload  JSONB,
  response_payload JSONB,
  error_message   TEXT,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_integration_sync_int ON integration_sync_log(integration_id, created_at DESC);


-- ═══════════════════════════════════════════════════════════
-- RLS for the new tables — same model as Phase 1
-- Reads: any authenticated user.
-- Writes: admin/manager only. `owner_id` tables let users manage own rows.
-- ═══════════════════════════════════════════════════════════
ALTER TABLE scrape_runs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_jobs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_deliveries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_suggestions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_reports         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_rules         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_proposals     ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_sync_log  ENABLE ROW LEVEL SECURITY;

-- Reads for any authenticated user
DO $$ BEGIN
  FOR t IN ARRAY['scrape_runs','scrape_jobs','alert_deliveries','match_suggestions','pricing_proposals','integration_sync_log']
  LOOP EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (auth.role() = %L)',
    't_read_'||t, t, 'authenticated');
  END LOOP;
END $$;
-- (Note: DO block above uses a loop; simpler to write each explicitly)

-- Actually, simpler to just write them:
DROP POLICY IF EXISTS p_sr_read ON scrape_runs;          CREATE POLICY p_sr_read ON scrape_runs FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS p_sj_read ON scrape_jobs;          CREATE POLICY p_sj_read ON scrape_jobs FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS p_ad_read ON alert_deliveries;     CREATE POLICY p_ad_read ON alert_deliveries FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS p_ms_read ON match_suggestions;    CREATE POLICY p_ms_read ON match_suggestions FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS p_pp_read ON pricing_proposals;    CREATE POLICY p_pp_read ON pricing_proposals FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS p_isl_read ON integration_sync_log; CREATE POLICY p_isl_read ON integration_sync_log FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS p_pr_read ON pricing_rules;        CREATE POLICY p_pr_read ON pricing_rules FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS p_int_read ON integrations;        CREATE POLICY p_int_read ON integrations FOR SELECT USING (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════
-- AUTO-MATCHER — pg_trgm-based name-similarity suggestions
-- ═══════════════════════════════════════════════════════════
-- Whenever a competitor_products row is inserted, look for products
-- whose name has >= 0.4 trigram similarity and insert the top 3 into
-- match_suggestions. Admin reviews at /matches.
--
-- Threshold and top-N are conservative on purpose to avoid noise; tune
-- via the SIMILARITY_THRESHOLD constant if you need more or fewer hits.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION generate_match_suggestions()
RETURNS TRIGGER AS $$
DECLARE
  suggestion_row RECORD;
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    -- Already matched at creation time; nothing to suggest.
    RETURN NEW;
  END IF;

  FOR suggestion_row IN
    SELECT id AS product_id, similarity(name, NEW.name) AS score
    FROM products
    WHERE similarity(name, NEW.name) >= 0.4
      AND is_active = TRUE
    ORDER BY similarity(name, NEW.name) DESC
    LIMIT 3
  LOOP
    INSERT INTO match_suggestions (competitor_product_id, product_id, confidence, method)
    VALUES (NEW.id, suggestion_row.product_id, suggestion_row.score, 'name_similarity')
    ON CONFLICT (competitor_product_id, product_id) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS cp_auto_match ON competitor_products;
CREATE TRIGGER cp_auto_match
  AFTER INSERT ON competitor_products
  FOR EACH ROW EXECUTE FUNCTION generate_match_suggestions();

-- Also add a settings JSONB to profiles for user-customized dashboards
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS dashboard_config JSONB DEFAULT '{}'::jsonb;

-- Backfill: run the matcher against any existing unlinked rows.
-- Safe to re-run — the ON CONFLICT ignores duplicates.
INSERT INTO match_suggestions (competitor_product_id, product_id, confidence, method)
SELECT cp.id, p.id, similarity(p.name, cp.name), 'name_similarity'
FROM competitor_products cp
CROSS JOIN LATERAL (
  SELECT id, name FROM products
  WHERE similarity(name, cp.name) >= 0.4 AND is_active = TRUE
  ORDER BY similarity(name, cp.name) DESC LIMIT 3
) p
WHERE cp.product_id IS NULL
ON CONFLICT (competitor_product_id, product_id) DO NOTHING;


-- alert_rules + saved_reports: user reads own rows OR admin sees all
DROP POLICY IF EXISTS p_ar_read ON alert_rules;
CREATE POLICY p_ar_read ON alert_rules FOR SELECT
  USING (owner_id = auth.uid() OR is_admin_or_manager());
DROP POLICY IF EXISTS p_sav_read ON saved_reports;
CREATE POLICY p_sav_read ON saved_reports FOR SELECT
  USING (owner_id = auth.uid() OR is_shared = TRUE OR is_admin_or_manager());

-- Writes — admin/manager for shared config, self for owner_id tables
DROP POLICY IF EXISTS p_sr_write ON scrape_runs;
CREATE POLICY p_sr_write ON scrape_runs FOR ALL USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
DROP POLICY IF EXISTS p_sj_write ON scrape_jobs;
CREATE POLICY p_sj_write ON scrape_jobs FOR ALL USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
DROP POLICY IF EXISTS p_ad_write ON alert_deliveries;
CREATE POLICY p_ad_write ON alert_deliveries FOR ALL USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
DROP POLICY IF EXISTS p_ms_write ON match_suggestions;
CREATE POLICY p_ms_write ON match_suggestions FOR ALL USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
DROP POLICY IF EXISTS p_pr_write ON pricing_rules;
CREATE POLICY p_pr_write ON pricing_rules FOR ALL USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
DROP POLICY IF EXISTS p_pp_write ON pricing_proposals;
CREATE POLICY p_pp_write ON pricing_proposals FOR ALL USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
DROP POLICY IF EXISTS p_int_write ON integrations;
CREATE POLICY p_int_write ON integrations FOR ALL USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
DROP POLICY IF EXISTS p_isl_write ON integration_sync_log;
CREATE POLICY p_isl_write ON integration_sync_log FOR ALL USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
DROP POLICY IF EXISTS p_ar_write ON alert_rules;
CREATE POLICY p_ar_write ON alert_rules FOR ALL
  USING (owner_id = auth.uid() OR is_admin_or_manager())
  WITH CHECK (owner_id = auth.uid() OR is_admin_or_manager());
DROP POLICY IF EXISTS p_sav_write ON saved_reports;
CREATE POLICY p_sav_write ON saved_reports FOR ALL
  USING (owner_id = auth.uid() OR is_admin_or_manager())
  WITH CHECK (owner_id = auth.uid() OR is_admin_or_manager());
