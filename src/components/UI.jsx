import { X, Loader2 } from 'lucide-react'
import { useEffect } from 'react'

// Reusable class strings — keep imports lean across pages.
export const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400 transition-colors'
export const selectCls = inputCls
export const textareaCls = inputCls + ' resize-y min-h-[80px]'

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function Card({ children, className = '' }) {
  return (
    <div className={`bg-white border border-slate-200 rounded-2xl shadow-sm ${className}`}>
      {children}
    </div>
  )
}

export function Button({ variant = 'primary', size = 'md', children, className = '', busy, ...props }) {
  const variants = {
    primary:   'bg-brand-600 hover:bg-brand-700 text-white',
    secondary: 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50',
    ghost:     'text-slate-500 hover:text-slate-800 hover:bg-slate-100',
    danger:    'bg-red-600 hover:bg-red-700 text-white',
  }
  const sizes = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-3.5 py-2 text-sm', lg: 'px-5 py-2.5 text-sm' }
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={busy || props.disabled}
      {...props}
    >
      {busy && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  )
}

export function Modal({ open, onClose, title, children, wide }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] bg-slate-900/50">
      <div className={`bg-white rounded-2xl shadow-2xl w-full mx-4 max-h-[85vh] flex flex-col ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6">
        <h3 className="text-base font-semibold text-slate-900 mb-2">{title}</h3>
        <p className="text-sm text-slate-600 mb-5">{message}</p>
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
      <div className="text-xs font-medium text-slate-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </div>
      {children}
      {hint && <div className="text-[11px] text-slate-400 mt-1">{hint}</div>}
    </label>
  )
}

export function Empty({ icon: Icon, title, description, action }) {
  return (
    <div className="text-center py-14">
      {Icon && (
        <div className="w-12 h-12 mx-auto rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
          <Icon size={22} />
        </div>
      )}
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {description && <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Badge({ variant = 'slate', children }) {
  const variants = {
    slate:   'bg-slate-100 text-slate-700',
    brand:   'bg-brand-50 text-brand-700',
    green:   'bg-emerald-50 text-emerald-700',
    red:     'bg-red-50 text-red-700',
    amber:   'bg-amber-50 text-amber-700',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${variants[variant]}`}>
      {children}
    </span>
  )
}

export function LoadingBlock({ text = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center py-14 text-sm text-slate-400">
      <Loader2 className="animate-spin mr-2" size={16} />
      {text}
    </div>
  )
}

export function ErrorBlock({ error, onRetry }) {
  if (!error) return null
  return (
    <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700 mb-4">
      <div className="font-medium">Something went wrong</div>
      <div className="mt-1 text-red-600 break-all">{error}</div>
      {onRetry && (
        <button onClick={onRetry} className="text-xs font-medium underline mt-2">Try again</button>
      )}
    </div>
  )
}
