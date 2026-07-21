-- ============================================================
-- One-shot cleanup: mark any scrape_runs stuck in 'running' state
-- for more than 15 minutes as 'error'. From now on the tick worker
-- does this automatically at the start of every run
-- (worker/src/tick.js — step 0a), but this clears the historical
-- backlog immediately without waiting for the next tick.
-- ============================================================

UPDATE public.scrape_runs
SET
  status = 'error',
  finished_at = NOW(),
  error_message = COALESCE(error_message, 'stuck run cleaned up (worker likely crashed mid-scrape)')
WHERE status = 'running'
  AND started_at < NOW() - INTERVAL '15 minutes';

SELECT
  status,
  COUNT(*) AS n
FROM public.scrape_runs
GROUP BY status
ORDER BY status;
