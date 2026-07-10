import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import Placeholder from './pages/Placeholder'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/products" element={
            <Placeholder title="My Products" phase="1"
              description="Your catalogue — SKUs, categories, cost, min price." />
          } />
          <Route path="/competitors" element={
            <Placeholder title="Competitors" phase="1"
              description="Sites you're tracking + linked products on each." />
          } />
          <Route path="/prices" element={
            <Placeholder title="Price Trends" phase="1"
              description="Per-product history and category-wise comparison." />
          } />
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
              description="Users, roles, currencies, language (EN/AR), integrations (Dynamics 365, Shopify, WooCommerce, BigCommerce, Magento, Google Analytics)." />
          } />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
