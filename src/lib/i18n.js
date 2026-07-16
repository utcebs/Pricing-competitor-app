import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en.json'
import ar from '../locales/ar.json'

const RTL_LANGS = ['ar']

// Read language from localStorage → profile.locale (set later) → default 'en'.
const startLng = (() => {
  try { return localStorage.getItem('pca.lng') || 'en' } catch { return 'en' }
})()

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

// applyDirection needs to be delayed until the DOM exists so the
// digit-localizer can attach to document.body on first paint.
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyDirection(startLng))
  } else {
    applyDirection(startLng)
  }
}

export function setLanguage(lng) {
  const currentLng = i18n.language
  try { localStorage.setItem('pca.lng', lng) } catch {}
  i18n.changeLanguage(lng)
  applyDirection(lng)
  // Switching AR → non-AR: reload so Latin digits reappear cleanly.
  // (Reversing all localized text nodes deterministically is fiddly;
  // a reload is the simplest correct behaviour.)
  if (currentLng === 'ar' && lng !== 'ar') {
    setTimeout(() => window.location.reload(), 50)
  }
}

function applyDirection(lng) {
  const rtl = RTL_LANGS.includes(lng)
  document.documentElement.setAttribute('dir', rtl ? 'rtl' : 'ltr')
  document.documentElement.setAttribute('lang', lng)
  ensureDigitLocalizer(lng === 'ar')
}

// ── Global digit localizer ───────────────────────────────
// When the user switches to Arabic, walk every text node in the DOM and
// rewrite ASCII digits (0-9) → Arabic-Indic (٠-٩) + decimal separator.
// React re-renders replace text nodes with the original JSX, so we use
// a MutationObserver to re-localize new/changed nodes. Marking each
// localized node with a WeakSet prevents infinite loops.
const AR_DIGITS = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩']
let observer = null
const localized = new WeakSet()

function localizeText(text) {
  return text.replace(/\d/g, d => AR_DIGITS[+d])
             .replace(/\./g, '٫')
             .replace(/,/g, '٬')
}

function walkAndLocalize(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (localized.has(node)) return NodeFilter.FILTER_REJECT
      if (!/\d/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT
      // Skip <script>, <style>, form <input> value, <code> blocks
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
  if (typeof document === 'undefined') return
  if (observer) { observer.disconnect(); observer = null }
  // Clear the marker set — we can't clear WeakSet, so on lang switch
  // React will re-render with fresh nodes and the set naturally empties
  if (!enable) {
    // A full reload is the cleanest way back to Latin digits.
    // (This only fires when explicitly switching FROM Arabic TO another lang.)
    return
  }
  // First pass: localize whatever is currently in the DOM
  walkAndLocalize(document.body)
  // Watch for future changes
  observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.type === 'characterData' && m.target?.nodeType === Node.TEXT_NODE) {
        if (!localized.has(m.target)) {
          const after = localizeText(m.target.nodeValue)
          if (m.target.nodeValue !== after) {
            m.target.nodeValue = after
            localized.add(m.target)
          }
        }
      } else if (m.type === 'childList') {
        m.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) walkAndLocalize(node)
          else if (node.nodeType === Node.TEXT_NODE && !localized.has(node) && /\d/.test(node.nodeValue)) {
            const after = localizeText(node.nodeValue)
            if (node.nodeValue !== after) { node.nodeValue = after; localized.add(node) }
          }
        })
      }
    }
  })
  observer.observe(document.body, { childList: true, characterData: true, subtree: true })
}

/**
 * Convert Western-Arabic digits (0-9) in a string to Arabic-Indic (٠-٩)
 * when the current locale is Arabic. Non-digit characters pass through
 * unchanged, so 'KD 409.900' becomes 'KD ٤٠٩٫٩٠٠'.
 */
const AR_DIGITS = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩']
export function localizeDigits(text) {
  if (i18n.language !== 'ar' || text == null) return text
  return String(text)
    .replace(/\d/g, d => AR_DIGITS[+d])
    .replace(/\./g, '٫')   // Arabic decimal separator
    .replace(/,/g, '٬')    // Arabic thousands separator
}

export default i18n
