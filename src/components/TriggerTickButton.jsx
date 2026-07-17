import { useState } from 'react'
import { Zap, Key, ExternalLink, CheckCircle2, Loader2, X } from 'lucide-react'
import { Button, Modal, Field, inputCls } from './UI'

/**
 * TriggerTickButton — fires the worker-tick GitHub Actions workflow
 * on demand via workflow_dispatch. Bypasses the 5-minute cron wait.
 *
 * Auth: requires a GitHub Personal Access Token (fine-grained) with
 * "Actions: read/write" permission on the Pricing-competitor-app repo.
 * Stored in localStorage per-browser (never sent to Supabase). Admins
 * only see this button; they set the token once on first click.
 */
const OWNER = 'utcebs'
const REPO  = 'Pricing-competitor-app'
const WORKFLOW = 'worker-tick.yml'
const LS_KEY = 'gh_pat_worker_tick'

export default function TriggerTickButton() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)     // { kind: 'success'|'error', text }
  const [setupOpen, setSetupOpen] = useState(false)

  const trigger = async () => {
    let token = null
    try { token = localStorage.getItem(LS_KEY) } catch { /* Safari private mode etc. */ }
    if (!token) { setSetupOpen(true); return }
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
        {
          method: 'POST',
          headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ref: 'main' }),
        }
      )
      if (res.status === 204) {
        setMsg({ kind: 'success', text: 'Tick fired. Worker starts in ~10 seconds.' })
      } else if (res.status === 401 || res.status === 403) {
        setMsg({ kind: 'error', text: 'Token rejected — regenerate it with Actions: write permission.' })
        try { localStorage.removeItem(LS_KEY) } catch { /* ignore */ }
      } else if (res.status === 404) {
        setMsg({ kind: 'error', text: `Workflow not found. Check ${OWNER}/${REPO} and workflow name.` })
      } else {
        const body = await res.text()
        setMsg({ kind: 'error', text: `HTTP ${res.status}: ${body.slice(0, 200)}` })
      }
    } catch (e) {
      setMsg({ kind: 'error', text: 'Network error: ' + e.message })
    } finally {
      setBusy(false)
      setTimeout(() => setMsg(null), 8000)
    }
  }

  return (
    <>
      <Button variant="gold" onClick={trigger} busy={busy}
        title="Bypass the 5-min cron and fire the worker tick immediately">
        <Zap size={13} /> Trigger tick now
      </Button>
      {msg && (
        <div className={`fixed bottom-24 right-6 z-50 px-4 py-3 rounded-lg border shadow-card-xl text-[12.5px] max-w-md ${
          msg.kind === 'success'
            ? 'bg-emerald-50 border-emerald-100 text-emerald-800'
            : 'bg-red-50 border-red-100 text-red-800'
        }`}>
          {msg.kind === 'success' && <CheckCircle2 size={14} className="inline mr-1.5 -mt-0.5"/>}
          {msg.text}
        </div>
      )}
      <SetupModal open={setupOpen} onClose={() => setSetupOpen(false)}
        onSaved={() => { setSetupOpen(false); trigger() }}/>
    </>
  )
}

function SetupModal({ open, onClose, onSaved }) {
  const [token, setToken] = useState('')
  const save = () => {
    if (!token.trim()) return
    try {
      localStorage.setItem(LS_KEY, token.trim())
      onSaved?.()
    } catch (e) {
      // Safari private mode, storage quota, or CSP block
      alert('Could not save token: ' + (e?.message || 'localStorage blocked in this browser'))
    }
  }
  return (
    <Modal open={open} onClose={onClose} wide
      title={<span className="inline-flex items-center gap-2"><Key size={17}/> GitHub token — one-time setup</span>}>
      <div className="space-y-4 text-[13px] text-ink-700">
        <p>
          To fire the worker on demand (skipping the 5-min cron wait), we need a fine-grained GitHub Personal Access Token
          with permission to trigger workflows on the <code className="text-[11px] bg-ink-100 px-1 py-0.5 rounded">{OWNER}/{REPO}</code> repo.
        </p>

        <ol className="space-y-2 pl-4 list-decimal">
          <li>
            Open <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener noreferrer"
              className="text-brand-700 hover:underline inline-flex items-center gap-1 font-medium">
              GitHub → Fine-grained tokens → New token <ExternalLink size={11}/>
            </a>
          </li>
          <li>
            <strong>Token name</strong>: <code className="text-[11px] bg-ink-100 px-1 rounded">Price competitor · trigger worker</code>
          </li>
          <li>
            <strong>Repository access</strong> → <em>Only select repositories</em> → pick <code className="text-[11px] bg-ink-100 px-1 rounded">{REPO}</code>
          </li>
          <li>
            <strong>Repository permissions</strong> → find <em>Actions</em> → set to <strong>Read and write</strong>
          </li>
          <li>Set expiration (recommend 90 days), click <strong>Generate token</strong>, copy the <code className="text-[11px] bg-ink-100 px-1 rounded">github_pat_…</code> string</li>
          <li>Paste it below</li>
        </ol>

        <div className="pt-2 border-t border-ink-100">
          <Field label="Personal access token">
            <input
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="github_pat_..."
              className={`${inputCls} font-mono text-[12px]`}
            />
          </Field>
          <div className="text-[11px] text-ink-500 mt-2">
            Stored in your browser's localStorage — never sent to Supabase or the app's backend.
            Only used for direct requests to api.github.com from this device.
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-ink-100">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="gold" onClick={save} disabled={!token.trim()}>Save + trigger</Button>
      </div>
    </Modal>
  )
}
