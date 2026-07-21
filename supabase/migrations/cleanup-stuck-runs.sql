-- ============================================================
-- One-shot cleanup: mark scrape_runs stuck in 'running' for more
-- than 15 minutes as 'failed'. The tick worker does this
-- automatically at start-of-tick from now on
-- (worker/src/tick.js — step 0a); this SQL clears the historical
-- backlog immediately.
-- ============================================================

UPDATE public.scrape_runs
SET
  status = 'failed',
  finished_at = NOW(),
  error_summary = COALESCE(error_summary, 'stuck run cleaned up (worker likely crashed mid-scrape)')
WHERE status = 'running'
  AND started_at < NOW() - INTERVAL '15 minutes';

SELECT
  status,
  COUNT(*) AS n
FROM public.scrape_runs
GROUP BY status
ORDER BY status;
