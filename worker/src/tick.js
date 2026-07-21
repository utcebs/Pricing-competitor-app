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
import { runScrapeJob, refreshOwnPrices } from './scraper.js'
import { runFindUrlsJob } from './find-urls.js'
import { checkAlertRules } from './alerts.js'
import { evaluateRepricingRules } from './repricing.js'
import { syncApprovedProposals } from './sync.js'

async function tick() {
  const started = Date.now()
  console.log('[tick] start @', new Date().toISOString())

  // 0a) Sweep stuck runs. If a prior tick crashed / timed out mid-scrape,
  //     the row stays status='running' forever, clutters the dashboard's
  //     "Live activity", and blocks nothing from being re-queued but
  //     shows a permanent progress bar. Anything running > 15 min is
  //     definitively stuck (single-URL scrapes take <30s each).
  const stuckCutoff = new Date(Date.now() - 15 * 60_000).toISOString()
  const { data: stuck } = await supabase
    .from('scrape_runs')
    .update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      error_summary: 'stuck run auto-cleaned by tick (worker likely crashed mid-scrape)',
    })
    .eq('status', 'running')
    .lt('started_at', stuckCutoff)
    .select('id')
  if (stuck?.length) console.log(`[tick] cleaned up ${stuck.length} stuck run(s)`)

  // 0b) URL-finder jobs first — they may enqueue scrape runs that we'll
  //    then consume in step 1, so a single tick can find+scrape.
  const { data: findJobs } = await supabase
    .from('url_find_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(3)
  if (findJobs?.length) {
    console.log(`[tick] processing ${findJobs.length} queued URL-find job(s)`)
    for (const job of findJobs) await runFindUrlsJob(job)
  }

  // 1) Consume queued scrape runs (including any just-enqueued by URL-find)
  // Sharding: SHARD_INDEX/SHARD_COUNT env vars split competitor_id space
  // across parallel workflows. Default (no env) = single-worker mode.
  const shardIdx   = Number(process.env.SHARD_INDEX)
  const shardCount = Number(process.env.SHARD_COUNT)
  const isSharded  = Number.isInteger(shardIdx) && Number.isInteger(shardCount) && shardCount > 0

  // Fetch more when sharded so filtering leaves us with a full batch
  const fetchLimit = isSharded ? 30 : 5
  const { data: allQueued } = await supabase
    .from('scrape_runs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(fetchLimit)

  // Apply shard filter in JS (PostgREST has no modulo operator)
  let queued = allQueued || []
  if (isSharded) {
    queued = queued.filter(r => (r.competitor_id % shardCount) === shardIdx).slice(0, 5)
    console.log(`[tick] shard ${shardIdx}/${shardCount} — ${queued.length} of ${allQueued.length} queued runs match`)
  }

  console.log(`[tick] processing ${queued.length} queued scrape run(s)`)
  for (const run of queued) {
    // runScrapeJob does row-level locking so shards can't collide
    await runScrapeJob(run)
  }

  // 1b) Refresh your-own-website prices for any products with own_url set
  await refreshOwnPrices()

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
