import { useState, useEffect } from 'react'
import { UserCog, Plus, Trash2, KeyRound, ShieldCheck } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useTable } from '../lib/db'
import { useAuth } from '../lib/auth'
import {
  PageHeader, Card, Empty, LoadingBlock, ErrorBlock, Badge,
  Button, Modal, ConfirmDialog, Field, inputCls, selectCls,
} from '../components/UI'

const ROLES = ['admin', 'manager', 'viewer']
const ROLE_HINT = {
  admin:   'Full access — user management, all data, all integrations',
  manager: 'Can create/edit products, rules, and integrations',
  viewer:  'Read-only across the whole app',
}

export default function Users() {
  const { isAdmin, profile: me } = useAuth()
  const { rows, loading, error, refresh } = useTable('profiles', { order: ['created_at', { ascending: false }] })
  const [busy, setBusy] = useState(null)
  const [newOpen, setNewOpen] = useState(false)
  const [toDelete, setToDelete] = useState(null)
  const [resetTarget, setResetTarget] = useState(null)

  const setRole = async (userId, role) => {
    if (userId === me?.id && role !== 'admin') {
      if (!confirm('This will remove YOUR admin access. Continue?')) return
    }
    setBusy(userId)
    const { error } = await supabase.from('profiles').update({ role }).eq('id', userId)
    setBusy(null)
    if (error) { alert('Failed: ' + error.message); return }
    refresh()
  }

  const deleteUser = async () => {
    if (!toDelete) return
    setBusy(toDelete.id)
    const { error } = await supabase.rpc('admin_delete_user', { p_id: toDelete.id })
    setBusy(null); setToDelete(null)
    if (error) { alert('Delete failed: ' + error.message); return }
    refresh()
  }

  if (!isAdmin) return <Empty icon={UserCog} title="Not permitted" description="Only administrators can view this page." />

  const counts = ROLES.reduce((acc, r) => (acc[r] = rows.filter(u => u.role === r).length, acc), {})

  return (
    <div>
      <PageHeader
        kicker="Administration"
        title="Users & Access"
        subtitle="Add teammates, tune roles, remove departing staff. Roles map to Row-Level Security policies."
        action={
          <Button variant="gold" onClick={() => setNewOpen(true)}>
            <Plus size={14} /> New user
          </Button>
        }
      />

      {/* Role summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {ROLES.map(r => (
          <Card key={r} className="p-4 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              r === 'admin' ? 'bg-brand-50 text-brand-700 border border-brand-100' :
              r === 'manager' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
              'bg-ink-100 text-ink-600 border border-ink-200'
            }`}>
              <ShieldCheck size={17} strokeWidth={2} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-ink-500 font-semibold">{r}</div>
              <div className="font-display text-[22px] leading-none text-ink-900 mt-1 tabular-nums">
                {counts[r]}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <ErrorBlock error={error} onRetry={refresh} />

      <Card>
        {loading ? <LoadingBlock /> : rows.length === 0 ? (
          <Empty icon={UserCog} title="No users yet"
            action={<Button variant="gold" onClick={() => setNewOpen(true)}><Plus size={14} /> Add first user</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-ink-100">
                <tr>
                  <Th>User</Th>
                  <Th>Role</Th>
                  <Th>Joined</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {rows.map(u => (
                  <tr key={u.id} className={u.id === me?.id ? 'bg-brand-50/30' : 'hover:bg-canvas-100/50 transition-colors'}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold ${
                          u.role === 'admin' ? 'bg-brand-500 text-white' :
                          u.role === 'manager' ? 'bg-emerald-600 text-white' :
                          'bg-ink-200 text-ink-700'
                        }`}>
                          {(u.full_name || u.email || '?').slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold text-ink-900 flex items-center gap-2">
                            {u.full_name || <span className="italic text-ink-400">no name</span>}
                            {u.id === me?.id && <Badge variant="brand">You</Badge>}
                          </div>
                          <div className="text-xs text-ink-500 font-mono">{u.email || '—'}</div>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <select
                        value={u.role}
                        onChange={e => setRole(u.id, e.target.value)}
                        disabled={busy === u.id}
                        className={`${selectCls} py-1.5 text-xs font-semibold capitalize max-w-[140px]`}
                      >
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </Td>
                    <Td className="text-ink-500 text-xs">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric'}) : '—'}
                    </Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setResetTarget(u)}
                          title="Reset password"
                          className="p-2 rounded-lg text-ink-400 hover:text-brand-600 hover:bg-brand-50 transition-colors">
                          <KeyRound size={14} />
                        </button>
                        <button onClick={() => setToDelete(u)}
                          disabled={u.id === me?.id}
                          title={u.id === me?.id ? "Can't delete yourself" : 'Delete user'}
                          className="p-2 rounded-lg text-ink-400 hover:text-red-700 hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-400 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <NewUserModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={() => { setNewOpen(false); refresh() }}
      />

      <PasswordResetModal
        target={resetTarget}
        onClose={() => setResetTarget(null)}
        onDone={() => setResetTarget(null)}
      />

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Delete user?"
        message={`Permanently remove ${toDelete?.full_name || toDelete?.email}. Their auth account and profile will be deleted. This cannot be undone.`}
        onConfirm={deleteUser}
      />
    </div>
  )
}

function NewUserModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ email:'', password:'', full_name:'', role:'viewer' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (open) { setForm({ email:'', password:'', full_name:'', role:'viewer' }); setErr('') }
  }, [open])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const submit = async () => {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('admin_create_user', {
      p_email: form.email.trim(),
      p_password: form.password,
      p_full_name: form.full_name.trim() || null,
      p_role: form.role,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onCreated?.()
  }

  return (
    <Modal open={open} onClose={onClose} title="Invite a new user"
      subtitle="They can sign in immediately with these credentials.">
      <div className="space-y-4">
        <Field label="Email" required>
          <input type="email" autoComplete="off" className={inputCls}
            value={form.email} onChange={e => set('email', e.target.value)}
            placeholder="teammate@company.com" />
        </Field>
        <Field label="Full name">
          <input className={inputCls} value={form.full_name}
            onChange={e => set('full_name', e.target.value)}
            placeholder="Jane Analyst" />
        </Field>
        <Field label="Temporary password" required hint="Minimum 6 characters. They can change it later.">
          <input type="text" autoComplete="off" className={`${inputCls} font-mono tracking-wider`}
            value={form.password}
            onChange={e => set('password', e.target.value)}
            placeholder="e.g. Prisma@2026" />
        </Field>
        <Field label="Role" required>
          <select className={selectCls} value={form.role}
            onChange={e => set('role', e.target.value)}>
            {ROLES.map(r => <option key={r} value={r} className="capitalize">{r}</option>)}
          </select>
          <div className="text-[11px] text-ink-500 mt-1.5">{ROLE_HINT[form.role]}</div>
        </Field>
        {err && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {err}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-7 pt-4 border-t border-ink-100">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="gold" busy={busy} onClick={submit}
          disabled={!form.email || !form.password}>
          Create user
        </Button>
      </div>
    </Modal>
  )
}

function PasswordResetModal({ target, onClose, onDone }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { if (target) { setPw(''); setErr('') } }, [target])

  if (!target) return null

  const submit = async () => {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('admin_reset_password', {
      p_id: target.id, p_new_password: pw,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    alert(`Password reset for ${target.email}. Share the new password securely.`)
    onDone?.()
  }

  return (
    <Modal open={!!target} onClose={onClose} title="Reset password"
      subtitle={`For ${target.email}`}>
      <div className="space-y-4">
        <Field label="New password" required hint="Minimum 6 characters.">
          <input type="text" autoComplete="off" className={`${inputCls} font-mono tracking-wider`}
            value={pw} onChange={e => setPw(e.target.value)}
            placeholder="Enter new password" />
        </Field>
        {err && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {err}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-7 pt-4 border-t border-ink-100">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="gold" busy={busy} onClick={submit} disabled={!pw}>
          Set new password
        </Button>
      </div>
    </Modal>
  )
}

function Th({ children, className = '' }) {
  return <th className={`px-5 py-3 text-left text-[10px] font-semibold text-ink-500 uppercase tracking-[0.14em] ${className}`}>{children}</th>
}
function Td({ children, className = '' }) {
  return <td className={`px-5 py-3.5 text-sm text-ink-800 ${className}`}>{children}</td>
}
