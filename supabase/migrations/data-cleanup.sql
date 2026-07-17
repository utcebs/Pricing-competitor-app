-- ============================================================
-- prune_old_data() — housekeeping to keep the DB slim.
-- Called by worker/src/daily-digest.js once per day.
-- Safe to call more often; each DELETE targets a distinct window.
-- ============================================================

CREATE OR REPLACE FUNCTION public.prune_old_data()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  html_cleared     INT;
  prices_deleted   INT;
  stock_deleted    INT;
  runs_deleted     INT;
  jobs_deleted     INT;
BEGIN
  -- 1. Drop the 4KB raw_html_sample blob from scrape_jobs older than 7 days.
  --    Keeps the row (audit trail) but frees ~99% of its storage.
  UPDATE public.scrape_jobs
     SET raw_html_sample = NULL
   WHERE raw_html_sample IS NOT NULL
     AND created_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS html_cleared = ROW_COUNT;

  -- 2. Delete raw price_history older than 90 days.
  --    (Aggregation-to-daily-average is a nice-to-have; for now
  --     just prune. Adjust interval if you want longer history.)
  DELETE FROM public.price_history
   WHERE captured_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS prices_deleted = ROW_COUNT;

  -- 3. Delete stock_history older than 60 days.
  DELETE FROM public.stock_history
   WHERE captured_at < NOW() - INTERVAL '60 days';
  GET DIAGNOSTICS stock_deleted = ROW_COUNT;

  -- 4. Delete completed/failed/cancelled scrape_runs older than 30 days
  --    AND their child scrape_jobs (FK cascades).
  DELETE FROM public.scrape_runs
   WHERE status IN ('completed', 'failed', 'cancelled')
     AND finished_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS runs_deleted = ROW_COUNT;

  -- 5. Orphaned scrape_jobs (in case cascade didn't fire cleanly).
  DELETE FROM public.scrape_jobs
   WHERE scrape_run_id NOT IN (SELECT id FROM public.scrape_runs);
  GET DIAGNOSTICS jobs_deleted = ROW_COUNT;

  -- 6. Old url_find_jobs (completed/failed, > 30 days).
  DELETE FROM public.url_find_jobs
   WHERE status IN ('completed', 'failed')
     AND finished_at < NOW() - INTERVAL '30 days';

  -- 7. Reviewed match_suggestions older than 30 days.
  DELETE FROM public.match_suggestions
   WHERE reviewed = TRUE
     AND created_at < NOW() - INTERVAL '30 days';

  -- 8. Sent alert_deliveries older than 60 days.
  DELETE FROM public.alert_deliveries
   WHERE delivery_status = 'sent'
     AND delivered_at < NOW() - INTERVAL '60 days';

  -- 9. Old integration_sync_log entries (completed OK, > 60 days).
  DELETE FROM public.integration_sync_log
   WHERE status = 'ok'
     AND created_at < NOW() - INTERVAL '60 days';

  RETURN jsonb_build_object(
    'html_samples_cleared', html_cleared,
    'prices_deleted',       prices_deleted,
    'stock_deleted',        stock_deleted,
    'runs_deleted',         runs_deleted,
    'jobs_deleted',         jobs_deleted,
    'ran_at',               NOW()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.prune_old_data() TO authenticated;

NOTIFY pgrst, 'reload schema';
