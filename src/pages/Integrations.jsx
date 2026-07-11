import { useState, useEffect, useMemo } from 'react'
import { Plug, Pencil, Trash2, Plus, ExternalLink, CheckCircle2, XCircle, AlertCircle, RefreshCw } from 'lucide-react'
import { useTable, saveRow, deleteRow } from '../lib/db'
import { useAuth } from '../lib/auth'
import {
  PageHeader, Card, Button, Modal, ConfirmDialog, Field,
  Empty, Badge, LoadingBlock, ErrorBlock, inputCls, selectCls, textareaCls,
} from '../components/UI'

const KINDS = [
  {
    value: 'dynamics_365', label: 'Microsoft Dynamics 365',
    fields: [
      { name: 'tenantId',     label: 'Azure Tenant ID',    hint: 'GUID' },
      { name: 'clientId',     label: 'App Client ID',      hint: 'GUID' },
      { name: 'clientSecret', label: 'Client Secret',      hint: 'Keep secret', type: 'password' },
      { name: 'resourceUrl',  label: 'Resource URL',       hint: 'e.g. https://yourorg.crm.dynamics.com' },
    ],
    docs: 'https://learn.microsoft.com/en-us/power-apps/developer/data-platform/authenticate-oauth',
  },
  {
    value: 'shopify', label: 'Shopify',
    fields: [
      { name: 'shopDomain',  label: 'Shop domain',        hint: 'yourstore.myshopify.com' },
      { name: 'accessToken', label: 'Admin API access token', type: 'password' },
    ],
    docs: 'https://shopify.dev/docs/admin-api/access-tokens',
  },
  {
    value: 'woocommerce', label: 'WooCommerce',
    fields: [
      { name: 'siteUrl',        label: 'Site URL',            hint: 'https://yoursite.com' },
      { name: 'consumerKey',    label: 'Consumer key' },
      { name: 'consumerSecret', label: 'Consumer secret', type: 'password' },
    ],
    docs: 'https://woocommerce.github.io/woocommerce-rest-api-docs/#authentication',
  },
  {
    value: 'bigcommerce', label: 'BigCommerce',
    fields: [
      { name: 'storeHash',   label: 'Store hash' },
      { name: 'accessToken', label: 'Access token', type: 'password' },
    ],
    docs: 'https://developer.bigcommerce.com/api-docs/getting-started/authentication/rest-api-authentication',
  },
  {
    value: 'magento', label: 'Magento 2',
    fields: [
      { name: 'baseUrl',     label: 'Base URL',           hint: 'https://yourstore.com/rest/V1' },
      { name: 'accessToken', label: 'Integration token', type: 'password' },
    ],
    docs: 'https://developer.adobe.com/commerce/webapi/get-started/authentication/gs-authentication-token/',
  },
  {
    value: 'google_analytics', label: 'Google Analytics',
    fields: [
      { name: 'propertyId', label: 'Property ID',       hint: 'GA4 property, e.g. 123456789' },
      { name: 'serviceAccountJson', label: 'Service account JSON', hint: 'Paste the full JSON key', type: 'textarea' },
    ],
    docs: 'https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart-service-account',
  },
]

export default function Integrations() {
  const { isManager } = useAuth()
  const { rows, loading, error, refresh } = useTable('integrations', {
    order: ['kind', { ascending: true }],
  })
  const { rows: syncLog } = useTable('integration_sync_log', {
    order: ['created_at', { ascending: false }],
    limit: 20,
  })

  const [editing, setEditing] = useState(null)
  const [toDelete, setToDelete] = useState(null)

  return (
    <div>
      <PageHeader
        title="Integrations"
        subtitle="External systems that receive price updates or supply data. Dynamics 365 is the primary target."
        action={isManager && <Button onClick={() => setEditing({})}><Plus size={15} /> Add integration</Button>}
      />

      <div className="text-xs text-ink-500 mb-4 p-3 bg-amber-50 border border-amber-100 rounded-lg">
        <AlertCircle size={13} className="inline mr-1.5 text-amber-600 -mt-0.5" />
        Adding an integration only stores credentials. The actual sync workers (that call Dynamics
        365 / Shopify / etc. APIs) run on the scraper worker deployment.
        Approved pricing proposals get pushed automatically.
      </div>

      <ErrorBlock error={error} onRetry={refresh} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <Card>
            {loading ? <LoadingBlock /> : rows.length === 0 ? (
              <Empty
                icon={Plug}
                title="No integrations yet"
                description="Add Dynamics 365 first so approved price changes can push there."
                action={isManager && <Button onClick={() => setEditing({})}><Plus size={15} /> Add first</Button>}
              />
            ) : (
              <div className="divide-y divide-ink-100">
                {rows.map(r => {
                  const kind = KINDS.find(k => k.value === r.kind)
                  return (
                    <div key={r.id} className="p-4 flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-ink-900">{r.name}</div>
                        <div className="text-xs text-ink-500 mt-0.5">{kind?.label || r.kind}</div>
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant={r.is_active ? 'green' : 'slate'}>
                            {r.is_active ? 'Active' : 'Paused'}
                          </Badge>
                          {r.last_sync_at && (
                            <span className="text-[10px] text-ink-400">
                              Last sync: {new Date(r.last_sync_at).toLocaleString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setEditing(r)} className="p-1.5 rounded text-ink-400 hover:text-brand-600 hover:bg-brand-50"><Pencil size={14} /></button>
                        <button onClick={() => setToDelete(r)} className="p-1.5 rounded text-ink-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
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
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-ink-800">Recent sync activity</h3>
              <button onClick={refresh} className="text-ink-400 hover:text-ink-700"><RefreshCw size={14} /></button>
            </div>
            {syncLog.length === 0 ? (
              <p className="text-xs text-ink-500">No syncs recorded yet.</p>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {syncLog.map(l => (
                  <div key={l.id} className="p-2 rounded bg-canvas-100 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium capitalize">{l.operation?.replace('_', ' ')}</span>
                      <Badge variant={l.status === 'ok' ? 'green' : l.status === 'failed' ? 'red' : 'amber'}>
                        {l.status === 'ok' && <CheckCircle2 size={10} className="mr-0.5" />}
                        {l.status === 'failed' && <XCircle size={10} className="mr-0.5" />}
                        {l.status}
                      </Badge>
                    </div>
                    <div className="text-ink-500 mt-0.5">
                      {new Date(l.created_at).toLocaleString()}
                      {l.duration_ms != null && ` · ${l.duration_ms}ms`}
                    </div>
                    {l.error_message && <div className="text-red-600 mt-1 break-all">{l.error_message}</div>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <IntegrationForm
        open={editing !== null}
        integration={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); refresh() }}
      />
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Delete integration?"
        message={`Delete "${toDelete?.name}"? Credentials will be wiped and pending sync log rows remain.`}
        onConfirm={async () => { await deleteRow('integrations', toDelete.id); setToDelete(null); refresh() }}
      />
    </div>
  )
}

function IntegrationForm({ open, integration, onClose, onSaved }) {
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const isNew = !integration?.id

  useEffect(() => {
    if (!open) return
    setForm({
      kind: 'dynamics_365', name: '', is_active: true, config: {},
      ...integration,
    })
    setErr('')
  }, [open, integration?.id])

  const kind = KINDS.find(k => k.value === form.kind) || KINDS[0]

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const { error } = await saveRow('integrations', form)
      if (error) throw error
      onSaved()
    } catch (e) { setErr(e.message || 'Save failed') }
    finally { setBusy(false) }
  }

  const setCfg = (key, val) => setForm(p => ({ ...p, config: { ...(p.config || {}), [key]: val } }))

  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'Add integration' : `Edit ${integration?.name}`} wide>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Kind" required>
          <select className={selectCls} value={form.kind} onChange={e => setForm(p => ({ ...p, kind: e.target.value, config: {} }))} disabled={!isNew}>
            {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </Field>
        <Field label="Name" required hint="Your label for this integration">
          <input className={inputCls} value={form.name || ''} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
        </Field>
        <div className="md:col-span-2">
          <div className="text-xs text-ink-500 mb-2">
            <ExternalLink size={11} className="inline mr-1" />
            <a href={kind.docs} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">
              Docs for {kind.label}
            </a>
          </div>
          <div className="space-y-3">
            {kind.fields.map(f => (
              <Field key={f.name} label={f.label} hint={f.hint}>
                {f.type === 'textarea' ? (
                  <textarea className={textareaCls} value={form.config?.[f.name] || ''} onChange={e => setCfg(f.name, e.target.value)} rows={5} />
                ) : (
                  <input className={inputCls} type={f.type || 'text'} value={form.config?.[f.name] || ''} onChange={e => setCfg(f.name, e.target.value)} />
                )}
              </Field>
            ))}
          </div>
        </div>
        <div className="md:col-span-2">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} />
            Active — the sync worker will use these credentials
          </label>
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
