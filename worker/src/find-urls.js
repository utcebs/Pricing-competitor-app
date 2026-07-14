// Auto-URL finder — Playwright search + DDG fallback
import { chromium } from 'playwright'
import { supabase } from './supabase.js'

/**
 * runFindUrlsJob — process one url_find_jobs row end-to-end.
 *
 * Strategy per competitor:
 *   1. If competitor.scrape_config.searchUrlTemplate exists, use it —
 *      "https://xcite.com/search?q={q}" style. Extracts first result URL
 *      via config.searchResultSelector (default 'a[href*="/p"]' etc.)
 *   2. Otherwise fall back to DuckDuckGo `site:` search — works on any site
 *      without configuration. Takes the first result matching the
 *      competitor's domain.
 *
 * For every found URL, insert into competitor_products with
 * match_method='auto' and match_confidence — flagged in the UI so users
 * can review before trusting. Skips creation if a row already exists
 * for that (competitor_id, product_id).
 */

const DEFAULT_RESULT_SELECTORS = [
  // Common product-page link patterns across e-commerce
  'a[href*="/p/"]',
  'a[href*="/product/"]',
  'a[href*="/products/"]',
  'a[href*="/dp/"]',
  '.product-item a',
  '.product-card a',
  '.product-tile a',
  '[data-testid*="product"] a',
]

// DuckDuckGo HTML-only endpoint uses `.result__a` for every result link,
// wrapping the real URL in `//duckduckgo.com/l/?uddg=<encoded>`.
const DDG_RESULT_SELECTOR = 'a.result__a, a[data-testid="result-title-a"]'

export async function runFindUrlsJob(job) {
  console.log(`[find-urls] starting job ${job.id} for product ${job.product_id}`)

  await supabase.from('url_find_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', job.id)

  const { data: product } = await supabase
    .from('products').select('*').eq('id', job.product_id).single()
  if (!product) {
    await markFailed(job.id, 'Product not found')
    return
  }

  let competitorQuery = supabase.from('competitors').select('*').eq('is_active', true)
  if (job.competitor_id) competitorQuery = competitorQuery.eq('id', job.competitor_id)
  const { data: competitors } = await competitorQuery

  if (!competitors || competitors.length === 0) {
    await markFailed(job.id, 'No competitors to search')
    return
  }

  const browser = await chromium.launch({
    headless: true,
    proxy: process.env.HTTP_PROXY ? { server: process.env.HTTP_PROXY } : undefined,
  })

  const results = []

  for (const comp of competitors) {
    console.log(`[find-urls] searching ${comp.name} for "${product.name}"`)
    let ctx = null
    try {
      // Skip if a URL already exists for this (competitor, product)
      const { data: existing } = await supabase
        .from('competitor_products')
        .select('id')
        .eq('competitor_id', comp.id)
        .eq('product_id', product.id)
        .maybeSingle()
      if (existing) {
        results.push({ competitor_id: comp.id, competitor_name: comp.name, status: 'skipped', reason: 'link already exists' })
        continue
      }

      ctx = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1440, height: 900 },
        locale: 'en-US',
      })
      const page = await ctx.newPage()

      // Block images/media for speed
      await page.route('**/*', route => {
        const t = route.request().resourceType()
        if (t === 'image' || t === 'media' || t === 'font') return route.abort()
        return route.continue()
      })

      const config = comp.scrape_config || {}
      let foundUrl = null
      let searchStrategy = null

      // Strategy A: competitor's own search
      if (config.searchUrlTemplate) {
        try {
          const searchUrl = config.searchUrlTemplate.replace(/\{q\}/g, encodeURIComponent(product.name))
          console.log(`[find-urls]   trying own-search: ${searchUrl}`)
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
          await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
          foundUrl = await extractFirstProductUrl(page, config.searchResultSelector, comp.domain)
          if (foundUrl) searchStrategy = 'own-search'
        } catch (e) {
          console.log(`[find-urls]   own-search failed: ${e.message}`)
        }
      }

      // Strategy B: DuckDuckGo `site:` search
      if (!foundUrl) {
        try {
          const q = encodeURIComponent(`site:${cleanDomain(comp.domain)} ${product.name}`)
          const ddgUrl = `https://html.duckduckgo.com/html/?q=${q}`
          console.log(`[find-urls]   trying DDG: ${ddgUrl}`)
          await page.goto(ddgUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
          foundUrl = await extractDDGResult(page, comp.domain)
          if (foundUrl) searchStrategy = 'duckduckgo'
        } catch (e) {
          console.log(`[find-urls]   DDG failed: ${e.message}`)
        }
      }

      await ctx.close(); ctx = null

      if (foundUrl) {
        // Fetch page title as the competitor_products.name
        const title = await fetchPageTitle(browser, foundUrl)
        const { error: insertErr } = await supabase.from('competitor_products').insert({
          competitor_id: comp.id,
          product_id: product.id,
          name: title || product.name,
          url: foundUrl,
          match_method: 'auto',
          match_confidence: 0.6,   // heuristic — user should review
          is_active: true,
        })
        if (insertErr) {
          results.push({ competitor_id: comp.id, competitor_name: comp.name, status: 'error', error: insertErr.message })
        } else {
          results.push({ competitor_id: comp.id, competitor_name: comp.name, status: 'found', url: foundUrl, title, strategy: searchStrategy })
          console.log(`[find-urls]   ✓ ${comp.name}: ${foundUrl}`)
        }
      } else {
        results.push({ competitor_id: comp.id, competitor_name: comp.name, status: 'not_found' })
        console.log(`[find-urls]   ✗ ${comp.name}: nothing found`)
      }
    } catch (e) {
      if (ctx) await ctx.close().catch(() => {})
      results.push({ competitor_id: comp.id, competitor_name: comp.name, status: 'error', error: e.message })
    }
  }

  await browser.close()

  const foundCount = results.filter(r => r.status === 'found').length
  await supabase.from('url_find_jobs').update({
    status: 'completed',
    finished_at: new Date().toISOString(),
    urls_found: foundCount,
    results,
  }).eq('id', job.id)

  // If we found any URLs, immediately queue scrapes for those competitors
  const compsToScrape = [...new Set(results.filter(r => r.status === 'found').map(r => r.competitor_id))]
  if (compsToScrape.length > 0) {
    await supabase.from('scrape_runs').insert(
      compsToScrape.map(cid => ({
        competitor_id: cid,
        status: 'queued',
        triggered_by: job.triggered_by,
        triggered_kind: 'api',
      }))
    )
    console.log(`[find-urls] queued ${compsToScrape.length} scrape(s) for the newly-found URLs`)
  }

  console.log(`[find-urls] job ${job.id} done — ${foundCount}/${competitors.length} found`)
}

async function markFailed(id, msg) {
  await supabase.from('url_find_jobs')
    .update({ status: 'failed', finished_at: new Date().toISOString(), error_summary: msg })
    .eq('id', id)
}

function cleanDomain(domain) {
  return String(domain || '').replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '')
}

async function extractFirstProductUrl(page, customSelector, domain) {
  const selectors = customSelector ? [customSelector, ...DEFAULT_RESULT_SELECTORS] : DEFAULT_RESULT_SELECTORS
  const clean = cleanDomain(domain)
  for (const sel of selectors) {
    const href = await page.$eval(sel, el => el.href).catch(() => null)
    if (href && looksLikeProductUrl(href, clean)) return href
  }
  // Try any anchor whose href includes the competitor's domain and looks product-y
  const allHrefs = await page.$$eval('a', anchors => anchors.map(a => a.href)).catch(() => [])
  for (const href of allHrefs) {
    if (looksLikeProductUrl(href, clean)) return href
  }
  return null
}

async function extractDDGResult(page, domain) {
  const clean = cleanDomain(domain)
  const results = await page.$$eval(DDG_RESULT_SELECTOR, els => els.map(a => a.href)).catch(() => [])
  for (const href of results) {
    // DDG wraps result URLs; extract real one
    const real = decodeURIComponent(href.match(/uddg=([^&]+)/)?.[1] || href)
    if (real.includes(clean) && looksLikeProductUrl(real, clean)) return real
    if (real.includes(clean)) return real   // fallback: any link to the domain
  }
  return null
}

function looksLikeProductUrl(url, domain) {
  if (!url.includes(domain)) return false
  // Reject category, brand, search-result, homepage
  const lower = url.toLowerCase()
  if (lower.endsWith('/') && lower.split('/').length <= 5) return false
  if (lower.match(/\/(category|c|catalog|brand|search|cart|checkout|account|login)(\/|\?|$)/)) return false
  // Prefer URLs with product-page markers
  return lower.includes('/p/') || lower.includes('/product/') || lower.includes('/products/') ||
         lower.includes('/dp/') || lower.endsWith('/p') || lower.match(/\/[a-z0-9-]{8,}(\?|\/|$)/)
}

async function fetchPageTitle(browser, url) {
  let ctx = null
  try {
    ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (compatible; PriceCompetitorBot/0.2)',
    })
    const p = await ctx.newPage()
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    const title = await p.title()
    await ctx.close()
    return title?.slice(0, 200) || null
  } catch {
    if (ctx) await ctx.close().catch(() => {})
    return null
  }
}
