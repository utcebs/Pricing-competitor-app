import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Package, Building2, Link2, LineChart, TrendingUp, TrendingDown } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../lib/auth'
import { PageHeader, Card, LoadingBlock, Badge } from '../components/UI'

/**
 * Dashboard — Phase 1 numbers. Simple counts, no charts yet.
 * Once we have a couple hundred price rows we can add trend widgets.
 */
export default function Dashboard() {
  const { profile } = useAuth()
  const [counts, setCounts] = useState(null)
  const [recentPrices, setRecentPrices] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const [prod, comp, cp, ph, sh] = await Promise.all([
        supabase.from('products').select('*', { count: 'exact', head: true }),
        supabase.from('competitors').select('*', { count: 'exact', head: true }),
        supabase.from('competitor_products').select('*', { count: 'exact', head: true }),
        supabase.from('price_history').select('*', { count: 'exact', head: true }),
        supabase.from('stock_history').select('*', { count: 'exact', head: true }),
      ])
      const { data: recent } = await supabase
        .from('price_history')
        .select('id, price, currency_code, captured_at, competitor_products(name, competitors(name))')
        .order('captured_at', { ascending: false })
        .limit(10)
      setCounts({
        products: prod.count || 0,
        competitors: comp.count || 0,
        cps: cp.count || 0,
        prices: ph.count || 0,
        stock: sh.count || 0,
      })
      setRecentPrices(recent || [])
      setLoading(false)
    })()
  }, [])

  if (loading) return <LoadingBlock />

  return (
    <div>
      <PageHeader
        title={`Welcome back${profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}`}
        subtitle="Phase 1 · Manual entry. Scrapers arrive in Phase 2."
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={Package}      label="Products"      value={counts.products}
          href="/products"    tint="brand"
        />
        <StatCard
          icon={Building2}    label="Competitors"   value={counts.competitors}
          href="/competitors" tint="cyan"
        />
        <StatCard
          icon={Link2}        label="Linked items"  value={counts.cps}
          href="/competitor-products" tint="amber"
        />
        <StatCard
          icon={LineChart}    label="Price points"  value={counts.prices}
          href="/prices"      tint="green"
        />
      </div>

      {/* Two columns: recent activity + quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card className="p-6">
            <h3 className="text-sm font-semibold text-slate-800 mb-4">Recent price snapshots</h3>
            {recentPrices.length === 0 ? (
              <p className="text-sm text-slate-500 py-4">
                No prices logged yet. Head to <Link to="/prices/new" className="text-brand-600 hover:underline">Log a Price</Link> to add the first one.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {recentPrices.map(r => (
                  <div key={r.id} className="flex items-center justify-between py-2.5 text-sm">
                    <div>
                      <div className="font-medium text-slate-800">
                        {r.competitor_products?.name || 'Untitled'}
                      </div>
                      <div className="text-xs text-slate-500">
                        {r.competitor_products?.competitors?.name || '—'} ·{' '}
                        {new Date(r.captured_at).toLocaleString()}
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

        <div>
          <Card className="p-6">
            <h3 className="text-sm font-semibold text-slate-800 mb-4">Quick actions</h3>
            <div className="space-y-2">
              <QuickLink to="/products" label="Add a product" hint="Your catalogue" />
              <QuickLink to="/competitors" label="Add a competitor" hint="Track a new site" />
              <QuickLink to="/competitor-products" label="Link a product" hint="Their URL ↔ your SKU" />
              <QuickLink to="/prices/new" label="Log a price" hint="Manual entry" />
              <QuickLink to="/prices" label="See trends" hint="Chart over time" />
            </div>
          </Card>

          <Card className="p-6 mt-4">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">Roadmap</div>
            <div className="space-y-1 text-xs text-slate-600">
              <RoadmapLine phase="1" text="MVP · manual entry"    done />
              <RoadmapLine phase="2" text="Playwright scrapers"   />
              <RoadmapLine phase="3" text="Matching + email alerts" />
              <RoadmapLine phase="4" text="Custom reports"        />
              <RoadmapLine phase="5" text="Repricing + Dynamics 365" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, href, tint }) {
  const tints = {
    brand: 'from-brand-50 to-white text-brand-700',
    cyan:  'from-cyan-50 to-white text-cyan-700',
    amber: 'from-amber-50 to-white text-amber-700',
    green: 'from-emerald-50 to-white text-emerald-700',
  }
  return (
    <Link to={href} className={`block bg-gradient-to-br ${tints[tint]} border border-slate-200 rounded-2xl p-5 hover:shadow-md hover:border-slate-300 transition-all`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest">{label}</span>
        <Icon size={18} className="opacity-60" />
      </div>
      <div className="text-3xl font-bold text-slate-900 tabular-nums">{value}</div>
    </Link>
  )
}

function QuickLink({ to, label, hint }) {
  return (
    <Link to={to} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-slate-50 transition-colors group">
      <div>
        <div className="text-sm font-medium text-slate-800 group-hover:text-brand-700">{label}</div>
        <div className="text-[11px] text-slate-500">{hint}</div>
      </div>
      <span className="text-slate-400 group-hover:text-brand-600">→</span>
    </Link>
  )
}

function RoadmapLine({ phase, text, done }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold ${done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
        {done ? '✓' : phase}
      </div>
      <span className={done ? 'text-slate-800' : 'text-slate-500'}>{text}</span>
    </div>
  )
}
