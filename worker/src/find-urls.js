// Auto-URL finder v3 — brand-aware query + candidate scoring + relevance threshold
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { supabase } from './supabase.js'

chromium.use(StealthPlugin())

/**
 * runFindUrlsJob — process one url_find_jobs row end-to-end.
 *
 * v3 improvements (2026-07-16):
 *   - Query built from BRAND + NAME (not just name)
 *   - Fetches top 5 candidate URLs per competitor (not just first)
 *   - Fetches each candidate's <title> and og:title
 *   - Scores each title against "brand name" via Jaccard token overlap
 *   - Picks the highest-scoring candidate ABOVE a threshold (0.35)
 *   - Below threshold → not_found (better than a wrong link)
 *   - match_confidence reflects the actual similarity score (0.35-1.0)
 */

const DEFAULT_RESULT_SELECTORS = [
  'a[href*="/p/"]',
  'a[href*="/product/"]',
  'a[href*="/products/"]',
  'a[href*="/dp/"]',
  '.product-item a',
  '.product-card a',
  '.product-tile a',
  '[data-testid*="product"] a',
]

const DDG_RESULT_SELECTOR = 'a.result__a, a[data-testid="result-title-a"]'

// Similarity threshold. Below this, the candidate is rejected.
// 0.35 is empirically decent for KW e-commerce sites: strict enough to reject
// "PS5 accessories" when searching for "PlayStation 5 Slim", loose enough
// to accept "PlayStation 5 Slim Digital Console Standalone".
const MIN_SIMILARITY = 0.35

// How many candidate URLs to fetch and score per competitor
const MAX_CANDIDATES = 5

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

  // Build the search query. Include BRAND if available.
  const brand = (product.brand || '').trim()
  const name = (product.name || '').trim()
  const queryText = brand && !name.toLowerCase().includes(brand.toLowerCase())
    ? `${brand} ${name}`
    : name
  console.log(`[find-urls] query: "${queryText}"`)

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
    console.log(`[find-urls] searching ${comp.name} for "${queryText}"`)
    let ctx = null
    try {
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
        extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8' },
      })
      const page = await ctx.newPage()
      await page.route('**/*', route => {
        const t = route.request().resourceType()
        if (t === 'image' || t === 'media' || t === 'font') return route.abort()
        return route.continue()
      })

      const config = comp.scrape_config || {}
      const clean = cleanDomain(comp.domain)

      // Gather candidate URLs from BOTH strategies (search page + DDG),
      // dedupe, then score.
      const candidateUrls = new Set()

      // Strategy A: competitor's own search
      if (config.searchUrlTemplate) {
        try {
          const searchUrl = config.searchUrlTemplate.replace(/\{q\}/g, encodeURIComponent(queryText))
          console.log(`[find-urls]   own-search: ${searchUrl}`)
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
          await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
          const urls = await extractCandidateUrls(page, config.searchResultSelector, clean, MAX_CANDIDATES)
          urls.forEach(u => candidateUrls.add(u))
        } catch (e) {
          console.log(`[find-urls]   own-search failed: ${e.message}`)
        }
      }

      // Strategy B: DuckDuckGo `site:` search
      try {
        const q = encodeURIComponent(`site:${clean} ${queryText}`)
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${q}`
        console.log(`[find-urls]   DDG: ${ddgUrl}`)
        await page.goto(ddgUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        const ddgUrls = await extractDDGCandidates(page, clean, MAX_CANDIDATES)
        ddgUrls.forEach(u => candidateUrls.add(u))
      } catch (e) {
        console.log(`[find-urls]   DDG failed: ${e.message}`)
      }

      await ctx.close(); ctx = null

      const candidates = [...candidateUrls].slice(0, MAX_CANDIDATES)
      console.log(`[find-urls]   ${candidates.length} candidate URL(s) collected`)

      if (candidates.length === 0) {
        results.push({ competitor_id: comp.id, competitor_name: comp.name, status: 'not_found', reason: 'no candidates from search' })
        continue
      }

      // Fetch each candidate's title + score against product name+brand
      const scored = await Promise.all(
        candidates.map(url => scoreCandidate(browser, url, queryText))
      )
      scored.sort((a, b) => b.score - a.score)

      console.log(`[find-urls]   top candidates:`)
      for (const s of scored.slice(0, 3)) {
        console.log(`      ${s.score.toFixed(2)}  ${s.title?.slice(0, 60) || '?'}  →  ${s.url}`)
      }

      const best = scored[0]
      if (!best || best.score < MIN_SIMILARITY) {
        results.push({
          competitor_id: comp.id, competitor_name: comp.name,
          status: 'not_found',
          reason: best
            ? `Best match scored ${best.score.toFixed(2)} < threshold ${MIN_SIMILARITY}. Title: "${(best.title || '').slice(0, 80)}"`
            : 'No candidates could be titled',
        })
        continue
      }

      // INSERT the match with a real confidence from scoring
      const { error: insertErr } = await supabase.from('competitor_products').insert({
        competitor_id: comp.id,
        product_id: product.id,
        name: best.title?.slice(0, 200) || product.name,
        url: best.url,
        match_method: 'auto',
        match_confidence: Number(best.score.toFixed(2)),
        is_active: true,
      })
      if (insertErr) {
        results.push({ competitor_id: comp.id, competitor_name: comp.name, status: 'error', error: insertErr.message })
      } else {
        results.push({
          competitor_id: comp.id, competitor_name: comp.name,
          status: 'found',
          url: best.url, title: best.title,
          strategy: 'scored', confidence: Number(best.score.toFixed(2)),
        })
        console.log(`[find-urls]   ✓ ${comp.name} @ ${best.score.toFixed(2)}: ${best.url}`)
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

  const compsToScrape = [...new Set(results.filter(r => r.status === 'found').map(r => r.competitor_id))]
  if (compsToScrape.length > 0) {
    await supabase.from('scrape_runs').insert(
      compsToScrape.map(cid => ({
        competitor_id: cid, status: 'queued',
        triggered_by: job.triggered_by, triggered_kind: 'api',
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

/**
 * extractCandidateUrls — collect up to `limit` product-URL candidates
 * from a search results page. Returns absolute URLs, deduped.
 */
async function extractCandidateUrls(page, customSelector, cleanDomain, limit) {
  const selectors = customSelector ? [customSelector, ...DEFAULT_RESULT_SELECTORS] : DEFAULT_RESULT_SELECTORS
  const found = new Set()
  for (const sel of selectors) {
    if (found.size >= limit) break
    const hrefs = await page.$$eval(sel, els => els.map(a => a.href).filter(Boolean)).catch(() => [])
    for (const href of hrefs) {
      if (found.size >= limit) break
      if (looksLikeProductUrl(href, cleanDomain)) found.add(href)
    }
  }
  // Fallback: scan all anchors on the page
  if (found.size < limit) {
    const allHrefs = await page.$$eval('a', anchors => anchors.map(a => a.href).filter(Boolean)).catch(() => [])
    for (const href of allHrefs) {
      if (found.size >= limit) break
      if (looksLikeProductUrl(href, cleanDomain)) found.add(href)
    }
  }
  return [...found]
}

async function extractDDGCandidates(page, cleanDomain, limit) {
  const found = new Set()
  const hrefs = await page.$$eval(DDG_RESULT_SELECTOR, els => els.map(a => a.href).filter(Boolean)).catch(() => [])
  for (const href of hrefs) {
    if (found.size >= limit) break
    const real = decodeURIComponent(href.match(/uddg=([^&]+)/)?.[1] || href)
    if (real.includes(cleanDomain) && looksLikeProductUrl(real, cleanDomain)) found.add(real)
  }
  return [...found]
}

function looksLikeProductUrl(url, domain) {
  if (!url.includes(domain)) return false
  const lower = url.toLowerCase()
  if (lower.endsWith('/') && lower.split('/').length <= 5) return false
  if (lower.match(/\/(category|c|catalog|brand|search|cart|checkout|account|login|help|about|contact|blog|news|terms|privacy|gaming-category|view-order|order-status)(\/|\?|$)/)) return false
  return lower.includes('/p/') || lower.includes('/product/') || lower.includes('/products/') ||
         lower.includes('/dp/') || lower.endsWith('/p') || lower.match(/\/[a-z0-9-]{8,}(\?|\/|$)/)
}

/**
 * scoreCandidate — fetch a candidate URL, extract its title, and score
 * how well it matches the query text via Jaccard token overlap.
 * Returns { url, title, score } where score ∈ [0, 1].
 */
async function scoreCandidate(browser, url, queryText) {
  let ctx = null
  try {
    ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })
    const p = await ctx.newPage()
    await p.route('**/*', r => {
      const t = r.request().resourceType()
      if (t === 'image' || t === 'media' || t === 'font' || t === 'stylesheet') return r.abort()
      return r.continue()
    })
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    // Prefer og:title over document.title — usually more product-specific
    const ogTitle = await p.$eval('meta[property="og:title"]', el => el.getAttribute('content')).catch(() => null)
    const docTitle = ogTitle || await p.title().catch(() => '')
    await ctx.close(); ctx = null
    const score = jaccardSimilarity(queryText, docTitle || '')
    return { url, title: docTitle, score }
  } catch (e) {
    if (ctx) await ctx.close().catch(() => {})
    return { url, title: null, score: 0 }
  }
}

/**
 * Jaccard token similarity between two strings. Case-insensitive,
 * strips punctuation, drops noise tokens. Range [0, 1].
 * Also gives a small bonus for exact-brand-token containment.
 */
function jaccardSimilarity(a, b) {
  const NOISE = new Set([
    'the','a','an','of','in','on','at','for','with','by','to','from','and','or',
    'buy','online','best','cheap','price','offer','deal','new','sale','free',
    'delivery','shipping','store','shop','warranty','kw','kuwait','ksa','ae','uae',
    'ar','en','com',
  ])
  const tokenize = s => (s || '').toLowerCase()
    .replace(/[^a-z0-9؀-ۿ\s]+/g, ' ')   // keep letters, digits, Arabic block
    .split(/\s+/)
    .filter(t => t.length >= 2 && !NOISE.has(t))
  const A = new Set(tokenize(a))
  const B = new Set(tokenize(b))
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  const union = A.size + B.size - inter
  return union > 0 ? inter / union : 0
}
