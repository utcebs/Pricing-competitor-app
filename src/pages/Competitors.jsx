import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Building2, ExternalLink, Upload } from 'lucide-react'
import { useTable, saveRow, deleteRow } from '../lib/db'
import { useAuth } from '../lib/auth'
import { supabase } from '../supabaseClient'
import {
  PageHeader, Card, Button, Modal, ConfirmDialog, Field,
  Empty, Badge, LoadingBlock, ErrorBlock, inputCls, textareaCls,
} from '../components/UI'
import BulkUpload from '../components/BulkUpload'

export default function Competitors() {
  const { isManager } = useAuth()
  const { rows: competitors, loading, error, refresh } = useTable('competitors', { order: ['name', { ascending: true }] })
  const [editing, setEditing] = useState(null)
  const [toDelete, setToDelete] = useState(null)
  const [bulkOpen, setBulkOpen] = useState(false)

  return (
    <div>
      <PageHeader
        title="Competitors"
        subtitle="Sites you're tracking. Each competitor holds many linked products."
        action={isManager && (
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setBulkOpen(true)}><Upload size={15} /> Bulk import</Button>
            <Button onClick={() => setEditing({})}><Plus size={15} /> Add competitor</Button>
          </div>
        )}
      />

      <ErrorBlock error={error} onRetry={refresh} />

      <Card>
        {loading ? <LoadingBlock /> : competitors.length === 0 ? (
          <Empty
            icon={Building2}
            title="No competitors yet"
            description="Add a competitor site to start tracking their prices."
            action={isManager && <Button onClick={() => setEditing({})}><Plus size={15} /> Add first competitor</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-canvas-100 border-b border-ink-200">
                <tr>
                  <Th>Name</Th><Th>Domain</Th><Th>Country</Th><Th>Status</Th>
                  {isManager && <Th></Th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {competitors.map(c => (
                  <tr key={c.id} className="hover:bg-canvas-100">
                    <Td className="font-medium">{c.name}</Td>
                    <Td>
                      <a href={`https://${c.domain}`} target="_blank" rel="noopener noreferrer"
                         className="text-brand-600 hover:underline inline-flex items-center gap-1">
                        {c.domain} <ExternalLink size={11} />
                      </a>
                    </Td>
                    <Td className="text-ink-500 text-xs uppercase">{c.country || '—'}</Td>
                    <Td>{c.is_active ? <Badge variant="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                    {isManager && (
                      <Td>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setEditing(c)} className="p-1.5 rounded text-ink-400 hover:text-brand-600 hover:bg-brand-50"><Pencil size={14} /></button>
                          <button onClick={() => setToDelete(c)} className="p-1.5 rounded text-ink-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
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

      <CompetitorForm open={editing !== null} competitor={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); refresh() }} />

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Delete competitor?"
        message={`This will remove "${toDelete?.name}" and CASCADE-delete every competitor product linked to it (plus their price/stock history).`}
        onConfirm={async () => { await deleteRow('competitors', toDelete.id); setToDelete(null); refresh() }}
      />

      <BulkUpload
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Bulk import competitors"
        templateFilename="competitors-template.csv"
        templateHeaders={['name','domain','country','notes','is_active']}
        sampleRows={[
          { name:'Xcite',    domain:'xcite.com',    country:'KW', notes:'Main KW electronics competitor', is_active:'true' },
          { name:'Best Al Yousifi', domain:'bestalyousifi.com', country:'KW', notes:'', is_active:'true' },
          { name:'Eureka',   domain:'eureka.com.kw', country:'KW', notes:'', is_active:'true' },
        ]}
        hint="domain: no https:// prefix. country: 2-letter ISO code (KW, SA, AE…)."
        transformRow={(row) => {
          if (!row.name?.trim() || !row.domain?.trim()) return { error: 'name and domain are required' }
          const bool = (v, def) => {
            const s = String(v || '').toLowerCase()
            if (s === 'true' || s === '1') return true
            if (s === 'false' || s === '0') return false
            return def
          }
          return {
            payload: {
              name: row.name.trim(),
              domain: row.domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, ''),
              country: row.country?.trim().toUpperCase().slice(0, 2) || null,
              notes: row.notes?.trim() || null,
              is_active: bool(row.is_active, true),
              scrape_config: {},
            }
          }
        }}
        onImport={async (payloads) => {
          const { data, error } = await supabase.from('competitors').insert(payloads).select()
          refresh()
          if (error) return { inserted: 0, failed: payloads.length, errors: [error.message] }
          return { inserted: data.length, failed: payloads.length - data.length, errors: [] }
        }}
      />
    </div>
  )
}

function CompetitorForm({ open, competitor, onClose, onSaved }) {
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const isNew = !competitor?.id

  const [scrapeConfigStr, setScrapeConfigStr] = useState('')
  useEffect(() => {
    if (!open) return
    setForm({ name: '', domain: '', country: '', notes: '', is_active: true, scrape_config: {}, ...competitor })
    setScrapeConfigStr(JSON.stringify(competitor?.scrape_config || {
      priceSelector: '',
      stockSelector: '',
      waitFor: '',
    }, null, 2))
    setErr('')
  }, [open, competitor?.id])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const payload = { ...form }
      // Normalise domain: strip protocol + trailing slash
      if (payload.domain) payload.domain = payload.domain.replace(/^https?:\/\//, '').replace(/\/$/, '')
      // Parse scrape_config JSON — fail early on malformed input
      try {
        payload.scrape_config = scrapeConfigStr.trim() ? JSON.parse(scrapeConfigStr) : {}
      } catch (e) {
        throw new Error('Scrape config JSON is invalid: ' + e.message)
      }
      const { error } = await saveRow('competitors', payload)
      if (error) throw error
      onSaved()
    } catch (e) { setErr(e.message || 'Save failed') }
    finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'Add competitor' : `Edit ${competitor?.name}`} wide>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Name" required>
          <input className={inputCls} value={form.name || ''} onChange={e => set('name', e.target.value)} />
        </Field>
        <Field label="Domain" required hint="e.g. competitor.com (no https://)">
          <input className={inputCls} value={form.domain || ''} onChange={e => set('domain', e.target.value)} />
        </Field>
        <Field label="Country" hint="ISO code — KW, SA, AE, etc.">
          <input className={inputCls} value={form.country || ''} onChange={e => set('country', e.target.value.toUpperCase())} maxLength={2} />
        </Field>
        <div className="flex items-center pt-6">
          <label className="inline-flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={form.is_active !== false} onChange={e => set('is_active', e.target.checked)} />
            Active
          </label>
        </div>
        <div className="md:col-span-2">
          <Field label="Notes">
            <textarea className={textareaCls} value={form.notes || ''} onChange={e => set('notes', e.target.value)} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Scrape config (JSON)" hint="CSS selectors the Playwright worker uses. Common keys: priceSelector, stockSelector, waitFor">
            <textarea
              className={textareaCls + ' font-mono text-xs'}
              rows={8}
              value={scrapeConfigStr}
              onChange={e => setScrapeConfigStr(e.target.value)}
              placeholder='{"priceSelector": ".price-tag", "stockSelector": ".availability", "waitFor": ".product-loaded"}'
            />
          </Field>
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

function Th({ children, className = '' }) {
  return <th className={`px-4 py-2.5 text-left text-[10px] font-semibold text-ink-500 uppercase tracking-wider ${className}`}>{children}</th>
}
function Td({ children, className = '' }) {
  return <td className={`px-4 py-3 text-sm text-ink-700 ${className}`}>{children}</td>
}
