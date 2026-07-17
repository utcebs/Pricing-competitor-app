/**
 * Route-to-import map. Used by both App.jsx (for React.lazy) and
 * Layout.jsx (for hover-prefetch). Sharing the same import function
 * means the browser downloads the chunk once and Vite dedupes on
 * subsequent lazy() calls.
 */
export const PAGE_IMPORTS = {
  '/':                    () => import('../pages/Dashboard'),
  '/products':            () => import('../pages/Products'),
  '/competitors':         () => import('../pages/Competitors'),
  '/competitor-products': () => import('../pages/CompetitorProducts'),
  '/prices':              () => import('../pages/PriceTrends'),
  '/prices/new':          () => import('../pages/PriceEntry'),
  '/comparison':          () => import('../pages/Comparison'),
  '/scrapers':            () => import('../pages/Scrapers'),
  '/matches':             () => import('../pages/MatchReview'),
  '/alerts':              () => import('../pages/Alerts'),
  '/reports':             () => import('../pages/Reports'),
  '/repricing':           () => import('../pages/Repricing'),
  '/integrations':        () => import('../pages/Integrations'),
  '/categories':          () => import('../pages/Categories'),
  '/users':               () => import('../pages/Users'),
}

/** Fire the import for a route. Idempotent — subsequent calls are no-ops. */
export function prefetchRoute(path) {
  const fn = PAGE_IMPORTS[path]
  if (fn) fn().catch(() => { /* silently ignore prefetch failures */ })
}
