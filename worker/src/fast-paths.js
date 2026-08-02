/**
 * Fast-paths — per-competitor shortcuts that skip Playwright entirely
 * when the competitor exposes a public JSON API.
 *
 * Currently supported:
 *   Eureka (eureka.com.kw) — Algolia public search-only index
 *
 * How to add another site:
 *   1. Add a { match, fn } entry to FAST_PATHS below.
 *   2. `match(url)` returns truthy if this fast path applies.
 *   3. `fn(url)` returns `{ price, inStock, imageUrl, name } | null`.
 *
 * Fast paths are tried BEFORE Playwright. On success we short-circuit
 * the browser open entirely (250ms vs 25s). On any failure or null we
 * fall through to the normal Playwright pipeline — the fast path can
 * only make scraping better, never worse.
 */

// Shared realistic UA for the plain HTML/API fetches below.
const FETCH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Eureka's Algolia index is a PUBLIC search-only key — same one the site
// itself uses when you visit any product page. Not a secret. Discovered
// by reading the page HTML: <input id="srcapk" value="..."> holds the
// key and the app-id shows up in a value="5GPHMAA239" hidden input.
const EUREKA_ALGOLIA_APP_ID = '5GPHMAA239'
const EUREKA_ALGOLIA_KEY    = '3d7dbc330852592da244c87ae924a221'
const EUREKA_INDEX          = 'instant_records'

/**
 * Eureka URL pattern: https://www.eureka.com.kw/products/details/{id}?name=...
 * The numeric id maps directly to Algolia's objectID.
 */
async function fastScrapeEureka(url) {
  const idMatch = url.match(/\/products\/details\/(\d+)/i)
  if (!idMatch) return null
  const objectId = idMatch[1]

  const res = await fetch(
    `https://${EUREKA_ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/${EUREKA_INDEX}/query`,
    {
      method: 'POST',
      headers: {
        'X-Algolia-API-Key': EUREKA_ALGOLIA_KEY,
        'X-Algolia-Application-Id': EUREKA_ALGOLIA_APP_ID,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        params: `query=&filters=objectID%3A${objectId}&hitsPerPage=1`,
      }),
      signal: AbortSignal.timeout(10_000),
    }
  )
  if (!res.ok) return null
  const data = await res.json()
  const hit = data.hits?.[0]

  if (hit) {
    // Eureka field map:
    //   clprc  — cash list price (what customers pay) — preferred
    //   lprc   — strike-through original price (fallback)
    //   avaqt  — available quantity (>0 = in stock)
    //   ipic   — product image filename in their CDN
    //   itmn   — product name (canonical)
    const price = typeof hit.clprc === 'number' && hit.clprc > 0
      ? hit.clprc
      : typeof hit.lprc === 'number' && hit.lprc > 0
        ? hit.lprc
        : null
    const inStock = typeof hit.avaqt === 'number' ? hit.avaqt > 0 : null
    const imageUrl = hit.ipic
      ? `https://cdnimage.eureka.com.kw/uploaded_images/products/${hit.ipic}`
      : null
    if (price != null) return { price, inStock, imageUrl, name: hit.itmn || null }
    // In the index but no price → valid, treat as out of stock.
    return { price: null, inStock: inStock ?? false, exists: true, imageUrl, name: hit.itmn || null }
  }

  // No Algolia hit. The index only holds IN-STOCK items, so this may still be
  // a VALID out-of-stock product page (not a dead URL). Eureka SSRs the product
  // name into <title> for real products; removed/invalid ones get a "," title.
  try {
    const html = await (await fetch(url, {
      headers: { 'user-agent': FETCH_UA }, signal: AbortSignal.timeout(15_000),
    })).text()
    const title = (html.match(/<title>([^<]*)<\/title>/i)?.[1] || '').trim()
    if (title.replace(/[\s,]/g, '').length > 2) {
      return { price: null, inStock: false, exists: true, name: title.split(/[–|]/)[0].trim() || null }
    }
  } catch { /* fall through to invalid */ }
  return null   // truly invalid / removed
}

// ── Xcite (xcite.com) ─────────────────────────────────────────────
// Xcite runs Next.js and server-renders the FULL product record into the
// page's <script id="__NEXT_DATA__"> at props.pageProps.meta.product. So a
// single plain HTML fetch gives the authoritative price AND stock — no
// browser, no Algolia proxy (which is WAF-gated), no fragile DOM selector,
// and no risk of picking up a recommendation-carousel price.
//
//   meta.product.price  = { value, valueUnmodified, currency, formattedPrice }
//   meta.product.status = "InStock" | "OutOfStock" | "Discontinued" | ...
// Invalid/expired SKU URLs have no price and status "Discontinued" → we
// return null so the caller records not_found (never a wrong number).
const XCITE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function extractXciteImage(media) {
  try {
    const s = JSON.stringify(media ?? '')
    const m = s.match(/https?:\/\/[^"'\\]*amplience[^"'\\]*/i) ||
              s.match(/https?:\/\/[^"'\\]+\.(?:jpg|jpeg|png|webp)/i)
    return m ? m[0] : null
  } catch { return null }
}

async function fastScrapeXcite(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': XCITE_UA,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9,ar;q=0.8',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) return null
  const html = await res.text()
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  if (!m) return null

  let product
  try { product = JSON.parse(m[1])?.props?.pageProps?.meta?.product } catch { return null }
  if (!product) return null   // no product node → 404 / invalid URL

  const status = String(product.status || '')
  const inStock = /instock/i.test(status) ? true
    : /(outofstock|out[_-]?of[_-]?stock|soldout|discontinued|unavailable)/i.test(status) ? false
      : null
  const imageUrl = extractXciteImage(product.media)
  const name = product.name || null

  const raw = product.price?.value
  const price = typeof raw === 'number' ? raw : parseFloat(raw)
  if (isFinite(price) && price > 0) return { price, inStock, imageUrl, name }

  // meta.product present but no price. Xcite returns a PLACEHOLDER product even
  // for ghost/expired SKUs — with the numeric SKU as the "name". Only treat it
  // as a real discontinued/out-of-stock product when the name looks real (has
  // letters). A digits-only / empty name means the URL is invalid.
  if (name && /[a-z]/i.test(name)) {
    return { price: null, inStock: inStock ?? false, exists: true, imageUrl, name }
  }
  return null
}

// ── Best Al-Yousifi (best.com.kw) ─────────────────────────────────
// Runs SAP Commerce Cloud (Hybris) + Spartacus. Its public OCC REST API
// serves the full product (price, stock, image) with a plain no-auth GET —
// no browser. The product code is the URL segment after "/p/".
//   GET https://mrflex.best.com.kw/occ/v2/best/products/{code}?fields=FULL&lang=en&curr=KWD
//     price = { value, formattedValue, currencyIso }
//     stock = { stockLevel, stockLevelStatus: inStock | outOfStock | lowStock }
// Invalid codes return an UnknownIdentifierError → we return null.
const BEST_OCC = 'https://mrflex.best.com.kw/occ/v2/best/products'
const BEST_MEDIA_HOST = 'https://mrflex.best.com.kw'

function bestProductCode(url) {
  const after = url.split(/\/p\//i)[1]
  if (!after) return null
  const code = decodeURIComponent(after.split(/[?#]/)[0].replace(/\/+$/, ''))
  return code || null
}

async function occGet(path) {
  const res = await fetch(`${BEST_OCC.replace(/\/products$/, '')}/${path}`, {
    headers: { 'user-agent': FETCH_UA, accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) return null
  return res.json().catch(() => null)
}

async function fastScrapeBest(url) {
  const code = bestProductCode(url)
  if (!code) return null

  // 1. Direct product lookup by the URL's /p/{code}.
  let p = await occGet(`products/${encodeURIComponent(code)}?fields=FULL&lang=en&curr=KWD`)

  // 2. If not found, the URL code is often an alternate/manufacturer SKU rather
  //    than the OCC product code (e.g. /p/67680-T → real product MF210W100WB/T-GCC).
  //    Best indexes those for search, so resolve via search. Use the search hit
  //    directly (fields=FULL carries price + stock) — re-fetching by the real
  //    code fails when the code contains a "/".
  if (!p || p.errors) {
    const s = await occGet(`products/search?query=${encodeURIComponent(code)}&fields=FULL&pageSize=1&lang=en&curr=KWD`)
    p = s?.products?.[0] || null
  }
  if (!p || p.errors) return null   // genuinely not in catalogue → invalid

  const st = String(p.stock?.stockLevelStatus || '')
  const inStock = /instock|lowstock/i.test(st) ? true
    : /outofstock|out[_-]?of[_-]?stock/i.test(st) ? false
      : (typeof p.stock?.stockLevel === 'number' ? p.stock.stockLevel > 0 : null)

  let imageUrl = null
  const imgs = Array.isArray(p.images) ? p.images : []
  const img = imgs.find(i => i.imageType === 'PRIMARY' && i.format === 'product') ||
              imgs.find(i => i.imageType === 'PRIMARY') || imgs[0]
  if (img?.url) imageUrl = /^https?:\/\//.test(img.url) ? img.url : BEST_MEDIA_HOST + img.url

  const name = p.name || null
  const raw = p.price?.value
  const price = typeof raw === 'number' ? raw : parseFloat(raw)
  if (isFinite(price) && price > 0) return { price, inStock, imageUrl, name }

  // Product exists but no price → VALID, out of stock.
  return { price: null, inStock: inStock ?? false, exists: true, imageUrl, name }
}

// ── Generic auto-detect (any competitor, no hand-written fast-path) ─────────
// Reads a price from a plain fetch using the platform-agnostic signals that
// MOST e-commerce sites expose, in order of reliability:
//   1. JSON-LD  (<script type=application/ld+json> Product/offers) — the
//      schema.org standard Google needs for rich results, so it's everywhere.
//   2. Shopify  (append .json to /products/{handle}) — works on every Shopify.
//   3. Meta tags (og:price:amount / product:price:amount / itemprop=price).
// Returns { notFound:true } on a hard 404 (record not_found, no browser),
// null when the page loads but nothing was detected (→ browser fallback), and
// the usual { price | exists } shapes on success. This makes onboarding a new
// competitor mostly automatic — the browser is only for the rare holdout.

function jsonLdProductNodes(data, out = []) {
  if (!data || typeof data !== 'object') return out
  if (Array.isArray(data)) { for (const d of data) jsonLdProductNodes(d, out); return out }
  const t = data['@type']
  const isProduct = t === 'Product' || (Array.isArray(t) && t.includes('Product')) ||
    (typeof t === 'string' && /product/i.test(t))
  if (isProduct) out.push(data)
  if (data['@graph']) jsonLdProductNodes(data['@graph'], out)
  return out
}

function fromJsonLd(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(html))) {
    let data
    try { data = JSON.parse(m[1].trim()) } catch { continue }
    const prod = jsonLdProductNodes(data).find(p => p.offers) || jsonLdProductNodes(data)[0]
    if (!prod) continue
    const offer = Array.isArray(prod.offers) ? prod.offers[0] : prod.offers
    const rawPrice = offer?.price ?? offer?.lowPrice ?? offer?.priceSpecification?.price
    const price = parseFloat(String(rawPrice ?? '').replace(/,/g, ''))
    const name = typeof prod.name === 'string' ? prod.name : null
    const image = typeof prod.image === 'string' ? prod.image
      : Array.isArray(prod.image) ? prod.image[0]
        : prod.image?.url || null
    const avail = String(offer?.availability || '').toLowerCase()
    const inStock = /instock|limitedavailability|onlineonly|presale/.test(avail) ? true
      : /outofstock|soldout|discontinued/.test(avail) ? false : null
    if (isFinite(price) && price > 0) return { price, inStock, imageUrl: image, name }
    if (offer) return { price: null, inStock: inStock ?? false, exists: true, imageUrl: image, name }
  }
  return null
}

async function fromShopify(url, html) {
  if (!/cdn\.shopify\.com|myshopify\.com|Shopify\.theme|"Shopify"/i.test(html)) return null
  let u; try { u = new URL(url) } catch { return null }
  const path = u.pathname.match(/\/products\/[^/?#]+/i)
  if (!path) return null
  try {
    const r = await fetch(`${u.origin}${path[0]}.json`, {
      headers: { 'user-agent': FETCH_UA, accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    })
    if (!r.ok) return null
    const prod = (await r.json())?.product
    if (!prod) return null
    const variant = (prod.variants || []).find(v => v.available) || prod.variants?.[0]
    const price = parseFloat(String(variant?.price ?? '').replace(/,/g, ''))
    const inStock = (prod.variants || []).some(v => v.available)
    const image = prod.image?.src || prod.images?.[0]?.src || null
    const name = prod.title || null
    if (isFinite(price) && price > 0) return { price, inStock, imageUrl: image, name }
    return { price: null, inStock, exists: true, imageUrl: image, name }
  } catch { return null }
}

function fromMeta(html) {
  const attr = (re) => (html.match(re) || [])[1] || null
  const raw =
    attr(/<meta[^>]+(?:property|name)=["'](?:og:price:amount|product:price:amount)["'][^>]+content=["']([\d.,]+)["']/i) ||
    attr(/<meta[^>]+content=["']([\d.,]+)["'][^>]+(?:property|name)=["'](?:og:price:amount|product:price:amount)["']/i) ||
    attr(/itemprop=["']price["'][^>]+content=["']([\d.,]+)["']/i) ||
    attr(/content=["']([\d.,]+)["'][^>]+itemprop=["']price["']/i)
  if (!raw) return null
  const price = parseFloat(raw.replace(/,/g, ''))
  if (!isFinite(price) || price <= 0) return null
  const name = attr(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
  const image = attr(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
  const avail = attr(/(?:property|name)=["'](?:og:availability|product:availability)["'][^>]+content=["']([^"']+)["']/i)
  const inStock = avail ? (/instock|in stock/i.test(avail) ? true : /outofstock|out of stock|sold ?out/i.test(avail) ? false : null) : null
  return { price, inStock, imageUrl: image, name }
}

async function fastScrapeGeneric(url) {
  let res
  try {
    res = await fetch(url, {
      headers: {
        'user-agent': FETCH_UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9,ar;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
  } catch { return null }   // network error → let the browser try
  if (res.status === 404 || res.status === 410) return { notFound: true }
  if (!res.ok) return null  // 403 / 5xx (bot-blocked) → browser + proxy might get it
  const html = await res.text()

  const shop = await fromShopify(url, html); if (shop) return { ...shop, via: 'shopify' }
  const ld = fromJsonLd(html);              if (ld)   return { ...ld,   via: 'json-ld' }
  const meta = fromMeta(html);              if (meta) return { ...meta, via: 'meta' }
  return null
}

const FAST_PATHS = [
  {
    name: 'eureka-algolia',
    match: (url) => /(?:^|\.)eureka\.com\.kw/i.test(new URL(url).hostname),
    fn: fastScrapeEureka,
  },
  {
    name: 'xcite-nextdata',
    match: (url) => /(?:^|\.)xcite\.com$/i.test(new URL(url).hostname),
    fn: fastScrapeXcite,
  },
  {
    name: 'best-occ',
    match: (url) => /(?:^|\.)best\.com\.kw$/i.test(new URL(url).hostname),
    fn: fastScrapeBest,
  },
  // Lowest priority: matches ANY url the specific paths above didn't claim.
  // isGeneric → a null result falls through to the browser instead of being
  // treated as an authoritative "not found".
  {
    name: 'generic-auto',
    match: () => true,
    fn: fastScrapeGeneric,
    isGeneric: true,
  },
]

export function getFastPath(url) {
  try {
    return FAST_PATHS.find(fp => fp.match(url)) || null
  } catch {
    return null
  }
}

/**
 * probeUrl — test whether a competitor URL can be scraped browser-free, and by
 * which method. Used by the "Test compatibility" button when adding a
 * competitor. Returns a small report:
 *   { ok, method, price, inStock, outOfStock, invalid, needsBrowser, name, error }
 */
export async function probeUrl(url) {
  let host
  try { host = new URL(url).hostname.replace(/^www\./, '') } catch { return { ok: false, reason: 'bad-url' } }
  const fp = getFastPath(url)   // generic-auto always matches, so fp is set
  try {
    const r = await fp.fn(url)
    const method = r?.via ? `api:${r.via}` : `api:${fp.name}`
    if (r?.notFound) return { ok: false, invalid: true, method: fp.name, needsBrowser: false, host }
    if (r?.price != null) return { ok: true, method, price: r.price, inStock: r.inStock, name: r.name || null, needsBrowser: false, host }
    if (r?.exists) return { ok: true, method, price: null, outOfStock: true, inStock: r.inStock, name: r.name || null, needsBrowser: false, host }
    // null result:
    if (fp.isGeneric) return { ok: false, needsBrowser: true, method: 'browser', host }
    return { ok: false, invalid: true, method: fp.name, needsBrowser: false, host }
  } catch (e) {
    return { ok: false, error: e.message, needsBrowser: !!fp.isGeneric, host }
  }
}
