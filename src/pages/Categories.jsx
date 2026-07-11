import { useState, useEffect, useMemo } from 'react'
import { Plus, Pencil, Trash2, FolderTree } from 'lucide-react'
import { useTable, saveRow, deleteRow } from '../lib/db'
import { useAuth } from '../lib/auth'
import {
  PageHeader, Card, Button, Modal, ConfirmDialog, Field,
  Empty, LoadingBlock, ErrorBlock, inputCls, selectCls,
} from '../components/UI'

export default function Categories() {
  const { isManager } = useAuth()
  const { rows, loading, error, refresh } = useTable('categories', { order: ['sort_order', { ascending: true }] })
  const [editing, setEditing] = useState(null)
  const [toDelete, setToDelete] = useState(null)

  const byParent = useMemo(() => {
    const map = new Map()
    rows.forEach(c => {
      const key = c.parent_id || 'root'
      const arr = map.get(key) || []
      arr.push(c)
      map.set(key, arr)
    })
    return map
  }, [rows])

  const renderTree = (parentKey = 'root', depth = 0) => {
    const children = byParent.get(parentKey) || []
    return children.map(c => (
      <div key={c.id}>
        <div className={`flex items-center justify-between py-2 px-2 rounded hover:bg-canvas-100 ${depth > 0 ? 'border-l-2 border-ink-100' : ''}`}
             style={{ paddingLeft: `${depth * 20 + 8}px` }}>
          <div className="text-sm text-ink-800">{c.name}</div>
          {isManager && (
            <div className="flex items-center gap-1">
              <button onClick={() => setEditing(c)} className="p-1 rounded text-ink-400 hover:text-brand-600"><Pencil size={13} /></button>
              <button onClick={() => setToDelete(c)} className="p-1 rounded text-ink-400 hover:text-red-600"><Trash2 size={13} /></button>
            </div>
          )}
        </div>
        {renderTree(c.id, depth + 1)}
      </div>
    ))
  }

  return (
    <div>
      <PageHeader
        title="Categories"
        subtitle="Used for organising products and enabling category-wise competitor comparison."
        action={isManager && <Button onClick={() => setEditing({})}><Plus size={15} /> Add category</Button>}
      />

      <ErrorBlock error={error} onRetry={refresh} />

      <Card className="p-3 max-w-2xl">
        {loading ? <LoadingBlock /> : rows.length === 0 ? (
          <Empty
            icon={FolderTree}
            title="No categories yet"
            description="Add a top-level category first, then create sub-categories underneath."
            action={isManager && <Button onClick={() => setEditing({})}><Plus size={15} /> Add first category</Button>}
          />
        ) : renderTree()}
      </Card>

      <CategoryForm open={editing !== null} category={editing} allCategories={rows}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); refresh() }} />
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Delete category?"
        message={`Delete "${toDelete?.name}"? Child categories will be moved to root; products keep their existing category link nulled.`}
        onConfirm={async () => { await deleteRow('categories', toDelete.id); setToDelete(null); refresh() }}
      />
    </div>
  )
}

function CategoryForm({ open, category, allCategories, onClose, onSaved }) {
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const isNew = !category?.id

  useEffect(() => {
    if (!open) return
    setForm({ name: '', parent_id: '', sort_order: 0, is_active: true, ...category })
    setErr('')
  }, [open, category?.id])

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const payload = { ...form }
      if (payload.parent_id === '' || payload.parent_id == null) payload.parent_id = null
      else payload.parent_id = Number(payload.parent_id)
      payload.sort_order = Number(payload.sort_order) || 0
      // Slug from name if none supplied
      if (!payload.slug && payload.name) {
        payload.slug = payload.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      }
      const { error } = await saveRow('categories', payload)
      if (error) throw error
      onSaved()
    } catch (e) { setErr(e.message || 'Save failed') }
    finally { setBusy(false) }
  }

  // Prevent picking self / descendant as parent when editing (rough guard)
  const parentOptions = allCategories.filter(c => c.id !== category?.id)

  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'Add category' : `Edit ${category?.name}`}>
      <div className="space-y-4">
        <Field label="Name" required>
          <input className={inputCls} value={form.name || ''} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
        </Field>
        <Field label="Parent">
          <select className={selectCls} value={form.parent_id || ''} onChange={e => setForm(p => ({ ...p, parent_id: e.target.value }))}>
            <option value="">— top level —</option>
            {parentOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Sort order">
          <input type="number" className={inputCls} value={form.sort_order ?? 0} onChange={e => setForm(p => ({ ...p, sort_order: e.target.value }))} />
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
