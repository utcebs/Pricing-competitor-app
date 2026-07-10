import { NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard, Package, Building2, LineChart, Bell,
  FileBarChart, Settings, LogOut, TrendingUp,
} from 'lucide-react'
import { useAuth } from '../lib/auth'

// Sidebar shell for the whole app. Nav items match the Phase 1–5
// roadmap so the shape is visible even before those pages exist —
// most link to placeholders for now.
const NAV = [
  { path: '/',            label: 'Dashboard',   icon: LayoutDashboard },
  { path: '/products',    label: 'My Products', icon: Package },
  { path: '/competitors', label: 'Competitors', icon: Building2 },
  { path: '/prices',      label: 'Price Trends', icon: LineChart },
  { path: '/alerts',      label: 'Alerts',      icon: Bell },
  { path: '/reports',     label: 'Reports',     icon: FileBarChart },
  { path: '/settings',    label: 'Settings',    icon: Settings },
]

export default function Layout() {
  const { user, profile, signOut } = useAuth()

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
              <div className="text-[10px] text-slate-400 uppercase tracking-widest">v0.1 · scaffold</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(({ path, label, icon: Icon }) => (
            <NavLink key={path} to={path} end={path === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brand-600/20 text-brand-300'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}>
              <Icon size={17} /> {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-slate-800">
          {user ? (
            <>
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
            </>
          ) : (
            <NavLink to="/login"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800">
              Sign in →
            </NavLink>
          )}
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
