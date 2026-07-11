import 'dotenv/config'
import cron from 'node-cron'
import { supabase } from './supabase.js'
import { runScrapeJob } from './scraper.js'
import { checkAlertRules } from './alerts.js'
import { evaluateRepricingRules } from './repricing.js'
import { syncApprovedProposals } from './sync.js'

/**
 * Main worker entry point. Combines four responsibilities:
 *
 * 1. Consume queued scrape_runs — Playwright scrapes each linked
 *    competitor_products URL for that competitor. Writes price_history
 *    + stock_history rows. Bumps last_seen_at.
 * 2. Fire alerts — after each scrape, check alert_rules; send email
 *    via Resend for anything that matched.
 * 3. Repricing — after each scrape, evaluate pricing_rules against
 *    the fresh data; create pricing_proposals in the queue OR apply
 *    directly if auto_apply is true.
 * 4. Integration sync — poll pricing_proposals with status='approved'
 *    and push them to the configured integration (Dynamics 365, etc.).
 *
 * Deploy target: Railway (or Render). Cron-triggered scheduled scrapes
 * for each active competitor (default: every 6 hours).
 */

async function tick() {
  console.log('[worker] tick @', new Date().toISOString())

  // 1. Pick up any queued scrape_runs and process them.
  const { data: queued } = await supabase
    .from('scrape_runs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(5)

  for (const run of (queued || [])) {
    await runScrapeJob(run)
  }

  // 2. Alert rule evaluation runs even if no scrapes fired.
  await checkAlertRules()

  // 3. Repricing rule evaluation (only makes sense after a scrape,
  //    but running each tick catches manual price entries too).
  await evaluateRepricingRules()

  // 4. Sync approved proposals to external systems.
  await syncApprovedProposals()
}

// Schedule periodic scrapes: enqueue a run for every active competitor
// every 6 hours. Adjust to taste.
cron.schedule('0 */6 * * *', async () => {
  console.log('[worker] scheduled fanout @', new Date().toISOString())
  const { data: comps } = await supabase.from('competitors').select('id').eq('is_active', true)
  for (const c of (comps || [])) {
    await supabase.from('scrape_runs').insert({
      competitor_id: c.id,
      status: 'queued',
      triggered_kind: 'cron',
    })
  }
})

// Tick loop — every minute.
tick().catch(e => console.error('[worker] tick error', e))
setInterval(() => tick().catch(e => console.error('[worker] tick error', e)), 60_000)

console.log('[worker] started')
