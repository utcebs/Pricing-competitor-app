import { useState, useEffect, useMemo } from 'react'
import { CheckCircle2, XCircle, Target, RotateCcw, ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react'
import { useTable } from '../lib/db'
import { useAuth } from '../lib/auth'
import { supabase } from '../supabaseClient'
import { PageHeader, Card, Button, Empty, LoadingBlock, ErrorBlock } from '../components/UI'

// Only surface a product if you're more than this % above the cheapest rival.
const OVERPRICE_MIN_PCT = 1

function symbolFor(code) {
  const m = { KWD: 'KD', USD: '$', EUR: '€', AED: 'AED', SAR: 'SAR', GBP: '£' }
  return m[code] || code || ''
}

export default function RepriceChecklist() {
  const { user, isManager } = useAuth()
  const { rows: products, loading: pL, error: pErr } = useTable('products', { order: ['name', { ascending: true }] })
  const { rows: cps } = useTable('competitor_products')
  const { rows: competitors } = useTable('competitors', { eq: ['is_active', true] })
  const { rows: actions, refresh: refreshActions, error: aErr } = useTable('reprice_actions')

  const [latestPrice, setLatestPrice] = useState({})  // cpId -> number (fresh, non-suspect)
  const [latestStock, setLatestStock] = useState({})  // cpId -> boolean
  const [loadingPrices, setLoadingPrices] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [showResolved, setShowResolved] = useState(false)

  // Fresh (7-day), non-suspect prices + latest stock per competitor_product.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoadingPrices(true)
      const from = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
      const price = {}, stock = {}
      const paginate = async (table, cols, apply) => {
        const PAGE = 1000
        let c = cols
        for (let start = 0, page = 0; page < 30; page++, start += PAGE) {
          let { data, error } = await supabase.from(table).select(c)
            .gte('captured_at', from).order('captured_at', { ascending: false }).range(start, start + PAGE - 1)
          if (error && /is_suspect/.test(error.message || '') && c.includes('is_suspect')) { c = c.replace(', is_suspect', ''); page--; continue }
          if (error) break
          for (const r of (data || [])) apply(r)
          if (!data || data.length < PAGE) break
        }
      }
      await paginate('price_history', 'competitor_product_id, price, is_suspect', r => {
        const id = r.competitor_product_id
        if (r.is_suspect) return
        if (!(id in price)) price[id] = Number(r.price)
      })
      await paginate('stock_history', 'competitor_product_id, in_stock', r => {
        const id = r.competitor_product_id
        if (!(id in stock)) stock[id] = r.in_stock
      })
      if (!cancelled) { setLatestPrice(price); setLatestStock(stock); setLoadingPrices(false) }
    })()
    return () => { cancelled = true }
  }, [])

  const actionByProduct = useMemo(() => {
    const m = {}
    for (const a of actions) m[a.product_id] = a
    return m
  }, [actions])

  // Compute overpriced candidates: you're above the cheapest IN-STOCK rival.
  const candidates = useMemo(() => {
    const compById = Object.fromEntries(competitors.map(c => [c.id, c]))
    const out = []
    for (const p of products) {
      const yourPrice = p.current_price != null ? Number(p.current_price) : null
      if (yourPrice == null || yourPrice <= 0) continue
      const rivals = cps
        .filter(c => c.product_id === p.id)
        .map(c => ({ competitor: compById[c.competitor_id], price: latestPrice[c.id], inStock: latestStock[c.id], url: c.url }))
        .filter(r => r.competitor && r.price != null && r.inStock !== false)   // in-stock, fresh-priced rivals only
      if (!rivals.length) continue
      const cheapest = rivals.reduce((a, b) => (b.price < a.price ? b : a))
      const gap = yourPrice - cheapest.price
      const gapPct = (gap / cheapest.price) * 100
      if (gapPct <= OVERPRICE_MIN_PCT) continue   // not meaningfully overpriced
      const floor = p.min_price != null ? Number(p.min_price) : 0
      const target = +(cheapest.price - 0.001).toFixed(3)
      const suggested = Math.max(target, floor)
      const atFloor = suggested >= cheapest.price   // your floor won't beat them
      out.push({ product: p, yourPrice, cheapest, gap, gapPct, suggested, atFloor, currency: p.currency_code || 'KWD' })
    }
    return out.sort((a, b) => b.gap - a.gap)   // biggest money opportunity first
  }, [products, cps, competitors, latestPrice, latestStock])

  const active = candidates.filter(c => !actionByProduct[c.product.id])
  const resolvedList = useMemo(() => {
    const byId = Object.fromEntries(products.map(p => [p.id, p]))
    return actions.map(a => ({ action: a, product: byId[a.product_id] })).filter(r => r.product)
  }, [actions, products])

  const act = async (row, status) => {
    if (!isManager) return
    setBusyId(row.product.id)
    try {
      await supabase.from('reprice_actions').upsert({
        product_id: row.product.id, status,
        suggested_price: row.suggested, your_price: row.yourPrice, cheapest_price: row.cheapest.price,
        acted_by: user?.id, acted_at: new Date().toISOString(),
      }, { onConflict: 'product_id' })
      await refreshActions()
    } finally { setBusyId(null) }
  }
  const undo = async (productId) => {
    setBusyId(productId)
    try { await supabase.from('reprice_actions').delete().eq('product_id', productId); await refreshActions() }
    finally { setBusyId(null) }
  }

  const loading = pL || loadingPrices
  const migrationMissing = /reprice_actions/.test(aErr || '')
  const totalGap = active.reduce((s, r) => s + r.gap, 0)

  return (
    <div>
      <PageHeader kicker="Take action" title="Repricing checklist"
        subtitle="Products where you're priced above the cheapest in-stock competitor — with a suggested price that respects your minimum. Mark each Done or Ignore." />

      <ErrorBlock error={migrationMissing ? null : pErr} />
      {migrationMissing && (
        <div className="mb-4 text-[12.5px] px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-amber-800 inline-flex items-center gap-2">
          <ShieldAlert size={14} /> Run the migration <code className="font-mono">supabase/migrations/reprice-and-sanity.sql</code> to enable Done/Ignore.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <Tile label="Open opportunities" value={active.length} hint="You're above the cheapest rival" tone="amber" />
        <Tile label="Total gap" value={`KD ${totalGap.toFixed(3)}`} hint="Sum of overpricing across the list" tone="red" />
        <Tile label="Resolved" value={resolvedList.length} hint="Done or ignored" tone="ink" />
      </div>

      <Card className="overflow-hidden">
        {loading ? <LoadingBlock text="Finding opportunities" /> : active.length === 0 ? (
          <Empty icon={Target} title="All caught up"
            description="No products are priced above the cheapest in-stock competitor right now." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-canvas-100 border-b border-ink-200">
                <tr>
                  <Th>Product</Th>
                  <Th className="text-right">Your price</Th>
                  <Th className="text-right">Cheapest rival</Th>
                  <Th className="text-right">You're over by</Th>
                  <Th className="text-right">Suggested</Th>
                  {isManager && <Th className="text-right">Action</Th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {active.map(row => (
                  <tr key={row.product.id} className="hover:bg-canvas-100/60">
                    <Td>
                      <div className="font-medium text-ink-900 text-[13.5px]">{row.product.name}</div>
                      <div className="font-mono text-[10.5px] text-ink-500">{row.product.sku}</div>
                    </Td>
                    <Td className="text-right tabular-nums font-semibold">{symbolFor(row.currency)} {row.yourPrice.toFixed(3)}</Td>
                    <Td className="text-right tabular-nums">
                      <div>{symbolFor(row.currency)} {row.cheapest.price.toFixed(3)}</div>
                      <div className="text-[10.5px] text-ink-500">{row.cheapest.competitor.name}</div>
                    </Td>
                    <Td className="text-right">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-800 border border-red-100 tabular-nums">
                        +{row.gapPct.toFixed(1)}%
                      </span>
                      <div className="text-[10.5px] text-ink-500 tabular-nums">KD {row.gap.toFixed(3)}</div>
                    </Td>
                    <Td className="text-right tabular-nums">
                      <span className="font-semibold text-emerald-700">{symbolFor(row.currency)} {row.suggested.toFixed(3)}</span>
                      {row.atFloor && <div className="text-[10px] text-amber-700">at your floor</div>}
                    </Td>
                    {isManager && (
                      <Td>
                        <div className="flex items-center gap-2 justify-end">
                          <Button size="sm" variant="secondary" busy={busyId === row.product.id} onClick={() => act(row, 'done')}>
                            <CheckCircle2 size={14} /> Done
                          </Button>
                          <button onClick={() => act(row, 'ignored')} disabled={busyId === row.product.id}
                            className="text-[12px] font-medium text-ink-500 hover:text-ink-800 px-2 py-1 rounded hover:bg-ink-100 inline-flex items-center gap-1 disabled:opacity-50">
                            <XCircle size={14} /> Ignore
                          </button>
                        </div>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {resolvedList.length > 0 && (
        <div className="mt-6">
          <button onClick={() => setShowResolved(v => !v)}
            className="inline-flex items-center gap-2 text-[13px] font-semibold text-ink-700 hover:text-ink-900">
            {showResolved ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            Resolved ({resolvedList.length})
          </button>
          {showResolved && (
            <Card className="mt-3 overflow-hidden">
              <div className="divide-y divide-ink-100">
                {resolvedList.map(({ action, product }) => (
                  <div key={action.id} className="flex items-center justify-between px-5 py-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-ink-900 truncate">{product.name}</div>
                      <div className="text-[11px] text-ink-500">
                        <span className={action.status === 'done' ? 'text-emerald-700 font-semibold' : 'text-ink-500 font-semibold'}>
                          {action.status === 'done' ? '✓ Done' : '— Ignored'}
                        </span>
                        {action.suggested_price != null && ` · suggested KD ${Number(action.suggested_price).toFixed(3)}`}
                      </div>
                    </div>
                    {isManager && (
                      <button onClick={() => undo(product.id)} disabled={busyId === product.id}
                        className="text-[12px] text-ink-500 hover:text-brand-700 inline-flex items-center gap-1 disabled:opacity-50">
                        <RotateCcw size={13} /> Undo
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

function Tile({ label, value, hint, tone }) {
  const v = { amber: 'text-amber-700', red: 'text-red-700', ink: 'text-ink-900' }[tone] || 'text-ink-900'
  return (
    <Card className="p-5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">{label}</div>
      <div className={`font-display text-[26px] leading-none mt-2 tabular-nums ${v}`}>{value}</div>
      <div className="text-[11px] text-ink-500 mt-1.5">{hint}</div>
    </Card>
  )
}
function Th({ children, className = '' }) {
  return <th className={`px-4 py-2.5 text-left text-[10px] font-semibold text-ink-500 uppercase tracking-wider ${className}`}>{children}</th>
}
function Td({ children, className = '' }) {
  return <td className={`px-4 py-3 text-sm text-ink-700 ${className}`}>{children}</td>
}
