import { useState, useEffect, useMemo } from 'react'
import { Plus, Pencil, Trash2, Link2, ExternalLink, Search, Upload } from 'lucide-react'
import { useTable, saveRow, deleteRow } from '../lib/db'
import { useAuth } from '../lib/auth'
import { supabase } from '../supabaseClient'
import {
  PageHeader, Card, Button, Modal, ConfirmDialog, Field,
  Empty, Badge, LoadingBlock, ErrorBlock, inputCls, selectCls,
} from '../components/UI'
import BulkUpload from '../components/BulkUpload'

export default function CompetitorProducts() {
  const { isManager } = useAuth()
  const { rows: items, loading, error, refresh } = useTable('competitor_products', { order: ['created_at', { ascending: false }] })
  const { rows: competitors } = useTable('competitors')
  const { rows: products } = useTable('products')
  const { rows: categories } = useTable('categories')

  const [editing, setEditing] = useState(null)
  const [toDelete, setToDelete] = useState(null)
  const [filterCompetitor, setFilterCompetitor] = useState('all')
  const [search, setSearch] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)

  const compById = useMemo(() => Object.fromEntries(competitors.map(c => [c.id, c])), [competitors])
  const prodById = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products])
  const catById  = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(i => {
      if (filterCompetitor !== 'all' && String(i.competitor_id) !== filterCompetitor) return false
      if (q && !i.name.toLowerCase().includes(q) && !(i.url || '').toLowerCase().includes(q)) return false
      return true
    })
  }, [items, filterCompetitor, search])

  return (
    <div>
      <PageHeader
        title="Linked Competitor Items"
        subtitle="Each row = one competitor's product page. Link it to one of yours (or leave unlinked for category-wise comparison)."
        action={isManager && (
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setBulkOpen(true)}><Upload size={15} /> Bulk import</Button>
            <Button onClick={() => setEditing({})}><Plus size={15} /> Add link</Button>
          </div>
        )}
      />

      <ErrorBlock error={error} onRetry={refresh} />

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" size={14} />
          <input className={`${inputCls} pl-9`} placeholder="Search name or URL…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className={`${selectCls} sm:w-56`} value={filterCompetitor} onChange={e => setFilterCompetitor(e.target.value)}>
          <option value="all">All competitors</option>
          {competitors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <Card>
        {loading ? <LoadingBlock /> : filtered.length === 0 ? (
          <Empty
            icon={Link2}
            title={items.length === 0 ? 'No competitor products yet' : 'No matches for those filters'}
            description={items.length === 0 ? 'Link a competitor URL to one of your own SKUs, or to a category for own-brand comparison.' : null}
            action={isManager && items.length === 0 && <Button onClick={() => setEditing({})}><Plus size={15} /> Add first link</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-canvas-100 border-b border-ink-200">
                <tr>
                  <Th>Competitor</Th><Th>Their product</Th><Th>Matched to</Th>
                  <Th>Category</Th><Th>Match</Th>
                  {isManager && <Th></Th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filtered.map(i => (
                  <tr key={i.id} className="hover:bg-canvas-100">
                    <Td className="font-medium">{compById[i.competitor_id]?.name || '—'}</Td>
                    <Td>
                      <div className="font-medium text-ink-800">{i.name}</div>
                      <a href={i.url} target="_blank" rel="noopener noreferrer"
                         className="text-[11px] text-brand-600 hover:underline inline-flex items-center gap-1">
                        {i.url.length > 60 ? i.url.slice(0, 60) + '…' : i.url} <ExternalLink size={10} />
                      </a>
                    </Td>
                    <Td>
                      {i.product_id
                        ? <span className="text-brand-700 font-medium">{prodById[i.product_id]?.name || `#${i.product_id}`}</span>
                        : <span className="text-ink-400 text-xs">Unmatched</span>}
                    </Td>
                    <Td className="text-ink-500 text-xs">{catById[i.category_id]?.name || '—'}</Td>
                    <Td>
                      <MatchBadge method={i.match_method} confidence={i.match_confidence} />
                    </Td>
                    {isManager && (
                      <Td>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setEditing(i)} className="p-1.5 rounded text-ink-400 hover:text-brand-600 hover:bg-brand-50"><Pencil size={14} /></button>
                          <button onClick={() => setToDelete(i)} className="p-1.5 rounded text-ink-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
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

      <LinkForm open={editing !== null} item={editing}
        competitors={competitors} products={products} categories={categories}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); refresh() }} />

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Remove link?"
        message={`Delete "${toDelete?.name}" and its price/stock history?`}
        onConfirm={async () => { await deleteRow('competitor_products', toDelete.id); setToDelete(null); refresh() }}
      />

      <BulkUpload
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Bulk import competitor product links"
        templateFilename="competitor-products-template.csv"
        templateHeaders={[
          'competitor_name','name','url','product_sku','competitor_sku','category_name',
        ]}
        sampleRows={[
          { competitor_name:'Xcite', name:'AquaBoil 1.7L Kettle', url:'https://xcite.com/p/kettle-17l',
            product_sku:'SKU-001', competitor_sku:'XC-101', category_name:'Home Appliances' },
          { competitor_name:'Xcite', name:'MixPro 800W Blender', url:'https://xcite.com/p/blender-800',
            product_sku:'SKU-002', competitor_sku:'XC-102', category_name:'Home Appliances' },
          { competitor_name:'Best Al Yousifi', name:'BestBoil 1.7L', url:'https://bestalyousifi.com/kettle-17',
            product_sku:'', competitor_sku:'', category_name:'Home Appliances' },
        ]}
        hint="competitor_name must exactly match a Competitor. product_sku is optional — leave blank for unmatched/own-brand comparison, then category_name gets used."
        transformRow={(row) => {
          if (!row.competitor_name?.trim() || !row.name?.trim() || !row.url?.trim())
            return { error: 'competitor_name, name and url are required' }
          const comp = competitors.find(c => c.name.toLowerCase() === row.competitor_name.trim().toLowerCase())
          if (!comp) return { error: `unknown competitor: ${row.competitor_name}` }
          let product = null
          if (row.product_sku?.trim()) {
            product = products.find(p => p.sku.toLowerCase() === row.product_sku.trim().toLowerCase())
            if (!product) return { error: `unknown product sku: ${row.product_sku}` }
          }
          let category = null
          if (row.category_name?.trim()) {
            category = categories.find(c => c.name.toLowerCase() === row.category_name.trim().toLowerCase())
            if (!category) return { error: `unknown category: ${row.category_name}` }
          }
          return {
            payload: {
              competitor_id: comp.id,
              product_id: product?.id || null,
              category_id: category?.id || null,
              name: row.name.trim(),
              url: row.url.trim(),
              competitor_sku: row.competitor_sku?.trim() || null,
              match_method: product ? 'manual' : (category ? 'category' : 'none'),
              is_active: true,
            }
          }
        }}
        onImport={async (payloads) => {
          const { data, error } = await supabase.from('competitor_products').insert(payloads).select()
          refresh()
          if (error) return { inserted: 0, failed: payloads.length, errors: [error.message] }
          return { inserted: data.length, failed: payloads.length - data.length, errors: [] }
        }}
      />
    </div>
  )
}

function MatchBadge({ method, confidence }) {
  if (method === 'manual')   return <Badge variant="brand">Manual</Badge>
  if (method === 'auto')     return <Badge variant="amber">Auto-found · {confidence ? `${Math.round(confidence * 100)}%` : 'review'}</Badge>
  if (method === 'category') return <Badge variant="green">Category</Badge>
  return <Badge>None</Badge>
}

function LinkForm({ open, item, competitors, products, categories, onClose, onSaved }) {
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const isNew = !item?.id

  useEffect(() => {
    if (!open) return
    setForm({
      competitor_id: '', product_id: '', category_id: '',
      competitor_sku: '', name: '', url: '',
      match_method: 'manual', is_active: true,
      ...item,
    })
    setErr('')
  }, [open, item?.id])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const payload = { ...form }
      ;['product_id', 'category_id', 'competitor_id'].forEach(k => {
        if (payload[k] === '' || payload[k] == null) payload[k] = null
        else payload[k] = Number(payload[k])
      })
      // If matched to a product, method → manual (unless already 'auto')
      if (payload.product_id && payload.match_method === 'none') payload.match_method = 'manual'
      if (!payload.product_id && !payload.category_id) payload.match_method = 'none'
      const { error } = await saveRow('competitor_products', payload)
      if (error) throw error
      onSaved()
    } catch (e) { setErr(e.message || 'Save failed') }
    finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'Add competitor product link' : `Edit ${item?.name}`} wide>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Competitor" required>
          <select className={selectCls} value={form.competitor_id || ''} onChange={e => set('competitor_id', e.target.value)}>
            <option value="">Select…</option>
            {competitors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Their SKU / code (optional)">
          <input className={inputCls} value={form.competitor_sku || ''} onChange={e => set('competitor_sku', e.target.value)} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Product name (on competitor site)" required>
            <input className={inputCls} value={form.name || ''} onChange={e => set('name', e.target.value)} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Product URL" required>
            <input type="url" className={inputCls} value={form.url || ''} onChange={e => set('url', e.target.value)} />
          </Field>
        </div>
        <Field label="Link to your product" hint="Leave blank if own-brand or category-only">
          <select className={selectCls} value={form.product_id || ''} onChange={e => set('product_id', e.target.value)}>
            <option value="">— unmatched —</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
          </select>
        </Field>
        <Field label="Category" hint="Used when unlinked (own-brand comparison)">
          <select className={selectCls} value={form.category_id || ''} onChange={e => set('category_id', e.target.value)}>
            <option value="">—</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      {err && <div className="mt-4 text-sm text-red-600">{err}</div>}
      <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-ink-100">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button busy={busy} onClick={submit}>{isNew ? 'Create' : 'Save'}</Button>
      </div>
    </Modal>
  )
}

function Th({ children }) { return <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-ink-500 uppercase tracking-wider">{children}</th> }
function Td({ children, className = '' }) { return <td className={`px-4 py-3 text-sm text-ink-700 ${className}`}>{children}</td> }
