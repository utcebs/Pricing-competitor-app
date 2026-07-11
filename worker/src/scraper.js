import { chromium } from 'playwright'
import { supabase } from './supabase.js'

/**
 * runScrapeJob — process one scrape_runs row end-to-end.
 *
 * 1. Mark run as 'running'
 * 2. Pull all active competitor_products for that competitor
 * 3. For each, open the URL with Playwright + configured selectors
 * 4. Extract price + stock. Log to price_history + stock_history
 * 5. Bump competitor_products.last_seen_at
 * 6. Mark run as 'completed' with counts
 *
 * Anti-bot handling: this launches its own Playwright browser with a
 * generic user-agent + viewport. For sites that block, wire in
 * ScraperAPI or Bright Data by setting HTTP_PROXY env var and passing
 * to `chromium.launch({ proxy: { server: process.env.HTTP_PROXY } })`.
 */
export async function runScrapeJob(run) {
  console.log(`[scraper] starting run ${run.id} for competitor ${run.competitor_id}`)

  await supabase.from('scrape_runs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', run.id)

  const { data: competitor } = await supabase
    .from('competitors').select('*').eq('id', run.competitor_id).single()
  const { data: items } = await supabase
    .from('competitor_products').select('*')
    .eq('competitor_id', run.competitor_id).eq('is_active', true)

  const config = competitor?.scrape_config || {}
  // config shape: { priceSelector, stockSelector, waitFor, extraHeaders? }
  const priceSel = config.priceSelector || '[itemprop="price"], .price, .product-price'
  const stockSel = config.stockSelector || '[itemprop="availability"], .stock, .availability'

  const browser = await chromium.launch({
    headless: true,
    proxy: process.env.HTTP_PROXY ? { server: process.env.HTTP_PROXY } : undefined,
  })

  let scraped = 0, failed = 0
  const errors = []

  for (const cp of (items || [])) {
    const started = Date.now()
    try {
      const ctx = await browser.newContext({
        userAgent: 'Mozilla/5.0 (compatible; PriceCompetitorBot/0.1)',
        viewport: { width: 1280, height: 800 },
      })
      const page = await ctx.newPage()
      await page.goto(cp.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      if (config.waitFor) await page.waitForSelector(config.waitFor, { timeout: 10_000 }).catch(() => {})

      const priceText = await page.$eval(priceSel, el => el.textContent).catch(() => null)
      const stockText = await page.$eval(stockSel, el => el.textContent).catch(() => '')
      const price = parsePrice(priceText)
      const inStock = parseStock(stockText)

      await ctx.close()

      if (price != null) {
        await supabase.from('price_history').insert({
          competitor_product_id: cp.id,
          price,
          currency_code: cp.currency_code || 'KWD',
          source: 'scrape',
          scrape_run_id: run.id,
        })
      }
      if (inStock !== null) {
        await supabase.from('stock_history').insert({
          competitor_product_id: cp.id,
          in_stock: inStock,
          source: 'scrape',
          scrape_run_id: run.id,
        })
      }
      await supabase.from('competitor_products')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', cp.id)

      await supabase.from('scrape_jobs').insert({
        scrape_run_id: run.id,
        competitor_product_id: cp.id,
        status: price != null ? 'ok' : 'not_found',
        price_extracted: price,
        in_stock_extracted: inStock,
        duration_ms: Date.now() - started,
      })

      scraped++
    } catch (e) {
      failed++
      errors.push(e.message)
      await supabase.from('scrape_jobs').insert({
        scrape_run_id: run.id,
        competitor_product_id: cp.id,
        status: 'error',
        error_message: e.message,
        duration_ms: Date.now() - started,
      })
    }
  }

  await browser.close()

  await supabase.from('scrape_runs').update({
    status: failed > scraped ? 'failed' : 'completed',
    finished_at: new Date().toISOString(),
    items_scraped: scraped,
    items_failed: failed,
    error_summary: errors.slice(0, 5).join(' | ') || null,
  }).eq('id', run.id)

  console.log(`[scraper] run ${run.id} done: ${scraped} ok, ${failed} failed`)
}

function parsePrice(text) {
  if (!text) return null
  const match = text.replace(/,/g, '').match(/[\d.]+/)
  if (!match) return null
  const n = parseFloat(match[0])
  return isFinite(n) ? n : null
}
function parseStock(text) {
  if (text == null) return null
  const t = text.toLowerCase()
  if (t.includes('in stock') || t.includes('available') || t.includes('instock')) return true
  if (t.includes('out of stock') || t.includes('unavailable') || t.includes('sold out')) return false
  return null
}
