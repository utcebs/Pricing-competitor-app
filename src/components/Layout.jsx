import { NavLink, Outlet, Navigate } from 'react-router-dom'
import {
  LayoutDashboard, Package, Building2, LineChart, Bell,
  FileBarChart, Settings, LogOut, TrendingUp, Link2, DollarSign,
  FolderTree, UserCog,
} from 'lucide-react'
import { useAuth } from '../lib/auth'

// Nav is grouped: primary features + admin section.
const PRIMARY_NAV = [
  { path: '/',                    label: 'Dashboard',    icon: LayoutDashboard },
  { path: '/products',            label: 'Products',     icon: Package },
  { path: '/competitors',         label: 'Competitors',  icon: Building2 },
  { path: '/competitor-products', label: 'Linked Items', icon: Link2 },
  { path: '/prices',              label: 'Price Trends', icon: LineChart },
  { path: '/prices/new',          label: 'Log a Price',  icon: DollarSign },
]
const ADMIN_NAV = [
  { path: '/categories',          label: 'Categories',   icon: FolderTree },
  { path: '/users',               label: 'Users',        icon: UserCog },
]
const PLACEHOLDER_NAV = [
  { path: '/alerts',              label: 'Alerts',       icon: Bell },
  { path: '/reports',             label: 'Reports',      icon: FileBarChart },
  { path: '/settings',            label: 'Settings',     icon: Settings },
]

export default function Layout() {
  const { user, profile, loading, isAdmin, isManager, signOut } = useAuth()

  // While the initial session lookup is in flight, render nothing so
  // we don't briefly show the "sign in →" state to already-signed-in users.
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-400">Loading…</div>
      </div>
    )
  }

  // Not signed in? Bounce to /login.
  if (!user) return <Navigate to="/login" replace />

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Sidebar */}
      <aside className="w-64 min-h-screen bg-slate-900 text-slate-100 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-brand-600 flex items-center justify-center">
              <TrendingUp size={18} />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">Price Competitor</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-widest">Phase 1 · MVP</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <div className="space-y-0.5">
            {PRIMARY_NAV.map(item => <NavItem key={item.path} {...item} />)}
          </div>

          {isAdmin && (
            <>
              <div className="mt-5 mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Admin
              </div>
              <div className="space-y-0.5">
                {ADMIN_NAV.map(item => <NavItem key={item.path} {...item} />)}
              </div>
            </>
          )}

          <div className="mt-5 mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
            Coming later
          </div>
          <div className="space-y-0.5">
            {PLACEHOLDER_NAV.map(item => <NavItem key={item.path} {...item} muted />)}
          </div>
        </nav>

        <div className="px-3 py-4 border-t border-slate-800">
          <div className="px-3 py-2 mb-1">
            <div className="text-xs text-slate-400">Signed in as</div>
            <div className="text-sm font-medium text-white truncate">{user.email}</div>
            {profile?.role && (
              <div className="text-[10px] text-brand-300 uppercase tracking-widest mt-0.5">
                {profile.role}
              </div>
            )}
          </div>
          <button onClick={signOut}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 w-full">
            <LogOut size={17} /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

function NavItem({ path, label, icon: Icon, muted }) {
  return (
    <NavLink to={path} end={path === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
          isActive
            ? 'bg-brand-600/20 text-brand-300'
            : muted
              ? 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
        }`}>
      <Icon size={17} /> {label}
    </NavLink>
  )
}
