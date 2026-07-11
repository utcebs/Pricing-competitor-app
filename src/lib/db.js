import { supabase } from '../supabaseClient'
import { useEffect, useState, useCallback } from 'react'

/**
 * useTable — generic list hook.
 * Fetches once on mount + on `refresh()`. Returns { rows, loading, error, refresh }.
 * `select` defaults to '*'. Pass eq/order/limit for filtering.
 */
export function useTable(table, opts = {}) {
  const {
    select = '*',
    eq = null,          // [column, value]
    order = null,       // [column, { ascending }]
    limit = null,
    deps = [],
  } = opts
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      let q = supabase.from(table).select(select)
      if (eq) q = q.eq(eq[0], eq[1])
      if (order) q = q.order(order[0], order[1] || {})
      if (limit) q = q.limit(limit)
      const { data, error } = await q
      if (error) throw error
      setRows(data || [])
    } catch (e) {
      console.error(`[${table}]`, e)
      setError(e.message || 'Fetch failed')
    } finally {
      setLoading(false)
    }
  }, [table, select, JSON.stringify(eq), JSON.stringify(order), limit, ...deps])

  useEffect(() => { refresh() }, [refresh])
  return { rows, loading, error, refresh, setRows }
}

/**
 * saveRow — upsert helper. If `row.id` exists, UPDATE; otherwise INSERT.
 * Returns { data, error }.
 */
export async function saveRow(table, row) {
  if (row.id) {
    const { id, ...updates } = row
    return supabase.from(table).update(updates).eq('id', id).select().single()
  }
  return supabase.from(table).insert(row).select().single()
}

export async function deleteRow(table, id) {
  return supabase.from(table).delete().eq('id', id)
}
