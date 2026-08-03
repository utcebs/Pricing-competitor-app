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

/**
 * fetchLatestPrices — latest price per competitor_product, computed
 * SERVER-SIDE via the get_latest_prices() DISTINCT ON RPC. One row per cp
 * instead of paging the whole history and deduping in the browser.
 * Falls back to the legacy client-side paginator if the RPC hasn't been
 * migrated yet, so the page never breaks.
 *
 * Returns { prices: { [cpId]: { price, currency_code, captured_at } },
 *           suspect: { [cpId]: true },   // most-recent reading was flagged
 *           newest:  iso string | null } // newest captured_at across all cps
 */
export async function fetchLatestPrices(days = 60) {
  // IMPORTANT: PostgREST caps a single response at 1000 rows, and that applies
  // to set-returning RPCs too. With >1000 priced competitor_products the RPC
  // would silently return only the first 1000 and the rest would show as
  // "invalid link". So we page the RPC with range() exactly like a table.
  const PAGE = 1000
  const prices = {}, suspect = {}
  let newest = null, start = 0
  for (let page = 0; page < 50; page++) {
    const { data, error } = await supabase
      .rpc('get_latest_prices', { days })
      .range(start, start + PAGE - 1)
    if (error) return legacyLatestPrices(days)   // RPC missing/errored → old path
    for (const r of (data || [])) {
      prices[r.competitor_product_id] = r
      if (r.is_suspect) suspect[r.competitor_product_id] = true
      if (r.captured_at && (!newest || r.captured_at > newest)) newest = r.captured_at
    }
    if (!data || data.length < PAGE) break
    start += PAGE
  }
  return { prices, suspect, newest }
}

// Legacy: page the recent window newest-first and keep the first row seen per
// cp (= latest). Kept only as a safety net for un-migrated environments.
async function legacyLatestPrices(days) {
  const from = new Date(); from.setDate(from.getDate() - days)
  const PAGE = 1000, prices = {}, suspect = {}
  let start = 0, newest = null
  let cols = 'competitor_product_id, price, currency_code, captured_at, is_suspect'
  for (let page = 0; page < 50; page++) {
    let { data, error } = await supabase.from('price_history')
      .select(cols).gte('captured_at', from.toISOString())
      .order('captured_at', { ascending: false }).range(start, start + PAGE - 1)
    if (error && /is_suspect/.test(error.message || '') && cols.includes('is_suspect')) {
      cols = 'competitor_product_id, price, currency_code, captured_at'; page--; continue
    }
    if (error) throw error
    for (const row of (data || [])) {
      const id = row.competitor_product_id
      if (!newest && row.captured_at) newest = row.captured_at
      if (row.is_suspect) { if (!(id in prices)) suspect[id] = true; continue }
      if (!(id in prices)) prices[id] = row
    }
    if (!data || data.length < PAGE) break
    start += PAGE
  }
  return { prices, suspect, newest }
}

/**
 * fetchLatestStock — latest in_stock per competitor_product via the
 * get_latest_stock() RPC, with the same legacy fallback. Stock is a
 * nice-to-have, so any error resolves to {} rather than throwing.
 * Returns { [cpId]: boolean }.
 */
export async function fetchLatestStock(days = 60) {
  // Same 1000-row cap applies — page the RPC with range().
  const PAGE = 1000
  const stock = {}
  let start = 0
  for (let page = 0; page < 50; page++) {
    const { data, error } = await supabase
      .rpc('get_latest_stock', { days })
      .range(start, start + PAGE - 1)
    if (error) return legacyLatestStock(days)   // RPC missing/errored → old path
    for (const r of (data || [])) stock[r.competitor_product_id] = r.in_stock
    if (!data || data.length < PAGE) break
    start += PAGE
  }
  return stock
}

// Legacy stock paginator — safety net for un-migrated environments.
async function legacyLatestStock(days) {
  const from = new Date(); from.setDate(from.getDate() - days)
  const PAGE = 1000, stock = {}
  let start = 0
  for (let page = 0; page < 50; page++) {
    const { data, error } = await supabase.from('stock_history')
      .select('competitor_product_id, in_stock, captured_at')
      .gte('captured_at', from.toISOString())
      .order('captured_at', { ascending: false })
      .range(start, start + PAGE - 1)
    if (error) break   // never block the grid on stock
    for (const row of (data || [])) {
      if (!(row.competitor_product_id in stock)) stock[row.competitor_product_id] = row.in_stock
    }
    if (!data || data.length < PAGE) break
    start += PAGE
  }
  return stock
}
