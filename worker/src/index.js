import 'dotenv/config'
import cron from 'node-cron'
import { supabase } from './supabase.js'
import { runScrapeJob } from './scraper.js'
import { checkAlertRules, sendDigestEmails } from './alerts.js'
import { evaluateRepricingRules } from './repricing.js'
import { syncApprovedProposals } from './sync.js'
import { pullGoogleAnalytics } from './google-analytics.js'
import { setupBullMQ } from './queue.js'

/**
 * Worker entry point. Four responsibilities on a 60-second tick:
 *
 * 1. Consume queued scrape_runs — Playwright scrapes each competitor's
 *    active URLs, writes price_history + stock_history.
 * 2. Alert evaluation — evaluates alert_rules; sends instant emails
 *    via Resend; queues digest deliveries.
 * 3. Repricing — evaluates pricing_rules; creates pricing_proposals
 *    (or auto-applies if configured).
 * 4. Integration sync — pushes approved proposals to Dynamics 365 /
 *    Shopify / WooCommerce / BigCommerce / Magento.
 *
 * Cron schedules:
 *   Every 6 hours: fan out a scheduled scrape run for every active competitor.
 *   Daily at 09:00: send digest emails for pending digest deliveries.
 *   Daily at 03:00: pull Google Analytics data for active GA integrations.
 *
 * Scale note: at ~15 competitors × ~1500 SKUs × 4 checks/day, the polling
 * loop is fine. If you hit 100+ competitors, set REDIS_URL to enable the
 * BullMQ path in queue.js — same code paths, just backed by a real queue.
 */

async function tick() {
  console.log('[worker] tick @', new Date().toISOString())
  let processed = 0
  try {
    // Self-heal: if a previous run crashed/restarted mid-scrape (e.g. OOM),
    // its scrape_runs rows are stuck in 'running' forever and never retried.
    // Fast-path scrapes finish in <2s, so anything 'running' > 10 min is dead.
    // Re-queue them so they get picked up again this loop.
    const stuckCutoff = new Date(Date.now() - 10 * 60_000).toISOString()
    const { data: stuck } = await supabase
      .from('scrape_runs')
      .update({ status: 'queued', started_at: null })
      .eq('status', 'running')
      .lt('started_at', stuckCutoff)
      .select('id')
    if (stuck?.length) console.log(`[worker] re-queued ${stuck.length} stuck run(s)`)

    const { data: queued } = await supabase
      .from('scrape_runs')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(10)

    // Sequential: one runScrapeJob (→ one browser) at a time keeps memory
    // flat on the 512 MB Render Starter plan even with a big backlog.
    for (const run of (queued || [])) {
      await runScrapeJob(run)
      processed++
    }

    await checkAlertRules()
    await evaluateRepricingRules()
    await syncApprovedProposals()
  } catch (e) {
    console.error('[worker] tick error', e)
  }
  return processed
}

// Cron 1 — scheduled scrape fanout every 6 hours
cron.schedule('0 */6 * * *', async () => {
  console.log('[worker] cron: scheduled scrape fanout')
  const { data: comps } = await supabase.from('competitors').select('id').eq('is_active', true)
  for (const c of (comps || [])) {
    await supabase.from('scrape_runs').insert({
      competitor_id: c.id, status: 'queued', triggered_kind: 'cron',
    })
  }
})

// Cron 2 — daily digest email at 09:00
cron.schedule('0 9 * * *', async () => {
  console.log('[worker] cron: daily digest')
  await sendDigestEmails()
})

// Cron 3 — daily GA pull at 03:00
cron.schedule('0 3 * * *', async () => {
  console.log('[worker] cron: GA pull')
  await pullGoogleAnalytics()
})

// Optional BullMQ — if REDIS_URL is set, wire it up. Otherwise the polling
// loop above handles everything.
setupBullMQ()

// Kick off — self-scheduling loop with a re-entrancy guard.
// Runs back-to-back while there's a backlog (drains fast), then idles at
// 60s once the queue is empty. A single in-flight tick guarantees only one
// Playwright browser is ever open, so memory stays flat on Render Starter.
let ticking = false
async function loop() {
  if (ticking) { setTimeout(loop, 5_000); return }
  ticking = true
  let processed = 0
  try { processed = await tick() } catch (e) { console.error('[worker] loop error', e) }
  finally { ticking = false }
  // Busy → poll again almost immediately; idle → back off to 60s.
  setTimeout(loop, processed > 0 ? 500 : 60_000)
}
loop()

console.log('[worker] started · REDIS_URL:', process.env.REDIS_URL ? 'yes' : 'no')
