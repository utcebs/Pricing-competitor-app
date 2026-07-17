import React, { useState, useEffect, useMemo, useRef } from 'react'
import { GitCompare, ArrowUpRight, ArrowDownRight, Minus, ExternalLink, Search, RefreshCw, Zap, Package, Download } from 'lucide-react'
import * as XLSX from 'xlsx'
import { NavLink } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useTable } from '../lib/db'
import { useAuth } from '../lib/auth'
import {
  PageHeader, Card, Empty, LoadingBlock, ErrorBlock, Badge, Button,
  inputCls, selectCls,
} from '../components/UI'

/**
 * Price Comparison Matrix — one row per product, one column per competitor.
 * Cell shows the LATEST scraped/logged price + gap % vs. your price.
 * Colour: green if you're cheaper (competitor is higher), red if you're more
 * expensive. Sort by biggest opportunity/threat.
 */
export default function Comparison() {
  const { user, isManager } = useAuth()
  const { rows: products,    loading: pL, error: pErr, refresh: refreshProducts } = useTable('products',    { order: ['name', { ascending: true }] })
  const { rows: competitors, loading: cL, error: cErr, refresh: refreshCompetitors } = useTable('competitors', { eq: ['is_active', true], order: ['name', { ascending: true }] })
  const { rows: cps,         loading: lL, error: lErr, refresh: refreshCps } = useTable('competitor_products')

  const [latestPrices, setLatestPrices] = useState({})   // { competitor_product_id: { price, captured_at, in_stock } }
  const [priceLoading, setPriceLoading] = useState(false)
  const [priceErr, setPriceErr] = useState('')
  const [refreshTick, setRefreshTick] = useState(0)   // bump to re-run the price query
  const [lastRefreshed, setLastRefreshed] = useState(null)
  const [rescraping, setRescraping] = useState(false)
  const [rescrapeMsg, setRescrapeMsg] = useState('')

  const [q,        setQ]        = useState('')
  const [catFilter,setCatFilter]= useState('all')
  const [sortBy,   setSortBy]   = useState('opportunity')

  const { rows: categories } = useTable('categories', { order: ['name', { ascending: true }] })

  // Pull latest price for every competitor_product in ONE query.
  const cpIds = cps.map(c => c.id)
  useEffect(() => {
    if (cpIds.length === 0) { setLatestPrices({}); setLastRefreshed(new Date()); return }
    setPriceLoading(true); setPriceErr('')
    const from = new Date(); from.setDate(from.getDate() - 60)
    supabase.from('price_history')
      .select('competitor_product_id, price, currency_code, captured_at')
      .in('competitor_product_id', cpIds)
      .gte('captured_at', from.toISOString())
      .order('captured_at', { ascending: false })
      .then(({ data, error }) => {
        setPriceLoading(false)
        setLastRefreshed(new Date())
        if (error) { setPriceErr(error.message); return }
        const seen = {}
        for (const row of (data || [])) {
          if (!seen[row.competitor_product_id]) seen[row.competitor_product_id] = row
        }
        setLatestPrices(seen)
      })
  }, [cpIds.join(','), refreshTick])

  const refreshAll = () => {
    refreshProducts(); refreshCompetitors(); refreshCps()
    setRefreshTick(t => t + 1)
  }

  const rescrapeAll = async () => {
    setRescraping(true); setRescrapeMsg('')
    const rows = competitors.map(c => ({
      competitor_id: c.id, status: 'queued',
      triggered_by: user?.id, triggered_kind: 'manual',
    }))
    const { error } = await supabase.from('scrape_runs').insert(rows)
    setRescraping(false)
    if (error) { setRescrapeMsg('Queue failed: ' + error.message); return }
    setRescrapeMsg(`Queued ${rows.length} scrape${rows.length === 1 ? '' : 's'}. New prices land within ~5 minutes.`)
    setTimeout(() => setRescrapeMsg(''), 8000)
  }

  // Build a lookup: productId → [{ competitor, cp, latest }]
  const productComparisons = useMemo(() => {
    return products.map(p => {
      const rows = cps
        .filter(cp => cp.product_id === p.id)
        .map(cp => {
          const latest = latestPrices[cp.id]
          const competitor = competitors.find(c => c.id === cp.competitor_id)
          return {
            cp,
            competitor,
            latest,
          }
        })
        .filter(r => r.competitor)  // drop unlinked competitors
      // Also compute: min competitor price, avg, gap vs your price
      const withPrice = rows.filter(r => r.latest?.price != null)
      const prices   = withPrice.map(r => Number(r.latest.price))
      const minPrice = prices.length ? Math.min(...prices) : null
      const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null
      const yourPrice = p.current_price != null ? Number(p.current_price) : null
      const gapVsMinPct  = (yourPrice != null && minPrice != null) ? ((yourPrice - minPrice) / minPrice) * 100 : null
      const gapVsAvgPct  = (yourPrice != null && avgPrice != null) ? ((yourPrice - avgPrice) / avgPrice) * 100 : null
      // Product image: user's own override > first competitor's scraped image
      const image = p.image_url || rows.map(r => r.cp?.image_url).find(Boolean) || null
      return { product: p, rows, minPrice, avgPrice, yourPrice, gapVsMinPct, gapVsAvgPct, image }
    })
  }, [products, cps, competitors, latestPrices])

  // Filter + sort
  const visible = useMemo(() => {
    const query = q.trim().toLowerCase()
    return productComparisons
      .filter(pc => catFilter === 'all' || String(pc.product.category_id) === catFilter)
      .filter(pc => !query
        || pc.product.name.toLowerCase().includes(query)
        || (pc.product.sku || '').toLowerCase().includes(query)
        || (pc.product.brand || '').toLowerCase().includes(query))
      .sort((a, b) => {
        if (sortBy === 'name')       return a.product.name.localeCompare(b.product.name)
        if (sortBy === 'opportunity') {
          // Descending: most positive gap first (you're most overpriced vs cheapest competitor)
          return (b.gapVsMinPct ?? -Infinity) - (a.gapVsMinPct ?? -Infinity)
        }
        if (sortBy === 'threat') {
          // Ascending: most negative gap first (you're the cheapest by biggest margin)
          return (a.gapVsMinPct ?? Infinity) - (b.gapVsMinPct ?? Infinity)
        }
        if (sortBy === 'coverage') {
          const aRows = a.rows.filter(r => r.latest).length
          const bRows = b.rows.filter(r => r.latest).length
          return bRows - aRows
        }
        return 0
      })
  }, [productComparisons, q, catFilter, sortBy])

  // Perf guard — comparison table is wide (columns per competitor).
  // Cap at 300 rows to keep DOM under ~10K cells even with 30+ competitors.
  const RENDER_CAP = 300
  const capped = visible.length > RENDER_CAP
  const visibleRows = capped ? visible.slice(0, RENDER_CAP) : visible

  // Group by category, preserving the sort order within each group.
  // Uncategorised bucket lands last.
  const categoryGroups = useMemo(() => {
    const catById = Object.fromEntries(categories.map(c => [c.id, c]))
    const buckets = new Map()   // key: categoryId or 'uncat'
    for (const pc of visibleRows) {
      const key = pc.product.category_id ?? 'uncat'
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          name: catById[pc.product.category_id]?.name || 'Uncategorised',
          rows: [],
        })
      }
      buckets.get(key).rows.push(pc)
    }
    return [...buckets.values()].sort((a, b) => {
      if (a.key === 'uncat') return 1
      if (b.key === 'uncat') return -1
      return a.name.localeCompare(b.name)
    })
  }, [visibleRows, categories])

  const totalColumns = 4 + competitors.length   // sticky+your+cheapest+gap + per-competitor

  // Export the full FILTERED (not capped) comparison to Excel.
  // One row per product + one column per competitor.
  const exportXlsx = () => {
    const catById = Object.fromEntries(categories.map(c => [c.id, c]))
    const rows = visible.map(pc => {
      const base = {
        Category: catById[pc.product.category_id]?.name || 'Uncategorised',
        SKU: pc.product.sku,
        Product: pc.product.name,
        Brand: pc.product.brand || '',
        Currency: pc.product.currency_code || 'KWD',
        'Your Price': pc.yourPrice != null ? Number(pc.yourPrice.toFixed(3)) : null,
        'Cheapest Rival Price': pc.minPrice != null ? Number(pc.minPrice.toFixed(3)) : null,
        'Cheapest Rival': pc.rows
          .filter(r => r.latest?.price != null)
          .reduce((best, cur) => (!best || Number(cur.latest.price) < Number(best.latest.price) ? cur : best), null)
          ?.competitor?.name || '',
        'Avg Rival Price': pc.avgRival != null ? Number(pc.avgRival.toFixed(3)) : null,
        'Gap vs Cheapest %': pc.gapVsMinPct != null ? Number(pc.gapVsMinPct.toFixed(2)) : null,
        'Gap vs Avg %':      pc.gapVsAvgPct != null ? Number(pc.gapVsAvgPct.toFixed(2)) : null,
      }
      // Per-competitor price columns
      for (const comp of competitors) {
        const match = pc.rows.find(r => r.competitor.id === comp.id)
        base[comp.name] = match?.latest?.price != null
          ? Number(Number(match.latest.price).toFixed(3))
          : null
      }
      return base
    })
    if (rows.length === 0) return
    const ws = XLSX.utils.json_to_sheet(rows)
    // Auto column widths (rough)
    ws['!cols'] = Object.keys(rows[0]).map(k => ({
      wch: Math.max(k.length + 2, 14)
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Comparison')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const ts = new Date().toISOString().slice(0, 16).replace(':', '')
    const blob = new Blob([buf], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `price-comparison-${ts}.xlsx`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  const loading = pL || cL || lL || priceLoading
  const error   = pErr || cErr || lErr || priceErr

  // Summary counts
  const totalPriced   = productComparisons.filter(pc => pc.rows.filter(r => r.latest).length > 0).length
  const undercutting  = productComparisons.filter(pc => pc.gapVsMinPct != null && pc.gapVsMinPct < -1).length
  const overpricing   = productComparisons.filter(pc => pc.gapVsMinPct != null && pc.gapVsMinPct > 1).length
  const noLinks       = productComparisons.filter(pc => pc.rows.length === 0).length

  return (
    <div>
      <PageHeader
        kicker="Live Intelligence"
        title="Price Comparison"
        subtitle="Every product side-by-side with every competitor's latest known price. Sort by opportunity to see where your prices are highest relative to the market."
        action={
          <div className="flex items-center gap-2">
            <div className="text-[11px] text-ink-500 mr-1 tabular-nums hidden sm:block">
              {lastRefreshed
                ? `Refreshed ${relTime(lastRefreshed)}`
                : 'Not refreshed yet'}
            </div>
            <Button variant="secondary" onClick={refreshAll} busy={priceLoading} title="Reload from database (uses latest scraped values)">
              <RefreshCw size={14} /> Refresh
            </Button>
            <Button variant="secondary" onClick={exportXlsx} disabled={visible.length === 0}
              title={`Download ${visible.length} row${visible.length === 1 ? '' : 's'} as Excel — respects current filters`}>
              <Download size={14} /> Export
            </Button>
            {isManager && (
              <Button variant="gold" onClick={rescrapeAll} busy={rescraping}
                title="Queue a fresh scrape on every competitor — takes ~5 min">
                <Zap size={14} /> Re-scrape all
              </Button>
            )}
          </div>
        }
      />

      {rescrapeMsg && (
        <div className="mb-4 text-[12.5px] px-3 py-2 bg-brand-50 border border-brand-100 rounded-lg text-brand-800 inline-flex items-center gap-2">
          <Zap size={13} /> {rescrapeMsg}
        </div>
      )}

      {/* Summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatTile
          label="Products tracked" value={totalPriced}
          hint={`of ${productComparisons.length} total`} tone="ink" />
        <StatTile
          label="Where you're cheaper" value={undercutting}
          hint="Below the cheapest competitor" tone="emerald" />
        <StatTile
          label="Where you're pricier" value={overpricing}
          hint="Above the cheapest competitor" tone="red" />
        <StatTile
          label="Unlinked" value={noLinks}
          hint="No competitor URLs yet" tone="amber" />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" size={14} />
          <input className={`${inputCls} pl-9`}
            placeholder="Search SKU, name, brand…"
            value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <select className={`${selectCls} sm:w-56`} value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          <option value="all">All categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={`${selectCls} sm:w-56`} value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="opportunity">🎯 Where you're most expensive</option>
          <option value="threat">⚠️ Where you're most exposed</option>
          <option value="coverage">📊 Most competitor coverage</option>
          <option value="name">Name (A–Z)</option>
        </select>
      </div>

      <ErrorBlock error={error} />

      {capped && (
        <div className="mb-3 text-[11.5px] px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-amber-800 inline-flex items-center gap-2">
          Showing first {RENDER_CAP} rows of {visible.length}. Filter above to narrow down.
        </div>
      )}

      <Card className="overflow-hidden">
        {loading ? <LoadingBlock text="Building comparison" /> : visible.length === 0 ? (
          <Empty icon={GitCompare} title="Nothing to compare yet"
            description="Add products, competitors, and link them on the Linked Items page. Prices will appear as they're scraped." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-canvas-100 border-b border-ink-200">
                <tr>
                  <Th className="sticky left-0 bg-canvas-100 z-10 min-w-[240px]">Product</Th>
                  <Th className="text-right">Your Price</Th>
                  <Th className="text-right">Cheapest Rival</Th>
                  <Th className="text-right">Gap vs Lowest</Th>
                  {competitors.map(c => (
                    <Th key={c.id} className="text-right min-w-[130px]">
                      <div className="text-ink-800">{c.name}</div>
                      <div className="text-[9px] text-ink-400 normal-case tracking-normal">{c.domain}</div>
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {categoryGroups.map(group => (
                  <React.Fragment key={group.key}>
                    <tr className="bg-canvas-100 sticky top-0 z-20">
                      <td colSpan={totalColumns}
                          className="px-5 py-2.5 border-y border-ink-200">
                        <div className="flex items-baseline gap-3">
                          <div className="font-display text-[14px] tracking-tight text-ink-900">
                            {group.name}
                          </div>
                          <div className="text-[10.5px] uppercase tracking-[0.12em] text-ink-500 font-semibold">
                            {group.rows.length} product{group.rows.length === 1 ? '' : 's'}
                          </div>
                        </div>
                      </td>
                    </tr>
                    {group.rows.map(pc => (
                  <tr key={pc.product.id} className="hover:bg-canvas-100/60 transition-colors">
                    <Td className="sticky left-0 bg-white hover:bg-canvas-100/60 z-10">
                      <NavLink to="/prices" className="group flex items-center gap-3">
                        <ProductThumb src={pc.image} name={pc.product.name} />
                        <div className="min-w-0">
                          <div className="font-semibold text-ink-900 text-[13.5px] group-hover:text-brand-700 truncate">
                            {pc.product.name}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="font-mono text-[10.5px] text-ink-500">{pc.product.sku}</span>
                            {pc.product.brand && <span className="text-[10.5px] text-ink-400">· {pc.product.brand}</span>}
                          </div>
                        </div>
                      </NavLink>
                    </Td>
                    <Td className="text-right tabular-nums font-semibold text-ink-900">
                      {pc.yourPrice != null
                        ? `${symbolFor(pc.product.currency_code)} ${pc.yourPrice.toFixed(3)}`
                        : <span className="text-ink-300">—</span>}
                    </Td>
                    <Td className="text-right tabular-nums text-ink-700">
                      {pc.minPrice != null
                        ? `${symbolFor(pc.product.currency_code)} ${pc.minPrice.toFixed(3)}`
                        : <span className="text-ink-300">—</span>}
                    </Td>
                    <Td className="text-right">
                      <GapPill pct={pc.gapVsMinPct} />
                    </Td>
                    {competitors.map(c => {
                      const match = pc.rows.find(r => r.competitor.id === c.id)
                      if (!match) return <Td key={c.id} className="text-right"><span className="text-ink-200">·</span></Td>
                      const px = match.latest?.price
                      if (px == null) return (
                        <Td key={c.id} className="text-right">
                          <span className="text-[11px] text-ink-400 italic">no data</span>
                        </Td>
                      )
                      const cellPct = pc.yourPrice != null
                        ? ((pc.yourPrice - Number(px)) / Number(px)) * 100
                        : null
                      return (
                        <Td key={c.id} className="text-right tabular-nums">
                          <div className="flex flex-col items-end gap-0.5">
                            <a href={match.cp.url} target="_blank" rel="noopener noreferrer"
                              className="text-ink-800 hover:text-brand-700 inline-flex items-center gap-1 group">
                              {Number(px).toFixed(3)}
                              <ExternalLink size={9} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                            </a>
                            {cellPct != null && <MiniGap pct={cellPct} />}
                          </div>
                        </Td>
                      )
                    })}
                  </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4 text-[11px] text-ink-400 flex items-center gap-4 flex-wrap">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500"/> You're cheaper
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-red-500"/> You're pricier
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-ink-300"/> Within 1%
        </span>
      </div>
    </div>
  )
}

function StatTile({ label, value, hint, tone = 'ink' }) {
  const tones = {
    ink:     { icon: 'bg-ink-100 text-ink-700 border-ink-200' },
    emerald: { icon: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
    red:     { icon: 'bg-red-50 text-red-700 border-red-100' },
    amber:   { icon: 'bg-amber-50 text-amber-800 border-amber-100' },
  }
  return (
    <Card className="p-5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">{label}</div>
      <div className="font-display text-[30px] leading-none text-ink-900 mt-2 tabular-nums">{value}</div>
      <div className="text-[11px] text-ink-500 mt-1.5">{hint}</div>
    </Card>
  )
}

function GapPill({ pct }) {
  if (pct == null) return <span className="text-ink-300">—</span>
  const isFlat = Math.abs(pct) < 1
  if (isFlat) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-ink-100 text-ink-700 border border-ink-200">
      <Minus size={10} /> Flat
    </span>
  )
  const isOver = pct > 0
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border tabular-nums ${
      isOver
        ? 'bg-red-50 text-red-800 border-red-100'
        : 'bg-emerald-50 text-emerald-800 border-emerald-100'
    }`}>
      {isOver ? <ArrowUpRight size={10}/> : <ArrowDownRight size={10}/>}
      {isOver ? '+' : ''}{pct.toFixed(1)}%
    </span>
  )
}

function MiniGap({ pct }) {
  if (Math.abs(pct) < 1) return <span className="text-[10px] text-ink-400 tabular-nums">flat</span>
  const isOver = pct > 0
  return (
    <span className={`text-[10px] font-semibold tabular-nums ${isOver ? 'text-red-700' : 'text-emerald-700'}`}>
      {isOver ? '+' : ''}{pct.toFixed(1)}%
    </span>
  )
}

function symbolFor(code) {
  const map = { KWD:'KD', USD:'$', EUR:'€', AED:'AED', SAR:'SAR', GBP:'£' }
  return map[code] || code || ''
}

function ProductThumb({ src, name }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div className="w-11 h-11 rounded-lg bg-canvas-100 border border-ink-100 flex items-center justify-center text-ink-400 flex-shrink-0">
        <Package size={16} strokeWidth={1.5} />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      onError={() => setFailed(true)}
      className="w-11 h-11 rounded-lg object-cover border border-ink-100 bg-white flex-shrink-0"
    />
  )
}

function relTime(d) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 5)     return 'just now'
  if (s < 60)    return `${s}s ago`
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return d.toLocaleDateString()
}

function Th({ children, className = '' }) {
  return <th className={`px-4 py-3 text-left text-[10px] font-semibold text-ink-500 uppercase tracking-[0.12em] ${className}`}>{children}</th>
}
function Td({ children, className = '' }) {
  return <td className={`px-4 py-3.5 text-sm text-ink-800 ${className}`}>{children}</td>
}
