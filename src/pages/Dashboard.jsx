import { useEffect, useState, useMemo } from 'react'
import { NavLink } from 'react-router-dom'
import {
  PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, BarChart, Bar,
} from 'recharts'
import {
  Package, Building2, ShieldCheck, Flame, Scale, PackageX,
  TrendingUp, TrendingDown, ArrowRight, ArrowUpRight, ArrowDownRight, Bell,
} from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useTable, fetchLatestPrices, fetchLatestStock } from '../lib/db'
import { useAuth } from '../lib/auth'
import { Card, LoadingBlock } from '../components/UI'

/**
 * Suggest a price that beats the cheapest rival by 1 fils, never below the
 * cost/margin/min floors. Exported — the Business Insights page imports it.
 */
export function computeSuggestion({ minRival, costPrice, targetMarginPct, minPriceFloor }) {
  if (minRival == null) return null
  const marginFloor =
    costPrice != null && targetMarginPct != null && targetMarginPct < 100
      ? costPrice / (1 - targetMarginPct / 100) : null
  const floors = [marginFloor, minPriceFloor, costPrice].filter(v => v != null && v >= 0)
  const effectiveFloor = floors.length ? Math.max(...floors) : 0
  const activeFloor = floors.length
    ? (marginFloor === effectiveFloor ? 'margin'
      : minPriceFloor === effectiveFloor ? 'min' : 'cost')
    : null
  const undercut = minRival - 0.001
  const canUndercut = undercut >= effectiveFloor
  const price = canUndercut ? undercut : effectiveFloor
  const mode = canUndercut ? 'competitive' : 'floor'
  const achievedMarginPct =
    costPrice != null && price > 0 ? ((price - costPrice) / price) * 100 : null
  return { price, mode, achievedMarginPct, activeFloor, effectiveFloor }
}

// Position palette — matches the app's semantic colours.
const POS = {
  cheapest: { label: 'Cheapest',     color: '#10b981' },  // emerald — you win
  match:    { label: 'Match Price',  color: '#3b82f6' },  // blue — parity
  below:    { label: 'Below Market', color: '#f59e0b' },  // amber — under avg
  above:    { label: 'Above Market', color: '#ef4444' },  // red — you're pricier
}
const STOCK = { in: '#10b981', out: '#ef4444' }

/**
 * Dashboard — an executive, Power-BI-style competitive-pricing report.
 * Every figure is computed live from the latest scraped prices/stock, so it
 * refreshes on every load. See the four AnswerCards on /business-insights for
 * the deeper "what should I do" analysis.
 */
export default function Dashboard() {
  const { profile } = useAuth()
  const { rows: products, loading: pLoading } = useTable('products', { order: ['name', { ascending: true }] })
  const { rows: competitors } = useTable('competitors', { eq: ['is_active', true] })
  const { rows: cps } = useTable('competitor_products', { eq: ['is_active', true] })
  const { rows: categories } = useTable('categories')

  const [latestPrices, setLatestPrices] = useState({})
  const [latestStock, setLatestStock] = useState({})
  const [priceHistory, setPriceHistory] = useState([])
  const [metrics, setMetrics] = useState([])       // daily series → trend + sparklines
  const [rangeDays, setRangeDays] = useState(14)

  useEffect(() => { fetchLatestPrices(60).then(({ prices }) => setLatestPrices(prices)).catch(() => setLatestPrices({})) }, [])
  useEffect(() => { fetchLatestStock(60).then(setLatestStock).catch(() => setLatestStock({})) }, [])

  // Recent history for 24h price-change detection + the alerts feed.
  useEffect(() => {
    const from = new Date(); from.setDate(from.getDate() - 7)
    supabase.from('price_history')
      .select('id, competitor_product_id, price, captured_at, competitor_products(name, competitor_id, product_id, competitors(name))')
      .gte('captured_at', from.toISOString())
      .order('captured_at', { ascending: false })
      .limit(1000)
      .then(({ data }) => setPriceHistory(data || []))
  }, [])

  // Daily metrics (server-side reconstruction) — powers the trend + KPI sparklines.
  useEffect(() => {
    supabase.rpc('get_daily_metrics', { days: rangeDays })
      .then(({ data }) => setMetrics(Array.isArray(data) ? data : []))
      .catch(() => setMetrics([]))
  }, [rangeDays])

  // ── Per-product intelligence ────────────────────────────
  const productIntel = useMemo(() => {
    const compById = Object.fromEntries(competitors.map(c => [c.id, c]))
    return products.map(p => {
      const productLinks = cps
        .filter(cp => cp.product_id === p.id)
        .map(cp => ({ cp, competitor: compById[cp.competitor_id], latest: latestPrices[cp.id] }))
      const priced = productLinks.filter(l => l.latest?.price != null)
      const rivalPrices = priced.map(l => Number(l.latest.price))
      const minRival = rivalPrices.length ? Math.min(...rivalPrices) : null
      const avgRival = rivalPrices.length ? rivalPrices.reduce((a, b) => a + b, 0) / rivalPrices.length : null
      const yourPrice = p.current_price != null ? Number(p.current_price) : null
      const gapVsMinPct = (yourPrice != null && minRival != null) ? ((yourPrice - minRival) / minRival) * 100 : null
      const gapVsAvgPct = (yourPrice != null && avgRival != null) ? ((yourPrice - avgRival) / avgRival) * 100 : null
      const cheapestLink = priced.reduce((best, cur) =>
        !best || Number(cur.latest.price) < Number(best.latest.price) ? cur : best, null)
      let position = null
      if (yourPrice != null && rivalPrices.length > 0) {
        if (gapVsMinPct <= -0.001) position = 'cheapest'
        else if (gapVsMinPct > 1) position = 'above'
        else if (Math.abs(gapVsMinPct) <= 1) position = 'match'
        else if (gapVsAvgPct < -1) position = 'below'
        else position = 'match'
      }
      return {
        product: p, rivalCount: priced.length, yourPrice, minRival, avgRival,
        gapVsMinPct, gapVsAvgPct, cheapestLink, position,
      }
    })
  }, [products, cps, latestPrices, competitors])

  // ── Aggregates ──────────────────────────────────────────
  const positioned = productIntel.filter(pi => pi.position)
  const posCount = k => positioned.filter(pi => pi.position === k).length
  const cheapestN = posCount('cheapest'), matchN = posCount('match'), aboveN = posCount('above'), belowN = posCount('below')

  const trackedCount = productIntel.filter(pi => pi.rivalCount > 0).length
  const totalProducts = products.length
  const coveragePct = totalProducts ? Math.round((trackedCount / totalProducts) * 100) : 0

  // Price Match Rate = % of positioned products where you're cheapest OR matching.
  const matchRate = positioned.length ? Math.round(((cheapestN + matchN) / positioned.length) * 100) : 0

  // Total at risk = Σ (yourPrice − cheapest rival) over above-market products.
  const totalAtRisk = productIntel.reduce((s, pi) =>
    pi.position === 'above' && pi.yourPrice != null && pi.minRival != null ? s + (pi.yourPrice - pi.minRival) : s, 0)

  // Avg gap vs cheapest rival, over positioned products (signed %).
  const avgGap = positioned.length
    ? positioned.reduce((s, pi) => s + (pi.gapVsMinPct || 0), 0) / positioned.length : null

  const competitorsTracked = useMemo(() => {
    const compByCp = Object.fromEntries(cps.map(c => [c.id, c.competitor_id]))
    const set = new Set()
    for (const cpId of Object.keys(latestPrices)) { const cid = compByCp[cpId]; if (cid != null) set.add(cid) }
    return set.size || competitors.length
  }, [latestPrices, cps, competitors])

  // Competitor stock (In / Out only — we store a boolean).
  const stockStats = useMemo(() => {
    let inS = 0, out = 0
    for (const cp of cps) {
      const s = latestStock[cp.id]
      if (s === true) inS++; else if (s === false) out++
    }
    return { inS, out, total: inS + out }
  }, [cps, latestStock])
  const oosPct = stockStats.total ? Math.round((stockStats.out / stockStats.total) * 100) : 0

  // Donut datasets
  const positionDonut = [
    { key: 'cheapest', name: POS.cheapest.label, value: cheapestN, color: POS.cheapest.color },
    { key: 'match',    name: POS.match.label,    value: matchN,    color: POS.match.color },
    { key: 'above',    name: POS.above.label,    value: aboveN,    color: POS.above.color },
    { key: 'below',    name: POS.below.label,    value: belowN,    color: POS.below.color },
  ].filter(d => d.value > 0)
  const stockDonut = [
    { name: 'In Stock',     value: stockStats.inS, color: STOCK.in },
    { name: 'Out of Stock', value: stockStats.out, color: STOCK.out },
  ].filter(d => d.value > 0)

  // Trend → % of positioned products in each bucket per day.
  const trendData = useMemo(() => metrics.map(r => {
    const total = (r.cheapest + r.matchp + r.above + r.below) || 1
    return {
      day: fmtDay(r.day),
      Cheapest: +(r.cheapest / total * 100).toFixed(1),
      'Match Price': +(r.matchp / total * 100).toFixed(1),
      'Above Market': +(r.above / total * 100).toFixed(1),
      'Below Market': +(r.below / total * 100).toFixed(1),
    }
  }), [metrics])

  // Real KPI sparkline series (from the same daily metrics).
  const spark = useMemo(() => ({
    monitored:   metrics.map(m => m.monitored),
    competitors: metrics.map(m => m.competitors),
    matchRate:   metrics.map(m => m.monitored ? Math.round((m.cheapest + m.matchp) / m.monitored * 100) : 0),
    atRisk:      metrics.map(m => Number(m.at_risk)),
    avgGap:      metrics.map(m => Number(m.avg_gap)),
    oos:         metrics.map(m => m.oos),
  }), [metrics])

  // Top products by price opportunity (above market, ranked by KD you could save)
  const topOpportunities = useMemo(() => productIntel
    .filter(pi => pi.position === 'above' && pi.cheapestLink)
    .map(pi => ({
      ...pi,
      opportunity: pi.yourPrice - pi.minRival,
      cheapestName: pi.cheapestLink?.competitor?.name,
      cheapestStock: latestStock[pi.cheapestLink?.cp?.id],
    }))
    .sort((a, b) => b.opportunity - a.opportunity)
    .slice(0, 6), [productIntel, latestStock])

  // Cheapest competitor by category
  const cheapestByCategory = useMemo(() => {
    const catById = Object.fromEntries(categories.map(c => [c.id, c]))
    const byCat = {}
    for (const pi of productIntel) {
      if (!pi.cheapestLink?.competitor || pi.yourPrice == null || pi.minRival == null) continue
      const catId = pi.product.category_id ?? 'uncat'
      const b = byCat[catId] || (byCat[catId] = { catId, wins: {}, n: 0, diffSum: 0 })
      const cName = pi.cheapestLink.competitor.name
      b.wins[cName] = (b.wins[cName] || 0) + 1
      b.n++
      b.diffSum += ((pi.minRival - pi.yourPrice) / pi.yourPrice) * 100  // negative = rival cheaper
    }
    return Object.values(byCat).map(b => {
      const [topName, topWins] = Object.entries(b.wins).sort((a, c) => c[1] - a[1])[0] || ['—', 0]
      return {
        category: catById[b.catId]?.name || 'Uncategorised',
        competitor: topName,
        pctCheapest: Math.round((topWins / b.n) * 100),
        avgDiff: b.diffSum / b.n,
        n: b.n,
      }
    }).sort((a, b) => b.n - a.n).slice(0, 6)
  }, [productIntel, categories])

  // Price distribution — histogram of gap vs cheapest rival (%)
  const distribution = useMemo(() => {
    const edges = [-50, -25, -10, -5, 0, 5, 10, 25, 50]
    const labels = ['<-50', '-50..-25', '-25..-10', '-10..-5', '-5..0', '0..5', '5..10', '10..25', '25..50', '>50']
    const counts = new Array(labels.length).fill(0)
    for (const pi of positioned) {
      const g = pi.gapVsMinPct
      if (g == null) continue
      let idx = edges.findIndex(e => g < e)
      if (idx === -1) idx = labels.length - 1
      counts[idx]++
    }
    return labels.map((label, i) => ({ label, count: counts[i] }))
  }, [positioned])

  // Price changes in the last 24h (competitor readings)
  const changes24h = useMemo(() => {
    const dayAgo = Date.now() - 24 * 3600 * 1000
    const groups = {}
    for (const row of priceHistory) {
      const arr = groups[row.competitor_product_id] || (groups[row.competitor_product_id] = [])
      arr.push(row)
    }
    let up = 0, down = 0, flat = 0
    for (const rows of Object.values(groups)) {
      const [latest, prior] = rows
      if (!latest || new Date(latest.captured_at).getTime() < dayAgo) continue
      if (!prior) { flat++; continue }
      const a = Number(prior.price), b = Number(latest.price)
      if (b > a) up++; else if (b < a) down++; else flat++
    }
    return { up, down, flat }
  }, [priceHistory])

  // Recent moves for the alerts feed
  const recentMoves = useMemo(() => {
    const groups = {}
    for (const row of priceHistory) {
      const arr = groups[row.competitor_product_id] || (groups[row.competitor_product_id] = [])
      arr.push(row)
    }
    const moves = []
    const cutoff = Date.now() - 72 * 3600 * 1000
    for (const rows of Object.values(groups)) {
      const [latest, prior] = rows
      if (!latest || !prior || new Date(latest.captured_at).getTime() < cutoff) continue
      const a = Number(prior.price), b = Number(latest.price)
      if (a === b) continue
      moves.push({
        name: latest.competitor_products?.name,
        competitor: latest.competitor_products?.competitors?.name,
        from: a, to: b, changePct: ((b - a) / a) * 100, at: latest.captured_at,
      })
    }
    return moves.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 6)
  }, [priceHistory])

  if (pLoading) return <div className="h-full flex items-center justify-center"><LoadingBlock text="Building report" /></div>

  return (
    <div className="h-full flex flex-col gap-2.5 min-h-0">
      {/* ── Slim top bar ───────────────────────────────── */}
      <div className="flex items-center justify-end gap-2 flex-shrink-0 -mb-0.5">
        <div className="relative">
          <select value={rangeDays} onChange={e => setRangeDays(Number(e.target.value))}
            className="appearance-none text-[11.5px] font-medium text-ink-600 bg-white border border-ink-200 rounded-lg pl-3 pr-7 py-1.5 hover:border-ink-300 focus:outline-none focus:ring-1 focus:ring-brand-300 cursor-pointer">
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <ArrowDownRight size={11} className="absolute right-2 top-1/2 -translate-y-1/2 rotate-45 text-ink-400 pointer-events-none" />
        </div>
        <NavLink to="/alerts" title="Alerts"
          className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-ink-200 bg-white text-ink-500 hover:text-brand-700 hover:border-ink-300 transition-colors">
          <Bell size={15} />
        </NavLink>
        <div className="w-8 h-8 rounded-full bg-ink-900 text-white text-[12px] font-semibold inline-flex items-center justify-center"
          title={profile?.email}>
          {(profile?.full_name || profile?.email || '?').trim().charAt(0).toUpperCase()}
        </div>
      </div>

      {/* ── KPI row ─────────────────────────────────────── */}
      <div className="grid grid-cols-3 xl:grid-cols-6 gap-2.5 flex-shrink-0">
        <Kpi icon={Package} tone="ink" label="Products Monitored" value={trackedCount}
          hint={`${coveragePct}% of ${totalProducts} products`} spark={spark.monitored} />
        <Kpi icon={Building2} tone="blue" label="Competitors Tracked" value={competitorsTracked}
          hint={`${competitors.length} active marketplaces`} spark={spark.competitors} />
        <Kpi icon={ShieldCheck} tone="emerald" label="Price Match Rate" value={`${matchRate}%`}
          hint="At or below cheapest rival" spark={spark.matchRate} />
        <Kpi icon={Flame} tone="red" label="Total at Risk" value={`KD ${totalAtRisk.toFixed(3)}`}
          hint={`${aboveN} product${aboveN === 1 ? '' : 's'} above market`} spark={spark.atRisk} />
        <Kpi icon={Scale} tone={avgGap != null && avgGap > 0 ? 'red' : 'emerald'} label="Avg Gap vs Cheapest"
          value={avgGap == null ? '—' : `${avgGap > 0 ? '+' : ''}${avgGap.toFixed(1)}%`}
          hint="Mean position vs lowest rival" spark={spark.avgGap} />
        <Kpi icon={PackageX} tone="amber" label="Competitor Out-of-Stock" value={stockStats.out}
          hint={`${oosPct}% of ${stockStats.total} tracked links`} spark={spark.oos} />
      </div>

      {/* ── Row 2: donut · trend · donut ───────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 flex-1 min-h-0">
        <Panel title="Market Position Overview" subtitle="Where your prices sit vs the cheapest rival">
          <DonutWithCenter data={positionDonut} centerValue={positioned.length} centerLabel="Products" />
        </Panel>

        <Panel title="Price Position Trend" subtitle={`Share of products in each position (${rangeDays}d)`}
          className="lg:col-span-1">
          {trendData.length === 0 ? (
            <EmptyChart text="Trend builds as scrape history accrues." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} unit="%" width={38} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${v}%`} />
                <Legend wrapperStyle={{ fontSize: 10 }} iconType="plainline" />
                <Line type="monotone" dataKey="Cheapest"     stroke={POS.cheapest.color} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Match Price"  stroke={POS.match.color}    strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Above Market" stroke={POS.above.color}    strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Below Market" stroke={POS.below.color}    strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Competitor Stock Status" subtitle="Availability across tracked competitor listings">
          <DonutWithCenter data={stockDonut} centerValue={stockStats.total} centerLabel="Listings" />
        </Panel>
      </div>

      {/* ── Row 3: opportunities · category · alerts ───── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 flex-1 min-h-0">
        <Panel title="Top Products by Price Opportunity" subtitle="You're above the cheapest rival — biggest savings first"
          className="lg:col-span-5" bodyClass="p-0">
          {topOpportunities.length === 0 ? <EmptyChart text="You're competitive on every tracked product." /> : (
            <div className="overflow-auto h-full">
              <table className="w-full text-sm">
                <thead><tr className="text-[10px] uppercase tracking-wide text-ink-400 border-b border-ink-100">
                  <Th>#</Th><Th>Product</Th><Th className="text-right">Your</Th><Th className="text-right">Cheapest</Th>
                  <Th className="text-right">Diff</Th><Th className="text-right">Opportunity</Th><Th>Stock</Th>
                </tr></thead>
                <tbody className="divide-y divide-ink-50">
                  {topOpportunities.map((r, i) => (
                    <tr key={r.product.id} className="hover:bg-canvas-100/50">
                      <Td className="text-ink-400 tabular-nums">{i + 1}</Td>
                      <Td><div className="font-medium text-ink-900 truncate max-w-[160px]">{r.product.name}</div>
                        <div className="text-[10px] font-mono text-ink-400">{r.product.sku}</div></Td>
                      <Td className="text-right tabular-nums">KD {r.yourPrice.toFixed(3)}</Td>
                      <Td className="text-right tabular-nums">KD {r.minRival.toFixed(3)}
                        <div className="text-[10px] text-ink-400 truncate max-w-[90px] ml-auto">{r.cheapestName}</div></Td>
                      <Td className="text-right"><span className="text-red-700 font-semibold tabular-nums">+{r.gapVsMinPct.toFixed(1)}%</span></Td>
                      <Td className="text-right tabular-nums font-semibold text-brand-700">KD {r.opportunity.toFixed(3)}</Td>
                      <Td><StockChip s={r.cheapestStock} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Cheapest Competitor by Category" subtitle="Who leads price in each category"
          className="lg:col-span-4" bodyClass="p-0">
          {cheapestByCategory.length === 0 ? <EmptyChart text="No category price data yet." /> : (
            <div className="overflow-auto h-full">
              <table className="w-full text-sm">
                <thead><tr className="text-[10px] uppercase tracking-wide text-ink-400 border-b border-ink-100">
                  <Th>Category</Th><Th>Cheapest</Th><Th className="text-right">% Cheapest</Th><Th className="text-right">Avg Diff</Th>
                </tr></thead>
                <tbody className="divide-y divide-ink-50">
                  {cheapestByCategory.map(r => (
                    <tr key={r.category} className="hover:bg-canvas-100/50">
                      <Td className="font-medium text-ink-900 truncate max-w-[120px]">{r.category}</Td>
                      <Td className="truncate max-w-[110px]">{r.competitor}</Td>
                      <Td className="text-right tabular-nums">{r.pctCheapest}%</Td>
                      <Td className="text-right tabular-nums font-semibold">
                        <span className={r.avgDiff < 0 ? 'text-red-700' : 'text-emerald-700'}>
                          {r.avgDiff > 0 ? '+' : ''}{r.avgDiff.toFixed(1)}%
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Recent Price Moves" subtitle="Competitor changes, last 72h" className="lg:col-span-3" bodyClass="p-0">
          {recentMoves.length === 0 ? <EmptyChart text="No competitor moves recently." /> : (
            <div className="divide-y divide-ink-50 overflow-auto h-full">
              {recentMoves.map((m, i) => (
                <div key={i} className="px-4 py-2.5">
                  <div className="text-[12px] font-medium text-ink-900 truncate">{m.name}</div>
                  <div className="text-[10px] text-ink-400">{m.competitor} · {relTime(new Date(m.at))}</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[11px] tabular-nums text-ink-500">{m.from.toFixed(3)} → <b className="text-ink-800">{m.to.toFixed(3)}</b></span>
                    <span className={`text-[11px] font-semibold tabular-nums inline-flex items-center gap-0.5 ${m.changePct > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                      {m.changePct > 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                      {m.changePct > 0 ? '+' : ''}{m.changePct.toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ── Row 4: distribution · price changes ─────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 flex-1 min-h-0">
        <Panel title="Price Distribution" subtitle="Your gap vs the cheapest rival (%)" className="lg:col-span-2">
          <div className="h-full flex flex-col">
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distribution} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} axisLine={false} interval={0} angle={-20} textAnchor="end" height={42} />
                  <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} products`, '']} labelFormatter={l => `Gap ${l}%`} />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {distribution.map((d, i) => {
                      const lbl = d.label
                      const color = lbl.startsWith('<') || lbl.startsWith('-') ? POS.cheapest.color
                        : lbl === '0..5' ? POS.match.color : POS.above.color
                      return <Cell key={i} fill={color} />
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="text-[10px] text-ink-400 text-center flex-shrink-0">← cheaper than rivals · pricier than rivals →</div>
          </div>
        </Panel>

        <Panel title="Price Changes (24h)" subtitle="Competitor movements in the last day">
          <div className="grid grid-cols-3 gap-2 pt-2">
            <ChangeTile icon={TrendingUp} tone="red" label="Increases" value={changes24h.up} />
            <ChangeTile icon={ArrowRight} tone="ink" label="No change" value={changes24h.flat} />
            <ChangeTile icon={TrendingDown} tone="emerald" label="Decreases" value={changes24h.down} />
          </div>
          <NavLink to="/prices" className="mt-4 text-[11.5px] text-brand-700 hover:underline inline-flex items-center gap-1">
            View price trends <ArrowRight size={12} />
          </NavLink>
        </Panel>
      </div>
    </div>
  )
}

// ── Presentational helpers ──────────────────────────────────
const TONES = {
  ink:     'bg-ink-100 text-ink-700',
  blue:    'bg-blue-50 text-blue-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  red:     'bg-red-50 text-red-700',
  amber:   'bg-amber-50 text-amber-700',
}
const tooltipStyle = { fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb', boxShadow: '0 4px 12px rgba(0,0,0,.08)' }

const SPARK_COLOR = { ink: '#64748b', blue: '#3b82f6', emerald: '#10b981', red: '#ef4444', amber: '#f59e0b' }

function Kpi({ icon: Icon, label, value, hint, tone = 'ink', spark }) {
  return (
    <Card className="px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-1">
        <div className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-ink-500 leading-tight truncate">{label}</div>
        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md flex-shrink-0 ${TONES[tone]}`}><Icon size={13} /></span>
      </div>
      <div className="font-display text-[22px] leading-none text-ink-900 mt-1.5 tabular-nums">{value}</div>
      <div className="flex items-end justify-between gap-2 mt-1.5">
        <div className="text-[10px] text-ink-500 truncate flex-1">{hint}</div>
        {spark && spark.length > 1 && (
          <div className="w-[62px] h-[20px] flex-shrink-0"><Sparkline data={spark} color={SPARK_COLOR[tone]} /></div>
        )}
      </div>
    </Card>
  )
}

// Lightweight inline-SVG sparkline (no per-card Recharts overhead).
function Sparkline({ data, color }) {
  const nums = data.map(Number).filter(v => Number.isFinite(v))
  if (nums.length < 2) return null
  const w = 62, h = 20, pad = 1.5
  const min = Math.min(...nums), max = Math.max(...nums)
  const range = (max - min) || 1
  const x = i => (i / (nums.length - 1)) * w
  const y = v => h - pad - ((v - min) / range) * (h - pad * 2)
  const line = nums.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const area = `${line} L${w} ${h} L0 ${h} Z`
  const gid = `spk-${color.slice(1)}`
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block w-full h-full">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.20" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Panel({ title, subtitle, children, className = '', bodyClass = '' }) {
  return (
    <Card className={`overflow-hidden flex flex-col min-h-0 ${className}`}>
      <div className="px-4 py-2 border-b border-ink-100 flex-shrink-0">
        <div className="font-display text-[13.5px] tracking-tight text-ink-900 leading-tight">{title}</div>
        {subtitle && <div className="text-[10px] text-ink-400 mt-0.5 truncate">{subtitle}</div>}
      </div>
      <div className={`flex-1 min-h-0 ${bodyClass || 'p-3'}`}>{children}</div>
    </Card>
  )
}

function DonutWithCenter({ data, centerValue, centerLabel }) {
  if (!data.length) return <EmptyChart text="No data yet." />
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  return (
    <div className="flex items-center gap-2 h-full">
      <div className="relative h-full flex-shrink-0" style={{ width: 118, minHeight: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
              innerRadius="60%" outerRadius="92%" paddingAngle={2} stroke="none">
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${v} (${Math.round(v / total * 100)}%)`, n]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="font-display text-[19px] leading-none text-ink-900 tabular-nums">{centerValue}</div>
          <div className="text-[8px] uppercase tracking-wide text-ink-400 mt-0.5">{centerLabel}</div>
        </div>
      </div>
      <div className="flex-1 space-y-1 min-w-0">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11px]">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: d.color }} />
            <span className="text-ink-600 flex-1 truncate">{d.name}</span>
            <span className="tabular-nums font-semibold text-ink-800">{d.value}</span>
            <span className="tabular-nums text-ink-400 w-8 text-right">{Math.round(d.value / total * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChangeTile({ icon: Icon, label, value, tone }) {
  return (
    <div className="text-center rounded-lg border border-ink-100 py-3">
      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg mb-1.5 ${TONES[tone]}`}><Icon size={14} /></span>
      <div className="font-display text-[22px] leading-none text-ink-900 tabular-nums">{value}</div>
      <div className="text-[10px] text-ink-500 mt-1">{label}</div>
    </div>
  )
}

function StockChip({ s }) {
  if (s === true) return <span className="text-[10px] font-semibold text-emerald-700">In stock</span>
  if (s === false) return <span className="text-[10px] font-semibold text-amber-600">Out of stock</span>
  return <span className="text-[10px] text-ink-400">—</span>
}

function EmptyChart({ text }) {
  return <div className="h-[180px] flex items-center justify-center text-center text-[12px] text-ink-400 px-4">{text}</div>
}

function Th({ children, className = '' }) {
  return <th className={`px-3 py-2.5 text-left font-semibold ${className}`}>{children}</th>
}
function Td({ children, className = '' }) {
  return <td className={`px-3 py-2.5 align-top ${className}`}>{children}</td>
}

function fmtDay(d) {
  const dt = new Date(d)
  return dt.toLocaleDateString('en', { month: 'short', day: 'numeric' })
}
function relTime(dt) {
  const s = Math.floor((Date.now() - dt.getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
