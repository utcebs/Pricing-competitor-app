import { supabase } from './supabase.js'
import { runScrapeJob } from './scraper.js'

/**
 * queue.js — optional BullMQ integration.
 *
 * When REDIS_URL is set (Upstash or self-hosted Redis), we spin up a
 * BullMQ producer + consumer for scrape_runs. This decouples enqueue
 * from processing and gives you retries with exponential backoff.
 *
 * When REDIS_URL is NOT set, we do nothing here — the polling loop in
 * index.js handles scrape_runs directly. That path is fine up to ~100
 * competitors.
 */
export async function setupBullMQ() {
  if (!process.env.REDIS_URL) {
    console.log('[queue] REDIS_URL not set — using polling fallback')
    return
  }

  const [{ Queue, Worker, QueueEvents }, { default: IORedis }] = await Promise.all([
    import('bullmq'),
    import('ioredis'),
  ])

  const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
  const queue = new Queue('scrapes', { connection })

  // Producer: watch supabase for queued runs, transfer them to BullMQ
  setInterval(async () => {
    try {
      const { data: queued } = await supabase
        .from('scrape_runs').select('id').eq('status', 'queued').limit(10)
      for (const r of (queued || [])) {
        await queue.add('scrape', { runId: r.id }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
        })
        // Mark as 'running' so the polling path in index.js ignores it
        await supabase.from('scrape_runs').update({ status: 'running' }).eq('id', r.id)
      }
    } catch (e) { console.error('[queue] producer error', e) }
  }, 30_000)

  // Consumer: run the actual scrape
  new Worker('scrapes', async job => {
    const { data: run } = await supabase.from('scrape_runs').select('*').eq('id', job.data.runId).single()
    if (run) await runScrapeJob(run)
  }, { connection, concurrency: 2 })

  const events = new QueueEvents('scrapes', { connection })
  events.on('failed', ({ jobId, failedReason }) => {
    console.error(`[queue] scrape ${jobId} failed:`, failedReason)
  })

  console.log('[queue] BullMQ producer + consumer running')
}
