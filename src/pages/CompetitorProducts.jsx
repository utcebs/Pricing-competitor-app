import { useState, useEffect, useMemo } from 'react'
import {
  Plus, Pencil, Trash2, Link2, ExternalLink, Search, Upload,
  ChevronRight, ChevronDown, FolderTree, Package, Check, X, Sparkles,
} from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useTable, saveRow, deleteRow } from '../lib/db'
import { useAuth } from '../lib/auth'
import { supabase } from '../supabaseClient'
import {
  PageHeader, Card, Button, Modal, ConfirmDialog, Field,
  Empty, Badge, LoadingBlock, ErrorBlock, inputCls, selectCls,
} from '../components/UI'
import BulkUpload from '../components/BulkUpload'

/**
 * Linked Items — hierarchical view.
 *
 *   Category (collapsible)
 *     └── Product (collapsible)
 *           └── Competitor link (URL editable inline)
 *
 * Products without a category go under "Uncategorized". Products without
 * any competitor links show a subtle "not tracked" state with a quick
 * "+ Add link" per active competitor.
 */
export default function CompetitorProducts() {
  const { isManager, user } = useAuth()
  const { rows: links, loading, error, refresh } = useTable('competitor_products', { order: ['created_at', { ascending: false }] })
  const { rows: competitors } = useTable('competitors', { eq: ['is_active', true], order: ['name', { ascending: true }] })
  const { rows: products, refresh: refreshProducts } = useTable('products', { order: ['name', { ascending: true }] })
  const { rows: categories } = useTable('categories', { order: ['name', { ascending: true }] })

  const [editing, setEditing] = useState(null)
  const [toDelete, setToDelete] = useState(null)
  const [filterCompetitor, setFilterCompetitor] = useState('all')
  const [search, setSearch] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [expandedCats, setExpandedCats] = useState({})   // categoryId → bool
  const [expandedProducts, setExpandedProducts] = useState({})  // productId → bool

  const compById = useMemo(() => Object.fromEntries(competitors.map(c => [c.id, c])), [competitors])
  const catById  = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories])
  const linksByProduct = useMemo(() => {
    const map = {}
    for (const l of links) {
      if (!l.product_id) continue
      if (!map[l.product_id]) map[l.product_id] = []
      map[l.product_id].push(l)
    }
    return map
  }, [links])

  // Group products by category
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase()
    const passesFilter = (product) => {
      if (q) {
        const hitProduct = product.name.toLowerCase().includes(q) || (product.sku || '').toLowerCase().includes(q)
        const hitLinks = (linksByProduct[product.id] || []).some(l =>
          l.name.toLowerCase().includes(q) || (l.url || '').toLowerCase().includes(q)
        )
        if (!hitProduct && !hitLinks) return false
      }
      if (filterCompetitor !== 'all') {
        const has = (linksByProduct[product.id] || []).some(l => String(l.competitor_id) === filterCompetitor)
        if (!has) return false
      }
      return true
    }

    const buckets = new Map()
    for (const p of products) {
      if (!passesFilter(p)) continue
      const key = p.category_id ?? 0
      if (!buckets.has(key)) {
        buckets.set(key, {
          categoryId: p.category_id,
          name: catById[p.category_id]?.name || 'Uncategorized',
          products: [],
        })
      }
      buckets.get(key).products.push(p)
    }
    // Sort: named categories first (alphabetical), Uncategorized last
    return [...buckets.values()].sort((a, b) => {
      if (a.categoryId == null) return 1
      if (b.categoryId == null) return -1
      return a.name.localeCompare(b.name)
    })
  }, [products, catById, linksByProduct, search, filterCompetitor])

  const toggleCat = (id) => setExpandedCats(m => ({ ...m, [id ?? 'uncat']: !m[id ?? 'uncat'] }))
  const toggleProd = (id) => setExpandedProducts(m => ({ ...m, [id]: !m[id] }))
  const isCatOpen = (id) => expandedCats[id ?? 'uncat'] !== false   // default open
  const isProdOpen = (id) => !!expandedProducts[id]

  return (
    <div>
      <PageHeader
        kicker="Manage tracking"
        title="Linked Items"
        subtitle="Every one of your products, grouped by category. Expand a product to view or edit the competitor URLs the scraper watches."
        action={isManager && (
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setBulkOpen(true)}><Upload size={15} /> Bulk import</Button>
            <Button onClick={() => setEditing({})}><Plus size={15} /> Add link</Button>
          </div>
        )}
      />

      <ErrorBlock error={error} onRetry={refresh} />

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" size={14} />
          <input className={`${inputCls} pl-9`} placeholder="Search product name, SKU, or competitor URL…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className={`${selectCls} sm:w-56`} value={filterCompetitor} onChange={e => setFilterCompetitor(e.target.value)}>
          <option value="all">All competitors</option>
          {competitors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {loading ? <Card><LoadingBlock /></Card> : grouped.length === 0 ? (
        <Card>
          <Empty
            icon={Link2}
            title={products.length === 0 ? 'No products yet' : search ? 'No matches for those filters' : 'No categorised products'}
            description={products.length === 0
              ? 'Add products first, then link competitor URLs to them here.'
              : null}
            action={products.length === 0 && <NavLink to="/products"><Button><Plus size={15} /> Add first product</Button></NavLink>}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {grouped.map(group => (
            <CategoryGroup
              key={group.categoryId ?? 'uncat'}
              group={group}
              linksByProduct={linksByProduct}
              competitors={competitors}
              compById={compById}
              isOpen={isCatOpen(group.categoryId)}
              onToggle={() => toggleCat(group.categoryId)}
              expandedProducts={expandedProducts}
              onToggleProduct={toggleProd}
              isProdOpen={isProdOpen}
              isManager={isManager}
              onEditLink={(link) => setEditing(link)}
              onDeleteLink={(link) => setToDelete(link)}
              onAddLinkFor={(product, competitor) => setEditing({
                competitor_id: competitor.id,
                product_id: product.id,
                name: '',
                url: '',
                match_method: 'manual',
                is_active: true,
              })}
              onLinkUpdated={refresh}
            />
          ))}
        </div>
      )}

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
        templateHeaders={['competitor_name','name','url','product_sku','competitor_sku','category_name']}
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

/* ── Category group card (collapsible) ─────────────────────── */
function CategoryGroup({ group, linksByProduct, competitors, compById,
                         isOpen, onToggle, isProdOpen, onToggleProduct,
                         isManager, onEditLink, onDeleteLink, onAddLinkFor,
                         onLinkUpdated }) {
  const totalLinks = group.products.reduce((sum, p) => sum + (linksByProduct[p.id]?.length || 0), 0)
  return (
    <Card className="overflow-hidden">
      <button onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-canvas-100/60 transition-colors text-left">
        <div className="flex items-center gap-3">
          {isOpen ? <ChevronDown size={16} className="text-ink-500" /> : <ChevronRight size={16} className="text-ink-500" />}
          <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-700 border border-brand-100 flex items-center justify-center">
            <FolderTree size={16} />
          </div>
          <div>
            <div className="font-display text-[17px] tracking-tight text-ink-900 leading-tight">
              {group.name}
            </div>
            <div className="text-[11px] text-ink-500 mt-0.5">
              {group.products.length} product{group.products.length === 1 ? '' : 's'} · {totalLinks} link{totalLinks === 1 ? '' : 's'}
            </div>
          </div>
        </div>
      </button>
      {isOpen && (
        <div className="border-t border-ink-100 divide-y divide-ink-100">
          {group.products.map(product => (
            <ProductNode
              key={product.id}
              product={product}
              links={linksByProduct[product.id] || []}
              competitors={competitors}
              compById={compById}
              isOpen={isProdOpen(product.id)}
              onToggle={() => onToggleProduct(product.id)}
              isManager={isManager}
              onEditLink={onEditLink}
              onDeleteLink={onDeleteLink}
              onAddLinkFor={onAddLinkFor}
              onLinkUpdated={onLinkUpdated}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

/* ── Product row + expanded competitor URLs ────────────────── */
function ProductNode({ product, links, competitors, compById,
                       isOpen, onToggle,
                       isManager, onEditLink, onDeleteLink, onAddLinkFor,
                       onLinkUpdated }) {
  const missingCompetitors = competitors.filter(c => !links.some(l => l.competitor_id === c.id))
  const hasLinks = links.length > 0
  return (
    <div>
      <button onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-3 pl-14 hover:bg-canvas-100/50 transition-colors text-left">
        <div className="flex items-center gap-3 min-w-0">
          {isOpen ? <ChevronDown size={14} className="text-ink-400 flex-shrink-0" /> : <ChevronRight size={14} className="text-ink-400 flex-shrink-0" />}
          <Package size={14} className="text-ink-400 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold text-ink-900 truncate">{product.name}</div>
            <div className="text-[10.5px] font-mono text-ink-500 mt-0.5">{product.sku}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-4">
          {hasLinks ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
              <Link2 size={11} /> {links.length}
            </span>
          ) : (
            <span className="text-[11px] text-red-600 font-semibold">not tracked</span>
          )}
        </div>
      </button>
      {isOpen && (
        <div className="bg-canvas-100/40 border-t border-ink-100 px-5 py-3 pl-14">
          {hasLinks && (
            <div className="space-y-1.5 mb-3">
              {links.map(link => (
                <LinkRowEditable
                  key={link.id}
                  link={link}
                  competitor={compById[link.competitor_id]}
                  isManager={isManager}
                  onEdit={() => onEditLink(link)}
                  onDelete={() => onDeleteLink(link)}
                  onUpdated={onLinkUpdated}
                />
              ))}
            </div>
          )}
          {isManager && missingCompetitors.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-2 border-t border-ink-100">
              <span className="text-[11px] text-ink-500 py-1 pr-1">Not tracked on:</span>
              {missingCompetitors.map(c => (
                <button key={c.id}
                  onClick={() => onAddLinkFor(product, c)}
                  className="inline-flex items-center gap-1 text-[11px] text-brand-700 border border-brand-100 hover:bg-brand-50 rounded-full px-2.5 py-1 transition-colors">
                  <Plus size={10} /> {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── One competitor link, URL editable inline ──────────────── */
function LinkRowEditable({ link, competitor, isManager, onEdit, onDelete, onUpdated }) {
  const [urlDraft, setUrlDraft] = useState(link.url)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setUrlDraft(link.url) }, [link.url])

  const save = async () => {
    if (urlDraft.trim() === link.url.trim()) { setEditing(false); return }
    setSaving(true)
    const cleaned = urlDraft.trim()
    const { error } = await supabase.from('competitor_products').update({ url: cleaned }).eq('id', link.id)
    setSaving(false)
    if (error) { alert('Save failed: ' + error.message); return }
    setEditing(false)
    onUpdated?.()
  }

  const cancel = () => { setUrlDraft(link.url); setEditing(false) }

  return (
    <div className="flex items-center gap-3 bg-white border border-ink-100 rounded-lg px-3 py-2 hover:border-brand-200 transition-colors">
      <div className="flex-shrink-0 text-[11px] font-semibold text-ink-800 min-w-[110px] truncate">
        {competitor?.name || `#${link.competitor_id}`}
      </div>
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              type="url"
              value={urlDraft}
              onChange={e => setUrlDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
              autoFocus
              className={`${inputCls} py-1 text-[12px] font-mono`}
              placeholder="https://…"
            />
            <button onClick={save} disabled={saving}
              className="p-1.5 rounded text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
              <Check size={13} />
            </button>
            <button onClick={cancel}
              className="p-1.5 rounded text-ink-500 hover:bg-ink-100">
              <X size={13} />
            </button>
          </div>
        ) : (
          <a href={link.url} target="_blank" rel="noopener noreferrer"
            className="text-[11.5px] font-mono text-brand-700 hover:underline inline-flex items-center gap-1 truncate max-w-full">
            <span className="truncate">{link.url}</span>
            <ExternalLink size={10} className="flex-shrink-0" />
          </a>
        )}
        <div className="flex items-center gap-2 mt-0.5">
          <MatchBadge method={link.match_method} confidence={link.match_confidence} />
          {link.last_seen_at && (
            <span className="text-[10px] text-ink-400">
              last scraped {relDate(link.last_seen_at)}
            </span>
          )}
        </div>
      </div>
      {isManager && !editing && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => setEditing(true)}
            title="Edit URL inline"
            className="p-1.5 rounded text-ink-400 hover:text-brand-700 hover:bg-brand-50">
            <Pencil size={13} />
          </button>
          <button onClick={onEdit}
            title="Edit all fields"
            className="p-1.5 rounded text-ink-400 hover:text-ink-800 hover:bg-ink-100 text-[10px] font-semibold">
            more
          </button>
          <button onClick={onDelete}
            title="Delete link"
            className="p-1.5 rounded text-ink-400 hover:text-red-700 hover:bg-red-50">
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

function MatchBadge({ method, confidence }) {
  if (method === 'manual')   return <Badge variant="brand">Manual</Badge>
  if (method === 'auto')     return <Badge variant="amber">Auto-found · {confidence ? `${Math.round(confidence * 100)}%` : 'review'}</Badge>
  if (method === 'category') return <Badge variant="green">Category</Badge>
  return <Badge>None</Badge>
}

function relDate(iso) {
  if (!iso) return '—'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/* ── Add-link / edit-link modal (kept as-is) ───────────────── */
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
      if (payload.product_id && payload.match_method === 'none') payload.match_method = 'manual'
      if (!payload.product_id && !payload.category_id) payload.match_method = 'none'
      const { error } = await saveRow('competitor_products', payload)
      if (error) throw error
      onSaved()
    } catch (e) { setErr(e.message || 'Save failed') }
    finally { setBusy(false) }
  }

  const linkedProduct = products.find(p => p.id === Number(form.product_id))

  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'Add competitor URL' : `Edit ${item?.name}`} wide>
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
            <input className={inputCls} value={form.name || ''} onChange={e => set('name', e.target.value)}
              placeholder={linkedProduct ? linkedProduct.name : ''}
            />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Product URL" required>
            <input type="url" className={inputCls} value={form.url || ''} onChange={e => set('url', e.target.value)}
              placeholder="https://competitor.com/product-page" />
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
