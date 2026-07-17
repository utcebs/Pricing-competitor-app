import { useEffect, useState, useMemo } from 'react'
import { Link, NavLink } from 'react-router-dom'
import {
  Package, Building2, LineChart, Play, Sparkles, TrendingUp, TrendingDown,
  ArrowUpRight, ArrowDownRight, AlertTriangle, CheckCircle2, Activity,
  Layers, Zap, Clock, ArrowRight, Radio, Target, Crown, Scale,
  Flame, ShieldCheck, ClipboardList, ChevronRight, Percent,
} from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useTable } from '../lib/db'
import { useAuth } from '../lib/auth'
import { PageHeader, Card, Button, LoadingBlock, Badge } from '../components/UI'

/**
 * Suggest a price that:
 *   1. Beats the cheapest rival by 1 fils where possible
 *   2. Never sells below cost
 *   3. Honors an absolute min_price floor if set
 *   4. Keeps gross margin ≥ target_margin (margin = (price − cost) / price)
 * If undercutting the rival would violate any floor, we return the highest
 * applicable floor and flag mode='floor' so the UI can explain why.
 */
export function computeSuggestion({ minRival, costPrice, targetMarginPct, minPriceFloor }) {
  if (minRival == null) return null

  const marginFloor =
    costPrice != null && targetMarginPct != null && targetMarginPct < 100
      ? costPrice / (1 - targetMarginPct / 100)
      : null

  const floors = [marginFloor, minPriceFloor, costPrice].filter(v => v != null && v >= 0)
  const effectiveFloor = floors.length ? Math.max(...floors) : 0
  const activeFloor = floors.length
    ? (marginFloor === effectiveFloor ? 'margin'
      : minPriceFloor === effectiveFloor ? 'min'
      : 'cost')
    : null

  const undercut = minRival - 0.001
  const canUndercut = undercut >= effectiveFloor
  const price = canUndercut ? undercut : effectiveFloor
  const mode = canUndercut ? 'competitive' : 'floor'
  const achievedMarginPct =
    costPrice != null && price > 0 ? ((price - costPrice) / price) * 100 : null

  return { price, mode, achievedMarginPct, activeFloor, effectiveFloor }
}

/**
 * Dashboard — the category manager's morning coffee view.
 *
 * The math (all client-side after a handful of table reads):
 *   For each product with a current_price and ≥1 scraped competitor price
 *   in the last 60 days: compute gap_vs_cheapest and gap_vs_average.
 *   Positive gap = you're pricier. Negative = you're cheaper.
 *
 * The dashboard organises those numbers into one screen a manager can
 * scan in 15 seconds and act on in 30.
 */
export default function Dashboard() {
  const { profile } = useAuth()
  const { rows: products } = useTable('products', { order: ['name', { ascending: true }] })
  const { rows: competitors } = useTable('competitors', { eq: ['is_active', true] })
  const { rows: cps } = useTable('competitor_products', { eq: ['is_active', true] })
  const { rows: categories } = useTable('categories')

  const [latestPrices, setLatestPrices] = useState({})   // cp_id → { price, captured_at }
  const [priceHistory, setPriceHistory] = useState([])   // recent moves
  const [scrapeRuns, setScrapeRuns] = useState([])
  const [pendingProposals, setPendingProposals] = useState(0)
  const [loading, setLoading] = useState(true)

  const cpIds = cps.map(c => c.id)

  useEffect(() => {
    if (cpIds.length === 0) { setLatestPrices({}); setPriceHistory([]); return }
    const from = new Date(); from.setDate(from.getDate() - 60)
    supabase.from('price_history')
      .select('id, competitor_product_id, price, currency_code, captured_at, competitor_products(name, competitor_id, product_id, competitors(name))')
      .in('competitor_product_id', cpIds)
      .gte('captured_at', from.toISOString())
      .order('captured_at', { ascending: false })
      .limit(1500)
      .then(({ data }) => {
        const seen = {}
        for (const row of (data || [])) {
          if (!seen[row.competitor_product_id]) seen[row.competitor_product_id] = row
        }
        setLatestPrices(seen)
        setPriceHistory(data || [])
      })
  }, [cpIds.join(',')])

  useEffect(() => {
    supabase.from('scrape_runs')
      .select('status, started_at, finished_at, items_scraped, items_failed')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setScrapeRuns(data || [])
        setLoading(false)
      })
    // Pending proposals — table may not exist / be empty on new installs.
    // Fail silently and default to 0 so the KPI still renders.
    supabase.from('pricing_proposals').select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count }) => setPendingProposals(count || 0))
      .catch(() => setPendingProposals(0))
  }, [])

  // ── Compute per-product intelligence ────────────────────────
  const productIntel = useMemo(() => {
    const compById = Object.fromEntries(competitors.map(c => [c.id, c]))
    return products.map(p => {
      const productLinks = cps
        .filter(cp => cp.product_id === p.id)
        .map(cp => {
          const latest = latestPrices[cp.id]
          return { cp, competitor: compById[cp.competitor_id], latest }
        })
      const priced = productLinks.filter(l => l.latest?.price != null)
      const rivalPrices = priced.map(l => Number(l.latest.price))
      const minRival = rivalPrices.length ? Math.min(...rivalPrices) : null
      const avgRival = rivalPrices.length ? rivalPrices.reduce((a, b) => a + b, 0) / rivalPrices.length : null
      const yourPrice = p.current_price != null ? Number(p.current_price) : null
      const minPriceFloor = p.min_price != null ? Number(p.min_price) : null
      const costPrice = p.cost_price != null ? Number(p.cost_price) : null
      const targetMarginPct = p.target_margin != null ? Number(p.target_margin) : null

      const gapVsMinPct = (yourPrice != null && minRival != null)
        ? ((yourPrice - minRival) / minRival) * 100 : null
      const gapVsAvgPct = (yourPrice != null && avgRival != null)
        ? ((yourPrice - avgRival) / avgRival) * 100 : null

      // "Where's the cheapest?"
      const cheapestLink = priced.reduce((best, cur) =>
        !best || Number(cur.latest.price) < Number(best.latest.price) ? cur : best, null)

      // Market position bucket (only when we have a yourPrice AND ≥1 rival price):
      //   cheapest → you're below every rival (market leader)
      //   above    → you're > cheapest rival by more than 1%
      //   match    → within ±1% of the cheapest rival
      //   below    → you're below the AVERAGE rival by more than 1% but not cheapest
      let position = null
      if (yourPrice != null && rivalPrices.length > 0) {
        if (gapVsMinPct <= -0.001) position = 'cheapest'          // <  cheapest (any amount)
        else if (gapVsMinPct > 1) position = 'above'              // >1% over cheapest
        else if (Math.abs(gapVsMinPct) <= 1) position = 'match'   // within ±1% of cheapest
        else if (gapVsAvgPct < -1) position = 'below'             // <-1% vs avg (rare, kept for completeness)
        else position = 'match'
      }

      const suggestion = computeSuggestion({ minRival, costPrice, targetMarginPct, minPriceFloor })

      return {
        product: p,
        rivalCount: priced.length,
        linkCount: productLinks.length,
        yourPrice, minRival, avgRival, minPriceFloor,
        costPrice, targetMarginPct,
        gapVsMinPct, gapVsAvgPct,
        cheapestLink,
        position,
        suggestion,
      }
    })
  }, [products, cps, latestPrices, competitors])

  // ── Coverage KPIs ────────────────────────────────────────
  const trackedCount = productIntel.filter(pi => pi.rivalCount > 0).length
  const totalProducts = productIntel.length
  const coveragePct = totalProducts > 0 ? Math.round((trackedCount / totalProducts) * 100) : 0

  // Competitors with at least one scraped price
  const competitorsTracked = useMemo(() => {
    const active = new Set()
    for (const [, pr] of Object.entries(latestPrices)) {
      if (pr?.competitor_products?.competitor_id) active.add(pr.competitor_products.competitor_id)
    }
    return active.size || competitors.length
  }, [latestPrices, competitors])

  // Latest scan across all captured_at, not just scrape_runs (works even
  // if a run finished but its rows landed via a different path).
  const latestScanTs = useMemo(() => {
    let max = 0
    for (const [, pr] of Object.entries(latestPrices)) {
      const t = pr?.captured_at ? new Date(pr.captured_at).getTime() : 0
      if (t > max) max = t
    }
    return max || null
  }, [latestPrices])

  // ── Position mix KPIs (only over products with rival data) ──
  const positioned = productIntel.filter(pi => pi.position)
  const positionCount = (p) => positioned.filter(pi => pi.position === p).length
  const cheapestPct = positioned.length ? Math.round((positionCount('cheapest') / positioned.length) * 100) : 0
  const abovePct    = positioned.length ? Math.round((positionCount('above')    / positioned.length) * 100) : 0
  const matchPct    = positioned.length ? Math.round((positionCount('match')    / positioned.length) * 100) : 0
  const belowPct    = positioned.length ? Math.round((positionCount('below')    / positioned.length) * 100) : 0

  // ── Action KPIs ─────────────────────────────────────────
  // Actionable = suggested price differs from current by >1% (both directions)
  const actionable = productIntel.filter(pi =>
    pi.suggestion && pi.yourPrice != null
    && Math.abs(pi.suggestion.price - pi.yourPrice) / pi.yourPrice > 0.01
  )

  // Margin at risk: for products where you're ABOVE cheapest, the sum of
  // (yourPrice − cheapestRival). This is per-unit margin you'd shed if you
  // had to match. Rough "money left exposed" — the deeper metric needs volume.
  const marginAtRisk = productIntel.reduce((sum, pi) => {
    if (pi.position === 'above' && pi.yourPrice != null && pi.minRival != null) {
      return sum + (pi.yourPrice - pi.minRival)
    }
    return sum
  }, 0)

  // Price changes today — distinct (cp_id, day) with a real move in last 24h
  const dayAgo = Date.now() - 24 * 3600 * 1000
  const changesToday = useMemo(() => {
    const groups = {}
    for (const row of priceHistory) {
      const arr = groups[row.competitor_product_id] || (groups[row.competitor_product_id] = [])
      arr.push(row)
    }
    let n = 0
    for (const rows of Object.values(groups)) {
      if (rows.length < 2) continue
      const [latest, prior] = rows
      if (new Date(latest.captured_at).getTime() < dayAgo) continue
      if (Number(latest.price) !== Number(prior.price)) n++
    }
    return n
  }, [priceHistory])

  // Data freshness: % of tracked products with a price scraped in the last 24h
  const freshTracked = productIntel.filter(pi => {
    if (pi.rivalCount === 0) return false
    return cps.filter(cp => cp.product_id === pi.product.id)
      .some(cp => {
        const t = latestPrices[cp.id]?.captured_at
        return t && new Date(t).getTime() > dayAgo
      })
  }).length
  const freshPct = trackedCount > 0 ? Math.round((freshTracked / trackedCount) * 100) : 0

  // Worker status
  const latestScrape = scrapeRuns.find(r => r.started_at)
  const workerAge = latestScrape?.started_at ? Math.round((Date.now() - new Date(latestScrape.started_at).getTime()) / 60_000) : null
  const workerHealthy = workerAge != null && workerAge < 30

  // ── Answer-card data ────────────────────────────────────
  // (1) Where am I losing? → above-market products, ranked by (gap × price)
  const losingList = productIntel
    .filter(pi => pi.position === 'above')
    .map(pi => ({ ...pi, impact: (pi.gapVsMinPct || 0) * (pi.yourPrice || 0) }))
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 5)

  // (2) Where can I increase margin? → I'm the cheapest AND well below average
  //     (there's real room to raise my price and stay leader)
  const marginList = productIntel
    .filter(pi => pi.position === 'cheapest' && pi.gapVsAvgPct != null && pi.gapVsAvgPct < -3)
    .sort((a, b) => (a.gapVsAvgPct || 0) - (b.gapVsAvgPct || 0))
    .slice(0, 5)

  // (3) Who's driving the market? → per competitor: cheapest-wins + moves in 7d
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
      if (Number(latest.price) !== Number(prior.price)) {
        moves[cid] = (moves[cid] || 0) + 1
      }
    }
    return competitors
      .map(c => ({
        competitor: c,
        wins: wins[c.id] || 0,
        moves7d: moves[c.id] || 0,
        coverage: coverage[c.id] || 0,
      }))
      .filter(r => r.wins > 0 || r.moves7d > 0)
      .sort((a, b) => (b.wins * 2 + b.moves7d) - (a.wins * 2 + a.moves7d))
      .slice(0, 5)
  }, [productIntel, priceHistory, competitors, cps])

  // (4) What should I change today? → merged actionable list, ranked by impact
  const actionQueue = actionable
    .map(pi => {
      const diff = pi.suggestion.price - pi.yourPrice
      const diffPct = (diff / pi.yourPrice) * 100
      return { ...pi, diff, diffPct, impact: Math.abs(diff) }
    })
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 5)

  // ── Recent moves: distinct-per-cp changes in last 72h ──────
  const recentMoves = useMemo(() => {
    // group history by competitor_product_id
    const groups = {}
    for (const row of priceHistory) {
      const arr = groups[row.competitor_product_id] || (groups[row.competitor_product_id] = [])
      arr.push(row)
    }
    // For each cp with ≥2 snapshots, compute latest vs prior
    const moves = []
    const cutoff = Date.now() - 72 * 3600 * 1000
    for (const [cpId, rows] of Object.entries(groups)) {
      if (rows.length < 2) continue
      const [latest, prior] = rows
      if (new Date(latest.captured_at).getTime() < cutoff) continue
      const p1 = Number(prior.price), p2 = Number(latest.price)
      if (p1 === p2) continue
      moves.push({
        cp_id: cpId,
        cp_name: latest.competitor_products?.name,
        competitor_name: latest.competitor_products?.competitors?.name,
        product_id: latest.competitor_products?.product_id,
        from: p1, to: p2,
        changePct: ((p2 - p1) / p1) * 100,
        at: latest.captured_at,
      })
    }
    return moves.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 8)
  }, [priceHistory])

  // ── Category performance ─────────────────────────────────
  const categoryRollup = useMemo(() => {
    const buckets = new Map()
    for (const pi of productIntel) {
      const key = pi.product.category_id ?? 0
      if (!buckets.has(key)) {
        buckets.set(key, {
          categoryId: pi.product.category_id,
          name: categories.find(c => c.id === pi.product.category_id)?.name || 'Uncategorized',
          products: [],
        })
      }
      buckets.get(key).products.push(pi)
    }
    return [...buckets.values()].map(b => {
      const tracked = b.products.filter(p => p.rivalCount > 0)
      const gaps = tracked.map(p => p.gapVsMinPct).filter(g => g != null)
      const avgGap = gaps.length ? gaps.reduce((a, x) => a + x, 0) / gaps.length : null
      const overpriced = b.products.filter(p => p.gapVsMinPct != null && p.gapVsMinPct > 5).length
      const underpriced = b.products.filter(p => p.gapVsAvgPct != null && p.gapVsAvgPct < -5).length
      return {
        ...b,
        productCount: b.products.length,
        trackedCount: tracked.length,
        avgGap,
        overpriced, underpriced,
      }
    }).sort((a, b) => (b.overpriced || 0) - (a.overpriced || 0))
  }, [productIntel, categories])

  if (loading) return <div className="min-h-[60vh]"><LoadingBlock text="Assembling intelligence" /></div>

  const greeting = profile?.full_name?.split(' ')[0] || 'there'
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div>
      {/* ── Hero header ─────────────────────────────────── */}
      <div className="mb-8 pb-6 border-b border-ink-100">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-600 mb-2">
              {today}
            </div>
            <h1 className="font-display text-[36px] leading-[1.05] tracking-tightest text-ink-900">
              Good morning, {greeting}.
            </h1>
            <p className="text-[15px] text-ink-500 mt-2 max-w-2xl leading-relaxed">
              {losingList.length > 0
                ? <>You're above the market on <span className="font-semibold text-red-700">{positionCount('above')} product{positionCount('above') === 1 ? '' : 's'}</span> · leading the market on <span className="font-semibold text-emerald-700">{positionCount('cheapest')}</span> · <span className="font-semibold text-ink-800">KD {marginAtRisk.toFixed(3)}</span> in per-unit margin exposed.</>
                : positionCount('cheapest') > 0
                  ? <>Leading the market on <span className="font-semibold text-emerald-700">{positionCount('cheapest')} product{positionCount('cheapest') === 1 ? '' : 's'}</span> · no urgent overprice fires.</>
                  : <>Baseline stable. No overprice fires and no leadership positions to defend.</>}
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">Last scan</div>
            <div className="font-display text-[18px] text-ink-800 tabular-nums mt-1">
              {latestScanTs ? relTime(new Date(latestScanTs)) : '—'}
            </div>
            {workerHealthy && (
              <div className="inline-flex items-center gap-1 text-[10.5px] text-emerald-700 mt-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> live
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── KPI ribbon: 3 grouped rows ──────────────────── */}
      {/* Row 1 — Coverage */}
      <SectionLabel>Coverage</SectionLabel>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        <KpiTile
          icon={Layers} label="Products Monitored"
          value={`${trackedCount}`}
          hint={`${coveragePct}% of ${totalProducts}-item catalogue`}
          tone={coveragePct >= 80 ? 'emerald' : coveragePct >= 50 ? 'gold' : 'amber'}
        />
        <KpiTile
          icon={Building2} label="Competitors Tracked"
          value={competitorsTracked}
          hint={competitorsTracked === 0 ? 'Add a competitor to begin' : `${competitorsTracked} site${competitorsTracked === 1 ? '' : 's'} feeding data`}
          tone="ink"
        />
        <KpiTile
          icon={Clock} label="Latest Scan"
          value={latestScanTs ? relTime(new Date(latestScanTs)) : '—'}
          hint={freshPct >= 90 ? `${freshPct}% of tracked fresh (24h)` : `${freshTracked}/${trackedCount} fresh in 24h`}
          tone={freshPct >= 90 ? 'emerald' : freshPct >= 60 ? 'gold' : 'amber'}
          pulse={workerHealthy}
        />
      </div>

      {/* Row 2 — Market Position */}
      <SectionLabel>Market Position</SectionLabel>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <KpiTile
          icon={Crown} label="Cheapest Price"
          value={`${cheapestPct}%`}
          hint={`${positionCount('cheapest')} product${positionCount('cheapest') === 1 ? '' : 's'} lead the market`}
          tone="emerald"
        />
        <KpiTile
          icon={Scale} label="Price Matches"
          value={`${matchPct}%`}
          hint={`${positionCount('match')} within ±1% of cheapest rival`}
          tone="ink"
        />
        <KpiTile
          icon={TrendingUp} label="Above Market"
          value={`${abovePct}%`}
          hint={`${positionCount('above')} priced above cheapest`}
          tone={abovePct === 0 ? 'emerald' : abovePct < 20 ? 'gold' : 'red'}
        />
        <KpiTile
          icon={TrendingDown} label="Below Market"
          value={`${belowPct}%`}
          hint={`${positionCount('below')} priced below avg rival`}
          tone="gold"
        />
      </div>

      {/* Row 3 — Action */}
      <SectionLabel>Today</SectionLabel>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiTile
          icon={Zap} label="Price Changes Today"
          value={changesToday}
          hint={changesToday === 0 ? 'Market quiet' : `${changesToday} rival move${changesToday === 1 ? '' : 's'} in last 24h`}
          tone={changesToday > 5 ? 'red' : changesToday > 0 ? 'gold' : 'ink'}
        />
        <KpiTile
          icon={ClipboardList} label="Repricing Actions"
          value={actionable.length}
          hint={actionable.length === 0 ? 'Nothing to change' : 'Suggested price differs by >1%'}
          tone={actionable.length > 0 ? 'gold' : 'emerald'}
        />
        <KpiTile
          icon={ShieldCheck} label="Approval Pending"
          value={pendingProposals}
          hint={pendingProposals === 0 ? 'Approval queue clear' : 'Awaiting manager review'}
          tone={pendingProposals > 0 ? 'gold' : 'ink'}
        />
        <KpiTile
          icon={Flame} label="Margin at Risk"
          value={`KD ${marginAtRisk.toFixed(3)}`}
          hint={marginAtRisk === 0 ? 'No exposure' : `Across ${positionCount('above')} above-market SKU${positionCount('above') === 1 ? '' : 's'}`}
          tone={marginAtRisk > 5 ? 'red' : marginAtRisk > 0 ? 'gold' : 'emerald'}
        />
      </div>

      {/* ── 4 Answer cards ──────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
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
          linkTo="/comparison"
          linkLabel="Review all"
          tone="gold"
        >
          {actionQueue.map(pi => <ActionQueueRow key={pi.product.id} intel={pi} />)}
        </AnswerCard>
      </div>


      {/* ── Bottom: Category performance + Recent moves ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {categoryRollup.length > 0 && (
          <div className="lg:col-span-2">
            <Card className="overflow-hidden">
              <div className="px-6 py-4 border-b border-ink-100">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">Portfolio</div>
                <h3 className="font-display text-[20px] tracking-tight text-ink-900 mt-1">Category performance</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-canvas-100 border-b border-ink-200">
                    <tr>
                      <Th>Category</Th>
                      <Th className="text-right">Products</Th>
                      <Th className="text-right">Tracked</Th>
                      <Th className="text-right">Avg gap vs cheapest rival</Th>
                      <Th className="text-right">Overpriced</Th>
                      <Th className="text-right">Underpriced</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {categoryRollup.map(row => (
                      <tr key={row.categoryId ?? 'uncat'} className="hover:bg-canvas-100/50">
                        <Td className="font-display text-[15px] tracking-tight text-ink-900">{row.name}</Td>
                        <Td className="text-right tabular-nums font-medium">{row.productCount}</Td>
                        <Td className="text-right tabular-nums text-ink-600">{row.trackedCount}/{row.productCount}</Td>
                        <Td className="text-right">
                          {row.avgGap != null ? <GapPill pct={row.avgGap} large /> : <span className="text-ink-300 text-xs italic">not tracked</span>}
                        </Td>
                        <Td className="text-right tabular-nums font-medium">
                          {row.overpriced > 0 ? <span className="text-red-700">{row.overpriced}</span> : <span className="text-ink-300">0</span>}
                        </Td>
                        <Td className="text-right tabular-nums font-medium">
                          {row.underpriced > 0 ? <span className="text-emerald-700">{row.underpriced}</span> : <span className="text-ink-300">0</span>}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}
        <div>
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-ink-100">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-700">Competitor moves</div>
              <h3 className="font-display text-[17px] tracking-tight text-ink-900 mt-1">Last 72 hours</h3>
            </div>
            {recentMoves.length === 0 ? (
              <div className="py-10 px-6 text-center text-[12.5px] text-ink-500">
                Prices are steady — no changes detected in the last 3 days.
              </div>
            ) : (
              <div className="divide-y divide-ink-100">
                {recentMoves.map(m => <MoveRow key={m.at + m.cp_id} move={m} />)}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ── Quick actions strip ─────────────────────────── */}
      <div className="mt-6 flex flex-wrap gap-2">
        <QuickChip to="/products" icon={Package} label="Add product" />
        <QuickChip to="/competitor-products" icon={Sparkles} label="Manage links" />
        <QuickChip to="/comparison" icon={LineChart} label="Full comparison" />
        <QuickChip to="/scrapers" icon={Play} label="Trigger scrape" />
      </div>
    </div>
  )
}

/* ── Widgets ───────────────────────────────────────────── */

function KpiTile({ icon: Icon, label, value, hint, tone = 'ink', pulse }) {
  const tones = {
    emerald: { icon: 'bg-emerald-50 text-emerald-700 border-emerald-100', accent: 'text-emerald-700' },
    red:     { icon: 'bg-red-50 text-red-700 border-red-100',             accent: 'text-red-700' },
    amber:   { icon: 'bg-amber-50 text-amber-800 border-amber-100',       accent: 'text-amber-800' },
    gold:    { icon: 'bg-brand-50 text-brand-700 border-brand-100',       accent: 'text-brand-700' },
    ink:     { icon: 'bg-ink-100 text-ink-700 border-ink-200',            accent: 'text-ink-800' },
  }
  const t = tones[tone] || tones.ink
  // Shrink font when the value is longer than a short number/percent, so KPI
  // tiles that hold "KD 12.345" or "just now" don't overflow.
  const strVal = String(value ?? '')
  const valSize = strVal.length > 8 ? 'text-[20px]' : strVal.length > 5 ? 'text-[24px]' : 'text-[30px]'
  return (
    <div className="bg-white border border-ink-100 rounded-2xl p-5 shadow-card relative overflow-hidden">
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 border relative ${t.icon}`}>
          <Icon size={16} strokeWidth={2} />
          {pulse && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 animate-ping" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-ink-500">{label}</div>
          <div className={`font-display ${valSize} leading-none mt-1.5 tabular-nums ${t.accent}`}>{value}</div>
          <div className="text-[11px] text-ink-500 mt-1.5 leading-snug">{hint}</div>
        </div>
      </div>
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-500 mb-2 mt-1">
      {children}
    </div>
  )
}

function AnswerCard({ kicker, title, subtitle, empty, emptyText, linkTo, linkLabel, tone = 'ink', children }) {
  const kickerTone = {
    red:     'text-red-700',
    emerald: 'text-emerald-700',
    gold:    'text-brand-700',
    ink:     'text-ink-600',
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
        <div className="divide-y divide-ink-100 flex-1">
          {children}
        </div>
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
        <img src={logoUrl} alt="" width="20" height="20"
          className="rounded flex-shrink-0"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
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

function MoveRow({ move }) {
  const rising = move.changePct > 0
  return (
    <div className="px-5 py-3 hover:bg-canvas-100/40 transition-colors">
      <div className="text-[12.5px] font-semibold text-ink-900 truncate">{move.cp_name}</div>
      <div className="text-[11px] text-ink-500 mt-0.5">{move.competitor_name}</div>
      <div className="flex items-center justify-between mt-1.5">
        <div className="text-[11.5px] tabular-nums text-ink-600">
          {move.from.toFixed(3)}
          <ArrowRight size={10} className="inline mx-1 text-ink-400" />
          <span className="text-ink-900 font-semibold">{move.to.toFixed(3)}</span>
        </div>
        <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums ${rising ? 'text-red-700' : 'text-emerald-700'}`}>
          {rising ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
          {rising ? '+' : ''}{move.changePct.toFixed(1)}%
        </span>
      </div>
      <div className="text-[10px] text-ink-400 mt-1">{relTime(new Date(move.at))}</div>
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

function QuickChip({ to, icon: Icon, label }) {
  return (
    <NavLink to={to}
      className="inline-flex items-center gap-2 px-3.5 py-2 bg-white border border-ink-200 rounded-full text-[12.5px] font-medium text-ink-700 hover:border-brand-300 hover:text-brand-700 hover:bg-brand-50/60 transition-colors">
      <Icon size={13} />
      {label}
    </NavLink>
  )
}

function Th({ children, className = '' }) {
  return <th className={`px-6 py-3 text-left text-[10px] font-semibold text-ink-500 uppercase tracking-[0.14em] ${className}`}>{children}</th>
}
function Td({ children, className = '' }) {
  return <td className={`px-6 py-3.5 text-sm text-ink-800 ${className}`}>{children}</td>
}

function relTime(d) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 60)    return 'just now'
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
