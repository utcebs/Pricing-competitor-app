import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en.json'
import ar from '../locales/ar.json'

// ── Constants (declared FIRST to avoid TDZ under minification) ──
const RTL_LANGS = ['ar']
const AR_DIGITS = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩']
let observer = null
const localized = new WeakSet()

// ── Read persisted lang ────────────────────────────────
const startLng = (() => {
  try { return localStorage.getItem('pca.lng') || 'en' } catch { return 'en' }
})()

// ── Init i18next ───────────────────────────────────────
i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
    },
    lng: startLng,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  })

// ── Pure helpers ───────────────────────────────────────
function localizeText(text) {
  return text.replace(/\d/g, d => AR_DIGITS[+d])
             .replace(/\./g, '٫')
             .replace(/,/g, '٬')
}

function walkAndLocalize(root) {
  if (!root) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (localized.has(node)) return NodeFilter.FILTER_REJECT
      if (!/\d/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT
      const p = node.parentNode
      if (!p) return NodeFilter.FILTER_REJECT
      const tag = p.nodeName
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CODE' || tag === 'PRE') return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    }
  })
  let n
  while ((n = walker.nextNode())) {
    const before = n.nodeValue
    const after = localizeText(before)
    if (before !== after) {
      n.nodeValue = after
      localized.add(n)
    }
  }
}

function ensureDigitLocalizer(enable) {
  if (typeof document === 'undefined' || !document.body) return
  if (observer) { observer.disconnect(); observer = null }
  if (!enable) return
  walkAndLocalize(document.body)
  observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.type === 'characterData' && m.target && m.target.nodeType === 3) {
        if (!localized.has(m.target)) {
          const after = localizeText(m.target.nodeValue)
          if (m.target.nodeValue !== after) {
            m.target.nodeValue = after
            localized.add(m.target)
          }
        }
      } else if (m.type === 'childList') {
        m.addedNodes.forEach(node => {
          if (node.nodeType === 1) walkAndLocalize(node)
          else if (node.nodeType === 3 && !localized.has(node) && /\d/.test(node.nodeValue)) {
            const after = localizeText(node.nodeValue)
            if (node.nodeValue !== after) { node.nodeValue = after; localized.add(node) }
          }
        })
      }
    }
  })
  observer.observe(document.body, { childList: true, characterData: true, subtree: true })
}

function applyDirection(lng) {
  if (typeof document === 'undefined') return
  const rtl = RTL_LANGS.includes(lng)
  document.documentElement.setAttribute('dir', rtl ? 'rtl' : 'ltr')
  document.documentElement.setAttribute('lang', lng)
  ensureDigitLocalizer(lng === 'ar')
}

// ── Public API ─────────────────────────────────────────
export function setLanguage(lng) {
  const currentLng = i18n.language
  try { localStorage.setItem('pca.lng', lng) } catch {}
  i18n.changeLanguage(lng)
  applyDirection(lng)
  // Switching AR → non-AR: reload so Latin digits reappear cleanly.
  if (currentLng === 'ar' && lng !== 'ar') {
    setTimeout(() => window.location.reload(), 50)
  }
}

export function localizeDigits(text) {
  if (i18n.language !== 'ar' || text == null) return text
  return localizeText(String(text))
}

// ── Bootstrap AFTER all functions are declared ─────────
// Deferring to DOMContentLoaded so document.body exists before we walk it.
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyDirection(startLng))
  } else {
    applyDirection(startLng)
  }
}

export default i18n
