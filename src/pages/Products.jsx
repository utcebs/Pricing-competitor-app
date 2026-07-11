import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Package } from 'lucide-react'
import { useTable, saveRow, deleteRow } from '../lib/db'
import { useAuth } from '../lib/auth'
import {
  PageHeader, Card, Button, Modal, ConfirmDialog, Field,
  Empty, Badge, LoadingBlock, ErrorBlock, inputCls, selectCls, textareaCls,
} from '../components/UI'

export default function Products() {
  const { isManager } = useAuth()
  const { rows: products, loading, error, refresh } = useTable('products', { order: ['name', { ascending: true }] })
  const { rows: categories } = useTable('categories', { order: ['name', { ascending: true }] })
  const { rows: currencies } = useTable('currencies')

  const [editing, setEditing] = useState(null)   // null | 'new' | product object
  const [toDelete, setToDelete] = useState(null)

  const openNew = () => setEditing({})
  const openEdit = (p) => setEditing(p)
  const close = () => setEditing(null)

  const catName = (id) => categories.find(c => c.id === id)?.name || '—'
  const currencySymbol = (code) => currencies.find(c => c.code === code)?.symbol || code

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Your catalogue. SKU, category, cost, min price."
        action={isManager && (
          <Button onClick={openNew}><Plus size={15} /> Add product</Button>
        )}
      />

      <ErrorBlock error={error} onRetry={refresh} />

      <Card>
        {loading ? (
          <LoadingBlock />
        ) : products.length === 0 ? (
          <Empty
            icon={Package}
            title="No products yet"
            description="Add your first product so we can start tracking competitor prices against it."
            action={isManager && <Button onClick={openNew}><Plus size={15} /> Add first product</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <Th>SKU</Th><Th>Name</Th><Th>Brand</Th><Th>Category</Th>
                  <Th className="text-right">Cost</Th>
                  <Th className="text-right">Min</Th>
                  <Th className="text-right">Current</Th>
                  <Th>Own</Th>
                  {isManager && <Th></Th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <Td className="font-mono text-xs">{p.sku}</Td>
                    <Td className="font-medium">{p.name}</Td>
                    <Td className="text-slate-500">{p.brand || '—'}</Td>
                    <Td className="text-slate-500">{catName(p.category_id)}</Td>
                    <Td className="text-right tabular-nums text-slate-500">
                      {p.cost_price != null ? `${currencySymbol(p.currency_code)} ${Number(p.cost_price).toFixed(3)}` : '—'}
                    </Td>
                    <Td className="text-right tabular-nums text-slate-500">
                      {p.min_price != null ? `${currencySymbol(p.currency_code)} ${Number(p.min_price).toFixed(3)}` : '—'}
                    </Td>
                    <Td className="text-right tabular-nums font-medium">
                      {p.current_price != null ? `${currencySymbol(p.currency_code)} ${Number(p.current_price).toFixed(3)}` : '—'}
                    </Td>
                    <Td>{p.is_own_brand && <Badge variant="brand">Own</Badge>}</Td>
                    {isManager && (
                      <Td>
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(p)} className="p-1.5 rounded text-slate-400 hover:text-brand-600 hover:bg-brand-50"><Pencil size={14} /></button>
                          <button onClick={() => setToDelete(p)} className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
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

      <ProductForm
        open={editing !== null}
        product={editing}
        categories={categories}
        currencies={currencies}
        onClose={close}
        onSaved={() => { close(); refresh() }}
      />

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Delete product?"
        message={`This will permanently delete "${toDelete?.name}" and any competitor links tied to it will be unlinked.`}
        onConfirm={async () => {
          await deleteRow('products', toDelete.id)
          setToDelete(null); refresh()
        }}
      />
    </div>
  )
}

function ProductForm({ open, product, categories, currencies, onClose, onSaved }) {
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const isNew = !product?.id

  // Reset form whenever we open (with the edited row or empty defaults).
  useEffect(() => {
    if (!open) return
    setForm({
      sku: '', name: '', brand: '', category_id: '', description: '',
      cost_price: '', min_price: '', target_margin: '', current_price: '',
      currency_code: 'KWD', is_own_brand: false, is_active: true,
      ...product,
    })
    setErr('')
  }, [open, product?.id])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const payload = { ...form }
      // Coerce empty numeric strings to null
      ;['cost_price', 'min_price', 'target_margin', 'current_price'].forEach(k => {
        if (payload[k] === '' || payload[k] == null) payload[k] = null
        else payload[k] = Number(payload[k])
      })
      if (!payload.category_id) payload.category_id = null
      const { error } = await saveRow('products', payload)
      if (error) throw error
      onSaved()
    } catch (e) {
      setErr(e.message || 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'Add product' : `Edit ${product?.name}`} wide>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="SKU" required>
          <input className={inputCls} value={form.sku || ''} onChange={e => set('sku', e.target.value)} />
        </Field>
        <Field label="Name" required>
          <input className={inputCls} value={form.name || ''} onChange={e => set('name', e.target.value)} />
        </Field>
        <Field label="Brand">
          <input className={inputCls} value={form.brand || ''} onChange={e => set('brand', e.target.value)} />
        </Field>
        <Field label="Category">
          <select className={selectCls} value={form.category_id || ''} onChange={e => set('category_id', e.target.value)}>
            <option value="">—</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Currency">
          <select className={selectCls} value={form.currency_code || 'KWD'} onChange={e => set('currency_code', e.target.value)}>
            {currencies.map(c => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
          </select>
        </Field>
        <Field label="Cost price" hint="What you paid">
          <input type="number" step="0.001" className={inputCls} value={form.cost_price ?? ''} onChange={e => set('cost_price', e.target.value)} />
        </Field>
        <Field label="Min price" hint="Absolute repricing floor">
          <input type="number" step="0.001" className={inputCls} value={form.min_price ?? ''} onChange={e => set('min_price', e.target.value)} />
        </Field>
        <Field label="Current price" hint="Your live selling price">
          <input type="number" step="0.001" className={inputCls} value={form.current_price ?? ''} onChange={e => set('current_price', e.target.value)} />
        </Field>
        <Field label="Target margin %">
          <input type="number" step="0.01" className={inputCls} value={form.target_margin ?? ''} onChange={e => set('target_margin', e.target.value)} />
        </Field>
        <div className="flex items-center gap-4 pt-6">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={!!form.is_own_brand} onChange={e => set('is_own_brand', e.target.checked)} />
            Own-brand item
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.is_active !== false} onChange={e => set('is_active', e.target.checked)} />
            Active
          </label>
        </div>
        <div className="md:col-span-2">
          <Field label="Description">
            <textarea className={textareaCls} value={form.description || ''} onChange={e => set('description', e.target.value)} />
          </Field>
        </div>
      </div>

      {err && <div className="mt-4 text-sm text-red-600">{err}</div>}

      <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-100">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button busy={busy} onClick={submit}>{isNew ? 'Create' : 'Save'}</Button>
      </div>
    </Modal>
  )
}

function Th({ children, className = '' }) {
  return <th className={`px-4 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider ${className}`}>{children}</th>
}
function Td({ children, className = '' }) {
  return <td className={`px-4 py-3 text-sm text-slate-700 ${className}`}>{children}</td>
}
