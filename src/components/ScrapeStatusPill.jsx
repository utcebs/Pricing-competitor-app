import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Activity, Loader2, Clock } from 'lucide-react'
import { supabase } from '../supabaseClient'

/**
 * Floating status pill — bottom right of every page.
 * Polls scrape_runs for active work (queued + running) and shows count.
 * Hidden when nothing is happening.
 */
export default function ScrapeStatusPill() {
  const [active, setActive] = useState({ queued: 0, running: 0, latestName: null })

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      const { data } = await supabase
        .from('scrape_runs')
        .select('id, status, competitor_id, competitors(name), started_at, created_at')
        .in('status', ['queued', 'running'])
        .order('created_at', { ascending: false })
        .limit(20)

      if (cancelled) return

      const queued  = (data || []).filter(r => r.status === 'queued').length
      const running = (data || []).filter(r => r.status === 'running').length
      const latest  = (data || [])[0]
      const latestName = latest?.competitors?.name || null
      setActive({ queued, running, latestName })
    }
    tick()
    const id = setInterval(tick, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

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
