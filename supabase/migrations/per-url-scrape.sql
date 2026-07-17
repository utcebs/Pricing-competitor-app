-- ============================================================
-- Per-URL scrape target: scrape_runs can now target a single
-- competitor_products row instead of the whole competitor.
-- Used by the "Scrape this URL" button on Linked Items + Match Review.
-- ============================================================

ALTER TABLE public.scrape_runs
  ADD COLUMN IF NOT EXISTS target_cp_id BIGINT
    REFERENCES public.competitor_products(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_scrape_runs_target_cp
  ON public.scrape_runs(target_cp_id);

NOTIFY pgrst, 'reload schema';
