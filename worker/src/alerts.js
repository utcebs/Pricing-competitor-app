import { supabase } from './supabase.js'
import { Resend } from 'resend'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const FROM_ADDRESS = process.env.ALERT_FROM || 'alerts@yourcompany.com'

/**
 * checkAlertRules — evaluate every active alert_rule against the
 * last hour of price + stock history and log deliveries.
 *
 * All six trigger kinds are supported:
 *   - price_dropped        · price_increased
 *   - went_out_of_stock    · came_back_in_stock
 *   - gap_pct_over         · gap_pct_under
 *
 * For instant delivery, email is sent immediately.
 * For digest delivery, rows are marked `pending`; sendDigestEmails()
 * (called from index.js on a 9 AM cron) sweeps them into one email
 * per user per day.
 */
export async function checkAlertRules() {
  const { data: rules } = await supabase.from('alert_rules').select('*').eq('is_active', true)
  if (!rules?.length) return

  const cutoff = new Date(Date.now() - 3600_000).toISOString()

  // Grab recent price + stock rows to check against.
  const [{ data: recentPrices }, { data: recentStocks }] = await Promise.all([
    supabase.from('price_history')
      .select('id, competitor_product_id, price, captured_at')
      .gte('captured_at', cutoff).order('captured_at', { ascending: true }),
    supabase.from('stock_history')
      .select('id, competitor_product_id, in_stock, captured_at')
      .gte('captured_at', cutoff).order('captured_at', { ascending: true }),
  ])

  // Preload competitor_products for scope filtering
  const cpIds = [
    ...new Set([...(recentPrices || []).map(r => r.competitor_product_id),
                ...(recentStocks || []).map(r => r.competitor_product_id)]),
  ]
  const { data: cps } = await supabase.from('competitor_products')
    .select('id, product_id, category_id, competitor_id').in('id', cpIds)
  const cpById = Object.fromEntries((cps || []).map(x => [x.id, x]))

  for (const rule of rules) {
    // Price-based triggers
    if (['price_dropped', 'price_increased', 'gap_pct_over', 'gap_pct_under'].includes(rule.trigger)) {
      for (const row of (recentPrices || [])) {
        const cp = cpById[row.competitor_product_id]
        if (!cp || !matchesScope(rule, cp)) continue
        const hit = await evalPriceRule(rule, row, cp)
        if (hit) await logDelivery(rule, cp, hit)
      }
    }
    // Stock-based triggers
    if (['went_out_of_stock', 'came_back_in_stock'].includes(rule.trigger)) {
      for (const row of (recentStocks || [])) {
        const cp = cpById[row.competitor_product_id]
        if (!cp || !matchesScope(rule, cp)) continue
        const hit = await evalStockRule(rule, row)
        if (hit) await logDelivery(rule, cp, hit)
      }
    }
  }
}

function matchesScope(rule, cp) {
  switch (rule.scope) {
    case 'any_product':         return true
    case 'specific_product':    return cp.product_id === rule.scope_ref_id
    case 'specific_category':   return cp.category_id === rule.scope_ref_id
    case 'specific_competitor': return cp.competitor_id === rule.scope_ref_id
    default: return false
  }
}

async function evalPriceRule(rule, row, cp) {
  // Fetch previous price for change detection
  const { data: prev } = await supabase.from('price_history')
    .select('price')
    .eq('competitor_product_id', row.competitor_product_id)
    .lt('captured_at', row.captured_at)
    .order('captured_at', { ascending: false })
    .limit(1)
  const prevPrice = prev?.[0]?.price != null ? Number(prev[0].price) : null
  const price = Number(row.price)

  if (rule.trigger === 'price_dropped' && prevPrice != null && price < prevPrice) {
    return { event: `Price dropped from ${prevPrice} to ${price}`, oldValue: prevPrice, newValue: price }
  }
  if (rule.trigger === 'price_increased' && prevPrice != null && price > prevPrice) {
    return { event: `Price increased from ${prevPrice} to ${price}`, oldValue: prevPrice, newValue: price }
  }
  // Gap-based — needs your product current_price
  if (['gap_pct_over', 'gap_pct_under'].includes(rule.trigger) && cp.product_id) {
    const { data: prod } = await supabase.from('products')
      .select('current_price').eq('id', cp.product_id).single()
    const your = prod?.current_price != null ? Number(prod.current_price) : null
    if (your && your > 0) {
      // Gap: (competitor - your) / your * 100. Positive = they're more expensive.
      const gapPct = ((price - your) / your) * 100
      const threshold = Number(rule.threshold_pct)
      if (rule.trigger === 'gap_pct_over'  && gapPct > threshold) {
        return { event: `Competitor gap ${gapPct.toFixed(1)}% above yours (threshold ${threshold}%)`, oldValue: your, newValue: price }
      }
      if (rule.trigger === 'gap_pct_under' && gapPct < threshold) {
        return { event: `Competitor gap ${gapPct.toFixed(1)}% below yours (threshold ${threshold}%)`, oldValue: your, newValue: price }
      }
    }
  }
  return null
}

async function evalStockRule(rule, row) {
  const { data: prev } = await supabase.from('stock_history')
    .select('in_stock')
    .eq('competitor_product_id', row.competitor_product_id)
    .lt('captured_at', row.captured_at)
    .order('captured_at', { ascending: false })
    .limit(1)
  const prevStock = prev?.[0]?.in_stock
  if (prevStock == null) return null

  if (rule.trigger === 'went_out_of_stock' && prevStock === true && row.in_stock === false) {
    return { event: 'Competitor went out of stock', oldValue: null, newValue: null }
  }
  if (rule.trigger === 'came_back_in_stock' && prevStock === false && row.in_stock === true) {
    return { event: 'Competitor came back in stock', oldValue: null, newValue: null }
  }
  return null
}

async function logDelivery(rule, cp, hit) {
  // Idempotency: don't spam — skip if the same event was logged in last 30 min
  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString()
  const { data: existing } = await supabase.from('alert_deliveries')
    .select('id')
    .eq('alert_rule_id', rule.id)
    .eq('competitor_product_id', cp.id)
    .gte('created_at', cutoff)
    .limit(1)
  if (existing?.length) return

  const { data: delivery } = await supabase.from('alert_deliveries').insert({
    alert_rule_id: rule.id,
    competitor_product_id: cp.id,
    event: hit.event,
    old_value: hit.oldValue,
    new_value: hit.newValue,
    delivery_status: 'pending',
  }).select().single()

  if (rule.delivery === 'instant') {
    await sendInstantEmail(rule, delivery, hit)
  }
  // digest deliveries remain 'pending' — swept by sendDigestEmails()
}

async function sendInstantEmail(rule, delivery, hit) {
  if (!resend) {
    await supabase.from('alert_deliveries').update({
      delivery_status: 'skipped', delivery_error: 'RESEND_API_KEY not configured',
    }).eq('id', delivery.id)
    return
  }
  const { data: owner } = await supabase.from('profiles')
    .select('email, full_name').eq('id', rule.owner_id).single()
  if (!owner?.email) return

  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: owner.email,
      subject: `[Price Alert] ${rule.name}`,
      html: `
        <div style="font-family:system-ui,sans-serif">
          <h2 style="color:#4f46e5">${rule.name}</h2>
          <p>${hit.event}</p>
          <p style="color:#64748b;font-size:13px">Rule: ${rule.name}</p>
        </div>
      `,
    })
    await supabase.from('alert_deliveries').update({
      delivery_status: 'sent', delivered_at: new Date().toISOString(),
    }).eq('id', delivery.id)
  } catch (e) {
    await supabase.from('alert_deliveries').update({
      delivery_status: 'failed', delivery_error: e.message,
    }).eq('id', delivery.id)
  }
}

/**
 * sendDigestEmails — called from index.js on a daily 9 AM cron.
 * Groups all pending digest-delivery rows by user, sends one email
 * per user, marks all their rows as 'sent'.
 */
export async function sendDigestEmails() {
  if (!resend) {
    console.log('[digest] Skipped — RESEND_API_KEY not set')
    return
  }
  // Pull pending rows for rules with delivery='digest'
  const { data: pending } = await supabase.from('alert_deliveries')
    .select('*, alert_rules!inner(name, owner_id, delivery)')
    .eq('delivery_status', 'pending')
    .eq('alert_rules.delivery', 'digest')

  if (!pending?.length) { console.log('[digest] Nothing to send'); return }

  // Group by owner
  const byOwner = new Map()
  for (const p of pending) {
    const ownerId = p.alert_rules.owner_id
    const arr = byOwner.get(ownerId) || []
    arr.push(p); byOwner.set(ownerId, arr)
  }

  for (const [ownerId, rows] of byOwner) {
    const { data: owner } = await supabase.from('profiles')
      .select('email, full_name').eq('id', ownerId).single()
    if (!owner?.email) continue

    const bodyRows = rows.map(r => `
      <li style="margin-bottom:8px">
        <strong>${r.alert_rules.name}</strong><br>
        <span style="color:#475569">${r.event}</span><br>
        <span style="color:#94a3b8;font-size:11px">${new Date(r.created_at).toLocaleString()}</span>
      </li>
    `).join('')

    try {
      await resend.emails.send({
        from: FROM_ADDRESS,
        to: owner.email,
        subject: `[Price Digest] ${rows.length} alert${rows.length > 1 ? 's' : ''} today`,
        html: `
          <div style="font-family:system-ui,sans-serif">
            <h2 style="color:#4f46e5">Your daily price digest</h2>
            <p style="color:#64748b">${rows.length} event${rows.length > 1 ? 's' : ''} in the last 24 hours.</p>
            <ul style="padding-left:20px">${bodyRows}</ul>
          </div>
        `,
      })
      const nowIso = new Date().toISOString()
      await supabase.from('alert_deliveries')
        .update({ delivery_status: 'sent', delivered_at: nowIso })
        .in('id', rows.map(r => r.id))
    } catch (e) {
      await supabase.from('alert_deliveries')
        .update({ delivery_status: 'failed', delivery_error: e.message })
        .in('id', rows.map(r => r.id))
    }
  }
}
