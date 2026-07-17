import { Component } from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'

/**
 * Detect the "stale chunk after redeploy" error class. Vite emits chunks
 * with content-hashed names (Comparison-DTZSQIrB.js). After a redeploy the
 * hash changes; a browser holding the old index.js requests a chunk that
 * no longer exists on the server → dynamic import throws.
 */
function isStaleChunkError(err) {
  if (!err) return false
  const msg = String(err?.message || err || '')
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /ChunkLoadError/i.test(msg) ||
    err?.name === 'ChunkLoadError'
  )
}

const RELOAD_SENTINEL = 'pca:stale-chunk-reloaded'

/**
 * Catches runtime errors in the React tree and renders a recovery UI
 * instead of an unstyled white screen. Every uncaught render / lifecycle
 * error routes here.
 *
 * Placement: wrap around <Routes> in App so any page crash is contained.
 * ALSO wrap around individual heavy components (Comparison table, chart
 * grids) if we want per-widget resilience. For now, one boundary at the
 * app root — good enough for release.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] caught:', error, info)
    this.setState({ info })

    if (isStaleChunkError(error)) {
      try {
        const already = sessionStorage.getItem(RELOAD_SENTINEL)
        if (!already) {
          sessionStorage.setItem(RELOAD_SENTINEL, String(Date.now()))
          // Give React a tick to commit the error UI so users see a brief
          // "reloading…" flash rather than a jarring blank blip.
          setTimeout(() => window.location.reload(), 100)
        }
      } catch {
        // sessionStorage blocked (Safari private / iframe) — just reload once.
        setTimeout(() => window.location.reload(), 100)
      }
    }
  }

  componentDidMount() {
    // Clear the sentinel once we've successfully rendered the tree after a
    // reload — future stale-chunk errors get one auto-recovery again.
    try {
      if (sessionStorage.getItem(RELOAD_SENTINEL)) {
        sessionStorage.removeItem(RELOAD_SENTINEL)
      }
    } catch { /* ignore */ }
  }

  reset = () => {
    this.setState({ hasError: false, error: null, info: null })
  }

  reload = () => {
    window.location.reload()
  }

  goHome = () => {
    window.location.hash = '#/'
    this.reset()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const msg = this.state.error?.message || String(this.state.error) || 'Unknown error'
    const staleChunk = isStaleChunkError(this.state.error)

    if (staleChunk) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-canvas-50 p-8">
          <div className="max-w-md w-full bg-white rounded-2xl border border-ink-100 shadow-card-xl p-7 text-center">
            <div className="w-12 h-12 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center mx-auto mb-4">
              <RefreshCw size={20} className="animate-spin" />
            </div>
            <div className="font-display text-[20px] tracking-tight text-ink-900">Updating to the latest version…</div>
            <div className="text-[12.5px] text-ink-500 mt-2">
              A new build was deployed. Reloading now to pick it up.
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas-50 p-8">
        <div className="max-w-lg w-full bg-white rounded-2xl border border-red-100 shadow-card-xl overflow-hidden">
          <div className="px-7 py-5 bg-red-50 border-b border-red-100 flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-100 text-red-700 flex items-center justify-center flex-shrink-0">
              <AlertTriangle size={18} />
            </div>
            <div>
              <div className="font-display text-[22px] tracking-tight text-red-800">Something crashed</div>
              <div className="text-[12.5px] text-red-700 mt-1">
                An unexpected error stopped the page from rendering. Your data is safe — this is a UI issue only.
              </div>
            </div>
          </div>
          <div className="px-7 py-5">
            <div className="text-[11px] uppercase tracking-widest font-semibold text-ink-500 mb-1">Details</div>
            <div className="text-[12px] font-mono text-ink-800 bg-ink-100 rounded-lg p-3 max-h-40 overflow-auto whitespace-pre-wrap break-all">
              {msg}
            </div>
            {this.state.info?.componentStack && (
              <details className="mt-3">
                <summary className="text-[11px] text-ink-500 cursor-pointer hover:text-ink-800">
                  Stack (for developers)
                </summary>
                <div className="text-[10px] font-mono text-ink-500 bg-ink-100 rounded-lg p-2 mt-1 max-h-40 overflow-auto whitespace-pre-wrap">
                  {this.state.info.componentStack}
                </div>
              </details>
            )}
            <div className="flex flex-wrap gap-2 mt-5 pt-4 border-t border-ink-100">
              <button onClick={this.goHome}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-ink-900 hover:bg-ink-800 text-white text-[13px] font-semibold">
                <Home size={14} /> Go to dashboard
              </button>
              <button onClick={this.reload}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white border border-ink-200 hover:bg-ink-50 text-ink-800 text-[13px] font-semibold">
                <RefreshCw size={14} /> Reload page
              </button>
            </div>
            <div className="text-[11px] text-ink-400 mt-3">
              If this keeps happening, tell an admin — the error text above helps diagnose.
            </div>
          </div>
        </div>
      </div>
    )
  }
}
