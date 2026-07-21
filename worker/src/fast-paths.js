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

const FAST_PATHS = [
  {
    name: 'eureka-algolia',
    match: (url) => /(?:^|\.)eureka\.com\.kw/i.test(new URL(url).hostname),
    fn: fastScrapeEureka,
  },
]

export function getFastPath(url) {
  try {
    return FAST_PATHS.find(fp => fp.match(url)) || null
  } catch {
    return null
  }
}
