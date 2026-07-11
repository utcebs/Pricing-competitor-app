/**
 * One-shot tick — runs each subsystem exactly once, then exits.
 * Used by GitHub Actions (.github/workflows/worker-tick.yml, every 5 min).
 *
 * The long-running index.js version is still there for Render/Railway
 * deploys. This file is the same logic without the setInterval / cron
 * schedulers (Actions runs the schedule for us).
 */
import 'dotenv/config'
import { supabase } from './supabase.js'
import { runScrapeJob } from './scraper.js'
import { checkAlertRules } from './alerts.js'
import { evaluateRepricingRules } from './repricing.js'
import { syncApprovedProposals } from './sync.js'

async function tick() {
  const started = Date.now()
  console.log('[tick] start @', new Date().toISOString())

  // 1) Consume queued scrape runs
  const { data: queued } = await supabase
    .from('scrape_runs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(5)

  console.log(`[tick] processing ${queued?.length || 0} queued scrape run(s)`)
  for (const run of (queued || [])) {
    await runScrapeJob(run)
  }

  // 2) Alert evaluation
  await checkAlertRules()

  // 3) Repricing evaluation
  await evaluateRepricingRules()

  // 4) Integration sync
  await syncApprovedProposals()

  console.log(`[tick] done in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

tick()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[tick] FAILED', err)
    process.exit(1)
  })
