import { chromium } from 'playwright'
import { supabase } from './supabase.js'

/**
 * runScrapeJob — process one scrape_runs row end-to-end.
 *
 * Strategy for finding prices:
 *  1. Try competitor's user-configured `scrape_config.priceSelector` (if any).
 *  2. Fall back to a broad candidate list covering schema.org, common
 *     e-commerce platforms (Shopify, Magento, WooCommerce, BigCommerce),
 *     data-attributes, and generic price-classed elements.
 *  3. Last-ditch: regex over the whole page text for currency-prefixed
 *     numbers ("KD 342.500", "KWD 45", "$99.99").
 *
 * When nothing works we still save a raw_html_sample of the page so a
 * human can spot the right selector without SSHing anywhere.
 */

const PRICE_CANDIDATES = [
  // Schema.org — usually the strongest signal
  'meta[itemprop="price"]',
  '[itemprop="price"]',
  // Common platform-specific
  '.product-single__price',      // Shopify
  '.price-item--sale',            // Shopify
  '.price-item--regular',         // Shopify
  '.woocommerce-Price-amount',   // WooCommerce
  '.price-including-tax .price',  // Magento
  '.product-info-price .price',  // Magento
  '.productView-price',           // BigCommerce
  // Data attributes
  '[data-testid*="price" i]',
  '[data-qa*="price" i]',
  '[data-hook*="price" i]',
  '[data-price]',
  // Generic classes that contain "price"
  '[class*="ProductPrice"]',
  '[class*="product-price"]',
  '[class*="ProductCard-price"]',
  '.current-price',
  '.sale-price',
  '.selling-price',
  '.final-price',
  '.actual-price',
  '.price-current',
  '.priceValue',
  '.price-value',
  '.price-tag',
  '.product-price',
  '.price',
  '.amount',
  '.money',
  // React/Vue apps often use span with price string inside
  'span.price',
  'div.price',
]

const STOCK_CANDIDATES = [
  '[itemprop="availability"]',
  '[data-testid*="stock" i]',
  '[data-testid*="availability" i]',
  '[class*="stock" i]',
  '[class*="availability" i]',
  '.in-stock',
  '.out-of-stock',
  '.availability',
  '.stock-status',
]

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
  const userPriceSel = (config.priceSelector || '').trim()
  const userStockSel = (config.stockSelector || '').trim()

  const browser = await chromium.launch({
    headless: true,
    proxy: process.env.HTTP_PROXY ? { server: process.env.HTTP_PROXY } : undefined,
  })

  let scraped = 0, failed = 0, notFound = 0
  const errors = []

  for (const cp of (items || [])) {
    const started = Date.now()
    let ctx = null
    try {
      ctx = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1440, height: 900 },
        locale: 'en-US',
      })
      const page = await ctx.newPage()

      // Block heavy resources for speed
      await page.route('**/*', route => {
        const t = route.request().resourceType()
        if (t === 'image' || t === 'media' || t === 'font') return route.abort()
        return route.continue()
      })

      await page.goto(cp.url, { waitUntil: 'domcontentloaded', timeout: 45_000 })

      if (config.waitFor?.trim()) {
        await page.waitForSelector(config.waitFor, { timeout: 10_000 }).catch(() => {})
      } else {
        // Wait longer for JS-rendered prices to settle. Next.js/React
        // sites need extra hydration time; 8s wasn't enough on Xcite TVs.
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
        // Extra beat for post-hydration price fetches
        await page.waitForTimeout(1500)
      }

      const { price, matchedSelector, htmlSample } = await extractPrice(page, userPriceSel)
      const inStock = await extractStock(page, userStockSel)

      await ctx.close(); ctx = null

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
        raw_html_sample: htmlSample,          // ← always saved when nothing matched
        error_message: price == null ? `No price found. Tried: ${matchedSelector || 'all candidates'}` : null,
        duration_ms: Date.now() - started,
      })

      if (price != null) {
        scraped++
        console.log(`[scraper] ✓ ${cp.name}: ${price} via ${matchedSelector}`)
      } else {
        notFound++
        console.log(`[scraper] ✗ ${cp.name}: no price extracted`)
      }
    } catch (e) {
      failed++
      errors.push(e.message)
      if (ctx) await ctx.close().catch(() => {})
      await supabase.from('scrape_jobs').insert({
        scrape_run_id: run.id,
        competitor_product_id: cp.id,
        status: 'error',
        error_message: e.message,
        duration_ms: Date.now() - started,
      })
      console.log(`[scraper] ERROR ${cp.name}: ${e.message}`)
    }
  }

  await browser.close()

  await supabase.from('scrape_runs').update({
    status: failed > (scraped + notFound) ? 'failed' : 'completed',
    finished_at: new Date().toISOString(),
    items_scraped: scraped,
    items_failed: failed + notFound,
    error_summary: errors.slice(0, 3).join(' | ') || (notFound > 0 ? `${notFound} URL(s) had no matching price selector` : null),
  }).eq('id', run.id)

  console.log(`[scraper] run ${run.id} done: ${scraped} ok, ${notFound} not_found, ${failed} error`)
}

/**
 * Try to extract a price using: user's selector → broad candidate list →
 * whole-page regex. Always returns an htmlSample when we couldn't match,
 * so a human can pop it open and see what to configure.
 */
async function extractPrice(page, userSelector) {
  const candidates = userSelector ? [userSelector, ...PRICE_CANDIDATES] : PRICE_CANDIDATES

  for (const sel of candidates) {
    try {
      // meta[itemprop=price] uses its `content` attribute, not textContent
      if (sel.startsWith('meta')) {
        const val = await page.$eval(sel, el => el.getAttribute('content')).catch(() => null)
        const p = parsePrice(val)
        if (p != null) return { price: p, matchedSelector: sel, htmlSample: null }
        continue
      }
      const text = await page.$eval(sel, el => el.textContent).catch(() => null)
      const p = parsePrice(text)
      if (p != null) return { price: p, matchedSelector: sel, htmlSample: null }
    } catch { /* try next */ }
  }

  // Last resort: page-wide regex for currency-prefixed numbers.
  try {
    const html = await page.content()
    // Save 4KB from the middle (usually where price data lives) not just the head
    const htmlSample = html.length > 8000
      ? html.slice(Math.floor(html.length / 2) - 2000, Math.floor(html.length / 2) + 2000)
      : html.slice(0, 4000)

    // Next.js sites embed the entire page data in a __NEXT_DATA__ script.
    // Xcite runs Next.js; TV pages hide the price behind React hydration
    // but __NEXT_DATA__ has it plainly.
    const nextDataMatch = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/)
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1])
        const priceFromNext = findPriceInObject(nextData)
        if (priceFromNext != null) return { price: priceFromNext, matchedSelector: '__NEXT_DATA__', htmlSample }
      } catch { /* JSON parse failed, move on */ }
    }

    // Look for structured data — many sites embed price in JSON-LD
    const jsonLdMatch = html.match(/"price"\s*:\s*"?(\d+(?:\.\d+)?)"?/i)
    if (jsonLdMatch) {
      const p = parseFloat(jsonLdMatch[1])
      if (isFinite(p) && p > 0) return { price: p, matchedSelector: 'jsonld:price', htmlSample }
    }
    // og:price:amount meta tag
    const ogMatch = html.match(/property="?(?:og:price:amount|product:price:amount)"?\s+content="?([\d.]+)"?/i)
    if (ogMatch) {
      const p = parseFloat(ogMatch[1])
      if (isFinite(p) && p > 0) return { price: p, matchedSelector: 'meta:og-price', htmlSample }
    }
    return { price: null, matchedSelector: null, htmlSample }
  } catch (e) {
    return { price: null, matchedSelector: null, htmlSample: null }
  }
}

/**
 * Recursively walk a Next.js page-data blob looking for a plausible
 * product price. Keys tried in order of specificity. Values are cross-
 * checked with parsePrice to filter out storage sizes / ratings / etc.
 */
function findPriceInObject(obj, depth = 0) {
  if (depth > 10 || obj == null) return null
  if (typeof obj !== 'object') return null
  const PRICE_KEYS = [
    'sellingPrice', 'salePrice', 'offerPrice', 'finalPrice',
    'currentPrice', 'listPrice', 'discountedPrice', 'productPrice',
    'price', 'amount',
  ]
  for (const key of PRICE_KEYS) {
    if (key in obj) {
      const raw = obj[key]
      if (typeof raw === 'number' && raw > 0.05 && raw < 1_000_000) return raw
      if (typeof raw === 'string') {
        const p = parsePrice(raw)
        if (p != null) return p
      }
      if (raw && typeof raw === 'object') {
        // e.g. { amount: "419.9", currency: "KWD" }
        for (const sub of ['amount', 'value', 'raw', 'centAmount']) {
          if (sub in raw) {
            const p = typeof raw[sub] === 'number' ? raw[sub] : parsePrice(raw[sub])
            if (p != null && p > 0.05 && p < 1_000_000) {
              // centAmount is usually in cents; heuristic: >100000 → divide by 1000
              return sub === 'centAmount' && p > 100000 ? p / 1000 : p
            }
          }
        }
      }
    }
  }
  // Recurse into arrays and children
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const p = findPriceInObject(item, depth + 1)
      if (p != null) return p
    }
  } else {
    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object') {
        const p = findPriceInObject(val, depth + 1)
        if (p != null) return p
      }
    }
  }
  return null
}

async function extractStock(page, userSelector) {
  const candidates = userSelector ? [userSelector, ...STOCK_CANDIDATES] : STOCK_CANDIDATES
  for (const sel of candidates) {
    try {
      const text = await page.$eval(sel, el => el.textContent).catch(() => null)
      const parsed = parseStock(text)
      if (parsed !== null) return parsed
    } catch { /* try next */ }
  }
  return null
}

function parsePrice(text) {
  if (!text) return null
  // Strip common noise, keep digits + dot
  const cleaned = String(text)
    .replace(/,/g, '')                     // "1,234.5" → "1234.5"
    .replace(/[^\d.\s]/g, ' ')             // Drop currency symbols etc.
  const nums = cleaned.match(/\d+(?:\.\d+)?/g) || []
  // Filter out likely-junk (too small, too big)
  const candidates = nums
    .map(n => parseFloat(n))
    .filter(n => isFinite(n) && n > 0.05 && n < 1_000_000)
  if (candidates.length === 0) return null
  // Prefer the first plausibly-decimal number (e.g. 342.500 not 256)
  return candidates.find(n => n % 1 !== 0) ?? candidates[0]
}

function parseStock(text) {
  if (text == null) return null
  const t = String(text).toLowerCase()
  if (t.includes('in stock') || t.includes('available') || t.includes('instock')) return true
  if (t.includes('out of stock') || t.includes('unavailable') || t.includes('sold out') || t.includes('out-of-stock')) return false
  return null
}
# force-tick: 2026-07-12T12:44:54Z
