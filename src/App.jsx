import { lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import Layout from './components/Layout'
import Login from './pages/Login'

// Lazy-loaded pages — cuts the initial bundle by ~60%.
// Recharts + xlsx + jspdf ship only when their route mounts.
// Suspense boundary lives INSIDE Layout so the sidebar stays put
// while a page chunk loads (no full-screen white flash).
const Dashboard          = lazy(() => import('./pages/Dashboard'))
const Products           = lazy(() => import('./pages/Products'))
const Competitors        = lazy(() => import('./pages/Competitors'))
const CompetitorProducts = lazy(() => import('./pages/CompetitorProducts'))
const PriceEntry         = lazy(() => import('./pages/PriceEntry'))
const PriceTrends        = lazy(() => import('./pages/PriceTrends'))
const Comparison         = lazy(() => import('./pages/Comparison'))
const Categories         = lazy(() => import('./pages/Categories'))
const Users              = lazy(() => import('./pages/Users'))
const Scrapers           = lazy(() => import('./pages/Scrapers'))
const MatchReview        = lazy(() => import('./pages/MatchReview'))
const Alerts             = lazy(() => import('./pages/Alerts'))
const Reports            = lazy(() => import('./pages/Reports'))
const Repricing          = lazy(() => import('./pages/Repricing'))
const Integrations       = lazy(() => import('./pages/Integrations'))

export default function App() {
  return (
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
  )
}
