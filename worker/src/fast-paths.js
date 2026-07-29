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
  if (!hit) return null

  // Eureka field map:
  //   clprc  — cash list price (what customers actually pay) — preferred
  //   lprc   — strike-through original price (fallback)
  //   avaqt  — available quantity (>0 = in stock)
  //   ipic   — product image filename in their CDN
  //   itmn   — product name (canonical)
  const price = typeof hit.clprc === 'number' && hit.clprc > 0
    ? hit.clprc
    : typeof hit.lprc === 'number' && hit.lprc > 0
      ? hit.lprc
      : null
  if (price == null) return null

  const inStock = typeof hit.avaqt === 'number' ? hit.avaqt > 0 : null
  const imageUrl = hit.ipic
    ? `https://cdnimage.eureka.com.kw/uploaded_images/products/${hit.ipic}`
    : null

  return {
    price,
    inStock,
    imageUrl,
    name: hit.itmn || null,
  }
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
  if (!product) return null

  const raw = product.price?.value
  const price = typeof raw === 'number' ? raw : parseFloat(raw)
  if (!isFinite(price) || price <= 0) return null   // discontinued / no price

  const status = String(product.status || '')
  const inStock = /instock/i.test(status) ? true
    : /(outofstock|out[_-]?of[_-]?stock|soldout|discontinued|unavailable)/i.test(status) ? false
      : null

  return { price, inStock, imageUrl: extractXciteImage(product.media), name: product.name || null }
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
]

export function getFastPath(url) {
  try {
    return FAST_PATHS.find(fp => fp.match(url)) || null
  } catch {
    return null
  }
}
