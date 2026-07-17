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
      const { data, error } = await signIn(email, password)
      if (error) throw error
      if (!data?.session) throw new Error('Sign-in returned no session — try again or contact admin')
      navigate('/')
    } catch (err) {
      // Surface EVERY shape the error can take: Error, string, {message}, {error_description}, or worst-case object
      const raw =
        err?.message ||
        err?.error_description ||
        err?.error?.message ||
        (typeof err === 'string' ? err : null) ||
        (err && typeof err === 'object' ? JSON.stringify(err) : null) ||
        'Sign-in failed'
      // Friendly translations for known Supabase Auth codes
      const friendly = raw.toLowerCase().includes('invalid login') || raw.toLowerCase().includes('invalid_credentials')
        ? 'Wrong email or password. Check your credentials or ask an admin to reset your password.'
        : raw.toLowerCase().includes('email not confirmed')
        ? 'Your email needs confirmation. Ask an admin to enable this account.'
        : raw.toLowerCase().includes('rate limit') || raw.toLowerCase().includes('too many')
        ? 'Too many attempts. Wait a minute and try again.'
        : raw === '{}' || raw === ''
        ? 'Sign-in failed with no details. Your account may be missing an identity record — ask an admin to re-create the account.'
        : raw
      setError(friendly)
      console.error('[login] error:', err)
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
            <img
              src={`${import.meta.env.BASE_URL}logo.png`}
              alt="Union Trading Co."
              className="h-14 w-auto object-contain [filter:brightness(0)_invert(1)]"
            />
            <div className="text-[10px] uppercase tracking-[0.24em] text-ink-400 mt-4 font-medium">
              Competitive Pricing Intelligence
            </div>
          </div>

          <div className="max-w-md">
            <h2 className="font-display text-[42px] leading-[1.05] tracking-tightest text-white">
              Move on price before the market moves on you.
            </h2>
            <p className="text-[15px] text-ink-300 mt-6 leading-relaxed">
              Live competitor tracking and intelligent Analytics — all from a single console.
            </p>

            <div className="mt-10 space-y-4">
              <FeatureRow icon={LineChart} title="Continuous competitor monitoring"
                desc="Continuously monitors competitor pricing across your selected websites, ensuring you always have access to the latest market data without manual effort." />
              <FeatureRow icon={ShieldCheck} title="Actionable market insights"
                desc="Consolidates competitor pricing into a centralized dashboard, making it easy to compare prices, identify trends, and spot opportunities to stay competitive." />
              <FeatureRow icon={Zap} title="Automated alerts and recommendations"
                desc="Detects significant pricing changes and generates intelligent repricing recommendations based on your predefined business rules, enabling faster, more informed pricing decisions." />
            </div>
          </div>

          <div className="text-[11px] text-ink-500 tracking-wider uppercase">
            © 2026 Union Trading Co. — All rights reserved
          </div>
        </div>
      </div>

      {/* ── Right: form ─────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-8">
            <div className="lg:hidden mb-8">
              <img
                src={`${import.meta.env.BASE_URL}logo.png`}
                alt="Union Trading Co."
                className="h-10 w-auto object-contain"
              />
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
