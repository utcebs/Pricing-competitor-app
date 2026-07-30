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
      const build = () => {
        let q = supabase.from(table).select(select)
        if (eq) q = q.eq(eq[0], eq[1])
        if (order) q = q.order(order[0], order[1] || {})
        return q
      }
      if (limit) {
        // Explicit limit → single request.
        const { data, error } = await build().limit(limit)
        if (error) throw error
        setRows(data || [])
      } else {
        // No limit → paginate past Supabase's 1000-row-per-request default so
        // lists/counts are COMPLETE (e.g. all competitor_products, not the
        // first 1000). Safety cap of 20 pages (20k rows) prevents runaway.
        const PAGE = 1000
        let all = [], from = 0, page = 0
        while (page < 20) {
          const { data, error } = await build().range(from, from + PAGE - 1)
          if (error) throw error
          all = all.concat(data || [])
          if (!data || data.length < PAGE) break
          from += PAGE; page++
        }
        setRows(all)
      }
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
