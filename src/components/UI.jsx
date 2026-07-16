import { X, Loader2 } from 'lucide-react'
import { useEffect } from 'react'

// ── Design tokens ────────────────────────────────────────
export const inputCls =
  'w-full px-3.5 py-2.5 rounded-lg border border-ink-200 bg-white text-sm text-ink-900 placeholder-ink-400 ' +
  'focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400 transition-all ' +
  'hover:border-ink-300'
export const selectCls   = inputCls + ' cursor-pointer'
export const textareaCls = inputCls + ' resize-y min-h-[92px] leading-relaxed'

// ── Structural pieces ────────────────────────────────────
export function PageHeader({ title, subtitle, action, kicker }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8 pb-6 border-b border-ink-100">
      <div className="min-w-0">
        {kicker && (
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-600 mb-2">
            {kicker}
          </div>
        )}
        <h1 className="font-display text-[32px] leading-tight font-500 tracking-tightest text-ink-900">
          {title}
        </h1>
        {subtitle && <p className="text-[13px] text-ink-500 mt-1.5 max-w-2xl leading-relaxed">{subtitle}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

export function Card({ children, className = '', padded = false }) {
  return (
    <div className={`bg-white border border-ink-100 rounded-2xl shadow-card ${padded ? 'p-6' : ''} ${className}`}>
      {children}
    </div>
  )
}

export function Button({ variant = 'primary', size = 'md', children, className = '', busy, ...props }) {
  const variants = {
    primary:
      'bg-ink-900 hover:bg-ink-800 text-canvas-50 shadow-sm ' +
      'border border-ink-900',
    secondary:
      'bg-white border border-ink-200 text-ink-800 hover:bg-ink-50 hover:border-ink-300',
    gold:
      'bg-brand-500 hover:bg-brand-600 text-white shadow-sm border border-brand-600',
    ghost:
      'text-ink-500 hover:text-ink-900 hover:bg-ink-100',
    danger:
      'bg-red-700 hover:bg-red-800 text-white border border-red-800',
  }
  const sizes = {
    sm: 'px-2.5 py-1.5 text-xs',
    md: 'px-4 py-2 text-[13px]',
    lg: 'px-5 py-2.5 text-sm',
  }
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={busy || props.disabled}
      {...props}
    >
      {busy && <Loader2 size={13} className="animate-spin" />}
      {children}
    </button>
  )
}

export function Modal({ open, onClose, title, subtitle, children, wide }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[7vh] bg-ink-900/40 backdrop-blur-sm">
      <div className={`bg-white rounded-2xl shadow-card-xl w-full mx-4 max-h-[86vh] flex flex-col ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
        <div className="flex items-start justify-between px-7 py-5 border-b border-ink-100">
          <div className="min-w-0">
            <h2 className="font-display text-[20px] leading-tight font-500 tracking-tight text-ink-900">
              {title}
            </h2>
            {subtitle && <p className="text-xs text-ink-500 mt-1">{subtitle}</p>}
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg text-ink-400 hover:text-ink-900 hover:bg-ink-100 transition-colors -mt-1">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-7 py-6">{children}</div>
      </div>
    </div>
  )
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Delete', busy }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-card-xl max-w-md w-full mx-4 p-7">
        <h3 className="font-display text-[20px] leading-tight tracking-tight text-ink-900 mb-2">{title}</h3>
        <p className="text-sm text-ink-600 mb-6 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" busy={busy} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}

export function Field({ label, required, hint, children }) {
  return (
    <label className="block">
      <div className="text-[11px] font-semibold text-ink-600 uppercase tracking-[0.08em] mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </div>
      {children}
      {hint && <div className="text-[11px] text-ink-400 mt-1.5">{hint}</div>}
    </label>
  )
}

export function Empty({ icon: Icon, title, description, action }) {
  return (
    <div className="text-center py-16 px-6">
      {Icon && (
        <div className="w-14 h-14 mx-auto rounded-2xl bg-canvas-100 text-ink-400 flex items-center justify-center mb-4 border border-ink-100">
          <Icon size={22} strokeWidth={1.5} />
        </div>
      )}
      <h3 className="font-display text-[18px] tracking-tight text-ink-900">{title}</h3>
      {description && <p className="text-sm text-ink-500 mt-1.5 max-w-md mx-auto leading-relaxed">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Badge({ variant = 'slate', children }) {
  const variants = {
    slate:  'bg-ink-100 text-ink-700 border-ink-200',
    brand:  'bg-brand-50 text-brand-700 border-brand-100',
    green:  'bg-emerald-50 text-emerald-800 border-emerald-100',
    red:    'bg-red-50 text-red-800 border-red-100',
    amber:  'bg-amber-50 text-amber-800 border-amber-100',
    ink:    'bg-ink-900 text-canvas-50 border-ink-900',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold border ${variants[variant]} uppercase tracking-wider`}>
      {children}
    </span>
  )
}

export function LoadingBlock({ text = 'Loading' }) {
  return (
    <div className="flex items-center justify-center py-16 text-sm text-ink-400">
      <Loader2 className="animate-spin mr-2" size={16} />
      {text}…
    </div>
  )
}

export function ErrorBlock({ error, onRetry }) {
  if (!error) return null
  // Normalise every possible shape into a readable string
  const msg = normaliseError(error)
  return (
    <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-sm text-red-800 mb-4">
      <div className="font-semibold">Something went wrong</div>
      <div className="mt-1 text-red-700 break-all">{msg}</div>
      {onRetry && (
        <button onClick={onRetry} className="text-xs font-semibold underline mt-2 hover:no-underline">Try again</button>
      )}
    </div>
  )
}

/** Convert any error shape (Error, string, {message}, PostgREST error, worst-case object) into a readable string. */
export function normaliseError(e) {
  if (!e) return ''
  if (typeof e === 'string') return e
  if (e.message) return e.message
  if (e.error_description) return e.error_description
  if (e.error?.message) return e.error.message
  if (e.details) return e.details
  if (e.hint) return e.hint
  if (typeof e === 'object') {
    try {
      const s = JSON.stringify(e)
      return s === '{}' ? 'Empty error returned from server (check console for details).' : s
    } catch {
      return String(e)
    }
  }
  return String(e)
}

// Small stat block — for dashboards, page headers etc.
export function Stat({ label, value, hint }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">{label}</div>
      <div className="font-display text-[28px] leading-none mt-1.5 text-ink-900 tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-ink-500 mt-1.5">{hint}</div>}
    </div>
  )
}
