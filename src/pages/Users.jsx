import { useState } from 'react'
import { UserCog } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useTable } from '../lib/db'
import { useAuth } from '../lib/auth'
import {
  PageHeader, Card, Empty, LoadingBlock, ErrorBlock, Badge,
} from '../components/UI'

const ROLES = ['admin', 'manager', 'viewer']

/**
 * Users — admins can view all profiles and change roles.
 * New sign-ups happen via Supabase Auth Dashboard (or a future
 * self-service invite flow). For now users are added by pasting them
 * into Auth → Users and the on_auth_user_created trigger creates the
 * profile row automatically as 'viewer'; admin can promote here.
 */
export default function Users() {
  const { isAdmin, profile: me } = useAuth()
  const { rows, loading, error, refresh } = useTable('profiles', { order: ['created_at', { ascending: false }] })
  const [busy, setBusy] = useState(null)

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

  if (!isAdmin) return <Empty icon={UserCog} title="Not permitted" description="Only admins can view users." />

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Change role assignments. To add a new user: Supabase Dashboard → Authentication → Users → Add user."
      />
      <ErrorBlock error={error} onRetry={refresh} />
      <Card>
        {loading ? <LoadingBlock /> : rows.length === 0 ? (
          <Empty icon={UserCog} title="No users found" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <Th>Email</Th><Th>Name</Th><Th>Role</Th><Th>Joined</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(u => (
                  <tr key={u.id} className={u.id === me?.id ? 'bg-brand-50/30' : 'hover:bg-slate-50'}>
                    <Td className="font-mono text-xs">
                      {u.email || '—'}
                      {u.id === me?.id && <Badge variant="brand">You</Badge>}
                    </Td>
                    <Td>{u.full_name || '—'}</Td>
                    <Td>
                      <select
                        value={u.role}
                        onChange={e => setRole(u.id, e.target.value)}
                        disabled={busy === u.id}
                        className="px-2 py-1 rounded border border-slate-200 text-xs font-medium bg-white capitalize"
                      >
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </Td>
                    <Td className="text-slate-500 text-xs">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function Th({ children }) { return <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{children}</th> }
function Td({ children, className = '' }) { return <td className={`px-4 py-3 text-sm text-slate-700 ${className}`}>{children}</td> }
