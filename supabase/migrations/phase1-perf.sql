-- ============================================================
-- Phase 1 perf bundle:
--   1. Composite indexes on hot query paths (10-100× at scale)
--   2. Realtime publication so ScrapeStatusPill etc. can subscribe
--      to CDC events instead of polling every 2-5s.
-- ============================================================

-- ── Indexes ─────────────────────────────────────────────
-- Comparison page + Dashboard: "latest price per competitor_product"
CREATE INDEX IF NOT EXISTS idx_price_history_cp_captured
  ON public.price_history(competitor_product_id, captured_at DESC);

-- Scraper tick: "SELECT * FROM scrape_runs WHERE status='queued' ORDER BY created_at"
CREATE INDEX IF NOT EXISTS idx_scrape_runs_status_created
  ON public.scrape_runs(status, created_at);

-- URL finder tick: "WHERE status='queued'"
CREATE INDEX IF NOT EXISTS idx_url_find_jobs_status
  ON public.url_find_jobs(status);

-- Alerts eval: "WHERE is_active AND trigger IN (...)"
CREATE INDEX IF NOT EXISTS idx_alert_rules_active
  ON public.alert_rules(is_active, trigger);

-- Scraper: "SELECT * FROM competitor_products WHERE competitor_id=X AND is_active"
CREATE INDEX IF NOT EXISTS idx_competitor_products_competitor_active
  ON public.competitor_products(competitor_id, is_active);

-- Products page "linked count" join
CREATE INDEX IF NOT EXISTS idx_competitor_products_product
  ON public.competitor_products(product_id);

-- Scrape jobs child fetch
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_run
  ON public.scrape_jobs(scrape_run_id);

-- ── Realtime publication ─────────────────────────────────
-- Supabase Realtime uses Postgres logical replication + a special
-- publication named `supabase_realtime`. Tables must be explicitly
-- added to it to fire CDC events to subscribed clients.
--
-- These are the tables the UI subscribes to. Safe to re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'scrape_runs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.scrape_runs;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'url_find_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.url_find_jobs;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'scrape_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.scrape_jobs;
  END IF;
END $$;

-- Reload PostgREST + Realtime schemas
NOTIFY pgrst, 'reload schema';
