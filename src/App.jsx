import { lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import ErrorBoundary from './components/ErrorBoundary'
import { PAGE_IMPORTS } from './lib/routes'

/**
 * lazyWithRetry — resilient lazy() for a hash-based deploy pipeline.
 *
 * After a new build ships, an already-open tab still holds the OLD index.html,
 * so navigating to a not-yet-loaded route tries to fetch a chunk filename that
 * no longer exists → the dynamic import throws and the page "won't load".
 * Here we reload ONCE to pull the fresh index.html + chunks (guarded by a
 * session flag so a genuinely-broken chunk can't loop forever). On success we
 * clear the flag so the next deploy can recover the same way.
 */
function lazyWithRetry(importFn) {
  return lazy(async () => {
    try {
      const mod = await importFn()
      sessionStorage.removeItem('chunk-reloaded')
      return mod
    } catch (err) {
      if (!sessionStorage.getItem('chunk-reloaded')) {
        sessionStorage.setItem('chunk-reloaded', '1')
        window.location.reload()
        return new Promise(() => {})   // hang this render until the reload happens
      }
      throw err   // already retried — let the ErrorBoundary show it
    }
  })
}

// Lazy-loaded pages — cuts the initial bundle by ~60%.
// Sharing PAGE_IMPORTS with Layout so hover-prefetch and click-lazy
// use the SAME import function → Vite dedupes to one chunk.
const Dashboard          = lazyWithRetry(PAGE_IMPORTS['/'])
const Products           = lazyWithRetry(PAGE_IMPORTS['/products'])
const Competitors        = lazyWithRetry(PAGE_IMPORTS['/competitors'])
const CompetitorProducts = lazyWithRetry(PAGE_IMPORTS['/competitor-products'])
const PriceEntry         = lazyWithRetry(PAGE_IMPORTS['/prices/new'])
const PriceTrends        = lazyWithRetry(PAGE_IMPORTS['/prices'])
const Comparison         = lazyWithRetry(PAGE_IMPORTS['/comparison'])
const BusinessInsights   = lazyWithRetry(PAGE_IMPORTS['/business-insights'])
const Categories         = lazyWithRetry(PAGE_IMPORTS['/categories'])
const Users              = lazyWithRetry(PAGE_IMPORTS['/users'])
const Scrapers           = lazyWithRetry(PAGE_IMPORTS['/scrapers'])
const MatchReview        = lazyWithRetry(PAGE_IMPORTS['/matches'])
const Alerts             = lazyWithRetry(PAGE_IMPORTS['/alerts'])
const Reports            = lazyWithRetry(PAGE_IMPORTS['/reports'])
const Repricing          = lazyWithRetry(PAGE_IMPORTS['/repricing'])
const RepriceChecklist   = lazyWithRetry(PAGE_IMPORTS['/reprice'])
const Integrations       = lazyWithRetry(PAGE_IMPORTS['/integrations'])

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/"                    element={<Dashboard />} />
            <Route path="/products"            element={<Products />} />
            <Route path="/competitors"         element={<Competitors />} />
            <Route path="/competitor-products" element={<CompetitorProducts />} />
            <Route path="/prices"              element={<PriceTrends />} />
            <Route path="/prices/new"          element={<PriceEntry />} />
            <Route path="/comparison"          element={<Comparison />} />
            <Route path="/business-insights"   element={<BusinessInsights />} />
            <Route path="/reprice"             element={<RepriceChecklist />} />
            <Route path="/scrapers"            element={<Scrapers />} />
            <Route path="/matches"             element={<MatchReview />} />
            <Route path="/alerts"              element={<Alerts />} />
            <Route path="/reports"             element={<Reports />} />
            <Route path="/repricing"           element={<Repricing />} />
            <Route path="/integrations"        element={<Integrations />} />
            <Route path="/categories"          element={<Categories />} />
            <Route path="/users"               element={<Users />} />
          </Route>
        </Routes>
      </AuthProvider>
    </ErrorBoundary>
  )
}
