import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogIn, ArrowRight, TrendingUp, ShieldCheck, LineChart, Zap } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Button, Field, inputCls } from '../components/UI'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      const { error } = await signIn(email, password)
      if (error) throw error
      navigate('/')
    } catch (err) {
      setError(err.message || 'Sign-in failed')
    } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen flex bg-canvas-50">
      {/* ── Left: brand panel ───────────────────────────── */}
      <div className="hidden lg:flex lg:w-[52%] relative bg-ink-900 text-white overflow-hidden">
        <div className="absolute inset-0 bg-grain opacity-40" />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse at 20% 0%, rgba(177,134,58,0.15), transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(177,134,58,0.10), transparent 50%)',
          }}
        />
        <div className="relative w-full flex flex-col justify-between p-14">
          <div>
            <div className="flex items-baseline gap-1.5">
              <div className="font-display text-[30px] tracking-tight leading-none">Prisma</div>
              <div className="text-brand-400 text-[30px] leading-none">·</div>
              <div className="font-display text-[22px] tracking-tight text-ink-300 leading-none italic">Intel</div>
            </div>
            <div className="text-[10px] uppercase tracking-[0.24em] text-ink-400 mt-2.5 font-medium">
              Competitive Pricing Intelligence
            </div>
          </div>

          <div className="max-w-md">
            <h2 className="font-display text-[42px] leading-[1.05] tracking-tightest text-white">
              Move on price before the market moves on you.
            </h2>
            <p className="text-[15px] text-ink-300 mt-6 leading-relaxed">
              Live competitor tracking across 15 sites, rule-based repricing,
              and Dynamics 365 sync — from one console.
            </p>

            <div className="mt-10 space-y-4">
              <FeatureRow icon={LineChart} title="Continuous scraping"
                desc="Every 5 minutes. 1,500 SKUs across your competitor set." />
              <FeatureRow icon={Zap} title="Rule-based repricing"
                desc="Guardrails on margin, stock, and floor prices — before you push." />
              <FeatureRow icon={ShieldCheck} title="Approval-gated sync"
                desc="Every proposed price change reviewed before it hits your storefront." />
            </div>
          </div>

          <div className="text-[11px] text-ink-500 tracking-wider uppercase">
            © 2026 Prisma Intel — All rights reserved
          </div>
        </div>
      </div>

      {/* ── Right: form ─────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-8">
            <div className="lg:hidden flex items-baseline gap-1.5 mb-8">
              <div className="font-display text-[28px] tracking-tight text-ink-900 leading-none">Prisma</div>
              <div className="text-brand-500 text-[28px] leading-none">·</div>
              <div className="font-display text-[20px] tracking-tight text-ink-500 leading-none italic">Intel</div>
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-600 mb-3">
              Sign in
            </div>
            <h1 className="font-display text-[34px] leading-tight tracking-tightest text-ink-900">
              Welcome back.
            </h1>
            <p className="text-sm text-ink-500 mt-2">
              Enter your credentials to access the console.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-5">
            <Field label="Email">
              <input id="email" name="email" type="email" autoComplete="email" required
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                className={inputCls} />
            </Field>

            <Field label="Password">
              <input id="password" name="password" type="password" autoComplete="current-password" required
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className={inputCls} />
            </Field>

            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button type="submit" disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-ink-900 hover:bg-ink-800 text-white text-[13px] font-semibold transition-colors disabled:opacity-60 shadow-sm">
              {busy ? 'Signing in…' : (<>Continue <ArrowRight size={15} /></>)}
            </button>

            <div className="text-[11px] text-ink-400 text-center pt-6 border-t border-ink-100 tracking-wider uppercase">
              Secured by Supabase · Enterprise-grade RLS
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function FeatureRow({ icon: Icon, title, desc }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-brand-500/15 border border-brand-500/25 flex items-center justify-center flex-shrink-0 text-brand-300">
        <Icon size={15} strokeWidth={2} />
      </div>
      <div>
        <div className="text-[13.5px] font-semibold text-white">{title}</div>
        <div className="text-[12.5px] text-ink-400 leading-snug mt-0.5">{desc}</div>
      </div>
    </div>
  )
}
