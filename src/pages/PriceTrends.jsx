import { useState, useEffect, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { LineChart as LineIcon } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useTable } from '../lib/db'
import {
  PageHeader, Card, Empty, LoadingBlock, ErrorBlock, selectCls,
} from '../components/UI'

const COLORS = ['#4f46e5', '#ea580c', '#0891b2', '#16a34a', '#db2777', '#7c3aed', '#0284c7', '#65a30d']

export default function PriceTrends() {
  const { rows: products, loading: pL } = useTable('products', { order: ['name', { ascending: true }] })
  const { rows: cps }                    = useTable('competitor_products')
  const { rows: competitors }            = useTable('competitors')

  const [productId, setProductId] = useState('')
  const [rangeDays, setRangeDays] = useState(30)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  // Also include "my current price" as an extra line — pulled from the product row
  const myPrice = useMemo(() => products.find(p => String(p.id) === productId)?.current_price, [products, productId])

  const linkedCps = useMemo(
    () => cps.filter(c => String(c.product_id) === productId),
    [cps, productId]
  )
  const compById = useMemo(() => Object.fromEntries(competitors.map(c => [c.id, c])), [competitors])

  // Pull price_history for the linked competitor_products in the selected range.
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

  // Reshape long → wide: rows keyed by day, one column per competitor.
  const { chartData, seriesKeys } = useMemo(() => {
    const byDay = new Map()
    const keys = new Set()
    history.forEach(row => {
      const day = row.captured_at.slice(0, 10)
      const cp = linkedCps.find(l => l.id === row.competitor_product_id)
      const label = cp ? (compById[cp.competitor_id]?.name || `Competitor ${cp.competitor_id}`) : `#${row.competitor_product_id}`
      keys.add(label)
      const bucket = byDay.get(day) || { date: day }
      // If multiple prices in one day, keep the latest
      bucket[label] = row.price
      byDay.set(day, bucket)
    })
    // Overlay "your price" as a horizontal reference line if we have it
    if (myPrice != null) {
      keys.add('Your price')
      byDay.forEach(b => { b['Your price'] = Number(myPrice) })
    }
    return {
      chartData: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
      seriesKeys: [...keys],
    }
  }, [history, linkedCps, compById, myPrice])

  return (
    <div>
      <PageHeader
        title="Price Trends"
        subtitle="Competitor prices over time. Pick a product to compare against your own price."
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <select className={`${selectCls} sm:w-96`} value={productId} onChange={e => setProductId(e.target.value)}>
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

      <Card className="p-6">
        {pL ? (
          <LoadingBlock />
        ) : !productId ? (
          <Empty
            icon={LineIcon}
            title="Pick a product"
            description="Choose one of your products above to see how competitors are pricing it."
          />
        ) : linkedCps.length === 0 ? (
          <Empty
            icon={LineIcon}
            title="No competitor links for this product"
            description={'Go to "Linked Items" and match this SKU to competitor product pages first.'}
          />
        ) : loading ? (
          <LoadingBlock />
        ) : history.length === 0 ? (
          <Empty
            icon={LineIcon}
            title="No prices logged yet in this range"
            description="Log competitor prices manually from ‘Log a Price’ (or wait for Phase 2 scrapers)."
          />
        ) : (
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={v => Number(v).toFixed(2)} />
                <Tooltip formatter={v => v != null ? Number(v).toFixed(3) : '—'} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {seriesKeys.map((k, i) => (
                  <Line
                    key={k}
                    type="monotone"
                    dataKey={k}
                    stroke={k === 'Your price' ? '#0f172a' : COLORS[i % COLORS.length]}
                    strokeWidth={k === 'Your price' ? 2 : 2}
                    strokeDasharray={k === 'Your price' ? '5 3' : undefined}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  )
}
