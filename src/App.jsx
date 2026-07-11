import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import Products from './pages/Products'
import Competitors from './pages/Competitors'
import CompetitorProducts from './pages/CompetitorProducts'
import PriceEntry from './pages/PriceEntry'
import PriceTrends from './pages/PriceTrends'
import Categories from './pages/Categories'
import Users from './pages/Users'
import Placeholder from './pages/Placeholder'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Layout />}>
          {/* Phase 1 pages */}
          <Route path="/"                    element={<Dashboard />} />
          <Route path="/products"            element={<Products />} />
          <Route path="/competitors"         element={<Competitors />} />
          <Route path="/competitor-products" element={<CompetitorProducts />} />
          <Route path="/prices"              element={<PriceTrends />} />
          <Route path="/prices/new"          element={<PriceEntry />} />
          <Route path="/categories"          element={<Categories />} />
          <Route path="/users"               element={<Users />} />

          {/* Coming later — Phase 3+ */}
          <Route path="/alerts" element={
            <Placeholder title="Alerts" phase="3"
              description="Rules for instant emails + daily digests on price / stock changes." />
          } />
          <Route path="/reports" element={
            <Placeholder title="Reports" phase="4"
              description="Custom dashboards + saved reports. Export to Excel / CSV / PDF." />
          } />
          <Route path="/settings" element={
            <Placeholder title="Settings" phase="1+"
              description="Currencies, integrations (Dynamics 365, Shopify, WooCommerce, BigCommerce, Magento, Google Analytics)." />
          } />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
