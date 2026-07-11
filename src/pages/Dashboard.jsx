import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Package, Building2, Link2, LineChart, Bell, Repeat, DollarSign, FileBarChart,
  Sparkles, Play, Settings2, Check, X as XIcon,
} from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../lib/auth'
import { PageHeader, Card, Button, LoadingBlock, Modal, Field, selectCls } from '../components/UI'

/**
 * Dashboard — configurable widgets. Users pick which stat cards they
 * want and can reorder them. Config is stored in profiles.dashboard_config.
 *
 * Available widget kinds (extendable):
 *   'stat' — single number from a supabase count()
 *   'recent_prices' — table of the 10 latest price snapshots
 *   'pending_alerts' — count of pending alert_deliveries
 *   'pending_proposals' — count of pending pricing_proposals
 *   'match_backlog' — count of unreviewed match_suggestions
 *   'quick_actions' — the quick action list
 *   'roadmap' — the phase status card
 */

const AVAILABLE = [
  { id: 'stat.products',            label: 'Total products',        kind: 'stat', icon: Package,      table: 'products' },
  { id: 'stat.competitors',         label: 'Total competitors',     kind: 'stat', icon: Building2,    table: 'competitors' },
  { id: 'stat.cps',                 label: 'Linked items',          kind: 'stat', icon: Link2,        table: 'competitor_products' },
  { id: 'stat.prices',              label: 'Price snapshots',       kind: 'stat', icon: LineChart,    table: 'price_history' },
  { id: 'stat.pending_alerts',      label: 'Alerts waiting',        kind: 'stat', icon: Bell,         table: 'alert_deliveries', filter: ['delivery_status', 'pending'] },
  { id: 'stat.pending_proposals',   label: 'Proposals waiting',     kind: 'stat', icon: Repeat,       table: 'pricing_proposals', filter: ['status', 'pending'] },
  { id: 'stat.match_backlog',       label: 'Match suggestions',     kind: 'stat', icon: Sparkles,     table: 'match_suggestions', filter: ['reviewed', false] },
  { id: 'panel.recent_prices',      label: 'Recent price snapshots', kind: 'panel' },
  { id: 'panel.quick_actions',      label: 'Quick actions',          kind: 'panel' },
  { id: 'panel.roadmap',            label: 'Roadmap status',         kind: 'panel' },
]

const DEFAULT_CONFIG = {
  widgets: [
    'stat.products', 'stat.competitors', 'stat.cps', 'stat.prices',
    'panel.recent_prices', 'panel.quick_actions', 'panel.roadmap',
  ],
}

export default function Dashboard() {
  const { user, profile } = useAuth()
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [counts, setCounts] = useState({})
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCustomize, setShowCustomize] = useState(false)

  useEffect(() => {
    if (profile?.dashboard_config?.widgets?.length) setConfig(profile.dashboard_config)
  }, [profile?.id])

  useEffect(() => {
    (async () => {
      setLoading(true)
      const enabled = config.widgets.map(id => AVAILABLE.find(w => w.id === id)).filter(Boolean)
      const statWidgets = enabled.filter(w => w.kind === 'stat')

      const countPromises = statWidgets.map(w => {
        let q = supabase.from(w.table).select('*', { count: 'exact', head: true })
        if (w.filter) q = q.eq(w.filter[0], w.filter[1])
        return q.then(r => [w.id, r.count || 0])
      })
      const results = await Promise.all(countPromises)
      setCounts(Object.fromEntries(results))

      if (config.widgets.includes('panel.recent_prices')) {
        const { data } = await supabase
          .from('price_history')
          .select('id, price, currency_code, captured_at, competitor_products(name, competitors(name))')
          .order('captured_at', { ascending: false })
          .limit(10)
        setRecent(data || [])
      }
      setLoading(false)
    })()
  }, [config.widgets.join(',')])

  const save = async (newConfig) => {
    setConfig(newConfig)
    await supabase.from('profiles')
      .update({ dashboard_config: newConfig })
      .eq('id', user.id)
  }

  if (loading) return <LoadingBlock />

  const statList = config.widgets.filter(id => id.startsWith('stat.'))
  const panelList = config.widgets.filter(id => id.startsWith('panel.'))

  return (
    <div>
      <PageHeader
        title={`Welcome back${profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}`}
        subtitle="All 5 phases live. Customize this dashboard with the button on the right."
        action={<Button variant="secondary" onClick={() => setShowCustomize(true)}><Settings2 size={14} /> Customize</Button>}
      />

      {/* Stat cards row */}
      {statList.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {statList.map(id => {
            const w = AVAILABLE.find(x => x.id === id); if (!w) return null
            return <StatCard key={id} widget={w} value={counts[id] ?? '—'} />
          })}
        </div>
      )}

      {/* Panel widgets */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {panelList.map(id => {
          if (id === 'panel.recent_prices') return <RecentPricesPanel key={id} recent={recent} />
          if (id === 'panel.quick_actions')  return <QuickActionsPanel key={id} />
          if (id === 'panel.roadmap')        return <RoadmapPanel key={id} />
          return null
        })}
      </div>

      <CustomizeDialog
        open={showCustomize}
        onClose={() => setShowCustomize(false)}
        current={config}
        onSave={c => { save(c); setShowCustomize(false) }}
      />
    </div>
  )
}

function StatCard({ widget, value }) {
  const Icon = widget.icon
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md transition-all">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">{widget.label}</span>
        <Icon size={18} className="text-slate-400" />
      </div>
      <div className="text-3xl font-bold text-slate-900 tabular-nums">{value}</div>
    </div>
  )
}

function RecentPricesPanel({ recent }) {
  return (
    <div className="lg:col-span-2">
      <Card className="p-6">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Recent price snapshots</h3>
        {recent.length === 0 ? (
          <p className="text-sm text-slate-500 py-4">
            No prices logged yet. <Link to="/prices/new" className="text-brand-600 hover:underline">Log the first one →</Link>
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {recent.map(r => (
              <div key={r.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <div className="font-medium text-slate-800">{r.competitor_products?.name || 'Untitled'}</div>
                  <div className="text-xs text-slate-500">
                    {r.competitor_products?.competitors?.name || '—'} · {new Date(r.captured_at).toLocaleString()}
                  </div>
                </div>
                <div className="tabular-nums font-medium text-slate-900">
                  {r.currency_code} {Number(r.price).toFixed(3)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function QuickActionsPanel() {
  return (
    <Card className="p-6">
      <h3 className="text-sm font-semibold text-slate-800 mb-4">Quick actions</h3>
      <div className="space-y-2">
        <QuickLink to="/products" label="Add a product" icon={Package} />
        <QuickLink to="/competitors" label="Add a competitor" icon={Building2} />
        <QuickLink to="/competitor-products" label="Link a product" icon={Link2} />
        <QuickLink to="/prices/new" label="Log a price" icon={DollarSign} />
        <QuickLink to="/reports" label="Build a report" icon={FileBarChart} />
        <QuickLink to="/scrapers" label="Trigger a scrape" icon={Play} />
      </div>
    </Card>
  )
}

function QuickLink({ to, label, icon: Icon }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 transition-colors group">
      <Icon size={14} className="text-slate-400 group-hover:text-brand-600" />
      <span className="text-sm text-slate-800 group-hover:text-brand-700 font-medium">{label}</span>
      <span className="ml-auto text-slate-400 group-hover:text-brand-600">→</span>
    </Link>
  )
}

function RoadmapPanel() {
  return (
    <Card className="p-6">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">All phases</div>
      <div className="space-y-1 text-xs text-slate-600">
        {[
          ['1', 'MVP · manual entry'],
          ['2', 'Playwright scrapers'],
          ['3', 'Matching + email alerts'],
          ['4', 'Custom reports'],
          ['5', 'Repricing + Dynamics 365'],
        ].map(([n, label]) => (
          <div key={n} className="flex items-center gap-2">
            <div className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold bg-emerald-100 text-emerald-700">✓</div>
            <span className="text-slate-800">{label}</span>
          </div>
        ))}
      </div>
      <div className="text-[10px] text-slate-500 mt-3 pt-3 border-t border-slate-100">
        Worker deploys separately — see <code>worker/README.md</code>.
      </div>
    </Card>
  )
}

function CustomizeDialog({ open, onClose, current, onSave }) {
  const [selected, setSelected] = useState(current.widgets)
  useEffect(() => { if (open) setSelected(current.widgets) }, [open, current])
  const toggle = id => setSelected(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  )
  const move = (id, dir) => {
    const i = selected.indexOf(id); if (i < 0) return
    const j = i + dir; if (j < 0 || j >= selected.length) return
    const next = [...selected]; [next[i], next[j]] = [next[j], next[i]]
    setSelected(next)
  }
  return (
    <Modal open={open} onClose={onClose} title="Customize dashboard" wide>
      <p className="text-xs text-slate-500 mb-4">
        Toggle widgets on/off and use ↑↓ to reorder. Changes save to your profile.
      </p>
      <div className="space-y-2">
        {AVAILABLE.map(w => {
          const on = selected.includes(w.id)
          const pos = selected.indexOf(w.id)
          return (
            <div key={w.id} className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg">
              <button onClick={() => toggle(w.id)}
                className={`w-6 h-6 rounded flex items-center justify-center ${on ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                {on ? <Check size={13} /> : <XIcon size={13} />}
              </button>
              <span className="text-[10px] uppercase tracking-widest text-slate-400 w-14">{w.kind}</span>
              <div className="flex-1 text-sm">{w.label}</div>
              {on && (
                <div className="flex items-center gap-1">
                  <button onClick={() => move(w.id, -1)} disabled={pos <= 0} className="text-xs text-slate-500 hover:text-slate-800 disabled:opacity-30 px-1.5">↑</button>
                  <button onClick={() => move(w.id, 1)}  disabled={pos >= selected.length - 1} className="text-xs text-slate-500 hover:text-slate-800 disabled:opacity-30 px-1.5">↓</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-100">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onSave({ widgets: selected })}>Save</Button>
      </div>
    </Modal>
  )
}
