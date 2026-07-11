import { Construction } from 'lucide-react'

// Generic "coming in phase N" placeholder used by every sidebar route
// that isn't the Dashboard yet. Keeps the nav shell walkable while the
// real features get built out.
export default function Placeholder({ title, phase, description }) {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-ink-900">{title}</h1>
        <p className="text-ink-500 mt-1.5">{description}</p>
      </div>

      <div className="bg-white border border-ink-200 rounded-2xl p-12 shadow-sm text-center">
        <div className="w-12 h-12 mx-auto rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center mb-4">
          <Construction size={22} />
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-widest text-brand-600 mb-2">
          Coming in Phase {phase}
        </div>
        <p className="text-sm text-ink-500 max-w-md mx-auto">
          The sidebar entry is here so the app shape is visible. This page
          gets built out when we reach its phase in the roadmap.
        </p>
      </div>
    </div>
  )
}
