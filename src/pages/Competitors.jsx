import { useState, useEffect, useRef, useMemo } from 'react'
import { Plus, Pencil, Trash2, Building2, ExternalLink, Upload, Zap, CheckCircle2, AlertTriangle, XCircle, Loader2 } from 'lucide-react'
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
  const { rows: cps } = useTable('competitor_products')
  const [editing, setEditing] = useState(null)
  const [toDelete, setToDelete] = useState(null)
  const [bulkOpen, setBulkOpen] = useState(false)

  // Scrape health: of each competitor's tracked items, how many have a fresh
  // (last 24h), non-suspect price? Surfaces a broken fast-path immediately.
  const [freshCps, setFreshCps] = useState(null)  // Set of cp ids with a fresh good price
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
      const set = new Set(); const PAGE = 1000
      let cols = 'competitor_product_id, is_suspect'
      for (let start = 0, page = 0; page < 30; page++, start += PAGE) {
        let { data, error } = await supabase.from('price_history').select(cols)
          .gte('captured_at', from).order('captured_at', { ascending: false }).range(start, start + PAGE - 1)
        if (error && /is_suspect/.test(error.message || '') && cols.includes('is_suspect')) { cols = 'competitor_product_id'; page--; continue }
        if (error) break
        for (const r of (data || [])) if (!r.is_suspect) set.add(r.competitor_product_id)
        if (!data || data.length < PAGE) break
      }
      if (!cancelled) setFreshCps(set)
    })()
    return () => { cancelled = true }
  }, [])

  const health = useMemo(() => {
    const by = {}
    for (const c of cps) {
      if (!c.product_id) continue
      const h = by[c.competitor_id] || (by[c.competitor_id] = { linked: 0, priced: 0 })
      h.linked++
      if (freshCps && freshCps.has(c.id)) h.priced++
    }
    return by
  }, [cps, freshCps])

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
                  <Th>Name</Th><Th>Domain</Th><Th>Country</Th><Th>Scrape health</Th><Th>Status</Th>
                  {isManager && <Th></Th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {competitors.map(c => (
                  <tr key={c.id} className="hover:bg-canvas-100">
                    <Td>
                      <div className="flex items-center gap-3">
                        <CompetitorLogo domain={c.domain} name={c.name} />
                        <span className="font-medium">{c.name}</span>
                      </div>
                    </Td>
                    <Td>
                      <a href={`https://${c.domain}`} target="_blank" rel="noopener noreferrer"
                         className="text-brand-600 hover:underline inline-flex items-center gap-1">
                        {c.domain} <ExternalLink size={11} />
                      </a>
                    </Td>
                    <Td className="text-ink-500 text-xs uppercase">{c.country || '—'}</Td>
                    <Td><HealthChip h={health[c.id]} loading={freshCps === null} /></Td>
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
        message={`This will permanently delete "${toDelete?.name}", every product URL linked under it, all price/stock history captured for those URLs, every scrape run and job, match suggestions, and alert rules targeting this competitor. This can't be undone.`}
        onConfirm={async () => {
          // competitors delete cascades (competitor_products, scrape_runs,
          // url_find_jobs, then everything hanging off competitor_products).
          // The only orphan risk is alert_rules.scope_ref_id — polymorphic
          // pointer, no FK — clean up first.
          await supabase.from('alert_rules').delete()
            .eq('scope', 'specific_competitor').eq('scope_ref_id', toDelete.id)
          await deleteRow('competitors', toDelete.id)
          setToDelete(null); refresh()
        }}
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
      // Parse scrape_config JSON — fail early on malformed input.
      // Strip empty-string values so the worker falls through to its
      // built-in selector cascade instead of trying to match "" literally.
      try {
        const parsed = scrapeConfigStr.trim() ? JSON.parse(scrapeConfigStr) : {}
        payload.scrape_config = Object.fromEntries(
          Object.entries(parsed).filter(([, v]) => v !== '' && v != null)
        )
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
        <Field label="Domain" required hint="e.g. competitor.com (no https://). Logo appears automatically from the domain.">
          <div className="flex items-center gap-2">
            <input className={`${inputCls} flex-1`} value={form.domain || ''} onChange={e => set('domain', e.target.value)} placeholder="competitor.com" />
            {form.domain?.trim() && (
              <CompetitorLogo domain={form.domain.trim()} name={form.name} size={36} />
            )}
          </div>
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
          <ProbeTester competitorId={competitor?.id} />
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

/* ── Per-competitor scrape health chip ── */
function HealthChip({ h, loading }) {
  if (loading) return <span className="text-[11px] text-ink-400">…</span>
  if (!h || h.linked === 0) return <span className="text-[11px] text-ink-400">— no tracked items</span>
  const rate = Math.round((h.priced / h.linked) * 100)
  const cls = rate >= 90 ? 'text-emerald-700 bg-emerald-50 border-emerald-100'
    : rate >= 60 ? 'text-amber-700 bg-amber-50 border-amber-100'
      : 'text-red-700 bg-red-50 border-red-100'
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}
      title={`${h.priced} of ${h.linked} tracked items have a fresh price (last 24h). A low number means a site changed or the fast-path broke.`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />{rate}% priced
      <span className="font-normal opacity-70">· {h.priced}/{h.linked}</span>
    </span>
  )
}

/* ── Compatibility probe: test a sample product URL before committing ── */
function prettyMethod(m) {
  if (!m) return ''
  const s = m.replace(/^api:/, '')
  const map = {
    'generic:json-ld': 'JSON-LD (schema.org)',
    'generic:shopify': 'Shopify API',
    'generic:meta': 'meta tags',
    'xcite-nextdata': 'Xcite (built-in)',
    'eureka-algolia': 'Eureka API (built-in)',
    'best-occ': 'Best Al-Yousifi API (built-in)',
    'browser': 'headless browser',
  }
  return map[s] || s
}

function ProbeTester({ competitorId }) {
  const { user } = useAuth()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)   // probe result object
  const [err, setErr] = useState('')
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  const run = async () => {
    if (!url.trim()) return
    setBusy(true); setErr(''); setResult(null)
    const { data, error } = await supabase.from('probe_jobs')
      .insert({ url: url.trim(), competitor_id: competitorId || null, triggered_by: user?.id })
      .select('id').single()
    if (error) {
      setBusy(false)
      setErr(/probe_jobs/.test(error.message || '')
        ? 'Probe not ready — an admin needs to run supabase/migrations/probe-jobs.sql.'
        : error.message)
      return
    }
    let tries = 0
    const poll = async () => {
      tries++
      const { data: job } = await supabase.from('probe_jobs').select('status,result').eq('id', data.id).single()
      if (job && (job.status === 'done' || job.status === 'error')) { setBusy(false); setResult(job.result || {}); return }
      if (tries > 40) { setBusy(false); setErr('Timed out — is the worker running?'); return }
      timer.current = setTimeout(poll, 2000)
    }
    poll()
  }

  // Map result → banner style
  let banner = null
  if (result) {
    if (result.ok && result.price != null) {
      banner = { tone: 'good', Icon: CheckCircle2, title: `Auto-detected — no browser needed`,
        body: `Read via ${prettyMethod(result.method)} · price KD ${Number(result.price).toFixed(3)}${result.inStock === false ? ' · out of stock' : ''}` }
    } else if (result.ok && result.outOfStock) {
      banner = { tone: 'warn', Icon: AlertTriangle, title: 'Valid product — currently out of stock',
        body: `Detected via ${prettyMethod(result.method)}, but no price shown right now.` }
    } else if (result.needsBrowser) {
      banner = { tone: 'warn', Icon: AlertTriangle, title: 'No API detected — will use the browser',
        body: 'The page loads but exposes no readable price API. Scraping will fall back to a headless browser (slower, and may need a proxy for a bot-protected site).' }
    } else if (result.invalid) {
      banner = { tone: 'crit', Icon: XCircle, title: 'Product not found',
        body: 'That URL 404s or has no product — it would show as an invalid link.' }
    } else if (result.error) {
      banner = { tone: 'crit', Icon: XCircle, title: 'Probe failed', body: result.error }
    } else {
      banner = { tone: 'warn', Icon: AlertTriangle, title: 'Undetermined', body: 'Could not read a price.' }
    }
  }
  const toneCls = {
    good: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    warn: 'bg-amber-50 border-amber-200 text-amber-800',
    crit: 'bg-red-50 border-red-200 text-red-800',
  }

  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-4">
      <div className="flex items-center gap-2 mb-1">
        <Zap size={14} className="text-brand-600" />
        <span className="text-[13px] font-semibold text-ink-900">Test compatibility</span>
      </div>
      <p className="text-[11.5px] text-ink-500 mb-3 leading-relaxed">
        Paste any product URL from this competitor to check — before you add products — whether we can read its price automatically (no browser) or it'll need the slower browser path.
      </p>
      <div className="flex items-center gap-2">
        <input type="url" className={`${inputCls} flex-1`} placeholder="https://competitor.com/product-page"
          value={url} onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); run() } }} />
        <Button variant="secondary" onClick={run} disabled={busy || !url.trim()}>
          {busy ? <><Loader2 size={14} className="animate-spin" /> Testing…</> : <><Zap size={14} /> Test</>}
        </Button>
      </div>
      {busy && <div className="text-[11.5px] text-ink-500 mt-2">Queued to the worker — result in a few seconds…</div>}
      {err && <div className="text-[12px] text-red-600 mt-2">{err}</div>}
      {banner && (
        <div className={`mt-3 rounded-lg border px-3 py-2.5 flex items-start gap-2.5 ${toneCls[banner.tone]}`}>
          <banner.Icon size={16} className="flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-[12.5px] font-semibold">{banner.title}</div>
            <div className="text-[11.5px] mt-0.5 leading-relaxed">{banner.body}</div>
          </div>
        </div>
      )}
    </div>
  )
}

function Th({ children, className = '' }) {
  return <th className={`px-4 py-2.5 text-left text-[10px] font-semibold text-ink-500 uppercase tracking-wider ${className}`}>{children}</th>
}
function Td({ children, className = '' }) {
  return <td className={`px-4 py-3 text-sm text-ink-700 ${className}`}>{children}</td>
}

/**
 * CompetitorLogo — renders the site's favicon via Google's public
 * favicon service (no signup, HTTPS, cached by Google's CDN). Falls
 * back to a Building icon if the image fails to load.
 * Docs: https://www.google.com/s2/favicons?domain=<domain>&sz=64
 */
export function CompetitorLogo({ domain, name, size = 40 }) {
  const [failed, setFailed] = useState(false)
  const clean = String(domain || '').replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '')
  if (!clean || failed) {
    return (
      <div className="rounded-lg bg-canvas-100 border border-ink-100 flex items-center justify-center text-ink-400 flex-shrink-0"
           style={{ width: size, height: size }}>
        <Building2 size={Math.round(size * 0.5)} strokeWidth={1.5} />
      </div>
    )
  }
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${clean}&sz=64`}
      alt={name || clean}
      onError={() => setFailed(true)}
      loading="lazy"
      className="rounded-lg object-contain border border-ink-100 bg-white flex-shrink-0 p-1.5"
      style={{ width: size, height: size }}
    />
  )
}
