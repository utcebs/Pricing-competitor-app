import { useState, useEffect, useMemo } from 'react'
import { Plus, Pencil, Trash2, Package, Upload, Sparkles, Link2Off, Link2, Search } from 'lucide-react'
import { useTable, saveRow, deleteRow } from '../lib/db'
import { useAuth } from '../lib/auth'
import { supabase } from '../supabaseClient'
import {
  PageHeader, Card, Button, Modal, ConfirmDialog, Field,
  Empty, Badge, LoadingBlock, ErrorBlock, inputCls, selectCls, textareaCls,
} from '../components/UI'
import BulkUpload from '../components/BulkUpload'
import FindUrlsModal from '../components/FindUrlsModal'

export default function Products() {
  const { isManager, user } = useAuth()
  const { rows: products, loading, error, refresh } = useTable('products', { order: ['name', { ascending: true }] })
  const { rows: categories } = useTable('categories', { order: ['name', { ascending: true }] })
  const { rows: currencies } = useTable('currencies')
  const { rows: cps, refresh: refreshCps } = useTable('competitor_products')
  const { rows: activeCompetitors } = useTable('competitors', { eq: ['is_active', true], order: ['name', { ascending: true }] })

  const [editing, setEditing] = useState(null)   // null | 'new' | product object
  const [toDelete, setToDelete] = useState(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [findingId, setFindingId] = useState(null)
  const [toast, setToast] = useState('')
  const [findModal, setFindModal] = useState(null)   // { jobId, productName }

  // Filters
  const [q, setQ] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [brandFilter, setBrandFilter] = useState('all')
  const [trackingFilter, setTrackingFilter] = useState('all')

  // count links per product
  const linkCounts = {}
  for (const c of cps) linkCounts[c.product_id] = (linkCounts[c.product_id] || 0) + 1

  // Unique brand list from the current products
  const brands = useMemo(() => {
    const set = new Set()
    for (const p of products) if (p.brand?.trim()) set.add(p.brand.trim())
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [products])

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    return products.filter(p => {
      if (query) {
        const hay = `${p.name} ${p.sku || ''} ${p.brand || ''}`.toLowerCase()
        if (!hay.includes(query)) return false
      }
      if (catFilter !== 'all') {
        if (catFilter === 'null') { if (p.category_id != null) return false }
        else if (String(p.category_id) !== catFilter) return false
      }
      if (brandFilter !== 'all' && (p.brand || '') !== brandFilter) return false
      if (trackingFilter === 'tracked' && !linkCounts[p.id]) return false
      if (trackingFilter === 'untracked' && linkCounts[p.id]) return false
      return true
    })
  }, [products, q, catFilter, brandFilter, trackingFilter, linkCounts])

  // Perf guard — DOM chokes past ~500 rows of a rich table with images.
  // Cap render and prompt filtering. (True virtualization is a follow-up
  // when it becomes needed; capping handles the free-tier / early-scale
  // path without introducing table-layout complexity.)
  const RENDER_CAP = 300
  const capped = filtered.length > RENDER_CAP
  const visibleRows = capped ? filtered.slice(0, RENDER_CAP) : filtered

  const findUrlsFor = async (product) => {
    setFindingId(product.id); setToast('')
    const { data, error } = await supabase.from('url_find_jobs').insert({
      product_id: product.id,
      triggered_by: user?.id,
    }).select().single()
    setFindingId(null)
    if (error) {
      if (error.message?.includes('url_find_jobs')) {
        setToast('URL finder not ready — the DB migration hasn\'t been run yet. Ask admin to run supabase/migrations/url-finder.sql.')
      } else {
        setToast('Failed to queue: ' + error.message)
      }
      setTimeout(() => setToast(''), 8000)
      return
    }
    // Open live-status modal
    setFindModal({ jobId: data.id, productName: product.name })
    setToast(`Searching for "${product.name}" URLs across all active competitors. Results land within ~5 minutes.`)
    setTimeout(() => { setToast(''); refreshCps() }, 8000)
  }

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
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setBulkOpen(true)}><Upload size={15} /> Bulk import</Button>
            <Button onClick={openNew}><Plus size={15} /> Add product</Button>
          </div>
        )}
      />

      <ErrorBlock error={error} onRetry={refresh} />

      {toast && (
        <div className="mb-4 text-[12.5px] px-3 py-2 bg-brand-50 border border-brand-100 rounded-lg text-brand-800 inline-flex items-center gap-2">
          <Sparkles size={13} /> {toast}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" size={14} />
          <input className={`${inputCls} pl-9`}
            placeholder="Search name, SKU, or brand…"
            value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <select className={`${selectCls} sm:w-48`} value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          <option value="all">All categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="null">— Uncategorized —</option>
        </select>
        <select className={`${selectCls} sm:w-48`} value={brandFilter} onChange={e => setBrandFilter(e.target.value)}>
          <option value="all">All brands</option>
          {brands.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select className={`${selectCls} sm:w-48`} value={trackingFilter} onChange={e => setTrackingFilter(e.target.value)}>
          <option value="all">All products</option>
          <option value="tracked">🟢 Tracked only</option>
          <option value="untracked">🔴 Not tracked</option>
        </select>
      </div>

      {/* Result count strip when filters active */}
      {(q || catFilter !== 'all' || brandFilter !== 'all' || trackingFilter !== 'all') && (
        <div className="text-[11.5px] text-ink-500 mb-3">
          Showing <span className="font-semibold text-ink-800">{visibleRows.length}</span>
          {capped && ` of ${filtered.length} matching`}
          {!capped && filtered.length !== products.length && ` of ${products.length}`} products
          <button onClick={() => { setQ(''); setCatFilter('all'); setBrandFilter('all'); setTrackingFilter('all') }}
            className="ml-3 text-brand-700 hover:underline font-medium">
            Clear filters
          </button>
        </div>
      )}
      {capped && (
        <div className="mb-3 text-[11.5px] px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-amber-800 inline-flex items-center gap-2">
          Showing first {RENDER_CAP} rows of {filtered.length}. Filter above to narrow down.
        </div>
      )}

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
        ) : filtered.length === 0 ? (
          <Empty
            icon={Search}
            title="No products match those filters"
            description="Try clearing filters or broadening the search."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-canvas-100 border-b border-ink-200">
                <tr>
                  <Th>SKU</Th><Th>Name</Th><Th>Brand</Th><Th>Category</Th>
                  <Th className="text-right">Cost</Th>
                  <Th className="text-right">Min</Th>
                  <Th className="text-right">Current</Th>
                  <Th>Own</Th>
                  <Th>Tracking</Th>
                  {isManager && <Th className="text-right">Actions</Th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {visibleRows.map(p => {
                  const image = p.image_url || cps.find(c => c.product_id === p.id && c.image_url)?.image_url || null
                  return (
                  <tr key={p.id} className="hover:bg-canvas-100">
                    <Td className="font-mono text-xs">{p.sku}</Td>
                    <Td>
                      <div className="flex items-center gap-3">
                        <ProductThumb src={image} name={p.name} />
                        <span className="font-medium">{p.name}</span>
                      </div>
                    </Td>
                    <Td className="text-ink-500">{p.brand || '—'}</Td>
                    <Td className="text-ink-500">{catName(p.category_id)}</Td>
                    <Td className="text-right tabular-nums text-ink-500">
                      {p.cost_price != null ? `${currencySymbol(p.currency_code)} ${Number(p.cost_price).toFixed(3)}` : '—'}
                    </Td>
                    <Td className="text-right tabular-nums text-ink-500">
                      {p.min_price != null ? `${currencySymbol(p.currency_code)} ${Number(p.min_price).toFixed(3)}` : '—'}
                    </Td>
                    <Td className="text-right tabular-nums font-medium">
                      {p.current_price != null ? `${currencySymbol(p.currency_code)} ${Number(p.current_price).toFixed(3)}` : '—'}
                    </Td>
                    <Td>{p.is_own_brand && <Badge variant="brand">Own</Badge>}</Td>
                    <Td>
                      {linkCounts[p.id] > 0 ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-semibold">
                          <Link2 size={11} /> {linkCounts[p.id]} linked
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-red-600 font-semibold">
                          <Link2Off size={11} /> not tracked
                        </span>
                      )}
                    </Td>
                    {isManager && (
                      <Td>
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => findUrlsFor(p)}
                            disabled={findingId === p.id}
                            title="Auto-find this product on every competitor site"
                            className="p-1.5 rounded text-ink-400 hover:text-brand-600 hover:bg-brand-50 disabled:opacity-50 inline-flex items-center gap-1">
                            <Sparkles size={14} />
                            <span className="text-[11px] font-medium hidden md:inline">Find URLs</span>
                          </button>
                          <button onClick={() => openEdit(p)} className="p-1.5 rounded text-ink-400 hover:text-brand-600 hover:bg-brand-50"><Pencil size={14} /></button>
                          <button onClick={() => setToDelete(p)} className="p-1.5 rounded text-ink-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
                        </div>
                      </Td>
                    )}
                  </tr>
                )})}
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
        onSaved={(findQueued) => {
          close(); refresh(); refreshCps()
          if (findQueued) {
            setToast('Product saved — searching for competitor URLs across all active sites. Results in ~5 minutes.')
            setTimeout(() => setToast(''), 10000)
          }
        }}
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

      <BulkUpload
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Bulk import products"
        templateFilename="products-template.csv"
        templateHeaders={[
          'sku','name','brand','category_name','currency_code',
          'cost_price','min_price','current_price','target_margin',
          'is_own_brand','description',
        ]}
        sampleRows={[
          { sku:'SKU-001', name:'Kettle 1.7L', brand:'AquaBoil', category_name:'Home Appliances',
            currency_code:'KWD', cost_price:'4.500', min_price:'5.900', current_price:'8.900',
            target_margin:'30', is_own_brand:'false', description:'1.7L cordless electric kettle' },
          { sku:'SKU-002', name:'Blender 800W', brand:'MixPro', category_name:'Home Appliances',
            currency_code:'KWD', cost_price:'6.750', min_price:'9.500', current_price:'12.900',
            target_margin:'35', is_own_brand:'true', description:'800W countertop blender' },
        ]}
        hint="category_name must exactly match a Category you already created (leave blank to skip). currency_code must be a code in your Currencies table (KWD/USD/…)."
        transformRow={(row) => {
          if (!row.sku?.trim() || !row.name?.trim()) return { error: 'sku and name are required' }
          const cat = row.category_name?.trim()
            ? categories.find(c => c.name.toLowerCase() === row.category_name.trim().toLowerCase())
            : null
          if (row.category_name?.trim() && !cat) return { error: `unknown category: ${row.category_name}` }
          const cur = row.currency_code?.trim()
            ? currencies.find(c => c.code.toLowerCase() === row.currency_code.trim().toLowerCase())
            : null
          const num = (v) => (v === '' || v == null) ? null : Number(v)
          const bool = (v) => String(v || '').toLowerCase() === 'true' || v === '1'
          return {
            payload: {
              sku: row.sku.trim(),
              name: row.name.trim(),
              brand: row.brand?.trim() || null,
              description: row.description?.trim() || null,
              category_id: cat?.id || null,
              currency_code: cur?.code || 'KWD',
              cost_price: num(row.cost_price),
              min_price: num(row.min_price),
              current_price: num(row.current_price),
              target_margin: num(row.target_margin),
              is_own_brand: bool(row.is_own_brand),
              is_active: true,
            }
          }
        }}
        onImport={async (payloads) => {
          const { data, error } = await supabase.from('products').insert(payloads).select()
          refresh()
          if (error) return { inserted: 0, failed: payloads.length, errors: [error.message] }
          return { inserted: data.length, failed: payloads.length - data.length, errors: [] }
        }}
      />

      <FindUrlsModal
        open={!!findModal}
        jobId={findModal?.jobId}
        productName={findModal?.productName}
        competitors={activeCompetitors}
        onClose={() => { setFindModal(null); refreshCps() }}
      />
    </div>
  )
}

function ProductForm({ open, product, categories, currencies, onClose, onSaved }) {
  const { user } = useAuth()
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [autoFind, setAutoFind] = useState(true)
  const [priceSource, setPriceSource] = useState('manual')   // 'manual' | 'url'

  const isNew = !product?.id

  // Reset form whenever we open (with the edited row or empty defaults).
  useEffect(() => {
    if (!open) return
    setForm({
      sku: '', name: '', brand: '', category_id: '', description: '',
      cost_price: '', min_price: '', target_margin: '', current_price: '',
      currency_code: 'KWD', is_own_brand: false, is_active: true,
      own_url: '',
      ...product,
    })
    setAutoFind(true)
    // If the product came in with an own_url, start on URL tab
    setPriceSource(product?.own_url ? 'url' : 'manual')
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
      // If URL mode: clear manual current_price so scraper populates it;
      // if manual mode: clear own_url so worker doesn't overwrite.
      if (priceSource === 'url') {
        if (!payload.own_url?.trim()) throw new Error('Product URL is required when price source is set to URL')
        payload.own_url = payload.own_url.trim()
        // Keep any prior current_price as a fallback — the worker will refresh it soon
      } else {
        payload.own_url = null
      }
      const { data, error } = await saveRow('products', payload)
      if (error) {
        if (error.message?.includes('own_url')) {
          throw new Error('URL support not ready — ask admin to run the migration adding products.own_url column.')
        }
        throw error
      }

      // If it's a NEW product AND the user checked "auto-find URLs",
      // queue a url_find_jobs row so the worker searches every active
      // competitor for a matching URL on its next tick.
      let findQueued = false
      if (isNew && autoFind && data?.id) {
        const { error: findErr } = await supabase.from('url_find_jobs').insert({
          product_id: data.id,
          triggered_by: user?.id,
        })
        // Swallow "table not found" quietly — user hasn't run the migration.
        // The saved product is still valid; onSaved will just skip the toast.
        if (!findErr) findQueued = true
      }

      onSaved(findQueued)
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
        <Field label="Target margin %">
          <input type="number" step="0.01" className={inputCls} value={form.target_margin ?? ''} onChange={e => set('target_margin', e.target.value)} />
        </Field>

        {/* Price source: manual OR from your own URL */}
        <div className="md:col-span-2">
          <div className="text-[11px] font-semibold text-ink-600 uppercase tracking-[0.08em] mb-2">Current Price</div>
          <div className="inline-flex bg-ink-100 rounded-lg p-1 gap-1 mb-3">
            <button type="button" onClick={() => setPriceSource('manual')}
              className={`px-4 py-1.5 rounded-md text-[12px] font-semibold transition-all ${
                priceSource === 'manual' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
              }`}>
              Enter manually
            </button>
            <button type="button" onClick={() => setPriceSource('url')}
              className={`px-4 py-1.5 rounded-md text-[12px] font-semibold transition-all inline-flex items-center gap-1.5 ${
                priceSource === 'url' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
              }`}>
              <Sparkles size={11}/> Fetch from my website
            </button>
          </div>
          {priceSource === 'manual' ? (
            <input type="number" step="0.001" className={inputCls}
              value={form.current_price ?? ''}
              onChange={e => set('current_price', e.target.value)}
              placeholder="e.g. 409.900" />
          ) : (
            <>
              <input type="url" className={inputCls}
                value={form.own_url ?? ''}
                onChange={e => set('own_url', e.target.value)}
                placeholder="https://your-website.com/your-product-page" />
              <div className="text-[11px] text-ink-500 mt-1.5 leading-relaxed">
                The worker will visit this URL on every scrape tick (every 5 min), extract the price,
                and update this product's current price automatically. Useful when your prices change
                frequently on Shopify / Magento / your ERP-driven storefront.
              </div>
              {form.current_price != null && form.current_price !== '' && (
                <div className="text-[11px] text-ink-600 mt-2 px-2.5 py-1 bg-canvas-100 rounded inline-block">
                  Last known price: <span className="font-mono font-semibold tabular-nums">KD {Number(form.current_price).toFixed(3)}</span>
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-4 pt-6">
          <label className="inline-flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={!!form.is_own_brand} onChange={e => set('is_own_brand', e.target.checked)} />
            Own-brand item
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-ink-700">
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

      {isNew && (
        <div className="mt-5 p-3.5 rounded-xl border border-brand-100 bg-brand-50/60">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={autoFind}
              onChange={e => setAutoFind(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-brand-600"
            />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-ink-900 inline-flex items-center gap-1.5">
                <Sparkles size={13} className="text-brand-600" />
                Auto-find URLs on active competitor sites
              </div>
              <div className="text-[11.5px] text-ink-600 mt-0.5 leading-relaxed">
                After saving, the worker will search every active competitor for a matching URL and link it automatically. Results in ~5 minutes. You can review or unlink each match on the Linked Items page.
              </div>
            </div>
          </label>
        </div>
      )}

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

function ProductThumb({ src, name }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div className="w-10 h-10 rounded-lg bg-canvas-100 border border-ink-100 flex items-center justify-center text-ink-400 flex-shrink-0">
        <Package size={14} strokeWidth={1.5} />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      onError={() => setFailed(true)}
      className="w-10 h-10 rounded-lg object-cover border border-ink-100 bg-white flex-shrink-0"
    />
  )
}
