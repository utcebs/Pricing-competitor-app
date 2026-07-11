import { useState, useEffect, useMemo } from 'react'
import { Plus, Pencil, Trash2, Bell, Mail, AlertCircle } from 'lucide-react'
import { useTable, saveRow, deleteRow } from '../lib/db'
import { useAuth } from '../lib/auth'
import {
  PageHeader, Card, Button, Modal, ConfirmDialog, Field,
  Empty, Badge, LoadingBlock, ErrorBlock, inputCls, selectCls,
} from '../components/UI'

const TRIGGERS = [
  { value: 'price_dropped',       label: 'Competitor price dropped' },
  { value: 'price_increased',     label: 'Competitor price increased' },
  { value: 'went_out_of_stock',   label: 'Competitor went out of stock' },
  { value: 'came_back_in_stock',  label: 'Competitor came back in stock' },
  { value: 'gap_pct_over',        label: 'Gap % rose above threshold' },
  { value: 'gap_pct_under',       label: 'Gap % fell below threshold' },
]

const SCOPES = [
  { value: 'any_product',         label: 'Any product' },
  { value: 'specific_product',    label: 'A specific product' },
  { value: 'specific_category',   label: 'A specific category' },
  { value: 'specific_competitor', label: 'A specific competitor' },
]

export default function Alerts() {
  const { user, isManager } = useAuth()
  const { rows: rules, loading, error, refresh } = useTable('alert_rules', {
    eq: ['owner_id', user?.id],
    order: ['created_at', { ascending: false }],
    deps: [user?.id],
  })
  const { rows: deliveries } = useTable('alert_deliveries', {
    order: ['created_at', { ascending: false }],
    limit: 20,
  })
  const { rows: products } = useTable('products')
  const { rows: categories } = useTable('categories')
  const { rows: competitors } = useTable('competitors')

  const [editing, setEditing] = useState(null)
  const [toDelete, setToDelete] = useState(null)

  return (
    <div>
      <PageHeader
        title="Alerts"
        subtitle="Rules that fire when competitor prices or stock change."
        action={<Button onClick={() => setEditing({})}><Plus size={15} /> New rule</Button>}
      />

      <div className="text-xs text-slate-500 mb-4 p-3 bg-amber-50 border border-amber-100 rounded-lg">
        <AlertCircle size={13} className="inline mr-1.5 text-amber-600 -mt-0.5" />
        Email delivery requires a Resend API key configured on the alerts worker.
        Rules will be evaluated but not delivered until the worker is deployed.
      </div>

      <ErrorBlock error={error} onRetry={refresh} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card>
            {loading ? <LoadingBlock /> : rules.length === 0 ? (
              <Empty
                icon={Bell}
                title="No alert rules yet"
                description="Add a rule so you get notified when competitor prices move."
                action={<Button onClick={() => setEditing({})}><Plus size={15} /> New rule</Button>}
              />
            ) : (
              <div className="divide-y divide-slate-100">
                {rules.map(r => {
                  const trigLabel = TRIGGERS.find(t => t.value === r.trigger)?.label || r.trigger
                  const scopeLabel = SCOPES.find(s => s.value === r.scope)?.label || r.scope
                  return (
                    <div key={r.id} className="p-4 hover:bg-slate-50 flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-900">{r.name}</div>
                        <div className="text-xs text-slate-500 mt-1">
                          <span className="font-medium">{trigLabel}</span>
                          {r.threshold_pct != null && ` (${r.threshold_pct}%)`}
                          {' · '}
                          {scopeLabel}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant={r.delivery === 'instant' ? 'brand' : 'slate'}>
                            <Mail size={10} className="mr-0.5" /> {r.delivery}
                          </Badge>
                          <Badge variant={r.is_active ? 'green' : 'slate'}>
                            {r.is_active ? 'Active' : 'Paused'}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setEditing(r)} className="p-1.5 rounded text-slate-400 hover:text-brand-600 hover:bg-brand-50"><Pencil size={14} /></button>
                        <button onClick={() => setToDelete(r)} className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </div>

        <div>
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Recent deliveries</h3>
            {deliveries.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">No alerts fired yet.</p>
            ) : (
              <div className="space-y-2">
                {deliveries.slice(0, 10).map(d => (
                  <div key={d.id} className="p-2 rounded bg-slate-50 text-xs">
                    <div className="font-medium text-slate-800">{d.event || 'Event'}</div>
                    <div className="text-slate-500 mt-0.5 flex items-center gap-2">
                      <Badge variant={d.delivery_status === 'sent' ? 'green' : d.delivery_status === 'failed' ? 'red' : 'slate'}>
                        {d.delivery_status}
                      </Badge>
                      {new Date(d.created_at).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <AlertForm
        open={editing !== null}
        rule={editing}
        products={products}
        categories={categories}
        competitors={competitors}
        userId={user?.id}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); refresh() }}
      />
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Delete rule?"
        message={`Delete "${toDelete?.name}"?`}
        onConfirm={async () => { await deleteRow('alert_rules', toDelete.id); setToDelete(null); refresh() }}
      />
    </div>
  )
}

function AlertForm({ open, rule, products, categories, competitors, userId, onClose, onSaved }) {
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const isNew = !rule?.id

  useEffect(() => {
    if (!open) return
    setForm({
      name: '', scope: 'any_product', scope_ref_id: '',
      trigger: 'price_dropped', threshold_pct: '',
      delivery: 'digest', is_active: true,
      owner_id: userId,
      ...rule,
    })
    setErr('')
  }, [open, rule?.id, userId])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const needsThreshold = ['gap_pct_over', 'gap_pct_under'].includes(form.trigger)
  const needsScopeRef = form.scope !== 'any_product'

  const scopeOptions = () => {
    if (form.scope === 'specific_product') return products.map(p => [p.id, `${p.sku} · ${p.name}`])
    if (form.scope === 'specific_category') return categories.map(c => [c.id, c.name])
    if (form.scope === 'specific_competitor') return competitors.map(c => [c.id, c.name])
    return []
  }

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const payload = { ...form }
      if (payload.scope === 'any_product') payload.scope_ref_id = null
      else payload.scope_ref_id = Number(payload.scope_ref_id) || null
      if (needsThreshold) payload.threshold_pct = Number(payload.threshold_pct)
      else payload.threshold_pct = null
      const { error } = await saveRow('alert_rules', payload)
      if (error) throw error
      onSaved()
    } catch (e) { setErr(e.message || 'Save failed') }
    finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'New alert rule' : `Edit ${rule?.name}`}>
      <div className="space-y-4">
        <Field label="Name" required>
          <input className={inputCls} value={form.name || ''} onChange={e => set('name', e.target.value)} />
        </Field>
        <Field label="Trigger" required>
          <select className={selectCls} value={form.trigger || ''} onChange={e => set('trigger', e.target.value)}>
            {TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        {needsThreshold && (
          <Field label="Threshold %" required hint="e.g. 10 = only fire when the gap is 10% or more">
            <input type="number" step="0.1" className={inputCls} value={form.threshold_pct ?? ''} onChange={e => set('threshold_pct', e.target.value)} />
          </Field>
        )}
        <Field label="Scope">
          <select className={selectCls} value={form.scope} onChange={e => set('scope', e.target.value)}>
            {SCOPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        {needsScopeRef && (
          <Field label="Pick one" required>
            <select className={selectCls} value={form.scope_ref_id || ''} onChange={e => set('scope_ref_id', e.target.value)}>
              <option value="">Select…</option>
              {scopeOptions().map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </Field>
        )}
        <Field label="Delivery">
          <select className={selectCls} value={form.delivery} onChange={e => set('delivery', e.target.value)}>
            <option value="instant">Instant (email as soon as it fires)</option>
            <option value="digest">Daily digest (one email at 9 AM)</option>
          </select>
        </Field>
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.is_active !== false} onChange={e => set('is_active', e.target.checked)} />
          Active
        </label>
      </div>
      {err && <div className="mt-4 text-sm text-red-600">{err}</div>}
      <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-100">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button busy={busy} onClick={submit}>{isNew ? 'Create' : 'Save'}</Button>
      </div>
    </Modal>
  )
}
