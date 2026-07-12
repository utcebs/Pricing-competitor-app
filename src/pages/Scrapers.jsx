import { useState, useEffect, useMemo } from 'react'
import {
  Play, RefreshCw, CheckCircle2, Clock, XCircle, ExternalLink,
  Zap, Activity, Loader2,
} from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useTable } from '../lib/db'
import { useAuth } from '../lib/auth'
import {
  PageHeader, Card, Button, Empty, LoadingBlock, ErrorBlock, Badge,
} from '../components/UI'

export default function Scrapers() {
  const { isManager, user } = useAuth()
  const { rows: competitors, loading: cLoading } = useTable('competitors', { eq: ['is_active', true], order: ['name', { ascending: true }] })
  const { rows: runs, loading: rLoading, error, refresh } =
    useTable('scrape_runs', { order: ['created_at', { ascending: false }], limit: 50 })
  const { rows: cps } = useTable('competitor_products')

  const [runningId, setRunningId] = useState(null)
  const [msg, setMsg] = useState('')
  const [jobsByRun, setJobsByRun] = useState({})  // { run_id: [scrape_jobs...] }

  // Expected total URLs per competitor (all active competitor_products).
  const expectedByCompetitor = useMemo(() => {
    const m = {}
    for (const cp of cps) {
      if (!cp.is_active && cp.is_active !== undefined) continue
      m[cp.competitor_id] = (m[cp.competitor_id] || 0) + 1
    }
    return m
  }, [cps])

  const hasActiveRuns = runs.some(r => r.status === 'queued' || r.status === 'running')

  // Fetch scrape_jobs for each queued/running run so we can show real progress.
  useEffect(() => {
    const activeIds = runs.filter(r => r.status === 'running').map(r => r.id)
    if (activeIds.length === 0) { setJobsByRun({}); return }
    let cancelled = false
    const fetchJobs = async () => {
      const { data } = await supabase
        .from('scrape_jobs')
        .select('scrape_run_id, status')
        .in('scrape_run_id', activeIds)
      if (cancelled) return
      const grouped = {}
      for (const j of (data || [])) {
        grouped[j.scrape_run_id] = grouped[j.scrape_run_id] || []
        grouped[j.scrape_run_id].push(j)
      }
      setJobsByRun(grouped)
    }
    fetchJobs()
    const id = setInterval(fetchJobs, 3000)
    return () => { cancelled = true; clearInterval(id) }
  }, [runs.map(r => r.id + r.status).join(',')])

  // Auto-refresh the runs list while anything is active.
  useEffect(() => {
    if (!hasActiveRuns) return
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [hasActiveRuns, refresh])

  const trigger = async (competitor_id) => {
    setRunningId(competitor_id); setMsg('')
    const { error } = await supabase.from('scrape_runs').insert({
      competitor_id,
      status: 'queued',
      triggered_by: user?.id,
      triggered_kind: 'manual',
    })
    setRunningId(null)
    if (error) { setMsg('Failed to queue: ' + error.message); return }
    setMsg('Queued. Next tick picks it up within 5 minutes.')
    refresh()
  }

  const compById = Object.fromEntries(competitors.map(c => [c.id, c]))
  const workerHealth = getWorkerHealth(runs)

  return (
    <div>
      <PageHeader
        kicker="Automation"
        title="Scrapers"
        subtitle="Trigger manual scrape runs. A background worker in GitHub Actions polls the queue every 5 minutes and hits each competitor URL via Playwright."
      />

      {/* Worker health strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <HealthTile
          icon={Activity}
          label="Worker status"
          value={workerHealth.status}
          tone={workerHealth.tone}
          hint={workerHealth.hint}
          pulse={workerHealth.tone === 'emerald'}
        />
        <HealthTile
          icon={Zap}
          label="Last tick activity"
          value={workerHealth.lastRun}
          tone="ink"
          hint={workerHealth.lastRunHint}
        />
        <HealthTile
          icon={Clock}
          label="Next expected tick"
          value={workerHealth.nextTick}
          tone="ink"
          hint="Cron: */5 * * * *"
        />
      </div>

      {/* Active-runs prominent panel */}
      {hasActiveRuns && (
        <Card className="mb-6 border-brand-200 shadow-card-lg overflow-hidden">
          <div className="px-6 py-4 bg-brand-50/60 border-b border-brand-100 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-brand-500 text-white flex items-center justify-center">
              <Loader2 size={15} className="animate-spin" />
            </div>
            <div>
              <div className="font-display text-[16px] tracking-tight text-ink-900">Live activity</div>
              <div className="text-[11.5px] text-ink-500 mt-0.5">Auto-refreshing every few seconds</div>
            </div>
          </div>
          <div className="divide-y divide-ink-100">
            {runs
              .filter(r => r.status === 'queued' || r.status === 'running')
              .map(r => (
                <ActiveRunRow
                  key={r.id}
                  run={r}
                  competitor={compById[r.competitor_id]}
                  jobs={jobsByRun[r.id] || []}
                  expected={expectedByCompetitor[r.competitor_id] || 0}
                />
              ))}
          </div>
        </Card>
      )}

      <ErrorBlock error={error} onRetry={refresh} />

      {isManager && (
        <Card className="p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display text-[18px] tracking-tight text-ink-900">Trigger a scrape</h3>
              <p className="text-[12.5px] text-ink-500 mt-1">Click a competitor to queue all its linked product URLs. Runs land within 5 minutes.</p>
            </div>
            <a href="https://github.com/utcebs/Pricing-competitor-app/actions/workflows/worker-tick.yml"
              target="_blank" rel="noopener noreferrer"
              className="text-[11.5px] text-ink-500 hover:text-brand-700 inline-flex items-center gap-1">
              View live worker <ExternalLink size={11} />
            </a>
          </div>

          {cLoading ? <LoadingBlock /> : competitors.length === 0 ? (
            <Empty icon={Play} title="No competitors configured"
              description="Add competitors first, then link product URLs to them, then trigger scrapes here." />
          ) : (
            <div className="flex flex-wrap gap-2">
              {competitors.map(c => {
                const linked = expectedByCompetitor[c.id] || 0
                return (
                  <Button key={c.id} variant="secondary" busy={runningId === c.id}
                    onClick={() => trigger(c.id)} disabled={linked === 0}>
                    <Play size={13} /> {c.name}
                    <span className={`ml-1 text-[10px] ${linked === 0 ? 'text-red-500' : 'text-ink-400'}`}>
                      {linked === 0 ? '0 URLs' : `${linked} URL${linked === 1 ? '' : 's'}`}
                    </span>
                  </Button>
                )
              })}
            </div>
          )}
          {msg && (
            <div className="mt-4 text-[12.5px] px-3 py-2 bg-brand-50 border border-brand-100 rounded-lg text-brand-800">
              {msg}
            </div>
          )}
        </Card>
      )}

      <Card>
        <div className="px-6 py-4 border-b border-ink-100 flex items-center justify-between">
          <h3 className="font-display text-[18px] tracking-tight text-ink-900">Recent runs</h3>
          <button onClick={refresh} className="text-ink-400 hover:text-ink-800 p-1.5 rounded-lg hover:bg-ink-100">
            <RefreshCw size={14} />
          </button>
        </div>
        {rLoading ? <LoadingBlock /> : runs.length === 0 ? (
          <Empty icon={Play} title="No scrape runs yet" description="Queue one above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-canvas-100 border-b border-ink-200">
                <tr>
                  <Th>Status</Th><Th>Competitor</Th><Th>Trigger</Th>
                  <Th className="text-right">Scraped</Th><Th className="text-right">Failed</Th>
                  <Th>Started</Th><Th>Finished</Th><Th className="text-right">Duration</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {runs.map(r => {
                  const dur = r.finished_at && r.started_at
                    ? Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 1000)
                    : null
                  return (
                    <tr key={r.id} className="hover:bg-canvas-100/60 transition-colors">
                      <Td><StatusBadge status={r.status} /></Td>
                      <Td className="font-medium">{compById[r.competitor_id]?.name || `#${r.competitor_id}`}</Td>
                      <Td className="text-ink-500 text-xs capitalize">{r.triggered_kind}</Td>
                      <Td className="text-right tabular-nums font-medium text-ink-800">{r.items_scraped ?? 0}</Td>
                      <Td className="text-right tabular-nums text-red-700">{r.items_failed ?? 0}</Td>
                      <Td className="text-ink-500 text-xs">{fmtDateTime(r.started_at)}</Td>
                      <Td className="text-ink-500 text-xs">{fmtDateTime(r.finished_at)}</Td>
                      <Td className="text-right text-ink-500 text-xs tabular-nums">{dur != null ? `${dur}s` : '—'}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

/* ── Live-run row with progress bar ────────────────────── */
function ActiveRunRow({ run, competitor, jobs, expected }) {
  const done = jobs.length
  // If we don't know expected yet, show indeterminate.
  const total = Math.max(expected, done, 1)
  const pct = expected > 0 ? Math.min(100, Math.round((done / total) * 100)) : null
  const ok      = jobs.filter(j => j.status === 'ok').length
  const failed  = jobs.filter(j => j.status === 'error' || j.status === 'blocked' || j.status === 'not_found').length

  const isQueued = run.status === 'queued'
  const startedAt = run.started_at ? new Date(run.started_at) : null
  const elapsed = startedAt ? Math.round((Date.now() - startedAt.getTime()) / 1000) : null

  return (
    <div className="px-6 py-4">
      <div className="flex items-center justify-between mb-2 gap-4">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold text-ink-900 truncate">
            {competitor?.name || `Competitor #${run.competitor_id}`}
          </div>
          <div className="text-[11px] text-ink-500 mt-0.5 flex items-center gap-2">
            <StatusBadge status={run.status} />
            {isQueued ? (
              <span>Waiting for next tick (up to 5 min)</span>
            ) : (
              <>
                <span>Running for {elapsed ?? 0}s</span>
                {expected > 0 && <span>· {done} of {expected} URLs done</span>}
                {(ok > 0 || failed > 0) && (
                  <span>·
                    <span className="text-emerald-700 font-medium ml-1">{ok} ok</span>
                    {failed > 0 && <span className="text-red-700 font-medium ml-1">· {failed} fail</span>}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          {isQueued
            ? <div className="text-[11px] text-ink-400 tabular-nums">—</div>
            : pct != null
              ? <div className="font-display text-[22px] leading-none tabular-nums text-ink-900">{pct}%</div>
              : <div className="text-[11px] text-ink-400">counting…</div>}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 rounded-full bg-ink-100 overflow-hidden relative">
        {isQueued ? (
          <div className="h-full w-1/4 bg-brand-300/60 animate-pulse" />
        ) : pct != null ? (
          <div
            className="h-full bg-gradient-to-r from-brand-500 to-brand-600 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div className="h-full w-full bg-brand-200 animate-pulse" />
        )}
      </div>
    </div>
  )
}

function HealthTile({ icon: Icon, label, value, hint, tone = 'ink', pulse = false }) {
  const tones = {
    ink:     'bg-ink-100 text-ink-700 border-ink-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    red:     'bg-red-50 text-red-700 border-red-100',
    amber:   'bg-amber-50 text-amber-800 border-amber-100',
  }
  return (
    <Card className="p-5 flex items-start gap-4 relative overflow-hidden">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${tones[tone]} relative`}>
        <Icon size={17} strokeWidth={2} />
        {pulse && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-ink-500">{label}</div>
        <div className="font-display text-[19px] tracking-tight text-ink-900 mt-1 leading-tight">{value}</div>
        {hint && <div className="text-[11px] text-ink-500 mt-1">{hint}</div>}
      </div>
    </Card>
  )
}

function getWorkerHealth(runs) {
  const active = runs.find(r => r.status !== 'queued' && r.started_at)

  if (!active) {
    return {
      status: 'Awaiting first tick',
      tone: 'amber',
      hint: 'Queue a scrape, then wait 5 minutes.',
      lastRun: '—',
      lastRunHint: 'No completed runs yet.',
      nextTick: 'Within 5 min',
    }
  }

  const lastTime = new Date(active.started_at)
  const nowMs = Date.now()
  const ageMin = Math.round((nowMs - lastTime.getTime()) / 60_000)

  const nowD = new Date()
  const nextMin = Math.ceil(nowD.getMinutes() / 5) * 5
  const nextD = new Date(nowD)
  nextD.setSeconds(0); nextD.setMilliseconds(0)
  if (nextMin === nowD.getMinutes()) nextD.setMinutes(nextMin + 5)
  else nextD.setMinutes(nextMin)
  const nextIn = Math.max(1, Math.round((nextD.getTime() - nowMs) / 60_000))

  return {
    status: ageMin <= 10 ? 'Healthy' : ageMin <= 30 ? 'Idle' : 'Stale',
    tone:   ageMin <= 10 ? 'emerald' : ageMin <= 30 ? 'ink' : 'amber',
    hint:   ageMin <= 10 ? 'Ticking on schedule.' : `Last activity ${ageMin} min ago.`,
    lastRun: relTime(lastTime),
    lastRunHint: `${lastTime.toLocaleString()}`,
    nextTick: `in ~${nextIn} min`,
  }
}

function StatusBadge({ status }) {
  const map = {
    queued:    { variant: 'slate', icon: Clock,        label: 'Queued'    },
    running:   { variant: 'amber', icon: RefreshCw,    label: 'Running'   },
    completed: { variant: 'green', icon: CheckCircle2, label: 'Completed' },
    failed:    { variant: 'red',   icon: XCircle,      label: 'Failed'    },
    cancelled: { variant: 'slate', icon: XCircle,      label: 'Cancelled' },
  }
  const m = map[status] || map.queued
  const Icon = m.icon
  return <Badge variant={m.variant}><Icon size={10} className="mr-1" /> {m.label}</Badge>
}

function relTime(d) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
}

function Th({ children, className = '' }) {
  return <th className={`px-4 py-3 text-left text-[10px] font-semibold text-ink-500 uppercase tracking-[0.12em] ${className}`}>{children}</th>
}
function Td({ children, className = '' }) {
  return <td className={`px-4 py-3.5 text-sm text-ink-800 ${className}`}>{children}</td>
}
