import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { DollarSign, Save } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useTable } from '../lib/db'
import { useAuth } from '../lib/auth'
import {
  PageHeader, Card, Button, Field,
  Empty, ErrorBlock, LoadingBlock, inputCls, selectCls,
} from '../components/UI'

/**
 * PriceEntry — quick manual entry form for logging what a competitor
 * is currently charging + whether it's in stock. Writes to both
 * price_history and stock_history in one shot.
 */
export default function PriceEntry() {
  const { isManager } = useAuth()
  const navigate = useNavigate()
  const { rows: competitors, loading: cLoading } = useTable('competitors', { eq: ['is_active', true], order: ['name', { ascending: true }] })
  const { rows: cps, loading: cpLoading } = useTable('competitor_products', { eq: ['is_active', true] })
  const { rows: currencies } = useTable('currencies')

  const [competitorId, setCompetitorId] = useState('')
  const [cpId, setCpId] = useState('')
  const [price, setPrice] = useState('')
  const [currencyCode, setCurrencyCode] = useState('KWD')
  const [priceType, setPriceType] = useState('regular')
  const [inStock, setInStock] = useState(true)
  const [stockNote, setStockNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  const cpsForCompetitor = useMemo(
    () => cps.filter(x => String(x.competitor_id) === competitorId),
    [cps, competitorId]
  )

  useEffect(() => { setCpId('') }, [competitorId])

  if (!isManager) {
    return <Empty icon={DollarSign} title="Not permitted" description="Only admins and managers can log prices." />
  }

  const submit = async (e) => {
    e?.preventDefault?.()
    setBusy(true); setErr(''); setOk('')
    try {
      if (!cpId) throw new Error('Pick a competitor product first.')
      const p = parseFloat(price)
      if (!isFinite(p) || p < 0) throw new Error('Enter a valid price.')

      // Two inserts, run in parallel. Neither depends on the other.
      const [priceRes, stockRes] = await Promise.all([
        supabase.from('price_history').insert({
          competitor_product_id: Number(cpId),
          price: p,
          currency_code: currencyCode,
          price_type: priceType,
          source: 'manual',
        }),
        supabase.from('stock_history').insert({
          competitor_product_id: Number(cpId),
          in_stock: inStock,
          stock_note: stockNote || null,
          source: 'manual',
        }),
      ])
      if (priceRes.error) throw priceRes.error
      if (stockRes.error) throw stockRes.error

      // Also bump last_seen_at on the competitor_products row.
      await supabase.from('competitor_products')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', Number(cpId))

      setOk('Logged. Log another below or head back to the trend chart.')
      setPrice(''); setStockNote('')
    } catch (e) {
      setErr(e.message || 'Save failed')
    } finally { setBusy(false) }
  }

  if (cLoading || cpLoading) return <LoadingBlock />

  if (competitors.length === 0) {
    return (
      <div>
        <PageHeader title="Log a price" subtitle="Manually record a competitor's current price + stock." />
        <Empty icon={DollarSign} title="No competitors yet" description="Add a competitor first."
          action={<Button onClick={() => navigate('/competitors')}>Go to competitors</Button>} />
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Log a price" subtitle="Manually record a competitor's current price + stock. Feeds the trend chart." />
      <ErrorBlock error={err} />

      <Card className="p-6 max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Competitor" required>
              <select className={selectCls} value={competitorId} onChange={e => setCompetitorId(e.target.value)} required>
                <option value="">Select…</option>
                {competitors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Product on that site" required>
              <select className={selectCls} value={cpId} onChange={e => setCpId(e.target.value)} disabled={!competitorId} required>
                <option value="">{competitorId ? 'Select…' : 'Pick a competitor first'}</option>
                {cpsForCompetitor.map(cp => <option key={cp.id} value={cp.id}>{cp.name}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Price" required>
              <input className={inputCls} type="number" step="0.001" value={price} onChange={e => setPrice(e.target.value)} required />
            </Field>
            <Field label="Currency">
              <select className={selectCls} value={currencyCode} onChange={e => setCurrencyCode(e.target.value)}>
                {currencies.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select className={selectCls} value={priceType} onChange={e => setPriceType(e.target.value)}>
                <option value="regular">Regular</option>
                <option value="sale">Sale</option>
                <option value="clearance">Clearance</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Stock">
              <div className="flex items-center gap-4 pt-1">
                <label className="inline-flex items-center gap-1.5 text-sm">
                  <input type="radio" checked={inStock} onChange={() => setInStock(true)} /> In stock
                </label>
                <label className="inline-flex items-center gap-1.5 text-sm">
                  <input type="radio" checked={!inStock} onChange={() => setInStock(false)} /> Out of stock
                </label>
              </div>
            </Field>
            <Field label="Stock note" hint='"Only 3 left", "Ships in 5 days"'>
              <input className={inputCls} value={stockNote} onChange={e => setStockNote(e.target.value)} />
            </Field>
          </div>

          {ok && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{ok}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => navigate('/prices')}>View trends →</Button>
            <Button busy={busy} type="submit"><Save size={14} /> Log price</Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
