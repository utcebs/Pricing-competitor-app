import { NavLink, Outlet, Navigate } from 'react-router-dom'
import {
  LayoutDashboard, Package, Building2, LineChart, Bell,
  FileBarChart, Settings, LogOut, TrendingUp, Link2, DollarSign,
  FolderTree, UserCog, Play, Sparkles, Repeat, Plug,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { setLanguage } from '../lib/i18n'
import { useTranslation } from 'react-i18next'

const PRIMARY_NAV = [
  { path: '/',                    key: 'nav.dashboard',    icon: LayoutDashboard },
  { path: '/products',            key: 'nav.products',     icon: Package },
  { path: '/competitors',         key: 'nav.competitors',  icon: Building2 },
  { path: '/competitor-products', key: 'nav.linked',       icon: Link2 },
  { path: '/prices',              key: 'nav.trends',       icon: LineChart },
  { path: '/prices/new',          key: 'nav.entry',        icon: DollarSign },
]
const OPS_NAV = [
  { path: '/scrapers',      key: 'nav.scrapers',   icon: Play },
  { path: '/matches',       key: 'nav.matches',    icon: Sparkles },
  { path: '/alerts',        key: 'nav.alerts',     icon: Bell },
  { path: '/reports',       key: 'nav.reports',    icon: FileBarChart },
  { path: '/repricing',     key: 'nav.repricing',  icon: Repeat },
  { path: '/integrations',  key: 'nav.integrations', icon: Plug },
]
const ADMIN_NAV = [
  { path: '/categories',    key: 'nav.categories', icon: FolderTree },
  { path: '/users',         key: 'nav.users',      icon: UserCog },
]

export default function Layout() {
  const { user, profile, loading, isAdmin, signOut } = useAuth()
  const { t, i18n } = useTranslation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-400">Loading…</div>
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />

  const currentLng = i18n.language || 'en'

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <aside className="w-64 min-h-screen bg-slate-900 text-slate-100 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-brand-600 flex items-center justify-center">
              <TrendingUp size={18} />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">Price Competitor</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-widest">Phase 5 · Full stack</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <div className="space-y-0.5">
            {PRIMARY_NAV.map(item => <NavItem key={item.path} {...item} label={t(item.key)} />)}
          </div>
          <div className="mt-5 mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            Automation
          </div>
          <div className="space-y-0.5">
            {OPS_NAV.map(item => <NavItem key={item.path} {...item} label={t(item.key)} />)}
          </div>
          {isAdmin && (
            <>
              <div className="mt-5 mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Admin
              </div>
              <div className="space-y-0.5">
                {ADMIN_NAV.map(item => <NavItem key={item.path} {...item} label={t(item.key)} />)}
              </div>
            </>
          )}
        </nav>

        <div className="px-3 py-3 border-t border-slate-800">
          {/* Language switch */}
          <div className="flex items-center gap-1 mb-3 px-2">
            <span className="text-[10px] uppercase tracking-widest text-slate-500 mr-1">Lang</span>
            {['en', 'ar'].map(lng => (
              <button key={lng}
                onClick={() => setLanguage(lng)}
                className={`px-2 py-0.5 text-[10px] uppercase rounded font-semibold ${currentLng === lng ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
                {lng}
              </button>
            ))}
          </div>
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

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

function NavItem({ path, label, icon: Icon }) {
  return (
    <NavLink to={path} end={path === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
          isActive ? 'bg-brand-600/20 text-brand-300' : 'text-slate-400 hover:text-white hover:bg-slate-800'
        }`}>
      <Icon size={17} /> {label}
    </NavLink>
  )
}
