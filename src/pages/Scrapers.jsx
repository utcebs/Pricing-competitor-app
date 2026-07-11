import { useState } from 'react'
import { Play, RefreshCw, AlertCircle, CheckCircle2, Clock, XCircle } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useTable } from '../lib/db'
import { useAuth } from '../lib/auth'
import {
  PageHeader, Card, Button, Empty, LoadingBlock, ErrorBlock, Badge, selectCls,
} from '../components/UI'

/**
 * Scrapers — trigger a scrape run for a competitor + view history.
 *
 * Phase 2 STATUS: this UI creates a `scrape_runs` row with status='queued'.
 * The worker deployed on Railway polls this table and consumes queued runs.
 * The worker code lives in the /worker directory of this repo.
 *
 * Without the worker deployed, queued runs will sit forever. That's OK for
 * the frontend demo — the UI shape is complete.
 */
export default function Scrapers() {
  const { isManager, user } = useAuth()
  const { rows: competitors, loading: cLoading } = useTable('competitors', { eq: ['is_active', true], order: ['name', { ascending: true }] })
  const { rows: runs, loading: rLoading, error, refresh } =
    useTable('scrape_runs', { order: ['created_at', { ascending: false }], limit: 50 })

  const [runningId, setRunningId] = useState(null)
  const [msg, setMsg] = useState('')

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
    setMsg('Queued. Worker will pick it up within 60 seconds (if deployed).')
    refresh()
  }

  const compById = Object.fromEntries(competitors.map(c => [c.id, c]))

  return (
    <div>
      <PageHeader
        title="Scrapers"
        subtitle="Trigger manual scrape runs and monitor status. Automated scheduling via cron on the worker."
      />

      <ErrorBlock error={error} onRetry={refresh} />

      {isManager && (
        <Card className="p-6 mb-4">
          <h3 className="text-sm font-semibold text-ink-800 mb-3">Queue a scrape</h3>
          <div className="text-xs text-ink-500 mb-4 p-3 bg-amber-50 border border-amber-100 rounded-lg">
            <AlertCircle size={13} className="inline mr-1.5 text-amber-600 -mt-0.5" />
            Requires the Playwright worker to be deployed (see <code className="bg-white px-1 rounded">worker/README.md</code>).
            Without it, queued runs will stay queued indefinitely.
          </div>
          {cLoading ? <LoadingBlock /> : (
            <div className="flex flex-wrap gap-2">
              {competitors.map(c => (
                <Button key={c.id} variant="secondary" busy={runningId === c.id}
                  onClick={() => trigger(c.id)}>
                  <Play size={13} /> {c.name}
                </Button>
              ))}
            </div>
          )}
          {msg && <div className="mt-3 text-xs text-ink-600">{msg}</div>}
        </Card>
      )}

      <Card>
        <div className="px-6 py-4 border-b border-ink-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-800">Recent runs</h3>
          <button onClick={refresh} className="text-ink-400 hover:text-ink-700">
            <RefreshCw size={15} />
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
                  <Th>Started</Th><Th>Finished</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {runs.map(r => (
                  <tr key={r.id} className="hover:bg-canvas-100">
                    <Td><StatusBadge status={r.status} /></Td>
                    <Td>{compById[r.competitor_id]?.name || `#${r.competitor_id}`}</Td>
                    <Td className="text-ink-500 text-xs capitalize">{r.triggered_kind}</Td>
                    <Td className="text-right tabular-nums">{r.items_scraped ?? 0}</Td>
                    <Td className="text-right tabular-nums text-red-600">{r.items_failed ?? 0}</Td>
                    <Td className="text-ink-500 text-xs">{r.started_at ? new Date(r.started_at).toLocaleString() : '—'}</Td>
                    <Td className="text-ink-500 text-xs">{r.finished_at ? new Date(r.finished_at).toLocaleString() : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
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
  return <Badge variant={m.variant}><Icon size={11} className="mr-1" /> {m.label}</Badge>
}

function Th({ children, className = '' }) { return <th className={`px-4 py-2.5 text-left text-[10px] font-semibold text-ink-500 uppercase tracking-wider ${className}`}>{children}</th> }
function Td({ children, className = '' }) { return <td className={`px-4 py-3 text-sm text-ink-700 ${className}`}>{children}</td> }
