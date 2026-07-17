import { chromium as chromiumExtra } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { supabase } from './supabase.js'

// Stealth: hides "I'm a headless browser" fingerprints (webdriver flag,
// missing plugins, ChromeDriver-only APIs, canvas/WebGL noise, etc.)
// Some evasions are Puppeteer-specific and are gracefully no-ops under
// Playwright — the ~20 that DO apply cover most anti-bot checks.
chromiumExtra.use(StealthPlugin())
const chromium = chromiumExtra

// Realistic User-Agent pool. Rotated per browser launch.
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.234 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
]
function randomUA() { return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] }

// Randomised delay: base ± jitter. Defaults 3-5 seconds between batches
// (was per-URL before parallelisation).
function humanDelay(minMs = 3000, maxMs = 5000) {
  return minMs + Math.floor(Math.random() * (maxMs - minMs))
}

/**
 * processOneUrl — extracted from the scrape loop so it can run
 * concurrently under Promise.all(). Shares the browser context (cookies
 * + storage) with sibling requests in the same batch.
 */
async function processOneUrl(cp, ctx, run, config, userPriceSel, userStockSel, counters) {
  const started = Date.now()
  let page = null
  try {
    page = await ctx.newPage()
    await page.goto(cp.url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    if (config.waitFor?.trim()) {
      await page.waitForSelector(config.waitFor, { timeout: 10_000 }).catch(() => {})
    } else {
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
      await page.waitForTimeout(1500)
    }
    const { price, matchedSelector, htmlSample } = await extractPrice(page, userPriceSel)
    const inStock = await extractStock(page, userStockSel)
    const imageUrl = await extractImage(page, cp.url)
    await page.close(); page = null

    if (price != null) {
      await supabase.from('price_history').insert({
        competitor_product_id: cp.id, price,
        currency_code: cp.currency_code || 'KWD',
        source: 'scrape', scrape_run_id: run.id,
      })
    }
    if (inStock !== null) {
      await supabase.from('stock_history').insert({
        competitor_product_id: cp.id, in_stock: inStock,
        source: 'scrape', scrape_run_id: run.id,
      })
    }
    const cpUpdate = { last_seen_at: new Date().toISOString() }
    if (imageUrl) cpUpdate.image_url = imageUrl
    await supabase.from('competitor_products').update(cpUpdate).eq('id', cp.id)
    if (imageUrl && cp.product_id) {
      await supabase.from('products')
        .update({ image_url: imageUrl })
        .eq('id', cp.product_id)
        .is('image_url', null)
    }
    await supabase.from('scrape_jobs').insert({
      scrape_run_id: run.id,
      competitor_product_id: cp.id,
      status: price != null ? 'ok' : 'not_found',
      price_extracted: price,
      in_stock_extracted: inStock,
      raw_html_sample: htmlSample,
      error_message: price == null ? `No price found. Tried: ${matchedSelector || 'all candidates'}` : null,
      duration_ms: Date.now() - started,
    })
    if (price != null) { counters.scraped++; console.log(`[scraper] ✓ ${cp.name}: ${price} via ${matchedSelector}`) }
    else { counters.notFound++; console.log(`[scraper] ✗ ${cp.name}: no price extracted`) }
  } catch (e) {
    counters.failed++
    counters.errors.push(e.message)
    if (page) await page.close().catch(() => {})
    await supabase.from('scrape_jobs').insert({
      scrape_run_id: run.id, competitor_product_id: cp.id,
      status: 'error', error_message: e.message,
      duration_ms: Date.now() - started,
    })
    console.log(`[scraper] ERROR ${cp.name}: ${e.message}`)
  }
}

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
  // Row-level lock: only claim if still queued. Prevents duplicate work
  // when multiple shard workflows race for the same run.
  const { data: claimed, error: claimErr } = await supabase.from('scrape_runs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', run.id)
    .eq('status', 'queued')
    .select()
  if (claimErr || !claimed || claimed.length === 0) {
    console.log(`[scraper] run ${run.id} was already claimed by another worker — skipping`)
    return
  }
  console.log(`[scraper] starting run ${run.id} for competitor ${run.competitor_id}`)

  const { data: competitor } = await supabase
    .from('competitors').select('*').eq('id', run.competitor_id).single()

  // If target_cp_id is set, this run should ONLY scrape that specific URL
  // (used by the per-URL "Scrape now" buttons). Otherwise scrape all
  // active URLs for the competitor.
  let itemsQuery = supabase.from('competitor_products').select('*')
    .eq('competitor_id', run.competitor_id).eq('is_active', true)
  if (run.target_cp_id) {
    itemsQuery = itemsQuery.eq('id', run.target_cp_id)
    console.log(`[scraper] targeted run: only competitor_products.id=${run.target_cp_id}`)
  }
  const { data: items } = await itemsQuery

  const config = competitor?.scrape_config || {}
  const userPriceSel = (config.priceSelector || '').trim()
  const userStockSel = (config.stockSelector || '').trim()
  // Per-competitor pacing config; defaults 3-5s between requests.
  const pacingMinMs = Number(config.pacingMinMs) || 3000
  const pacingMaxMs = Number(config.pacingMaxMs) || 5000

  const browser = await chromium.launch({
    headless: true,
    proxy: process.env.HTTP_PROXY ? { server: process.env.HTTP_PROXY } : undefined,
  })

  // ONE browser context per competitor. Cookies + localStorage persist
  // across URLs from the same site, so the second/third request looks
  // like a returning visitor. Random UA per launch.
  const ua = randomUA()
  const ctx = await browser.newContext({
    userAgent: ua,
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    // Match a real browser's Accept-Language for the region we're scraping
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
    },
  })
  // Block heavy resources ONCE for the whole context — faster + fewer signals
  await ctx.route('**/*', route => {
    const t = route.request().resourceType()
    if (t === 'image' || t === 'media' || t === 'font') return route.abort()
    return route.continue()
  })

  // Parallel scraping. Concurrency per-competitor from config, defaults to 5.
  // Tune per-site — high-tolerance sites: 8-10; low-tolerance sites: 2-3.
  const concurrency = Math.max(1, Math.min(10, Number(config.concurrency) || 5))

  const counters = { scraped: 0, failed: 0, notFound: 0, errors: [] }

  // Process URLs in batches of `concurrency`. Pacing gap sits BETWEEN
  // batches, not between URLs within a batch (so 5 URLs go out in one
  // burst, then 3-5s idle, then the next 5).
  const batches = []
  for (let i = 0; i < (items || []).length; i += concurrency) {
    batches.push(items.slice(i, i + concurrency))
  }

  console.log(`[scraper] ${items?.length || 0} URLs → ${batches.length} batch(es) of up to ${concurrency}`)

  for (let bi = 0; bi < batches.length; bi++) {
    if (bi > 0) {
      const delay = humanDelay(pacingMinMs, pacingMaxMs)
      console.log(`[scraper] batch ${bi} — pacing ${delay}ms before next burst`)
      await new Promise(r => setTimeout(r, delay))
    }
    await Promise.all(batches[bi].map(cp =>
      processOneUrl(cp, ctx, run, config, userPriceSel, userStockSel, counters)
    ))
  }

  await ctx.close().catch(() => {})
  await browser.close()

  const scraped = counters.scraped
  const failed = counters.failed
  const notFound = counters.notFound
  const errors = counters.errors

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

/**
 * Extract a product image URL. Priority:
 *   1. <link rel="preload" as="image"> — modern sites preload the hero
 *      product image; usually the CDN-optimised product photo
 *   2. JSON-LD product.image (schema.org — most reliable when present)
 *   3. <meta property="og:image"> — but only if it doesn't look like a logo
 *   4. <meta name="twitter:image"> — same filter
 *   5. Largest <img> on the page with a plausible product URL — filtered
 *      to reject logos, icons, favicons, sprites, and small dimensions
 *
 * REJECTS any URL that looks like a logo/icon/placeholder — the site's
 * own header logo is often what fills og:image on non-product pages,
 * so we filter aggressively.
 */
async function extractImage(page, pageUrl) {
  try {
    // 1. <link rel="preload" as="image"> — Next.js / modern SPAs preload hero
    const preload = await page.$eval(
      'link[rel="preload"][as="image"]',
      el => el.getAttribute('href') || el.getAttribute('imagesrcset')?.split(',')[0]?.trim().split(' ')[0]
    ).catch(() => null)
    if (preload && !isJunkImageUrl(preload)) return absoluteUrl(preload, pageUrl)

    // 2. JSON-LD Product.image (usually a real product photo URL)
    const jsonld = await page.$$eval(
      'script[type="application/ld+json"]',
      scripts => scripts.map(s => s.textContent).join('\n')
    ).catch(() => '')
    const ldMatch = jsonld.match(/"image"\s*:\s*"([^"]+)"/) ||
                    jsonld.match(/"image"\s*:\s*\[\s*"([^"]+)"/)
    if (ldMatch && !isJunkImageUrl(ldMatch[1])) return absoluteUrl(ldMatch[1], pageUrl)

    // 3. og:image — but skip if it's a logo/icon
    const og = await page.$eval(
      'meta[property="og:image:secure_url"], meta[property="og:image"], meta[name="og:image"]',
      el => el.getAttribute('content')
    ).catch(() => null)
    if (og && !isJunkImageUrl(og)) return absoluteUrl(og, pageUrl)

    // 4. twitter:image — same filter
    const tw = await page.$eval(
      'meta[name="twitter:image"], meta[property="twitter:image"]',
      el => el.getAttribute('content')
    ).catch(() => null)
    if (tw && !isJunkImageUrl(tw)) return absoluteUrl(tw, pageUrl)

    // 5. Largest <img> on the page with a plausible URL — reject icons
    const largest = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'))
      let best = null, bestSize = 0
      for (const img of imgs) {
        const w = img.naturalWidth || img.clientWidth || 0
        const h = img.naturalHeight || img.clientHeight || 0
        const size = w * h
        // Reject anything smaller than ~180×180 (typical logo/icon dimensions)
        if (size < 32000) continue
        const src = img.currentSrc || img.src
        if (!src) continue
        if (size > bestSize) { best = src; bestSize = size }
      }
      return best
    }).catch(() => null)
    if (largest && !isJunkImageUrl(largest)) return absoluteUrl(largest, pageUrl)

    return null
  } catch {
    return null
  }
}

function isJunkImageUrl(url) {
  if (!url) return true
  const u = url.toLowerCase()
  // Reject anything that clearly isn't a product photo
  const junkPatterns = [
    'logo', 'favicon', 'sprite', 'placeholder', 'default-',
    '/icons/', '/icon/', 'default.png', 'default.jpg',
    'banner', 'hero-banner', 'og-default', 'og_default',
    'data:image',   // inline base64 icons
  ]
  return junkPatterns.some(p => u.includes(p))
}

function absoluteUrl(maybeRelative, base) {
  try {
    return new URL(maybeRelative, base).href
  } catch {
    return maybeRelative
  }
}

/**
 * refreshOwnPrices — sweep all products with own_url set, scrape each,
 * update products.current_price. Called from tick.js after competitor scrapes.
 */
export async function refreshOwnPrices() {
  const { data: products } = await supabase
    .from('products')
    .select('id, name, own_url, current_price')
    .not('own_url', 'is', null)
    .eq('is_active', true)

  if (!products?.length) return

  console.log(`[own-prices] refreshing ${products.length} product(s) with own_url`)

  const browser = await chromium.launch({
    headless: true,
    proxy: process.env.HTTP_PROXY ? { server: process.env.HTTP_PROXY } : undefined,
  })

  let updated = 0, failed = 0
  for (const p of products) {
    let ctx = null
    try {
      ctx = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1440, height: 900 },
        locale: 'en-US',
      })
      const page = await ctx.newPage()
      await page.route('**/*', route => {
        const t = route.request().resourceType()
        if (t === 'image' || t === 'media' || t === 'font') return route.abort()
        return route.continue()
      })
      await page.goto(p.own_url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {})
      await page.waitForTimeout(1000)

      const { price } = await extractPrice(page, '')
      const image = await extractImage(page, p.own_url)
      await ctx.close(); ctx = null

      const patch = {}
      if (price != null && Number(price) !== Number(p.current_price)) patch.current_price = price
      if (image) patch.image_url = image
      if (Object.keys(patch).length > 0) {
        await supabase.from('products').update(patch).eq('id', p.id)
        console.log(`[own-prices] ✓ ${p.name}: ${JSON.stringify(patch)}`)
        updated++
      }
    } catch (e) {
      failed++
      if (ctx) await ctx.close().catch(() => {})
      console.log(`[own-prices] ✗ ${p.name}: ${e.message}`)
    }
  }
  await browser.close()
  console.log(`[own-prices] done — updated ${updated}, failed ${failed}`)
}
// scrape verification pass @ 2026-07-12T13:14:34Z
