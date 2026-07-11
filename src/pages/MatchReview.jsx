import { useState, useMemo } from 'react'
import { CheckCircle2, XCircle, Link2, Sparkles } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useTable } from '../lib/db'
import { useAuth } from '../lib/auth'
import {
  PageHeader, Card, Button, Empty, LoadingBlock, ErrorBlock, Badge,
} from '../components/UI'

/**
 * Match Review — Phase 3 UI.
 *
 * Shows auto-generated match_suggestions (populated by a cron/worker job that
 * computes name similarity across products × competitor_products). Admin
 * accepts or rejects each; accepting sets the competitor_products.product_id.
 *
 * Suggestions are populated by:
 *  - PostgreSQL trigram similarity (pg_trgm extension) — cheap, decent quality
 *  - OR OpenAI embeddings for higher-quality matches (Phase 3 improvement)
 *
 * On INSERT trigger for competitor_products, a background job runs:
 *   SELECT * FROM products
 *   WHERE similarity(products.name, NEW.name) > 0.4
 *   ORDER BY similarity(...) DESC LIMIT 3;
 * Each is inserted into match_suggestions.
 *
 * For now, this UI reads whatever's there.
 */
export default function MatchReview() {
  const { isManager } = useAuth()
  const { rows: suggestions, loading, error, refresh } =
    useTable('match_suggestions', { eq: ['reviewed', false], order: ['confidence', { ascending: false }] })
  const { rows: products } = useTable('products')
  const { rows: cps } = useTable('competitor_products')
  const { rows: competitors } = useTable('competitors')

  const productById = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products])
  const cpById = useMemo(() => Object.fromEntries(cps.map(c => [c.id, c])), [cps])
  const compById = useMemo(() => Object.fromEntries(competitors.map(c => [c.id, c])), [competitors])

  const [busyId, setBusyId] = useState(null)

  const accept = async (s) => {
    setBusyId(s.id)
    // 1. link the competitor_product
    await supabase.from('competitor_products')
      .update({ product_id: s.product_id, match_method: 'auto', match_confidence: s.confidence })
      .eq('id', s.competitor_product_id)
    // 2. mark suggestion reviewed + accepted
    await supabase.from('match_suggestions')
      .update({ reviewed: true, accepted: true })
      .eq('id', s.id)
    setBusyId(null); refresh()
  }
  const reject = async (s) => {
    setBusyId(s.id)
    await supabase.from('match_suggestions')
      .update({ reviewed: true, accepted: false })
      .eq('id', s.id)
    setBusyId(null); refresh()
  }

  return (
    <div>
      <PageHeader
        title="Match Review"
        subtitle="Auto-generated product match suggestions waiting for your approval."
      />

      <ErrorBlock error={error} onRetry={refresh} />

      {loading ? <LoadingBlock /> : suggestions.length === 0 ? (
        <Card className="p-6">
          <Empty
            icon={Sparkles}
            title="No suggestions to review"
            description="The auto-matcher runs when new competitor products are added. Suggestions with score above 0.4 appear here for admin approval."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {suggestions.map(s => {
            const cp = cpById[s.competitor_product_id]
            const p = productById[s.product_id]
            const c = cp ? compById[cp.competitor_id] : null
            return (
              <Card key={s.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="amber">{Math.round(s.confidence * 100)}% match</Badge>
                      <span className="text-xs text-ink-500 capitalize">via {s.method.replace('_', ' ')}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-ink-400 mb-1">Competitor's product</div>
                        <div className="font-medium text-ink-900">{cp?.name || `#${s.competitor_product_id}`}</div>
                        <div className="text-xs text-ink-500 mt-0.5">{c?.name || '—'}</div>
                        {cp?.url && (
                          <a href={cp.url} target="_blank" rel="noopener noreferrer"
                             className="text-xs text-brand-600 hover:underline mt-1 block truncate">
                            {cp.url}
                          </a>
                        )}
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-ink-400 mb-1">Your product</div>
                        <div className="font-medium text-ink-900">{p?.name || `#${s.product_id}`}</div>
                        <div className="text-xs text-ink-500 mt-0.5 font-mono">{p?.sku}</div>
                      </div>
                    </div>
                  </div>
                  {isManager && (
                    <div className="flex flex-col gap-2 shrink-0">
                      <Button variant="primary" size="sm" busy={busyId === s.id} onClick={() => accept(s)}>
                        <CheckCircle2 size={13} /> Accept
                      </Button>
                      <Button variant="secondary" size="sm" busy={busyId === s.id} onClick={() => reject(s)}>
                        <XCircle size={13} /> Reject
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
