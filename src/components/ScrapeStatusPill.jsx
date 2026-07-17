import { useEffect, useState, useCallback } from 'react'
import { NavLink } from 'react-router-dom'
import { Loader2, Clock } from 'lucide-react'
import { supabase } from '../supabaseClient'

/**
 * Floating status pill — bottom right of every page.
 *
 * Uses Supabase Realtime (Postgres CDC) to react to scrape_runs changes
 * with zero polling delay. Falls back to a 30s poll for safety when
 * the WebSocket is disconnected (network flake / server restart).
 */
export default function ScrapeStatusPill() {
  const [active, setActive] = useState({ queued: 0, running: 0, latestName: null })

  const refetch = useCallback(async () => {
    const { data } = await supabase
      .from('scrape_runs')
      .select('id, status, competitor_id, competitors(name)')
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })
      .limit(20)
    const rows = data || []
    setActive({
      queued:  rows.filter(r => r.status === 'queued').length,
      running: rows.filter(r => r.status === 'running').length,
      latestName: rows[0]?.competitors?.name || null,
    })
  }, [])

  useEffect(() => {
    refetch()   // initial

    // Realtime subscription to scrape_runs changes. When the worker
    // updates a row (queued → running → completed), we get pushed the
    // change over WebSocket and refetch — no more 5s polling.
    const channel = supabase
      .channel('pill-scrape-runs')
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'scrape_runs' },
          () => refetch())
      .subscribe()

    // Safety-net poll every 30s in case the WS drops silently
    const safetyPoll = setInterval(refetch, 30_000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(safetyPoll)
    }
  }, [refetch])

  const total = active.queued + active.running
  if (total === 0) return null

  return (
    <NavLink to="/scrapers"
      className="fixed bottom-6 right-6 z-40 flex items-center gap-3 pl-3 pr-4 py-2.5 rounded-full bg-ink-900 text-white shadow-card-xl hover:shadow-card-xl hover:-translate-y-0.5 transition-all border border-ink-800 group">
      <div className="w-7 h-7 rounded-full bg-brand-500 flex items-center justify-center">
        {active.running > 0
          ? <Loader2 size={13} className="animate-spin" strokeWidth={2.5} />
          : <Clock size={13} strokeWidth={2.5} />}
      </div>
      <div className="text-left leading-tight">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-brand-400 font-semibold">
          {active.running > 0 ? 'Scraping' : 'Queued'}
        </div>
        <div className="text-[13px] font-semibold">
          {active.running > 0 && `${active.running} running`}
          {active.running > 0 && active.queued > 0 && ' · '}
          {active.queued > 0 && `${active.queued} queued`}
          {active.latestName && (
            <span className="text-ink-300 font-normal"> · {active.latestName}</span>
          )}
        </div>
      </div>
    </NavLink>
  )
}
