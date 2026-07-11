/**
 * Enqueue a scheduled scrape_run for every active competitor.
 * Called from .github/workflows/worker-daily.yml every 6 hours.
 * The tick workflow will process these queued runs on its next run.
 */
import 'dotenv/config'
import { supabase } from './supabase.js'

const { data: comps, error } = await supabase
  .from('competitors')
  .select('id, name')
  .eq('is_active', true)

if (error) { console.error('[fanout] failed to list competitors', error); process.exit(1) }

console.log(`[fanout] enqueueing scrape for ${comps.length} competitor(s)`)
for (const c of comps) {
  await supabase.from('scrape_runs').insert({
    competitor_id: c.id,
    status: 'queued',
    triggered_kind: 'cron',
  })
  console.log(`  ✓ ${c.name}`)
}
console.log('[fanout] done')
process.exit(0)
