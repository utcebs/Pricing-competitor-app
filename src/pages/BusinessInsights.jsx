import { useEffect, useState, useMemo } from 'react'
import { NavLink } from 'react-router-dom'
import { CheckCircle2, ArrowRight, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { computeSuggestion } from './Dashboard'
import { PageHeader, Card } from '../components/UI'

/**
 * Business Insights — the four "answer cards" that used to live on the
 * Dashboard: Priority (where am I losing), Upside (where can I raise margin),
 * Intelligence (who drives the market), and the Action queue. Moved here so the
 * Dashboard stays a scannable status board and the deeper analysis has room.
 *
 * The data layer mirrors the Dashboard's: latest price per competitor_product
 * (server-side RPC), a bounded 7-day price history for move detection, and a
 * per-product intelligence roll-up.
 */
export default function BusinessInsights() {
  const [data, setData] = useState(null)     // { products, drivers } from the RPC
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // ONE round trip: get_business_insights() aggregates everything in Postgres
  // and returns a compact payload, instead of downloading the whole catalogue
  // (~500 products + ~1500 cps + latest prices + 1000 history rows) just to
  // compute four small lists in the browser.
  useEffect(() => {
    let cancelled = false
    supabase.rpc('get_business_insights')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error.message)
        else setData(data || { products: [], drivers: [] })
      })
      .catch(e => { if (!cancelled) setError(e.message || 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Map the compact RPC rows into the shape the cards expect. The price
  // SUGGESTION stays in JS (computeSuggestion) — one source of truth, and it
  // keeps the Priority card's rich floor/margin detail.
  const intel = useMemo(() => (data?.products || []).map(p => {
    const yourPrice = p.your_price != null ? Number(p.your_price) : null
    const minRival  = p.min_rival  != null ? Number(p.min_rival)  : null
    const avgRival  = p.avg_rival  != null ? Number(p.avg_rival)  : null
    const costPrice = p.cost       != null ? Number(p.cost)       : null
    const targetMarginPct = p.margin    != null ? Number(p.margin)    : null
    const minPriceFloor   = p.min_price != null ? Number(p.min_price) : null
    const gapVsMinPct = (yourPrice != null && minRival != null) ? ((yourPrice - minRival) / minRival) * 100 : null
    const gapVsAvgPct = (yourPrice != null && avgRival != null) ? ((yourPrice - avgRival) / avgRival) * 100 : null
    return {
      product: { id: p.id, name: p.name, sku: p.sku },
      yourPrice, minRival, avgRival, gapVsMinPct, gapVsAvgPct,
      costPrice, targetMarginPct, minPriceFloor,
      cheapestLink: { competitor: { name: p.cheapest_name } },
      position: p.position,
      suggestion: computeSuggestion({ minRival, costPrice, targetMarginPct, minPriceFloor }),
    }
  }), [data])

  // (1) Priority — above-market, ranked by revenue impact
  const losingList = useMemo(() => intel
    .filter(pi => pi.position === 'above')
    .map(pi => ({ ...pi, impact: (pi.gapVsMinPct || 0) * (pi.yourPrice || 0) }))
    .sort((a, b) => b.impact - a.impact).slice(0, 5), [intel])

  // (2) Upside — cheapest AND well below average
  const marginList = useMemo(() => intel
    .filter(pi => pi.position === 'cheapest' && pi.gapVsAvgPct != null && pi.gapVsAvgPct < -3)
    .sort((a, b) => (a.gapVsAvgPct || 0) - (b.gapVsAvgPct || 0)).slice(0, 5), [intel])

  // (3) Intelligence — competitors by cheapest-wins + 7-day moves (server-computed)
  const marketDrivers = useMemo(() => (data?.drivers || []).map(d => ({
    competitor: { id: d.id, name: d.name, domain: d.domain, logo_url: d.logo_url },
    wins: d.wins, moves7d: d.moves7d, coverage: d.coverage,
  })), [data])

  // (4) Action queue — suggested price differs from current by >1%
  const actionQueue = useMemo(() => intel
    .filter(pi => pi.suggestion && pi.yourPrice != null
      && Math.abs(pi.suggestion.price - pi.yourPrice) / pi.yourPrice > 0.01)
    .map(pi => {
      const diff = pi.suggestion.price - pi.yourPrice
      return { ...pi, diff, diffPct: (diff / pi.yourPrice) * 100, impact: Math.abs(diff) }
    })
    .sort((a, b) => b.impact - a.impact).slice(0, 5), [intel])

  return (
    <div>
      <PageHeader
        kicker="Business Insights"
        title="Where to act"
        subtitle="The four questions that turn competitor prices into decisions — priorities, upside, market intelligence, and today's action queue."
      />

      {loading ? <InsightsSkeleton />
        : error ? (
          <Card className="p-8 text-center text-sm text-red-600">Couldn't load insights: {error}</Card>
        ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AnswerCard
            kicker="Priority"
            title="Where am I losing?"
            subtitle="Products priced above the cheapest rival, ranked by revenue impact."
            empty={losingList.length === 0}
            emptyText="You're competitive on every tracked product."
            linkTo="/comparison"
            linkLabel="See all comparisons"
            tone="red"
          >
            {losingList.map(pi => <PriorityRow key={pi.product.id} intel={pi} />)}
          </AnswerCard>

          <AnswerCard
            kicker="Upside"
            title="Where can I increase margin?"
            subtitle="You're the cheapest AND well below the average rival. Room to raise price and still lead."
            empty={marginList.length === 0}
            emptyText="No products are meaningfully below the market average right now."
            linkTo="/comparison"
            linkLabel="Full comparison"
            tone="emerald"
          >
            {marginList.map(pi => <OpportunityRow key={pi.product.id} intel={pi} />)}
          </AnswerCard>

          <AnswerCard
            kicker="Intelligence"
            title="Who is driving the market?"
            subtitle="Competitors ranked by cheapest-price wins and recent price moves."
            empty={marketDrivers.length === 0}
            emptyText="No competitor activity yet — trigger a scrape to build history."
            linkTo="/competitors"
            linkLabel="Competitor list"
            tone="ink"
          >
            {marketDrivers.map(d => <MarketDriverRow key={d.competitor.id} driver={d} />)}
          </AnswerCard>

          <AnswerCard
            kicker="Action queue"
            title="What should I change today?"
            subtitle="Products where the suggested price differs from your current price by >1%."
            empty={actionQueue.length === 0}
            emptyText="Nothing to change — every price is already at the suggested level."
            linkTo="/reprice"
            linkLabel="Open the repricing checklist"
            tone="gold"
          >
            {actionQueue.map(pi => <ActionQueueRow key={pi.product.id} intel={pi} />)}
          </AnswerCard>
        </div>
      )}
    </div>
  )
}

// Skeleton — four card placeholders so the page shows structure instantly
// instead of a blank spinner (perceived speed).
function InsightsSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-pulse">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="overflow-hidden">
          <div className="px-6 py-4 border-b border-ink-100">
            <div className="h-2.5 w-16 bg-ink-100 rounded mb-2.5" />
            <div className="h-4 w-40 bg-ink-100 rounded" />
          </div>
          <div className="p-6 space-y-3">
            {Array.from({ length: 4 }).map((_, j) => (
              <div key={j} className="flex items-center justify-between gap-4">
                <div className="h-3 bg-ink-100 rounded flex-1" style={{ maxWidth: `${70 - j * 8}%` }} />
                <div className="h-3 w-10 bg-ink-100 rounded" />
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}

// ── Cards + rows (moved from Dashboard) ─────────────────────
function AnswerCard({ kicker, title, subtitle, empty, emptyText, linkTo, linkLabel, tone = 'ink', children }) {
  const kickerTone = {
    red: 'text-red-700', emerald: 'text-emerald-700', gold: 'text-brand-700', ink: 'text-ink-600',
  }[tone] || 'text-ink-600'
  return (
    <Card className="overflow-hidden flex flex-col">
      <div className="px-6 py-4 border-b border-ink-100">
        <div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${kickerTone}`}>{kicker}</div>
        <h3 className="font-display text-[19px] tracking-tight text-ink-900 mt-1">{title}</h3>
        <p className="text-[11.5px] text-ink-500 mt-1 leading-snug">{subtitle}</p>
      </div>
      {empty ? (
        <div className="py-10 px-6 text-center flex-1">
          <CheckCircle2 size={26} className="text-emerald-500 mx-auto mb-2" strokeWidth={1.5} />
          <div className="text-[12.5px] text-ink-500 max-w-xs mx-auto">{emptyText}</div>
        </div>
      ) : (
        <div className="divide-y divide-ink-100 flex-1">{children}</div>
      )}
      {linkTo && (
        <NavLink to={linkTo}
          className="px-6 py-3 border-t border-ink-100 text-[11.5px] text-ink-600 hover:bg-canvas-100/60 hover:text-brand-700 inline-flex items-center justify-between transition-colors">
          <span>{linkLabel}</span>
          <ArrowRight size={12} />
        </NavLink>
      )}
    </Card>
  )
}

function MarketDriverRow({ driver }) {
  const { competitor, wins, moves7d, coverage } = driver
  const logoUrl = competitor.logo_url
    || (competitor.domain ? `https://www.google.com/s2/favicons?domain=${competitor.domain}&sz=64` : null)
  return (
    <div className="px-6 py-3.5 hover:bg-canvas-100/40 transition-colors flex items-center gap-3">
      {logoUrl ? (
        <img src={logoUrl} alt="" width="20" height="20" className="rounded flex-shrink-0"
          onError={(e) => { e.currentTarget.style.display = 'none' }} />
      ) : (
        <div className="w-5 h-5 rounded bg-ink-100 text-ink-500 text-[10px] flex items-center justify-center flex-shrink-0 font-semibold">
          {competitor.name?.charAt(0) || '?'}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-ink-900 truncate">{competitor.name}</div>
        <div className="text-[10.5px] text-ink-500 mt-0.5 flex items-center gap-2 flex-wrap">
          <span>Tracked on {coverage} SKU{coverage === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div className="flex items-center gap-4 text-right flex-shrink-0">
        <div>
          <div className="text-[9.5px] uppercase tracking-[0.14em] text-ink-400 font-semibold">Wins</div>
          <div className="font-display text-[16px] text-brand-700 tabular-nums leading-none mt-0.5">{wins}</div>
        </div>
        <div>
          <div className="text-[9.5px] uppercase tracking-[0.14em] text-ink-400 font-semibold">Moves 7d</div>
          <div className={`font-display text-[16px] tabular-nums leading-none mt-0.5 ${moves7d > 3 ? 'text-red-700' : 'text-ink-800'}`}>{moves7d}</div>
        </div>
      </div>
    </div>
  )
}

function ActionQueueRow({ intel }) {
  const { product, yourPrice, suggestion, diff, diffPct } = intel
  const direction = diff < 0 ? 'lower' : 'raise'
  const Arrow = diff < 0 ? ArrowDownRight : ArrowUpRight
  const tone = diff < 0 ? 'text-red-700' : 'text-emerald-700'
  return (
    <div className="px-6 py-3.5 hover:bg-canvas-100/40 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-ink-900 truncate">{product.name}</div>
          <div className="text-[10.5px] font-mono text-ink-500 mt-0.5">{product.sku}</div>
          <div className="text-[11.5px] text-ink-600 mt-1 tabular-nums">
            KD {yourPrice?.toFixed(3)}
            <ArrowRight size={10} className="inline mx-1.5 text-ink-400" />
            <span className={`font-semibold ${tone}`}>KD {suggestion.price.toFixed(3)}</span>
          </div>
        </div>
        <div className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums ${tone} flex-shrink-0`}>
          <Arrow size={11} />
          {direction === 'lower' ? '' : '+'}{diffPct.toFixed(1)}%
        </div>
      </div>
    </div>
  )
}

function PriorityRow({ intel }) {
  const { product, yourPrice, minRival, cheapestLink, gapVsMinPct,
          minPriceFloor, costPrice, targetMarginPct } = intel
  const s = computeSuggestion({ minRival, costPrice, targetMarginPct, minPriceFloor })
  const floorLabel = s?.activeFloor === 'margin'
    ? `holds ${targetMarginPct}% margin`
    : s?.activeFloor === 'min' ? 'at min_price floor'
    : s?.activeFloor === 'cost' ? 'at cost (0% margin)'
    : null
  return (
    <div className="px-6 py-4 hover:bg-canvas-100/40 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <div className="text-[13.5px] font-semibold text-ink-900 truncate">{product.name}</div>
            <div className="text-[10.5px] font-mono text-ink-500">{product.sku}</div>
          </div>
          <div className="mt-1.5 text-[12.5px] text-ink-700 flex items-center gap-3 flex-wrap">
            <span>Your <b className="tabular-nums text-ink-900">KD {yourPrice?.toFixed(3)}</b></span>
            <span className="text-ink-300">·</span>
            <span>
              Cheapest rival <b className="tabular-nums text-ink-900">KD {minRival?.toFixed(3)}</b>
              <span className="text-ink-400"> at {cheapestLink?.competitor?.name}</span>
            </span>
            <GapPill pct={gapVsMinPct} />
          </div>
          {s && (costPrice != null || targetMarginPct != null) && (
            <div className="mt-1 text-[11px] text-ink-500 flex items-center gap-2 flex-wrap">
              {costPrice != null && <span>Cost <b className="tabular-nums text-ink-700">KD {costPrice.toFixed(3)}</b></span>}
              {targetMarginPct != null && <span>· Target margin <b className="text-ink-700">{targetMarginPct}%</b></span>}
              {s.achievedMarginPct != null && (
                <span>· At suggest → <b className={s.achievedMarginPct >= (targetMarginPct ?? 0) ? 'text-emerald-700' : 'text-amber-700'}>{s.achievedMarginPct.toFixed(1)}%</b> margin</span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {s && (
            <div className="text-right">
              <div className="text-[9.5px] uppercase tracking-[0.14em] text-ink-500 font-semibold flex items-center gap-1 justify-end">
                Suggest
                {s.mode === 'floor' && (
                  <span title={`Can't undercut cheapest rival without violating the ${s.activeFloor} floor.`}
                    className="px-1 py-px rounded bg-amber-100 text-amber-800 text-[8.5px] font-bold uppercase tracking-wider">
                    floor
                  </span>
                )}
              </div>
              <div className={`font-display text-[17px] leading-none tabular-nums mt-0.5 ${s.mode === 'floor' ? 'text-amber-700' : 'text-brand-700'}`}>
                KD {s.price.toFixed(3)}
              </div>
              {floorLabel && s.mode === 'floor' && (
                <div className="text-[9.5px] text-amber-700 mt-0.5">{floorLabel}</div>
              )}
            </div>
          )}
          <NavLink to="/comparison" className="text-[11px] text-brand-700 hover:underline mt-0.5">
            Review →
          </NavLink>
        </div>
      </div>
    </div>
  )
}

function OpportunityRow({ intel }) {
  const { product, yourPrice, avgRival, gapVsAvgPct } = intel
  return (
    <div className="px-6 py-3.5 hover:bg-canvas-100/40 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <div className="text-[13.5px] font-semibold text-ink-900 truncate">{product.name}</div>
            <div className="text-[10.5px] font-mono text-ink-500">{product.sku}</div>
          </div>
          <div className="mt-1 text-[12px] text-ink-600 flex items-center gap-3 flex-wrap">
            <span>Your <b className="tabular-nums text-ink-900">KD {yourPrice?.toFixed(3)}</b></span>
            <span className="text-ink-300">vs avg rival</span>
            <span className="tabular-nums text-ink-800">KD {avgRival?.toFixed(3)}</span>
            <GapPill pct={gapVsAvgPct} />
          </div>
        </div>
      </div>
    </div>
  )
}

function GapPill({ pct, large }) {
  if (pct == null) return <span className="text-ink-300">—</span>
  const flat = Math.abs(pct) < 1
  const isOver = pct > 0
  const size = large ? 'px-2.5 py-1 text-[12px]' : 'px-2 py-0.5 text-[11px]'
  if (flat) return (
    <span className={`inline-flex items-center gap-1 rounded-full font-semibold border ${size} bg-ink-100 text-ink-700 border-ink-200 tabular-nums`}>
      Flat
    </span>
  )
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-semibold border tabular-nums ${size} ${
      isOver ? 'bg-red-50 text-red-800 border-red-100' : 'bg-emerald-50 text-emerald-800 border-emerald-100'
    }`}>
      {isOver ? <ArrowUpRight size={11}/> : <ArrowDownRight size={11}/>}
      {isOver ? '+' : ''}{pct.toFixed(1)}%
    </span>
  )
}
