import { useState, useEffect, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Area, AreaChart,
} from 'recharts'
import {
  LineChart as LineIcon, TrendingUp, TrendingDown, Activity,
  ArrowUpRight, ArrowDownRight, Minus, ExternalLink,
} from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useTable } from '../lib/db'
import {
  PageHeader, Card, Empty, LoadingBlock, ErrorBlock, Badge, selectCls,
} from '../components/UI'

// Warm sophisticated palette — each competitor gets a stable line colour
const COMPETITOR_COLORS = ['#b1863a', '#0f766e', '#7c2d12', '#4c1d95', '#0369a1', '#65a30d', '#a21caf', '#c2410c']

export default function PriceTrends() {
  const { rows: products, loading: pL } = useTable('products', { order: ['name', { ascending: true }] })
  const { rows: cps }                    = useTable('competitor_products')
  const { rows: competitors }            = useTable('competitors')
  const { rows: categories }             = useTable('categories')

  const [productId, setProductId] = useState('')
  const [rangeDays, setRangeDays] = useState(30)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const selectedProduct = useMemo(() => products.find(p => String(p.id) === productId), [products, productId])
  const myPrice = selectedProduct?.current_price != null ? Number(selectedProduct.current_price) : null
  const myMinPrice = selectedProduct?.min_price != null ? Number(selectedProduct.min_price) : null

  const linkedCps = useMemo(
    () => cps.filter(c => String(c.product_id) === productId),
    [cps, productId]
  )
  const compById = useMemo(() => Object.fromEntries(competitors.map(c => [c.id, c])), [competitors])
  const catById  = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories])

  // Pull price_history in range
  useEffect(() => {
    if (!productId || linkedCps.length === 0) { setHistory([]); return }
    const from = new Date()
    from.setDate(from.getDate() - rangeDays)
    setLoading(true); setErr('')
    supabase.from('price_history')
      .select('competitor_product_id, price, currency_code, captured_at')
      .in('competitor_product_id', linkedCps.map(c => c.id))
      .gte('captured_at', from.toISOString())
      .order('captured_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) setErr(error.message)
        else setHistory(data || [])
        setLoading(false)
      })
  }, [productId, linkedCps.map(l => l.id).join(','), rangeDays])

  // Per-competitor stats
  const competitorStats = useMemo(() => {
    const stats = new Map()
    for (const cp of linkedCps) {
      const rows = history.filter(h => h.competitor_product_id === cp.id).map(r => ({ p: Number(r.price), t: r.captured_at }))
      if (rows.length === 0) {
        stats.set(cp.id, { cp, competitor: compById[cp.competitor_id], count: 0 })
        continue
      }
      const prices = rows.map(r => r.p)
      const first = rows[0].p, last = rows[rows.length - 1].p
      const changePct = ((last - first) / first) * 100
      // Volatility = coefficient of variation
      const mean = prices.reduce((a, x) => a + x, 0) / prices.length
      const variance = prices.reduce((a, x) => a + (x - mean) ** 2, 0) / prices.length
      const stddev = Math.sqrt(variance)
      const cv = mean > 0 ? (stddev / mean) * 100 : 0
      // Change count = # of price changes
      let changes = 0
      for (let i = 1; i < rows.length; i++) if (rows[i].p !== rows[i - 1].p) changes++
      stats.set(cp.id, {
        cp,
        competitor: compById[cp.competitor_id],
        count: rows.length,
        first, last,
        min: Math.min(...prices),
        max: Math.max(...prices),
        mean,
        changePct,
        volatility: cv,
        changes,
        lastCapturedAt: rows[rows.length - 1].t,
      })
    }
    return [...stats.values()]
  }, [linkedCps, history, compById])

  const pricedCompetitors = competitorStats.filter(s => s.count > 0)
  const allPricesInRange = pricedCompetitors.flatMap(s => [s.min, s.max])
  const marketMin = allPricesInRange.length ? Math.min(...allPricesInRange) : null
  const marketMax = allPricesInRange.length ? Math.max(...allPricesInRange) : null
  const marketAvg = pricedCompetitors.length
    ? pricedCompetitors.reduce((a, s) => a + s.mean, 0) / pricedCompetitors.length
    : null

  const myPosition = (myPrice != null && marketMin != null)
    ? myPrice <= marketMin ? 'cheapest'
      : myPrice >= marketMax ? 'most expensive'
      : 'in the middle'
    : null

  // Rank position: what number are you if we sort all prices ascending?
  const positionRank = useMemo(() => {
    if (myPrice == null || pricedCompetitors.length === 0) return null
    const allWithMe = [{ label: 'you', value: myPrice }, ...pricedCompetitors.map(s => ({ label: s.competitor?.name, value: s.last }))]
    allWithMe.sort((a, b) => a.value - b.value)
    const idx = allWithMe.findIndex(x => x.label === 'you')
    return { idx: idx + 1, total: allWithMe.length }
  }, [myPrice, pricedCompetitors])

  // Reshape long → wide for the chart
  const { chartData, seriesKeys } = useMemo(() => {
    const byDay = new Map()
    const keys = new Set()
    history.forEach(row => {
      const day = row.captured_at.slice(0, 10)
      const cp = linkedCps.find(l => l.id === row.competitor_product_id)
      const label = cp ? (compById[cp.competitor_id]?.name || `Competitor ${cp.competitor_id}`) : `#${row.competitor_product_id}`
      keys.add(label)
      const bucket = byDay.get(day) || { date: day }
      bucket[label] = row.price
      byDay.set(day, bucket)
    })
    return {
      chartData: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
      seriesKeys: [...keys],
    }
  }, [history, linkedCps, compById])

  // Notable moves — from the raw history, spot single-competitor >2% jumps
  const notableMoves = useMemo(() => {
    const moves = []
    for (const cp of linkedCps) {
      const rows = history.filter(h => h.competitor_product_id === cp.id)
      for (let i = 1; i < rows.length; i++) {
        const a = Number(rows[i - 1].price), b = Number(rows[i].price)
        const pct = ((b - a) / a) * 100
        if (Math.abs(pct) >= 2) {
          moves.push({
            competitor: compById[cp.competitor_id]?.name || 'Unknown',
            from: a, to: b, pct,
            at: rows[i].captured_at,
          })
        }
      }
    }
    return moves.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 5)
  }, [linkedCps, history, compById])

  return (
    <div>
      <PageHeader
        kicker="Analysis"
        title="Price Trends"
        subtitle="Time-series view of every competitor's price movements next to yours. Pick a product to see the full picture."
      />

      {/* Selector strip */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <select className={`${selectCls} sm:w-[420px]`} value={productId} onChange={e => setProductId(e.target.value)}>
          <option value="">Select a product…</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
        </select>
        <select className={`${selectCls} sm:w-40`} value={rangeDays} onChange={e => setRangeDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
      </div>

      <ErrorBlock error={err} />

      {pL ? (
        <Card><LoadingBlock /></Card>
      ) : !productId ? (
        <Card>
          <Empty
            icon={LineIcon}
            title="Pick a product to analyse"
            description="Choose from the dropdown above. You'll see the full price story: KPIs, competitor benchmark, trend chart, notable moves, and volatility."
          />
        </Card>
      ) : linkedCps.length === 0 ? (
        <Card>
          <Empty
            icon={LineIcon}
            title="No competitor URLs linked to this product"
            description="Head to Linked Items and connect this product to competitor URLs first, then scrape at least once."
            action={<NavLink to="/competitor-products" className="text-brand-700 hover:underline text-sm font-medium">Manage links →</NavLink>}
          />
        </Card>
      ) : loading ? (
        <Card><LoadingBlock text="Loading price history" /></Card>
      ) : (
        <>
          {/* ── Product context header ─────────────────────── */}
          <div className="mb-6 p-6 rounded-2xl bg-gradient-to-br from-ink-900 via-ink-900 to-ink-800 text-white relative overflow-hidden">
            <div className="absolute inset-0 opacity-30 bg-grain pointer-events-none" />
            <div className="relative flex items-start justify-between gap-6 flex-wrap">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-brand-400 font-semibold mb-2">
                  {catById[selectedProduct?.category_id]?.name || 'Product'}
                </div>
                <h2 className="font-display text-[28px] leading-tight tracking-tightest text-white">
                  {selectedProduct?.name}
                </h2>
                <div className="text-[12px] text-ink-400 mt-1 font-mono tabular-nums flex items-center gap-3 flex-wrap">
                  <span>SKU {selectedProduct?.sku}</span>
                  {selectedProduct?.brand && <span>· {selectedProduct.brand}</span>}
                  <span>· {pricedCompetitors.length} of {linkedCps.length} competitor{linkedCps.length === 1 ? '' : 's'} priced</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-[0.2em] text-brand-400 font-semibold mb-1">Your Price</div>
                <div className="font-display text-[38px] leading-none tabular-nums text-white">
                  {myPrice != null ? `KD ${myPrice.toFixed(3)}` : '—'}
                </div>
                {myMinPrice != null && (
                  <div className="text-[11px] text-ink-400 mt-2">Floor KD {myMinPrice.toFixed(3)}</div>
                )}
              </div>
            </div>
          </div>

          {history.length === 0 ? (
            <Card>
              <Empty
                icon={LineIcon}
                title="No price snapshots in this range"
                description="Trigger a scrape on the Scrapers page, or extend the date range."
              />
            </Card>
          ) : (
            <>
              {/* ── KPI tiles ────────────────────────── */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <AnalyticTile
                  label="Market range"
                  value={marketMin != null ? `KD ${marketMin.toFixed(2)} – ${marketMax.toFixed(2)}` : '—'}
                  hint={marketMax != null ? `Spread of ${((marketMax - marketMin) / marketMin * 100).toFixed(1)}%` : ''}
                  icon={Activity}
                  tone="ink"
                />
                <AnalyticTile
                  label="Market average"
                  value={marketAvg != null ? `KD ${marketAvg.toFixed(3)}` : '—'}
                  hint={myPrice != null && marketAvg != null
                    ? `You are ${((myPrice - marketAvg) / marketAvg * 100).toFixed(1)}% ${myPrice > marketAvg ? 'above' : 'below'}` : ''}
                  icon={LineIcon}
                  tone={myPrice != null && marketAvg != null ? (myPrice > marketAvg * 1.02 ? 'red' : myPrice < marketAvg * 0.98 ? 'emerald' : 'ink') : 'ink'}
                />
                <AnalyticTile
                  label="Your position"
                  value={positionRank ? `#${positionRank.idx} of ${positionRank.total}` : '—'}
                  hint={myPosition ? `You're ${myPosition}` : 'No comparison yet'}
                  icon={myPosition === 'cheapest' ? TrendingDown : myPosition === 'most expensive' ? TrendingUp : Minus}
                  tone={myPosition === 'cheapest' ? 'emerald' : myPosition === 'most expensive' ? 'red' : 'ink'}
                />
                <AnalyticTile
                  label="Market volatility"
                  value={pricedCompetitors.length > 0
                    ? volatilityLabel(pricedCompetitors.reduce((a, s) => a + s.volatility, 0) / pricedCompetitors.length)
                    : '—'}
                  hint={pricedCompetitors.length > 0
                    ? `${pricedCompetitors.reduce((a, s) => a + s.changes, 0)} price change${pricedCompetitors.reduce((a, s) => a + s.changes, 0) === 1 ? '' : 's'} in ${rangeDays}d`
                    : ''}
                  icon={Activity}
                  tone="gold"
                />
              </div>

              {/* ── Chart ─────────────────────────────── */}
              <Card className="p-6 mb-6">
                <div className="flex items-baseline justify-between mb-5 flex-wrap gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-ink-500">Trend</div>
                    <h3 className="font-display text-[20px] tracking-tight text-ink-900 mt-1">
                      Last {rangeDays} days
                    </h3>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-ink-500">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-3 h-0.5 bg-ink-900" style={{ borderTop: '2px dashed #0c0a09' }}/>
                      Your price
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-3 h-0.5 bg-brand-500"/>
                      Competitors
                    </span>
                  </div>
                </div>
                <div className="h-[380px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: '#78716c' }}
                        tickLine={false}
                        axisLine={{ stroke: '#e7e5e4' }}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#78716c', fontVariantNumeric: 'tabular-nums' }}
                        tickLine={false}
                        axisLine={{ stroke: '#e7e5e4' }}
                        tickFormatter={v => Number(v).toFixed(1)}
                        domain={['auto', 'auto']}
                      />
                      <Tooltip
                        contentStyle={{
                          background: '#0c0a09', border: 'none', borderRadius: '10px',
                          color: '#fafaf9', fontSize: '12px', padding: '10px 14px',
                        }}
                        formatter={v => v != null ? `KD ${Number(v).toFixed(3)}` : '—'}
                        labelStyle={{ color: '#d6d3d1', marginBottom: '4px', fontSize: '11px' }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11, paddingTop: '12px' }} iconType="line" />
                      {myPrice != null && (
                        <ReferenceLine
                          y={myPrice}
                          stroke="#0c0a09"
                          strokeDasharray="5 4"
                          strokeWidth={2}
                          label={{ value: `Your price (KD ${myPrice.toFixed(3)})`, position: 'right', fill: '#0c0a09', fontSize: 10, fontWeight: 600 }}
                        />
                      )}
                      {seriesKeys.map((k, i) => (
                        <Line
                          key={k}
                          type="monotone"
                          dataKey={k}
                          stroke={COMPETITOR_COLORS[i % COMPETITOR_COLORS.length]}
                          strokeWidth={2}
                          dot={{ r: 3, strokeWidth: 0 }}
                          activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              {/* ── Bottom: competitor snapshot + notable moves ── */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2">
                  <Card className="overflow-hidden">
                    <div className="px-6 py-4 border-b border-ink-100">
                      <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-ink-500">Benchmark</div>
                      <h3 className="font-display text-[18px] tracking-tight text-ink-900 mt-1">Competitor snapshot</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-canvas-100 border-b border-ink-200">
                          <tr>
                            <Th>Competitor</Th>
                            <Th className="text-right">Latest</Th>
                            <Th className="text-right">Range</Th>
                            <Th className="text-right">Change</Th>
                            <Th className="text-right">vs You</Th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-ink-100">
                          {competitorStats.map((s, i) => (
                            <tr key={s.cp.id} className="hover:bg-canvas-100/40">
                              <Td>
                                <div className="flex items-center gap-2">
                                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COMPETITOR_COLORS[i % COMPETITOR_COLORS.length] }}/>
                                  <div>
                                    <div className="font-semibold text-[13px] text-ink-900">{s.competitor?.name}</div>
                                    {s.cp?.url && (
                                      <a href={s.cp.url} target="_blank" rel="noopener noreferrer"
                                        className="text-[10.5px] text-ink-500 hover:text-brand-700 inline-flex items-center gap-1">
                                        view page <ExternalLink size={9}/>
                                      </a>
                                    )}
                                  </div>
                                </div>
                              </Td>
                              <Td className="text-right tabular-nums font-semibold text-ink-900">
                                {s.count > 0 ? `KD ${s.last.toFixed(3)}` : <span className="text-ink-300 text-xs italic">no data</span>}
                              </Td>
                              <Td className="text-right tabular-nums text-[12px] text-ink-500">
                                {s.count > 0 ? `${s.min.toFixed(2)}–${s.max.toFixed(2)}` : '—'}
                              </Td>
                              <Td className="text-right">
                                {s.count >= 2 ? <ChangePill pct={s.changePct} /> : <span className="text-ink-300 text-xs">—</span>}
                              </Td>
                              <Td className="text-right">
                                {s.count > 0 && myPrice != null
                                  ? <ChangePill pct={((myPrice - s.last) / s.last) * 100} inverted/>
                                  : <span className="text-ink-300 text-xs">—</span>}
                              </Td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </div>

                <div>
                  <Card className="overflow-hidden">
                    <div className="px-5 py-4 border-b border-ink-100">
                      <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-ink-500">Movement</div>
                      <h3 className="font-display text-[17px] tracking-tight text-ink-900 mt-1">Notable moves ≥2%</h3>
                    </div>
                    {notableMoves.length === 0 ? (
                      <div className="p-6 text-[12.5px] text-ink-500 text-center">
                        Prices have been stable — nothing moved more than 2% in this range.
                      </div>
                    ) : (
                      <div className="divide-y divide-ink-100">
                        {notableMoves.map((m, i) => (
                          <div key={i} className="px-5 py-3">
                            <div className="flex items-center justify-between">
                              <div className="text-[12.5px] font-semibold text-ink-900">{m.competitor}</div>
                              <ChangePill pct={m.pct} />
                            </div>
                            <div className="text-[11px] text-ink-500 tabular-nums mt-0.5">
                              {m.from.toFixed(3)} → {m.to.toFixed(3)}
                            </div>
                            <div className="text-[10px] text-ink-400 mt-0.5">
                              {new Date(m.at).toLocaleDateString(undefined, { month:'short', day:'numeric' })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function AnalyticTile({ icon: Icon, label, value, hint, tone = 'ink' }) {
  const tones = {
    emerald: { icon: 'bg-emerald-50 text-emerald-700 border-emerald-100', accent: 'text-emerald-800' },
    red:     { icon: 'bg-red-50 text-red-700 border-red-100',             accent: 'text-red-800' },
    amber:   { icon: 'bg-amber-50 text-amber-800 border-amber-100',       accent: 'text-amber-900' },
    gold:    { icon: 'bg-brand-50 text-brand-700 border-brand-100',       accent: 'text-brand-800' },
    ink:     { icon: 'bg-ink-100 text-ink-700 border-ink-200',            accent: 'text-ink-900' },
  }
  const t = tones[tone] || tones.ink
  return (
    <div className="bg-white border border-ink-100 rounded-2xl p-5 shadow-card">
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 border ${t.icon}`}>
          <Icon size={16} strokeWidth={2}/>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-ink-500">{label}</div>
          <div className={`font-display text-[22px] leading-tight mt-1.5 tabular-nums ${t.accent}`}>{value}</div>
          {hint && <div className="text-[11px] text-ink-500 mt-1.5">{hint}</div>}
        </div>
      </div>
    </div>
  )
}

function ChangePill({ pct, inverted }) {
  if (pct == null) return <span className="text-ink-300">—</span>
  const flat = Math.abs(pct) < 0.5
  const isUp = pct > 0
  // For "vs You" columns, inverted means "positive gap = you're pricier = bad"
  const badColor = inverted ? (isUp ? 'red' : 'emerald') : (isUp ? 'red' : 'emerald')
  if (flat) return (
    <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-ink-100 text-ink-700 border border-ink-200 tabular-nums">
      Flat
    </span>
  )
  const colorCls = badColor === 'red'
    ? 'bg-red-50 text-red-800 border-red-100'
    : 'bg-emerald-50 text-emerald-800 border-emerald-100'
  return (
    <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10.5px] font-semibold border tabular-nums ${colorCls}`}>
      {isUp ? <ArrowUpRight size={10}/> : <ArrowDownRight size={10}/>}
      {isUp ? '+' : ''}{pct.toFixed(1)}%
    </span>
  )
}

function volatilityLabel(cv) {
  if (cv < 1)  return 'Very low'
  if (cv < 3)  return 'Low'
  if (cv < 8)  return 'Moderate'
  if (cv < 15) return 'High'
  return 'Very high'
}

function Th({ children, className = '' }) {
  return <th className={`px-5 py-3 text-left text-[10px] font-semibold text-ink-500 uppercase tracking-[0.12em] ${className}`}>{children}</th>
}
function Td({ children, className = '' }) {
  return <td className={`px-5 py-3.5 text-sm text-ink-800 ${className}`}>{children}</td>
}
