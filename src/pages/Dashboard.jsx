import { Sparkles } from 'lucide-react'

export default function Dashboard() {
  return (
    <div>
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 text-[11px] font-semibold uppercase tracking-widest mb-3">
          <Sparkles size={12} /> Phase 0 · Scaffold
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Price Competitor</h1>
        <p className="text-slate-500 mt-1.5">
          Track competitor prices + stock across 15 sites for ~1,500 products.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900 mb-2">Ready for Phase 1</h2>
        <p className="text-sm text-slate-600 mb-6 max-w-2xl">
          The scaffold is up and the sidebar reflects the roadmap. Next up: Supabase schema
          + auth + manual product/competitor entry. Nothing on this page is real data yet —
          it's here so you can see the shape.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: 'My products',       value: '—' },
            { label: 'Competitors tracked', value: '—' },
            { label: 'Price snapshots',    value: '—' },
          ].map(({ label, value }) => (
            <div key={label} className="bg-slate-50 border border-slate-100 rounded-xl p-5">
              <p className="text-xs text-slate-500 uppercase tracking-wider">{label}</p>
              <p className="text-2xl font-bold tabular-nums text-slate-900 mt-1">{value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <RoadmapCard n="1" title="MVP data model + manual entry" est="~2 wks" done={false} />
        <RoadmapCard n="2" title="Playwright scraper for 1–2 sites" est="~2–3 wks" done={false} />
        <RoadmapCard n="3" title="Product matching + email alerts" est="~2 wks" done={false} />
        <RoadmapCard n="4" title="Custom dashboards + report builder" est="~3 wks" done={false} />
        <RoadmapCard n="5" title="Repricing rules + Dynamics 365 sync" est="~3–4 wks" done={false} className="md:col-span-2" />
      </div>
    </div>
  )
}

function RoadmapCard({ n, title, est, done, className = '' }) {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl p-5 ${className}`}>
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center font-semibold text-sm">
          {n}
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-800">{title}</div>
          <div className="text-xs text-slate-500 mt-0.5">{est} · {done ? 'done' : 'planned'}</div>
        </div>
      </div>
    </div>
  )
}
