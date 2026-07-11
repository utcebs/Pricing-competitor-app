import { supabase } from './supabase.js'
import { Resend } from 'resend'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

/**
 * checkAlertRules — evaluate every active alert_rule against the
 * last few hours of price/stock history and enqueue email deliveries.
 *
 * Trigger types:
 *  - price_dropped:      new price < previous price
 *  - price_increased:    new price > previous price
 *  - went_out_of_stock:  in_stock=false right after in_stock=true
 *  - came_back_in_stock: opposite
 *  - gap_pct_over/under: |competitor - your price| / your price crosses threshold
 *
 * Instant delivery → email now. Digest delivery → aggregate + one email at 9 AM.
 * The 9 AM digest is triggered by a separate cron.schedule('0 9 * * *') that
 * queries pending alert_deliveries with delivery_status='pending' and rule.delivery='digest'.
 */
export async function checkAlertRules() {
  const { data: rules } = await supabase.from('alert_rules').select('*').eq('is_active', true)
  if (!rules?.length) return

  const cutoff = new Date(Date.now() - 3600_000).toISOString() // last hour

  // Fetch recent price history + previous-price context for change detection.
  const { data: recentPrices } = await supabase
    .from('price_history')
    .select('id, competitor_product_id, price, captured_at')
    .gte('captured_at', cutoff)
    .order('captured_at', { ascending: true })

  for (const rule of rules) {
    for (const row of (recentPrices || [])) {
      const shouldFire = await evaluateRule(rule, row)
      if (!shouldFire) continue

      // Log delivery
      const { data: delivery } = await supabase.from('alert_deliveries').insert({
        alert_rule_id: rule.id,
        competitor_product_id: row.competitor_product_id,
        event: shouldFire.event,
        old_value: shouldFire.oldValue ?? null,
        new_value: shouldFire.newValue ?? null,
        delivery_status: 'pending',
      }).select().single()

      // Instant delivery — send now
      if (rule.delivery === 'instant' && delivery) {
        await deliverEmail(rule, delivery)
      }
    }
  }
}

async function evaluateRule(rule, priceRow) {
  // Fetch previous price for this competitor_product to detect change
  const { data: prev } = await supabase.from('price_history')
    .select('price')
    .eq('competitor_product_id', priceRow.competitor_product_id)
    .lt('captured_at', priceRow.captured_at)
    .order('captured_at', { ascending: false })
    .limit(1)
  const prevPrice = prev?.[0]?.price

  if (rule.trigger === 'price_dropped' && prevPrice != null && priceRow.price < prevPrice) {
    return { event: `Price dropped from ${prevPrice} to ${priceRow.price}`, oldValue: prevPrice, newValue: priceRow.price }
  }
  if (rule.trigger === 'price_increased' && prevPrice != null && priceRow.price > prevPrice) {
    return { event: `Price increased from ${prevPrice} to ${priceRow.price}`, oldValue: prevPrice, newValue: priceRow.price }
  }
  // TODO: went_out_of_stock / came_back_in_stock — need stock_history join
  // TODO: gap_pct_over / gap_pct_under — need to look up your product's current_price
  return null
}

async function deliverEmail(rule, delivery) {
  if (!resend) {
    await supabase.from('alert_deliveries')
      .update({ delivery_status: 'skipped', delivery_error: 'RESEND_API_KEY not configured' })
      .eq('id', delivery.id)
    return
  }
  const { data: owner } = await supabase.from('profiles').select('email').eq('id', rule.owner_id).single()
  if (!owner?.email) return

  try {
    await resend.emails.send({
      from: 'alerts@yourcompany.com', // TODO: replace with your verified sender
      to: owner.email,
      subject: `[Price Alert] ${rule.name}`,
      html: `<p>${delivery.event}</p><p>Rule: ${rule.name}</p>`,
    })
    await supabase.from('alert_deliveries')
      .update({ delivery_status: 'sent', delivered_at: new Date().toISOString() })
      .eq('id', delivery.id)
  } catch (e) {
    await supabase.from('alert_deliveries')
      .update({ delivery_status: 'failed', delivery_error: e.message })
      .eq('id', delivery.id)
  }
}
