import { NavLink, Outlet, Navigate } from 'react-router-dom'
import {
  LayoutDashboard, Package, Building2, LineChart, Bell,
  FileBarChart, Settings, LogOut, Link2, DollarSign,
  FolderTree, UserCog, Play, Sparkles, Repeat, Plug, GitCompare,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { setLanguage } from '../lib/i18n'
import { useTranslation } from 'react-i18next'
import ScrapeStatusPill from './ScrapeStatusPill'

const PRIMARY_NAV = [
  { path: '/',                    key: 'nav.dashboard',    icon: LayoutDashboard },
  { path: '/products',            key: 'nav.products',     icon: Package },
  { path: '/competitors',         key: 'nav.competitors',  icon: Building2 },
  { path: '/competitor-products', key: 'nav.linked',       icon: Link2 },
  { path: '/comparison',          key: 'nav.comparison',   icon: GitCompare },
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
      <div className="min-h-screen flex items-center justify-center bg-canvas-50">
        <div className="text-sm text-ink-400">Loading…</div>
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />

  const currentLng = i18n.language || 'en'

  return (
    <div className="min-h-screen flex bg-canvas-50 text-ink-900">
      {/* ── Sidebar ─────────────────────────────────────── */}
      <aside className="w-[260px] min-h-screen bg-ink-900 text-ink-300 flex flex-col relative">
        {/* Faint gold accent line */}
        <div className="absolute top-0 right-0 w-px h-full bg-gradient-to-b from-brand-500/40 via-transparent to-transparent" />

        {/* Wordmark — logo inverted so black-on-transparent shows as white on dark sidebar */}
        <div className="px-6 pt-7 pb-6">
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="Union Trading Co."
            className="h-9 w-auto object-contain [filter:brightness(0)_invert(1)]"
          />
          <div className="text-[9.5px] uppercase tracking-[0.22em] text-ink-500 mt-3 font-medium">
            Competitive Pricing
          </div>
        </div>

        <nav className="flex-1 px-3 py-2 overflow-y-auto">
          <div className="space-y-0.5">
            {PRIMARY_NAV.map(item => <NavItem key={item.path} {...item} label={t(item.key)} />)}
          </div>

          <SectionLabel>Automation</SectionLabel>
          <div className="space-y-0.5">
            {OPS_NAV.map(item => <NavItem key={item.path} {...item} label={t(item.key)} />)}
          </div>

          {isAdmin && (
            <>
              <SectionLabel>Administration</SectionLabel>
              <div className="space-y-0.5">
                {ADMIN_NAV.map(item => <NavItem key={item.path} {...item} label={t(item.key)} />)}
              </div>
            </>
          )}
        </nav>

        {/* Footer: language + user + signout */}
        <div className="px-4 py-4 border-t border-ink-800">
          <div className="flex items-center gap-1 mb-4">
            <span className="text-[9px] uppercase tracking-[0.2em] text-ink-500 mr-2">Locale</span>
            {['en', 'ar'].map(lng => (
              <button key={lng}
                onClick={() => setLanguage(lng)}
                className={`px-2 py-0.5 text-[10px] uppercase rounded font-semibold transition-colors ${
                  currentLng === lng
                    ? 'bg-brand-500 text-white'
                    : 'text-ink-500 hover:text-white hover:bg-ink-800'
                }`}>
                {lng}
              </button>
            ))}
          </div>

          <div className="mb-2 px-2">
            <div className="text-[9.5px] uppercase tracking-[0.18em] text-ink-500">Signed in</div>
            <div className="text-[13px] font-medium text-white truncate mt-1">{user.email}</div>
            {profile?.role && (
              <div className="text-[9.5px] text-brand-400 uppercase tracking-[0.2em] mt-1 font-semibold">
                {profile.role}
              </div>
            )}
          </div>

          <button onClick={signOut}
            className="flex items-center gap-2.5 px-2 py-2 rounded-lg text-[13px] font-medium text-ink-400 hover:text-white hover:bg-ink-800 w-full transition-colors">
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto relative">
        <div className="max-w-[1240px] mx-auto px-8 lg:px-12 py-10">
          <Outlet />
        </div>
        <ScrapeStatusPill />
      </main>
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div className="mt-6 mb-2.5 px-3 text-[9.5px] font-semibold uppercase tracking-[0.2em] text-ink-500">
      {children}
    </div>
  )
}

function NavItem({ path, label, icon: Icon }) {
  return (
    <NavLink to={path} end={path === '/'}
      className={({ isActive }) =>
        `group flex items-center gap-3 px-3 py-[9px] rounded-lg text-[13px] font-medium transition-all ${
          isActive
            ? 'bg-ink-800 text-white shadow-inner'
            : 'text-ink-400 hover:text-white hover:bg-ink-800/50'
        }`}>
      {({ isActive }) => (
        <>
          <span className={`inline-flex ${isActive ? 'text-brand-400' : 'text-ink-500 group-hover:text-ink-300'} transition-colors`}>
            <Icon size={16} strokeWidth={2} />
          </span>
          {label}
          {isActive && <span className="ml-auto w-1 h-1 rounded-full bg-brand-400" />}
        </>
      )}
    </NavLink>
  )
}
