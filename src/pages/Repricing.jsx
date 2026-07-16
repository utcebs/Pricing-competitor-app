import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Repeat, CheckCircle2, XCircle, AlertCircle, ArrowRight } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useTable, saveRow, deleteRow } from '../lib/db'
import { useAuth } from '../lib/auth'
import {
  PageHeader, Card, Button, Modal, ConfirmDialog, Field,
  Empty, Badge, LoadingBlock, ErrorBlock, inputCls, selectCls,
} from '../components/UI'

const STRATEGIES = [
  { value: 'match_lowest',        label: 'Match the lowest competitor price', valueLabel: null },
  { value: 'beat_lowest_by_pct',  label: 'Beat the lowest by X %',            valueLabel: 'Percent' },
  { value: 'beat_lowest_by_amt',  label: 'Beat the lowest by fixed amount',   valueLabel: 'Amount' },
  { value: 'match_average',       label: 'Match the average',                 valueLabel: null },
  { value: 'stay_x_pct_above',    label: 'Stay X % above lowest',             valueLabel: 'Percent' },
  { value: 'stay_x_pct_below',    label: 'Stay X % below lowest',             valueLabel: 'Percent' },
]
const SCOPES = [
  { value: 'all_products',      label: 'All products' },
  { value: 'specific_category', label: 'Specific category' },
  { value: 'specific_product',  label: 'Specific product' },
]

export default function Repricing() {
  const { isManager, isAdmin } = useAuth()
  const { rows: rules, loading, error, refresh } = useTable('pricing_rules', {
    order: ['priority', { ascending: true }],
  })
  const { rows: proposals, refresh: refreshProposals } = useTable('pricing_proposals', {
    eq: ['status', 'pending'],
    order: ['created_at', { ascending: false }],
  })
  const { rows: products } = useTable('products')
  const { rows: categories } = useTable('categories')

  const [editing, setEditing] = useState(null)
  const [toDelete, setToDelete] = useState(null)

  if (!isAdmin) return <Empty icon={Repeat} title="Admins only" description="Repricing rules affect live pricing decisions. Only administrators can view or edit them." />

  return (
    <div>
      <PageHeader
        title="Repricing"
        subtitle="Rules the engine uses to propose price changes. Approvals go to a queue before pushing to Dynamics 365."
        action={isManager && <Button onClick={() => setEditing({})}><Plus size={15} /> New rule</Button>}
      />

      <div className="text-xs text-ink-500 mb-4 p-3 bg-amber-50 border border-amber-100 rounded-lg">
        <AlertCircle size={13} className="inline mr-1.5 text-amber-600 -mt-0.5" />
        The rule engine runs on the scraper worker after each price fetch. Approved proposals
        are pushed to Dynamics 365 (or your configured integration) automatically.
      </div>

      <ErrorBlock error={error} onRetry={refresh} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <h2 className="text-sm font-semibold text-ink-800 mb-2">Rules</h2>
          <Card>
            {loading ? <LoadingBlock /> : rules.length === 0 ? (
              <Empty
                icon={Repeat}
                title="No rules yet"
                description="Add a rule to start proposing price changes based on competitor moves."
                action={isManager && <Button onClick={() => setEditing({})}><Plus size={15} /> First rule</Button>}
              />
            ) : (
              <div className="divide-y divide-ink-100">
                {rules.map(r => (
                  <div key={r.id} className="p-4 hover:bg-canvas-100 flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-ink-900">{r.name}</div>
                      <div className="text-xs text-ink-500 mt-1">
                        {STRATEGIES.find(s => s.value === r.strategy)?.label || r.strategy}
                        {r.strategy_value != null && ` (${r.strategy_value})`}
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant={r.is_active ? 'green' : 'slate'}>{r.is_active ? 'Active' : 'Paused'}</Badge>
                        <Badge variant={r.auto_apply ? 'brand' : 'amber'}>
                          {r.auto_apply ? 'Auto-apply' : 'Proposal → approve'}
                        </Badge>
                        <span className="text-[10px] text-ink-400">Priority {r.priority}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setEditing(r)} className="p-1.5 rounded text-ink-400 hover:text-brand-600 hover:bg-brand-50"><Pencil size={14} /></button>
                      <button onClick={() => setToDelete(r)} className="p-1.5 rounded text-ink-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-ink-800 mb-2">Pending proposals ({proposals.length})</h2>
          <Card>
            {proposals.length === 0 ? (
              <Empty
                icon={CheckCircle2}
                title="No pending proposals"
                description="Rules fire whenever competitor prices update. Any change waiting on your approval will appear here."
              />
            ) : (
              <div className="divide-y divide-ink-100">
                {proposals.map(p => (
                  <ProposalRow key={p.id} proposal={p} products={products} onDecided={refreshProposals} />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <RuleForm
        open={editing !== null}
        rule={editing}
        products={products}
        categories={categories}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); refresh() }}
      />
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Delete rule?"
        message={`Delete "${toDelete?.name}"? Pending proposals from this rule will be marked skipped.`}
        onConfirm={async () => { await deleteRow('pricing_rules', toDelete.id); setToDelete(null); refresh() }}
      />
    </div>
  )
}

function ProposalRow({ proposal, products, onDecided }) {
  const [busy, setBusy] = useState(null)
  const { user } = useAuth()
  const p = products.find(x => x.id === proposal.product_id)

  const decide = async (status) => {
    setBusy(status)
    await supabase.from('pricing_proposals')
      .update({ status, reviewed_by: user?.id, reviewed_at: new Date().toISOString() })
      .eq('id', proposal.id)
    // If approved and not auto — send to integration sync log (stub)
    if (status === 'approved') {
      await supabase.from('integration_sync_log').insert({
        integration_id: null, // will be resolved by the sync worker
        operation: 'push_price',
        status: 'running',
        request_payload: {
          product_id: proposal.product_id,
          new_price: proposal.suggested_price,
        },
      })
    }
    setBusy(null); onDecided()
  }

  return (
    <div className="p-4 flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{p?.name || `Product ${proposal.product_id}`}</div>
        <div className="text-xs text-ink-500 mt-0.5 flex items-center gap-2">
          <span className="tabular-nums">{Number(proposal.current_price ?? 0).toFixed(3)}</span>
          <ArrowRight size={11} />
          <span className="tabular-nums font-semibold text-brand-700">
            {Number(proposal.suggested_price).toFixed(3)}
          </span>
        </div>
        {proposal.reason && <div className="text-[11px] text-ink-500 mt-1">{proposal.reason}</div>}
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <Button size="sm" variant="primary" busy={busy === 'approved'} onClick={() => decide('approved')}>
          <CheckCircle2 size={12} /> Approve
        </Button>
        <Button size="sm" variant="secondary" busy={busy === 'rejected'} onClick={() => decide('rejected')}>
          <XCircle size={12} /> Reject
        </Button>
      </div>
    </div>
  )
}

function RuleForm({ open, rule, products, categories, onClose, onSaved }) {
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const isNew = !rule?.id

  useEffect(() => {
    if (!open) return
    setForm({
      name: '', is_active: true, scope: 'all_products', scope_ref_id: '',
      strategy: 'match_lowest', strategy_value: '',
      respect_min_price: true, respect_target_margin: true,
      only_if_competitor_in_stock: true, auto_apply: false,
      priority: 100,
      ...rule,
    })
    setErr('')
  }, [open, rule?.id])

  const strat = STRATEGIES.find(s => s.value === form.strategy) || STRATEGIES[0]
  const needsValue = strat.valueLabel != null

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const payload = { ...form }
      payload.priority = Number(payload.priority) || 100
      payload.scope_ref_id = payload.scope === 'all_products' ? null : (Number(payload.scope_ref_id) || null)
      payload.strategy_value = needsValue ? Number(payload.strategy_value) : null
      const { error } = await saveRow('pricing_rules', payload)
      if (error) throw error
      onSaved()
    } catch (e) { setErr(e.message || 'Save failed') }
    finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'New pricing rule' : `Edit ${rule?.name}`} wide>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <Field label="Name" required>
            <input className={inputCls} value={form.name || ''} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
          </Field>
        </div>
        <Field label="Strategy" required>
          <select className={selectCls} value={form.strategy} onChange={e => setForm(p => ({ ...p, strategy: e.target.value }))}>
            {STRATEGIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        {needsValue && (
          <Field label={strat.valueLabel} required>
            <input type="number" step="0.01" className={inputCls} value={form.strategy_value ?? ''} onChange={e => setForm(p => ({ ...p, strategy_value: e.target.value }))} />
          </Field>
        )}
        <Field label="Scope">
          <select className={selectCls} value={form.scope} onChange={e => setForm(p => ({ ...p, scope: e.target.value }))}>
            {SCOPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        {form.scope !== 'all_products' && (
          <Field label="Pick one" required>
            <select className={selectCls} value={form.scope_ref_id || ''} onChange={e => setForm(p => ({ ...p, scope_ref_id: e.target.value }))}>
              <option value="">Select…</option>
              {(form.scope === 'specific_product' ? products : categories).map(x => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Priority" hint="Lower = higher priority. Ties broken by lower id.">
          <input type="number" className={inputCls} value={form.priority ?? 100} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))} />
        </Field>
        <div />
        <div className="md:col-span-2 space-y-2 text-sm">
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.respect_min_price} onChange={e => setForm(p => ({ ...p, respect_min_price: e.target.checked }))} /> Never drop below product's <code>min_price</code></label>
          <label className="block"><input type="checkbox" className="mr-2" checked={form.respect_target_margin} onChange={e => setForm(p => ({ ...p, respect_target_margin: e.target.checked }))} /> Keep margin above target</label>
          <label className="block"><input type="checkbox" className="mr-2" checked={form.only_if_competitor_in_stock} onChange={e => setForm(p => ({ ...p, only_if_competitor_in_stock: e.target.checked }))} /> Ignore out-of-stock competitors</label>
          <label className="block"><input type="checkbox" className="mr-2" checked={form.auto_apply} onChange={e => setForm(p => ({ ...p, auto_apply: e.target.checked }))} /> Auto-apply (skip approval queue)</label>
          <label className="block"><input type="checkbox" className="mr-2" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} /> Active</label>
        </div>
      </div>
      {err && <div className="mt-4 text-sm text-red-600">{err}</div>}
      <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-ink-100">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button busy={busy} onClick={submit}>{isNew ? 'Create' : 'Save'}</Button>
      </div>
    </Modal>
  )
}
