import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import {
  Sparkles, Loader2, CheckCircle2, XCircle, ExternalLink,
  ArrowRight, Clock, Search,
} from 'lucide-react'
import { supabase } from '../supabaseClient'
import { Modal, Button, Card } from './UI'

/**
 * Live-status modal for a url_find_jobs run.
 * Polls the job row every 2s and renders per-competitor breakdown as
 * the worker discovers URLs. When the job completes, offers a "Review
 * matches" CTA that jumps to the Match Review page.
 *
 * Props: { jobId, productName, open, onClose, competitors }
 * `competitors` is the list of active competitors so we can render an
 * empty row per competitor while the worker is still queued.
 */
export default function FindUrlsModal({ jobId, productName, open, onClose, competitors = [] }) {
  const [job, setJob] = useState(null)
  const [pollError, setPollError] = useState('')

  useEffect(() => {
    if (!open || !jobId) return
    let cancelled = false

    const fetchJob = async () => {
      const { data, error } = await supabase
        .from('url_find_jobs')
        .select('id, status, urls_found, results, started_at, finished_at, error_summary')
        .eq('id', jobId)
        .maybeSingle()
      if (cancelled) return
      if (error) { setPollError(error.message); return }
      setJob(data)
    }
    fetchJob()   // initial

    // Realtime: subscribe to this specific job's UPDATE events.
    // Zero-latency vs the previous 2s poll.
    const channel = supabase
      .channel(`find-job-${jobId}`)
      .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'url_find_jobs', filter: `id=eq.${jobId}` },
          () => fetchJob())
      .subscribe()

    // Safety-net poll: 10s (was 2s). Only fires if WS drops.
    const safety = setInterval(fetchJob, 10_000)

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
      clearInterval(safety)
    }
  }, [open, jobId])

  if (!open) return null

  const status  = job?.status || 'queued'
  const results = job?.results || []
  const done    = status === 'completed' || status === 'failed'
  const foundCount = job?.urls_found ?? 0
  const notFound = results.filter(r => r.status === 'not_found').length
  const errored  = results.filter(r => r.status === 'error').length
  const skipped  = results.filter(r => r.status === 'skipped').length

  // Merge results with competitor list so we always show a row per active competitor
  const perCompetitorRows = competitors.map(c => {
    const r = results.find(r => r.competitor_id === c.id)
    return { competitor: c, result: r }
  })

  return (
    <Modal open={open} onClose={onClose} wide
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles size={17} className="text-brand-600"/> Auto-find URLs
        </span>
      }
      subtitle={`Product: ${productName}`}>

      {/* Overall progress banner */}
      <div className={`p-4 rounded-xl border mb-5 ${
        done && foundCount > 0 ? 'bg-emerald-50 border-emerald-100 text-emerald-800' :
        done && foundCount === 0 ? 'bg-amber-50 border-amber-100 text-amber-800' :
        'bg-brand-50 border-brand-100 text-brand-800'
      }`}>
        <div className="flex items-center gap-3">
          {done
            ? (foundCount > 0
                ? <CheckCircle2 size={18} className="flex-shrink-0"/>
                : <XCircle size={18} className="flex-shrink-0"/>)
            : <Loader2 size={18} className="animate-spin flex-shrink-0"/>}
          <div className="flex-1 min-w-0">
            <div className="font-display text-[16px] tracking-tight">
              {status === 'queued'   && 'Queued — waiting for next tick'}
              {status === 'running'  && `Searching ${competitors.length} competitor${competitors.length === 1 ? '' : 's'}…`}
              {status === 'completed' && (foundCount > 0
                ? `Found ${foundCount} URL${foundCount === 1 ? '' : 's'}`
                : 'No URLs found on any competitor')}
              {status === 'failed'   && 'Job failed'}
            </div>
            <div className="text-[12px] opacity-80 mt-0.5">
              {status === 'queued'   && 'Cron fires every 5 min. Worker picks this up on the next tick.'}
              {status === 'running'  && 'Live-updating below.'}
              {status === 'completed' && foundCount > 0 && `Review each match on the Match Review page before scraping.`}
              {status === 'completed' && foundCount === 0 && 'Try adding URLs manually via Linked Items.'}
              {status === 'failed'   && (job?.error_summary || 'Unknown error')}
            </div>
          </div>
        </div>
      </div>

      {/* Per-competitor breakdown */}
      <div className="space-y-2 mb-5">
        {perCompetitorRows.map(({ competitor, result }) => (
          <CompetitorRow key={competitor.id} competitor={competitor} result={result}
                          runStatus={status}/>
        ))}
      </div>

      {/* Summary counts */}
      {done && (
        <div className="grid grid-cols-4 gap-3 mb-5 text-center">
          <Tile label="Found" value={foundCount} tone="emerald"/>
          <Tile label="Not found" value={notFound} tone="amber"/>
          <Tile label="Errors" value={errored} tone="red"/>
          <Tile label="Skipped" value={skipped} tone="ink" hint="already linked"/>
        </div>
      )}

      {pollError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg text-red-800 text-[12.5px]">
          Failed to poll job status: {pollError}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 pt-4 border-t border-ink-100">
        <div className="text-[11px] text-ink-500">
          {done ? 'Job finished. Newly-found URLs will scrape on the next tick.' : 'You can close this — the job continues in the background.'}
        </div>
        <div className="flex gap-2">
          {done && foundCount > 0 && (
            <NavLink to="/matches" onClick={onClose}>
              <Button variant="gold">
                Review matches <ArrowRight size={14}/>
              </Button>
            </NavLink>
          )}
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  )
}

function CompetitorRow({ competitor, result, runStatus }) {
  const status = result?.status || (runStatus === 'queued' ? 'queued' : 'searching')
  const icon = {
    queued:    <Clock size={13} className="text-ink-400"/>,
    searching: <Loader2 size={13} className="animate-spin text-brand-600"/>,
    found:     <CheckCircle2 size={13} className="text-emerald-700"/>,
    not_found: <XCircle size={13} className="text-amber-700"/>,
    error:     <XCircle size={13} className="text-red-700"/>,
    skipped:   <Clock size={13} className="text-ink-500"/>,
  }[status] || <Search size={13} className="text-ink-400"/>

  const label = {
    queued:    'Queued — waiting for tick',
    searching: 'Searching…',
    found:     'Match found',
    not_found: 'No product page found',
    error:     result?.error || 'Error',
    skipped:   result?.reason || 'Already linked',
  }[status] || 'Unknown'

  const border = status === 'found' ? 'border-emerald-200 bg-emerald-50/40' :
                 status === 'not_found' ? 'border-amber-200 bg-amber-50/40' :
                 status === 'error' ? 'border-red-200 bg-red-50/40' :
                 status === 'skipped' ? 'border-ink-200 bg-ink-50' :
                 'border-ink-100 bg-white'

  return (
    <div className={`flex items-start gap-3 border rounded-lg px-3.5 py-2.5 ${border}`}>
      <div className="flex-shrink-0 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-ink-900">{competitor.name}</div>
        <div className="text-[11px] text-ink-500 mt-0.5">{label}</div>
        {result?.url && (
          <a href={result.url} target="_blank" rel="noopener noreferrer"
             className="text-[11px] font-mono text-brand-700 hover:underline inline-flex items-center gap-1 mt-1 break-all">
            <span className="truncate max-w-[500px]">{result.url}</span>
            <ExternalLink size={9} className="flex-shrink-0"/>
          </a>
        )}
        {result?.strategy && (
          <div className="text-[10px] text-ink-400 mt-0.5">via {result.strategy}</div>
        )}
      </div>
    </div>
  )
}

function Tile({ label, value, tone = 'ink', hint }) {
  const tones = {
    emerald: 'text-emerald-800 bg-emerald-50 border-emerald-100',
    amber:   'text-amber-800 bg-amber-50 border-amber-100',
    red:     'text-red-800 bg-red-50 border-red-100',
    ink:     'text-ink-800 bg-ink-100 border-ink-200',
  }
  return (
    <div className={`rounded-lg border py-2 ${tones[tone]}`}>
      <div className="font-display text-[22px] tabular-nums leading-none">{value}</div>
      <div className="text-[10px] uppercase tracking-wider font-semibold opacity-80 mt-1">{label}</div>
      {hint && <div className="text-[10px] opacity-70 mt-0.5">{hint}</div>}
    </div>
  )
}
