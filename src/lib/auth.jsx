import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

const AuthCtx = createContext({ user: null, profile: null, loading: true })

/**
 * AuthProvider — top-level provider that mounts once and tracks the
 * Supabase session + the linked profile row. Consumers get access via
 * useAuth(). Follows the "fire-and-forget inside onAuthStateChange" rule
 * from the EBS repo (memory.md §9): never `await` a Supabase call
 * inside the auth callback — the GoTrue lock is still held.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const u = data?.session?.user || null
      setUser(u)
      if (u) fetchProfile(u.id)
      else setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, session) => {
      const u = session?.user || null
      setUser(u)
      if (u) fetchProfile(u.id)
      else { setProfile(null); setLoading(false) }
    })
    return () => sub?.subscription?.unsubscribe?.()
  }, [])

  // Uses the auth-enabled client so RLS sees auth.role()='authenticated'
  // (supabasePublic was blocked — the profiles read policy requires it).
  // Safe to await inside this function because callers fire-and-forget:
  // the outer onAuthStateChange callback returns before this await resolves,
  // so no GoTrue lock is held.
  async function fetchProfile(id) {
    try {
      const { data, error } = await supabase
        .from('profiles').select('*').eq('id', id).single()
      if (error) throw error
      setProfile(data)
    } catch (e) {
      console.warn('[auth] profile fetch failed:', e.message)
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }

  const signIn = (email, password) =>
    supabase.auth.signInWithPassword({ email, password })
  const signOut = () => supabase.auth.signOut()

  const isAdmin = profile?.role === 'admin'
  const isManager = profile?.role === 'manager' || isAdmin

  return (
    <AuthCtx.Provider value={{ user, profile, loading, isAdmin, isManager, signIn, signOut }}>
      {children}
    </AuthCtx.Provider>
  )
}

export const useAuth = () => useContext(AuthCtx)
