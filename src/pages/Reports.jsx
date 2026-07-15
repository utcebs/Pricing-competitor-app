import { useState, useEffect, useMemo } from 'react'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { FileBarChart, Download, TrendingUp, TrendingDown, Trophy, Package } from 'lucide-react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from '../supabaseClient'
import { useTable } from '../lib/db'
import {
  PageHeader, Card, Button, Empty, LoadingBlock, ErrorBlock, selectCls,
} from '../components/UI'

// Warm sophisticated palette — matches the app's design tokens
const PALETTE = ['#b1863a', '#0f766e', '#7c2d12', '#4c1d95', '#0369a1', '#65a30d', '#a21caf', '#c2410c']
const AXIS_TICK = { fontSize: 11, fill: '#78716c', fontVariantNumeric: 'tabular-nums' }
const TOOLTIP_STYLE = {
  background: '#0c0a09', border: 'none', borderRadius: '10px',
  color: '#fafaf9', fontSize: '12px', padding: '10px 14px',
}
const TOOLTIP_LABEL_STYLE = { color: '#d6d3d1', marginBottom: '4px', fontSize: '11px' }

export default function Reports() {
  const { rows: products } = useTable('products', { order: ['name', { ascending: true }] })
  const { rows: cps }      = useTable('competitor_products')
  const { rows: competitors } = useTable('competitors', { eq: ['is_active', true], order: ['name', { ascending: true }] })
  const { rows: categories } = useTable('categories', { order: ['name', { ascending: true }] })

  const [rangeDays, setRangeDays] = useState(30)
  const [priceHistory, setPriceHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const cpIds = cps.map(c => c.id)
  useEffect(() => {
    if (cpIds.length === 0) { setPriceHistory([]); setLoading(false); return }
    const from = new Date(); from.setDate(from.getDate() - rangeDays)
    setLoading(true); setErr('')
    supabase.from('price_history')
      .select('competitor_product_id, price, captured_at')
      .in('competitor_product_id', cpIds)
      .gte('captured_at', from.toISOString())
      .order('captured_at', { ascending: true })
      .limit(10_000)
      .then(({ data, error }) => {
        setLoading(false)
        if (error) setErr(error.message)
        else setPriceHistory(data || [])
      })
  }, [cpIds.join(','), rangeDays])

  // Latest price per competitor_product
  const latestByCp = useMemo(() => {
    const map = {}
    // history is asc; overwrite so last wins
    for (const r of priceHistory) map[r.competitor_product_id] = r
    return map
  }, [priceHistory])

  const compById = useMemo(() => Object.fromEntries(competitors.map(c => [c.id, c])), [competitors])
  const catById  = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories])

  // Per-product intel (mirrors dashboard logic)
  const productIntel = useMemo(() => {
    return products.map(p => {
      const links = cps.filter(cp => cp.product_id === p.id)
      const priced = links.map(cp => ({ cp, latest: latestByCp[cp.id] })).filter(x => x.latest?.price != null)
      const rivalPrices = priced.map(x => Number(x.latest.price))
      const minRival = rivalPrices.length ? Math.min(...rivalPrices) : null
      const avgRival = rivalPrices.length ? rivalPrices.reduce((a, x) => a + x, 0) / rivalPrices.length : null
      const yourPrice = p.current_price != null ? Number(p.current_price) : null
      const gap = (yourPrice != null && minRival != null) ? ((yourPrice - minRival) / minRival) * 100 : null
      const cheapestCp = priced.reduce((best, cur) =>
        !best || Number(cur.latest.price) < Number(best.latest.price) ? cur : best, null)
      return { product: p, priced, yourPrice, minRival, avgRival, gap, cheapestCp }
    })
  }, [products, cps, latestByCp])

  // ─── Chart 1: Price positioning by category ─────────
  // For each category: avg-of-yourPrice vs avg-of-avgRival across products
  const chart1 = useMemo(() => {
    const buckets = new Map()
    for (const pi of productIntel) {
      const catId = pi.product.category_id ?? 0
      if (!buckets.has(catId)) buckets.set(catId, { name: catById[pi.product.category_id]?.name || 'Uncategorised', yourPrices: [], marketPrices: [] })
      const b = buckets.get(catId)
      if (pi.yourPrice != null) b.yourPrices.push(pi.yourPrice)
      if (pi.avgRival != null)  b.marketPrices.push(pi.avgRival)
    }
    return [...buckets.values()]
      .filter(b => b.yourPrices.length || b.marketPrices.length)
      .map(b => ({
        name: b.name,
        You:    b.yourPrices.length ? Number((b.yourPrices.reduce((s, x) => s + x, 0) / b.yourPrices.length).toFixed(3)) : 0,
        Market: b.marketPrices.length ? Number((b.marketPrices.reduce((s, x) => s + x, 0) / b.marketPrices.length).toFixed(3)) : 0,
      }))
  }, [productIntel, catById])

  // ─── Chart 2: Market movement over time ──────────────
  // Avg competitor price per day across all products (rolling)
  const chart2 = useMemo(() => {
    if (priceHistory.length === 0) return []
    const byDay = new Map()   // day -> [prices]
    for (const row of priceHistory) {
      const day = row.captured_at.slice(0, 10)
      const arr = byDay.get(day) || (byDay.set(day, []).get(day))
      arr.push(Number(row.price))
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([day, prices]) => ({
        date: day,
        avg: Number((prices.reduce((s, x) => s + x, 0) / prices.length).toFixed(3)),
        min: Number(Math.min(...prices).toFixed(3)),
        max: Number(Math.max(...prices).toFixed(3)),
      }))
  }, [priceHistory])

  // ─── Chart 3: Where you win vs lose (per category, stacked) ──────
  const chart3 = useMemo(() => {
    const buckets = new Map()
    for (const pi of productIntel) {
      if (pi.gap == null) continue
      const catId = pi.product.category_id ?? 0
      if (!buckets.has(catId)) buckets.set(catId, { name: catById[pi.product.category_id]?.name || 'Uncategorised', Cheaper: 0, Flat: 0, Pricier: 0 })
      const b = buckets.get(catId)
      if (pi.gap < -1) b.Cheaper++
      else if (pi.gap > 1) b.Pricier++
      else b.Flat++
    }
    return [...buckets.values()]
  }, [productIntel, catById])

  // ─── Chart 4: Which competitor holds the lowest price most often ──────
  const chart4 = useMemo(() => {
    const counter = new Map()
    for (const pi of productIntel) {
      if (!pi.cheapestCp?.cp) continue
      const cid = pi.cheapestCp.cp.competitor_id
      counter.set(cid, (counter.get(cid) || 0) + 1)
    }
    return [...counter.entries()].map(([cid, count]) => ({
      name: compById[cid]?.name || `#${cid}`,
      value: count,
    })).sort((a, b) => b.value - a.value)
  }, [productIntel, compById])

  // ─── Top products by impact (for the ranking panel) ───
  const topByImpact = useMemo(() => {
    return productIntel
      .filter(pi => pi.gap != null && Math.abs(pi.gap) > 1)
      .map(pi => ({
        name: pi.product.name.length > 40 ? pi.product.name.slice(0, 40) + '…' : pi.product.name,
        gap: Number(pi.gap.toFixed(1)),
        impact: Math.abs(pi.gap * (pi.yourPrice || 0)),
      }))
      .sort((a, b) => b.impact - a.impact)
      .slice(0, 8)
      .map(x => ({ name: x.name, gap: x.gap }))
      .reverse()  // horizontal bar reads top-to-bottom, we want biggest at top
  }, [productIntel])

  // ─── KPI totals ──────────────────────────────────────
  const totalDataPoints = priceHistory.length
  const trackedCount = productIntel.filter(pi => pi.priced.length > 0).length
  const cheapestWinner = chart4[0]
  const marketDelta = useMemo(() => {
    if (chart2.length < 2) return null
    return ((chart2[chart2.length - 1].avg - chart2[0].avg) / chart2[0].avg) * 100
  }, [chart2])

  // Exports
  const exportAll = (kind) => {
    const summary = productIntel
      .filter(pi => pi.yourPrice != null || pi.priced.length > 0)
      .map(pi => ({
        product: pi.product.name,
        sku: pi.product.sku,
        category: catById[pi.product.category_id]?.name || 'Uncategorised',
        your_price: pi.yourPrice,
        market_min: pi.minRival,
        market_avg: pi.avgRival,
        gap_vs_min_pct: pi.gap != null ? Number(pi.gap.toFixed(2)) : null,
        cheapest_competitor: pi.cheapestCp ? compById[pi.cheapestCp.cp.competitor_id]?.name : null,
      }))
    const ts = new Date().toISOString().slice(0, 10)
    if (kind === 'csv') {
      const csv = Papa.unparse(summary)
      downloadBlob(csv, `analysis-${ts}.csv`, 'text/csv')
    } else if (kind === 'xlsx') {
      const ws = XLSX.utils.json_to_sheet(summary)
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Analysis')
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      downloadBlob(new Blob([buf], { type: 'application/octet-stream' }), `analysis-${ts}.xlsx`)
    } else if (kind === 'pdf') {
      const doc = new jsPDF()
      doc.setFontSize(16); doc.text('Price Competitor · Portfolio Analysis', 14, 18)
      doc.setFontSize(10); doc.setTextColor(120)
      doc.text(`Last ${rangeDays} days · Generated ${new Date().toLocaleString()}`, 14, 25)
      autoTable(doc, {
        startY: 32,
        head: [['Product', 'SKU', 'Category', 'You', 'Market min', 'Market avg', 'Gap %', 'Cheapest']],
        body: summary.map(r => [r.product.slice(0, 30), r.sku, r.category, r.your_price ?? '—', r.market_min ?? '—', r.market_avg ?? '—', r.gap_vs_min_pct ?? '—', r.cheapest_competitor || '—']),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [12, 10, 9] },
      })
      doc.save(`analysis-${ts}.pdf`)
    }
  }

  return (
    <div>
      <PageHeader
        kicker="Portfolio analysis"
        title="Reports"
        subtitle="Four cross-cutting views of your competitive position, updated every scrape. Adjust the range to compare weeks or seasons."
        action={
          <div className="flex items-center gap-2">
            <select className={`${selectCls} w-40`} value={rangeDays} onChange={e => setRangeDays(Number(e.target.value))}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={90}>Last 90 days</option>
              <option value={365}>Last year</option>
            </select>
            <Button variant="secondary" size="sm" onClick={() => exportAll('csv')}><Download size={12} /> CSV</Button>
            <Button variant="secondary" size="sm" onClick={() => exportAll('xlsx')}><Download size={12} /> Excel</Button>
            <Button variant="secondary" size="sm" onClick={() => exportAll('pdf')}><Download size={12} /> PDF</Button>
          </div>
        }
      />

      <ErrorBlock error={err} />

      {loading ? <Card><LoadingBlock text="Compiling analysis" /></Card> : totalDataPoints === 0 ? (
        <Card>
          <Empty
            icon={FileBarChart}
            title="No price data in this range"
            description="Trigger a scrape or extend the date range to populate the analysis."
          />
        </Card>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <SumTile icon={Package} label="Data points"
              value={totalDataPoints.toLocaleString()}
              hint={`${trackedCount} products with prices`} tone="ink" />
            <SumTile icon={marketDelta != null && marketDelta > 0 ? TrendingUp : TrendingDown}
              label="Market direction"
              value={marketDelta != null ? `${marketDelta > 0 ? '+' : ''}${marketDelta.toFixed(1)}%` : '—'}
              hint={marketDelta != null
                ? `Avg competitor price ${marketDelta > 0 ? 'up' : 'down'} vs ${rangeDays}d ago`
                : 'Need more data'}
              tone={marketDelta == null ? 'ink' : marketDelta > 0 ? 'red' : 'emerald'} />
            <SumTile icon={Trophy} label="Cheapest most often"
              value={cheapestWinner?.name || '—'}
              hint={cheapestWinner ? `Wins on ${cheapestWinner.value} of ${chart4.reduce((a, x) => a + x.value, 0)} tracked` : ''}
              tone="gold" />
            <SumTile icon={FileBarChart} label="Categories tracked"
              value={chart1.length}
              hint={`out of ${categories.length + 1} available`}
              tone="ink" />
          </div>

          {/* 4 CHARTS in a 2×2 grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            {/* Chart 1: Category price positioning */}
            <ChartCard
              kicker="Positioning"
              title="You vs market — by category"
              subtitle="Average of your prices next to the market's average, per category"
            >
              {chart1.length === 0 ? <EmptyChart/> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart1} margin={{ top: 10, right: 10, bottom: 5, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false}/>
                    <XAxis dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: '#e7e5e4' }} tickLine={false}/>
                    <YAxis tick={AXIS_TICK} axisLine={{ stroke: '#e7e5e4' }} tickLine={false} tickFormatter={v => v.toFixed(0)}/>
                    <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} formatter={v => `KD ${Number(v).toFixed(3)}`}/>
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: '8px' }} iconType="circle" iconSize={8}/>
                    <Bar dataKey="You"    fill="#0c0a09"  radius={[6, 6, 0, 0]}/>
                    <Bar dataKey="Market" fill="#b1863a"  radius={[6, 6, 0, 0]}/>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            {/* Chart 2: Market movement over time */}
            <ChartCard
              kicker="Trend"
              title={`Market price index — last ${rangeDays} days`}
              subtitle="Average scraped competitor price across your catalogue"
            >
              {chart2.length === 0 ? <EmptyChart/> : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chart2} margin={{ top: 10, right: 10, bottom: 5, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false}/>
                    <XAxis dataKey="date" tick={AXIS_TICK} axisLine={{ stroke: '#e7e5e4' }} tickLine={false}
                      tickFormatter={d => d.slice(5)}/>
                    <YAxis tick={AXIS_TICK} axisLine={{ stroke: '#e7e5e4' }} tickLine={false} tickFormatter={v => v.toFixed(0)}/>
                    <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} formatter={v => `KD ${Number(v).toFixed(3)}`}/>
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: '8px' }} iconType="line" iconSize={12}/>
                    <Line type="monotone" dataKey="min" name="Cheapest that day" stroke="#059669" strokeWidth={2} dot={false}/>
                    <Line type="monotone" dataKey="avg" name="Average" stroke="#b1863a" strokeWidth={2.5} dot={false}/>
                    <Line type="monotone" dataKey="max" name="Highest that day" stroke="#b91c1c" strokeWidth={2} dot={false}/>
                  </LineChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            {/* Chart 3: Portfolio health */}
            <ChartCard
              kicker="Portfolio"
              title="Where you win vs lose — per category"
              subtitle="Product count split by pricing position"
            >
              {chart3.length === 0 ? <EmptyChart/> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart3} layout="vertical" margin={{ top: 10, right: 10, bottom: 5, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" horizontal={false}/>
                    <XAxis type="number" tick={AXIS_TICK} axisLine={{ stroke: '#e7e5e4' }} tickLine={false} allowDecimals={false}/>
                    <YAxis type="category" dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: '#e7e5e4' }} tickLine={false} width={100}/>
                    <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE}/>
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: '8px' }} iconType="circle" iconSize={8}/>
                    <Bar dataKey="Cheaper" stackId="a" fill="#059669" radius={[0, 0, 0, 0]}/>
                    <Bar dataKey="Flat"    stackId="a" fill="#d6d3d1"/>
                    <Bar dataKey="Pricier" stackId="a" fill="#b91c1c" radius={[0, 6, 6, 0]}/>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            {/* Chart 4: Cheapest-competitor share */}
            <ChartCard
              kicker="Competition"
              title="Who's cheapest — most often"
              subtitle="Share of products where each competitor holds the lowest price"
            >
              {chart4.length === 0 ? <EmptyChart/> : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={chart4} dataKey="value" nameKey="name" cx="50%" cy="48%"
                         innerRadius={60} outerRadius={110} paddingAngle={2}
                         label={({ name, percent }) => `${name} ${Math.round(percent * 100)}%`}
                         labelLine={false}
                         style={{ fontSize: 11, fontWeight: 600 }}>
                      {chart4.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} stroke="#fff" strokeWidth={2}/>)}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE}
                      formatter={(v, n) => [`${v} product${v === 1 ? '' : 's'}`, n]}/>
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          {/* Bottom: top-impact products horizontal bar */}
          {topByImpact.length > 0 && (
            <Card className="p-6">
              <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-red-700">Attention</div>
                  <h3 className="font-display text-[20px] tracking-tight text-ink-900 mt-1">
                    Biggest gaps — where a repricing decision matters most
                  </h3>
                </div>
              </div>
              <div className="h-[380px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topByImpact} layout="vertical" margin={{ top: 5, right: 40, bottom: 5, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" horizontal={false}/>
                    <XAxis type="number" tick={AXIS_TICK} axisLine={{ stroke: '#e7e5e4' }} tickLine={false}
                      tickFormatter={v => `${v > 0 ? '+' : ''}${v}%`}/>
                    <YAxis type="category" dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: '#e7e5e4' }} tickLine={false} width={280}/>
                    <ReferenceLine x={0} stroke="#78716c" strokeDasharray="3 3"/>
                    <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE}
                      formatter={v => [`${v > 0 ? '+' : ''}${v}%`, 'Gap vs cheapest rival']}/>
                    <Bar dataKey="gap" radius={[0, 4, 4, 0]}>
                      {topByImpact.map((r, i) => (
                        <Cell key={i} fill={r.gap > 0 ? '#b91c1c' : '#059669'}/>
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function ChartCard({ kicker, title, subtitle, children }) {
  return (
    <Card className="p-5">
      <div className="mb-4">
        <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-brand-700">{kicker}</div>
        <h3 className="font-display text-[18px] tracking-tight text-ink-900 mt-1 leading-tight">{title}</h3>
        {subtitle && <p className="text-[11.5px] text-ink-500 mt-1 leading-snug">{subtitle}</p>}
      </div>
      <div className="h-[300px]">{children}</div>
    </Card>
  )
}

function SumTile({ icon: Icon, label, value, hint, tone = 'ink' }) {
  const tones = {
    emerald: { icon: 'bg-emerald-50 text-emerald-700 border-emerald-100', accent: 'text-emerald-800' },
    red:     { icon: 'bg-red-50 text-red-700 border-red-100',             accent: 'text-red-800' },
    gold:    { icon: 'bg-brand-50 text-brand-700 border-brand-100',       accent: 'text-brand-800' },
    ink:     { icon: 'bg-ink-100 text-ink-700 border-ink-200',            accent: 'text-ink-900' },
  }
  const t = tones[tone] || tones.ink
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 border ${t.icon}`}>
          <Icon size={16} strokeWidth={2}/>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-ink-500">{label}</div>
          <div className={`font-display text-[22px] leading-tight mt-1.5 tabular-nums truncate ${t.accent}`}>{value}</div>
          {hint && <div className="text-[11px] text-ink-500 mt-1">{hint}</div>}
        </div>
      </div>
    </Card>
  )
}

function EmptyChart() {
  return (
    <div className="h-full flex items-center justify-center text-[12px] text-ink-400">
      Not enough data yet
    </div>
  )
}

function downloadBlob(data, filename, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 100)
}
