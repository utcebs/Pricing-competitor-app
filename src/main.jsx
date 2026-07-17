import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'
import './lib/i18n' // initializes i18next before any component mounts

// Catch stale-chunk rejections that happen OUTSIDE a React render — e.g.
// route prefetch on hover fires an import() that rejects on a redeploy.
// Those never reach ErrorBoundary, so handle them here. Same one-per-session
// sentinel as ErrorBoundary to avoid reload loops.
const STALE_RE = /(Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError)/i
const RELOAD_SENTINEL = 'pca:stale-chunk-reloaded'
window.addEventListener('unhandledrejection', (e) => {
  const msg = String(e?.reason?.message || e?.reason || '')
  if (!STALE_RE.test(msg)) return
  try {
    if (sessionStorage.getItem(RELOAD_SENTINEL)) return
    sessionStorage.setItem(RELOAD_SENTINEL, String(Date.now()))
  } catch { /* ignore */ }
  window.location.reload()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
)
