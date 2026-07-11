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
import Scrapers from './pages/Scrapers'
import MatchReview from './pages/MatchReview'
import Alerts from './pages/Alerts'
import Reports from './pages/Reports'
import Repricing from './pages/Repricing'
import Integrations from './pages/Integrations'

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
