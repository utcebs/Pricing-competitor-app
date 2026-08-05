import { useEffect, useState, useMemo } from 'react'
import { NavLink } from 'react-router-dom'
import { CheckCircle2, ArrowRight, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useTable, fetchLatestPrices } from '../lib/db'
import { computeSuggestion } from './Dashboard'
import { PageHeader, Card, LoadingBlock } from '../components/UI'

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
  const { rows: products, loading } = useTable('products', { order: ['name', { ascending: true }] })
  const { rows: competitors } = useTable('competitors', { eq: ['is_active', true] })
  const { rows: cps } = useTable('competitor_products', { eq: ['is_active', true] })

  const [latestPrices, setLatestPrices] = useState({})   // cp_id → { price, captured_at }
  const [priceHistory, setPriceHistory] = useState([])   // recent moves (7-day window)

  // Latest price per competitor_product — server-side DISTINCT ON RPC.
  useEffect(() => {
    fetchLatestPrices(60)
      .then(({ prices }) => setLatestPrices(prices))
      .catch(() => setLatestPrices({}))
  }, [])

  // Bounded recent history for "who's driving the market" move detection.
  useEffect(() => {
    const from = new Date(); from.setDate(from.getDate() - 7)
    supabase.from('price_history')
      .select('id, competitor_product_id, price, currency_code, captured_at, competitor_products(name, competitor_id, product_id, competitors(name))')
      .gte('captured_at', from.toISOString())
      .order('captured_at', { ascending: false })
      .limit(1000)
      .then(({ data }) => setPriceHistory(data || []))
  }, [])

  // ── Per-product intelligence (same roll-up as the Dashboard) ──
  const productIntel = useMemo(() => {
    const compById = Object.fromEntries(competitors.map(c => [c.id, c]))
    return products.map(p => {
      const productLinks = cps
        .filter(cp => cp.product_id === p.id)
        .map(cp => ({ cp, competitor: compById[cp.competitor_id], latest: latestPrices[cp.id] }))
      const priced = productLinks.filter(l => l.latest?.price != null)
      const rivalPrices = priced.map(l => Number(l.latest.price))
      const minRival = rivalPrices.length ? Math.min(...rivalPrices) : null
      const avgRival = rivalPrices.length ? rivalPrices.reduce((a, b) => a + b, 0) / rivalPrices.length : null
      const yourPrice = p.current_price != null ? Number(p.current_price) : null
      const minPriceFloor = p.min_price != null ? Number(p.min_price) : null
      const costPrice = p.cost_price != null ? Number(p.cost_price) : null
      const targetMarginPct = p.target_margin != null ? Number(p.target_margin) : null
      const gapVsMinPct = (yourPrice != null && minRival != null) ? ((yourPrice - minRival) / minRival) * 100 : null
      const gapVsAvgPct = (yourPrice != null && avgRival != null) ? ((yourPrice - avgRival) / avgRival) * 100 : null
      const cheapestLink = priced.reduce((best, cur) =>
        !best || Number(cur.latest.price) < Number(best.latest.price) ? cur : best, null)
      let position = null
      if (yourPrice != null && rivalPrices.length > 0) {
        if (gapVsMinPct <= -0.001) position = 'cheapest'
        else if (gapVsMinPct > 1) position = 'above'
        else if (Math.abs(gapVsMinPct) <= 1) position = 'match'
        else if (gapVsAvgPct < -1) position = 'below'
        else position = 'match'
      }
      const suggestion = computeSuggestion({ minRival, costPrice, targetMarginPct, minPriceFloor })
      return {
        product: p, rivalCount: priced.length, linkCount: productLinks.length,
        yourPrice, minRival, avgRival, minPriceFloor, costPrice, targetMarginPct,
        gapVsMinPct, gapVsAvgPct, cheapestLink, position, suggestion,
      }
    })
  }, [products, cps, latestPrices, competitors])

  // Actionable = suggested price differs from current by >1% (either direction)
  const actionable = productIntel.filter(pi =>
    pi.suggestion && pi.yourPrice != null
    && Math.abs(pi.suggestion.price - pi.yourPrice) / pi.yourPrice > 0.01
  )

  // (1) Priority — where am I losing? Above-market, ranked by revenue impact.
  const losingList = productIntel
    .filter(pi => pi.position === 'above')
    .map(pi => ({ ...pi, impact: (pi.gapVsMinPct || 0) * (pi.yourPrice || 0) }))
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 5)

  // (2) Upside — cheapest AND well below average (room to raise price, stay leader)
  const marginList = productIntel
    .filter(pi => pi.position === 'cheapest' && pi.gapVsAvgPct != null && pi.gapVsAvgPct < -3)
    .sort((a, b) => (a.gapVsAvgPct || 0) - (b.gapVsAvgPct || 0))
    .slice(0, 5)

  // (3) Intelligence — per competitor: cheapest-wins + price moves in the last 7d
  const marketDrivers = useMemo(() => {
    const wins = {}, moves = {}, coverage = {}
    for (const pi of productIntel) {
      if (pi.cheapestLink?.competitor?.id != null) {
        const cid = pi.cheapestLink.competitor.id
        wins[cid] = (wins[cid] || 0) + 1
      }
      for (const cp of cps.filter(c => c.product_id === pi.product.id)) {
        coverage[cp.competitor_id] = (coverage[cp.competitor_id] || 0) + 1
      }
    }
    const weekAgo = Date.now() - 7 * 86400 * 1000
    const groups = {}
    for (const row of priceHistory) {
      const arr = groups[row.competitor_product_id] || (groups[row.competitor_product_id] = [])
      arr.push(row)
    }
    for (const rows of Object.values(groups)) {
      if (rows.length < 2) continue
      const cid = rows[0].competitor_products?.competitor_id
      if (cid == null) continue
      const [latest, prior] = rows
      if (new Date(latest.captured_at).getTime() < weekAgo) continue
      if (Number(latest.price) !== Number(prior.price)) moves[cid] = (moves[cid] || 0) + 1
    }
    return competitors
      .map(c => ({ competitor: c, wins: wins[c.id] || 0, moves7d: moves[c.id] || 0, coverage: coverage[c.id] || 0 }))
      .filter(r => r.wins > 0 || r.moves7d > 0)
      .sort((a, b) => (b.wins * 2 + b.moves7d) - (a.wins * 2 + a.moves7d))
      .slice(0, 5)
  }, [productIntel, priceHistory, competitors, cps])

  // (4) Action queue — merged actionable list, ranked by absolute price impact
  const actionQueue = actionable
    .map(pi => {
      const diff = pi.suggestion.price - pi.yourPrice
      const diffPct = (diff / pi.yourPrice) * 100
      return { ...pi, diff, diffPct, impact: Math.abs(diff) }
    })
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 5)

  return (
    <div>
      <PageHeader
        kicker="Business Insights"
        title="Where to act"
        subtitle="The four questions that turn competitor prices into decisions — priorities, upside, market intelligence, and today's action queue."
      />

      {loading ? <LoadingBlock text="Building insights" /> : (
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
