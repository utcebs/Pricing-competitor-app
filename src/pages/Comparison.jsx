import React, { useState, useEffect, useMemo, useRef } from 'react'
import { GitCompare, ArrowUpRight, ArrowDownRight, Minus, ExternalLink, Search, RefreshCw, Zap, Package, Download, AlertTriangle, Clock } from 'lucide-react'
import * as XLSX from 'xlsx'
import { NavLink } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useTable, fetchLatestPrices, fetchLatestStock } from '../lib/db'
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

  const [latestPrices, setLatestPrices] = useState({})   // { competitor_product_id: { price, captured_at } } — latest NON-suspect
  const [suspectCps, setSuspectCps] = useState({})       // { competitor_product_id: true } — a recent reading was flagged
  const [dataFreshAt, setDataFreshAt] = useState(null)   // newest captured_at across all prices
  const [latestStock, setLatestStock] = useState({})     // { competitor_product_id: boolean in_stock }
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

  // Latest price per competitor_product — computed server-side by the
  // get_latest_prices() DISTINCT ON RPC (one row per cp) instead of paging the
  // whole 60-day history to the browser. See fetchLatestPrices() in lib/db.
  useEffect(() => {
    let cancelled = false
    setPriceLoading(true); setPriceErr('')
    fetchLatestPrices(60)
      .then(({ prices, suspect, newest }) => {
        if (cancelled) return
        setLatestPrices(prices); setSuspectCps(suspect); setDataFreshAt(newest)
        setPriceLoading(false); setLastRefreshed(new Date())
      })
      .catch(e => { if (!cancelled) { setPriceErr(e.message || 'Fetch failed'); setPriceLoading(false) } })
    return () => { cancelled = true }
  }, [refreshTick])

  // Latest STOCK status per competitor_product — same server-side approach.
  useEffect(() => {
    let cancelled = false
    fetchLatestStock(60)
      .then(stock => { if (!cancelled) setLatestStock(stock) })
      .catch(() => {})   // stock is a nice-to-have; never block the grid
    return () => { cancelled = true }
  }, [refreshTick])

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
          // "Superseded": the item was scraped more recently than its last
          // recorded price → recent scrapes found NO price (discontinued /
          // removed from catalogue), so the stored price is stale and must
          // NOT be shown as current (this is the old warranty-price bug).
          const superseded = isPriceSuperseded(cp, latest)
          const effPrice = (latest?.price != null && !superseded) ? Number(latest.price) : null
          return { cp, competitor, latest, superseded, effPrice }
        })
        .filter(r => r.competitor)  // drop unlinked competitors
      // Compute min/avg/gap from EFFECTIVE (current, non-stale) prices only.
      const withPrice = rows.filter(r => r.effPrice != null)
      const prices   = withPrice.map(r => r.effPrice)
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

  // Progressive rendering — the table is wide (a column per competitor), so we
  // paint in batches instead of every row at once. NOTHING is hidden: the batch
  // grows as you scroll (an IntersectionObserver on a sentinel at the bottom)
  // or click "Load more". Resets to the first batch whenever the filter/sort
  // changes so you're not stranded deep in a long list after narrowing.
  const RENDER_BATCH = 100
  const [renderLimit, setRenderLimit] = useState(RENDER_BATCH)
  useEffect(() => { setRenderLimit(RENDER_BATCH) }, [q, catFilter, sortBy])
  const visibleRows = visible.slice(0, renderLimit)
  const hasMore = visible.length > renderLimit

  const loadMoreRef = useRef(null)
  useEffect(() => {
    if (!hasMore) return
    const el = loadMoreRef.current
    if (!el) return
    const io = new IntersectionObserver(
      entries => { if (entries[0]?.isIntersecting) setRenderLimit(n => n + RENDER_BATCH) },
      { rootMargin: '600px' },   // begin loading the next batch before it's on screen
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, renderLimit])

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

  // Running serial number where each category group starts, in display order,
  // so every product row can show a continuous line number (1..N).
  let _serialAcc = 0
  const groupSerialStart = categoryGroups.map(g => { const s = _serialAcc; _serialAcc += g.rows.length; return s })

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
          .filter(r => r.effPrice != null)
          .reduce((best, cur) => (!best || cur.effPrice < best.effPrice ? cur : best), null)
          ?.competitor?.name || '',
        'Avg Rival Price': pc.avgPrice != null ? Number(pc.avgPrice.toFixed(3)) : null,
        'Gap vs Cheapest %': pc.gapVsMinPct != null ? Number(pc.gapVsMinPct.toFixed(2)) : null,
        'Gap vs Avg %':      pc.gapVsAvgPct != null ? Number(pc.gapVsAvgPct.toFixed(2)) : null,
      }
      // Per-competitor price columns — effective (current, non-stale) price only.
      for (const comp of competitors) {
        const match = pc.rows.find(r => r.competitor.id === comp.id)
        const st = match ? latestStock[match.cp.id] : undefined
        base[comp.name] = !match ? null
          : match.effPrice != null ? Number(match.effPrice.toFixed(3))
          : (st === true || st === false) ? 'out of stock'
          : match.cp.last_seen_at ? 'invalid link'
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
            <div className="text-[11px] text-ink-500 mr-1 tabular-nums hidden sm:flex items-center gap-1.5"
              title="When the newest competitor price was scraped">
              {dataFreshAt
                ? <><Clock size={12} className="text-ink-400" /> Prices {relAge(dataFreshAt)}</>
                : lastRefreshed ? `Refreshed ${relTime(lastRefreshed)}` : 'Not refreshed yet'}
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

      {visible.length > 0 && (
        <div className="mb-3 text-[11.5px] text-ink-500 flex items-center gap-1.5">
          Showing <span className="font-semibold text-ink-700 tabular-nums">{Math.min(renderLimit, visible.length)}</span>
          of <span className="font-semibold text-ink-700 tabular-nums">{visible.length}</span> products
          {hasMore && <span className="text-ink-400">· scroll for more</span>}
        </div>
      )}

      <Card className="overflow-hidden">
        {loading ? <LoadingBlock text="Building comparison" /> : visible.length === 0 ? (
          <Empty icon={GitCompare} title="Nothing to compare yet"
            description="Add products, competitors, and link them on the Linked Items page. Prices will appear as they're scraped." />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-canvas-100 border-b border-ink-200">
                <tr>
                  <Th className="sticky left-0 bg-canvas-100 z-10 min-w-[240px]"><span className="text-ink-400">#</span>&nbsp;&nbsp;Product</Th>
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
                {categoryGroups.map((group, gi) => (
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
                    {group.rows.map((pc, ri) => (
                  <tr key={pc.product.id} className="hover:bg-canvas-100/60 transition-colors">
                    <Td className="sticky left-0 bg-white hover:bg-canvas-100/60 z-10">
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] tabular-nums text-ink-400 w-9 text-right shrink-0">
                          {groupSerialStart[gi] + ri + 1}
                        </span>
                        <NavLink to="/prices" className="group flex items-center gap-3 min-w-0">
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
                      </div>
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
                      const px = match.effPrice
                      if (px == null) {
                        // No current price. Distinguish three cases:
                        //  • we have a stock reading → product EXISTS but no price → "out of stock"
                        //  • scraped, no stock reading → dead/removed URL → "invalid link"
                        //  • never scraped → "no data"
                        const stock = latestStock[match.cp.id]
                        const knownStock = stock === true || stock === false
                        const scraped = !!match.cp.last_seen_at
                        const label = knownStock ? 'out of stock' : scraped ? 'invalid link' : 'no data'
                        const cls = knownStock ? 'font-medium text-amber-600'
                          : scraped ? 'font-medium text-red-500'
                            : 'text-ink-400 italic hover:text-brand-700'
                        const title = knownStock ? 'Valid product, currently out of stock (no price). Click to open.'
                          : scraped ? 'Invalid or removed — no product on the competitor page. Click to open.'
                            : 'Not scraped yet. Click to open.'
                        return (
                          <Td key={c.id} className="text-right">
                            <a href={match.cp.url} target="_blank" rel="noopener noreferrer" title={title}
                              className={`text-[11px] hover:underline inline-flex items-center gap-1 group ${cls}`}>
                              {label}
                              <ExternalLink size={9} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                            </a>
                          </Td>
                        )
                      }
                      const cellPct = pc.yourPrice != null
                        ? ((pc.yourPrice - Number(px)) / Number(px)) * 100
                        : null
                      const oos = latestStock[match.cp.id] === false
                      const suspect = !!suspectCps[match.cp.id]
                      const capAt = match.latest?.captured_at
                      const ageMs = capAt ? Date.now() - new Date(capAt).getTime() : null
                      const stale = ageMs != null && ageMs > STALE_HOURS * 3600 * 1000
                      const priceCls = oos ? 'text-amber-600' : stale ? 'text-ink-400' : 'text-ink-800 hover:text-brand-700'
                      const tip = [
                        capAt ? `scraped ${relAge(capAt)}` : null,
                        oos ? 'out of stock — last listed price' : null,
                        suspect ? 'a recent reading looked wrong and was ignored' : null,
                      ].filter(Boolean).join(' · ')
                      return (
                        <Td key={c.id} className="text-right tabular-nums">
                          <div className="flex flex-col items-end gap-0.5">
                            <a href={match.cp.url} target="_blank" rel="noopener noreferrer"
                              title={tip || undefined}
                              className={`inline-flex items-center gap-1 group ${priceCls}`}>
                              {suspect && <AlertTriangle size={11} className="text-amber-500 flex-shrink-0" />}
                              {Number(px).toFixed(3)}
                              <ExternalLink size={9} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                            </a>
                            {oos
                              ? <span className="text-[9px] font-semibold uppercase tracking-wide text-amber-600">out of stock</span>
                              : stale
                                ? <span className="text-[9px] text-ink-400">{relAge(capAt)}</span>
                                : cellPct != null && <MiniGap pct={cellPct} />}
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
          {hasMore && (
            <div ref={loadMoreRef} className="flex items-center justify-center py-4 border-t border-ink-100">
              <Button variant="secondary" onClick={() => setRenderLimit(n => n + RENDER_BATCH)}>
                Load more — {visible.length - renderLimit} remaining
              </Button>
            </div>
          )}
          </>
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
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-500"/> <span className="text-amber-600 font-semibold">Amber price</span> = out of stock
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

// Prices older than this (with no fresher reading) are shown faded — you're
// looking at stale data. Ongoing scraping refreshes every ~6h, so 24h = stale.
const STALE_HOURS = 24
function relAge(iso) {
  if (!iso) return ''
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// A stored price is "superseded" when the item has been scraped more recently
// than that price was captured — i.e. later scrapes found NO price (product
// discontinued / removed), so the last known price is stale and should not be
// shown as the current price. 10-min guard absorbs same-scrape timestamp jitter.
const STALE_PRICE_MS = 10 * 60 * 1000
function isPriceSuperseded(cp, latest) {
  if (!latest?.captured_at || !cp?.last_seen_at) return false
  return new Date(cp.last_seen_at).getTime() - new Date(latest.captured_at).getTime() > STALE_PRICE_MS
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
