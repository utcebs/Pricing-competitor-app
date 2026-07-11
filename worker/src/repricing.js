import { supabase } from './supabase.js'

/**
 * evaluateRepricingRules — for every active pricing_rule, compute a
 * suggested price using the strategy, apply the guardrails (min_price,
 * target_margin, only_if_competitor_in_stock), and either:
 *   - insert into pricing_proposals with status='pending' (approval flow), OR
 *   - if rule.auto_apply=true, update products.current_price directly and
 *     insert a proposal with status='applied' for audit.
 *
 * Runs each tick (every minute in index.js). Idempotency: we skip
 * generating a new proposal if one already exists for the same product
 * with the same suggested_price in the last hour.
 */
export async function evaluateRepricingRules() {
  const { data: rules } = await supabase
    .from('pricing_rules').select('*').eq('is_active', true)
    .order('priority', { ascending: true })
  if (!rules?.length) return

  const { data: products } = await supabase.from('products').select('*').eq('is_active', true)

  for (const rule of rules) {
    const inScope = products.filter(p => productMatchesScope(p, rule))
    for (const product of inScope) {
      const competitorPrices = await latestCompetitorPricesFor(product, rule.only_if_competitor_in_stock)
      if (!competitorPrices.length) continue

      const suggested = computeSuggestion(rule, competitorPrices)
      if (suggested == null) continue

      // Guardrails
      let final = suggested
      if (rule.respect_min_price && product.min_price != null && final < product.min_price) continue
      if (rule.respect_target_margin && product.cost_price != null && product.target_margin != null) {
        const marginFloor = Number(product.cost_price) * (1 + Number(product.target_margin) / 100)
        if (final < marginFloor) continue
      }
      // Round to 3 decimals (KWD)
      final = Math.round(final * 1000) / 1000

      if (product.current_price != null && Math.abs(Number(product.current_price) - final) < 0.001) {
        continue // no meaningful change
      }

      // Idempotency: skip if a pending proposal exists for same product+suggested in last hour
      const cutoff = new Date(Date.now() - 3600_000).toISOString()
      const { data: existing } = await supabase.from('pricing_proposals')
        .select('id')
        .eq('product_id', product.id)
        .eq('status', 'pending')
        .gte('created_at', cutoff)
        .limit(1)
      if (existing?.length) continue

      const reason = `Rule "${rule.name}" — competitors averaging ${avg(competitorPrices).toFixed(3)}, suggests ${final}`

      if (rule.auto_apply) {
        // Direct apply — audit trail
        await supabase.from('products')
          .update({ current_price: final })
          .eq('id', product.id)
        await supabase.from('pricing_proposals').insert({
          product_id: product.id,
          rule_id: rule.id,
          current_price: product.current_price,
          suggested_price: final,
          reason,
          status: 'applied',
          applied_at: new Date().toISOString(),
        })
      } else {
        await supabase.from('pricing_proposals').insert({
          product_id: product.id,
          rule_id: rule.id,
          current_price: product.current_price,
          suggested_price: final,
          reason,
          status: 'pending',
        })
      }
    }
  }
}

function productMatchesScope(product, rule) {
  if (rule.scope === 'all_products')     return true
  if (rule.scope === 'specific_category') return product.category_id === rule.scope_ref_id
  if (rule.scope === 'specific_product')  return product.id === rule.scope_ref_id
  return false
}

async function latestCompetitorPricesFor(product, onlyInStock) {
  const { data: cps } = await supabase.from('competitor_products')
    .select('id')
    .eq('product_id', product.id)
    .eq('is_active', true)
  const ids = (cps || []).map(c => c.id)
  if (!ids.length) return []

  const { data: prices } = await supabase.from('price_history')
    .select('competitor_product_id, price, captured_at')
    .in('competitor_product_id', ids)
    .order('captured_at', { ascending: false })
    .limit(200)

  // Take the latest one per competitor_product
  const latestByCp = new Map()
  for (const p of (prices || [])) {
    if (!latestByCp.has(p.competitor_product_id)) latestByCp.set(p.competitor_product_id, p)
  }

  let arr = [...latestByCp.values()].map(p => Number(p.price)).filter(n => isFinite(n))

  if (onlyInStock) {
    // Filter to only competitor_products that are in-stock per most recent stock_history
    const { data: stocks } = await supabase.from('stock_history')
      .select('competitor_product_id, in_stock, captured_at')
      .in('competitor_product_id', ids)
      .order('captured_at', { ascending: false })
      .limit(200)
    const latestStock = new Map()
    for (const s of (stocks || [])) {
      if (!latestStock.has(s.competitor_product_id)) latestStock.set(s.competitor_product_id, s.in_stock)
    }
    const inStockIds = new Set([...latestStock.entries()].filter(([, v]) => v).map(([k]) => k))
    arr = [...latestByCp.entries()].filter(([id]) => inStockIds.has(id)).map(([, v]) => Number(v.price))
  }

  return arr
}

function computeSuggestion(rule, prices) {
  const lowest = Math.min(...prices)
  const average = avg(prices)
  switch (rule.strategy) {
    case 'match_lowest':       return lowest
    case 'beat_lowest_by_pct': return lowest * (1 - Number(rule.strategy_value) / 100)
    case 'beat_lowest_by_amt': return lowest - Number(rule.strategy_value)
    case 'match_average':      return average
    case 'stay_x_pct_above':   return lowest * (1 + Number(rule.strategy_value) / 100)
    case 'stay_x_pct_below':   return lowest * (1 - Number(rule.strategy_value) / 100)
    default: return null
  }
}

const avg = arr => arr.reduce((s, x) => s + x, 0) / arr.length
